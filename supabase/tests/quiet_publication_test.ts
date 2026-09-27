import JSZip from "npm:jszip@3.10.1";
import { makeEpub, validateEpub, type EpubArticle } from "../functions/_shared/epub.ts";
import { buildCoverLines, publicationTitle } from "../functions/_shared/publication-identity.ts";
function assert(value: unknown, message = "Assertion failed"): asserts value { if (!value) throw new Error(message); }
export function fixture(count = 2): EpubArticle[] {
  // The September 27 incident's shape and public titles, with synthetic text.
  return Array.from({ length: count }, (_, i) => ({
    title: i === 0 ? "Tool: Kākāpō Party" : `A thoughtful detour ${i}`,
    url: `https://example.com/quiet-${i}`, canonical_url: `https://example.com/quiet-${i}`,
    source: "Example publication", author: "Example author", published_at: "2026-09-27T00:00:00Z",
    excerpt: "Synthetic regression text.", body: `<p>${"Original reading text preserved unchanged. ".repeat(30)}</p>`,
    assets: [], warnings: [], article_hash: `quiet-${i}`,
    section_name: i === 0 ? "Other" : "Open Discovery",
  }));
}
Deno.test("catch-all and discovery labels never become cover leads", () => {
  for (const label of ["Other", "Elsewhere", "Open Discovery", "Related Discovery", "Saved articles", "Unsectioned"]) {
    const items = fixture(1).map(a => ({ ...a, section_name: label }));
    assert(buildCoverLines(items)[0].section === items[0].title, label);
  }
  assert(publicationTitle("Long Form", "September 27, 2026") === "Long Form — September 27, 2026");
  assert(buildCoverLines([]).length === 0);
});
Deno.test("one and two story EPUBs preserve identity and navigation without divider pages", async () => {
  for (const count of [1, 2]) {
    const items = fixture(count);
    const bytes = await makeEpub({ name: "Long Form", displayDate: "September 27, 2026", date: new Date("2026-09-27T12:00:00Z"), timezone: "America/Los_Angeles" }, items);
    const qa = await validateEpub(bytes, items);
    const zip = await JSZip.loadAsync(bytes);
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    const nav = await zip.file("OEBPS/nav.xhtml")!.async("string");
    assert(opf.includes("<dc:title>Long Form — September 27, 2026</dc:title>"));
    assert(!Object.keys(zip.files).some(path => /\/section-\d+\.xhtml$/.test(path)));
    assert(qa.contentsEntries === count);
    for (let i = 0; i < count; i++) assert(nav.includes(`href="article-${i + 1}.xhtml"`));
  }
});
Deno.test("coherent multi-story sections may still provide editorial cover lines", () => {
  const items = fixture(2).map(a => ({ ...a, section_name: "Work and attention" }));
  assert(buildCoverLines(items)[0].section === "Work and attention");
});
