Deno.env.set("SUPABASE_URL","https://custom-db.example.invalid");Deno.env.set("SUPABASE_SERVICE_ROLE_KEY","test-only-key");
const {queueCustomIssue}=await import("../functions/app-api/custom-issue.ts");
function assert(v:unknown,m="Assertion failed"):asserts v{if(!v)throw Error(m)}
Deno.test("custom delivery ignores supplied identities and recipients and binds the authenticated tenant",async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{const req=new Request(input,init);assert(req.url.endsWith("/rpc/queue_custom_issue"));const b=await req.json();calls++;assert(b.p_user_id==="owned-user"&&b.p_idempotency_key==="custom-issue:owned-user:issue-v1");assert(!("user_id" in b.p_issue)&&!("recipient" in b.p_issue));return Response.json([{job_id:"job-a",job_status:"queued",created:true,worker_request_id:12}]);}) as typeof fetch;
 try{const r=await queueCustomIssue(new Request("https://app/custom-issue/queue",{method:"POST",body:JSON.stringify({title:"Issue",content:"My text",dedupe_key:"issue-v1",user_id:"attacker",recipient:"attacker@example.com"})}),"owned-user");assert(r.status===202&&(await r.json()).job.id==="job-a"&&calls===1);}finally{globalThis.fetch=original;}
});
Deno.test("custom delivery exposes dedupe conflict without queuing another issue",async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({message:"Idempotency key is already used by a different issue"},{status:400});
 try{const r=await queueCustomIssue(new Request("https://app/custom-issue/queue",{method:"POST",body:JSON.stringify({title:"Issue",content:"New text",dedupe_key:"same"})}),"owned-user");assert(r.status===409);}finally{globalThis.fetch=original;}
});
