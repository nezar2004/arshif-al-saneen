const {createHash,timingSafeEqual}=require('node:crypto');
const webpush=require('web-push');

const invalid=message=>{throw new Error(message);};
const subscriptionId=endpoint=>createHash('sha256').update(endpoint).digest('hex');
function subscriptionFrom(value){
  const {endpoint,keys}=value??{};
  if(typeof endpoint!=='string'||endpoint.length>2048)invalid('اشتراك الجهاز غير صالح.');
  const url=new URL(endpoint);
  const allowed=['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com','wns.windows.com'];
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||
      !allowed.some(host=>url.hostname===host||url.hostname.endsWith('.'+host)))invalid('خدمة الإشعارات لهذا المتصفح غير مدعومة.');
  const auth=keys?.auth,p256dh=keys?.p256dh;
  if(!/^[A-Za-z0-9_-]{22}$/.test(auth)||!/^[A-Za-z0-9_-]{87}$/.test(p256dh))invalid('مفاتيح اشتراك الجهاز غير صالحة.');
  return {endpoint,keys:{auth,p256dh}};
}
const matching=(actual,expected)=>{
  const a=Buffer.from(actual??''),b=Buffer.from(expected??'');
  return b.length>=32&&a.length===b.length&&timingSafeEqual(a,b);
};

function reminderPush({db}){
  const publicKey=process.env.ARCHIVE_PUSH_PUBLIC_KEY,privateKey=process.env.ARCHIVE_PUSH_PRIVATE_KEY;
  const enabled=Boolean(publicKey&&privateKey&&process.env.ARCHIVE_PUSH_CRON_SECRET);
  const devices=db.collection('pushDevices'),jobs=db.collection('pushReminders');
  const queue=(uid,ref,data)=>({
    uid,path:ref.path,dueAt:data.at-data.lead*60000,expiresAt:data.at
  });
  async function action(uid,data){
    const reminders=db.collection('students').doc(uid).collection('reminders');
    switch(data.action){
      case 'config':return {publicKey:enabled?publicKey:null};
      case 'enable':{
        if(!enabled)invalid('إشعارات الجهاز غير متاحة حاليًا.');
        let value;
        try{value=subscriptionFrom(data.subscription);}catch{invalid('اشتراك الجهاز غير صالح أو المتصفح غير مدعوم.');}
        const ref=devices.doc(subscriptionId(value.endpoint));
        await ref.set({uid,subscription:value});
        const future=await reminders.where('at','>',Date.now()).get();
        await Promise.all(future.docs.map(async item=>{
          const job=jobs.doc(item.id);
          const payload=queue(uid,item,item.data());
          if(payload.dueAt<=Date.now())return;
          try{await job.create(payload);}catch(error){if(error.code!==6)throw error;}
        }));
        return {ok:true};
      }
      case 'disable':{
        if(typeof data.endpoint!=='string'||data.endpoint.length>2048)invalid('اشتراك الجهاز غير صالح.');
        const ref=devices.doc(subscriptionId(data.endpoint));
        await db.runTransaction(async tx=>{if((await tx.get(ref)).data()?.uid===uid)tx.delete(ref);});
        return {ok:true};
      }
      case 'save':{
        const title=typeof data.title==='string'?data.title.trim():'';
        if(!title||title.length>120||!Number.isSafeInteger(data.at)||data.at<=Date.now()||
            ![15,30,60,1440].includes(data.lead))invalid('أدخل عنوانًا وموعدًا في المستقبل.');
        const ref=reminders.doc(), row={title,at:data.at,lead:data.lead};
        await db.batch().create(ref,row).create(jobs.doc(ref.id),queue(uid,ref,row)).commit();
        return {ok:true};
      }
      case 'remove':{
        if(!/^[a-zA-Z0-9_-]{1,100}$/.test(data.id))invalid('الموعد غير صالح.');
        const ref=reminders.doc(data.id),job=jobs.doc(data.id);
        await db.runTransaction(async tx=>{
          const [reminder,push]=await tx.getAll(ref,job);
          if(reminder.exists)tx.delete(ref);
          if(push.data()?.path===ref.path)tx.delete(job);
        });
        return {ok:true};
      }
      default:invalid('الطلب غير صالح.');
    }
  }
  async function dispatch(req,res){
    if(!enabled||!matching(req.get('authorization'),'Bearer '+process.env.ARCHIVE_PUSH_CRON_SECRET))return res.sendStatus(404);
    const now=Date.now();
    try{
      const due=await jobs.where('dueAt','<=',now).orderBy('dueAt').limit(100).get();
      let sent=0;
      for(const job of due.docs){
        const row=job.data();
        if(row.expiresAt<=now){await job.ref.delete();continue;}
        const [role,reminder,subscribers]=await Promise.all([
          db.doc('roles/'+row.uid).get(),db.doc(row.path).get(),devices.where('uid','==',row.uid).get()
        ]);
        if(role.data()?.role==='student'&&role.data()?.active===true&&reminder.exists){
          const event=reminder.data();
          const payload=JSON.stringify({id:job.id,title:'سنوات IT',body:'اقترب موعد امتحانك: '+event.title});
          const result=await Promise.allSettled(subscribers.docs.map(async device=>{
            try{
              await webpush.sendNotification(device.data().subscription,payload,{TTL:Math.max(0,Math.floor((row.expiresAt-Date.now())/1000)),timeout:8000,
                vapidDetails:{subject:'https://arshif-saneen.onrender.com',publicKey,privateKey}});
            }catch(error){
              if([404,410].includes(error.statusCode)){await device.ref.delete();return;}
              throw error;
            }
          }));
          if(result.some(item=>item.status==='rejected'))continue;
          sent++;
        }
        await job.ref.delete();
      }
      return res.json({ok:true,processed:due.size,sent});
    }catch(error){console.error('Reminder dispatcher failed',error.code??error.name);return res.sendStatus(500);}
  }
  return {action,dispatch};
}
module.exports={reminderPush};
