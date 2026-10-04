import { strict as assert } from "node:assert";
import { extractArticleDocument, recoverEmbeddedImageUrl, sanitizeArticleHtml } from "../functions/_shared/article.ts";
import { ArticleContentError, ArticlePreparationError, jobRetryDelay } from "../functions/_shared/preparation-errors.ts";
import { PublicHttpError } from "../functions/_shared/network-retry.ts";

Deno.test("optimizer parameters do not leak into an encoded publisher image URL", () => {
  const origin = "https://www-cdn.anthropic.com/images/site/diagram.png";
  assert.equal(recoverEmbeddedImageUrl(`/_next/image?url=${encodeURIComponent(origin)}&w=3840&q=75`), origin);
  const html = sanitizeArticleHtml(`<p>Diagram</p><img alt="Diagram" src="/_next/image?url=${encodeURIComponent(origin)}&amp;w=3840&amp;q=75">`, "https://www.anthropic.com/engineering/example");
  assert.ok(html.includes(`src="${origin}"`));
  assert.ok(!html.includes("png&amp;w="));
});

Deno.test("image recovery preserves the publisher query and already absolute URLs", () => {
  const origin = "https://images.example.org/diagram.png?width=1000&format=png";
  assert.equal(recoverEmbeddedImageUrl(`/_next/image?url=${encodeURIComponent(origin)}&w=3840&q=75`), origin);
  assert.equal(recoverEmbeddedImageUrl(origin), origin);
  assert.equal(recoverEmbeddedImageUrl("https://example.org/image?url=literal&w=400"), "https://example.org/image?url=literal&w=400");
  assert.equal(recoverEmbeddedImageUrl("/images/plain.png"), "/images/plain.png");
});

Deno.test("PMC authored content preserves abstract, tables, conclusion and references without site controls", () => {
  const paragraph = "An authored discussion of training readiness, fatigue, performance and measurement. ".repeat(8);
  const html = `<!doctype html><html><head><title>Research - PMC</title><meta name="citation_title" content="Research"><meta name="citation_author" content="First Author"><meta name="citation_author" content="Second Author"><meta name="citation_publication_date" content="2020 Aug 19"><meta property="og:site_name" content="PMC"></head><body><nav>Site navigation</nav><article><section aria-label="Article metadata">Publication controls</section><section aria-label="Article content"><section class="body main-article-body"><section class="abstract"><h2>Abstract</h2><p>${paragraph}</p></section><section><h2>Methods</h2><table><tr><th>Measure</th><td>Readiness</td></tr></table><pre>if ready:\n    train()</pre></section><section><h2>Conclusion</h2><p>Final authored conclusion.</p></section></section><section id="ref-list"><h2>References</h2><p>Source reference retained.</p></section></section></article><footer>Site footer</footer></body></html>`;
  const result = extractArticleDocument(html, "https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/");
  assert.equal(result.title, "Research");
  assert.equal(result.author, "First Author & Second Author");
  assert.equal(result.publishedAt, "2020-08-19T00:00:00.000Z");
  for (const text of ["Abstract", "Readiness", "Final authored conclusion.", "Source reference retained.", "if ready:\n    train()"])
    assert.ok(result.html.includes(text), text);
  for (const text of ["Site navigation", "Publication controls", "Site footer"])
    assert.ok(!result.html.includes(text), text);
});

Deno.test("unreadable and challenge documents are terminal content errors, not fake articles", () => {
  assert.throws(() => extractArticleDocument("<html><head><title>Checking your browser</title></head><body>Please enable JavaScript.</body></html>", "https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/"), ArticleContentError);
});

Deno.test("permanent HTTP failures retain their type through article context", () => {
  for (const status of [400, 401, 403, 404, 410, 415]) {
    const original = new PublicHttpError(status);
    const wrapped = new ArticlePreparationError(4, original);
    assert.equal(wrapped.cause, original);
    assert.equal(wrapped.message, `Article 4 could not be prepared: The publisher returned HTTP ${status}.`);
    assert.equal(jobRetryDelay(wrapped, 1), null);
  }
  assert.equal(jobRetryDelay(new ArticlePreparationError(5, new ArticleContentError("No main text")), 1), null);
});

Deno.test("transient failures retain bounded retries and respect Retry-After", () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    assert.equal(jobRetryDelay(new ArticlePreparationError(1, new PublicHttpError(status)), 1), 600_000);
    assert.equal(jobRetryDelay(new ArticlePreparationError(1, new PublicHttpError(status)), 3), null);
  }
  assert.equal(jobRetryDelay(new ArticlePreparationError(1, new PublicHttpError(429, 3_600_000)), 1), 3_600_000);
  assert.equal(jobRetryDelay(new Error("Receipt write failed"), 2), 1_200_000);
  const cyclic = new Error("Unknown failure"); cyclic.cause = cyclic;
  assert.equal(jobRetryDelay(cyclic, 1), 600_000);
});
