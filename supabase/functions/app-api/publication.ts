import { admin, json, preview, validUrl } from "./core.ts";
import { extractArticle, extractionBudget } from "../_shared/article.ts";
import { summarizeEdition, paragraphs, editorReply, editorExchanges, explicitEditionSend } from "../_shared/publication.ts";
import { plainText } from "../_shared/article.ts";
import { nightDiscovery } from "../_shared/night-discovery.ts";
import { composeNight } from "../_shared/night-edition.ts";

const uuid=(v:unknown)=>/^[0-9a-f-]{36}$/i.test(String(v||""));
const key=(v:unknown)=>typeof v==="string"&&v.length>=8&&v.length<=120;
async function ownedEdition(userId:string,id:string,full=false) {
  const r=await admin.from("publication_editions").select(full?"*":"id,user_id,job_id,kind,title,target_minutes,created_at,manifest:summary").eq("user_id",userId).eq("id",id).maybeSingle();
  if(r.error)throw r.error;if(!r.data)throw Object.assign(new Error("Edition not found."),{status:404});return r.data as any;
}
async function getArticle(userId:string,body:any) {
  if(uuid(body.edition_id)&&Number.isInteger(body.position)) {
    const edition=await ownedEdition(userId,body.edition_id,true),article=edition.manifest.items[body.position];
    if(!article)throw Object.assign(new Error("Article not found."),{status:404});
    return {article,key:`${edition.id}:${body.position}`,edition};
  }
  if(uuid(body.article_id)) {
    const r=await admin.from("reader_articles").select("*").eq("id",body.article_id).eq("user_id",userId).maybeSingle();
    if(r.error)throw r.error;if(!r.data)throw Object.assign(new Error("Article not found."),{status:404});
    return {article:r.data.article,key:`raw:${r.data.id}`,article_id:r.data.id};
  }
  throw Object.assign(new Error("Choose an article first."),{status:400});
}
async function activeSources(userId:string) {
  const r=await admin.from("feeds").select("*").eq("user_id",userId).eq("enabled",true).is("archived_at",null).order("created_at");
  if(r.error)throw r.error;return r.data||[];
}
async function chronological(userId:string) {
  const feeds=await activeSources(userId),results:any[]=[],remaining=[...feeds];
  async function fetcher(){while(remaining.length){const f=remaining.shift();const p=await preview(f,100);results.push({...p,name:f.name});}}
  await Promise.all(Array.from({length:Math.min(3,feeds.length)},fetcher));
  return {items:results.flatMap(r=>r.items.map((i:any)=>({...i,feed_id:r.feed_id}))).sort((a:any,b:any)=>String(b.published_at||"").localeCompare(String(a.published_at||""))),feeds:results.map(({items:_items,...r})=>r)};
}
export async function publicationRoute(req:Request,route:string,user:{id:string;email:string}):Promise<Response|null> {
  if(!route.startsWith("/publication")&&!route.startsWith("/reader")&&!route.startsWith("/editor"))return null;
  const uid=user.id;
  const body=req.method==="GET"?Object.fromEntries(new URL(req.url).searchParams):await req.json().catch(()=>({}));
  if(route==="/publication/editions"&&req.method==="GET") {
    const r=await admin.from("publication_editions").select("id,user_id,job_id,kind,title,target_minutes,created_at,manifest:summary").eq("user_id",uid).order("created_at",{ascending:false}).limit(60);if(r.error)throw r.error;
    const ids=(r.data||[]).map((e:any)=>e.job_id).filter(Boolean);
    const jobs=ids.length?await admin.from("digest_jobs").select("id,status,error,finished_at").eq("user_id",uid).in("id",ids):{data:[]};if((jobs as any).error)throw (jobs as any).error;
    return json({editions:(r.data||[]).map(e=>({...summarizeEdition(e),preparation:(jobs.data||[]).find((j:any)=>j.id===e.job_id)||null})),limit:60});
  }
  if(route==="/publication/prepare"&&req.method==="POST") {
    if(!key(body.request_key))return json({error:"Invalid preparation request key."},400);
    const k=`web-publication:${uid}:${body.request_key}`;
    const old=await admin.from("digest_jobs").select("id,status,error").eq("user_id",uid).eq("idempotency_key",k).maybeSingle();if(old.error)throw old.error;if(old.data)return json({job:old.data},202);
    const r=await admin.from("digest_jobs").insert({user_id:uid,reason:"publication_preview",lookback_hours:48,idempotency_key:k,result:{publication_kind:"daily",target_minutes:30}}).select("id,status").single();
    if(r.error?.code==="23505"){const active=await admin.from("digest_jobs").select("id,status,error").eq("user_id",uid).eq("reason","publication_preview").in("status",["queued","running"]).maybeSingle();if(active.data)return json({job:active.data},202)}
    if(r.error)throw r.error;await admin.rpc("kick_digest_worker");return json({job:r.data},202);
  }
  if(route==="/publication/job"&&req.method==="GET") {
    if(!uuid(body.id))return json({error:"Invalid job."},400);
    const r=await admin.rpc("publication_job_status",{p_user_id:uid,p_job_id:body.id});if(r.error)throw r.error;if(!r.data)return json({error:"Job not found."},404);return json(r.data);
  }
  if(route==="/publication/send"&&req.method==="POST") {
    if(!uuid(body.edition_id)||!key(body.request_key))return json({error:"Invalid delivery request."},400);
    const e=await ownedEdition(uid,body.edition_id);
    const ready=await admin.from("digest_jobs").select("status").eq("id",e.job_id).eq("user_id",uid).maybeSingle();if(ready.error)throw ready.error;
    if(!["ready","sent","partial"].includes(ready.data?.status||""))return json({error:"This edition is still preparing. Nothing was sent."},409);
    const r=await admin.rpc("queue_publication_delivery",{p_user_id:uid,p_edition_id:e.id,p_request_key:body.request_key});if(r.error)throw Object.assign(new Error(r.error.message),{status:409});
    await admin.rpc("kick_digest_worker");return json({job_id:r.data,status:"queued"},202);
  }
  if(route==="/publication/feed"&&req.method==="GET")return json(await chronological(uid));
  if(route==="/reader/open"&&req.method==="POST") {
    if(!validUrl(String(body.url||"")))return json({error:"Invalid article URL."},400);
    const old=await admin.from("reader_articles").select("id").eq("user_id",uid).eq("url",body.url).maybeSingle();if(old.error)throw old.error;
    if(old.data)return json({article_id:old.data.id});
    const article=await extractArticle({url:body.url,includeImages:false,budget:extractionBudget(Date.now()+25_000)});
    const r=await admin.from("reader_articles").upsert({user_id:uid,url:body.url,article:{...article,assets:[],origin:"opened original",reason:"Opened for original-article reading."}},{onConflict:"user_id,url"}).select("id").single();if(r.error)throw r.error;
    return json({article_id:r.data.id});
  }
  if(route==="/reader/article"&&req.method==="POST") {
    const a=await getArticle(uid,body),r=await admin.from("reading_states").select("*").eq("user_id",uid).eq("article_key",a.key).maybeSingle();if(r.error)throw r.error;
    return json({article:{...a.article,assets:[]},article_key:a.key,reading:r.data||{progress:0,paragraph:0,saved:false},paragraphs:paragraphs(a.article.body)});
  }
  if(route==="/reader/state"&&req.method==="PATCH") {
    const a=await getArticle(uid,body),patch:any={user_id:uid,article_key:a.key,updated_at:new Date().toISOString()};
    if(body.progress!==undefined){if(!Number.isFinite(body.progress)||body.progress<0||body.progress>1)return json({error:"Invalid reading position."},400);patch.progress=body.progress;patch.paragraph=Math.max(0,Math.trunc(Number(body.paragraph)||0));}
    if(typeof body.saved==="boolean")patch.saved=body.saved;
    const r=await admin.rpc("update_reading_state",{p_user_id:uid,p_article_key:a.key,p_progress:patch.progress??null,p_paragraph:patch.paragraph??null,p_saved:patch.saved??null});if(r.error)throw r.error;return json({ok:true});
  }
  if(route==="/reader/library"&&req.method==="GET") {
    const r=await admin.from("reading_states").select("*").eq("user_id",uid).order("updated_at",{ascending:false}).limit(100);if(r.error)throw r.error;
    const a=await admin.from("reader_articles").select("id,article").eq("user_id",uid).order("created_at",{ascending:false}).limit(100);if(a.error)throw a.error;
    return json({states:r.data||[],articles:(a.data||[]).map(r=>({id:r.id,title:r.article.title,source:r.article.source,url:r.article.url}))});
  }
  if(route==="/editor/history"&&req.method==="GET") {
    const r=await admin.from("editor_messages").select("id,question,response,proposed_guidance,confirmed_at,created_at").eq("user_id",uid).order("created_at",{ascending:false}).limit(30);if(r.error)throw r.error;
    return json({messages:(r.data||[]).reverse()});
  }
  if(route==="/editor/confirm"&&req.method==="POST") {
    if(!uuid(body.message_id))return json({error:"Invalid preference proposal."},400);
    const r=await admin.rpc("confirm_editor_guidance",{p_user_id:uid,p_message_id:body.message_id});if(r.error)throw Object.assign(new Error(r.error.message),{status:409});return json({ok:true});
  }
  if(route==="/editor/message"&&req.method==="POST") {
    const question=String(body.question||"").trim();if(!question||question.length>4000||!key(body.request_key))return json({error:"Enter a question up to 4,000 characters."},400);
    const old=await admin.from("editor_messages").select("*").eq("user_id",uid).eq("request_key",body.request_key).maybeSingle();if(old.error)throw old.error;if(old.data)return json({message:old.data});
    // An explicit send instruction opens the same exact-edition review used
    // by the publication. Neither a model nor this conversation call sends.
    if(explicitEditionSend(question)&&uuid(body.edition_id)){
      const edition=await ownedEdition(uid,body.edition_id);
      const response={answer:`Review “${edition.title}” below to send its exact complete edition. Nothing has been sent yet.`,action:"send",guidance:null,minutes:null,citations:[],unavailable:false,send_request:{edition_id:edition.id}};
      const row=await admin.from("editor_messages").insert({user_id:uid,request_key:body.request_key,question,response}).select("*").single();if(row.error)throw row.error;
      return json({message:row.data});
    }
    const [settings,conversation,messages,delivery,editions,readingStates,rawArticles]=await Promise.all([
      admin.from("user_settings").select("editorial_brief,editorial_instructions,evening_editorial_instructions").eq("user_id",uid).single(),
      admin.from("editor_conversations").select("*").eq("user_id",uid).maybeSingle(),
      admin.from("editor_messages").select("question,response").eq("user_id",uid).order("created_at",{ascending:false}).limit(12),
      admin.from("article_deliveries").select("id,title,canonical_url,delivered_at,delivery_kind").eq("user_id",uid).order("delivered_at",{ascending:false}).limit(500),
      admin.from("publication_editions").select("id,user_id,job_id,kind,title,target_minutes,created_at,manifest:summary").eq("user_id",uid).order("created_at",{ascending:false}).limit(60),
      admin.from("reading_states").select("*").eq("user_id",uid).order("updated_at",{ascending:false}).limit(100),
      admin.from("reader_articles").select("id,article").eq("user_id",uid).order("created_at",{ascending:false}).limit(100),
    ]);for(const r of [settings,conversation,messages,delivery,editions,readingStates,rawArticles])if(r.error)throw r.error;
    const evidence:any[]=[];let current:any=null,read:any=null;
    if(uuid(body.edition_id)){current=await ownedEdition(uid,body.edition_id);current=summarizeEdition(current);}
    if(Number.isInteger(body.position)||uuid(body.article_id)) {
      const a=await getArticle(uid,body),ps=paragraphs(a.article.body),start=Math.min(ps.length-1,Math.max(0,Math.trunc(Number(body.paragraph)||0)));
      read={title:a.article.title,source:a.article.source,origin:a.article.origin,url:a.article.url,paragraph_count:ps.length,visible_paragraphs:ps.slice(start,start+3).map((text,i)=>({number:start+i+1,text})),full_text:ps.map((p,i)=>`[${i+1}] ${p}`).join("\n").slice(0,65000)};
      evidence.push({id:"reading",title:read.title,url:read.url,source:read.source,origin:read.origin,edition_id:a.edition?.id||null,position:body.position??null,article_id:a.article_id||null,content_status:"current original text supplied in reading"});
    }
    if(current)for(const item of current.items)evidence.push({id:`edition:${current.id}:${item.position}`,title:item.title,url:item.url,edition_id:current.id,source:item.source,origin:item.origin,reason:item.reason,position:item.position,section:item.section_name,minutes:item.minutes});
    let terms=question.toLowerCase().match(/[a-z]{4,}/g)?.filter(t=>!new Set(["that","with","from","this","what","when","which","would","could","your","want","more","less","work","material","have","sent","anything","about","lately","there","sources","offers","another","perspective","understand","these","paragraphs","article","first","reading","interesting","something","tonight"]).has(t))||[];
    if(read&&/another perspective|my sources|counterpoint/i.test(question))terms.push(...(read.title.toLowerCase().match(/[a-z]{5,}/g)||[]));
    if(terms.includes("urbanism"))terms.push("urban","cities","city planning","housing","transit");
    const relevant=(s:string)=>terms.some(t=>s.toLowerCase().includes(t));
    const history=(delivery.data||[]).filter(r=>relevant(r.title));
    for(const h of history.slice(0,40))evidence.push({id:`delivery:${h.id}`,title:h.title,url:h.canonical_url,delivered_at:h.delivered_at,delivery_kind:h.delivery_kind});
    for(const e of editions.data||[])for(const item of e.manifest?.items||[])if(relevant([item.title,item.section_name,item.editorial_topic,item.excerpt].join(" "))&&e.id!==current?.id)evidence.push({id:`edition:${e.id}:${item.position}`,edition_id:e.id,position:item.position,title:item.title,url:item.url,source:item.source,excerpt:item.excerpt,created_at:e.created_at,reason:item.reason});
    for(const a of rawArticles.data||[])if(relevant([a.article.title,a.article.excerpt,a.article.section_name].join(" ")))evidence.push({id:`library:${a.id}`,title:a.article.title,url:a.article.url,source:a.article.source,excerpt:plainText(a.article.body).slice(0,2500),content_status:"original extract"});
    const sourceHistory=(editions.data||[]).flatMap(e=>(e.manifest?.items||[]).map((a:any)=>({title:a.title,url:a.url,origin:a.origin,created_at:e.created_at,reading:(readingStates.data||[]).find(s=>s.article_key===`${e.id}:${a.position}`)||null})));
    const sources=await activeSources(uid);
    if(/perspective|sources|counterpoint|contrast/i.test(question)){const raw=await chronological(uid);for(const item of raw.items.filter((a:any)=>relevant(a.title)).slice(0,20))evidence.push({id:`source:${item.feed_id}:${encodeURIComponent(item.url)}`,title:item.title,url:item.url,source:item.source,content_status:"headline only"});}
    // Old answers are conversational history, never retrieval evidence. Do
    // not replay original bodies embedded by earlier versions in citations.
    // Contextual article questions receive only prior exchanges about this
    // exact original; unrelated prior reading cannot masquerade as its text.
    const exchanges=editorExchanges(messages.data||[],read?.url);
    const result=await editorReply({question,current_edition:current,reading:read,reading_history:sourceHistory.filter(a=>a.reading).slice(0,50),settings:settings.data,temporary_guidance:conversation.data?.temporary_guidance||"",conversation:exchanges,sources:sources.map(s=>({name:s.name,url:s.url})),evidence:evidence.slice(0,150),history_coverage:{records:delivery.data?.length||0,oldest:delivery.data?.at(-1)?.delivered_at||null,max_records:500,editions:editions.data?.length||0}});
    if(result.action==="steer"&&result.guidance&&!result.unavailable){const r=await admin.from("editor_conversations").upsert({user_id:uid,temporary_guidance:result.guidance,updated_at:new Date().toISOString()});if(r.error)throw r.error;}
    const response={...result,citations:result.citations.map((id:string)=>evidence.find(e=>e.id===id)),base_guidance:settings.data!.evening_editorial_instructions,
      compose_request:result.action==="compose"?{request:question,minutes:result.minutes}:null};
    const row=await admin.from("editor_messages").insert({user_id:uid,request_key:body.request_key,question,response,proposed_guidance:result.action==="steer"?result.guidance:null}).select("*").single();if(row.error)throw row.error;
    return json({message:row.data});
  }
  if(route==="/publication/compose"&&req.method==="POST") {
    if(!key(body.request_key)||typeof body.request!=="string"||body.request.length>4000)return json({error:"Invalid edition request."},400);
    const k=`night-publication:${uid}:${body.request_key}`;
    const old=await admin.from("digest_jobs").select("id,status").eq("user_id",uid).eq("idempotency_key",k).maybeSingle();if(old.error)throw old.error;if(old.data)return json({job:old.data},202);
    const active=await admin.from("digest_jobs").select("id").eq("user_id",uid).eq("reason","publication_preview").in("status",["queued","running"]).limit(1).maybeSingle();if(active.error)throw active.error;
    if(active.data)return json({error:"Another edition is still being prepared. You can open your available reading or wait for it to finish.",job_id:active.data.id},409);
    const [settings,conversation,history,editions,raw,discovered]=await Promise.all([
      admin.from("user_settings").select("editorial_brief,evening_editorial_instructions").eq("user_id",uid).single(),
      admin.from("editor_conversations").select("temporary_guidance").eq("user_id",uid).maybeSingle(),
      admin.from("article_deliveries").select("canonical_url").eq("user_id",uid).gte("delivered_at",new Date(Date.now()-30*86400_000).toISOString()).limit(5000),
      admin.from("publication_editions").select("manifest:summary").eq("user_id",uid).gte("created_at",new Date(Date.now()-14*86400_000).toISOString()).limit(100),chronological(uid),nightDiscovery(),
    ]);for(const r of [settings,conversation,history,editions])if(r.error)throw r.error;
    const minutes=Math.max(10,Math.min(120,Math.trunc(Number(body.minutes)||35)));
    const prepared=await composeNight({request:body.request,minutes,brief:settings.data!.editorial_brief||"",guidance:[settings.data!.evening_editorial_instructions,conversation.data?.temporary_guidance].filter(Boolean).join("\n"),candidates:raw.items.slice(0,200),discoveryCandidates:discovered.items,excluded:[...(history.data||[]).map(r=>r.canonical_url),...(editions.data||[]).flatMap(e=>(e.manifest.items||[]).map((a:any)=>a.canonical_url||a.url))]});
    prepared.issues.push(...discovered.issues);
    const r=await admin.from("digest_jobs").insert({user_id:uid,reason:"publication_preview",idempotency_key:k,lookback_hours:24,result:{publication_kind:"tonight",target_minutes:minutes,preparation_manifest:{version:2,...prepared,pendingItems:[],feedCount:0}}}).select("id,status").single();if(r.error?.code==="23505")return json({error:"Another edition started preparing. Wait for it to finish before composing another."},409);if(r.error)throw r.error;
    await admin.rpc("kick_digest_worker");return json({job:r.data},202);
  }
  return json({error:"Not found."},404);
}
