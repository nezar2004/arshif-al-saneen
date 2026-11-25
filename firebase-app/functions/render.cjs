const express=require('express');
const path=require('node:path');
const required=['ARCHIVE_FIREBASE_CREDENTIALS','ARCHIVE_WEB_API_KEY','ARCHIVE_SUPABASE_URL','ARCHIVE_SUPABASE_KEY'];
const missing=required.filter(name=>!process.env[name]);
const localEmulators=!process.env.RENDER&&['FIREBASE_AUTH_EMULATOR_HOST','FIRESTORE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'].every(name=>process.env[name]);
if(missing.length&&!localEmulators)throw new Error('Missing configuration: '+missing.join(', '));
const handlers=require('./index.js');
const app=express();
app.disable('x-powered-by');
app.set('trust proxy',1);
app.get('/healthz',(_req,res)=>res.json({ok:true}));
const parse=express.json({limit:'15mb'});
for(const name of ['accounts','management','library','community']){
  app.post('/api/'+name,parse,(req,res)=>handlers[name](req,res));
}
const publicDir=path.join(__dirname,'../public');
app.use(express.static(publicDir,{index:false}));
app.get(/^\/(?:|register\/?|activate\/?|verify\/?|reset\/?|staff\/?|library\/?|workspace\/?)$/,(_req,res)=>res.sendFile(path.join(publicDir,'index.html')));
app.use((_req,res)=>res.sendStatus(404));
app.use((error,_req,res,_next)=>{
  if(res.headersSent)return res.end();
  const large=error.type==='entity.too.large';
  res.status(large?413:400).json({error:{status:large?'RESOURCE_EXHAUSTED':'INVALID_ARGUMENT',message:large?'حجم الملف أكبر من المسموح.':'بيانات الطلب غير صالحة.'}});
});
const server=app.listen(Number(process.env.PORT||10000),'0.0.0.0');
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
