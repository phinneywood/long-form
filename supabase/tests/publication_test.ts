import {featuredPath,publicationItems,summarizeEdition,editorReply,editorExchanges,preferenceOnly,paragraphs} from "../functions/_shared/publication.ts";
import {validateNightPlan,nightBundles,assessNightBundle,canonicalKey} from "../functions/_shared/night-edition.ts";
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
 let sent:any;await editorReply({reading:{visible_paragraphs:ps},evidence:[{id:'reading'}]},{apiKey:'test',fetchImpl:async(_u,i)=>{sent=JSON.parse(String(i?.body));return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({answer:'The argument is grounded.',action:'answer',guidance:null,minutes:null,citations:['reading']})}]}]})}});
 assert(!sent.tools);assert(sent.input[1].content.includes('Second original argument.'));assert(sent.input[0].content.includes('confirmation action'));
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
