import {modelResponse} from '../functions/_shared/model-retry.ts';
function assert(v:unknown,m='Assertion failed'):asserts v{if(!v)throw Error(m)}
Deno.test('model rate limits respect Retry-After and recover within a bounded deadline',async()=>{
 let calls=0,now=0;const sleeps:number[]=[];
 const r=await modelResponse(async()=>++calls===1?Response.json({error:{code:'rate_limit_exceeded'}},{status:429,headers:{'retry-after':'8'}}):Response.json({ok:true}),{deadline:40000,now:()=>now,sleep:async ms=>{sleeps.push(ms);now+=ms}});
 assert(r.ok&&calls===2&&sleeps.join(',')==='8000');
});
Deno.test('model quota failures, long waits and exhausted deadlines never retry',async()=>{
 for(const [code,header,deadline] of [['insufficient_quota','1',40000],['rate_limit_exceeded','60',40000],['rate_limit_exceeded','8',10000]] as const){let calls=0;await modelResponse(async()=>{calls++;return Response.json({error:{code}},{status:429,headers:{'retry-after':header}})},{deadline,now:()=>0,sleep:async()=>{throw Error('Unsafe retry')}});assert(calls===1);}
});
Deno.test('persistent provider failures use at most two retries',async()=>{
 let calls=0,now=0;const r=await modelResponse(async()=>{calls++;return Response.json({error:{code:'server_error'}},{status:503})},{deadline:40000,now:()=>now,sleep:async ms=>{now+=ms}});assert(r.status===503&&calls===3&&now===3000);
});

Deno.test('transient provider body failures retry even after successful headers',async()=>{
 const fixture=JSON.parse(await Deno.readTextFile(new URL('../../tests/fixtures/publication-model-body-connection.json',import.meta.url)));let calls=0,now=0;
 const response=await modelResponse(async()=>{calls++;if(calls===1)return new Response(new ReadableStream({start(controller){controller.error(new TypeError(fixture.error))}}));return Response.json({actual:'complete plan'});},{deadline:40000,now:()=>now,sleep:async ms=>{now+=ms}});
 assert(calls===2&&(await response.json()).actual==='complete plan'&&now===1000);
});
Deno.test('transport retries are bounded and aborts or programmer failures never retry',async()=>{
 for(const error of [new DOMException('The operation was aborted','AbortError'),new Error('Invalid request configuration')]){let calls=0;let failed=false;try{await modelResponse(async()=>{calls++;throw error;},{deadline:40000,now:()=>0,sleep:async()=>{throw Error('Unsafe retry')}});}catch{failed=true}assert(failed&&calls===1);}
 let calls=0,now=0,failed=false;try{await modelResponse(async()=>{calls++;throw new TypeError('Network connection failed');},{deadline:40000,now:()=>now,sleep:async ms=>{now+=ms}});}catch{failed=true}assert(failed&&calls===3&&now===3000);
});
