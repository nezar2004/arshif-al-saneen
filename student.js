const studentFields = [
  ['الاسم الكامل','full_name',{autocomplete:'name',maxlength:120}],
  ['الرقم الجامعي','student_number',{inputmode:'numeric',autocomplete:'username',maxlength:20,dir:'ltr',pattern:'[0-9٠-٩۰-۹]{1,20}'}],
  ['البريد الإلكتروني','email',{type:'email',autocomplete:'email',maxlength:254,dir:'ltr'}],
  ['الجنس','gender',{},[['female','أنثى'],['male','ذكر'],['undisclosed','أفضل عدم الإفصاح']]],
  ['تاريخ الميلاد','birth_date',{type:'date',autocomplete:'bday',min:'1900-01-01',max:new Date().toISOString().slice(0,10)}]
];

function loginPage() {
  const signup = location.pathname === '/register';
  const owner = location.pathname === '/owner';
  document.body.classList.add('auth-page');
  const nav = $('nav');
  nav.textContent = owner ? 'دخول الطالب' : 'دخول صاحب الموقع';
  nav.href = owner ? '/' : '/owner';
  const main = $('main');
  main.className = 'auth-layout';
  const aside = el('aside',undefined,{class:'auth-aside'});
  const art = el('div',undefined,{class:'auth-art','aria-hidden':'true'});
  art.append(el('span','',{}),el('span','',{}),el('span','',{}));
  aside.append(el('span','أرشيف السنوات',{class:'aside-label'}),art,
    el('h2','أسئلة السنوات السابقة'),el('p','ابحث عن امتحانات الميد والفاينل والميك أب حسب القسم والمادة.'));
  const pane = el('section',undefined,{class:'auth-pane'});
  const body = el('div',undefined,{class:'auth-content'});
  const tabs = el('nav',undefined,{class:'auth-tabs','aria-label':'نوع الحساب'});
  tabs.append(el('a','طالب',{href:'/',...(owner?{}:{'aria-current':'page'})}),
    el('a','صاحب الموقع',{href:'/owner',...(owner?{'aria-current':'page'}:{})}));
  const heading = owner ? 'دخول صاحب الموقع' : signup ? 'إنشاء حساب طالب' : 'دخول الطالب';
  document.title = heading + ' | أرشيف السنوات';
  body.append(tabs,el('h1',heading),el('p',owner ? 'سجّل الدخول بحساب المالك للوصول إلى لوحة الإدارة.' :
    signup ? 'أدخل بياناتك الجامعية لإنشاء حسابك.' : 'استخدم رقمك الجامعي وكلمة المرور للدخول إلى المكتبة.',{class:'intro'}),
    el('div',undefined,{id:'status',role:'status','aria-live':'polite'}));
  pane.append(body);
  main.replaceChildren(pane,aside);
  if (owner) {
    const link=el('a','الدخول إلى لوحة الإدارة',{href:'/admin',class:'button primary owner-button',target:'_top'});
    body.append(link);
    api('session').then(session => {
      if (session.sites && !session.admin) {
        link.href='/signin-with-chatgpt?returnTo=%2Fadmin';
        link.textContent='الدخول بحساب ChatGPT';
      }
    }).catch(()=>{});
    return;
  }
  const form = el('form',undefined,{class:signup ? 'form two signup-form' : 'form login-form'});
  for (const [label,name,attributes,options] of signup ? studentFields : [studentFields[1]]) {
    field(form,label,name,{...attributes,required:''},options);
  }
  const pwd = field(form,'كلمة المرور','password',{type:'password',required:'',maxlength:128,dir:'ltr',autocomplete:signup?'new-password':'current-password'});
  let confirmation;
  if (signup) {
    pwd.minLength=8;
    pwd.setAttribute('aria-describedby','password-rules');
    confirmation=field(form,'تأكيد كلمة المرور','confirmation',{type:'password',required:'',maxlength:128,dir:'ltr',autocomplete:'new-password'});
    const rules = el('ul',undefined,{id:'password-rules',class:'rules wide'});
    const checks = [['٨ أحرف على الأقل',s=>s.length>=8],['حرف إنجليزي كبير',s=>/[A-Z]/.test(s)],['رقم',s=>/[0-9٠-٩۰-۹]/.test(s)],['رمز مثل @ أو $',s=>/[^\p{L}\p{N}\s]/u.test(s)]];
    function showRules() {
      rules.replaceChildren(...checks.map(([label,pass]) => el('li',label,{class:pass(pwd.value)?'met':''})));
    }
    pwd.addEventListener('input',showRules);
    showRules();
    form.append(rules);
  }
  formAction(form,signup ? 'إنشاء الحساب' : 'تسجيل الدخول',async values => {
    const payload=Object.fromEntries(values);
    if (confirmation && payload.password !== payload.confirmation) {
      confirmation.focus();
      throw new Error('كلمتا المرور غير متطابقتين.');
    }
    status('');
    await api(signup?'students/register':'students/login','POST',payload);
    location.assign('/library');
  });
  const toggle = button('إظهار',() => {
    const show=pwd.type==='password';
    pwd.type=show?'text':'password';
    toggle.textContent=show?'إخفاء':'إظهار';
    toggle.setAttribute('aria-pressed',String(show));
  },'reveal');
  toggle.setAttribute('aria-label','إظهار أو إخفاء كلمة المرور');
  toggle.setAttribute('aria-pressed','false');
  pwd.parentElement.append(toggle);
  const switcher=el('p',signup?'عندك حساب؟ ':'أول مرة تستخدم الأرشيف؟ ',{class:'switch-auth'});
  switcher.append(el('a',signup?'سجّل الدخول':'أنشئ حساب طالب',{href:signup?'/':'/register'}));
  body.append(form,switcher);
  if (!signup) api('students/session').then(session => {
    if(session.student) location.replace('/library');
  }).catch(()=>{});
}

if (location.pathname === '/admin') admin();
else if (location.pathname === '/library') catalog();
else loginPage();
