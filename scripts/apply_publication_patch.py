"""One-use, exact-anchor source patch; removed before this branch is merged."""
from pathlib import Path

def replace(text, old, new, count=1):
    assert text.count(old) == count, f"Expected {count} copies of anchor: {old[:100]}"
    return text.replace(old, new)

p = Path('supabase/functions/_shared/epub.ts')
s = p.read_text()
s = replace(s, 'import type { Article, ArticleAsset } from "./article.ts";', 'import type { Article, ArticleAsset } from "./article.ts";\nimport { buildCoverLines, publicationTitle, type CoverLine } from "./publication-identity.ts";')
s = replace(s, 'type CoverLine = { section: string; story: string };\n', '')
start = s.index('function coverSectionName(')
end = s.index('function coverSectionSize(', start)
s = s[:start] + s[end:]
s = replace(s, 'coverLinesFor(articles)', 'buildCoverLines(articles)')
s = replace(s, 'const href = `section-${groupIndex + 1}.xhtml`;', 'const hasDivider = prepared.length > 2;\n    const dividerHref = `section-${groupIndex + 1}.xhtml`;')
s = replace(s, 'return { group, href, articleCount, id: `section-${groupIndex + 1}`, firstArticleIndex };', 'const href = hasDivider ? dividerHref : `article-${(firstArticleIndex ?? 0) + 1}.xhtml`;\n    return { group, href, articleCount, id: `section-${groupIndex + 1}`, firstArticleIndex, hasDivider };')
s = replace(s, 'for (const { group, href, articleCount } of sectionPages) {', 'for (const { group, href, articleCount, hasDivider } of sectionPages) {\n    if (!hasDivider) continue;')
s = replace(s, 'for (const section of sectionPages) {\n    manifest.push', 'for (const section of sectionPages) {\n    if (!section.hasDivider) continue;\n    manifest.push')
s = replace(s, 'spine.push(`<itemref idref="${section.id}"/>`);', 'if (section.hasDivider) spine.push(`<itemref idref="${section.id}"/>`);')
s = replace(s, 'options.libraryTitle || `${options.name} — ${options.displayDate}`', 'options.libraryTitle || publicationTitle(options.name, options.displayDate)')
p.write_text(s)
p = Path('supabase/functions/worker/core.ts')
s = p.read_text()
s = replace(s, 'name: "Unsectioned" }, items: unsectionedItems', 'name: build.email.subject || "Long Form" }, items: unsectionedItems')
p.write_text(s)
