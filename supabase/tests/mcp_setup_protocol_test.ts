Deno.env.set('SUPABASE_URL','https://mcp-db.example.invalid');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','test-only-key');
let handler!: (req:Request)=>Promise<Response>;
const originalServe=Deno.serve;
Deno.serve=((fn:any)=>{handler=fn;return {};}) as typeof Deno.serve;
try{await import('../functions/mcp/index.ts');}finally{Deno.serve=originalServe;}
function assert(v:unknown,m='Assertion failed'):asserts v{if(!v)throw Error(m)}
const uid='10000000-0000-0000-0000-000000000001';
const rpc=(method:string,params:any={},url='https://app/api/mcp')=>handler(new Request(url,{method:'POST',headers:{authorization:'Bearer fake-test-token'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}));
Deno.test('MCP discovery preserves full compatibility and setup enforces scopes and delegated tenant',async()=>{
 const original=globalThis.fetch;let scopes=['reader:read'],delegations=0,appCalls=0;
 globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{const r=new Request(input,init),u=new URL(r.url);
  if(u.pathname.endsWith('/rpc/mcp_validate_oauth_access_token'))return Response.json([{user_id:uid,email:'account@example.com',scopes}]);
  if(u.pathname.endsWith('/sessions')){
   if(r.method==='POST'){const b=await r.json();assert(b.user_id===uid);delegations++;return Response.json({id:'session-1'});}
   assert(r.method==='DELETE');return new Response(null,{status:204});
  }
  assert(u.hostname==='wuikfmmwvrzpaoevtskn.supabase.co'&&u.pathname.endsWith('/app-api/kindle'),'Only the setup capability is delegated');
  appCalls++;assert(r.headers.get('authorization')?.startsWith('Bearer '));
  if(r.method==='PATCH')assert((await r.json()).kindle_email==='provided@kindle.com');
  return Response.json({kindle_email:r.method==='PATCH'?'provided@kindle.com':null,address_configured:r.method==='PATCH',amazon_sender_approval:'unverified'});
 }) as typeof fetch;
 try{
  const list=await(await rpc('tools/list')).json();assert(list.result.tools.length===7);assert(!list.result.tools.some((t:any)=>t.name==='send_now'));
  const full=await(await rpc('tools/list',{},'https://app/api/mcp?toolset=reader')).json();assert(full.result.tools.some((t:any)=>t.name==='send_now')&&full.result.tools.some((t:any)=>t.name==='list_publications'));
  const denied=await(await rpc('tools/call',{name:'configure_kindle',arguments:{kindle_email:'provided@kindle.com'}})).json();assert(denied.result.isError&&appCalls===0&&delegations===0,'Read-only connection cannot save address');
  const read=await(await rpc('tools/call',{name:'get_kindle_setup',arguments:{}})).json();assert(!read.result.isError&&read.result.structuredContent.amazon_sender_approval==='unverified');
  scopes.push('reader:write');const saved=await(await rpc('tools/call',{name:'configure_kindle',arguments:{kindle_email:'provided@kindle.com'}})).json();assert(!saved.result.isError&&saved.result.structuredContent.address_configured&&Number(appCalls)===2&&Number(delegations)===2);
 }finally{globalThis.fetch=original;}
});
