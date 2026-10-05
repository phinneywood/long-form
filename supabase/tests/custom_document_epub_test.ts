import { makeEpub, validateEpub } from "../functions/_shared/epub.ts";
import { customIssueInput, customIssueArticles } from "../functions/_shared/custom-issue.ts";
import { extractionBudget } from "../functions/_shared/article.ts";
import JSZip from "npm:jszip@3.10.1";
function assert(v: unknown,m="Assertion failed"): asserts v {if(!v)throw Error(m);}
Deno.test("custom document has working chapter contents without generic buckets or false original links",async()=>{
 const items=await customIssueArticles(customIssueInput({title:"How to Think in Graphs",sections:[{title:"Mental model",format:"markdown",content:"## State\n\nKeep **structured facts**."},{title:"Code",format:"markdown",content:"```python\nif ready:\n    publish()\n```"}],source_links:["https://example.com/reference"]}),"document",extractionBudget());
 const bytes=await makeEpub({name:"How to Think in Graphs",displayDate:"October 3, 2026",date:new Date("2026-10-03T12:00Z"),timezone:"UTC",document:true,label:"Reading packet"},items);
 const qa=await validateEpub(bytes,items);assert(qa.articles===3);
 const zip=await JSZip.loadAsync(bytes);
 for(const file of ["contents.xhtml","nav.xhtml","toc.ncx"]){const s=await zip.file(`OEBPS/${file}`)!.async("string");assert(!s.includes("Custom issue")&&!s.includes("Saved articles"),`${file} contains a generic navigation bucket`);assert(s.includes("Mental model")&&s.includes("Code")&&s.includes("Sources"));}
 const contents=await zip.file("OEBPS/contents.xhtml")!.async("string");assert(contents.includes('href="article-2.xhtml"'),"visible contents must be clickable");
 const body=await zip.file("OEBPS/article-2.xhtml")!.async("string");assert(body.includes('    publish()')&&!body.includes('Original source'),"custom chapters must retain code and omit synthetic-source links");
 assert(!zip.file('OEBPS/section-1.xhtml'),"custom documents must not insert generic section divider pages");
});
