import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).find(s=>s.includes('function dashboard'));
const source=script.slice(0,script.lastIndexOf('(async()=>{'));
async function run(code){const w=new Window({url:'https://reader.antonioskilton.com'});w.document.body.innerHTML='<div id="app"></div><div id="modal"></div><div id="toast"></div>';w.eval(readFileSync(new URL('../starter-editions.js',import.meta.url),'utf8'));try{return await w.eval(source+`\n(async()=>{${code}})()`)}finally{await w.happyDOM.abort()}}
const report={name:'Checked feed',status:'ok',entries_seen:20,fresh_included:1,catchup_included:2,already_delivered:12,outside_window:3,duplicates:1,invalid:1,extraction_failed:0,out_of_scope:0,not_needed:0,resource_deferred:0,scan_limited:0,retries:1};
const supply={estimated_reading_minutes:28,fresh_articles:1,catchup_articles:2,discovery_articles:1,failed_sources:1,unchecked_sources:0,short_issue:true,feed_reports:[report,{name:'Failed feed',status:'failed',error:'HTTP 502'}]};
test('issue details distinguish quiet supply from failed sources and retain accounting',async()=>{
const r=await run(`const job={result:{editorial:{supply:${JSON.stringify(supply)}}}};app.innerHTML=issueSupplyDetails(job);return {text:app.textContent,disclosure:app.querySelector('summary').textContent,summary:issueSupplyText(job)}`);
assert.match(r.summary,/About 28 minutes/);assert.match(r.summary,/1 source unavailable/);assert.match(r.text,/12 already delivered/);assert.match(r.text,/1 invalid entries/);assert.match(r.text,/recovered after retry/);assert.match(r.text,/HTTP 502/);assert.match(r.text,/never forces filler/);assert.equal(r.disclosure,'Why this issue was this size');
});
test('source errors and names are escaped, including encoded markup',async()=>{
const malicious={...supply,feed_reports:[{name:'&lt;img src=x onerror=alert(1)&gt;',status:'failed',error:'<script>alert(1)</script>'}]};
const r=await run(`app.innerHTML=issueSupplyDetails({result:{editorial:{supply:${JSON.stringify(malicious)}}}});return {unsafe:app.querySelectorAll('script,img').length,text:app.textContent}`);
assert.equal(r.unsafe,0);assert.match(r.text,/<script>/);
});
test('legacy jobs without supply metadata do not invent an explanation',async()=>{
assert.equal(await run(`return issueSupplyDetails({result:{articles:2}})+issueSupplyText({})`),'');
});
test('delivery history shows the submitted publication identity, not a fallback bucket',async()=>{
const r=await run(`state={jobs:[{id:'job',reason:'scheduled',status:'sent',edition_name:'Unsectioned',created_at:'2026-09-27T11:00:00Z',result:{articles:2,edition_title:'Long Form — September 27, 2026'}}]};api=async()=>state;await historyModal();return modal.querySelector('.preview-item strong').textContent`);
assert.equal(r,'Long Form — September 27, 2026');
});
