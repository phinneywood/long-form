// Exercise real extraction, checkpointing, EPUB QA and delivery orchestration.
// HTTP is replaced in-process; these checks send no mail and use no real keys.
import JSZip from "npm:jszip@3.10.1";
Deno.env.set("SUPABASE_URL", "https://database.example.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-only-key");
Deno.env.set("RESEND_API_KEY", "test-only-key");
const { processJob, handleWorkerRequest } = await import("../functions/worker/core.ts");
function assert(value: unknown, message = "Assertion failed"): asserts value { if (!value) throw new Error(message); }

async function packetScenario(mode: "normal" | "checkpoint_failure" | "final_failure" | "mismatch" | "request") {
  const original = globalThis.fetch;
  const job: any = { id: "packet-job", user_id: "reader-1", reason: "one_time", status: "queued", attempts: 0,
    created_at: "2026-10-03T20:00:00Z", packet_name: "Original sources", result: {},
    article_urls: Array.from({ length: 5 }, (_, i) => `https://8.8.8.8/article-${i + 1}`) };
  if (mode === "mismatch") job.result.preparation_manifest = { kind: "one_time_packet", version: 1, name: "Other packet", urls: job.article_urls, items: [], imageBytesRemaining: 6_000_000 };
  let outbox: any = null, sends = 0, kicks = 0, failCheckpoint = mode === "checkpoint_failure", failFinal = mode === "final_failure";
  const fetches: string[] = [], checkpoints: any[] = [], claims: string[] = [], keys: string[] = [];
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const webp = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init), url = new URL(req.url);
    if (url.hostname === "api.resend.com") { sends++; keys.push(req.headers.get("idempotency-key")!); return Response.json({ id: "provider-packet" }); }
    if (url.hostname === "8.8.8.8") {
      fetches.push(url.pathname);
      if (url.pathname === "/diagram.png") return new Response(png);
      if (url.pathname === "/diagram.webp") return new Response(webp);
      const i = Number(url.pathname.match(/article-(\d+)/)?.[1]);
      assert(i > 0 && i <= 5);
      return new Response(`<html><head><title>Source ${i}</title></head><body><article><h1>Source ${i}</h1><p>${`Complete original ${i}. `.repeat(35)}</p><h2>Example</h2><pre><code>if x &lt; ${i}:\n    run(${i})</code></pre>${i === 1 ? '<img src="/diagram.png" alt="Diagram">' : i === 2 ? '<img src="/diagram.webp" alt="Other diagram">' : ''}</article></body></html>`);
    }
    assert(url.hostname === "database.example.invalid", `Unexpected network ${url}`);
    if (url.pathname.endsWith("/rpc/kick_digest_worker")) { kicks++; return Response.json(1); }
    if (url.pathname.endsWith("/rpc/checkpoint_digest_preparation")) {
      const body = await req.json(); assert(body.p_job_id === job.id && body.p_user_id === job.user_id);
      if (failCheckpoint && body.p_manifest.items.length === 3) { failCheckpoint = false; return Response.json({ message: "Interrupted checkpoint write" }, { status: 500 }); }
      job.result.preparation_manifest = structuredClone(body.p_manifest); checkpoints.push(body.p_manifest); return Response.json(true);
    }
    if (url.pathname.endsWith("/rpc/freeze_delivery_payload")) {
      const body = await req.json(); assert(body.p_job_id === job.id && body.p_user_id === job.user_id);
      assert(checkpoints.length === 5, "Every original must be checkpointed before the outbox exists");
      outbox = { payload: body.p_payload, first_send_at: null, provider_email_id: null }; return Response.json(outbox);
    }
    if (url.pathname.includes("/rpc/")) return Response.json(true);
    const table = url.pathname.split("/").at(-1), body = req.method === "GET" ? null : await req.json();
    let rows: any[] = [];
    if (table === "digest_jobs") {
      if (req.method === "PATCH" && body.status === "running") {
        claims.push(url.searchParams.get("id") || "");
        assert(job.status === "queued");
      }
      if (failFinal && body?.status === "partial") { failFinal = false; return Response.json({ message: "Interrupted final status write" }, { status: 500 }); }
      if (mode === "request" && req.method === "PATCH" && !url.searchParams.has("id")) return Response.json([]);
      if (body) Object.assign(job, body);
      rows = mode === "request" && req.method === "GET" ? [structuredClone(job), { ...job, id: "other-packet" }] : [structuredClone(job)];
    } else if (table === "delivery_outbox") { if (body) Object.assign(outbox, body); rows = outbox ? [outbox] : []; }
    else if (table === "user_settings") rows = [{ kindle_email: "reader@kindle.com", timezone: "UTC" }];
    else if (table === "digests") rows = req.method === "GET" ? [] : [{ id: "digest-packet" }];
    else if (table !== "article_deliveries") throw new Error(`Unexpected table ${table}`);
    return Response.json(req.headers.get("accept")?.includes("vnd.pgrst.object") ? rows[0] : rows);
  }) as typeof fetch;
  try {
    if (mode === "request") {
      const response = await handleWorkerRequest(new Request("https://worker.example.invalid", { method: "POST", headers: { "x-worker-secret": "test-only-secret" } }));
      assert(response.status === 200); assert(claims.length === 1 && claims[0] === `eq.${job.id}`, "Continuation must end this invocation before claiming another packet");
    } else {
      for (let stage = 0; stage < 9 && job.status === "queued"; stage++) {
        const result = await processJob(structuredClone(job));
        if (result?.continuation) {
          assert(result.continuation === "packet-article" && job.attempts === (mode === "checkpoint_failure" && !failCheckpoint ? 1 : 0));
          assert(sends === 0 && !outbox, "Preparation continuations must not send or freeze a partial packet");
        }
      }
    }
    return { job, outbox, sends, kicks, fetches, checkpoints, keys };
  } finally { globalThis.fetch = original; }
}

