Deno.env.set("SUPABASE_URL", "https://kindle-db.example.invalid");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-only-key");
const { kindleRoute } = await import("../functions/app-api/kindle.ts");
const uid = "10000000-0000-0000-0000-000000000001";
function assert(value: unknown, message = "Assertion failed"): asserts value { if (!value) throw Error(message); }

Deno.test("minimal Kindle setup uses the authenticated tenant and never creates feeds or sends", async () => {
  const original = globalThis.fetch;
  const settings = { kindle_email: null as string | null, paused: false, onboarding_complete: false };
  const writes: any[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init), url = new URL(req.url);
    assert(url.hostname === "kindle-db.example.invalid" && url.pathname.endsWith("/user_settings"), "Only account settings may be accessed");
    assert(url.searchParams.get("user_id") === "eq." + uid, "Identity must come from authentication");
    if (req.method === "PATCH") { const body = await req.json(); writes.push(body); Object.assign(settings, body); }
    return Response.json(settings);
  }) as typeof fetch;
  try {
    const read = await kindleRoute(new Request("https://app/kindle"), "/kindle", uid);
    const before = await read!.json(); assert(!before.address_configured && before.amazon_sender_approval === "unverified");
    const response = await kindleRoute(new Request("https://app/kindle", { method: "PATCH", body: JSON.stringify({kindle_email:"  Reader@Kindle.com "}) }), "/kindle", uid);
    const result = await response!.json();
    assert(result.kindle_email === "reader@kindle.com" && result.address_configured);
    assert(result.amazon_sender_approval === "unverified" && result.approved_sender === "reader@antonioskilton.com");
    assert(!result.daily_delivery_enabled && writes.length === 1 && writes[0].onboarding_complete === true);
    settings.paused = false;
    await kindleRoute(new Request("https://app/kindle", {method:"PATCH",body:JSON.stringify({kindle_email:"next@free.kindle.com"})}), "/kindle", uid);
    assert(writes[1].paused === undefined && writes[1].onboarding_complete === undefined && !settings.paused, "Existing schedule must remain unchanged");
  } finally { globalThis.fetch = original; }
});

Deno.test("invalid Kindle recipients and caller-supplied account identity are rejected before data access", async () => {
  const original = globalThis.fetch; globalThis.fetch = async () => { throw Error("Invalid request reached database"); };
  try {
    for (const body of [{kindle_email:"reader@example.com"},{kindle_email:"x@kindle.com.evil.test"},{kindle_email:"x@kindle.com",user_id:"another"},{kindle_email:"x@kindle.com",paused:false},{kindle_email:42}]) {
      const response = await kindleRoute(new Request("https://app/kindle",{method:"PATCH",body:JSON.stringify(body)}),"/kindle",uid);
      assert(response!.status === 400);
    }
  } finally { globalThis.fetch = original; }
});
