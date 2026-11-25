const encoder = new TextEncoder();
const json = (data, status = 200) => Response.json(data, {status, headers:{'Cache-Control':'no-store'}});
const fail = (message, status = 400) => { throw Object.assign(new Error(message), {status}); };
const id = () => crypto.randomUUID();
const uuid = /^[0-9a-f-]{36}$/;
const maxFile = 20 * 1024 * 1024;
const types = {'application/pdf':'.pdf','image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp'};

function clean(value, max, required = true) {
  const result = typeof value === 'string' ? value.trim() : '';
  if ((required && !result) || result.length > max) fail('تحقّق من الحقول المطلوبة وطول النص.');
  return result;
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

function equal(a,b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function signature(password, value) {
  const key = await crypto.subtle.importKey('raw',encoder.encode(password),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(value))), x => x.toString(16).padStart(2,'0')).join('');
}

async function isAdmin(request, env) {
  const email = request.headers.get('oai-authenticated-user-email');
  if (env.SITES_ADMIN_EMAIL && email?.toLowerCase() === env.SITES_ADMIN_EMAIL.toLowerCase()) return true;
  if (!env.ADMIN_PASSWORD) return false;
  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)archive_admin=(\d{13})\.([a-f0-9]{64})(?:;|$)/);
  return Boolean(token && Number(token[1]) > Date.now() &&
    equal(encoder.encode(token[2]), encoder.encode(await signature(env.ADMIN_PASSWORD, token[1]))));
}

function cookie(request, value, age) {
  return 'archive_admin=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + age +
    (new URL(request.url).protocol === 'https:' ? '; Secure' : '');
}

