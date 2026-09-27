import JSZip from "npm:jszip@3.10.1";
import { makeEpub, validateEpub, type EpubArticle } from "../supabase/functions/_shared/epub.ts";
import { buildCoverLines } from "../supabase/functions/_shared/publication-identity.ts";
const articles: EpubArticle[] = [
  { title: "Tool: Kākāpō Party", source: "Simon Willison’s Weblog", author: "Simon Willison", section_name: "Other" },
  { title: "The pleasures of making things", source: "Example magazine", author: "Example author", section_name: "Open Discovery" },
].map((a, i) => ({ ...a, url: `https://example.com/${i}`, canonical_url: `https://example.com/${i}`, article_hash: `fixture-${i}`, published_at: "2026-09-27T00:00:00Z", excerpt: "Synthetic regression text.", body: `<p>${"This is synthetic text used only to verify the reading layout. ".repeat(40)}</p>`, warnings: [], assets: [] }));
const bytes = await makeEpub({ name: "Long Form", displayDate: "September 27, 2026", date: new Date("2026-09-27T12:00:00Z"), timezone: "America/Los_Angeles" }, articles);
const qa = await validateEpub(bytes, articles);
await Deno.mkdir("/tmp/publication-verification", { recursive: true });
await Deno.writeFile("/tmp/publication-verification/quiet.epub", bytes);
const zip = await JSZip.loadAsync(bytes);
await Deno.writeFile("/tmp/publication-verification/cover.jpg", await zip.file("OEBPS/cover.jpg")!.async("uint8array"));
await Deno.writeTextFile("/tmp/publication-verification/metadata.opf", await zip.file("OEBPS/content.opf")!.async("string"));
console.log(JSON.stringify({ qa, coverLines: buildCoverLines(articles) }));
