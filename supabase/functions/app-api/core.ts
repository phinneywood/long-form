import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { fetchPublicText } from "../_shared/network.ts";
import { feedCandidates } from "../_shared/feed-candidates.ts";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
export const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {auth:{persistSession:false,autoRefreshToken:false}});
export const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, content-type, x-client-info, apikey","Access-Control-Allow-Methods":"GET, POST, PATCH, DELETE, OPTIONS","Cache-Control":"no-store"};
export function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json; charset=utf-8"}})}
export function routePath(req:Request){const p=new URL(req.url).pathname,m="/app-api",i=p.indexOf(m);return i>=0?p.slice(i+m.length)||"/":p}
export function normEmail(v:unknown){return String(v||"").trim().toLowerCase()}
export function validEmail(v:string){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)&&v.length<=320}
export function normalizeUrl(v:string){const s=String(v||"").trim();if(!s)return"";return /^[a-z][a-z0-9+.-]*:\/\//i.test(s)?s:`https://${s}`}
export function validUrl(v:string){try{const u=new URL(normalizeUrl(v));return["http:","https:"].includes(u.protocol)&&!u.username&&!u.password}catch{return false}}
export function validTimezone(v:string){try{new Intl.DateTimeFormat("en-US",{timeZone:v}).format(new Date());return true}catch{return false}}
function hex(b:Uint8Array){return Array.from(b).map(x=>x.toString(16).padStart(2,"0")).join("")}
export async function sha256(v:string){return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v))))}
function token(n=32){const b=new Uint8Array(n);crypto.getRandomValues(b);let s="";for(const x of b)s+=String.fromCharCode(x);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}
function code(){const a=new Uint32Array(1);crypto.getRandomValues(a);return String(a[0]%1_000_000).padStart(6,"0")}
async function codeHash(email:string,c:string){return sha256(`${SERVICE_ROLE}:${email}:${c}`)}
async function mailCode(email:string,c:string){
  if(!RESEND_API_KEY)throw new Error("Email service is not configured.");
  const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:"Long Form <reader@antonioskilton.com>",to:[email],subject:`${c} is your Long Form code`,text:`Your Long Form sign-in code is ${c}. It expires in 10 minutes.`,html:`<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif"><p>Your Long Form sign-in code is:</p><p style="font-size:34px;font-weight:700;letter-spacing:6px">${c}</p><p>It expires in 10 minutes.</p></body></html>`})});
  if(!r.ok)throw new Error(`Email provider error (${r.status}): ${(await r.text()).slice(0,250)}`);
}
export async function requestCode(email:string){const since=new Date(Date.now()-600_000).toISOString();const{count}=await admin.from("login_codes").select("id",{count:"exact",head:true}).eq("email",email).gte("created_at",since);if((count||0)>=5)throw Object.assign(new Error("Too many codes requested. Try again in a few minutes."),{status:429});const c=code(),expires=new Date(Date.now()+600_000).toISOString();const{data,error}=await admin.from("login_codes").insert({email,code_hash:await codeHash(email,c),expires_at:expires}).select("id").single();if(error)throw error;try{await mailCode(email,c)}catch(e){await admin.from("login_codes").delete().eq("id",data.id);throw e}}
async function ensureUserSetup(userId:string){
  const{data:settings,error:settingsError}=await admin.from("user_settings").select("user_id").eq("user_id",userId).maybeSingle();
  if(settingsError)throw settingsError;
  if(!settings){const{error}=await admin.from("user_settings").insert({user_id:userId,timezone:"America/Los_Angeles",delivery_time:"06:00:00"});if(error)throw error}
  const{count,error:sectionError}=await admin.from("sections").select("id",{count:"exact",head:true}).eq("user_id",userId).is("archived_at",null);
  if(sectionError)throw sectionError;
  if(!count){const{error}=await admin.from("sections").insert({user_id:userId,name:"Reading",position:0});if(error)throw error}
}
async function issueAppSession(user:{id:string,email:string}){
  await ensureUserSetup(user.id);
  const idleTimeoutSeconds=90*86400;
  const raw=token(),expiresAt=new Date(Date.now()+idleTimeoutSeconds*1000).toISOString();
  const{error}=await admin.from("sessions").insert({user_id:user.id,token_hash:await sha256(raw),expires_at:expiresAt,idle_timeout_seconds:idleTimeoutSeconds});
  if(error)throw error;
  return{raw,expiresAt,user};
}
export async function verifyCode(email:string,c:string){
  const{data:login,error}=await admin.from("login_codes").select("*").eq("email",email).is("consumed_at",null).gt("expires_at",new Date().toISOString()).lt("attempts",5).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(error)throw error;
  if(!login)throw Object.assign(new Error("That code has expired. Request a new one."),{status:401});
  if(await codeHash(email,c)!==login.code_hash){await admin.from("login_codes").update({attempts:login.attempts+1}).eq("id",login.id);throw Object.assign(new Error("That code is not correct."),{status:401})}
  await admin.from("login_codes").update({consumed_at:new Date().toISOString()}).eq("id",login.id);
  const{data:user,error:userError}=await admin.from("app_users").upsert({email},{onConflict:"email"}).select("id,email").single();
  if(userError)throw userError;
  return issueAppSession(user);
}
export async function auth(req:Request){
  const h=req.headers.get("authorization")||"",raw=h.startsWith("Bearer ")?h.slice(7).trim():"";
  if(!raw)return null;
  // Validate and renew together: an expired or revoked session must never revive.
  const{data,error}=await admin.rpc("authenticate_app_session",{p_token_hash:await sha256(raw)});
  if(error)throw Object.assign(new Error("Sign-in could not be checked. Please try again."),{status:503});
  const session=data?.[0];
  if(!session)return null;
  return{sessionId:session.session_id,user:{id:session.user_id,email:session.email}};
}
export async function dashboard(userId:string,email:string){
  const[s,se,fe,di,jo]=await Promise.all([
    admin.from("user_settings").select("*").eq("user_id",userId).single(),
    admin.from("sections").select("*").eq("user_id",userId).is("archived_at",null).order("position").order("created_at"),
    admin.from("feeds").select("*").eq("user_id",userId).is("archived_at",null).order("created_at"),
    admin.from("digests").select("id,section_id,edition_name,status,article_count,error,created_at,sent_at").eq("user_id",userId).order("created_at",{ascending:false}).limit(25),
    admin.from("digest_jobs").select("id,reason,section_id,edition_name,scheduled_for,packet_name,article_urls,status,result,error,attempts,run_after,created_at,started_at,finished_at").eq("user_id",userId).neq("reason","first_run_preview").order("created_at",{ascending:false}).limit(15)
  ]);
  if(s.error)throw s.error;if(se.error)throw se.error;if(fe.error)throw fe.error;if(di.error)throw di.error;if(jo.error)throw jo.error;
  const sources=fe.data||[];
  const jobs=jo.data||[];
  const resendCandidates=jobs.filter((j:any)=>["scheduled","manual"].includes(j.reason)&&["sent","partial"].includes(j.status)).map((j:any)=>j.id);
  const resendable=new Set<string>();
  if(resendCandidates.length){
    const outboxes=await admin.from("delivery_outbox").select("job_id").in("job_id",resendCandidates).not("payload","is",null);
    if(outboxes.error)throw outboxes.error;
    for(const row of outboxes.data||[])resendable.add(row.job_id);
  }
  const sections=(se.data||[]).map((x:any)=>({...x,feeds:sources.filter((f:any)=>f.section_id===x.id)}));
  return{
    user:{id:userId,email},
    settings:s.data,
    sources,
    sections,
    digests:di.data||[],
    jobs:jobs.map((j:any)=>({...j,can_resend:resendable.has(j.id),result:j.result?.preparation_manifest?{...j.result,preparation_manifest:undefined}:j.result})),
    sender_email:"reader@antonioskilton.com"
  };
}
export function firstIssueSummary(job:any){
  const manifest=job.result?.preparation_manifest;
  const groups=manifest?.groups||[];
  const selected=manifest?.pendingItems?.length?[...groups,{section:{name:"Saved articles"},items:manifest.pendingItems}]:groups;
  const articles=selected.flatMap((group:any)=>group.items||[]);
  const review=job.result?.preview_review;
  const words=articles.reduce((sum:number,item:any)=>sum+String(item.body||"").replace(/<[^>]*>/g," ").trim().split(/\s+/).filter(Boolean).length,0);
  return {id:job.id,status:job.status,error:job.error||null,created_at:job.created_at,
    article_count:job.status==="ready"?articles.length:0,estimated_reading_minutes:job.status==="ready"?Math.max(1,Math.ceil(words/225)):null,
    introduction:job.status==="ready"?manifest?.introduction||null:null,
    issues:job.status==="ready"?review?.issues||manifest?.issues||[]:[],
    groups:job.status==="ready"?(review?.groups||selected).map((group:any,groupIndex:number)=>({
      name:group.section?.name==="Other"?"Elsewhere":group.section?.name||"Reading",items:(group.items||[]).map((item:any,index:number)=>({
        groupIndex,index,title:item.title||"Untitled",source:item.source||item.feed_name||item.source_name||null,
        url:item.url,excerpt:item.excerpt||null,warnings:item.warnings||[]
      }))
    })):[]};
}
export async function systemHealth(userId:string){
  const since=new Date(Date.now()-24*3600_000).toISOString();
  const [settingsR,feedsR,jobsR,articlesR]=await Promise.all([
    admin.from("user_settings").select("paused,onboarding_complete,next_run_at,kindle_email").eq("user_id",userId).single(),
    admin.from("feeds").select("id,name,last_fetch_at,last_success_at,last_error,consecutive_failures,enabled").eq("user_id",userId).eq("enabled",true).is("archived_at",null).order("consecutive_failures",{ascending:false}),
    admin.from("digest_jobs").select("id,reason,section_id,edition_name,scheduled_for,packet_name,status,result,error,created_at,started_at,finished_at").eq("user_id",userId).neq("reason","first_run_preview").gte("created_at",since).order("created_at",{ascending:false}).limit(100),
    admin.from("article_deliveries").select("id",{count:"exact",head:true}).eq("user_id",userId).gte("delivered_at",since)
  ]);
  if(settingsR.error)throw settingsR.error;if(feedsR.error)throw feedsR.error;if(jobsR.error)throw jobsR.error;if(articlesR.error)throw articlesR.error;
  const settings=settingsR.data,feeds=feedsR.data||[],jobs=jobsR.data||[];
  const completed=jobs.filter((j:any)=>["sent","empty","partial","failed"].includes(j.status));
  const successful=completed.filter((j:any)=>j.status==="sent"||j.status==="empty").length;
  const durations=completed.map((j:any)=>j.started_at&&j.finished_at?new Date(j.finished_at).getTime()-new Date(j.started_at).getTime():null).filter((x:number|null):x is number=>typeof x==="number"&&x>=0).sort((a,b)=>a-b);
  const medianMs=durations.length?durations[Math.floor((durations.length-1)/2)]:null;
  const failingFeeds=feeds.filter((f:any)=>f.last_error);
  const repeatedFeeds=feeds.filter((f:any)=>Number(f.consecutive_failures||0)>=3);
  const failedJobs=jobs.filter((j:any)=>j.status==="failed");
  const alerts:any[]=[];
  if(settings?.onboarding_complete&&!settings?.paused&&settings?.next_run_at&&new Date(settings.next_run_at).getTime()<Date.now()-30*60_000){
    alerts.push({severity:"error",type:"delivery_overdue",message:"Scheduled daily delivery is overdue by more than 30 minutes."});
  }
  if(failedJobs.length)alerts.push({severity:"error",type:"delivery_failed",message:`${failedJobs.length} delivery ${failedJobs.length===1?"job has":"jobs have"} failed in the last 24 hours.`});
  if(repeatedFeeds.length)alerts.push({severity:"warning",type:"feeds_repeatedly_failing",message:`${repeatedFeeds.length} source${repeatedFeeds.length===1?" is":"s are"} failing repeatedly.`});
  return{
    generated_at:new Date().toISOString(),
    window_hours:24,
    delivery:{
      jobs:jobs.length,
      completed:completed.length,
      successful,
      failed:failedJobs.length,
      empty:jobs.filter((j:any)=>j.status==="empty").length,
      success_rate:completed.length?Math.round((successful/completed.length)*1000)/10:null,
      median_duration_ms:medianMs,
      articles_delivered:articlesR.count||0
    },
    feeds:{
      total:feeds.length,
      healthy:feeds.length-failingFeeds.length,
      failing:failingFeeds.length,
      repeatedly_failing:repeatedFeeds.length
    },
    alerts,
    recent_jobs:jobs.slice(0,12).map((j:any)=>({...j,result:j.result?.preparation_manifest?{...j.result,preparation_manifest:undefined}:j.result})),
    source_issues:failingFeeds.slice(0,20).map((f:any)=>({id:f.id,name:f.name,last_error:f.last_error,consecutive_failures:f.consecutive_failures||0,last_fetch_at:f.last_fetch_at,last_success_at:f.last_success_at}))
  };
}

