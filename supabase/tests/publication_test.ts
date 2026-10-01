import {featuredPath,publicationItems,summarizeEdition,editorReply,editorExchanges,preferenceOnly,paragraphs,explicitEditionSend} from "../functions/_shared/publication.ts";
import {validateNightPlan,nightBundles,assessNightBundle,canonicalKey,composeNight,validateNightSequence,nightCandidatePool,chooseNightBundle} from "../functions/_shared/night-edition.ts";
function assert(v:unknown,m="Assertion failed"):asserts v{if(!v)throw new Error(m)}
const original="This is a substantial original article about a carefully considered historical question. ".repeat(90);
const groups=Array.from({length:4},(_,s)=>({section:{name:`Topic ${s}`},items:Array.from({length:9},(_,i)=>({title:`Original ${s}:${i}`,body:`<p>${original}</p>`,source:`Source ${s}`,feed_id:`feed-${s}`,url:`https://example.com/${s}/${i}`,canonical_url:`https://example.com/${s}/${i}`,assets:[],warnings:[],editorial_decision_reason:`Article ${s}:${i} supplies historical evidence for topic ${s}.`}))}));
Deno.test('36 eligible originals survive a finite diverse featured path with an explicit total',()=>{
 const items=publicationItems(groups),path=featuredPath(items,30);assert(items.length===36);assert(new Set(items.map(i=>i.url)).size===36);assert(path.length<=5&&path[0]===0);assert(new Set(path.map(i=>items[i].source)).size>=3);
 const e=summarizeEdition({id:'issue',manifest:{items,featured:path}});assert(e.items.length===36);assert(e.minutes>e.featured_minutes);assert(e.items.every((i:any)=>!('body'in i)));assert(items[0].body===groups[0].items[0].body,'Never truncate originals');
});
Deno.test('quiet-day supplements preserve exact provenance and source identity',()=>{
 const items=publicationItems([{section:{name:'Detour'},items:[{...groups[0].items[0],feed_id:null,editorial_decision_reason:null,discovery_kind:'open',discovery_reason:'A cultural counterpoint.'},{...groups[1].items[0],supplement_kind:'catchup'}]}]);
 assert(items[0].origin==='open discovery'&&items[0].reason==='A cultural counterpoint.');assert(items[1].origin==='subscribed catch-up');
});
Deno.test('model outage and fabricated citations are explicit non-blocking editor failures',async()=>{
 const offline=await editorReply({}, {apiKey:''});assert(offline.unavailable&&offline.action==='answer');
 const failing=await editorReply({}, {apiKey:'test',fetchImpl:async()=>new Response('',{status:503})});assert(failing.unavailable);
 const hallucinated=await editorReply({evidence:[{id:'actual'}]},{apiKey:'test',fetchImpl:async()=>Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({answer:'An invented history.',action:'answer',guidance:null,minutes:null,citations:['invented']})}]}]})});assert(hallucinated.unavailable);
});
Deno.test('editor receives actual paragraphs and never acquires arbitrary tools',async()=>{
 const ps=paragraphs('<p>First original argument.</p><p>Second original argument.</p>');assert(ps.length===2&&ps[1]==='Second original argument.');
 let sent:any;const reply=await editorReply({reading:{visible_paragraphs:ps},evidence:[{id:'reading'}]},{apiKey:'test',fetchImpl:async(_u,i)=>{sent=JSON.parse(String(i?.body));return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({answer:'The argument is grounded. [reading]',action:'answer',guidance:null,minutes:null,citations:['reading']})}]}]})}});
 assert(!reply.answer.includes('[reading]'),'Evidence links render separately from plain editorial prose');assert(!sent.tools);assert(sent.input[1].content.includes('Second original argument.'));assert(sent.input[0].content.includes('confirmation action'));
 assert(sent.text.format.schema.properties.citations.items.enum.join(',')==='reading','Native citations are constrained to actual retrieved evidence');
});
Deno.test('reading conversation cannot replay another original or historical full-text citations',async()=>{
 const fixture=JSON.parse(await Deno.readTextFile(new URL('../../tests/fixtures/publication-stale-reading-answer.json',import.meta.url))),url='https://example.com/current';
 const current={question:fixture.question,response:{answer:'The current scene concerns a grave.',citations:[{url,title:fixture.current_title,full_text:'PRIVATE DUPLICATE BODY',visible_paragraphs:fixture.visible_paragraphs}]}},previous={question:fixture.question,response:{answer:fixture.failed_answer,citations:[{url:'https://example.com/previous',title:'Squirrel migration',full_text:'Previous original'}]}};
 const exchanges=editorExchanges([current,previous],url);
 assert(exchanges.length===1 && !JSON.stringify(exchanges).includes('squirrels') && !JSON.stringify(exchanges).includes('full_text') && !JSON.stringify(exchanges).includes('PRIVATE DUPLICATE BODY'));
 assert(editorExchanges([current,previous]).length===2,'Global continuity retains compact exchanges');
});
Deno.test('night plan rejects duplicate IDs, invented IDs and work-related selections',()=>{
 const a=publicationItems(groups).slice(0,4),plan={articles:[0,1,2].map(index=>({index,topic:'History',reason:'Actual original evidence',work_related:false}))};
 assert(validateNightPlan(plan,a,35).selected.length===3);
 for(const bad of [{articles:[...plan.articles,plan.articles[0]]},{articles:[{...plan.articles[0],index:50}]},{articles:[{...plan.articles[0],work_related:true}]}]){let threw=false;try{validateNightPlan(bad,a,35)}catch{threw=true}assert(threw);}
 assert(canonicalKey('https://example.com/a?utm_source=x#anchor')==='https://example.com/a');
});

