import {featuredPath,publicationItems,summarizeEdition,editorReply,paragraphs} from "../functions/_shared/publication.ts";
import {validateNightPlan,canonicalKey} from "../functions/_shared/night-edition.ts";
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
Deno.test('night plan rejects duplicate IDs, invented IDs and work-related selections',()=>{
 const a=publicationItems(groups).slice(0,4),plan={articles:[0,1,2].map(index=>({index,topic:'History',reason:'Actual original evidence',work_related:false}))};
 assert(validateNightPlan(plan,a,35).selected.length===3);
 for(const bad of [{articles:[...plan.articles,plan.articles[0]]},{articles:[{...plan.articles[0],index:50}]},{articles:[{...plan.articles[0],work_related:true}]}]){let threw=false;try{validateNightPlan(bad,a,35)}catch{threw=true}assert(threw);}
 assert(canonicalKey('https://example.com/a?utm_source=x#anchor')==='https://example.com/a');
});
