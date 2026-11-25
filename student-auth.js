const studentLifetime = 7 * 24 * 3600;
const hex = bytes => Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
const randomHex = size => hex(crypto.getRandomValues(new Uint8Array(size)));
const studentCookie = (request,value,age) => cookie(request,value,age).replace('archive_admin=','archive_student=');

async function passwordHash(password,salt) {
  const key = await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({
    name:'PBKDF2',salt:encoder.encode(salt),iterations:100000,hash:'SHA-256'
  },key,256));
}

async function studentSession(request,stmt) {
  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)archive_student=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) return null;
  const hash = hex(await digest(token));
  return {hash,row:await stmt(
    'SELECT student_sessions.student_number, full_name FROM student_sessions JOIN students USING (student_number) WHERE token_hash=? AND expires_at>?',
    hash,Date.now()
  ).first()};
}

async function studentAuth(path,request,stmt) {
  const method=request.method;
  if (path === '/api/students/session') {
    const session=await studentSession(request,stmt);
    if(method==='GET') return json({student:session?.row ? {name:session.row.full_name} : null});
    if(method==='DELETE') {
      if(session) await stmt('DELETE FROM student_sessions WHERE token_hash=?',session.hash).run();
      return Response.json({student:null},{headers:{'Set-Cookie':studentCookie(request,'',0),'Cache-Control':'no-store'}});
    }
  }
  const register=path==='/api/students/register';
  if (method!=='POST' || (!register && path!=='/api/students/login')) fail('العملية غير متاحة.',405);
  if (Number(request.headers.get('content-length'))>4096) fail('بيانات الطلب أكبر من المسموح.',413);
  const raw=await request.text();
  if(raw.length>4096) fail('بيانات الطلب أكبر من المسموح.',413);
  const data=JSON.parse(raw);
  if(!data || typeof data!=='object') fail('تحقّق من البيانات المدخلة.');
  const number=clean(data.student_number,20).replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-1632))
    .replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-1776));
  if (!/^\d{1,20}$/.test(number)) fail('أدخل رقمًا جامعيًا صحيحًا.');
  const password=data.password;
  if(typeof password!=='string'||!password||password.length>128) fail('أدخل كلمة مرور صالحة.');
  const window=Math.floor(Date.now()/600000);
  const ip=request.headers.get('cf-connecting-ip') || 'local';
  const buckets=[[(register?'reg:':'login:')+ip,register?15:80],['number:'+number,10]];
  for(const [bucket,limit] of buckets) {
    const result=await stmt('INSERT INTO auth_limits(bucket,window,attempts) VALUES (?,?,1) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN auth_limits.window=excluded.window THEN auth_limits.attempts+1 ELSE 1 END,window=excluded.window RETURNING attempts',
      hex(await digest(bucket)),window).first();
    if(result.attempts>limit) fail('محاولات كثيرة. حاول مجددًا بعد بضع دقائق.',429);
  }
  if(register) {
    if(password.length<8||!/[A-Z]/.test(password)||!/[0-9٠-٩۰-۹]/.test(password)||!/[^\p{L}\p{N}\s]/u.test(password))
      fail('استخدم ٨ أحرف على الأقل، وحرفًا إنجليزيًا كبيرًا ورقمًا ورمزًا مثل @ أو $.');
    if(password!==data.confirmation) fail('كلمتا المرور غير متطابقتين.');
    const fullName=clean(data.full_name,120).replace(/\s+/g,' ');
    if(fullName.length<2) fail('أدخل الاسم الكامل.');
    const email=clean(data.email,254).toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('أدخل بريدًا إلكترونيًا صالحًا.');
    if(!['female','male','undisclosed'].includes(data.gender)) fail('اختر الجنس من القائمة.');
    const birth=clean(data.birth_date,10);
    const epoch=Date.parse(birth+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(birth)||!Number.isFinite(epoch)||
      new Date(epoch).toISOString().slice(0,10)!==birth||birth<'1900-01-01'||epoch>Date.now()) fail('أدخل تاريخ ميلاد صحيحًا.');
    const salt=randomHex(16);
    try {
      await stmt('INSERT INTO students VALUES (?,?,?,?,?,?,?)',number,fullName,email,data.gender,birth,
        hex(await passwordHash(password,salt)),salt).run();
    } catch(error) {
      if(/unique constraint/i.test(error.message)) fail('تعذّر إنشاء الحساب بهذه البيانات. إذا لديك حساب، جرّب تسجيل الدخول.',409);
      throw error;
    }
  } else {
    const student=await stmt('SELECT salt,password_hash FROM students WHERE student_number=?',number).first();
    const hash=hex(await passwordHash(password,student?.salt??'00000000000000000000000000000000'));
    if(!equal(encoder.encode(hash),encoder.encode(student?.password_hash??'0'.repeat(64)))||!student)
      fail('الرقم الجامعي أو كلمة المرور غير صحيحة.',401);
  }
  const token=randomHex(32);
  await stmt('DELETE FROM student_sessions WHERE expires_at<=?',Date.now()).run();
  await stmt('DELETE FROM auth_limits WHERE window<?',window-1).run();
  await stmt('INSERT INTO student_sessions VALUES (?,?,?)',hex(await digest(token)),number,Date.now()+studentLifetime*1000).run();
  return Response.json({ok:true},{status:register?201:200,headers:{
    'Set-Cookie':studentCookie(request,token,studentLifetime),'Cache-Control':'no-store'
  }});
}
