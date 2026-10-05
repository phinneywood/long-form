import { admin, json, normEmail, validEmail } from "./core.ts";

export const KINDLE_SENDER = "reader@antonioskilton.com";
export const KINDLE_SETUP_URL = "https://reader.antonioskilton.com/?setup=kindle";

function setup(settings: any) {
  return {
    kindle_email: settings.kindle_email || null,
    address_configured: Boolean(settings.kindle_email),
    approved_sender: KINDLE_SENDER,
    amazon_sender_approval: "unverified",
    amazon_settings_url: "https://www.amazon.com/mycd",
    setup_url: KINDLE_SETUP_URL,
    reader_url: "https://reader.antonioskilton.com",
    daily_delivery_enabled: !settings.paused,
    next_step: settings.kindle_email
      ? `In Amazon Personal Document Settings, approve ${KINDLE_SENDER}. Long Form cannot verify approval or Kindle arrival.`
      : "Supply your Send-to-Kindle address or open setup_url. Sources and schedules are optional.",
  };
}

// The same settings row used by the reader. No job, feed or delivery side effect.
export async function kindleRoute(req: Request, route: string, userId: string) {
  if (route !== "/kindle" || !["GET", "PATCH"].includes(req.method)) return null;
  let email: string | undefined;
  if (req.method === "PATCH") {
    const body = await req.json().catch(() => null);
    if (!body || Object.keys(body).some(key => key !== "kindle_email") || typeof body.kindle_email !== "string") {
      return json({ error: "Supply only kindle_email." }, 400);
    }
    email = normEmail(body.kindle_email);
    if (!validEmail(email) || !/@(?:free\.)?kindle\.com$/.test(email)) {
      return json({ error: "Use your Amazon Send-to-Kindle address ending in @kindle.com or @free.kindle.com." }, 400);
    }
  }
  const current = await admin.from("user_settings").select("kindle_email,paused,onboarding_complete").eq("user_id", userId).single();
  if (current.error) throw current.error;
  if (email !== undefined) {
    const updated = await admin.from("user_settings").update({
      kindle_email: email,
      ...(!current.data.onboarding_complete ? { onboarding_complete: true, paused: true } : {}),
    }).eq("user_id", userId).select("kindle_email,paused,onboarding_complete").single();
    if (updated.error) throw updated.error;
    return json(setup(updated.data));
  }
  return json(setup(current.data));
}