async function api(request, env, url) {
  const { pathname:path, searchParams:params } = url;
  const method = request.method;
  const stmt = (sql, ...values) => env.DB.prepare(sql).bind(...values);
  const all = async (sql, ...values) => (await stmt(sql, ...values).all()).results;

  if (method !== 'GET' && method !== 'HEAD' && request.headers.get('origin') !== url.origin) fail('الطلب غير مسموح.',403);
  if (path.startsWith('/api/students/')) return await studentAuth(path,request,stmt);
  if (path === '/api/session' && method === 'GET') {
    return json({admin:await isAdmin(request,env), password:Boolean(env.ADMIN_PASSWORD), sites:Boolean(env.SITES_ADMIN_EMAIL)});
  }
  if (path === '/api/session' && method === 'POST') {
    if (!env.ADMIN_PASSWORD) fail('لم يُضبط مفتاح الإدارة بعد.',503);
    const {password} = await request.json();
    if (!equal(await digest(clean(password,512)),await digest(env.ADMIN_PASSWORD))) fail('مفتاح الإدارة غير صحيح.',401);
    const time = String(Date.now() + 8 * 3600 * 1000);
    return Response.json({admin:true},{headers:{'Set-Cookie':cookie(request,time + '.' + await signature(env.ADMIN_PASSWORD,time),28800),'Cache-Control':'no-store'}});
  }
  if (path === '/api/session' && method === 'DELETE') {
    return Response.json({admin:false},{headers:{'Set-Cookie':cookie(request,'',0),'Cache-Control':'no-store'}});
  }
  if (path === '/api/catalog' && method === 'GET') {
    if (!(await studentSession(request,stmt))?.row && !await isAdmin(request,env)) fail('سجّل الدخول إلى المكتبة.',401);
    const [departments,subjects,papers,files] = await Promise.all([
      all('SELECT * FROM departments ORDER BY name'),
      all('SELECT * FROM subjects ORDER BY name'),
      all('SELECT * FROM papers ORDER BY year DESC, title'),
      all('SELECT * FROM files ORDER BY name')
    ]);
    return json({departments,subjects,papers,files});
  }

  const match = path.match(/^\/api\/(departments|subjects|papers|files)(?:\/([0-9a-f-]{36}))?$/);
  if (!match) fail('الصفحة غير موجودة.',404);
  const [,table,key] = match;
  if (table === 'files' && key && ['GET','HEAD'].includes(method)) {
    if (!(await studentSession(request,stmt))?.row && !await isAdmin(request,env)) fail('سجّل الدخول إلى المكتبة.',401);
    const row = await stmt('SELECT * FROM files WHERE id = ?',key).first();
    if (!row) fail('الملف غير موجود.',404);
    const object = method === 'HEAD' ? await env.BUCKET.head(key) : await env.BUCKET.get(key);
    if (!object) fail('الملف غير موجود.',404);
    const attachment = params.has('download') ? 'attachment' : 'inline';
    const filename = encodeURIComponent(row.name).replace(/['()*]/g,c => '%' + c.charCodeAt(0).toString(16));
    return new Response(method === 'HEAD' ? null : object.body,{headers:{
      'Content-Type':row.mime, 'Content-Length':String(object.size),
      'Content-Disposition':attachment + "; filename*=UTF-8''" + filename,
      'X-Content-Type-Options':'nosniff', 'Cache-Control':'no-store',
      'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"
    }});
  }

  if (!await isAdmin(request,env)) fail('سجّل الدخول إلى لوحة الإدارة.',401);
  if (table === 'files' && method === 'POST' && !key) {
    const length = Number(request.headers.get('content-length'));
    if (length > maxFile + 65536) fail('حجم الملف يتجاوز ٢٠ م.ب.',413);
    const paper = url.searchParams.get('paper') ?? '';
    if (!uuid.test(paper) || !await stmt('SELECT id FROM papers WHERE id=?',paper).first()) fail('اختر امتحانًا موجودًا.');
    const file = (await request.formData()).get('file');
    if (!(file instanceof File) || file.size > maxFile) fail('اختر ملفًا بحجم ٢٠ م.ب. أو أقل.',413);
    const bytes = new Uint8Array(await file.slice(0,12).arrayBuffer());
    const starts = (...prefix) => prefix.every((byte,i) => bytes[i] === byte);
    const ascii = new TextDecoder().decode(bytes);
    const mime = ascii.startsWith('%PDF-') ? 'application/pdf' :
      starts(137,80,78,71,13,10,26,10) ? 'image/png' :
      starts(255,216,255) ? 'image/jpeg' :
      ascii.startsWith('RIFF') && ascii.slice(8,12) === 'WEBP' ? 'image/webp' : null;
    if (!mime) fail('الصيغ المقبولة هي PDF و PNG و JPG و WebP.');
    const fileId = id();
    const name = clean(file.name.replace(/[\u0000-\u001f\u007f]/g,''),180);
    await env.BUCKET.put(fileId,file.stream());
    try {
      await stmt('INSERT INTO files (id,paper,name,mime) VALUES (?,?,?,?)',fileId,paper,name,mime).run();
    } catch (error) {
      await env.BUCKET.delete(fileId);
      throw error;
    }
    return json({id:fileId},201);
  }

  if (method === 'DELETE' && key) {
    if (table === 'files') {
      if (!await stmt('SELECT id FROM files WHERE id=?',key).first()) fail('الملف غير موجود.',404);
      await env.BUCKET.delete(key);
    }
    try {
      const result = await stmt('DELETE FROM ' + table + ' WHERE id=?',key).run();
      if (!result.meta.changes) fail('العنصر غير موجود.',404);
    } catch (error) {
      if (/foreign key/i.test(error.message)) fail('احذف العناصر المرتبطة أولًا.',409);
      throw error;
    }
    return json({ok:true});
  }

  if ((method === 'POST' && !key && table !== 'files') || (method === 'PUT' && key)) {
    const data = await request.json();
    let columns, values;
    if (table === 'departments' || table === 'files') {
      columns = ['name'];
      values = [clean(data.name,table === 'files' ? 180 : 120)];
    } else if (table === 'subjects') {
      columns = ['name','department'];
      values = [clean(data.name,120),clean(data.department,36)];
    } else {
      if (!['mid','final','makeup'].includes(data.kind) || !Number.isInteger(data.year) || data.year < 1900 || data.year > 2100) fail('اختر نوع الامتحان وأدخل سنة صحيحة.');
      columns = ['title','subject','kind','year','note'];
      values = [clean(data.title,160),clean(data.subject,36),data.kind,data.year,clean(data.note,12000,false)];
    }
    const rowId = key ?? id();
    const sql = key ? 'UPDATE ' + table + ' SET ' + columns.map(column => column + '=?').join(',') + ' WHERE id=?' :
      'INSERT INTO ' + table + '(' + columns.join(',') + ',id) VALUES (' + [...columns,'id'].map(() => '?').join(',') + ')';
    try {
      const result = await stmt(sql,...values,rowId).run();
      if (!result.meta.changes) fail('العنصر غير موجود.',404);
    } catch (error) {
      if (/unique constraint/i.test(error.message)) fail('هذا الاسم موجود بالفعل في التصنيف نفسه.',409);
      if (/foreign key/i.test(error.message)) fail('اختر تصنيفًا موجودًا.',409);
      throw error;
    }
    return json({id:rowId},key ? 200 : 201);
  }
  fail('العملية غير متاحة.',405);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) return await api(request,env,url);
      if (url.pathname === '/library') {
        const stmt = (sql,...args) => env.DB.prepare(sql).bind(...args);
        if (!(await studentSession(request,stmt))?.row && !await isAdmin(request,env)) {
          return new Response(null,{status:303,headers:{Location:'/', 'Cache-Control':'no-store'}});
        }
      }
      const asset = assets[['/admin','/owner','/register','/library'].includes(url.pathname) ? '/' : url.pathname];
      if (!asset || !['GET','HEAD'].includes(request.method)) fail('الصفحة غير موجودة.',404);
      return new Response(request.method === 'HEAD' ? null : asset[0],{headers:{
        'Content-Type':asset[1] + '; charset=utf-8',
        'Content-Security-Policy':"default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin',
        'Cache-Control':asset[1] === 'text/html' ? 'no-store' : 'no-cache'
      }});
    } catch (error) {
      if (!error.status && !(error instanceof SyntaxError)) console.error(error);
      return json({error:error.status ? error.message : error instanceof SyntaxError ? 'بيانات الطلب غير صالحة.' : 'تعذّر تنفيذ الطلب. حاول مرة أخرى.'},error.status ?? (error instanceof SyntaxError ? 400 : 500));
    }
  }
};
