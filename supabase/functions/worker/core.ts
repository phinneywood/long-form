import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { Buffer } from "node:buffer";
import { extractArticle, extractionBudget, hydrateArticleImages, omitArticleImages, type ExtractionBudget } from "../_shared/article.ts";
import { dispatchPrepared, DeliveryNeedsReview, checkAttachmentBudget } from "../_shared/delivery.ts";
import { makeEpub, validateEpub, type EpubArticle } from "../_shared/epub.ts";
import { prepareIssueSupply, type DeliveryRecord } from "../_shared/issue-supply.ts";
import { publicationItems, featuredPath } from "../_shared/publication.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

class FrozenManifestReady extends Error {
  constructor(readonly stage = "frozen-manifest") {
    super("Frozen manifest ready for deterministic continuation.");
    this.name = "FrozenManifestReady";
  }
}

function logEvent(event: string, fields: Record<string, unknown> = {}, level: "info" | "warn" | "error" = "info") {
  const line = JSON.stringify({ ts: new Date().toISOString(), service: "worker", event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "reading";
}

function localDateKey(timezone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function testArtifactIdentity(job: any, now: Date, timezone: string, displayDate: string, filenameDate: string) {
  if (job.reason !== "test") return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "00";
  const clock = `${get("hour")}:${get("minute")}:${get("second")}`;
  const clockSlug = `${get("hour")}${get("minute")}${get("second")}`;
  const code = String(job.id || "test").replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase() || "TEST";
  const reviewLabel = `TEST ${clock} · ${code}`;
  return {
    reviewLabel,
    libraryTitle: `Long Form · ${reviewLabel}`,
    coverLabel: reviewLabel,
    subject: `Long Form · ${reviewLabel} · ${displayDate}`,
    filename: `long-form-test-${filenameDate}-${clockSlug}-${code.toLowerCase()}.epub`,
  };
}

function base64(bytes: Uint8Array) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

function summarizeMedia(items: EpubArticle[]) {
  const summary = { discovered: 0, embedded: 0, failed: 0, omitted: 0, failures: [] as Array<{ title: string; url: string; reason: string }> };
  for (const item of items) {
    const media = item.media;
    if (!media) continue;
    summary.discovered += Number(media.discovered || 0);
    summary.embedded += Number(media.embedded || 0);
    summary.failed += Number(media.failed || 0);
    summary.omitted += Number(media.omitted || 0);
    for (const failure of media.failures || []) {
      summary.failures.push({ title: item.title, url: failure.url, reason: failure.reason });
    }
  }
  summary.failures = summary.failures.slice(0, 30);
  return summary;
}

async function sendResend(email: any, jobId: string) {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is missing.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `morning-reader-${jobId}` },
    body: JSON.stringify(email),
  });
  const responseBody = await response.text();
  if (!response.ok) throw new Error(`Email provider error (${response.status}): ${responseBody.slice(0, 400)}`);
  return JSON.parse(responseBody);
}

async function queueScheduled() {
  const { error } = await admin.rpc("queue_due_daily_issues");
  if (error) throw error;
  const web = await admin.rpc("queue_due_web_publications");
  if (web.error) throw web.error;
}

