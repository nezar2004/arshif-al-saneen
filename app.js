const $ = id => document.getElementById(id);
const kinds = {mid:'ميد',final:'فاينل',makeup:'ميك أب'};
const numbers = new Intl.NumberFormat('ar',{useGrouping:false});
let data;

function el(tag,text,attributes={}) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  for (const [key,value] of Object.entries(attributes)) node.setAttribute(key,value);
  return node;
}

async function api(path,method='GET',body) {
  const options = {method};
  if (body instanceof FormData) options.body = body;
  else if (body) {
    options.body = JSON.stringify(body);
    options.headers = {'Content-Type':'application/json'};
  }
  const response = await fetch('/api/' + path,options);
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('تعذّر الاتصال بالأرشيف.');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

const byId = (table,id) => data[table].find(row => row.id === id);
const choices = (items,key='name') => items.map(row => [row.id,row[key]]);
function fill(select,options,placeholder,selected='') {
  select.replaceChildren(el('option',placeholder,{value:''}),...options.map(([key,value]) => el('option',value,{value:key})));
  select.value = options.some(([key]) => key === selected) ? selected : '';
}
function empty(title,detail) {
  const box = el('div',undefined,{class:'empty'});
  box.append(el('span','▤',{class:'empty-icon','aria-hidden':'true'}),el('strong',title),el('p',detail));
  return box;
}
const normalized = text => String(text).normalize('NFKC').replace(/[\u064b-\u065f\u0670ـ]/g,'')
  .replace(/[أإآٱ]/g,'ا').replace(/[٠-٩]/g,d => String(d.charCodeAt(0)-1632))
  .replace(/[۰-۹]/g,d => String(d.charCodeAt(0)-1776)).toLowerCase().trim();

function fileRow(file) {
  const row = el('div',undefined,{class:'file-row'});
  const actions = el('div',undefined,{class:'actions'});
  const path = '/api/files/' + file.id;
  actions.append(el('a','عرض',{class:'button',href:path,target:'_blank',rel:'noopener','aria-label':'عرض '+file.name}),
    el('a','تحميل',{class:'button',href:path+'?download=1','aria-label':'تحميل '+file.name}));
  row.append(el('span',file.name),actions);
  return row;
}

async function catalog() {
  const output = $('results');
  try {
    const session = await api('students/session');
    const nav = $('nav');
    if (session.student) {
      nav.replaceWith(button('تسجيل الخروج',async () => {
        try { await api('students/session','DELETE'); location.assign('/'); }
        catch (error) { output.prepend(empty('تعذّر تسجيل الخروج',error.message)); }
      }));
    } else {
      nav.href='/admin'; nav.textContent='لوحة الإدارة';
    }
    data = await api('catalog');
    const department = $('department'), subject = $('subject'), kind = $('kind');
    fill(department,choices(data.departments),'كل الأقسام');
    fill(kind,Object.entries(kinds),'كل الأنواع');
    function render() {
      const words = normalized($('query').value).split(/\s+/).filter(Boolean);
      const papers = data.papers.filter(paper => {
        const course = byId('subjects',paper.subject);
        const group = byId('departments',course?.department);
        const haystack = normalized([paper.title,paper.note,paper.year,kinds[paper.kind],course?.name,group?.name].join(' '));
        return (!department.value || course?.department === department.value) &&
          (!subject.value || paper.subject === subject.value) && (!kind.value || paper.kind === kind.value) &&
          words.every(word => haystack.includes(word));
      });
      $('count').textContent = new Intl.NumberFormat('ar').format(papers.length) + ' نتيجة';
      output.replaceChildren();
      for (const paper of papers) {
        const course = byId('subjects',paper.subject);
        const group = byId('departments',course?.department);
        const card = el('article',undefined,{class:'card'});
        card.append(el('span',kinds[paper.kind]+' · '+numbers.format(paper.year),{class:'tag'}),
          el('h3',paper.title),el('p',[group?.name,course?.name].filter(Boolean).join(' / '),{class:'muted'}));
        if (paper.note) card.append(el('p',paper.note,{class:'note'}));
        card.append(...data.files.filter(file => file.paper === paper.id).map(fileRow));
        output.append(card);
      }
      if (!papers.length) output.append(data.papers.length ?
        empty('لا توجد نتائج مطابقة','جرّب كلمة بحث أخرى أو غيّر الفلاتر.') :
        empty('لا توجد امتحانات مضافة بعد','ستظهر أسئلة السنوات هنا عند إضافتها إلى المكتبة.'));
    }
    function subjects() {
      fill(subject,choices(data.subjects.filter(row => !department.value || row.department === department.value)),'كل المواد',subject.value);
      render();
    }
    department.addEventListener('change',subjects);
    subject.addEventListener('change',render);
    kind.addEventListener('change',render);
    $('query').addEventListener('input',render);
    subjects();
  } catch (error) { output.replaceChildren(empty('تعذّر تحميل المكتبة',error.message)); }
  finally { output.setAttribute('aria-busy','false'); }
}

function field(form,label,name,attributes={},options) {
  const wrapper = el('label',label);
  const input = el(options ? 'select' : attributes.rows ? 'textarea' : 'input',undefined,{name,...attributes});
  if (options) fill(input,options,'اختر من القائمة');
  wrapper.append(input);
  form.append(wrapper);
  return input;
}
function button(text,fn,style='') {
  const node = el('button',text,{type:'button',class:style});
  node.addEventListener('click',fn);
  return node;
}
function status(message,error=false) {
  $('status').textContent = message;
  $('status').dataset.error = error;
}

function formAction(form,label,save) {
  const actions = el('div',undefined,{class:'actions wide'});
  const submit = el('button',label,{type:'submit',class:'primary'});
  actions.append(submit);
  form.append(actions);
  form.addEventListener('submit',async event => {
    event.preventDefault();
    submit.disabled = true;
    try { await save(new FormData(form)); }
    catch (error) { status(error.message,true); }
    finally { submit.disabled = false; }
  });
  return {actions,submit};
}

function adminSection(table,title,label,fields) {
  const box = el('section',undefined,{class:'panel'});
  box.append(el('h2',title));
  const form = el('form',undefined,{class:'form two'});
  const inputs = fields.map(([caption,name,attrs,options]) => field(form,caption,name,attrs,options));
  let editing;
  const reset = () => {
    editing = undefined;
    form.reset();
    submit.textContent = 'إضافة ' + label;
    cancel.hidden = true;
  };
  const {actions,submit} = formAction(form,'إضافة '+label,async values => {
    const payload = Object.fromEntries(values);
    if (table === 'papers') payload.year = Number(payload.year);
    await api(table+(editing ? '/'+editing : ''),editing ? 'PUT' : 'POST',payload);
    await refresh('تم الحفظ.');
  });
  const cancel = button('إلغاء التعديل',reset);
  cancel.hidden = true;
  actions.append(cancel);
  box.append(form);

  for (const row of data[table]) {
    const line = el('div',undefined,{class:'entry'});
    const actions = el('div',undefined,{class:'actions'});
    const parent = table === 'subjects' ? byId('departments',row.department)?.name :
      table === 'papers' ? [byId('subjects',row.subject)?.name,kinds[row.kind],numbers.format(row.year)].join(' · ') : null;
    line.append(el('span',(row.name || row.title) + (parent ? ' — ' + parent : '')),actions);
    actions.append(button('تعديل',() => {
      editing = row.id;
      for (const input of inputs) input.value = row[input.name] ?? '';
      submit.textContent = 'حفظ التعديل';
      cancel.hidden = false;
      inputs[0].focus();
    }),button('حذف',() => remove(table,row), 'danger'));
    box.append(line);
  }
  return box;
}

async function remove(table,row) {
  const dialog = el('dialog');
  const form = el('form',undefined,{method:'dialog'});
  form.append(el('p','حذف «'+(row.name || row.title)+'»؟'),el('button','إلغاء',{value:'cancel',autofocus:''}),
    el('button','حذف',{value:'confirm',class:'danger'}));
  dialog.append(form);
  document.body.append(dialog);
  dialog.addEventListener('close',async () => {
    const confirmed = dialog.returnValue === 'confirm';
    dialog.remove();
    if (!confirmed) return;
    try { await api(table+'/'+row.id,'DELETE'); await refresh('تم الحذف.'); }
    catch (error) { status(error.message,true); }
  });
  dialog.showModal();
}

async function refresh(message) {
  data = await api('catalog');
  const panels = $('panels');
  panels.replaceChildren(
    adminSection('departments','الأقسام','قسم',[['اسم القسم','name',{required:'',maxlength:120}]]),
    adminSection('subjects','المواد','مادة',[
      ['اسم المادة','name',{required:'',maxlength:120}],['القسم','department',{required:''},choices(data.departments)]
    ]),
    adminSection('papers','الامتحانات والأسئلة','امتحان',[
      ['عنوان الامتحان','title',{required:'',maxlength:160}],['المادة','subject',{required:''},choices(data.subjects)],
      ['نوع الامتحان','kind',{required:''},Object.entries(kinds)],['السنة','year',{type:'number',required:'',min:1900,max:2100}],
      ['نص الأسئلة أو الملاحظات (اختياري)','note',{rows:4,maxlength:12000}]
    ])
  );
  const box = el('section',undefined,{class:'panel'});
  box.append(el('h2','الملفات'),el('p','يمكن إضافة أكثر من ملف لكل امتحان. الصيغ المتاحة PDF وJPG وPNG وWebP، حتى ٢٠ م.ب. لكل ملف.',{class:'muted'}));
  const form = el('form',undefined,{class:'form two'});
  field(form,'الامتحان','paper',{required:''},choices(data.papers,'title'));
  field(form,'الملف','file',{type:'file',required:'',accept:'.pdf,.jpg,.jpeg,.png,.webp',multiple:''});
  formAction(form,'رفع الملفات',async values => {
    const paper = values.get('paper');
    let uploaded = 0;
    try {
      for (const file of values.getAll('file')) {
        const body = new FormData();
        body.set('file',file);
        await api('files?paper='+encodeURIComponent(paper),'POST',body);
        uploaded++;
      }
    } catch (error) {
      if (uploaded) await refresh();
      throw new Error((uploaded ? 'تم رفع '+numbers.format(uploaded)+' من الملفات. ' : '') + error.message);
    }
    await refresh('تم رفع الملفات.');
  });
  box.append(form);
  for (const file of data.files) {
    const f = fileRow(file);
    f.firstChild.append(el('small',' — '+(byId('papers',file.paper)?.title ?? ''),{class:'muted'}));
    const rename = el('form',undefined,{class:'form'});
    const input = field(rename,'اسم الملف','name',{required:'',maxlength:180,value:file.name});
    const edit = formAction(rename,'حفظ الاسم',async values => {
      await api('files/'+file.id,'PUT',Object.fromEntries(values));
      await refresh('تم تعديل اسم الملف.');
    });
    edit.actions.append(button('إلغاء',() => rename.remove()));
    f.lastChild.append(button('تعديل الاسم',() => {
      if (!rename.isConnected) f.after(rename);
      input.focus();
    }),button('حذف',() => remove('files',file),'danger'));
    box.append(f);
  }
  panels.append(box);
  if (message) status(message);
}

async function admin() {
  document.title = 'لوحة الإدارة | أرشيف السنوات';
  const nav = $('nav');
  nav.href = '/library'; nav.textContent = 'المكتبة';
  const head = el('div',undefined,{class:'admin-head toolbar'});
  head.append(el('h1','لوحة الإدارة'));
  const main = $('main');
  main.replaceChildren(head,el('div',undefined,{id:'status',role:'status','aria-live':'polite'}),el('div',undefined,{id:'panels'}));
  try {
    const session = await api('session');
    if (session.admin) {
      head.append(session.sites ?
        el('a','خروج',{class:'button',href:'/signout-with-chatgpt?returnTo=%2F',target:'_top'}) :
        button('خروج',async () => {
          try { await api('session','DELETE'); location.reload(); }
          catch (error) { status(error.message,true); }
        }));
      await refresh();
      return;
    }
    const box = el('section',undefined,{class:'panel'});
    box.append(el('h2','دخول المشرف'));
    if (session.sites) {
      box.append(el('p','سجّل الدخول بالحساب المخصّص لإدارة الأرشيف.'),
        el('a','الدخول بحساب ChatGPT',{class:'button primary',href:'/signin-with-chatgpt?returnTo=%2Fadmin',target:'_top'}));
    }
    if (session.password) {
      const form = el('form',undefined,{class:'form'});
      field(form,'مفتاح الإدارة','password',{type:'password',required:'',autocomplete:'current-password'});
      formAction(form,'دخول',async values => {
        await api('session','POST',Object.fromEntries(values));
        await admin();
      });
      box.append(form);
    }
    if (!session.sites && !session.password) box.append(el('p','تحتاج لوحة الإدارة إلى إعداد حساب المشرف.'));
    $('panels').append(box);
  } catch (error) { status(error.message,true); }
}

