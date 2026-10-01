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