async function digestForGroup(job: any, group: { section: any; items: EpubArticle[] }, providerEmailId: string) {
  const row = {
    user_id: job.user_id,
    section_id: group.section.id || null,
    edition_name: group.section.name,
    job_id: job.id,
    scheduled_for: job.reason === "scheduled" ? job.scheduled_for || job.run_after : null,
    status: "sent",
    article_count: group.items.length,
    provider_email_id: providerEmailId,
    sent_at: new Date().toISOString(),
  };
  let digest: any = null;
  if (row.section_id) {
    const result = await admin.from("digests").upsert(row…3360 tokens truncated…h) {
    const packagingStarted = performance.now();
    logEvent("digest.stage_started", { job_id: job.id, stage: "epub_packaging", articles: issueItems.length });
    const bytes = await makeEpub({
      name: job.result?.publication_kind === "tonight" ? "Tonight’s Reading" : "Long Form", displayDate, date: now, timezone,
      label: testIdentity?.coverLabel || (job.result?.publication_kind === "tonight" ? "Tonight’s Reading" : "Daily issue"),
      libraryTitle: testIdentity?.libraryTitle,
      introduction: issueIntroduction,
    }, issueItems);
    const qa = await validateEpub(bytes, issueItems, issueIntroduction);
    const media = summarizeMedia(issueItems);
    logEvent("digest.stage_completed", {
      job_id: job.id,
      stage: "epub_packaging",
      duration_ms: Math.round(performance.now() - packagingStarted),
      bytes: bytes.byteLength,
      articles: issueItems.length,
    });
    logEvent("epub.qa_completed", {
      job_id: job.id,
      ...qa,
      media_discovered: media.discovered,
      media_embedded: media.embedded,
      media_failed: media.failed,
      media_omitted: media.omitted,
    });
    attachments.push({
      filename: testIdentity?.filename || `long-form-${filenameDate}.epub`,
      content: base64(bytes),
      content_type: "application/epub+zip",
    });
    checkAttachmentBudget(attachments);
    if (testIdentity) {
      logEvent("test.artifact_prepared", {
        job_id: job.id,
        review_label: testIdentity.reviewLabel,
        filename: testIdentity.filename,
      });
    }
    return {
      attachments, groups, issues, feedCount,
      subject: testIdentity?.subject || `Long Form — ${displayDate}`,
      editorial: editorialSummary, qa, media, pendingItems: hydratedPending,
    };
  }

  return {
    attachments, groups, issues, feedCount,
    subject: testIdentity?.subject || `Long Form — ${displayDate}`,
    editorial: editorialSummary, qa: null, media: summarizeMedia(issueItems), pendingItems: hydratedPending,
  };
}

async function prepareDeliveryPayload(job: any, deadline: number, previewOnly = false) {
  const settingsResult = await admin.from("user_settings").select("*").eq("user_id", job.user_id).single();
  if (settingsResult.error) throw settingsResult.error;
  const settings = settingsResult.data;
  if (job.reason === "scheduled" && (settings.paused || !settings.onboarding_complete || !settings.kindle_email)) {
    return { email: { from: "Long Form <reader@antonioskilton.com>", to: [], subject: "", text: "", attachments: [] },
      groups: [], feedCount: 0, issues: [], skipReason: "Skipped because daily delivery settings changed." };
  }
  if (!previewOnly && !settings?.kindle_email) throw new Error("No Send-to-Kindle email is configured.");
  const now = new Date(job.created_at);
  const timezone = settings.timezone || "UTC";
  const displayDate = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: timezone }).format(now);
  const filenameDate = localDateKey(timezone, now);
  const prepared = job.reason === "one_time"
    ? await buildOneTime(job, settings, now, displayDate, filenameDate, deadline)
    : await buildRecurring(job, settings, now, displayDate, filenameDate, deadline);
  if (!prepared.attachments.length && prepared.issues.length) throw new Error("No edition could be prepared. " + prepared.issues.join(" ").slice(0, 600));
  checkAttachmentBudget(prepared.attachments);
  return {
    email: { from: "Long Form <reader@antonioskilton.com>", to: previewOnly ? [] : [settings.kindle_email], subject: prepared.subject, text: "Your Long Form edition is attached.", attachments: prepared.attachments },
    groups: prepared.groups.map(group => ({ section: group.section, items: group.items.map(({ body: _body, assets: _assets, ...article }) => article) })),
    feedCount: prepared.feedCount,
    issues: prepared.issues,
    editorial: (prepared as any).editorial || null,
    qa: (prepared as any).qa || null,
    media: (prepared as any).media || null,
    pendingItems: ((prepared as any).pendingItems || []).map(({ body, assets, ...item }: any) => item),
  };
}

