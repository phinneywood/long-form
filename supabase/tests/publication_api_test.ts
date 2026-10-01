// Authenticated application capability boundaries with the real PostgREST client.
Deno.env.set('SUPABASE_URL','https://publication-db.example.invalid');Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','test-only-key');
const {publicationRoute}=await import('../functions/app-api/publication.ts');
const uid='10000000-0000-0000-0000-000000000001',eid='30000000-0000-0000-0000-000000000001';
function assert(v:unknown,m='Assertion failed'):asserts v{if(!v)throw Error(m)}
Deno.test('publication lists project summaries and every article lookup binds server-derived tenant',async()=>{
 const original=globalThis.fetch,calls:URL[]=[];
 globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{const r=new Request(input,init),u=new URL(r.url);calls.push(u);assert(u.hostname==='publication-db.example.invalid');assert(u.searchParams.get('user_id')==='eq.'+uid,'tenant required for every data query');let rows:any[]=[];
 if(u.pathname.endsWith('/publication_editions'))rows=[{id:eid,user_id:uid,job_id:null,kind:'daily',title:'Long Form',target_minutes:30,created_at:'2026-10-01',manifest:{items:[{title:'Actual original',source:'Publisher',url:'https://example.com/a',body:'<p>Actual original author’s text.</p>',minutes:1,position:0,origin:'subscribed',reason:'Recorded lead'}],featured:[0]}}];
 if(u.pathname.endsWith('/publication_editions')&&u.searchParams.get('select')?.includes('article:manifest->items->0'))rows=rows.map(e=>({id:e.id,article:e.manifest.items[0]}));
 const singular=r.headers.get('accept')?.includes('object');return Response.json(singular?rows[0]||null:rows);}) as typeof fetch;
 try{
 const user={id:uid,email:'test@example.com'};
 const list=await publicationRoute(new Request('https://app/publication/editions'),'/publication/editions',user);const data=await list!.json();assert(!JSON.stringify(data).includes('author’s text'),'list must not leak/load original bodies');assert(calls[0].searchParams.get('select')?.includes('manifest:summary'),'metadata projection');
 const req=new Request('https://app/reader/article',{method:'POST',body:JSON.stringify({edition_id:eid,position:0,user_id:'another-user'})});const read=await publicationRoute(req,'/reader/article',user);assert((await read!.json()).article.body.includes('Actual original'),'reader must use actual stored text');
 }finally{globalThis.fetch=original;}
});
Deno.test('job status uses bounded tenant capability rather than full frozen preparation manifests',async()=>{
 const original=globalThis.fetch;globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{const r=new Request(input,init),u=new URL(r.url),b=await r.json();assert(u.pathname.endsWith('/rpc/publication_job_status'));assert(b.p_user_id===uid);return Response.json({job:{id:eid,status:'failed',error:'Extraction failed',result:{issues:['An original could not be prepared']}},edition_id:null});}) as typeof fetch;
 try{const r=await publicationRoute(new Request('https://app/publication/job?id='+eid),'/publication/job',{id:uid,email:'test@example.com'}),data=await r!.json();assert(data.job.status==='failed'&&data.job.error==='Extraction failed');}finally{globalThis.fetch=original;}
});

Deno.test('explicit editor send reviews the owned edition without a model call or delivery side effect',async()=>{
 const original=globalThis.fetch;let stored:any=null,lookups=0;
 globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const r=new Request(input,init),u=new URL(r.url);assert(u.hostname==='publication-db.example.invalid','No model/provider calls');
  if(u.pathname.endsWith('/editor_messages')){
   if(r.method==='GET'){assert(u.searchParams.get('user_id')==='eq.'+uid);return Response.json(null);}
   stored=await r.json();assert(stored.user_id===uid);return Response.json({id:'message',...stored});
  }
  assert(u.pathname.endsWith('/publication_editions'),'No delivery side effects');assert(u.searchParams.get('user_id')==='eq.'+uid&&u.searchParams.get('id')==='eq.'+eid);lookups++;
  return Response.json({id:eid,title:'Tonight’s Reading',manifest:{items:[]}});
 }) as typeof fetch;
 try{
  const r=await publicationRoute(new Request('https://app/editor/message',{method:'POST',body:JSON.stringify({question:'Send this to my Kindle.',edition_id:eid,request_key:'explicit-send-review',user_id:'another-user'})}),'/editor/message',{id:uid,email:'test@example.com'});
  const result=await r!.json();assert(lookups===1&&result.message.response.send_request.edition_id===eid);assert(result.message.response.answer.includes('Nothing has been sent'));
 }finally{globalThis.fetch=original;}
});

Deno.test('reading progress never loads complete-edition bodies and negative positions never reach the database',async()=>{
 const original=globalThis.fetch;let projected=false,updated=false;
 globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{const r=new Request(input,init),u=new URL(r.url);
 if(u.pathname.endsWith('/publication_editions')){assert(u.searchParams.get('user_id')==='eq.'+uid);assert(u.searchParams.get('select')==='id,article:manifest->items->0->url');projected=true;return Response.json({id:eid,article:'https://example.com/original'});}
 assert(u.pathname.endsWith('/rpc/update_reading_state'));const p=await r.json();assert(p.p_user_id===uid&&p.p_article_key===eid+':0'&&p.p_progress===.42&&p.p_saved===null);updated=true;return Response.json(true);}) as typeof fetch;
 try{const r=await publicationRoute(new Request('https://app/reader/state',{method:'PATCH',body:JSON.stringify({edition_id:eid,position:0,progress:.42,paragraph:2})}),'/reader/state',{id:uid,email:'test@example.com'});assert((await r!.json()).ok&&projected&&updated);
 globalThis.fetch=async()=>{throw Error('Negative position queried the database')};let rejected=false;try{await publicationRoute(new Request('https://app/reader/article',{method:'POST',body:JSON.stringify({edition_id:eid,position:-1})}),'/reader/article',{id:uid,email:'test@example.com'});}catch(error){rejected=(error as any).status===404;}assert(rejected);
 }finally{globalThis.fetch=original;}
});