Deno.test('explicit nighttime preference steering cannot accidentally trigger composition',async()=>{
 const fixture=JSON.parse(await Deno.readTextFile(new URL('../../tests/fixtures/publication-steering-misclassified.json',import.meta.url)));
 const question=fixture.question;
 assert(preferenceOnly(question));assert(!preferenceOnly('I have 35 minutes tonight. Find me something surprising.'));
 const bad=fixture.response;
 const reply=await editorReply({question,evidence:[]},{apiKey:'test',fetchImpl:async()=>Response.json({output:[{content:[{type:'output_text',text:JSON.stringify(bad)}]}]})});
 assert(reply.action===fixture.expected_action&&reply.guidance===bad.guidance);
});

Deno.test('night budgets use extracted original lengths and at least three sources',()=>{const article=(source:string,minutes:number)=>({...groups[0].items[0],source,author:null,published_at:null,excerpt:'',article_hash:source,body:'<p>'+('word '.repeat(225*minutes))+'</p>'});const pool=[article('A',4),article('B',14),article('B',16),article('C',17),article('D',6)];const bundles=nightBundles(pool,35);assert(bundles.length>0);assert(bundles.every(b=>b.sources>=3&&b.minutes>=26.25&&b.minutes<=45.5&&b.indices.length>=3&&b.indices.length<=5));assert(nightBundles([article('A',30),article('B',20),article('C',22)],35).length===0);});

Deno.test('model chooses an explicit feasible bundle without substituting or inventing original assessments',()=>{
 const bundles=[{indices:[0,2,4]},{indices:[1,3,5]}],assessment=(index:number)=>({index,topic:'History',reason:'Actual text',work_related:false});
 for(const plan of [{bundle:8,assessments:{}},{bundle:0,assessments:{0:{...assessment(0),rank:1},2:{...assessment(2),rank:2}}}]){let failed=false;try{assessNightBundle(plan,bundles)}catch{failed=true}assert(failed,'No unassessed or unavailable originals');}
 const selected=assessNightBundle({bundle:0,assessments:{0:{...assessment(0),rank:2},2:{...assessment(2),rank:3},4:{...assessment(4),rank:1}}},bundles);
 assert(selected.articles.map((a:any)=>a.index).join(',')==='4,0,2');
 assert(assessNightBundle({bundle:0,assessments:{0:{...assessment(99),rank:1},2:{...assessment(2),rank:2},4:{...assessment(4),rank:3}}},bundles).articles[0].index===0,'Assessment data cannot replace an original ID');
});

Deno.test('night discovery bounds native search and fails without extractable originals',async()=>{
 let sent:any,failed=false;
 try{await composeNight({request:'35 minutes of surprising original reading',minutes:35,brief:'History and science',guidance:'',candidates:[],excluded:[]},{apiKey:'test',fetchImpl:async(_u:any,i:any)=>{sent=JSON.parse(i.body);return Response.json({output:[{content:[{type:'output_text',text:'{"publishers":[]}'}]}]});}});}catch(e){failed=e instanceof Error&&e.message.includes('No suitable original articles');}
 assert(failed);assert(sent.max_tool_calls===1&&sent.tools[0].search_context_size==='low');
 assert(sent.input[0].content.includes('Do not open pages'),'Extract and assess originals through the existing backend');
 assert(sent.store===false);
});

