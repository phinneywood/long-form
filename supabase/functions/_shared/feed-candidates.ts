import { XMLParser } from "npm:fast-xml-parser@5.11.1";
const arr=(x:any)=>x==null?[]:Array.isArray(x)?x:[x];
function text(x:any):string{if(x==null)return"";if(typeof x==="string"||typeof x==="number")return String(x);if(typeof x==="object"){if("__cdata"in x)return text(x.__cdata);if("#text"in x)return text(x["#text"])}return""}
function link(x:any):string{if(typeof x==="string")return x;for(const v of arr(x)){if(typeof v==="string")return v;if(v?.["@_href"])return String(v["@_href"])}return""}
// The existing chronological-preview parser, shared with discovery inputs.
export function feedCandidates(raw:string,name:string,limit=20){
 if(!/<(rss\b|feed\b|rdf:RDF\b)/i.test(raw))throw new Error("This source did not return RSS or Atom.");
 const d:any=new XMLParser({ignoreAttributes:false,attributeNamePrefix:"@_",textNodeName:"#text",cdataPropName:"__cdata"}).parse(raw);
 const entries=d?.rss?.channel?.item??d?.feed?.entry??d?.["rdf:RDF"]?.item;
 return arr(entries).slice(0,Math.max(1,Math.min(200,limit))).map(e=>{const rawDate=text(e.pubDate||e.published||e.updated||e["dc:date"]),date=rawDate?new Date(rawDate):null;return{title:text(e.title).replace(/<[^>]+>/g,"").trim()||"Untitled",url:link(e.link)||text(e.guid||e.id),published_at:date&&!isNaN(+date)?date.toISOString():null,source:name}}).filter(x=>x.url);
}