async function safeFetch(input:string,maxBytes=1_500_000){return (await fetchPublicText(input,"application/rss+xml,application/atom+xml,text/html,*/*",maxBytes)).text}
function looksLikeFeed(x:string){return /<(rss\b|feed\b|rdf:RDF\b)/i.test(x)}
function feedTitle(x:string){const m=x.match(/<title(?:\s[^>]*)?>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);return(m?.[1]||"").replace(/<[^>]+>/g,"").replace(/&amp;/gi,"&").replace(/&#39;/g,"'").trim().slice(0,120)}
function htmlAttr(tag:string,name:string){const m=tag.match(new RegExp(name+"\\s*=\\s*([\\\"'])(.*?)\\1","i"));return m?.[2]||""}
function htmlFeedLinks(html:string,base:string){
  const out:{url:string,title:string,method:string}[]=[];
  for(const tag of html.match(/<link\b[^>]*>/gi)||[]){
    const rel=htmlAttr(tag,"rel").toLowerCase(),type=htmlAttr(tag,"type").toLowerCase(),href=htmlAttr(tag,"href");
    if(!href||!rel.split(/\s+/).includes("alternate")||!/(rss|atom|feed\+json)/.test(type))continue;
    try{out.push({url:new URL(href,base).toString(),title:htmlAttr(tag,"title"),method:"autodiscovery"})}catch{}
  }
  return out;
}
async function verifyFee…16200 tokens truncated…ublication_editions'))rows=[{id:eid,user_id:uid,job_id:null,kind:'daily',title:'Long Form',target_minutes:30,created_at:'2026-10-01',manifest:{items:[{title:'Actual original',source:'Publisher',url:'https://example.com/a',body:'<p>Actual original author’s text.</p>',minutes:1,position:0,origin:'subscribed',reason:'Recorded lead'}],featured:[0]}}];
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
