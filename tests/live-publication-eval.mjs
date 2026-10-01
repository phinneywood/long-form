// Opt-in production-equivalent evaluation. No login secrets in output or repo.
// LF_EVAL_TOKEN_FILE supplies a short-lived validation-account session.
// Sending is allowed only to a Resend test account with LF_EVAL_TEST_SEND=1.
import fs from 'node:fs/promises';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const token=(await fs.readFile(process.env.LF_EVAL_TOKEN_FILE,'utf8')).trim(),base=process.env.LF_EVAL_API||'https://wuikfmmwvrzpaoevtskn.supabase.co/functions/v1/app-api',out=process.env.LF_EVAL_OUT||'test-results/live-publication.json';
const report={started_at:new Date().toISOString(),runs:[],checks:[],failures:[]};
async function api(path,body,method=body?'POST':'GET'){const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(115000)}),data=await r.json();if(!r.ok)throw Error(`${path} ${r.status}: ${data.error}`);return data;}
async function record(){await fs.mkdir('test-results',{recursive:true});await fs.writeFile(out,JSON.stringify(report,null,2));}
async function ready(id){for(const deadline=Date.now()+180000;Date.now()<deadline;){const r=await api('/publication/job?id='+id);if(['ready','sent','partial','failed','empty','expired'].includes(r.job.status))return r;await new Promise(r=>setTimeout(r,2000));}throw Error('Preparation did not reach a terminal state in three minutes.');}
async function ask(question,context={}){const r=await api('/editor/message',{question,request_key:crypto.randomUUID(),...context});assert.equal(r.message.response.unavailable,false,'real editor availability');return r.message;}
try{
 const me=await api('/me');assert.match(me.user.email,/@resend\.dev$/,'dedicated validation account required');report.account='Resend test account';const raw=await api('/publication/feed');report.checks.push({name:'raw feed',items:raw.items.length,feeds:raw.feeds});console.log('raw feed',raw.items.length);
 const steering=await ask('This is interesting, but I want less AI/work material at night and more history, science and strange cultural stories.');report.checks.push({name:'temporary steering',message:steering});assert.equal(steering.response.action,'steer','steering classification');assert.ok(steering.proposed_guidance,'confirmable proposal');await api('/editor/confirm',{message_id:steering.id});assert.ok((await api('/me')).settings.evening_editorial_instructions.length>0);report.checks.push({name:'confirmed preferences',passed:true});await record();
 const priorUrls=new Set();for(let n=0;n<Number(process.env.LF_EVAL_RUNS||5);n++){
  console.log('composing run',n+1);let run;try{
   const r=await api('/publication/compose',{request:'I’ve got about 35 minutes tonight. Find me something interesting and surprising, not related to work.',minutes:35,request_key:crypto.randomUUID()});const status=await ready(r.job.id);assert.equal(status.job.status,'ready',JSON.stringify(status));const ed=(await api('/publication/editions')).editions.find(e=>e.id===status.edition_id);assert.ok(ed);
   const repeated=ed.items.filter(a=>priorUrls.has(a.url));for(const a of ed.items)priorUrls.add(a.url);
   const metrics={article_count:ed.items.length,minutes:ed.minutes,sources:new Set(ed.items.map(a=>a.source)).size,topics:new Set(ed.items.map(a=>a.section_name)).size,repeated:repeated.length,approximate_time:ed.minutes>=26&&ed.minutes<=46};
   run={number:n+1,edition:ed,metrics,pass:ed.items.length>=3&&ed.items.length<=5&&metrics.approximate_time&&metrics.sources>=3&&metrics.topics>=3&&!metrics.repeated};report.runs.push(run);console.log('run',n+1,metrics,'pass',run.pass);await record();
   if(n===0){
    const context={edition_id:ed.id,position:0,paragraph:2};const article=await api('/reader/article',context);assert.ok(article.article.body.length>500);report.checks.push({name:'original article',title:article.article.title,characters:article.article.body.length,paragraphs:article.paragraphs.length});
    await api('/reader/state',{...context,progress:.42,paragraph:2},'PATCH');await api('/reader/state',{...context,saved:true},'PATCH');const retained=await api('/reader/article',context);assert.ok(Math.abs(retained.reading.progress-.42)<.001&&retained.reading.saved);report.checks.push({name:'reading state',passed:true});
    for(const question of ['Why did you put this article first?','I don’t understand the author’s argument in these two paragraphs.','Is there anything in my sources that offers another perspective?']){const message=await ask(question,context);report.checks.push({name:question,message});console.log('editor answer',question,message.response.answer.slice(0,400));}
    // Cross-tenant owned-edition lookup must not return test content.
    try{await api('/reader/article',{edition_id:'00000000-0000-0000-0000-000000000001',position:0});throw Error('Tenant guard failed');}catch(e){assert.match(e.message,/404/);}report.checks.push({name:'tenant missing edition',passed:true});
    if(process.env.LF_EVAL_TEST_SEND==='1'){assert.match(me.settings.kindle_email,/@resend\.dev$/);const sendKey=crypto.randomUUID(),first=await api('/publication/send',{edition_id:ed.id,request_key:sendKey}),second=await api('/publication/send',{edition_id:ed.id,request_key:sendKey});assert.equal(first.job_id,second.job_id);const delivered=await ready(first.job_id);assert.ok(['sent','partial'].includes(delivered.job.status));const history=await ask('Have you sent me anything about '+ed.items[0].title+' lately?');report.checks.push({name:'exact edition test submission',edition_id:ed.id,job_id:first.job_id,status:delivered.job,history});console.log('test submission',delivered.job.status);}
   }
  }catch(e){if(run)run.journey_error=e.message;else report.runs.push({number:n+1,pass:false,error:e.message});report.failures.push(e.message);console.log('run failed',e.message);await record();}
 }
 report.distribution={total:report.runs.length,passed:report.runs.filter(r=>r.pass).length};report.finished_at=new Date().toISOString();await record();console.log('distribution',report.distribution);
}catch(e){report.failures.push(e.message);await record();throw e;}
