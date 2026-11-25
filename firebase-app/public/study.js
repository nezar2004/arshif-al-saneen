import {collection,doc,getDocs,setDoc,serverTimestamp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import {communityPanel,examConversation} from '/community.js';

const kinds={mid:'ميد',final:'فاينل',quiz:'كويز',makeup:'ميك أب',general:'سنوات عامة',mixed:'ميد وفاينل',first:'فيرست',second:'سكند'};
const terms={first:'الأول',second:'الثاني',summer:'الصيفي'};
const normalize=value=>String(value??'').toLowerCase().normalize('NFKC').replace(/[\u064b-\u065fـ]/g,'').replace(/[أإآ]/g,'ا').replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-1632));

export async function studyWorkspace({main,user,db,materials,library,community,node,message}){
  const report=message(main);
  const [catalog,saved]=await Promise.all([library({action:'list'}),getDocs(collection(db,'students',user.uid,'study'))]);
  const records=new Map(saved.docs.map(x=>[x.id,x.data()]));
  const activeMaterials=materials.filter(x=>x?.exists());
  const names=new Map(activeMaterials.map(x=>[x.id,x.data().name]));
  const sections=new Map(activeMaterials.map(x=>[x.id,x.data().section]));
  let mode='all';
  const tabs=node('nav','',{'aria-label':'أقسام المكتبة'});
  const filters=node('section','',{class:'study-filters','aria-label':'فلترة الامتحانات'});
  const results=node('section','',{class:'grid','aria-label':'الامتحانات'});
  const count=node('p','',{class:'muted','aria-live':'polite'});
  const search=node('input','',{type:'search',placeholder:'اسم الامتحان أو المادة أو السنة','aria-label':'البحث في الامتحانات'});
  const searchLabel=node('label','بحث');searchLabel.append(search);filters.append(searchLabel);
  function button(label,onClick,attributes={}){
    const b=node('button',label,{type:'button',...attributes});b.onclick=onClick;return b;
  }
  function select(label,values){
    const wrap=node('label',label), input=node('select','',{'aria-label':label});
    input.append(node('option','الكل',{value:''}));
    for(const [key,title] of values)input.append(node('option',title,{value:key}));
    wrap.append(input);filters.append(wrap);input.onchange=render;return input;
  }
  const subject=select('المادة',[...names]);
  const sectionFilter=select('القسم',[...new Set([...sections.values()].filter(Boolean))].map(x=>[x,x]));
  const year=select('السنة',[...new Set(catalog.exams.map(x=>x.year).filter(Boolean))].sort().reverse().map(y=>[y,y]));
  const term=select('الفصل',Object.entries(terms));
  const kind=select('نوع الامتحان',Object.entries(kinds));
  search.oninput=render;
  for(const [key,label] of [['all','الامتحانات'],['favorite','المفضلة'],['recent','شوهد مؤخرًا'],['popular','الأكثر مشاهدة']]){
    const tab=button(label,async()=>{
      mode=key;render();
      if(key==='popular'){
        try{catalog.exams=(await library({action:'list'})).exams;render();}
        catch{report('تعذّر تحديث عدد المشاهدات.',true);}
      }
    },{'data-mode':key});
    tabs.append(tab);
  }
  const section=node('section','',{class:'study-section'});
  section.append(node('h2','مكتبة الامتحانات'),tabs,filters,count,results);
  main.append(section);
  async function update(examId,values){
    await setDoc(doc(db,'students',user.uid,'study',examId),values,{merge:true});
    records.set(examId,{...records.get(examId),...values});
  }
  function render(){
    tabs.querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.mode===mode)));
    const filtered=catalog.exams.filter(exam=>{
      const state=records.get(exam.id);
      return (mode!=='favorite'||state?.favorite===true)&&(mode!=='recent'||state?.viewedAt)&&
        (mode!=='popular'||exam.views>0)&&
        (!subject.value||exam.subject===subject.value)&&(!sectionFilter.value||sections.get(exam.subject)===sectionFilter.value)&&(!year.value||String(exam.year)===year.value)&&
        (!term.value||exam.term===term.value)&&(!kind.value||exam.kind===kind.value)&&
        normalize([exam.title,names.get(exam.subject),exam.year,kinds[exam.kind],terms[exam.term]].join(' ')).includes(normalize(search.value.trim()));
    });
    const millis=x=>typeof x==='number'?x:x?.toMillis?.()??0;
    if(mode==='recent')filtered.sort((a,b)=>millis(records.get(b.id)?.viewedAt)-millis(records.get(a.id)?.viewedAt));
    if(mode==='popular')filtered.sort((a,b)=>b.views-a.views||b.createdAt-a.createdAt);
    count.textContent=filtered.length+' نتيجة';
    results.replaceChildren();
    if(!filtered.length)results.append(node('p',mode==='favorite'?'لا توجد امتحانات مفضلة مطابقة.':mode==='recent'?'لم تشاهد امتحانات مطابقة بعد.':mode==='popular'?'لا توجد مشاهدات مطابقة بعد.':'لا توجد امتحانات مطابقة في موادك.'));
    for(const exam of filtered){
      const state=records.get(exam.id);
      const card=node('article','',{class:'subject-card study-card'});
      card.append(node('p',names.get(exam.subject),{class:'muted'}),node('h3',exam.title),
        node('p',[exam.year,terms[exam.term],kinds[exam.kind],exam.count+' صورة',...(mode==='popular'?[exam.views+' طالب شاهد الامتحان']:[])].filter(Boolean).join(' · '),{class:'muted'}));
      const controls=node('div','',{class:'study-actions'});
      controls.append(button('عرض الصور',()=>openViewer(exam),{class:'primary'}));
      const pin=button(state?.favorite?'إزالة من المفضلة':'أضف للمفضلة',async()=>{
        pin.disabled=true;
        try{await update(exam.id,{favorite:!records.get(exam.id)?.favorite});render();}
        catch{report('تعذّر تحديث المفضلة.',true);pin.disabled=false;}
      },{'aria-pressed':String(Boolean(state?.favorite))});
      controls.append(pin);card.append(controls);results.append(card);
    }
  }
  function openViewer(exam){
    let index=0, scale=1, angle=0, attempt=0, objectURL='', viewed=false;
    const dialog=node('dialog','',{class:'viewer','aria-labelledby':'viewer-title'});
    const header=node('header','',{class:'viewer-header'});
    const close=button('إغلاق',()=>dialog.close(),{autofocus:''});
    header.append(node('h2',exam.title,{id:'viewer-title'}),close);
    const controls=node('div','',{class:'study-actions viewer-controls'});
    const indicator=node('span','',{role:'status','aria-live':'polite'});
    const stage=node('div','',{class:'viewer-stage','aria-label':'صورة الامتحان',tabindex:'0'});
    stage.oncontextmenu=event=>event.preventDefault();
    stage.ondragstart=event=>event.preventDefault();
    const status=node('p','',{role:'status','aria-live':'polite'});
    const image=node('img','',{class:'exam-image',draggable:'false',alt:''});
    const layout=node('div','',{class:'viewer-image-layout'});
    function transform(){
      const rotated=angle%180!==0;
      const w=image.naturalWidth,h=image.naturalHeight;
      if(!w||!h)return;
      const heightLimit=Math.min(560,Math.max(100,window.innerHeight*.62-26));
      const base=Math.min((stage.clientWidth-34)/(rotated?h:w),heightLimit/(rotated?w:h),1);
      const width=w*base*scale,height=h*base*scale;
      layout.style.width=(rotated?height:width)+'px';layout.style.height=(rotated?width:height)+'px';
      image.style.width=width+'px';image.style.height=height+'px';image.style.transform='translate(-50%, -50%) rotate('+angle+'deg)';
    }
    image.onload=transform;
    const prev=button('السابق',()=>load(index-1)),next=button('التالي',()=>load(index+1));
    const enlarge=button('تكبير',()=>{scale=Math.min(3,scale+.25);transform();});
    const reduce=button('تصغير',()=>{scale=Math.max(.5,scale-.25);transform();});
    const rotate=button('تدوير',()=>{angle=(angle+90)%360;transform();});
    const reset=button('ملاءمة',()=>{scale=1;angle=0;transform();});
    controls.append(prev,indicator,next,enlarge,reduce,rotate,reset);
    const noteLabel=node('label','ملاحظتي الخاصة على الصورة');
    const note=node('textarea','',{maxlength:'2000',rows:'3',placeholder:'اكتب ملاحظتك على الامتحان'});
    const drafts=new Map();
    const noteKey=page=>exam.id+'-'+page;
    note.oninput=()=>drafts.set(index,note.value);
    noteLabel.append(note);
    const noteStatus=node('p','',{role:'status','aria-live':'polite'});
    const save=button('حفظ الملاحظة',async()=>{
      const page=index, value=note.value;
      save.disabled=true;
      try{await update(noteKey(page),{note:value});if(page===index)noteStatus.textContent='تم حفظ الملاحظة.';}
      catch{if(page===index)noteStatus.textContent='تعذّر حفظ الملاحظة.';}
      finally{save.disabled=false;}
    },{class:'primary'});
    const notes=node('section','',{class:'viewer-notes'});
    notes.append(noteLabel,save,noteStatus);
    const discussion=node('section','',{class:'viewer-discussion'});
    const changeDiscussion=examConversation({pane:discussion,community,node,exam:exam.id});
    dialog.append(header,controls,stage,notes,discussion);
    document.body.append(dialog);
    function cleanupURL(){if(objectURL){URL.revokeObjectURL(objectURL);objectURL='';}}
    dialog.addEventListener('close',()=>{attempt++;cleanupURL();window.removeEventListener('resize',transform);dialog.remove();render();},{once:true});
    window.addEventListener('resize',transform);
    stage.onkeydown=event=>{
      const target=event.key==='ArrowLeft'?index+1:event.key==='ArrowRight'?index-1:null;
      if(target!==null&&scale===1){event.preventDefault();load(target);}
    };
    async function load(target){
      if(target<0||target>=exam.count)return;
      const sequence=++attempt;
      index=target;scale=1;angle=0;
      changeDiscussion(index);
      note.value=drafts.get(index)??records.get(noteKey(index))?.note??(index===0?records.get(exam.id)?.note:'')??'';
      noteStatus.textContent='';
      prev.disabled=index===0;next.disabled=index===exam.count-1;
      indicator.textContent=(index+1)+' / '+exam.count;
      indicator.dir='ltr';
      cleanupURL();image.removeAttribute('src');stage.replaceChildren(status);
      status.textContent='جارٍ تجهيز الصورة…';stage.setAttribute('aria-busy','true');
      for(const control of [enlarge,reduce,rotate,reset])control.disabled=true;
      try{
        const result=await library({action:'image',id:exam.id,index});
        if(sequence!==attempt)return;
        const bytes=Uint8Array.from(atob(result.content),char=>char.charCodeAt(0));
        objectURL=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'}));
        image.alt='صورة '+(index+1)+' من '+exam.title;
        image.src=objectURL;layout.replaceChildren(image);stage.replaceChildren(layout);
        for(const control of [enlarge,reduce,rotate,reset])control.disabled=false;
        if(!viewed){
          viewed=true;
          update(exam.id,{viewedAt:serverTimestamp()}).then(()=>{
            records.set(exam.id,{...records.get(exam.id),viewedAt:Date.now()});
            if(!dialog.open)render();
          }).catch(()=>{viewed=false;});
        }
      }catch{
        if(sequence!==attempt)return;
        status.textContent='تعذّر فتح الصورة.';
        stage.append(button('إعادة المحاولة',()=>load(index)));
      }finally{if(sequence===attempt)stage.setAttribute('aria-busy','false');}
    }
    dialog.showModal();load(0);
  }
  render();
  communityPanel({main,user,db,community,node,names});
}