Deno.test("original packets checkpoint one article per invocation and preserve ordered text, code and image bytes", async () => {
  const r = await packetScenario("normal");
  assert(r.job.status === "partial" && r.sends === 1 && r.kicks === 5);
  assert(r.checkpoints.map(m => m.items.length).join() === "1,2,3,4,5");
  assert(r.fetches.filter(p => /article-/.test(p)).join() === "/article-1,/article-2,/article-3,/article-4,/article-5");
  assert(r.job.result.articles === 5 && r.job.result.media.failed === 1 && r.job.result.media.embedded === 1);
  assert(r.job.result.issues.some((s: string) => /WebP conversion/.test(s)), "Unsupported conversion must be explicit, with original text preserved");
  const zip = await JSZip.loadAsync(Uint8Array.from(atob(r.outbox.payload.email.attachments[0].content), c => c.charCodeAt(0)));
  for (let i = 1; i <= 5; i++) {
    const page = await zip.file(`OEBPS/article-${i}.xhtml`)!.async("string");
    assert(page.includes(`Complete original ${i}.`) && page.includes(`run(${i})`) && page.includes("<pre>"), `Source ${i} text/code missing`);
  }
  const image = Object.keys(zip.files).find(p => p.startsWith("OEBPS/images/" ) && p.endsWith(".png"));
  assert(image && (await zip.file(image)!.async("uint8array"))[0] === 137, "Binary asset must survive the saved checkpoint");
  assert(r.keys[0] === "morning-reader-packet-job");
});

Deno.test("checkpoint failure retries the unfinished article without refetching completed originals", async () => {
  const r = await packetScenario("checkpoint_failure");
  assert(r.job.status === "partial" && r.sends === 1);
  assert(r.fetches.filter(p => p === "/article-1" || p === "/article-2").length === 2);
  assert(r.fetches.filter(p => p === "/article-3").length === 2);
});

Deno.test("final status failure reconciles the same frozen packet and provider receipt without a second submission", async () => {
  const r = await packetScenario("final_failure");
  assert(r.job.status === "partial" && r.sends === 1 && r.checkpoints.length === 5);
});

Deno.test("changed packet identity fails safely instead of using another request's checkpoint", async () => {
  const r = await packetScenario("mismatch");
  assert(r.job.status === "failed" && r.sends === 0 && r.fetches.length === 0);
});

Deno.test("worker continuation stops before the next queued job can share its CPU budget", async () => {
  const r = await packetScenario("request");
  assert(r.job.status === "queued" && r.checkpoints.length === 1 && r.sends === 0);
});
