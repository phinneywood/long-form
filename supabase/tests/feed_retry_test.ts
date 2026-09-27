import { PublicHttpError, retryAfterMillis, retryFeedRead } from "../functions/_shared/network-retry.ts";
function assert(value: unknown, message = "Assertion failed"): asserts value { if (!value) throw new Error(message); }
Deno.test("transient feed errors get exactly one bounded retry", async () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    let calls = 0, waits = 0;
    const result = await retryFeedRead(async () => { if (++calls === 1) throw new PublicHttpError(status); return "scoped feed"; }, { deadline: 10000, now: () => 0, sleep: async () => { waits++; } });
    assert(result === "scoped feed" && calls === 2 && waits === 1);
  }
});
Deno.test("permanent failures and security errors never retry", async () => {
  for (const error of [new PublicHttpError(404), new PublicHttpError(403), new Error("Private network URLs are not allowed.")]) {
    let calls = 0;
    try { await retryFeedRead(async () => { calls++; throw error; }, { deadline: Infinity }); } catch (caught) { assert(caught === error); }
    assert(calls === 1);
  }
});
Deno.test("retry respects publisher delay, global deadline, and exhaustion", async () => {
  for (const [deadline, delay] of [[1000, 0], [10000, 30000]]) {
    let calls = 0;
    try { await retryFeedRead(async () => { calls++; throw new PublicHttpError(429, delay); }, { deadline, now: () => 0 }); } catch { /* expected */ }
    assert(calls === 1);
  }
  let calls = 0;
  try { await retryFeedRead(async () => { calls++; throw new PublicHttpError(502); }, { deadline: 10000, now: () => 0, sleep: async () => {} }); } catch { /* expected */ }
  assert(calls === 2);
  assert(retryAfterMillis("2", 0) === 2000);
  assert(retryAfterMillis("bad", 0) === 0);
});