Deno.test('selected-only sequencing rejects real contradictory selection notes and duplicate ranks',async()=>{
 const fixture=JSON.parse(await Deno.readTextFile(new URL('../../tests/fixtures/publication-unselected-ordering.json',import.meta.url)));
 const chosen=fixture.selected.map((a:any)=>a.index),assessments=Object.fromEntries(fixture.selected.map((a:any,i:number)=>[String(a.index),{topic:'History',reason:a.reason,work_related:false,rank:i+1}]));
 let rejected=false;try{validateNightSequence({assessments},chosen)}catch{rejected=true}assert(rejected);
 for(const a of Object.values(assessments) as any[])a.reason='An actual selected original placed in this sequence.';
 assert(validateNightSequence({assessments},chosen).map((a:any)=>a.index).join(',')===chosen.join(','));
 (assessments as any)['1'].rank=1;rejected=false;try{validateNightSequence({assessments},chosen)}catch{rejected=true}assert(rejected);
});

Deno.test('composition sequences the exact extracted selection, never the whole candidate pool',async()=>{
 const fixture=JSON.parse(await Deno.readTextFile(new URL('../../tests/fixtures/publication-neighbor-ordering.json',import.meta.url)));assert(fixture.actual_order[1].includes('Library'));const misbound=JSON.parse(await Deno.readTextFile(new URL('../../tests/fixtures/publication-misbound-explanation.json',import.meta.url)));assert(misbound.wrong_finish_reason.includes('clam'));
 const originalFetch=globalThis.fetch;let chosen:number[]=[],sequenced:any[]=[],stages=0;
 globalThis.fetch=(async(input:RequestInfo|URL)=>{
  const id=Number(new URL(String(input)).pathname.split('/').at(-1));
  return new Response(`<html><head><title>History original ${id}</title><meta property="og:site_name" content="Publisher ${id%5}"></head><body><article><h1>History original ${id}</h1><p>${'Substantial original history and science writing. '.repeat(300+id*10)}</p></article></body></html>`,{headers:{'content-type':'text/html'}});
 }) as typeof fetch;
 try{
  const result=await composeNight({request:'35 minutes, interesting and surprising, not work',minutes:35,brief:'History and science',guidance:'',candidates:[],excluded:[]},{apiKey:'test',fetchImpl:async(_u:any,i:any)=>{
   const sent=JSON.parse(i.body),input=JSON.parse(sent.input[1].content);let output:any;
   if(stages++===0)output={publishers:Array.from({length:5},(_,publisher)=>({domain:'8.8.8.8',urls:[`https://8.8.8.8/${publisher}`,`https://8.8.8.8/${publisher+5}`]}))};
   else if(sent.text.format.schema.properties.assessments && Object.values(sent.text.format.schema.properties.assessments.properties)[0] instanceof Object && (Object.values(sent.text.format.schema.properties.assessments.properties)[0] as any).properties.fit_score){output={assessments:Object.fromEntries(input.articles.map((a:any)=>[String(a.index),{topic:a.index%2?'Culture':'Science',work_related:false,original_article:true,fit_score:5}]))};}
   else if(sent.text.format.schema.properties.assessments){sequenced=input.articles;chosen=sequenced.map(a=>a.index);assert(sequenced.length>=3&&sequenced.length<=5);output={assessments:Object.fromEntries(sequenced.map((a,i)=>[String(a.index),{rank:sequenced.length-i}]))};}
   else if(sent.text.format.schema.properties.reason){assert(input.article?.text&&!input.articles,'Placement is grounded in one original, never a keyed multi-original body');output={reason:`${input.article.title} is a ${input.role}, followed by ${input.next||'the end'}.`};}
   else{assert(input.articles.map((a:any)=>a.title).join('|')===[...sequenced].reverse().map(a=>a.title).join('|'));output={introduction:'An introduction to the exact selected originals.'};}
   return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify(output)}]}]});
  }});
  assert(stages===4+chosen.length);assert(result.groups.map((g:any)=>g.items[0].title).join('|')===[...sequenced].reverse().map(a=>a.title).join('|'));
 }finally{globalThis.fetch=originalFetch;}
});

