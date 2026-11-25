import {collection,doc,addDoc,deleteDoc,onSnapshot} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
const formatDate=value=>new Intl.DateTimeFormat('ar-JO',{dateStyle:'medium',timeStyle:'short'}).format(value);
const decode=base64=>Uint8Array.from(atob(base64),x=>x.charCodeAt(0));
const calendarDate=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
const calendarText=value=>String(value).replace(/[\\;,]/g,char=>'\\'+char).replace(/\r\n|\r|\n/g,'\\n');
function reminderCalendar(row){
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Arshif Al Saneen//Exam Reminders//AR','CALSCALE:GREGORIAN',
    'BEGIN:VEVENT','UID:'+row.id+'@arshif-saneen.onrender.com','DTSTAMP:'+calendarDate(Date.now()),
    'DTSTART:'+calendarDate(row.at),'SUMMARY:'+calendarText(row.title),
    'BEGIN:VALARM','ACTION:DISPLAY','TRIGGER:-PT'+row.lead+'M','DESCRIPTION:'+calendarText(row.title),
    'END:VALARM','END:VEVENT','END:VCALENDAR'];
  const encoder=new TextEncoder();
  return lines.map(line=>{
    let folded='',length=0;
    for(const char of line){
      const bytes=encoder.encode(char).length;
      if(length+bytes>75){folded+='\r\n ';length=1;}
      folded+=char;length+=bytes;
    }
    return folded;
  }).join('\r\n')+'\r\n';
}
export async function encodeFile(file){
  const url=await new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);
  });
  return url.split(',')[1];
}
function controls(node){
  function button(title,run,attributes={}){
    const b=node('button',title,{type:'button',...attributes});b.onclick=run;return b;
  }
  function field(parent,title,name,tag='input',attrs={}){
    const label=node('label',title);
    const input=node(tag,'',{name,...attrs});
    label.append(input);parent.append(label);return input;
  }
  function select(parent,title,name,options){
    const input=field(parent,title,name,'select',{required:''});
    for(const [key,label] of options)input.append(node('option',label,{value:key}));
    return input;
  }
  function form(parent,label,run){
    const form=node('form'), status=node('p','',{role:'status','aria-live':'polite',class:'status'});
    parent.append(form,status);
    const finish=()=>{
      const send=node('button',label,{type:'submit',class:'primary'});
      form.append(send);
      form.onsubmit=async event=>{
        event.preventDefault();send.disabled=true;status.textContent='';
        try{const info=await run(new FormData(form));status.dataset.error='false';status.textContent=info||'تم الحفظ.';form.reset();}
        catch(error){status.dataset.error='true';status.textContent=error.message||'تعذّر تنفيذ الطلب.';}
        finally{send.disabled=false;}
      };
    };
    return {form,finish};
  }
  return {button,field,select,form};
}
export function communityPanel({main,user,db,community,node,names,alarmNav,alarmArea}){
  const c=controls(node), wrapper=node('section','',{class:'study-section'});
  const nav=node('nav','',{'aria-label':'أدوات الطالب'}), pane=node('section','',{class:'admin-card',hidden:''});
  wrapper.append(node('h2','أدوات الدراسة'),nav,pane);main.append(wrapper);
  const reminders=collection(db,'students',user.uid,'reminders');
  let activePanel='';
  const tab=(id,title,render)=>{
    const button=c.button(title,()=>{
      activePanel=id;pane.hidden=false;
      for(const b of nav.children)b.setAttribute('aria-pressed',String(b===button));
      pane.replaceChildren(node('h3',title));render();
    });
    nav.append(button);return button;
  };
  const alarmPane=node('section','',{id:'exam-reminders',hidden:''});
  const alarmCard=node('div','',{class:'admin-card'});
  alarmPane.append(alarmCard);
  const notices=node('div','',{role:'status','aria-live':'polite'});
  alarmArea.append(notices,alarmPane);
  const alarmButton=c.button('التنبيهات',()=>{
    alarmPane.hidden=!alarmPane.hidden;
    alarmButton.setAttribute('aria-expanded',String(!alarmPane.hidden));
    if(!alarmPane.hidden)drawAlarms(list);
  },{'aria-expanded':'false','aria-controls':'exam-reminders'});
  alarmNav.append(alarmButton);
  alarmCard.append(node('h3','منبّه الامتحانات'));
  const draft=c.form(alarmCard,'حفظ الموعد',async values=>{
    const at=new Date(values.get('at')).getTime();
    if(!Number.isFinite(at)||at<=Date.now())throw new Error('اختر موعدًا في المستقبل.');
    await addDoc(reminders,{title:values.get('title').trim(),at,lead:Number(values.get('lead'))});
    return 'تم حفظ الموعد.';
  });
  c.field(draft.form,'عنوان الامتحان أو الكويز','title','input',{required:'',maxlength:'120'});
  c.field(draft.form,'الموعد','at','input',{required:'',type:'datetime-local'});
  c.select(draft.form,'ذكّرني قبل الموعد بـ','lead',[[15,'١٥ دقيقة'],[30,'٣٠ دقيقة'],[60,'ساعة'],[1440,'يوم']]);
  draft.finish();
  const list=node('div');
  alarmCard.append(list,node('p','للتذكير والموقع مسكّر، أضف الموعد لتقويم جهازك وتأكد من تفعيل إشعارات التقويم.',{class:'muted'}));
  let alarms=[];
  const seen=new Set();
  function check(){
    const now=Date.now();
    for(const row of alarms)if(row.at>now&&row.at-row.lead*60000<=now&&!seen.has(row.id)){
      seen.add(row.id);
      const alert=node('p','اقترب موعد «'+row.title+'» — '+formatDate(row.at),{class:'status'});
      notices.append(alert);
    }
    if(!alarmPane.hidden)drawAlarms(list);
  }
  function drawAlarms(list){
    const now=Date.now();
    list.replaceChildren();
    if(!alarms.length)list.append(node('p','ما عندك مواعيد محفوظة.',{class:'muted'}));
    for(const row of alarms){
      const left=Math.ceil((row.at-now)/60000);
      const timer=left<=0?'انتهى الموعد':Math.floor(left/1440)+' يوم، '+Math.floor((left%1440)/60)+' ساعة، '+left%60+' دقيقة';
      const line=node('div','',{class:'admin-row'});
      line.append(node('span',row.title+' · '+formatDate(row.at)+' · '+timer));
      if(left>0)line.append(c.button('أضف للتقويم',()=>{
        const url=URL.createObjectURL(new Blob([reminderCalendar(row)],{type:'text/calendar;charset=utf-8'}));
        const link=node('a','',{href:url,download:'exam-'+row.id+'.ics'});
        document.body.append(link);link.click();link.remove();
        setTimeout(()=>URL.revokeObjectURL(url),5000);
      }));
      line.append(c.button('إزالة',async()=>{
        try{await deleteDoc(doc(reminders,row.id));}catch{notices.append(node('p','تعذّر إزالة الموعد.',{class:'status','data-error':'true'}));}
      }));
      list.append(line);
    }
  }
  const unsubscribe=onSnapshot(reminders,snapshot=>{
    alarms=snapshot.docs.map(x=>({id:x.id,...x.data()})).sort((a,b)=>a.at-b.at);check();
  },()=>notices.append(node('p','تعذّر تحميل مواعيدك.',{class:'status','data-error':'true'})));
  const timer=setInterval(check,30000);
  window.addEventListener('pagehide',e=>{if(!e.persisted){unsubscribe();clearInterval(timer);}},{once:true});
  tab('summaries','ملخصات المحاضرات',async()=>{
    const content=node('div','جارٍ تحميل الملخصات…');pane.append(content);
    try{
      const {items}=await community({action:'summaries'});
      if(activePanel!=='summaries'||!content.isConnected)return;
      content.replaceChildren();
      if(!items.length)content.append(node('p','لا توجد ملخصات منشورة لموادك.',{class:'muted'}));
      for(const item of items){
        const line=node('div','',{class:'admin-row'});
        const download=c.button('تحميل PDF',async()=>{
          download.disabled=true;
          try{
            const response=await community({action:'summaryFile',id:item.id});
            const url=URL.createObjectURL(new Blob([decode(response.content)],{type:'application/pdf'}));
            const a=node('a','',{href:url,download:item.title+'.pdf'});document.body.append(a);a.click();a.remove();
            setTimeout(()=>URL.revokeObjectURL(url),2000);
          }catch(error){line.append(node('p',error.message,{class:'status','data-error':'true'}));}
          finally{download.disabled=false;}
        });
        line.append(node('span',item.title+(names.has(item.subject)?' · '+names.get(item.subject):'')),download);content.append(line);
      }
    }catch{content.textContent='تعذّر تحميل الملخصات.';}
  });
  tab('requests','طلب مادة أو سنة',()=>{
    const draft=c.form(pane,'إرسال الطلب',async values=>{
      await community({action:'request',title:values.get('title'),year:values.get('year')});return 'وصل طلبك لصاحب الموقع.';
    });
    c.field(draft.form,'اسم المادة','title','input',{required:'',maxlength:'120'});
    c.field(draft.form,'السنة المطلوبة (اختياري)','year','input',{inputmode:'numeric',pattern:'(19|20)[0-9]{2}',maxlength:'4'});
    draft.finish();
  });
  tab('contact','تواصل مع صاحب الموقع',()=>{
    const draft=c.form(pane,'إرسال الرسالة',async values=>{
      await community({action:'contact',title:values.get('title'),body:values.get('body')});return 'تم إرسال رسالتك إلى صاحب الموقع.';
    });
    c.field(draft.form,'عنوان الاقتراح أو الشكوى','title','input',{required:'',maxlength:'120'});
    c.field(draft.form,'الرسالة','body','textarea',{required:'',rows:'4',maxlength:'1500'});draft.finish();
  });
}
export function examConversation({pane,community,node,exam}){
  const c=controls(node), title=node('h3','الحلول والنقاش'), comments=node('div');
  pane.append(title,comments);
  let page=0, generation=0;
  async function refresh(){
    const request=++generation;
    comments.textContent='جارٍ تحميل النقاش…';
    try{
      const {items}=await community({action:'discussion',exam,page});
      if(request!==generation)return;
      comments.replaceChildren();
      if(!items.length)comments.append(node('p','لا توجد مشاركات على هذه الصورة.',{class:'muted'}));
      for(const item of items){
        const card=node('article','',{class:'discussion-item'});
        card.append(node('strong',item.authorName),node('p',item.body),node('small',formatDate(item.createdAt),{class:'muted'}));
        comments.append(card);
      }
    }catch{if(request===generation)comments.textContent='تعذّر تحميل النقاش.';}
  }
  const add=c.form(pane,'نشر المشاركة',async data=>{
    const target=page;
    await community({action:'comment',exam,page:target,body:data.get('body')});
    if(page===target)await refresh();
    return 'تم نشر المشاركة.';
  });
  c.field(add.form,'اكتب حلًا أو تعليقًا','body','textarea',{required:'',maxlength:'1500',rows:'3'});
  add.finish();
  const details=node('details');details.append(node('summary','الإبلاغ عن خطأ'));pane.append(details);
  const report=c.form(details,'إرسال البلاغ',async data=>{
    await community({action:'report',exam,page,kind:data.get('kind'),body:data.get('body')});
    return 'وصل البلاغ لصاحب الموقع.';
  });
  c.select(report.form,'نوع المشكلة','kind',[['image','خطأ في الصورة'],['solution','خطأ في الحل']]);
  c.field(report.form,'وصف المشكلة','body','textarea',{required:'',maxlength:'1500',rows:'3'});report.finish();
  return index=>{page=index;title.textContent='الحلول والنقاش · صورة '+(index+1);add.form.reset();report.form.reset();refresh();};
}
