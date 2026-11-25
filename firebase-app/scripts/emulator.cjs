const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const fromFunctions=createRequire(require.resolve('../functions/package.json'));
const {initializeApp}=fromFunctions('firebase-admin/app');
const {getAuth}=fromFunctions('firebase-admin/auth');
const {getFirestore}=fromFunctions('firebase-admin/firestore');
const projectId='demo-archive-phase';
if(!process.env.FIREBASE_AUTH_EMULATOR_HOST||!process.env.FIRESTORE_EMULATOR_HOST){
  throw new Error('Run this command through the Firebase emulators.');
}
initializeApp({projectId});
const db=getFirestore(), admin=getAuth();
const authBase='http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST;
const functionURL='http://127.0.0.1:5001/'+projectId+'/us-central1/accounts';
const firestoreURL='http://'+process.env.FIRESTORE_EMULATOR_HOST+'/v1/projects/'+projectId+'/databases/(default)/documents/';
const testPassword='Archive!Demo27';
async function call(action,data={},token,service='accounts'){
  const response=await fetch(functionURL.replace(/accounts$/,service),{method:'POST',headers:{
    'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})
  },body:JSON.stringify({data:{action,...data}})});
  return {status:response.status,...await response.json()};
}
async function identity(action,body) {
  const response=await fetch(authBase+'/identitytoolkit.googleapis.com/v1/accounts:'+action+'?key=demo-key',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
  });
  const data=await response.json();
  assert.equal(response.status,200,JSON.stringify(data));
  return data;
}
async function staff(role) {
  const email=role+'@archive.example.com';
  let user;
  try{user=await admin.getUserByEmail(email);}
  catch(error){if(error.code!=='auth/user-not-found')throw error;user=await admin.createUser({email,password:testPassword,emailVerified:true});}
  await db.doc('roles/'+user.uid).set({role,active:true,email});
  return user;
}
async function seed() {
  await Promise.all([
    db.doc('subjects/maths').set({name:'رياضيات — مادة تجريبية',active:true}),
    db.doc('subjects/biology').set({name:'أحياء — مادة تجريبية',active:true}),
    db.doc('subjects/inactive').set({name:'مادة غير منشورة',active:false}),
    db.doc('years/2026').set({active:true}),
    staff('owner'),staff('assistant')
  ]);
}
async function seedStudyPreview(){
  const {getStorage}=fromFunctions('firebase-admin/storage');
  const sharp=fromFunctions('sharp');
  const number='7000000001',email=number+'@ses.yu.edu.jo';
  let user;
  try{user=await admin.getUserByEmail(email);}
  catch(error){if(error.code!=='auth/user-not-found')throw error;user=await admin.createUser({email,password:testPassword,emailVerified:true});}
  const owner=await admin.getUserByEmail('owner@archive.example.com');
  const batch='6ee888a4-5f00-47a8-8143-afbcec6885a2';
  const bucket=getStorage().bucket(projectId+'.appspot.com');
  const paths=[1,2].map(i=>'exam-images/'+owner.uid+'/'+batch+'/589dbe10-045b-4d4c-b104-0d9bc152555'+i+'.png');
  await Promise.all(paths.map((path,i)=>sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="920" height="1100"><rect width="920" height="1100" fill="white"/><rect x="70" y="70" width="780" height="110" rx="12" fill="#eee8f8"/><text x="105" y="135" font-family="sans-serif" font-size="36" fill="#312745">DEMO EXAM — PAGE '+(i+1)+'</text><path d="M100 280h710 M100 365h600 M100 510h710 M100 595h600 M100 740h710 M100 825h600" stroke="#615777" stroke-width="5"/></svg>'))
    .png().toBuffer().then(bytes=>bucket.file(path).save(bytes,{contentType:'image/png'}))));
  const transaction=db.batch();
  transaction.set(db.doc('roles/'+user.uid),{role:'student',active:true});
  transaction.set(db.doc('students/'+user.uid),{number,email,fullName:'طالب تجريبي',subjects:['maths']});
  transaction.set(db.doc('studentNumbers/'+number),{email,uid:user.uid});
  transaction.set(db.doc('examBatches/'+batch),{title:'امتحان تجريبي للمعاينة',subject:'maths',year:'2026',term:'first',kind:'mid',files:paths,uploader:owner.uid,createdAt:new Date()});
  await transaction.commit();
}
async function firestore(path,token,method='GET'){
  return fetch(firestoreURL+path,{method,headers:token?{Authorization:'Bearer '+token}:{}});
}
async function verify(){
  const suffix=String(Date.now());
  const p={number:suffix,fullName:'طالب تجريبي',email:suffix+'@ses.yu.edu.jo',gender:'undisclosed',birth:'2002-02-22',password:testPassword,confirm:testPassword,subjects:['maths']};
  assert.equal((await call('register',{...p,email:'student@example.com'})).status,400);
  assert.equal((await call('register',{...p,email:'student@ses.yu.edu.jo.example.com'})).status,400);
  assert.equal((await call('register',{...p,email:'123@ses.yu.edu.jo'})).status,400);
  assert.equal((await call('register',{...p,password:'weak'})).status,400);
  assert.equal((await call('register',{...p,subjects:['inactive']})).status,400);
  const registered=await call('register',p);
  assert.equal(registered.status,200,JSON.stringify(registered));
  const unverified=await identity('signInWithCustomToken',{token:registered.result.token,returnSecureToken:true});
  assert.equal((await call('finish',{},unverified.idToken)).status,403);
  await identity('sendOobCode',{requestType:'VERIFY_EMAIL',idToken:unverified.idToken});
  const codes=await (await fetch(authBase+'/emulator/v1/projects/'+projectId+'/oobCodes')).json();
  const code=codes.oobCodes.find(item=>item.email===p.email&&item.requestType==='VERIFY_EMAIL');
  assert.ok(code?.oobCode);
  await identity('update',{oobCode:code.oobCode});
  const verified=await identity('signInWithPassword',{email:p.email,password:p.password,returnSecureToken:true});
  assert.equal((await call('finish',{},verified.idToken)).status,200);
  assert.equal((await call('register',p)).status,409);
  assert.equal((await call('login',{number:suffix,password:'wrong'})).status,401);
  const result=await call('login',{number:suffix,password:p.password});
  assert.equal(result.status,200,JSON.stringify(result));
  const student=await identity('signInWithCustomToken',{token:result.result.token,returnSecureToken:true});
  const claims=JSON.parse(Buffer.from(student.idToken.split('.')[1],'base64url').toString('utf8'));
  assert.equal(claims.email_verified,true);
  const studentId=claims.sub;
  const [owner,assistant]=await Promise.all(['owner','assistant'].map(role=>identity('signInWithPassword',{email:role+'@archive.example.com',password:testPassword,returnSecureToken:true})));
  assert.equal((await firestore('students/'+studentId,student.idToken)).status,200);
  assert.equal((await firestore('students/'+studentId,owner.idToken)).status,200);
  assert.equal((await firestore('students/'+studentId,assistant.idToken)).status,403);
  assert.equal((await firestore('students/'+studentId)).status,403);
  assert.equal((await firestore('studentNumbers/'+suffix,student.idToken)).status,403);
  assert.equal((await firestore('roles/'+studentId,student.idToken,'DELETE')).status,403);
  assert.equal((await firestore('subjects/inactive',student.idToken)).status,403);
  assert.equal((await firestore('subjects/inactive',assistant.idToken)).status,200);
  if(process.env.FIREBASE_STORAGE_EMULATOR_HOST){
    const {getStorage}=fromFunctions('firebase-admin/storage');
    const bucket=projectId+'.appspot.com';
    await getStorage().bucket(bucket).file('private/check.txt').save('local fixture');
    const url='http://'+process.env.FIREBASE_STORAGE_EMULATOR_HOST+'/v0/b/'+bucket+'/o/private%2Fcheck.txt?alt=media';
    assert.ok([401,403].includes((await fetch(url)).status));
    assert.equal((await fetch(url,{headers:{Authorization:'Firebase '+student.idToken}})).status,403);
    const {randomUUID}=require('node:crypto');
    const batch=randomUUID(), names=[randomUUID()+'.png',randomUUID()+'.png'];
    const storageRoot='http://'+process.env.FIREBASE_STORAGE_EMULATOR_HOST+'/v0/b/'+bucket+'/o';
    const sharp=fromFunctions('sharp');
    const image=await sharp({create:{width:80,height:100,channels:3,background:'#ffffff'}}).png().toBuffer();
    const path=name=>'exam-images/'+assistant.localId+'/'+batch+'/'+name;
    const upload=(token,name)=>fetch(storageRoot+'?name='+encodeURIComponent(path(name)),{method:'POST',headers:{
      Authorization:'Firebase '+token,'Content-Type':'image/png'
    },body:image});
    assert.equal((await upload(student.idToken,names[0])).status,403);
    for(const name of names){
      const result=await upload(assistant.idToken,name);
      assert.equal(result.status,200,await result.text());
    }
    const management=(action,data,token)=>call(action,data,token,'management');
    const batchResult=await management('publish',{batch,files:names,title:'اختبار محلي',subject:'maths',year:'2026',kind:'mid',term:'first'},assistant.idToken);
    assert.equal(batchResult.status,200,JSON.stringify(batchResult));
    assert.equal((await firestore('examBatches/'+batch,student.idToken)).status,403);
    assert.equal((await firestore('examBatches/'+batch,assistant.idToken)).status,200);
    const library=(action,data,token)=>call(action,data,token,'library');
    const listed=await library('list',{},student.idToken);
    assert.ok(listed.result.exams.some(exam=>exam.id===batch&&!exam.files));
    const marked=await library('image',{id:batch,index:0},student.idToken);
    assert.equal(marked.status,200,JSON.stringify(marked).slice(0,250));
    assert.equal(marked.result.type,'image/jpeg');
    const bytes=Buffer.from(marked.result.content,'base64');
    const analysis=await sharp(bytes).stats();
    assert.ok(analysis.channels[0].stdev>1,'Watermark should produce visible pixels on the flat fixture');
    assert.equal((await library('image',{id:batch,index:1},student.idToken)).status,200);
    assert.equal((await library('list',{},student.idToken)).result.exams.find(exam=>exam.id===batch).views,1);
    assert.equal((await library('image',{id:batch,index:0},assistant.idToken)).status,403);
    const other=randomUUID();
    await db.doc('examBatches/'+other).set({...((await db.doc('examBatches/'+batch).get()).data()),subject:'biology'});
    assert.equal((await library('image',{id:other,index:0},student.idToken)).status,403);
    assert.ok(!(await library('list',{},student.idToken)).result.exams.some(exam=>exam.id===other));
    const studyURL=firestoreURL+'students/'+studentId+'/study/'+batch+'-0';
    const note=await fetch(studyURL,{method:'PATCH',headers:{Authorization:'Bearer '+student.idToken,'Content-Type':'application/json'},
      body:JSON.stringify({fields:{note:{stringValue:'ملاحظة محلية'}}})});
    assert.equal(note.status,200,await note.text());
    assert.equal((await firestore('students/'+studentId+'/study/'+batch+'-0',owner.idToken)).status,403);
    assert.equal((await firestore('students/'+studentId+'/study/'+batch+'-0',assistant.idToken)).status,403);
    const community=(action,data,token)=>call(action,data,token,'community');
    const reminderURL=firestoreURL+'students/'+studentId+'/reminders';
    const createReminder=await fetch(reminderURL,{method:'POST',headers:{Authorization:'Bearer '+student.idToken,'Content-Type':'application/json'},
      body:JSON.stringify({fields:{title:{stringValue:'كويز محلي'},at:{integerValue:String(Date.now()+900000)},lead:{integerValue:'15'}}})});
    assert.equal(createReminder.status,200,await createReminder.text());
    assert.equal((await firestore('students/'+studentId+'/reminders',owner.idToken)).status,403);
    const post=await community('comment',{exam:batch,page:0,body:'حل تجريبي'},student.idToken);
    assert.equal(post.status,200,JSON.stringify(post));
    assert.equal((await community('discussion',{exam:batch,page:0},student.idToken)).result.items.length,1);
    assert.equal((await community('discussion',{exam:batch,page:1},student.idToken)).result.items.length,0);
    assert.equal((await community('comment',{exam:other,page:0,body:'غير مسموح'},student.idToken)).status,403);
    assert.equal((await community('report',{exam:batch,page:0,kind:'solution',body:'بلاغ محلي'},student.idToken)).status,200);
    assert.equal((await community('request',{title:'مادة جديدة '+suffix,year:'2024'},student.idToken)).status,200);
    assert.equal((await community('request',{title:'مادة جديدة '+suffix,year:'2024'},student.idToken)).status,409);
    assert.equal((await community('contact',{title:'اقتراح',body:'رسالة محلية'},student.idToken)).status,200);
    assert.equal((await community('inbox',{},assistant.idToken)).status,403);
    const uploadSummary=await community('summaryUpload',{title:'ملخص محلي',subject:'maths',file:Buffer.from('%PDF-1.4\n%%EOF').toString('base64')},owner.idToken);
    assert.equal(uploadSummary.status,200,JSON.stringify(uploadSummary));
    const inbox=await community('inbox',{},owner.idToken);
    assert.equal(inbox.status,200,JSON.stringify(inbox));
    assert.ok(inbox.result.queues.reports.some(item=>item.exam===batch));
    assert.ok(inbox.result.queues.messages.some(item=>item.body==='رسالة محلية'));
    assert.ok(inbox.result.totals.some(item=>item.title==='مادة جديدة '+suffix&&item.count===1));
    const summaryId=inbox.result.queues.summaries[0].id;
    assert.equal((await community('summaryFile',{id:summaryId},student.idToken)).status,403);
    assert.equal((await community('summaryReview',{id:summaryId,status:'published'},owner.idToken)).status,200);
    assert.ok((await community('summaries',{},student.idToken)).result.items.some(item=>item.id===summaryId));
    assert.equal((await community('summaryFile',{id:summaryId},student.idToken)).status,200);
    assert.equal((await community('resolve',{kind:'comments',id:post.result.id},owner.idToken)).status,200);
    assert.equal((await community('discussion',{exam:batch,page:0},student.idToken)).result.items.length,0);
    console.log('Passed reminders, scoped discussions and moderation, reports, ranked requests, contact, private summaries and unique views.');
    assert.equal((await management('setActive',{uid:studentId,active:false},assistant.idToken)).status,403);
    assert.equal((await management('setActive',{uid:studentId,active:false},owner.idToken)).status,200);
    assert.equal((await firestore('students/'+studentId,student.idToken)).status,403);
    assert.equal((await management('setActive',{uid:studentId,active:true},owner.idToken)).status,200);
    assert.equal((await management('invite',{email:'helper-'+suffix+'@archive.example.com'},owner.idToken)).status,200);
    console.log('Passed private batch upload, assistant permissions, student activation and assistant invitation.');
  }
  await identity('sendOobCode',{requestType:'PASSWORD_RESET',email:p.email});
  const reset=await (await fetch(authBase+'/emulator/v1/projects/'+projectId+'/oobCodes')).json();
  const resetCode=reset.oobCodes.find(item=>item.email===p.email&&item.requestType==='PASSWORD_RESET');
  assert.ok(resetCode?.oobCode);
  await identity('resetPassword',{oobCode:resetCode.oobCode,newPassword:'Archive!New27'});
  assert.equal((await call('login',{number:suffix,password:p.password})).status,401);
  assert.equal((await call('login',{number:suffix,password:'Archive!New27'})).status,200);
  console.log('Passed Firebase registration, verification, number login, password reset and Firestore access rules.');
}
async function run() {
  await seed();
  if(process.argv.includes('--verify')) return verify();
  console.log('Demo subjects, owner and assistant are ready.');
  if(process.argv.includes('--preview')){
    await seedStudyPreview();
    console.log('Open http://127.0.0.1:5000 in your browser. Press Enter here to stop.');
    await new Promise(resolve=>{process.stdin.resume();process.stdin.once('data',resolve);});
  }
}
run().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});

