Deno.env.set('SUPABASE_URL','https://history-db.example.invalid');Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','test-only-key');
let handler!: (req:Request)=>Promise<Response>;const serve=Deno.serve;
Deno.serve=((fn:any)=>{handler=fn;return {};}) as typeof Deno.serve;
try{await import('../functions/app-api/index.ts');}finally{Deno.serve=serve;}
function assert(v:unknown,m='Assertion failed'):asserts v{if(!v)throw Error(m)}
Deno.test('shared history is tenant bounded and keeps preparation-only jobs out of delivery attempts',async()=>{
 const original=globalThis.fetch;let reads=0;
 globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{const r=new Request(input,init),u=new URL(r.url);
  assert(u.hostname==='history-db.example.invalid');
  if(u.pathname.endsWith('/rpc/authenticate_app_session'))return Response.json([{session_id:'s1',user_id:'owned-user',email:'reader@example.com'}]);
  assert(r.method==='GET'&&u.searchParams.get('user_id')==='eq.owned-user'&&u.searchParams.get('limit')==='100');reads++;
  if(u.pathname.endsWith('/article_deliveries'))return Response.json([{title:'Original',canonical_url:'https://example.com/a',delivered_at:'2026-10-01',delivery_kind:'one_time',digests:{job_id:'sent-job',edition_name:'My packet'}}]);
  assert(u.pathname.endsWith('/digest_jobs'));assert(u.searchParams.get('reason')==='in.(scheduled,manual,test,one_time)','Prepared editions were not delivered');
  assert(!u.searchParams.get('select')?.split(',').includes('result'),'Frozen original bodies must not be loaded');
  return Response.json([{id:'failed-job',status:'failed',error:'Extraction failed',issues:[],articles:null,provider_email_id:null}]);
 }) as typeof fetch;
 try{const response=await handler(new Request('https://app/delivery-history?limit=999&user_id=another',{headers:{authorization:'Bearer fake-test-session'}}));const data=await response.json();assert(response.status===200&&data.limit===100&&reads===2);assert(data.items[0].job_id==='sent-job'&&data.jobs[0].status==='failed');}
 finally{globalThis.fetch=original;}
});
