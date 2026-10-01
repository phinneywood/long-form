import { retryAfterMillis } from "./network-retry.ts";

// Match the provider's established retry pattern, bounded by the caller's
// existing deadline. Quota/permission failures are never treated as rate limits.
export async function modelResponse(request:()=>Promise<Response>,options:{deadline:number;now?:()=>number;sleep?:(ms:number)=>Promise<void>}){
 const now=options.now||Date.now,sleep=options.sleep||((ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms)));
 for(let attempt=0;;attempt++){
  let response:Response;
  try{
   const received=await request();
   // Buffer the non-streaming JSON response inside the retry boundary. A
   // provider connection can fail after headers but before response.json().
   const bytes=await received.arrayBuffer();
   response=new Response(bytes,{status:received.status,statusText:received.statusText,headers:received.headers});
  }catch(error){
   const transient=error instanceof Error&&!['AbortError','TimeoutError'].includes(error.name)&&/connection|network|socket|fetch failed|premature|unexpected eof/i.test(error.message);
   const delay=1000*2**attempt;
   if(!transient||attempt>=2||now()+delay+5000>=options.deadline)throw error;
   console.info(JSON.stringify({service:"editor",event:"model.transport_retry",attempt:attempt+1,delay_ms:delay}));
   await sleep(delay);continue;
  }
  if(response.ok||attempt>=2)return response;
  const error=await response.clone().json().catch(()=>({}));
  if(response.status===429){
   const message=String(error.error?.message||""),budget=message.match(/Limit[: ]+(\d+)[\s\S]*?Used[: ]+(\d+)[\s\S]*?Requested[: ]+(\d+)/i);
   console.warn(JSON.stringify({service:"editor",event:"model.rate_limit",code:error.error?.code,limit:budget?.[1],used:budget?.[2],requested:budget?.[3],remaining_requests:response.headers.get("x-ratelimit-remaining-requests"),remaining_tokens:response.headers.get("x-ratelimit-remaining-tokens"),reset_requests:response.headers.get("x-ratelimit-reset-requests"),reset_tokens:response.headers.get("x-ratelimit-reset-tokens")}));
  }
  const transient=response.status>=500||(response.status===429&&error.error?.code==="rate_limit_exceeded");
  const delay=Math.max(retryAfterMillis(response.headers.get("retry-after"),now()),1000*2**attempt);
  if(!transient||delay>15000||now()+delay+5000>=options.deadline)return response;
  console.info(JSON.stringify({service:"editor",event:"model.retry",status:response.status,attempt:attempt+1,delay_ms:delay}));
  await sleep(delay);
 }
}
