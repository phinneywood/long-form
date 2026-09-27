"""Apply narrowly scoped source edits on top of current publication/onboarding work."""
from pathlib import Path

def replace(s, old, new, count=1):
    assert s.count(old) == count, f'Expected {count} anchors: {old[:120]}'
    return s.replace(old,new)

p=Path('supabase/functions/_shared/discovery.ts'); s=p.read_text()
s=replace(s,'  candidates: number;\n','  candidates: number;\n  rejected_candidates?: number;\n')
s=replace(s,'function candidateSchema() {','function candidateSchema(limit = 2) {')
s=replace(s,'        maxItems: 2,','        maxItems: limit,')
s=replace(s,'    additionalInstructions?: string;\n','    additionalInstructions?: string;\n    excludedUrls?: string[];\n    relatedLimit?: number;\n    openLimit?: number;\n    maxCandidates?: number;\n',2)
s=replace(s,'  if (!articles.length || (kind === "open" && !brief)) {','  const limit = Math.max(0, Math.min(4, Math.floor(options.maxCandidates ?? 2)));\n  if (!limit || (kind === "related" && !articles.length) || (kind === "open" && !brief)) {')
s=replace(s,'  const sectionNames = [...new Set(core.map((item) => item.section))];','  const excluded = (options.excludedUrls || []).map(normalizedUrl).filter(Boolean) as string[];\n  for (const url of excluded) existing.add(url);\n  const sectionNames = [...new Set(core.map((item) => item.section))];')
s=replace(s,'    "Use web search to find zero to two excellent, publicly readable original articles OUTSIDE the reader\'s subscribed RSS corpus.",','    `Use web search to find zero to ${limit} excellent, publicly readable original articles OUTSIDE the reader\'s subscribed RSS corpus.`,\n    "Never return an excluded URL or lower the quality bar to fill the available slots. Favor substantial originals over short tool announcements, homepages, and promotional pages.",',2)
s=replace(s,'              core_sections: sectionNames,','              excluded_urls: excluded.slice(0, 200),\n              core_sections: sectionNames,')
s=replace(s,'            schema: candidateSchema(),','            schema: candidateSchema(limit),')
s=replace(s,'    for (const rawCandidate of parsed.articles.slice(0, 2)) {','    for (const rawCandidate of parsed.articles.slice(0, limit)) {')
s=replace(s,'        candidates: candidates.length,\n','        candidates: candidates.length,\n        rejected_candidates: Math.max(0, Math.min(parsed.articles.length, limit) - candidates.length),\n')
s=replace(s,'discoverLane("related", articles, editorialBrief, { ...options, deadline })','discoverLane("related", articles, editorialBrief, { ...options, deadline, maxCandidates: options.relatedLimit ?? 2 })')
s=replace(s,'discoverLane("open", articles, editorialBrief, { ...options, deadline })','discoverLane("open", articles, editorialBrief, { ...options, deadline, maxCandidates: options.openLimit ?? 2 })')
p.write_text(s)

p=Path('supabase/functions/worker/core.ts'); s=p.read_text()
s=replace(s,'import { XMLParser } from "npm:fast-xml-parser@5.11.1";\n','')
s=replace(s,'type ExtractionBudget, fetchPublicText, sha256, textValue','type ExtractionBudget')
s=replace(s,'import { editorializeIssue } from "../_shared/editorial.ts";\nimport { discoverBeyondRss, type DiscoveryCandidate } from "../_shared/discovery.ts";\nimport { writeIssueIntroduction } from "../_shared/introduction.ts";','import { prepareIssueSupply, type DeliveryRecord } from "../_shared/issue-supply.ts";')
s=replace(s,'const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", cdataPropName: "__cdata" });\n','')
start=s.index('function array<T = any>'); end=s.index('function slug(',start)
s=s[:start]+s[end:]
start=s.index('    const feeds = feedResult.data || [];',s.index('async function buildRecurring'))
end=s.index('    const manifest = {',start)
s=s[:start]+'''    const history: DeliveryRecord[] = [];
    if (job.reason !== "test") {
      // Read every page, not just the API's default row limit. Normalize historical
      // URLs in the supply planner so tracking variants cannot evade dedupe.
      for (let offset = 0; ; offset += 1000) {
        if (Date.now() >= deadline) throw new Error("Delivery history could not be checked within the preparation deadline.");
        const previous = await admin.from("article_deliveries")
          .select("article_hash,canonical_url,delivery_kind")
          .eq("user_id", job.user_id).order("delivered_at", { ascending: false })
          .range(offset, offset + 999);
        if (previous.error) throw previous.error;
        history.push(...(previous.data || []));
        if ((previous.data || []).length < 1000) break;
        if (history.length >= 50_000) throw new Error("Delivery history exceeds the safe preparation limit; review history indexing.");
      }
    }
    const prepared = await prepareIssueSupply({
      feeds: feedResult.data || [], pending: pendingResult.data || [], history,
      now, lookbackHours: job.lookback_hours, deadline,
      editorialBrief: String(settings.editorial_brief || ""),
      additionalInstructions: String(settings.editorial_instructions || ""),
    }, {
      updateFeed: async (feed, patch) => {
        const result = await admin.from("feeds").update(patch).eq("id", feed.id).eq("user_id", job.user_id);
        if (result.error) throw result.error;
      },
      log: (event, fields) => logEvent(event, { job_id: job.id, user_id: job.user_id, ...fields }),
    });
    selectedGroups = prepared.groups;
    pendingItems = prepared.pendingItems;
    issues = prepared.issues;
    feedCount = prepared.feedCount;
    editorialSummary = prepared.editorial;
    issueIntroduction = prepared.introduction;

'''+s[end:]
s=replace(s,'group.items.map((item: any) => item.pending_id).filter(Boolean)','group.items.flatMap((item: any) => [item.pending_id, ...(item.pending_ids || [])]).filter(Boolean)')
s=replace(s,'frozenPending.map((item: any) => item.pending_id).filter(Boolean)','frozenPending.flatMap((item: any) => [item.pending_id, ...(item.pending_ids || [])]).filter(Boolean)')
s=replace(s,'    if (pendingIds.length) {','    if (job.reason !== "test" && pendingIds.length) {')
s=replace(s,'packet_name: job.packet_name || null, warnings:', 'packet_name: job.packet_name || null, edition_title: build.email.subject || null, warnings:')
p.write_text(s)

