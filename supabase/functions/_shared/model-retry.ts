import { retryAfterMillis } from "./network-retry.ts";

// Match the provider's established retry pattern, bounded by the caller's
// existing deadline. Quota/permission failures are never treated as rate limits.
export async function modelResponse(request:()=>Promise<Response>,options:{deadline:number;now?:()=>number;sleep?:(ms:number)=>Promise<void>}){
 const now=options.now||Date.now,sleep=options.sleep||((ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms)));
 for(let attempt=0;;attempt++){
  const response=await request();
  if(response.ok||attempt>=2)return response;
  const error=await response.clone().json().catch(()=>({}));
  const transient=response.status>=500||(response.status===429&&error.error?.code==="rate_limit_exceeded");
  const delay=Math.max(retryAfterMillis(response.headers.get("retry-after"),now()),1000*2**attempt);
  if(!transient||delay>15000||now()+delay+5000>=options.deadline)return response;
  console.info(JSON.stringify({service:"editor",event:"model.retry",status:response.status,attempt:attempt+1,delay_ms:delay}));
  await sleep(delay);
 }
}
