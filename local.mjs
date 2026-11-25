import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import './build.mjs';
const {default:worker} = await import('./dist/server/index.js');

const dir = process.env.ARCHIVE_DATA_DIR || '.data';
await mkdir(dir + '/files',{recursive:true});
const db = new DatabaseSync(dir + '/catalog.sqlite');
for (const file of (await readdir('drizzle')).filter(name => name.endsWith('.sql')).sort()) {
  db.exec(await readFile('drizzle/' + file,'utf8'));
}
const password = process.env.ADMIN_PASSWORD || randomBytes(18).toString('base64url');
export const env = {
  ADMIN_PASSWORD:password,
  DB:{prepare(sql) {
    const statement = db.prepare(sql);
    return {bind:(...args) => ({
      all:() => ({results:statement.all(...args)}),
      first:() => statement.get(...args),
      run:() => ({meta:statement.run(...args)})
    })};
  }},
  BUCKET:{
    async put(key,stream) { await writeFile(dir+'/files/'+key,stream); },
    async get(key) {
      try {
        const data = await readFile(dir+'/files/'+key);
        return {body:data,size:data.length};
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async head(key) { return this.get(key); },
    async delete(key) { await rm(dir+'/files/'+key,{force:true}); }
  }
};

const port = Number(process.env.PORT || 4173);
const origin = 'http://127.0.0.1:' + port;
createServer(async (req,res) => {
  try {
    if (req.headers.host !== '127.0.0.1:' + port) { res.writeHead(403).end(); return; }
    const headers = new Headers(req.headers);
    headers.delete('oai-authenticated-user-email');
    const body = ['GET','HEAD'].includes(req.method) ? undefined : Readable.toWeb(req);
    const result = await worker.fetch(new Request(origin + req.url,{method:req.method,headers,body,duplex:'half'}),env);
    res.writeHead(result.status,Object.fromEntries(result.headers));
    if (result.body) Readable.fromWeb(result.body).pipe(res);
    else res.end();
  } catch (error) {
    console.error(error);
    res.writeHead(500).end();
  }
}).listen(port,'127.0.0.1',() => {
  console.log(origin);
  if (!process.env.ADMIN_PASSWORD) console.log('Local admin key: ' + password);
});

