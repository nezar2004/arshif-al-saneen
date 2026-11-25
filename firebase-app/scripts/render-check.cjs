const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const root='http://127.0.0.1:4188';
const child=spawn(process.execPath,['functions/render.cjs'],{stdio:'inherit',env:{
  ...process.env,PORT:'4188',GCLOUD_PROJECT:'demo-archive-phase',
  FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080',
  FIREBASE_STORAGE_EMULATOR_HOST:'127.0.0.1:9199',STORAGE_EMULATOR_HOST:'http://127.0.0.1:9199'
}});
async function request(name,data,token){
  return fetch(root+'/api/'+name,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({data})});
}
async function run(){
  let ready;
  for(let i=0;i<25&&!ready;i++){
    try{ready=await fetch(root+'/healthz');}catch{await new Promise(r=>setTimeout(r,200));}
  }
  assert.equal(ready?.status,200);
  assert.match(await (await fetch(root+'/staff')).text(),/أرشيف السنوات/);
  assert.equal((await request('management',{action:'uploadImage'})).status,403);
  const login=await request('accounts',{action:'login',number:'7000000001',password:'Archive!Demo27'});
  const jwt=await login.json();
  assert.equal(login.status,200,JSON.stringify(jwt).slice(0,250));
  const loginToken=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:jwt.result.token,returnSecureToken:true})});
  const user=await loginToken.json();
  const exams=await request('library',{action:'list'},user.idToken);
  assert.equal(exams.status,200);
  assert.ok((await exams.json()).result.exams.length);
  const response=await request('management',{action:'uploadImage'},user.idToken);
  assert.equal(response.status,403);
  console.log('Render HTTP server passed health, Firebase login, library and upload authorization checks.');
}
run().catch(error=>{console.error(error.message);process.exitCode=1}).finally(()=>child.kill());