async function freezePayload(job:any,payload:any){
  const r=await admin.rpc("freeze_delivery_payload",{p_job_id:job.id,p_user_id:job.user_id,p_payload:payload});
  if(r.error)throw r.error;
  return {...r.data,payload};
}
export async function processJob(queuedJob: any, deadline = Date.now() + 90_000) {
  const started = performance.now();
  const claim = await admin.from("digest_jobs").update({ status: "running", started_at: new Date().toISOString(), attempts: queuedJob.attempts + 1, error: null }).eq("id", queuedJob.id).eq("status", "queued").select("*").maybeSingle();
  if (!claim.data) return null;
  const job = claim.data;
  try {
    logEvent("digest.started", { job_id: job.id, user_id: job.user_id, reason: job.reason, attempt: job.attempts });
    if (["first_run_preview", "publication_preview"].includes(job.reason)) {
      const existing = await admin.from("delivery_outbox").select("*").eq("job_id", job.id).maybeSingle();
      if (existing.error) throw existing.error;
      let payload = existing.data?.payload;
      if (!payload) {
        payload = await prepareDeliveryPayload(job, deadline, true);
        if (!payload.email.attachments.length) {
          const empty = await admin.from("digest_jobs").update({ status: "empty", finished_at: new Date().toISOString() }).eq("id", job.id);
          if (empty.error) throw empty.error;
          return { job: job.id, status: "empty" };
        }
        await freezePayload(job,payload);
      }
      const {preparation_manifest:_frozen,...publicationMetadata}=job.result||{};
      const resultBase=job.reason==="publication_preview"?publicationMetadata:(job.result||{});
      const ready = await admin.from("digest_jobs").update({ status: "ready", attempts: 0, finished_at: new Date().toISOString(), error: null,
        result: { ...resultBase, articles: payload.groups.reduce((n:number,g:any)=>n+g.items.length,0), issues: payload.issues, preview_review: { groups: payload.groups.map((group: any) => ({ section: group.section, items: group.items.map(({ assets, body, ...item }: any) => item) })), issues: payload.issues } },
      }).eq("id", job.id);
      if (ready.error) throw ready.error;
      logEvent("first_issue.ready", { job_id: job.id, user_id: job.user_id, sections: payload.groups.length, duration_ms: Math.round(performance.now() - started) });
      return { job: job.id, status: "ready" };
    }
    const { build, providerId } = await dispatchPrepared({
      load: async () => { const r = await admin.from("delivery_outbox").select("*").eq("job_id", job.id).maybeSingle(); if (r.error) throw r.error; return r.data; },
      prepare: () => job.result?.resend_of_job_id || job.result?.publication_id
        ? Promise.reject(new DeliveryNeedsReview("The frozen resend payload is missing; nothing was sent."))
        : prepareDeliveryPayload(job, deadline),
      freeze: payload => freezePayload(job,payload),
      markAttempt: async at => { const r = await admin.from("delivery_outbox").update({ first_send_at: at }).eq("job_id", job.id); if (r.error) throw r.error; },
      send: email => sendResend(email, job.id),
      record: async id => { const r = await admin.from("delivery_outbox").update({ provider_email_id: id }).eq("job_id", job.id); if (r.error) throw r.error; },
    });
    if (!providerId) {
      const r = await admin.from("digest_jobs").update({ status: "empty", finished_at: new Date().toISOString(), result: { articles: 0, sections: 0, feeds: build.feedCount, note: build.skipReason || null, editorial: (build as any).editorial || null } }).eq("id", job.id);
      if (r.error) throw r.error;
      return { job: job.id, status: "empty" };
    }
    const persistentGroups = build.groups.filter((group: any) => Boolean(group.section?.id));
    const unsectionedItems = build.groups.filter((group: any) => !group.section?.id).flatMap((group: any) => group.items);
    if (unsectionedItems.length) persistentGroups.push({ section: { id: null, name: build.email.subject || "Long Form" }, items: unsectionedItems });
    for (const group of persistentGroups) await digestForGroup(job, group, providerId);

    const total = build.groups.reduce((count: number, group: any) => count + group.items.length, 0);
    const pendingIds: string[] = build.groups.flatMap((group: any) => group.items.flatMap((item: any) => [item.pending_id, ...(item.pending_ids || [])]).filter(Boolean));
    const frozenPending = (build as any).pendingItems || [];
    pendingIds.push(...frozenPending.flatMap((item: any) => [item.pending_id, ...(item.pending_ids || [])]).filter(Boolean));
    if (job.reason !== "test" && !job.result?.resend_of_job_id && pendingIds.length) {
      const deletion = await admin.from("pending_issue_articles").delete().eq("user_id", job.user_id).in("id", [...new Set(pendingIds)]);
      if (deletion.error) throw deletion.error;
    }
    const warningMessages = [...new Set<string>(build.groups.flatMap(group => group.items.flatMap((article: any) => article.warnings || [])))];
    const status = build.issues.length || warningMessages.length ? "partial" : "sent";
    const resendMeta = job.result?.resend_of_job_id ? {
      resend_of_job_id: job.result.resend_of_job_id,
      resend_of_created_at: job.result.resend_of_created_at || null,
      resend_of_title: job.result.resend_of_title || null,
    } : {};
    const finished = await admin.from("digest_jobs").update({ status, finished_at: new Date().toISOString(), result: { ...resendMeta, publication_id: job.result?.publication_id || null, articles: total, sections: build.groups.length, feeds: build.feedCount, provider_email_id: providerId, packet_name: job.packet_name || null, edition_title: build.email.subject || null, warnings: warningMessages.length, issues: [...build.issues, ...warningMessages].slice(0, 30), editorial: (build as any).editorial || null, qa: (build as any).qa || null, media: (build as any).media || null } }).eq("id", job.id);
    if (finished.error) throw finished.error;
    logEvent("digest.submitted", { job_id: job.id, user_id: job.user_id, status, articles: total, duration_ms: Math.round(performance.now() - started) });
    return { job: job.id, status, articles: total, sections: build.groups.length };
  } catch (error) {
    if (error instanceof FrozenManifestReady) {
      const requeue = await admin.from("digest_jobs").update({
        status: "queued",
        attempts: Math.max(0, job.attempts - 1),
        run_after: new Date().toISOString(),
        error: null,
      }).eq("id", job.id);
      if (requeue.error) throw requeue.error;
      const { data: kick, error: kickError } = await admin.rpc("kick_digest_worker");
      logEvent("digest.continuation_queued", {
        job_id: job.id,
        user_id: job.user_id,
        reason: job.reason,
        attempt: job.attempts,
        worker_triggered: !kickError && Boolean(kick),
        duration_ms: Math.round(performance.now() - started),
      }, kickError ? "warn" : "info");
      return { job: job.id, status: "queued", continuation: error.stage };
    }
    const message = (error instanceof Error ? error.message : String((error as any)?.message || error)).slice(0, 800);
    const attempts = job.attempts;
    const nextStatus = attempts < 3 && !(error instanceof DeliveryNeedsReview) ? "queued" : "failed";
    const patch: any = { status: nextStatus, error: message };
    if (nextStatus === "queued") patch.run_after = new Date(Date.now() + attempts * 10 * 60_000).toISOString();
    else patch.finished_at = new Date().toISOString();
    await admin.from("digest_jobs").update(patch).eq("id", job.id);
    logEvent(nextStatus === "failed" ? "digest.failed" : "digest.retry_scheduled", { job_id: job.id, user_id: job.user_id, reason: job.reason, error: message, attempt: attempts, duration_ms: Math.round(performance.now() - started) }, nextStatus === "failed" ? "error" : "warn");
    return { job: job.id, status: nextStatus, error: message };
  }
}