Deno.test('replenishment bounds candidate planning while retaining actual length fit and diverse publishers',()=>{
 const article=(source:string,minutes:number)=>({...groups[0].items[0],source,author:null,published_at:null,excerpt:'',article_hash:source+minutes,body:'<p>'+('word '.repeat(225*minutes))+'</p>'});
 const short=[article('A',1),article('B',2),article('C',3),article('D',2)];assert(nightBundles(short,35).length===0);
 const replenished=nightCandidatePool([...short,...Array.from({length:20},(_,i)=>article('Publisher '+i%5,8+i%4))],35);
 assert(replenished.length===24&&new Set(replenished.map(a=>a.source)).size>=5);assert(nightBundles(replenished,35).length>0);
});

Deno.test('only an explicit Kindle send instruction opens exact-edition review',()=>{
 assert(explicitEditionSend('Send this to my Kindle.'));assert(explicitEditionSend('Please send this edition to my Kindle'));
 for(const question of ['Do not send this to my Kindle','Should I send this to my Kindle?','Have you sent anything about urbanism lately?','Send a different edition to another address'])assert(!explicitEditionSend(question));
});

Deno.test('editor assessments select a feasible original bundle without work material, page collections or low-fit filler',()=>{
 const bundles=[{indices:[0,1,2],minutes:35,sources:3},{indices:[0,1,3],minutes:34,sources:3}];
 const assessments=Object.fromEntries([0,1,2,3].map(i=>[i,{work_related:false,original_article:true,fit_score:i===3?5:4,topic:'Topic '+i}]));
 assert(chooseNightBundle(assessments,bundles,35).includes(3));assessments[3].work_related=true;assert(chooseNightBundle(assessments,bundles,35).includes(2));
 assessments[2].original_article=false;let rejected=false;try{chooseNightBundle(assessments,bundles,35)}catch{rejected=true}assert(rejected);
 assessments[2].original_article=true;assessments[2].fit_score=1;rejected=false;try{chooseNightBundle(assessments,bundles,35)}catch{rejected=true}assert(rejected);
});
Deno.test('truncated structured model output is an explicit non-blocking preparation failure',async()=>{
 let failed=false;try{await composeNight({request:'35 minutes',minutes:35,brief:'Science',guidance:'',candidates:[],excluded:[]},{apiKey:'test',fetchImpl:async()=>Response.json({status:'incomplete',output:[{content:[{type:'output_text',text:'{"publishers":['}]}]})});}catch(error){failed=error instanceof Error&&error.message.includes('incomplete reading plan')&&error.message.includes('Nothing was sent');}assert(failed);
});

Deno.test('editorial fit is considered before pruning feasible budgets or long replenished originals',()=>{
 const article=(source:string,minutes:number)=>({...groups[0].items[0],source,author:null,published_at:null,excerpt:'',article_hash:source,body:'<p>'+('word '.repeat(225*minutes))+'</p>'});
 const pool=nightCandidatePool([...Array.from({length:12},(_,i)=>article('Work '+i,7)),article('History',18),article('Science',10),article('Culture',7)],35);
 assert(pool.length===15&&pool[12].source==='History','The long original survives replenishment');
 const assessments=Object.fromEntries(pool.map((a,i)=>[String(i),{work_related:i<12,original_article:true,fit_score:4,topic:a.source}]));
 const selected=chooseNightBundle(assessments,nightBundles(pool,35),35);
 assert(selected.join(',')==='12,13,14','Suitable originals beyond the first fifty structural bundles remain eligible');
});

Deno.test('nighttime diversity uses broad assessed subjects rather than unique article labels',()=>{
 const assessments=Object.fromEntries([0,1,2].map(i=>[String(i),{work_related:false,original_article:true,fit_score:5,topic:'Science'}]));
 let rejected=false;try{chooseNightBundle(assessments,[{indices:[0,1,2],minutes:35,sources:3}],35)}catch{rejected=true}assert(rejected);
 assessments['1'].topic='History';assert(chooseNightBundle(assessments,[{indices:[0,1,2],minutes:35,sources:3}],35).length===3);
});
