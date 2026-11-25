import {addDoc,collection,doc,setDoc,updateDoc,getDocs,query,where} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import {ref,uploadBytes} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js';
import {sendPasswordResetEmail} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {encodeFile} from '/community.js';
const types={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
const kinds={mid:'ميد',final:'فاينل',quiz:'كويز',makeup:'ميك أب'};
const terms={first:'الأول',second:'الثاني',summer:'الصيفي'};
const size=10*1024*1024;
export async function adminWorkspace({main,role,user,db,auth,storage,manage,community,node,field,message,submit}){
  const owner=role==='owner';
  const report=message(main);
  const nav=node('nav','',{'aria-label':'أقسام الإدارة'});
  main.append(nav);
  const section=node('div');
  main.append(section);
  const list=async name=>(await getDocs(collection(db,name))).docs.map(item=>({id:item.id,...item.data()}));
  const button=(label,run)=>{
    const b=node('button',label,{type:'button'});
    b.onclick=async()=>{b.disabled=true;report('');try{await run();}catch(error){report(error.message,true);}finally{b.disabled=false;}};
    return b;
  };
  const row=(name,...controls)=>{
    const item=node('div','',{class:'admin-row'});
    item.append(node('span',name),...controls);
    return item;
  };
  const select=(form,label,name,options)=>{
    const wrap=node('label',label), input=node('select','',{name,required:''});
    input.append(node('option','اختر',{value:''}));
    for(const [value,label] of options)input.append(node('option',label,{value}));
    wrap.append(input);form.append(wrap);
  };
  function card(title){
    const box=node('section','',{class:'admin-card'});
    box.append(node('h2',title));section.append(box);return box;
  }
  async function upload(){
    const box=card('رفع صور امتحان'),form=node('form');
    const [subjects,years]=await Promise.all([list('subjects'),list('years')]);
    field(form,'عنوان الامتحان','title',{maxlength:160});
    select(form,'المادة','subject',subjects.filter(s=>s.active).map(s=>[s.id,s.name]));
    select(form,'السنة','year',years.filter(y=>y.active).map(y=>[y.id,y.id]).sort().reverse());
    select(form,'الفصل','term',Object.entries(terms));
    select(form,'نوع الامتحان','kind',Object.entries(kinds));
    const input=field(form,'الصور بالترتيب المطلوب','images',{type:'file',multiple:'',accept:'image/jpeg,image/png,image/webp'});
    form.append(node('p','حتى ٢٠ صورة في الدفعة، و١٠ ميغابايت لكل صورة.',{class:'muted'}));
    if(!subjects.some(s=>s.active)||!years.some(y=>y.active))box.append(node('p','يجب تفعيل مادة وسنة أولًا.',{class:'muted'}));
    let pending;
    const progress=node('p','',{role:'status','aria-live':'polite',class:'muted'});
    input.onchange=()=>{pending=undefined;progress.textContent=Array.from(input.files,f=>f.name).join('، ');};
    submit(form,'رفع وحفظ الدفعة',async metadata=>{
      const files=Array.from(input.files);
      if(!files.length||files.length>20||files.some(file=>!types[file.type]||file.size<1||file.size>size)){
        report('اختر من صورة إلى ٢٠ صورة بصيغة JPG أو PNG أو WebP، بحجم لا يتجاوز ١٠ ميغابايت لكل صورة.',true);return;
      }
      pending??={batch:crypto.randomUUID(),names:files.map(file=>crypto.randomUUID()+'.'+types[file.type]),done:0};
      input.disabled=true;
      try {
        while(pending.done<files.length){
          const index=pending.done;
          progress.textContent='جارٍ رفع '+(index+1)+' من '+files.length+'…';
          if(storage)await uploadBytes(ref(storage,'exam-images/'+user.uid+'/'+pending.batch+'/'+pending.names[index]),files[index],{contentType:files[index].type});
          else await manage({action:'uploadImage',batch:pending.batch,name:pending.names[index],type:files[index].type,content:await encodeFile(files[index])});
          pending.done++;
        }
        const {images,...classification}=metadata;
        await manage({action:'publish',...classification,batch:pending.batch,files:pending.names});
        pending=undefined;form.reset();progress.textContent='';
        await show('upload','تم حفظ دفعة الصور.');
      } finally {input.disabled=false;}
    },report);
    box.append(form,progress);
    const batches=owner?collection(db,'examBatches'):query(collection(db,'examBatches'),where('uploader','==',user.uid));
    const history=card('الدفعات المسجلة');
    const records=(await getDocs(batches)).docs.map(item=>item.data()).sort((a,b)=>b.createdAt.toMillis()-a.createdAt.toMillis());
    if(!records.length)history.append(node('p','لا توجد دفعات بعد.'));
    for(const item of records)history.append(row([item.title,subjects.find(x=>x.id===item.subject)?.name,item.year,terms[item.term],kinds[item.kind],item.files.length+' صورة'].filter(Boolean).join(' · ')));
  }
  async function catalog(){
    const [subjects,years]=await Promise.all([list('subjects'),list('years')]);
    const subjectsBox=card('المواد'),form=node('form');
    const input=field(form,'اسم المادة','name',{maxlength:120});
    const save=node('button','إضافة المادة',{type:'submit',class:'primary'});
    let selected;
    form.append(save);
    form.onsubmit=async event=>{
      event.preventDefault();save.disabled=true;
      try{
        const name=input.value.trim();
        if(!name){report('أدخل اسم المادة.',true);return;}
        if(subjects.some(item=>item.name===name&&item.id!==selected?.id)){report('هذا الاسم موجود.',true);return;}
        if(selected)await updateDoc(doc(db,'subjects',selected.id),{name});
        else await addDoc(collection(db,'subjects'),{name,active:true});
        await show('catalog','تم حفظ المادة.');
      }catch(error){report(error.message,true);}finally{save.disabled=false;}
    };
    subjectsBox.append(form);
    for(const item of subjects){
      subjectsBox.append(row(item.name+(item.active?'':' · مؤرشفة'),button('تعديل الاسم',async()=>{
        input.value=item.name;selected=item;save.textContent='حفظ الاسم';input.focus();
      }),button(item.active?'أرشفة':'تفعيل',async()=>{
        await updateDoc(doc(db,'subjects',item.id),{active:!item.active});await show('catalog','تم تحديث حالة المادة.');
      })));
    }
    const yearsBox=card('السنوات'),yearsForm=node('form');
    field(yearsForm,'السنة','year',{inputmode:'numeric',pattern:'20[0-9]{2}',placeholder:'2026'});
    submit(yearsForm,'إضافة سنة',async({year})=>{
      if(years.some(item=>item.id===year)){report('السنة موجودة بالفعل.',true);return;}
      await setDoc(doc(db,'years',year),{active:true});await show('catalog','تم حفظ السنة.');
    },report);
    yearsBox.append(yearsForm);
    for(const item of years.sort((a,b)=>b.id.localeCompare(a.id)))yearsBox.append(row(item.id+(item.active?'':' · مؤرشفة'),button(item.active?'أرشفة':'تفعيل',async()=>{
      await updateDoc(doc(db,'years',item.id),{active:!item.active});await show('catalog','تم تحديث حالة السنة.');
    })));
  }
  async function accounts(assistants){
    const key=assistants?'assistants':'students';
    const box=card(assistants?'المساعدون':'الطلاب');
    const roles=await list('roles');
    if(assistants){
      const form=node('form');
      field(form,'بريد المساعد','email',{type:'email',maxlength:254,dir:'ltr'});
      submit(form,'إرسال دعوة',async({email})=>{
        const invite=await manage({action:'invite',email});
        await sendPasswordResetEmail(auth,invite.email);
        await show(key,'تم طلب إرسال رابط تعيين كلمة المرور. يُفعّل المساعد بريده عند أول دخول.');
      },report);
      box.append(form);
    }
    const records=assistants?roles.filter(item=>item.role==='assistant'):await list('students');
    const search=node('input','',{type:'search',placeholder:assistants?'ابحث بالبريد':'ابحث بالاسم أو الرقم أو البريد','aria-label':assistants?'ابحث عن مساعد':'ابحث عن طالب'});
    const results=node('div'), empty=node('p','لا توجد نتائج.');
    box.append(search,results,empty);
    function render(){
      const term=search.value.trim().toLowerCase();
      results.replaceChildren();
      for(const item of records){
        const record=roles.find(r=>r.id===item.id);
        const label=[item.fullName,item.number,item.email].filter(Boolean).join(' · ')||item.id;
        if(!label.toLowerCase().includes(term))continue;
        const controls=[button(record?.active?'إيقاف':'تفعيل',async()=>{
          await manage({action:'setActive',uid:item.id,active:!record?.active});
          await show(key,'تم تحديث حالة الحساب.');
        })];
        if(!assistants)controls.push(button('حذف',async()=>{
          if(!window.confirm('حذف حساب الطالب نهائيًا؟'))return;
          await manage({action:'deleteStudent',uid:item.id});
          await show(key,'تم حذف حساب الطالب.');
        }));
        results.append(row(label+(record?.active?' · مفعّل':' · موقوف'),...controls));
      }
      empty.hidden=Boolean(results.childElementCount);
    }
    search.oninput=render;render();
  }
  async function review(){
    const [inbox,subjects]=await Promise.all([community({action:'inbox'}),list('subjects')]);
    const summary=card('ملخصات المحاضرات'),form=node('form');
    field(form,'عنوان الملخص','title',{maxlength:140});
    select(form,'المادة','subject',subjects.filter(s=>s.active).map(s=>[s.id,s.name]));
    field(form,'ملف PDF','file',{type:'file',accept:'application/pdf,.pdf'});
    submit(form,'حفظ كمسودة',async data=>{
      if(!(data.file instanceof File)||!data.file.size||data.file.size>5*1024*1024)throw new Error('اختر ملف PDF حتى ٥ ميغابايت.');
      await community({action:'summaryUpload',title:data.title,subject:data.subject,file:await encodeFile(data.file)});
      await show('review','تم رفع الملخص كمسودة.');
    },report);
    summary.append(form);
    for(const item of inbox.queues.summaries){
      summary.append(row(item.title+' · '+(item.status==='published'?'منشور':'مسودة'),button(item.status==='published'?'إلغاء النشر':'نشر',async()=>{
        await community({action:'summaryReview',id:item.id,status:item.status==='published'?'draft':'published'});
        await show('review','تم تحديث حالة الملخص.');
      })));
    }
    const totals=card('الأكثر طلبًا');
    if(!inbox.totals.length)totals.append(node('p','لا توجد طلبات بعد.'));
    for(const item of inbox.totals)totals.append(row([item.title,item.year,item.count+' طلب'].filter(Boolean).join(' · ')));
    for(const [kind,title] of [['reports','البلاغات'],['messages','الرسائل'],['requests','طلبات المواد والسنوات'],['comments','الحلول والتعليقات']]){
      const box=card(title);
      if(!inbox.queues[kind].length)box.append(node('p','لا توجد عناصر بعد.'));
      for(const item of inbox.queues[kind]){
        const label=[item.title||item.examTitle,item.page===undefined?'':'صورة '+(item.page+1),
          item.kind==='solution'?'خطأ في الحل':item.kind==='image'?'خطأ في الصورة':'',item.year,item.authorName,item.replyEmail,item.body,
          item.status==='resolved'?'تمت المراجعة':''].filter(Boolean).join(' · ');
        const controls=[];
        if(item.status!=='resolved')controls.push(button(kind==='comments'?'حذف التعليق':'تمت المراجعة',async()=>{
          if(kind==='comments'&&!window.confirm('حذف التعليق؟'))return;
          await community({action:'resolve',kind,id:item.id});
          await show('review','تم تحديث القائمة.');
        }));
        box.append(row(label,...controls));
      }
    }
  }
  const pages={upload:['رفع الصور',upload]};
  if(owner)Object.assign(pages,{catalog:['المواد والسنوات',catalog],students:['الطلاب',()=>accounts(false)],assistants:['المساعدون',()=>accounts(true)],review:['المراجعة والملخصات',review]});
  async function show(key,notice=''){
    nav.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.page===key)));
    section.replaceChildren();
    try{await pages[key][1]();if(notice)report(notice);}
    catch(error){report(error.message,true);}
  }
  for(const [key,[title]] of Object.entries(pages)){
    const tab=button(title,()=>show(key));tab.dataset.page=key;nav.append(tab);
  }
  await show('upload');
}