p=Path('supabase/functions/_shared/epub.ts'); s=p.read_text()
s=replace(s,'  pending_id?: string | null;','  pending_id?: string | null;\n  pending_ids?: string[];\n  supplement_kind?: "catchup";')
p.write_text(s)

p=Path('index.html'); s=p.read_text()
helper='''function issueSupplyText(job){
  const supply=job?.result?.editorial?.supply;if(!supply)return '';
  const parts=[`About ${supply.estimated_reading_minutes} minutes of reading`,`${supply.fresh_articles} new from checked sources`];
  if(supply.catchup_articles)parts.push(`${supply.catchup_articles} earlier unread`);
  if(supply.discovery_articles)parts.push(`${supply.discovery_articles} discoveries`);
  const unavailable=(supply.failed_sources||0)+(supply.unchecked_sources||0);
  if(unavailable)parts.push(`${unavailable} source${unavailable===1?'':'s'} unavailable`);
  return parts.join(' · ');
}
function issueSupplyDetails(job){
  const supply=job?.result?.editorial?.supply;if(!supply)return '';
  const summary=issueSupplyText(job);
  const note=supply.short_issue?'This was a lighter issue. The 30-minute target guides additions; it never forces filler.':'The reading target never removes or shortens subscribed articles.';
  const rows=(supply.feed_reports||[]).map(r=>{
    if(r.status==='failed'||r.status==='not_checked')return `<p class="small"><strong>${esc(displayText(r.name))}</strong>: ${esc(r.error||'Not checked before the preparation limit.')}</p>`;
    const counts=[`${r.entries_seen} entries found`,`${r.fresh_included+r.catchup_included} included`];
    if(r.invalid)counts.push(`${r.invalid} invalid entries`);
    if(r.already_delivered)counts.push(`${r.already_delivered} already delivered`);
    if(r.outside_window)counts.push(`${r.outside_window} outside the date window`);
    if(r.duplicates)counts.push(`${r.duplicates} duplicates`);
    if(r.extraction_failed)counts.push(`${r.extraction_failed} unreadable`);
    if(r.out_of_scope)counts.push(`${r.out_of_scope} outside the source filter`);
    if(r.not_needed)counts.push(`${r.not_needed} not used for catch-up`);
    if(r.resource_deferred+r.scan_limited)counts.push(`${r.resource_deferred+r.scan_limited} deferred by limits`);
    if(r.retries)counts.push('recovered after retry');
    return `<p class="small"><strong>${esc(displayText(r.name))}</strong>: ${esc(counts.join(' · '))}</p>`;
  }).join('');
  return `<details class="mt-2"><summary>Why this issue was this size</summary><p class="small muted">${esc(summary)}. ${esc(note)}</p>${rows}</details>`;
}

'''
s=replace(s,'function latestRunText(job){',helper+'function latestRunText(job){')
s=replace(s,'<div class="issue-status" role="status">${esc(latestRunText(latestJob))}</div>','<div class="issue-status" role="status">${esc(latestRunText(latestJob))}</div>\n        ${issueSupplyText(latestJob)?`<p class="small muted">${esc(issueSupplyText(latestJob))}</p>`:\'\'}')
s=replace(s,"${(job.result?.issues||[]).map(issue=>", "${issueSupplyDetails(job)}${(job.result?.issues||[]).map(issue=>")
s=replace(s, 'esc(job.packet_name||job.edition_name||', 'esc(job.result?.edition_title||job.packet_name||job.edition_name||')
p.write_text(s)
