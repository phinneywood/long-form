import {feedCandidates} from '../functions/_shared/feed-candidates.ts';
import {nightDiscovery} from '../functions/_shared/night-discovery.ts';
function assert(v:unknown,m='Assertion failed'):asserts v{if(!v)throw Error(m)}
Deno.test('shared chronological parser preserves RSS, Atom and RDF originals without an AI filter',()=>{
 const rss=feedCandidates('<rss><channel><item><title><![CDATA[A <b>history</b> story]]></title><link>https://example.com/a</link><pubDate>Thu, 01 Oct 2026 00:00:00 GMT</pubDate></item><item><title>B</title><link>https://example.com/b</link></item></channel></rss>','Publisher',1);
 assert(rss.length===1&&rss[0].title==='A history story'&&rss[0].published_at==='2026-10-01T00:00:00.000Z');
 const atom=feedCandidates('<feed><entry><title>Original</title><link href="https://example.com/atom"/><updated>2026-10-01</updated></entry></feed>','Atom');assert(atom[0].url==='https://example.com/atom');
 const rdf=feedCandidates('<rdf:RDF><item><title>Another original</title><link>https://example.com/rdf</link></item></rdf:RDF>','RDF');assert(rdf[0].source==='RDF');
});
Deno.test('publisher discovery is bounded, failure-tolerant and never mutates user subscriptions',async()=>{
 const calls:string[]=[];const result=await nightDiscovery({read:async(url,name)=>{calls.push(url);if(name==='Aeon')throw Error('Unavailable');return Array.from({length:20},(_,i)=>({title:name+' '+i,url:url+i,source:name}));}});
 assert(calls.length===5&&result.items.length===80&&result.issues.length===1);assert(result.items.every(a=>!a.feed_id),'Discovered inputs are never falsely subscribed');
});
