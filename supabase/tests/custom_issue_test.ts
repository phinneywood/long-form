import { customIssueInput, customIssueArticles } from "../functions/_shared/custom-issue.ts";
import { extractionBudget } from "../functions/_shared/article.ts";
function assert(v: unknown, m="Assertion failed"): asserts v { if(!v)throw Error(m); }
function rejects(input: unknown) { let rejected=false; try{customIssueInput(input);}catch(e){rejected=(e as any).status===400;}assert(rejected,"Invalid input accepted"); }
Deno.test("custom issues accept exactly one bounded document form and preserve order",()=>{
  for(const input of [{title:"X"},{title:"X",content:"a",sections:[]},{title:"X",sections:[]},{title:"X",content:"a",format:"invalid"},{title:"X",content:"a",source_links:["javascript:alert(1)"]},{title:"X",content:"a".repeat(250001)},{title:"X",sections:Array.from({length:5},()=>({title:"s",content:"a".repeat(210000)}))}])rejects(input);
  const r=customIssueInput({title:" X ",sections:[{title:" First ",content:"1"},{title:"Second",content:"2",format:"html"}],source_links:["https://example.com","https://example.com"]});
  assert(r.title==="X"&&r.sections[0].title==="First"&&r.sections[1].title==="Second"&&r.source_links.length===1);
});
Deno.test("literal text, safe HTML, citations, and independent custom identity survive preparation",async()=>{
  const items=await customIssueArticles(customIssueInput({title:"X",sections:[{title:"Literal",content:"<script>keep as literal</script>\n\n1 < 2 & 3"},{title:"Formatted",format:"html",content:'<h2>Heading</h2><p onclick="bad()">Actual text</p><script>unsafe()</script><a href="javascript:bad()">link</a><pre><code>a &lt; b</code></pre>'}],source_links:["https://example.com/a?x=1&y=2"]}),"job-a",extractionBudget());
  assert(items.length===3&&items[2].title==="Sources");
  assert(items[0].body.includes("&lt;script&gt;")&&items[0].body.includes("1 &lt; 2 &amp; 3"));
  assert(!items[1].body.includes("unsafe()")&&!items[1].body.includes("onclick")&&!items[1].body.includes("javascript:"));
  assert(items[1].body.includes("<code>")&&items[2].body.includes("example.com/a?x=1&amp;y=2"));
  assert(items.every(i=>i.canonical_url.includes("/custom-issues/job-a/")&&i.author===null));
  const other=await customIssueArticles(customIssueInput({title:"X",content:"Actual text"}),"job-b",extractionBudget());
  assert(other[0].article_hash!==items[0].article_hash);
});
Deno.test("HTML without readable material is rejected before EPUB or email generation",async()=>{
  let failed=false;try{await customIssueArticles(customIssueInput({title:"X",content:"<script>bad()</script>",format:"html"}),"job",extractionBudget());}catch(e){failed=(e as any).status===400;}assert(failed);
});
Deno.test("structured Markdown reflows prose and preserves headings, lists, code, tables and safe links",async()=>{
  const content = '## Mental model\n\nA soft-wrapped\nparagraph stays one paragraph.\n\n- First\n- Second\n\n```python\nif ready:\n    publish()\n```\n\n| State | Next |\n| --- | --- |\n| ready | review |\n\n[Reference](https://example.com) <script>unsafe()</script> [bad](javascript:alert(1))';
  const [item] = await customIssueArticles(customIssueInput({title:"Learning",content,format:"markdown"}),"markdown",extractionBudget());
  for(const tag of ['<h2>','<ul>','<li>','<pre>','<code>','<table>','<th>','<td>']) assert(item.body.includes(tag),`Missing semantic ${tag}`);
  assert(!item.body.includes('<br') && item.body.includes('    publish()'),"prose must reflow while code retains indentation");
  assert(!item.body.includes('unsafe()')&&!item.body.includes('javascript:')&&item.body.includes('https://example.com'));
  const [literal]=await customIssueArticles(customIssueInput({title:"Literal",content:'# Not a heading\n\n<em>literal</em>'}),"literal",extractionBudget());
  assert(!literal.body.includes('<h2>')&&literal.body.includes('&lt;em&gt;'),"default text must remain literal");
});
