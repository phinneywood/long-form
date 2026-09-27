import { XMLParser } from "npm:fast-xml-parser@5.11.1";
import { extractArticle, extractionBudget, plainText, resolveLinkPostTarget, sha256, textValue, type ExtractArticleInput } from "./article.ts";
import { fetchPublicText } from "./network.ts";
import { editorializeIssue } from "./editorial.ts";
import { discoverBeyondRss, type DiscoveryCandidate } from "./discovery.ts";
import { writeIssueIntroduction } from "./introduction.ts";
import type { EpubArticle } from "./epub.ts";

// Product defaults: a supplement target, never a limit on fresh RSS or originals.
export const SUPPLY_POLICY = Object.freeze({ targetMinutes: 30, wordsPerMinute: 225, catchupDays: 7, maxSupplements: 4, maxSupplementAttempts: 8 });
export type DeliveryRecord = { article_hash: string; canonical_url: string; delivery_kind?: string };
export type FeedReport = {
  feed_id: string; name: string; status: "ok" | "failed" | "not_checked";
  entries_seen: number; entries_scanned: number; scan_limited: number;
  already_delivered: number; outside_window: number; invalid: number; out_of_scope: number;
  duplicates: number; extraction_failed: number; resource_deferred: number; not_needed: number;
  fresh_candidates: number; catchup_available: number; fresh_included: number; catchup_included: number;
  retries: number; error?: string;
};
export type SupplyDependencies = {
  readFeed?: typeof fetchPublicText;
  extract?: typeof extractArticle;
  organize?: typeof editorializeIssue;
  discover?: typeof discoverBeyondRss;
  introduce?: typeof writeIssueIntroduction;
  updateFeed: (feed: any, patch: Record<string, unknown>) => Promise<void>;
  log?: (event: string, fields: Record<string, unknown>) => void;
};
export function normalizedArticleUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch { return ""; }
}
export function readingWords(articles: Pick<EpubArticle, "body">[]): number {
  return articles.reduce((total, article) => total + (plainText(article.body).match(/\S+/g)?.length || 0), 0);
}
export function needsSupplement(articles: Pick<EpubArticle, "body">[], included: number): boolean {
  return included < SUPPLY_POLICY.maxSupplements && readingWords(articles) < SUPPLY_POLICY.targetMinutes * SUPPLY_POLICY.wordsPerMinute;
}
export function withinFeedScope(feedUrl: string, articleUrl: string): boolean {
  try {
    const feed = new URL(feedUrl);
    if (feed.hostname !== "hnrss.org" || feed.searchParams.get("search_attrs") !== "url") return true;
    const query = (feed.searchParams.get("q") || "").replace(/^"|"$/g, "").toLowerCase();
    // Only enforce an exact hostname constraint when that is the actual query.
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(query)) return true;
    const host = new URL(articleUrl).hostname.toLowerCase();
    return host === query || host.endsWith("." + query);
  } catch { return false; }
}
function array(value: any): any[] { return value == null ? [] : Array.isArray(value) ? value : [value]; }
function href(entry: any): string {
  for (const link of array(entry.link)) {
    if (typeof link === "string") return link;
    if (link?.["@_href"] && (!link["@_rel"] || link["@_rel"] === "alternate")) return String(link["@_href"]);
  }
  return textValue(entry.guid || entry.id);
}
function content(entry: any): { html: string; kind: "full" | "summary" } {
  if (entry["content:encoded"] != null) return { html: textValue(entry["content:encoded"]), kind: "full" };
  if (entry.content != null) return { html: textValue(entry.content), kind: "full" };
  return { html: textValue(entry.description ?? entry.summary ?? ""), kind: "summary" };
}
function reportFor(feed: any): FeedReport {
  return { feed_id: feed.id, name: feed.name, status: "not_checked", entries_seen: 0, entries_scanned: 0, scan_limited: 0, already_delivered: 0, outside_window: 0, invalid: 0, out_of_scope: 0, duplicates: 0, extraction_failed: 0, resource_deferred: 0, not_needed: 0, fresh_candidates: 0, catchup_available: 0, fresh_included: 0, catchup_included: 0, retries: 0 };
}
type Candidate = { input: ExtractArticleInput; feed: any; report: FeedReport; age: "fresh" | "catchup"; hash: string };
type Group = { section: { id: null; name: string }; items: EpubArticle[] };

