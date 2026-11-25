function supabaseBucket(){
  const endpoint=new URL(process.env.ARCHIVE_SUPABASE_URL);
  if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.supabase.co')||endpoint.username||endpoint.password)
    throw new Error('Supabase project URL is invalid.');
  const key=process.env.ARCHIVE_SUPABASE_KEY;
  const bucket=process.env.ARCHIVE_SUPABASE_BUCKET||'exam-archive';
  if(!key||!/^[a-zA-Z0-9_-]+$/.test(bucket))throw new Error('Private storage is not configured.');
  const headers={apikey:key,...(key.startsWith('ey')?{Authorization:'Bearer '+key}:{})};
  async function request(url,options={}){
    const res=await fetch(new URL('/storage/v1/'+url,endpoint),{
      ...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(25000)
    });
    if(!res.ok){
      let remote;
      try{remote=await res.json();}catch{}
      throw Object.assign(new Error('Private storage request failed.'),{code:Number(remote?.statusCode)||res.status});
    }
    return res;
  }
  return {file(path){
    const object=bucket+'/'+path.split('/').map(encodeURIComponent).join('/');
    return {
      async download({start,end}={}){
        const response=await request('object/authenticated/'+object,start===undefined?{}:{headers:{Range:'bytes='+start+'-'+end}});
        const bytes=Buffer.from(await response.arrayBuffer());
        return [start===undefined||response.status===206?bytes:bytes.subarray(start,end+1)];
      },
      async getMetadata(){
        const data=await (await request('object/info/'+object)).json();
        return [{size:data.metadata?.size,contentType:data.metadata?.mimetype}];
      },
      async save(bytes,{contentType}){
        await request('object/'+object,{method:'POST',headers:{'Content-Type':contentType,'x-upsert':'false'},body:bytes});
      },
      async delete({ignoreNotFound}={}){
        try{await request('object/'+bucket,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[path]})});}
        catch(error){if(!ignoreNotFound||error.code!==404)throw error;}
      }
    };
  }};
}
module.exports={supabaseBucket};
