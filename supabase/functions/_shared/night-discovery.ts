import { fetchPublicText } from "./network.ts";
import { feedCandidates } from "./feed-candidates.ts";
// Public discovery inputs, never added to the user's subscriptions. Feeds
// provide actual current URLs; article content still determines editorial fit.
const publishers=[
 {name:"Aeon",url:"https://aeon.co/feed.rss"},
 {name:"Quanta Magazine",url:"https://www.quantamagazine.org/feed/"},
 {name:"JSTOR Daily",url:"https://daily.jstor.org/feed/"},
 {name:"Nautilus",url:"https://nautil.us/feed/"},
 {name:"Smithsonian Magazine",url:"https://www.smithsonianmag.com/rss/magazine/"},
];
export async function nightDiscovery(options:{read?:(url:string,name:string)=>Promise<any[]>}={}){
 const deadline=Date.now()+8000;
 const read=options.read||(async(url:string,name:string)=>feedCandidates((await fetchPublicText(url,"application/rss+xml,application/atom+xml",1_500_000,deadline)).text,name,20));
 const results=await Promise.all(publishers.map(async p=>{try{return{items:await read(p.url,p.name),error:null}}catch{return{items:[],error:`${p.name} discovery feed was unavailable.`}}}));
 return {items:results.flatMap(r=>r.items).slice(0,100),issues:results.map(r=>r.error).filter((s):s is string=>s!==null)};
}