export async function prepareIssueSupply(input: {
  feeds: any[]; pending: any[]; history: DeliveryRecord[]; now: Date;
  lookbackHours: number; deadline: number; editorialBrief: string; additionalInstructions: string;
}, deps: SupplyDependencies) {
  const read = deps.readFeed || fetchPublicText;
  const extract = deps.extract || extractArticle;
  const organize = deps.organize || editorializeIssue;
  const discover = deps.discover || discoverBeyondRss;
  const introduce = deps.introduce || writeIssueIntroduction;
  const log = deps.log || (() => {});
  const budget = extractionBudget(input.deadline);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", cdataPropName: "__cdata" });
  const cutoff = +input.now - input.lookbackHours * 3_600_000;
  const archiveCutoff = +input.now - SUPPLY_POLICY.catchupDays * 86_400_000;
  const issues: string[] = [];
  const reports = input.feeds.map(reportFor);
  const recurringUrls = new Set(input.history.filter(r => !r.delivery_kind || r.delivery_kind === "recurring").map(r => normalizedArticleUrl(r.canonical_url)));
  const recurringHashes = new Set(input.history.filter(r => !r.delivery_kind || r.delivery_kind === "recurring").map(r => r.article_hash));
  const allUrls = new Set(input.history.map(r => normalizedArticleUrl(r.canonical_url)));
  const allHashes = new Set(input.history.map(r => r.article_hash));
  const delivered = (url: string, hash: string, age: "fresh" | "catchup") => age === "fresh"
    ? recurringUrls.has(normalizedArticleUrl(url)) || recurringHashes.has(hash)
    : allUrls.has(normalizedArticleUrl(url)) || allHashes.has(hash);
  const corpus = new Set<string>();
  const fresh: Candidate[] = [], catchup: Candidate[] = [];
  const seenInput = new Set<string>();

  // Fetch concurrently, but classify and extract in source order for determinism.
  const entriesByFeed: any[][] = new Array(input.feeds.length).fill(null).map(() => []);
  let cursor = 0;
  async function fetchWorker() {
    while (true) {
      const index = cursor++;
      if (index >= Math.min(100, input.feeds.length)) return;
      const feed = input.feeds[index], report = reports[index];
      if (Date.now() >= budget.deadline) continue;
      try {
        const fetched = await read(feed.url, "application/rss+xml, application/atom+xml, application/xml, text/xml, */*", 1_500_000, budget.deadline);
        const parsed: any = parser.parse(fetched.text);
        if (!(parsed?.rss && Object.hasOwn(parsed.rss, "channel")) && !Object.hasOwn(parsed || {}, "feed") && !Object.hasOwn(parsed || {}, "rdf:RDF")) throw new Error("This source did not return a valid RSS or Atom feed.");
        if (textValue(parsed?.rss?.channel?.generator) === "Long Form scoped feed") {
          const refreshedAt = Date.parse(textValue(parsed.rss.channel.lastBuildDate));
          if (!Number.isFinite(refreshedAt) || Date.now() - refreshedAt > 18 * 3_600_000) throw new Error("The scoped feed refresh is stale; its last successful refresh was over 18 hours ago.");
        }
        const entries = array(parsed?.rss?.channel?.item ?? parsed?.feed?.entry ?? parsed?.["rdf:RDF"]?.item);
        report.status = "ok";
        report.retries = fetched.retries || 0;
        report.entries_seen = entries.length;
        report.entries_scanned = Math.min(100, entries.length);
        report.scan_limited = Math.max(0, entries.length - 100);
        entriesByFeed[index] = entries.slice(0, 100);
      } catch (error) {
        report.status = "failed";
        report.error = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, input.feeds.length) }, fetchWorker));
  for (const [index, feed] of input.feeds.entries()) {
    const report = reports[index];
    if (report.status === "failed") issues.push(`${feed.name}: ${report.error}`);
    for (const entry of entriesByFeed[index]) {
      const body = content(entry);
      const url = normalizedArticleUrl(resolveLinkPostTarget(body.html, href(entry)).url);
      if (!url) { report.invalid++; continue; }
      corpus.add(url);
      if (!withinFeedScope(feed.url, url)) { report.out_of_scope++; continue; }
      const rawDate = textValue(entry.pubDate || entry.published || entry.updated || entry["dc:date"]);
      const stamp = rawDate ? Date.parse(rawDate) : NaN;
      const publishedAt = Number.isFinite(stamp) ? new Date(stamp).toISOString() : null;
      const age = publishedAt && stamp < cutoff ? "catchup" : "fresh";
      if (age === "catchup" && stamp < archiveCutoff) { report.outside_window++; continue; }
      const hash = await sha256(url);
      if (delivered(url, hash, age)) { report.already_delivered++; continue; }
      if (seenInput.has(url)) { report.duplicates++; continue; }
      seenInput.add(url);
      const candidate: Candidate = { feed, report, age, hash, input: {
        url, title: plainText(textValue(entry.title)) || "Untitled", source: feed.name,
        author: plainText(textValue(entry.author?.name || entry.author || entry["dc:creator"])) || null,
        publishedAt, feedHtml: body.html, feedKind: body.kind, includeImages: false, budget,
      } };
      if (age === "fresh") { report.fresh_candidates++; fresh.push(candidate); }
      else { report.catchup_available++; catchup.push(candidate); }
    }
  }

  const core: EpubArticle[] = [], pendingItems: EpubArticle[] = [];
  const seen = new Set<string>();
  let supplementCount = 0, supplementAttempts = 0;
  async function prepareCandidate(candidate: Candidate): Promise<EpubArticle | null> {
    const report = candidate.report;
    try {
      const article = await extract(candidate.input);
      const key = normalizedArticleUrl(article.canonical_url || article.url);
      if (delivered(key, article.article_hash, candidate.age)) { report.already_delivered++; return null; }
      if (seen.has(key)) { report.duplicates++; return null; }
      seen.add(key);
      if (candidate.age === "fresh") report.fresh_included++; else report.catchup_included++;
      return { ...article, feed_id: candidate.feed.id, section_id: null, ...(candidate.age === "catchup" ? { supplement_kind: "catchup" as const } : {}) };
    } catch (error) {
      report.extraction_failed++;
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`${candidate.feed.name}: ${candidate.input.title} could not be extracted.`);
      log("article.extract_failed", { feed_id: candidate.feed.id, url: candidate.input.url, error: message });
      return null;
    }
  }
  for (const candidate of fresh) {
    if (core.length >= 60 || candidate.report.fresh_included >= 12 || Date.now() >= budget.deadline) { candidate.report.resource_deferred++; continue; }
    const article = await prepareCandidate(candidate);
    if (article) core.push(article);
  }
  for (const pending of input.pending) {
    if (Date.now() >= budget.deadline) { issues.push("Preparation limit reached; some saved articles were deferred."); break; }
    try {
      const article = await extract({ url: pending.url, includeImages: false, budget });
      const key = normalizedArticleUrl(article.canonical_url || article.url);
      if (seen.has(key)) {
        // Preserve the saved queue identity on the existing article, not a duplicate.
        const existing = [...core, ...pendingItems].find(a => normalizedArticleUrl(a.canonical_url || a.url) === key);
        if (existing) existing.pending_ids = [...new Set([...(existing.pending_ids || []), pending.id])];
        continue;
      }
      seen.add(key);
      pendingItems.push({ ...article, pending_id: pending.id, section_name: pending.section_name || "Saved articles" });
    } catch { issues.push(`Saved article could not be prepared: ${pending.url}`); }
  }
  const freshArticles = core.length;
  catchup.sort((a, b) => Date.parse(b.input.publishedAt!) - Date.parse(a.input.publishedAt!));
  const catchupDeadline = Math.min(budget.deadline, input.deadline - 20_000, Date.now() + 16_000);
  for (const candidate of catchup) {
    if (!needsSupplement([...core, ...pendingItems], supplementCount)) { candidate.report.not_needed++; continue; }
    if (supplementAttempts >= SUPPLY_POLICY.maxSupplementAttempts || Date.now() >= catchupDeadline) { candidate.report.resource_deferred++; continue; }
    candidate.input.budget = { ...budget, deadline: catchupDeadline };
    supplementAttempts++;
    const article = await prepareCandidate(candidate);
    if (article) { core.push(article); supplementCount++; }
  }

  for (const [index, feed] of input.feeds.entries()) {
    const report = reports[index];
    if (report.status === "not_checked") continue;
    const problem = report.status === "failed" || report.extraction_failed > 0 || report.out_of_scope > 0;
    const error = report.error || (report.out_of_scope ? "The scoped feed returned off-topic URLs; those entries were excluded." : report.extraction_failed ? `${report.extraction_failed} articles could not be extracted.` : null);
    if (report.out_of_scope) issues.push(`${feed.name}: ${error}`);
    const now = new Date().toISOString();
    await deps.updateFeed(feed, { last_fetch_at: now, ...(problem ? {} : { last_success_at: now }), last_error: error, consecutive_failures: problem ? Number(feed.consecutive_failures || 0) + 1 : 0 });
    log("feed.accounted", report);
  }
  if (reports.some(r => r.status === "not_checked" || r.resource_deferred > 0 || r.scan_limited > 0)) issues.push("Preparation limits deferred some source entries; see issue details.");

  const organized = await organize(core, { deadline: input.deadline, editorialBrief: input.editorialBrief, additionalInstructions: input.additionalInstructions });
  const organizedCore = organized.articles;
  const groups: Group[] = [];
  for (const article of organizedCore) {
    const name = article.section_name || "Other";
    let group = groups.find(g => g.section.name === name);
    if (!group) { group = { section: { id: null, name }, items: [] }; groups.push(group); }
    group.items.push({ ...article, section_name: name, section_id: null });
  }
  const selected = [...organizedCore, ...pendingItems];
  const tried = new Set<string>();
  const attempts: any[] = [];
  const included = { related: 0, open: 0 };
  let rejectedCandidates = 0;
  const discoveryDeadline = Math.min(input.deadline - 6000, Date.now() + 35_000);
  const exclusions = () => [...new Set([...tried, ...seen, ...allUrls, ...corpus])].filter(Boolean);
  for (let pass = 0; pass < 2; pass++) {
    if (!needsSupplement(selected, supplementCount) || (pass === 1 && !rejectedCandidates)) break;
    if (Date.now() + 12_000 >= discoveryDeadline || supplementAttempts >= SUPPLY_POLICY.maxSupplementAttempts) break;
    const slots = SUPPLY_POLICY.maxSupplements - supplementCount;
    const result = await discover(organizedCore, input.editorialBrief, {
      deadline: discoveryDeadline, additionalInstructions: input.additionalInstructions,
      relatedLimit: Math.min(2, slots), openLimit: slots, excludedUrls: exclusions(),
    });
    attempts.push(result.report);
    const plan: { candidate: DiscoveryCandidate; kind: "related" | "open" }[] = [
      ...result.related.map(candidate => ({ candidate, kind: "related" as const })),
      ...result.open.map(candidate => ({ candidate, kind: "open" as const })),
    ];
    if (!plan.length) {
      rejectedCandidates = Number(result.report.related.rejected_candidates || 0) + Number(result.report.open.rejected_candidates || 0);
      if (pass === 0 && rejectedCandidates) continue;
      break; // An empty quality decision is not a reason to pad.
    }
    rejectedCandidates = 0;
    for (const { candidate, kind } of plan) {
      if (!needsSupplement(selected, supplementCount) || supplementAttempts >= SUPPLY_POLICY.maxSupplementAttempts || Date.now() >= discoveryDeadline) break;
      const url = normalizedArticleUrl(candidate.url);
      if (!url || tried.has(url) || seen.has(url) || allUrls.has(url) || corpus.has(url)) { rejectedCandidates++; continue; }
      tried.add(url); supplementAttempts++;
      try {
        const article = await extract({ url, includeImages: false, budget: { ...budget, deadline: discoveryDeadline } });
        const key = normalizedArticleUrl(article.canonical_url || article.url);
        if (seen.has(key) || corpus.has(key) || allUrls.has(key) || allHashes.has(article.article_hash)) { rejectedCandidates++; continue; }
        const name = kind === "related" ? "Related Discovery" : "Open Discovery";
        const item: EpubArticle = { ...article, feed_id: null, section_id: null, section_name: name, discovery_kind: kind, discovery_reason: candidate.reason, editorial_topic: null };
        let group = groups.find(g => g.section.name === name);
        if (!group) { group = { section: { id: null, name }, items: [] }; groups.push(group); }
        group.items.push(item); selected.push(item); seen.add(key); supplementCount++; included[kind]++;
      } catch (error) {
        rejectedCandidates++;
        log("discovery.article_extract_failed", { url, kind, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  const last = attempts.at(-1) || {
    related: { kind: "related", status: "skipped", model: "gpt-6-luna", candidates: 0 },
    open: { kind: "open", status: "skipped", model: "gpt-6-luna", candidates: 0 },
  };
  const words = readingWords(selected);
  const supply = {
    version: 1, target_minutes: SUPPLY_POLICY.targetMinutes, words_per_minute: SUPPLY_POLICY.wordsPerMinute,
    estimated_reading_minutes: Math.ceil(words / SUPPLY_POLICY.wordsPerMinute), word_count: words,
    fresh_articles: freshArticles, saved_articles: pendingItems.length,
    catchup_articles: reports.reduce((n, r) => n + r.catchup_included, 0), discovery_articles: included.related + included.open,
    supplements: supplementCount, supplement_attempts: supplementAttempts, discovery_passes: attempts.length,
    short_issue: words < SUPPLY_POLICY.targetMinutes * SUPPLY_POLICY.wordsPerMinute,
    failed_sources: reports.filter(r => r.status === "failed").length,
    unchecked_sources: reports.filter(r => r.status === "not_checked").length,
    deferred_entries: reports.reduce((n, r) => n + r.resource_deferred + r.scan_limited, 0),
    feed_reports: reports,
  };
  const intro = await introduce([...groups, ...(pendingItems.length ? [{ section: { id: null, name: "Saved articles" }, items: pendingItems }] : [])], input.editorialBrief, { deadline: input.deadline, additionalInstructions: input.additionalInstructions });
  const report = organized.report;
  return { groups, pendingItems, issues, feedCount: input.feeds.length, introduction: intro.paragraph, editorial: {
    status: report.status,
    organization: { status: report.status, model: report.model, sections: report.sections, topics: report.topics, other: report.other, error: report.error || null, usage: report.usage || null },
    discovery: { related: { ...last.related, included: included.related }, open: { ...last.open, included: included.open }, attempts },
    introduction: intro.report, supply,
  } };
}
