import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,connectAuthEmulator,onAuthStateChanged,signInWithEmailAndPassword,signInWithCustomToken,sendEmailVerification,sendPasswordResetEmail,signOut} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {getFirestore,connectFirestoreEmulator,collection,query,where,getDocs,doc,getDoc} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import {getFunctions,connectFunctionsEmulator,httpsCallable} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js';
import {getStorage,connectStorageEmulator} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js';
import {production} from '/config.js';
import {adminWorkspace} from '/admin.js';
import {studyWorkspace} from '/study.js';
const local=['localhost','127.0.0.1'].includes(location.hostname);
const main=document.querySelector('#main'), theme=document.querySelector('#theme');
const pref=matchMedia('(prefers-color-scheme: dark)');
function setTheme(mode){document.documentElement.dataset.theme=mode;theme.textContent=mode==='dark'?'الوضع الفاتح':'الوضع الداكن';}
setTheme(localStorage.getItem('archive-theme')||(pref.matches?'dark':'light'));
theme.onclick=()=>{const mode=document.documentElement.dataset.theme==='dark'?'light':'dark';localStorage.setItem('archive-theme',mode);setTheme(mode);};

const app=local||production?initializeApp(local?{projectId:'demo-archive-phase',apiKey:'demo-key',authDomain:'localhost',storageBucket:'demo-archive-phase.appspot.com'}:production):null;
const auth=app&&getAuth(app), db=app&&getFirestore(app);
const functions=app&&getFunctions(app,local?'us-central1':location.origin+'/api');
const storage=local&&getStorage(app);
if(local){
  connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
  connectFirestoreEmulator(db,'127.0.0.1',8080);
  connectFunctionsEmulator(functions,'127.0.0.1',5001);
  connectStorageEmulator(storage,'127.0.0.1',9199);
}
const account=async data=>(await httpsCallable(functions,'accounts')(data)).data;
const route=location.pathname.replace(/\/$/,'')||'/';
function node(tag,text,props={}){const n=document.createElement(tag);if(text)n.textContent=text;for(const [k,v] of Object.entries(props))n.setAttribute(k,v);return n;}
const link=(label,href)=>node('a',label,{href});
function field(form,label,name,attrs={}){
  const wrap=node('label',label),input=node('input','',{name,required:'',...attrs});
  wrap.append(input);form.append(wrap);return input;
}
const emailAttrs={type:'email',autocomplete:'email',dir:'ltr',maxlength:254};
const universityEmailAttrs={...emailAttrs,placeholder:'5837194062@ses.yu.edu.jo',pattern:'[0-9]{1,20}@[sS][eE][sS]\\.[yY][uU]\\.[eE][dD][uU]\\.[jJ][oO]'};
function universityEmailField(form){
  const input=field(form,'البريد الجامعي','email',{...universityEmailAttrs,'aria-describedby':'university-email-hint'});
  input.parentElement.append(node('small','اكتب رقمك الجامعي متبوعًا بـ @ses.yu.edu.jo',{id:'university-email-hint',class:'muted'}));
  input.addEventListener('input',()=>input.setCustomValidity(''));
  input.addEventListener('invalid',()=>{
    if(input.value)input.setCustomValidity('اكتب رقمك الجامعي قبل @ses.yu.edu.jo.');
  });
}
const passAttrs={type:'password',dir:'ltr',maxlength:128};
const numAttrs={inputmode:'numeric',autocomplete:'username',dir:'ltr',maxlength:20};
function formFrame(title,description){
  main.replaceChildren(document.querySelector('#frame').content.cloneNode(true));
  main.querySelector(route==='/staff'?'nav a:last-child':'nav a:first-child').setAttribute('aria-current','page');
  const body=main.querySelector('#body');
  body.append(node('h1',title),node('p',description,{class:'muted'}));
  document.title=title+' | أرشيف السنوات';
  return body;
}
function message(parent){
  const status=node('p','',{class:'status',role:'status','aria-live':'polite'});
  parent.append(status);
  return (text,error=false)=>{status.textContent=text;status.dataset.error=String(error);};
}
function explain(error){
  if(error?.code?.startsWith('functions/')&&!['functions/internal','functions/unknown','functions/unavailable'].includes(error.code)) return error.message;
  if(error?.code==='auth/too-many-requests')return 'محاولات كثيرة. جرّب بعد قليل.';
  if(error?.code?.startsWith('auth/'))return 'تعذّر إكمال الطلب. تحقّق من بياناتك وحاول مرة أخرى.';
  return 'تعذّر الاتصال بالخدمة. جرّب مرة أخرى.';
}
function submit(form,label,run,report){
  const button=node('button',label,{class:'primary',type:'submit'});form.append(button);
  form.onsubmit=async event=>{
    event.preventDefault();
    if(!app){report('هذه معاينة للتصميم. يلزم ربط Firebase لتشغيل الحسابات.',true);return;}
    button.disabled=true;report('');
    try{await run(Object.fromEntries(new FormData(form)));}
    catch(error){report(explain(error),true);}
    finally{button.disabled=false;}
  };
}
function appendLinks(body,...items){const p=node('div','',{class:'links'});p.append(...items);body.append(p);}
function login(staff=false,activate=false){
  const body=formFrame(staff?'دخول صاحب الموقع والمساعدين':activate?'متابعة تفعيل الحساب':'دخول الطالب',
    staff?'استخدم البريد الإلكتروني المخصص لحساب الإدارة.':activate?'أدخل بريد التسجيل وكلمة المرور لمتابعة التفعيل.':'استخدم بريدك الجامعي وكلمة المرور للوصول إلى موادك.');
  const report=message(body), form=node('form');
  if(staff) field(form,'البريد الإلكتروني','email',emailAttrs);
  else universityEmailField(form);
  field(form,'كلمة المرور','password',{...passAttrs,autocomplete:'current-password'});
  submit(form,'تسجيل الدخول',async data=>{
    const credential=await signInWithEmailAndPassword(auth,data.email,data.password);
    if(activate){location.assign('/verify');return;}
    if(staff&&!credential.user.emailVerified){
      try{await sendEmailVerification(credential.user);report('تم طلب إرسال رابط التفعيل. افتحه ثم سجّل الدخول مجددًا.');}
      finally{await signOut(auth);}
      return;
    }
    const role=(await getDoc(doc(db,'roles',credential.user.uid))).data();
    if(!role?.active||!(staff?['owner','assistant'].includes(role.role):role.role==='student')){
      await signOut(auth);report('هذا الحساب لا يملك صلاحية الدخول من هذه الصفحة.',true);return;
    }
    location.assign(staff?'/workspace':'/library');
  },report);
  body.append(form);
  appendLinks(body,link('نسيت كلمة المرور؟','/reset'),...(staff?[]:[link('إنشاء حساب طالب','/register'),link('متابعة التفعيل','/activate')]));
}
const checks=[
  ['٨ أحرف على الأقل',value=>value.length>=8],
  ['حرف إنجليزي كبير',value=>/[A-Z]/.test(value)],
  ['رقم',value=>/\p{Nd}/u.test(value)],
  ['رمز مثل @ أو $',value=>/[^\p{L}\p{N}\s]/u.test(value)]
];
async function register(){
  const body=formFrame('إنشاء حساب طالب','أدخل بياناتك واختر المواد اللي بتدرسها.');
  const report=message(body), form=node('form','',{class:'register'});
  field(form,'الاسم الكامل','fullName',{autocomplete:'name',maxlength:120});
  field(form,'الرقم الجامعي','number',numAttrs);
  universityEmailField(form);
  field(form,'تاريخ الميلاد','birth',{type:'date',autocomplete:'bday',min:'1900-01-01',max:new Date().toISOString().slice(0,10)});
  const label=node('label','الجنس',{class:'wide'}),select=node('select','',{name:'gender',required:''});
  for(const [key,value] of [['','اختر'],['female','أنثى'],['male','ذكر'],['undisclosed','أفضل عدم الإفصاح']])select.append(node('option',value,{value:key}));
  label.append(select);form.append(label);
  const pwd=field(form,'كلمة المرور','password',{...passAttrs,autocomplete:'new-password',minlength:8,'aria-describedby':'rules'});
  field(form,'تأكيد كلمة المرور','confirm',{...passAttrs,autocomplete:'new-password',minlength:8});
  const rules=node('ul','',{class:'rules wide',id:'rules'});
  function progress(){rules.replaceChildren(...checks.map(([title,check])=>node('li',title,{'data-met':String(check(pwd.value))})));}
  pwd.addEventListener('input',progress);progress();form.append(rules);
  const subjects=node('fieldset','',{class:'wide'}), list=node('div','',{class:'subjects'}), status=node('p','جارٍ تحميل المواد…',{class:'muted'});
  const search=node('input','',{type:'search','aria-label':'ابحث في المواد',placeholder:'ابحث في المواد'});
  subjects.append(node('legend','المواد التي تدرسها'),search,list,status);form.append(subjects);
  search.addEventListener('input',()=>{
    const term=search.value.trim().toLowerCase();
    let matches=0;
    for(const choice of list.children) {
      choice.hidden=!choice.textContent.toLowerCase().includes(term);
      if(!choice.hidden)matches++;
    }
    status.textContent=list.childElementCount&&!matches?'لا توجد مادة مطابقة.':'';
  });
  submit(form,'إنشاء الحساب',async data=>{
    const number=data.number.trim().replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-1632)).replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-1776));
    if(data.email.toLowerCase()!==number+'@ses.yu.edu.jo'){report('الرقم في البريد لازم يطابق الرقم الجامعي المدخل.',true);return;}
    if(!checks.every(([,check])=>check(data.password))||data.confirm!==data.password){report('تحقّق من شروط كلمة المرور وتطابقها.',true);return;}
    const selected=new FormData(form).getAll('subjects');
    if(!selected.length){report('اختر مادة واحدة على الأقل.',true);return;}
    const {token}=await account({action:'register',...data,subjects:selected});
    const {user}=await signInWithCustomToken(auth,token);
    try {await sendEmailVerification(user);} catch {location.assign('/verify?resend=1');return;}
    location.assign('/verify');
  },report);
  body.append(form);appendLinks(body,link('عندك حساب؟ سجّل الدخول','/'));
  if(!app){status.textContent='ستظهر المواد بعد ربط قاعدة البيانات.';return;}
  try{
    const result=await getDocs(query(collection(db,'subjects'),where('active','==',true)));
    const items=result.docs.sort((a,b)=>a.data().name.localeCompare(b.data().name,'ar'));
    for(const item of items){
      const choice=node('label',item.data().name);
      choice.prepend(node('input','',{type:'checkbox',name:'subjects',value:item.id}));list.append(choice);
    }
    status.textContent=items.length?'':'ستظهر المواد عندما يضيفها صاحب الموقع.';
  }catch{status.textContent='تعذّر تحميل المواد. حدّث الصفحة.';}
}
function reset(){
  const body=formFrame('استعادة كلمة المرور','اكتب البريد الذي استخدمته عند التسجيل.');
  const report=message(body),form=node('form');
  field(form,'البريد الإلكتروني','email',emailAttrs);
  submit(form,'إرسال رابط الاستعادة',async({email})=>{
    try{await sendPasswordResetEmail(auth,email);}
    catch(error){if(error.code!=='auth/user-not-found')throw error;}
    report('إذا كان البريد مرتبطًا بحساب، سيصلك رابط الاستعادة.');
  },report);body.append(form);appendLinks(body,link('العودة إلى الدخول','/'));
}
const session=()=>new Promise(resolve=>{const stop=onAuthStateChanged(auth,user=>{stop();resolve(user);});});
async function verify(){
  const body=formFrame('فعّل بريدك الإلكتروني','افتح رابط التفعيل في بريدك، ثم ارجع وأكمل التسجيل.');
  const report=message(body);
  if(location.search.includes('resend=1'))report('تعذّر إرسال الرسالة. جرّب إعادة الإرسال.',true);
  const form=node('form');
  submit(form,'أكمل التسجيل',async()=>{
    const user=await session();
    if(!user){location.assign('/activate');return;}
    await user.reload();await user.getIdToken(true);
    if(!user.emailVerified){report('البريد لم يُفعّل بعد.',true);return;}
    await account({action:'finish'});
    location.assign('/library');
  },report);
  const resend=node('button','إعادة إرسال رابط التفعيل',{type:'button'});
  resend.onclick=async()=>{
    if(!app)return;
    resend.disabled=true;
    try{const user=await session();if(!user){location.assign('/activate');return;}await sendEmailVerification(user);report('تم إرسال رسالة جديدة.');}
    catch(error){report(explain(error),true);}finally{resend.disabled=false;}
  };
  body.append(form,resend);appendLinks(body,link('العودة إلى الدخول','/'));
}
async function dashboard(staff){
  main.className='dashboard';
  main.append(node('h1',staff?'مساحة الإدارة':'موادي'));
  const report=message(main);
  if(!app){report('يلزم ربط Firebase لفتح هذه الصفحة.',true);return;}
  try{
    const user=await session();
    if(!user||!user.emailVerified){location.replace(staff?'/staff':'/');return;}
    const role=(await getDoc(doc(db,'roles',user.uid))).data();
    if(!role?.active||!(staff?['owner','assistant'].includes(role.role):role.role==='student')){
      location.replace(staff?'/staff':'/');return;
    }
    const exit=node('button','تسجيل الخروج',{type:'button'});
    exit.onclick=async()=>{await signOut(auth);location.assign(staff?'/staff':'/');};
    document.querySelector('.bar').append(exit);
    if(staff){
      await adminWorkspace({main,role:role.role,user,db,auth,storage,
        manage:async data=>(await httpsCallable(functions,'management')(data)).data,
        community:async data=>(await httpsCallable(functions,'community')(data)).data,node,field,message,submit});
      return;
    }
    const profile=(await getDoc(doc(db,'students',user.uid))).data();
    const filter=node('input','',{type:'search',class:'library-search','aria-label':'ابحث في موادك',placeholder:'ابحث في موادك'});
    const group=node('section','',{class:'grid','aria-label':'المواد المختارة'});
    const noMatches=node('p','لا توجد مادة مطابقة.',{hidden:''});
    const materials=await Promise.all((profile?.subjects??[]).map(id=>getDoc(doc(db,'subjects',id)).catch(error=>{
      if(error.code==='permission-denied')return null;
      throw error;
    })));
    for(const item of materials)if(item?.exists())group.append(node('article',item.data().name,{class:'subject-card'}));
    if(group.childElementCount){
      filter.oninput=()=>{
        const term=filter.value.trim().toLowerCase();
        for(const card of group.children)card.hidden=!card.textContent.toLowerCase().includes(term);
        noMatches.hidden=[...group.children].some(card=>!card.hidden);
      };
      main.append(filter,group,noMatches);
    }else main.append(node('p','لا توجد مواد متاحة الآن.'));
    await studyWorkspace({main,user,db,materials,node,message,
      library:async data=>(await httpsCallable(functions,'library')(data)).data,
      community:async data=>(await httpsCallable(functions,'community')(data)).data});
  }catch(error){report(explain(error),true);}
}
if(route==='/register')register();
else if(route==='/verify')verify();
else if(route==='/reset')reset();
else if(route==='/staff')login(true);
else if(route==='/activate')login(false,true);
else if(route==='/library'||route==='/workspace')dashboard(route==='/workspace');
else login();
