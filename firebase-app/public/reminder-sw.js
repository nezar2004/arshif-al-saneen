self.addEventListener('push',event=>{
  if(!event.data)return;
  event.waitUntil((async()=>{
    const payload=event.data.json();
    await self.registration.showNotification(payload.title,{
      body:payload.body,tag:'exam-'+payload.id,renotify:false
    });
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const url=new URL('/library',self.location.origin).href;
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=clients.find(client=>client.url===url);
    if(existing)await existing.focus();
    else await self.clients.openWindow(url);
  })());
});