export async function handleWorkerRequest(request: Request) {
  const invocationId = crypto.randomUUID();
  const started = performance.now();
  if (request.method !== "POST" && request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  try {
    logEvent("worker.invoked", { invocation_id: invocationId, method: request.method });
    const workerSecret = request.headers.get("x-worker-secret") || "";
    if (!workerSecret) return json({ error: "Unauthorized" }, 401);
    const { data: authorized, error: authError } = await admin.rpc("verify_worker_secret", { p_secret: workerSecret });
    if (authError || !authorized) return json({ error: "Unauthorized" }, 401);
    const force = request.headers.get("x-worker-force") === "1";
    const { data: claimed, error: claimError } = await admin.rpc("claim_worker_run", { p_name: "digest-worker", p_min_interval_seconds: force ? 0 : 240 });
    if (claimError) throw claimError;
    if (!claimed) {
      logEvent("worker.skipped", { invocation_id: invocationId, reason: "recently-run", duration_ms: Math.round(performance.now() - started) });
      return json({ ok: true, skipped: "recently-run" });
    }
    // The invocation deadline is 90 seconds and the platform wall limit is
    // below five minutes. Recover interrupted work on the next normal cadence.
    const staleBefore=new Date(Date.now()-5*60_000).toISOString();
    await admin.from("digest_jobs").update({ status: "queued", run_after: new Date().toISOString(), error: "Recovered after stale worker claim." }).eq("status", "running").lt("started_at", staleBefore).lt("attempts", 3);
    await admin.from("digest_jobs").update({ status: "failed", finished_at: new Date().toISOString(), error: "Final worker attempt was interrupted. Check your Kindle and delivery history before sending again." }).eq("status", "running").lt("started_at", staleBefore).gte("attempts", 3);
    await queueScheduled();
    const { data: jobs, error } = await admin.from("digest_jobs").select("*").eq("status", "queued").lte("run_after", new Date().toISOString()).order("created_at").limit(3);
    if (error) throw error;
    const results = [];
    const deadline = Date.now() + 90_000;
    for (const job of jobs || []) {
      if (Date.now() > deadline - 20_000) break;
      results.push(await processJob(job, deadline));
    }
    logEvent("worker.completed", { invocation_id: invocationId, jobs: (jobs || []).length, duration_ms: Math.round(performance.now() - started) });
    return json({ ok: true, processed: results });
  } catch (error) {
    const message = (error instanceof Error ? error.message : String((error as any)?.message || error)).slice(0, 800);
    logEvent("worker.failed", { invocation_id: invocationId, error: message, duration_ms: Math.round(performance.now() - started) }, "error");
    return json({ ok: false, error: message }, 500);
  }
}
