const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {initializeApp,cert}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore,Timestamp,FieldValue}=require('firebase-admin/firestore');
const {createHash}=require('node:crypto');
const credential=process.env.ARCHIVE_FIREBASE_CREDENTIALS;
initializeApp(credential?{credential:cert(JSON.parse(credential))}:undefined);
const db=getFirestore(), auth=getAuth();
const invalid=message=>{ throw new HttpsError('invalid-argument',message); };
const generic='الرقم الجامعي أو كلمة المرور غير صحيحة.';
const numberOf=value=>{
  const number=String(value??'').trim().replace(/[٠-٩]/g,x=>String(x.charCodeAt(0)-1632)).replace(/[۰-۹]/g,x=>String(x.charCodeAt(0)-1776));
  if(!/^\d{1,20}$/.test(number)) invalid('أدخل الرقم الجامعي بالأرقام فقط.');
  return number;
};
const text=(value,max)=>typeof value==='string'&&value.trim().length<=max?value.trim():'';
const validPassword=value=>typeof value==='string'&&value.length>=8&&value.length<=128&&/[A-Z]/.test(value)&&/\p{Nd}/u.test(value)&&/[^\p{L}\p{N}\s]/u.test(value);
async function throttle(request,action,number) {
  const slot=Math.floor(Date.now()/600000);
  const keys=[['ip:'+request.rawRequest.ip,action==='register'?15:75],['number:'+number,10]];
  await db.runTransaction(async tx=>{
    const refs=keys.map(([key])=>db.doc('limits/'+createHash('sha256').update(action+key).digest('hex')));
    const snapshots=await tx.getAll(...refs);
    snapshots.forEach((snap,i)=>{
      const old=snap.data();
      const count=old?.slot===slot?old.count+1:1;
      if(count>keys[i][1]) throw new HttpsError('resource-exhausted','محاولات كثيرة. جرّب بعد دقائق.');
      tx.set(refs[i],{slot,count,expiresAt:Timestamp.fromMillis((slot+2)*600000)});
    });
  });
}
async function identity(method,body,key) {
  const emulator=process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const base=emulator?'http://'+emulator+'/identitytoolkit.googleapis.com':'https://identitytoolkit.googleapis.com';
  const response=await fetch(base+'/v1/accounts:'+method+'?key='+encodeURIComponent(emulator?'demo-key':key),{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)
  });
  if(response.status>=500) throw new HttpsError('unavailable','خدمة الدخول غير متاحة الآن.');
  return response.ok ? response.json() : null;
}
exports.accounts=onCall({maxInstances:5},async request=>{
  const data=request.data??{}, key=process.env.ARCHIVE_WEB_API_KEY;
  if(data.action==='finish') {
    const uid=request.auth?.uid;
    if(!uid || request.auth.token.email_verified!==true) throw new HttpsError('permission-denied','فعّل بريدك الإلكتروني أولًا.');
    const profile=db.doc('students/'+uid), pending=db.doc('pending/'+uid), role=db.doc('roles/'+uid);
    await db.runTransaction(async tx=>{
      const [p,r,existing]=await tx.getAll(pending,role,profile);
      if(existing.exists&&r.data()?.role==='student'&&r.data()?.active===true) return;
      if(!p.exists||r.exists) throw new HttpsError('failed-precondition','لا يوجد تسجيل طالب قابل للإكمال.');
      const record=p.data();
      if(record.email!==request.auth.token.email?.toLowerCase()) throw new HttpsError('permission-denied','البريد لا يطابق طلب التسجيل.');
      const index=db.doc('studentNumbers/'+record.number);
      if((await tx.get(index)).exists) throw new HttpsError('already-exists','هذا الرقم الجامعي مرتبط بحساب.');
      tx.create(index,{uid,email:record.email});
      tx.create(profile,record);
      tx.create(role,{role:'student',active:true});
      tx.delete(pending);
    });
    return {ok:true};
  }
  if(!key&&!process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new HttpsError('failed-precondition','إعداد Firebase غير مكتمل.');
  if(!['register','login'].includes(data.action)) invalid('الطلب غير صالح.');
  const number=numberOf(data.number);
  if(typeof data.password!=='string'||!data.password||data.password.length>128) invalid('أدخل كلمة مرور صالحة.');
  await throttle(request,data.action,number);
  if(data.action==='login') {
    const entry=(await db.doc('studentNumbers/'+number).get()).data();
    const result=await identity('signInWithPassword',{email:entry?.email??'missing-account@example.invalid',password:data.password,returnSecureToken:true},key);
    if(!entry || result?.localId!==entry.uid) throw new HttpsError('unauthenticated',generic);
    const record=(await db.doc('roles/'+entry.uid).get()).data();
    const user=await auth.getUser(entry.uid);
    if(record?.role!=='student'||record.active!==true||!user.emailVerified||user.disabled) throw new HttpsError('unauthenticated',generic);
    return {token:await auth.createCustomToken(entry.uid)};
  }
  const email=text(data.email,254).toLowerCase(), fullName=text(data.fullName,120).replace(/\s+/g,' ');
  const birth=text(data.birth,10), date=Date.parse(birth+'T00:00:00Z');
  const choices=Array.isArray(data.subjects)?[...new Set(data.subjects)]:[];
  if(fullName.length<2) invalid('تحقّق من الاسم الكامل.');
  if(email!==number+'@ses.yu.edu.jo') invalid('الرقم في البريد لازم يطابق الرقم الجامعي المدخل، متبوعًا بـ @ses.yu.edu.jo.');
  if(!['female','male','undisclosed'].includes(data.gender)) invalid('اختر الجنس من القائمة.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(birth)||!Number.isFinite(date)||birth<'1900-01-01'||date>Date.now()||new Date(date).toISOString().slice(0,10)!==birth) invalid('أدخل تاريخ ميلاد صحيحًا.');
  if(!validPassword(data.password)||data.confirm!==data.password) invalid('تحقّق من شروط كلمة المرور وتطابقها.');
  if(!choices.length||choices.length>30||choices.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(id))) invalid('اختر مادة واحدة على الأقل.');
  const subjects=await db.getAll(...choices.map(id=>db.doc('subjects/'+id)));
  if(subjects.some(snap=>snap.data()?.active!==true)) invalid('إحدى المواد المختارة غير متاحة.');
  if((await db.doc('studentNumbers/'+number).get()).exists) throw new HttpsError('already-exists','هذا الرقم الجامعي مرتبط بحساب.');
  const account=await identity('signUp',{email,password:data.password,returnSecureToken:true},key);
  if(!account?.localId) throw new HttpsError('already-exists','تعذّر إنشاء الحساب بهذا البريد. جرّب استعادة كلمة المرور أو متابعة التفعيل.');
  try { await db.doc('pending/'+account.localId).create({number,fullName,email,gender:data.gender,birth,subjects:choices}); }
  catch(error) { await auth.deleteUser(account.localId); throw error; }
  return {token:await auth.createCustomToken(account.localId)};
});
const {getStorage}=require('firebase-admin/storage');
const {randomBytes}=require('node:crypto');
const uuid=/^[a-f0-9-]{36}$/;
const images={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
function bucket() {
  if(process.env.ARCHIVE_SUPABASE_URL) return require('./private-storage.cjs').supabaseBucket();
  const project=process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT;
  const suffix=process.env.FIREBASE_STORAGE_EMULATOR_HOST?'.appspot.com':'.firebasestorage.app';
  return getStorage().bucket(process.env.ARCHIVE_BUCKET||project+suffix);
}
async function staffRole(request) {
  if(!request.auth?.token.email_verified) throw new HttpsError('permission-denied','يلزم دخول الإدارة ببريد مفعّل.');
  const role=(await db.doc('roles/'+request.auth.uid).get()).data();
  if(!role?.active||!['owner','assistant'].includes(role.role)) throw new HttpsError('permission-denied','لا تملك هذه الصلاحية.');
  return role.role;
}
exports.management=onCall({maxInstances:5},async request=>{
  const role=await staffRole(request);
  const data=request.data??{};
  if(data.action==='uploadImage'){
    const uid=request.auth.uid;
    if(typeof data.batch!=='string'||!uuid.test(data.batch)||typeof data.name!=='string'||
      !/^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(data.name)||images[data.type]!==data.name.split('.').pop()||
      typeof data.content!=='string'||data.content.length>14_000_000||!/^[a-zA-Z0-9+/]+={0,2}$/.test(data.content))
      invalid('بيانات الصورة غير صالحة.');
    const bytes=Buffer.from(data.content,'base64');
    if(!bytes.length||bytes.length>10485760)invalid('حجم الصورة يتجاوز ١٠ ميغابايت.');
    if((await db.doc('examBatches/'+data.batch).get()).exists)throw new HttpsError('already-exists','هذه الدفعة محفوظة بالفعل.');
    const path='exam-images/'+uid+'/'+data.batch+'/'+data.name;
    const object=bucket().file(path);
    try{await object.save(bytes,{contentType:data.type,resumable:false,ifAbsent:true});}
    catch(error){
      if(Number(error.code)!==409)throw error;
      const [existing]=await object.download();
      if(!existing.equals(bytes))throw new HttpsError('already-exists','الاسم مرتبط بصورة أخرى.');
    }
    return {ok:true};
  }
  if(data.action==='publish') {
    const uid=request.auth.uid;
    if(!uuid.test(data.batch)||!['mid','final','quiz','makeup'].includes(data.kind)||
      !['first','second','summer'].includes(data.term)||!/^20\d{2}$/.test(data.year)||
      typeof data.subject!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(data.subject)) invalid('تحقق من تصنيف الدفعة.');
    const title=text(data.title,160);
    const files=data.files;
    if(!title||!Array.isArray(files)||!files.length||files.length>20||new Set(files).size!==files.length||
      files.some(name=>typeof name!=='string'||!/^([a-f0-9-]{36})\.(jpg|png|webp)$/.test(name))) invalid('أدخل عنوانًا واختر من صورة إلى ٢٠ صورة.');
    const ref=db.doc('examBatches/'+data.batch);
    const paths=files.map(name=>'exam-images/'+uid+'/'+data.batch+'/'+name);
    await Promise.all(paths.map(async path=>{
      const object=bucket().file(path);
      let info;
      try { [info]=await object.getMetadata(); }
      catch(error){if(Number(error.code)===404)invalid('إحدى الصور لم يكتمل رفعها.');throw error;}
      if(images[info.contentType]!==path.split('.').pop()||Number(info.size)<1||Number(info.size)>10485760) invalid('صيغة إحدى الصور أو حجمها غير صالح.');
      const [head]=await object.download({start:0,end:11});
      const hex=head.toString('hex');
      const valid=info.contentType==='image/jpeg'?hex.startsWith('ffd8ff'):
        info.contentType==='image/png'?hex.startsWith('89504e470d0a1a0a'):
        hex.startsWith('52494646')&&hex.slice(16,24)==='57454250';
      if(!valid)invalid('إحدى الصور لا تطابق الصيغة المختارة.');
      if(info.metadata?.firebaseStorageDownloadTokens){
        await object.setMetadata({metadata:{firebaseStorageDownloadTokens:null}});
      }
    }));
    await db.runTransaction(async tx=>{
      const [subject,year,existing]=await tx.getAll(db.doc('subjects/'+data.subject),db.doc('years/'+data.year),ref);
      if(existing.exists){
        const old=existing.data();
        if(old.uploader!==uid||JSON.stringify(old.files)!==JSON.stringify(paths))throw new HttpsError('already-exists','هذه الدفعة موجودة.');
        return;
      }
      if(subject.data()?.active!==true||year.data()?.active!==true)invalid('اختر مادة وسنة مفعّلتين.');
      tx.create(ref,{title,subject:data.subject,year:data.year,term:data.term,kind:data.kind,files:paths,uploader:uid,createdAt:Timestamp.now()});
    });
    return {ok:true};
  }
  if(role!=='owner')throw new HttpsError('permission-denied','هذه العملية لصاحب الموقع فقط.');
  if(data.action==='invite'){
    const email=text(data.email,254).toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))invalid('أدخل بريدًا صالحًا للمساعد.');
    let user;
    try{user=await auth.createUser({email,password:randomBytes(32).toString('base64url')+'aA!3'});}
    catch(error){
      if(error.code!=='auth/email-already-exists')throw error;
      user=await auth.getUserByEmail(email);
      const record=(await db.doc('roles/'+user.uid).get()).data();
      if(record?.role!=='assistant'||!record.active)throw new HttpsError('already-exists','هذا البريد مرتبط بحساب آخر أو بحساب مساعد موقوف.');
      return {email};
    }
    try{await db.doc('roles/'+user.uid).create({role:'assistant',active:true,email});}
    catch(error){await auth.deleteUser(user.uid);throw error;}
    return {email};
  }
  const uid=text(data.uid,128);
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(uid))invalid('معرّف الحساب غير صالح.');
  const ref=db.doc('roles/'+uid);
  const subjectRole=(await ref.get()).data();
  if(!['student','assistant'].includes(subjectRole?.role))throw new HttpsError('not-found','الحساب غير موجود أو محمي.');
  if(data.action==='setActive'&&typeof data.active==='boolean'){
    if(!data.active)await ref.update({active:false});
    if(subjectRole.role==='assistant'&&subjectRole.email===undefined){
      const record=await auth.getUser(uid);
      if(record.email) await ref.update({email:record.email});
    }
    await auth.updateUser(uid,{disabled:!data.active});
    if(data.active)await ref.update({active:true});
    return {ok:true};
  }
  if(data.action==='deleteStudent'&&subjectRole.role==='student'){
    await ref.update({active:false});
    const student=db.doc('students/'+uid);
    try{await auth.deleteUser(uid);}catch(error){if(error.code!=='auth/user-not-found')throw error;}
    await Promise.all(['study','reminders'].map(name=>db.recursiveDelete(student.collection(name))));
    await db.runTransaction(async tx=>{
      const profile=await tx.get(student);
      const number=profile.data()?.number;
      if(number){
        const index=db.doc('studentNumbers/'+number);
        const reservation=await tx.get(index);
        if(reservation.data()?.uid===uid)tx.delete(index);
      }
      tx.delete(student);
      tx.delete(ref);
    });
    return {ok:true};
  }
  invalid('العملية غير متاحة.');
});
const escapeXml=value=>String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
async function activeStudent(request){
  if(!request.auth?.token.email_verified) throw new HttpsError('permission-denied','سجّل دخول الطالب أولًا.');
  const uid=request.auth.uid;
  const [role,profile]=await db.getAll(db.doc('roles/'+uid),db.doc('students/'+uid));
  if(role.data()?.role!=='student'||role.data()?.active!==true||!profile.exists)
    throw new HttpsError('permission-denied','هذا الحساب لا يستطيع فتح المكتبة.');
  return profile.data();
}
const push=require('./reminder-push.cjs').reminderPush({db});
exports.reminders=onCall({maxInstances:5},async request=>{
  await activeStudent(request);
  try{return await push.action(request.auth.uid,request.data??{});}
  catch(error){
    if(typeof error.code==='number')throw new HttpsError('internal','تعذّر حفظ إعدادات التنبيهات.');
    throw new HttpsError('invalid-argument',error.message);
  }
});
exports.library=onCall({memory:'512MiB',maxInstances:5,concurrency:8},async request=>{
  const profile=await activeStudent(request);
  const data=request.data??{};
  if(data.action==='list'){
    const [subjects,items]=await Promise.all([
      db.collection('subjects').where('active','==',true).get(),
      db.collection('examBatches').select('title','subject','year','term','kind','files','createdAt','views','sourceOrder').get()
    ]);
    const active=new Set(subjects.docs.map(doc=>doc.id));
    const exams=items.docs.flatMap(doc=>{
        const {title,subject,year,term,kind,files,createdAt,views,sourceOrder}=doc.data();
        if(!active.has(subject))return [];
        return [{id:doc.id,title,subject,year,term,kind,count:files.length,createdAt:createdAt.toMillis(),views:views??0,sourceOrder:sourceOrder??null}];
    });
    return {exams:exams.sort((a,b)=>a.sourceOrder!==null&&b.sourceOrder!==null?
      a.sourceOrder-b.sourceOrder:a.sourceOrder===null&&b.sourceOrder!==null?-1:
      b.sourceOrder===null&&a.sourceOrder!==null?1:b.createdAt-a.createdAt)};
  }
  if(data.action!=='image'||typeof data.id!=='string'||!uuid.test(data.id)||!Number.isInteger(data.index)||data.index<0)
    invalid('اختر صورة من الامتحان.');
  const exam=await scopedExam(data.id);
  const path=exam.files[data.index];
  if(!path)throw new HttpsError('not-found','الصورة غير موجودة.');
  const [original]=await bucket().file(path).download();
  const sharp=require('sharp');
  let decoded;
  try{
    decoded=await sharp(original,{limitInputPixels:40_000_000}).rotate()
      .resize({width:1800,height:2200,fit:'inside',withoutEnlargement:true})
      .flatten({background:'#fff'}).toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
  }catch{throw new HttpsError('failed-precondition','ملف الصورة تالف أو أبعاده أكبر من المسموح.');}
  const {data:scaled,info}=decoded;
  const {width,height}=info;
  const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs><pattern id="mark" width="480" height="190" patternUnits="userSpaceOnUse" patternTransform="rotate(-25)">
  <g text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="42" font-weight="bold" opacity=".21"
      fill="#16233a" stroke="#fff" stroke-width="1.2" paint-order="stroke">
  <text x="240" y="72" direction="rtl" font-size="${Math.min(42,Math.max(10,Math.floor(750/Array.from(profile.fullName).length)))}">${escapeXml(profile.fullName)}</text>
  <text x="240" y="119" direction="ltr">${escapeXml(profile.number)}</text></g>
  </pattern></defs><rect width="100%" height="100%" fill="url(#mark)"/></svg>`);
  const examRef=db.doc('examBatches/'+data.id);
  const seen=examRef.collection('uniqueViews').doc(request.auth.uid);
  const [marked]=await Promise.all([
    sharp(scaled,{raw:{width,height,channels:info.channels}}).composite([{input:svg}]).jpeg({quality:84}).toBuffer(),
    db.runTransaction(async tx=>{
    if((await tx.get(seen)).exists)return;
    tx.create(seen,{at:Timestamp.now()});
    tx.update(examRef,{views:FieldValue.increment(1)});
    })
  ]);
  return {type:'image/jpeg',content:marked.toString('base64')};
});
async function scopedExam(id){
  if(typeof id!=='string'||!uuid.test(id))invalid('اختر امتحانًا صالحًا.');
  const exam=(await db.doc('examBatches/'+id).get()).data();
  if(!exam||(await db.doc('subjects/'+exam.subject).get()).data()?.active!==true)
    throw new HttpsError('permission-denied','هذا الامتحان غير متاح لحسابك.');
  return exam;
}
const queueKinds=['requests','reports','messages','comments','summaries'];
function packed(snap){return snap.docs.map(d=>{
  const row=d.data();
  return {...row,id:d.id,createdAt:row.createdAt?.toMillis?.()??0};
});}
async function queueItem(collection,data){
  const ref=await db.collection(collection).add({...data,createdAt:Timestamp.now()});
  return {id:ref.id};
}
exports.community=onCall({memory:'256MiB',maxInstances:5},async request=>{
  const data=request.data??{}, uid=request.auth?.uid;
  if(['inbox','resolve','summaryUpload','summaryReview'].includes(data.action)){
    if(await staffRole(request)!=='owner')throw new HttpsError('permission-denied','هذه العملية لصاحب الموقع.');
    if(data.action==='inbox'){
      const [items,totals]=await Promise.all([
        Promise.all(queueKinds.map(k=>db.collection(k).orderBy('createdAt','desc').limit(100).get())),
        db.collection('requestTotals').orderBy('count','desc').limit(30).get()
      ]);
      return {queues:Object.fromEntries(queueKinds.map((k,i)=>[k,packed(items[i]).map(({path,...row})=>row)])),totals:packed(totals)};
    }
    if(data.action==='summaryUpload'){
      const title=text(data.title,140),subject=text(data.subject,80);
      const subjectDoc=/^[a-zA-Z0-9_-]{1,80}$/.test(subject)&&await db.doc('subjects/'+subject).get();
      if(!title||subjectDoc?.data()?.active!==true||typeof data.file!=='string'||data.file.length>7_000_000||!/^[a-zA-Z0-9+/]+={0,2}$/.test(data.file))
        invalid('أدخل عنوانًا واختر مادة نشطة وملف PDF حتى ٥ ميغابايت.');
      const file=Buffer.from(data.file,'base64');
      if(file.length>5*1024*1024||file.subarray(0,5).toString()!=='%PDF-')invalid('ملف PDF غير صالح.');
      const ref=db.collection('summaries').doc(), path='lecture-summaries/'+ref.id+'.pdf';
      const object=bucket().file(path);
      await object.save(file,{contentType:'application/pdf',resumable:false});
      try{await ref.create({title,subject,path,status:'draft',createdAt:Timestamp.now(),author:uid});}
      catch(error){await object.delete({ignoreNotFound:true});throw error;}
      return {ok:true};
    }
    const id=text(data.id,80);
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id))invalid('العنصر غير صالح.');
    if(data.action==='summaryReview'){
      if(!['draft','published'].includes(data.status))invalid('حالة الملخص غير صالحة.');
      await db.doc('summaries/'+id).update({status:data.status});
    }else{
      if(!['reports','messages','requests','comments'].includes(data.kind))invalid('التصنيف غير صالح.');
      const ref=db.doc(data.kind+'/'+id);
      if(data.kind==='comments')await ref.delete();
      else await ref.update({status:'resolved'});
    }
    return {ok:true};
  }
  const profile=await activeStudent(request);
  if(data.action==='summaries'){
    const sets=await Promise.all((profile.subjects??[]).map(async subject=>{
      if(!(await db.doc('subjects/'+subject).get()).data()?.active)return [];
      const rows=await db.collection('summaries').where('subject','==',subject).get();
      return packed(rows).filter(row=>row.status==='published').map(({id,title,subject,createdAt})=>({id,title,subject,createdAt}));
    }));
    return {items:sets.flat().sort((a,b)=>b.createdAt-a.createdAt)};
  }
  if(data.action==='summaryFile'){
    const id=text(data.id,80);
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id))invalid('الملخص غير صالح.');
    const row=(await db.doc('summaries/'+id).get()).data();
    if(row?.status!=='published'||!profile.subjects?.includes(row.subject)||!(await db.doc('subjects/'+row.subject).get()).data()?.active)
      throw new HttpsError('permission-denied','الملخص غير متاح لحسابك.');
    const [bytes]=await bucket().file(row.path).download();
    return {content:bytes.toString('base64')};
  }
  if(['discussion','comment','report'].includes(data.action)){
    const exam=await scopedExam(data.exam);
    if(!Number.isInteger(data.page)||data.page<0||data.page>=exam.files.length)invalid('اختر صفحة صالحة.');
    if(data.action==='discussion'){
      const rows=await db.collection('comments').where('scope','==',data.exam+'-'+data.page).limit(100).get();
      return {items:packed(rows).sort((a,b)=>a.createdAt-b.createdAt).map(({id,body,authorName,createdAt})=>({id,body,authorName,createdAt}))};
    }
    const body=text(data.body,1500);
    if(!body)invalid('اكتب نص الرسالة.');
    if(data.action==='comment')return queueItem('comments',{scope:data.exam+'-'+data.page,exam:data.exam,examTitle:exam.title,page:data.page,body,author:uid,authorName:profile.fullName});
    if(!['image','solution'].includes(data.kind))invalid('اختر نوع المشكلة.');
    return queueItem('reports',{exam:data.exam,examTitle:exam.title,page:data.page,kind:data.kind,body,author:uid,status:'new'});
  }
  if(data.action==='contact'){
    const title=text(data.title,120),body=text(data.body,1500);
    if(!title||!body)invalid('أدخل عنوان الرسالة ونصها.');
    return queueItem('messages',{title,body,author:uid,authorName:profile.fullName,replyEmail:profile.email,status:'new'});
  }
  if(data.action==='request'){
    const title=text(data.title,120).replace(/\s+/g,' '), year=text(data.year,4);
    if(!title||(year&&!/^(19|20)\d{2}$/.test(year)))invalid('اكتب اسم المادة وسنة صحيحة عند الحاجة.');
    const key=createHash('sha256').update(title.normalize('NFKC').toLowerCase()+'|'+year).digest('hex');
    const ref=db.doc('requests/'+createHash('sha256').update(uid+'|'+key).digest('hex'));
    const total=db.doc('requestTotals/'+key);
    await db.runTransaction(async tx=>{
      if((await tx.get(ref)).exists)throw new HttpsError('already-exists','أرسلت هذا الطلب من قبل.');
      tx.create(ref,{title,year,author:uid,status:'new',createdAt:Timestamp.now()});
      tx.set(total,{title,year,count:FieldValue.increment(1)},{merge:true});
    });
    return {ok:true};
  }
  invalid('العملية غير متاحة.');
});
