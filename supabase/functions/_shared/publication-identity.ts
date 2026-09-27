import type { EpubArticle } from "./epub.ts";

/** These are navigation/provenance labels, never editorial cover headlines. */
const BUCKET = /^(?:other|elsewhere|open discovery|related discovery|saved articles|unsectioned|further reading|a deliberate detour)$/i;
export type CoverLine = { section: string; story: string };

function compact(value: string, max = 92): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const clipped = text.slice(0, max - 1).replace(/\s+\S*$/, "").trim();
  return (clipped || text.slice(0, max - 1)).trim() + "…";
}

export function publicationTitle(name: string, displayDate: string): string {
  return `${name.trim() || "Long Form"} — ${displayDate}`;
}

export function buildCoverLines(articles: EpubArticle[]): CoverLine[] {
  const groups = new Map<string, EpubArticle[]>();
  for (const article of articles) {
    const name = String(article.section_name || "Other").trim();
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(article);
  }
  const coherent = [...groups.entries()].filter(([name, items]) => !BUCKET.test(name) && items.length >= 2);
  const rest = [...groups.entries()].filter(([name, items]) => BUCKET.test(name) || items.length < 2);
  const lines: CoverLine[] = [];
  for (const [name, items] of [...coherent, ...rest]) {
    if (!BUCKET.test(name) && items.length >= 2) {
      lines.push({ section: compact(name, 60), story: compact(items[0].title) });
    } else {
      for (const item of items) {
        // A story that belongs to a catch-all still has a real title and author.
        lines.push({ section: compact(item.title), story: compact(item.author || item.source, 100) });
        if (lines.length >= 3) break;
      }
    }
    if (lines.length >= 3) break;
  }
  return lines.slice(0, 3);
}
