import { plainText, sanitizeArticleHtml, sha256, hydrateArticleImages, type ExtractionBudget } from "./article.ts";
import { marked } from "npm:marked@16.3.0";
import type { EpubArticle } from "./epub.ts";

export type CustomIssue = { title: string; sections: { title: string; content: string; format: "text" | "html" | "markdown" }[]; source_links: string[] };
const bad = (message: string): never => { throw Object.assign(new Error(message), { status: 400 }); };
const esc = (v: string) => v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

export function customIssueInput(input: any): CustomIssue {
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  if (!title || title.length > 80) bad("Issue title must be 1–80 characters.");
  if ((input.content !== undefined) === (input.sections !== undefined)) bad("Provide content or sections, exactly one.");
  const raw = input.sections ?? [{ title, content: input.content, format: input.format }];
  if (!Array.isArray(raw) || !raw.length || raw.length > 20) bad("Provide 1–20 ordered sections.");
  let total = 0;
  const sections = raw.map((s: any) => {
    if (typeof s?.title !== "string" || !s.title.trim() || s.title.trim().length > 200) bad("Each section needs a title of 1–200 characters.");
    if (typeof s?.content !== "string" || !s.content.trim() || s.content.length > 250_000) bad("Each section needs 1–250,000 characters of content.");
    if (s.format !== undefined && s.format !== "text" && s.format !== "html" && s.format !== "markdown") bad("Content format must be text, html, or markdown.");
    total += s.content.length;
    return { title: s.title.trim(), content: s.content, format: s.format || "text" };
  });
  if (total > 1_000_000) bad("Custom issue content exceeds 1,000,000 characters.");
  const source_links: string[] = input.source_links ?? [];
  if (!Array.isArray(source_links) || source_links.length > 40) bad("Provide at most 40 source links.");
  for (const link of source_links) {
    if (typeof link !== "string" || link.length > 2048) bad("Every source link must be an http(s) URL.");
    try { if (!["https:", "http:"].includes(new URL(link).protocol)) bad("Every source link must be an http(s) URL."); }
    catch { bad("Every source link must be an http(s) URL."); }
  }
  return { title, sections, source_links: [...new Set(source_links)] };
}

export async function customIssueArticles(issue: CustomIssue, jobId: string, budget: ExtractionBudget): Promise<EpubArticle[]> {
  const sections = [...issue.sections];
  if (issue.source_links.length) sections.push({ title: "Sources", format: "html", content: `<ul>${issue.source_links.map(url=>`<li><a href="${esc(url)}">${esc(url)}</a></li>`).join("")}</ul>` });
  const items: EpubArticle[] = [];
  for (const [position, section] of sections.entries()) {
    // Synthetic identity keeps custom text separate from original web articles.
    const url = `https://reader.antonioskilton.com/custom-issues/${jobId}/${position + 1}`;
    const raw = section.format === "markdown" ? marked.parse(section.content, { async: false, gfm: true, breaks: false }) : section.format === "html" ? section.content : section.content.split(/\n\s*\n/).map(p=>`<p>${esc(p).replace(/\n/g,"<br />")}</p>`).join("");
    const body = sanitizeArticleHtml(raw, url);
    if (!plainText(body)) bad(`Section ${position + 1} contains no readable content.`);
    const article: EpubArticle = { title: section.title, url, canonical_url: url, section_name: "Custom issue", source: "Custom content supplied by the reader", author: null, published_at: null, excerpt: plainText(body).slice(0, 500), body, assets: [], warnings: [], article_hash: await sha256(url) };
    items.push(await hydrateArticleImages(article, budget));
  }
  return items;
}
