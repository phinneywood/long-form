import { prepareIssueSupply, normalizedArticleUrl, needsSupplement, readingWords, withinFeedScope, type DeliveryRecord } from "../functions/_shared/issue-supply.ts";
import { discoverBeyondRss } from "../functions/_shared/discovery.ts";
import type { EpubArticle } from "../functions/_shared/epub.ts";
function assert(value: unknown, message = "Assertion failed"): asserts value { if (!value) throw new Error(message); }
const now = new Date("2026-09-27T11:00:00Z");
const makeArticle = (url: string, words = 1000): EpubArticle => ({ url, canonical_url: normalizedArticleUrl(url), title: url.split('/').at(-1) || 'Article', author: null, source: "Fixture", published_at: null, excerpt: "Original text.", body: `<p>${"word ".repeat(words)}</p>`, article_hash: url, warnings: [], assets: [] });
const feed = { id: 'feed-1', name: 'Fixture feed', url: 'https://example.com/feed', consecutive_failures: 0 };
const rss = (entries: { url: string; days: number }[]) => `<rss><channel>${entries.map(e => `<item><title>${e.url.split('/').at(-1)}</title><link>${e.url}</link><pubDate>${new Date(+now-e.days*86400000).toUTCString()}</pubDate><description>Original text.</description></item>`).join('')}</channel></rss>`;
const lane = (kind: 'related' | 'open', count = 0) => ({ kind, status: 'discovered' as const, model: 'fixture', candidates: count });
async function scenario(options: {
  entries?: { url: string; days: number }[]; feeds?: any[]; pending?: any[]; history?: DeliveryRecord[];
  words?: Record<string,number>; discover?: (call: number, core: EpubArticle[], options: any) => any;
  failUrls?: string[]; failFeed?: boolean; expired?: boolean;
} = {}) {
  const requests: any[] = [], extracted: string[] = [], updates: any[] = [];
  const result = await prepareIssueSupply({ feeds: options.feeds ?? [feed], pending: options.pending || [], history: options.history || [], now, lookbackHours: 48, deadline: options.expired ? Date.now()-1 : Date.now()+90000, editorialBrief: "History and thoughtful original essays.", additionalInstructions: "Do not pad." }, {
    readFeed: (async () => { if(options.failFeed)throw new Error('HTTP 502');return { text: rss(options.entries || []), url: feed.url, response: new Response(), retries: 0 }; }) as any,
    extract: (async (input: any) => { extracted.push(input.url);if(options.failUrls?.includes(input.url))throw new Error('Unreadable');return makeArticle(input.url, options.words?.[input.url] ?? 1000); }) as any,
    organize: (async (articles: EpubArticle[]) => ({ articles: articles.map(a => ({ ...a, section_name: 'Other' })), report: { status: 'edited', model: 'fixture', sections: articles.length ? 1 : 0, topics: 0, other: articles.length } })) as any,
    discover: (async (core: EpubArticle[], _brief: string, args: any) => { requests.push({ core, args }); return options.discover?.(requests.length, core, args) || { related: [], open: [], report: { related: lane('related'), open: lane('open') } }; }) as any,
    introduce: (async () => ({ paragraph: null, report: { status: 'fallback', model: 'fixture', words: 0 } })) as any,
    updateFeed: async (_feed, patch) => { updates.push(patch); },
  });
  return { ...result, requests, extracted, updates, articles: result.groups.flatMap(g => g.items), supply: result.editorial.supply };
}
Deno.test('reading target uses full original text and is a soft supplement target', () => {
  assert(readingWords([makeArticle('https://example.com/long',6750)])===6750);
  assert(!needsSupplement([makeArticle('https://example.com/long',6750)],0));
  assert(needsSupplement([makeArticle('https://example.com/short',10)],0));
  assert(!needsSupplement([],4));
});
Deno.test('zero RSS can produce an Open Discovery issue without invented related themes', async () => {
  const calls: string[]=[];
  const result=await discoverBeyondRss([], 'History and literature.', { apiKey:'test',openLimit:4,deadline:Date.now()+40000,fetchImpl:(async (_url,init)=>{
    const body=JSON.parse(String(init?.body));calls.push(body.text.format.name);
    assert(body.text.format.schema.properties.articles.maxItems===4);
    return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({articles:[{url:'https://example.com/history',title:'History essay',reason:'A substantial original essay.'}]})}]}]});
  }) as typeof fetch});
  assert(calls.length===1 && calls[0]==='morning_reader_open_discovery');
  assert(result.report.related.status==='skipped' && result.open.length===1);
});
Deno.test('all fresh originals and saved articles precede bounded seven-day catch-up', async () => {
  const r=await scenario({entries:[{url:'https://example.com/fresh',days:1},{url:'https://example.com/older',days:5},{url:'https://example.com/expired',days:8}],pending:[{id:'save-1',url:'https://example.com/saved'}],words:{'https://example.com/fresh':1000,'https://example.com/saved':4000,'https://example.com/older':2000}});
  assert(r.supply.fresh_articles===1 && r.supply.saved_articles===1 && r.supply.catchup_articles===1);
  assert(r.supply.word_count===7000 && r.supply.estimated_reading_minutes===32);
  assert(r.requests.length===0 && !r.extracted.includes('https://example.com/expired'));
  assert(r.extracted.indexOf('https://example.com/saved')<r.extracted.indexOf('https://example.com/older'));
  assert(r.supply.feed_reports[0].outside_window===1);
});
Deno.test('large RSS issues keep every original and add no filler', async () => {
  const entries=Array.from({length:10},(_,i)=>({url:`https://example.com/fresh-${i}`,days:1}));
  const r=await scenario({entries});
  assert(r.articles.length===10 && r.requests.length===0 && r.supply.supplements===0);
  assert(r.articles.every(a=>readingWords([a])===1000));
});
Deno.test('four-supplement cap applies jointly to catch-up and both discovery lanes', async () => {
  const entries=Array.from({length:8},(_,i)=>({url:`https://example.com/older-${i}`,days:3+i/10}));
  const r=await scenario({entries});
  assert(r.supply.catchup_articles===4 && r.supply.supplements===4 && r.requests.length===0);
  const counted=r.supply.feed_reports[0];
  assert(counted.catchup_included+counted.not_needed===counted.entries_scanned);
  assert(r.supply.short_issue, 'cap must not force longer or synthetic articles');
});
Deno.test('catch-up excludes all delivery kinds and tracking variants', async () => {
  const r=await scenario({entries:[{url:'https://example.com/old?utm_source=feed',days:3}],history:[{article_hash:'legacy',canonical_url:'https://example.com/old?utm_source=nightly',delivery_kind:'one_time'}]});
  assert(r.supply.catchup_articles===0 && r.supply.feed_reports[0].already_delivered===1);
});
Deno.test('discovery gets exactly one replacement pass for a prior delivery', async () => {
  const r=await scenario({feeds:[],history:[{article_hash:'old-hash',canonical_url:'https://example.com/old',delivery_kind:'one_time'}],discover:call=>({related:[],open:[{url:call===1?'https://example.com/old':'https://example.com/new',title:'Essay',reason:'Original thoughtful reading.'}],report:{related:lane('related'),open:lane('open',1)}})});
  assert(r.requests.length===2 && r.supply.discovery_articles===1);
  assert(r.articles[0].url==='https://example.com/new' && !r.extracted.includes('https://example.com/old'));
});
Deno.test('unextractable candidates are replaced once, but empty quality decisions are not retried', async () => {
  const failed=await scenario({feeds:[],failUrls:['https://example.com/bad'],discover:call=>({related:[],open:[{url:call===1?'https://example.com/bad':'https://example.com/good',title:'Essay',reason:'Substantial original.'}],report:{related:lane('related'),open:lane('open',1)}})});
  assert(failed.requests.length===2 && failed.supply.discovery_articles===1);
  const empty=await scenario({feeds:[]});assert(empty.requests.length===1 && empty.articles.length===0);
});
Deno.test('rejected structured discovery output remains observable for bounded replacement', async () => {
  const result=await discoverBeyondRss([], 'History.', {apiKey:'test',deadline:Date.now()+40000,excludedUrls:['https://example.com/old'],fetchImpl:(async()=>Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({articles:[{url:'https://example.com/old',title:'Old',reason:'Already delivered.'}]})}]}]})) as typeof fetch});
  assert(result.open.length===0 && result.report.open.rejected_candidates===1);
});
Deno.test('deadline and publisher failures are distinguished from genuinely quiet supply', async () => {
  const expired=await scenario({expired:true});assert(expired.supply.unchecked_sources===1 && expired.requests.length===0);
  const failed=await scenario({failFeed:true});assert(failed.supply.failed_sources===1 && failed.issues.some(i=>i.includes('502')));
  const quiet=await scenario();assert(quiet.supply.failed_sources===0 && quiet.supply.unchecked_sources===0 && quiet.issues.length===0);
});
Deno.test('scoped HN feeds cannot silently become general HN', () => {
  const url='https://hnrss.org/newest?q=mustafa-suleyman.ai&search_attrs=url';
  assert(withinFeedScope(url,'https://mustafa-suleyman.ai/post'));
  assert(!withinFeedScope(url,'https://other.example/post'));
  assert(!withinFeedScope(url,'https://mustafa-suleyman.ai.evil.example/post'));
});
Deno.test('repeated candidate runs preserve every fresh article and deterministic safety limits', async () => {
  for(let i=0;i<8;i++) {
    const r=await scenario({entries:[{url:'https://example.com/fresh',days:1}],discover:()=>({related:[],open:Array.from({length:4},(_,n)=>({url:`https://outside.example/essay-${i}-${n}`,title:'Essay',reason:'A strong original essay.'})),report:{related:lane('related'),open:lane('open',4)}})});
    assert(r.articles.some(a=>a.url==='https://example.com/fresh'));
    assert(r.supply.supplements<=4 && new Set(r.articles.map(a=>a.canonical_url)).size===r.articles.length);
  }
});
Deno.test('catch-up and both discovery lanes share one supplement cap',async()=>{
 const r=await scenario({entries:[{url:'https://example.com/fresh',days:1},{url:'https://example.com/older',days:4}],discover:()=>({related:[{url:'https://outside.example/related',title:'Related',reason:'Evidence for a core theme.'}],open:Array.from({length:4},(_,i)=>({url:`https://outside.example/open-${i}`,title:'Detour',reason:'An excellent original.'})),report:{related:lane('related',1),open:lane('open',4)}})});
 assert(r.supply.catchup_articles===1 && r.supply.discovery_articles===3 && r.supply.supplements===4);
 assert(r.articles.length===5 && r.requests.length===1);
});
Deno.test('saved duplicate remains a single original and carries its queue identity',async()=>{
 const r=await scenario({entries:[{url:'https://example.com/same',days:1}],pending:[{id:'saved-1',url:'https://example.com/same'}]});
 assert(r.articles.length===1 && r.pendingItems.length===0 && r.articles[0].pending_ids?.includes('saved-1'));
});
Deno.test('stale scoped feed refreshes are not reported as quiet healthy sources',async()=>{
 const r=await prepareIssueSupply({feeds:[feed],pending:[],history:[],now,lookbackHours:48,deadline:Date.now()+90000,editorialBrief:'',additionalInstructions:''},{
 readFeed:(async()=>({text:'<rss><channel><generator>Long Form scoped feed</generator><lastBuildDate>Mon, 01 Jan 2024 00:00:00 GMT</lastBuildDate></channel></rss>',url:feed.url,response:new Response(),retries:0})) as any,
 organize:(async()=>({articles:[],report:{status:'fallback',model:'fixture',sections:0,topics:0,other:0}})) as any,
 discover:(async()=>({related:[],open:[],report:{related:lane('related'),open:lane('open')}})) as any,
 introduce:(async()=>({paragraph:null,report:{status:'fallback',model:'fixture',words:0}})) as any,
 updateFeed:async()=>{}
 });
 assert(r.editorial.supply.failed_sources===1 && r.issues[0].includes('refresh is stale'));
});
