export const CORE_TOOL_NAMES = [
  "get_profile", "get_kindle_setup", "configure_kindle", "send_packet",
  "send_custom_issue", "get_packet_status", "get_delivery_history",
];

export function advertisedTools(tools: any[], url: string) {
  // Compatibility discovery uses the same account, endpoint and OAuth resource.
  return new URL(url).searchParams.get("toolset") === "reader"
    ? tools : tools.filter(tool => CORE_TOOL_NAMES.includes(tool.name));
}

export function deliverySummary(job: any) {
  const state = String(job?.status || "unknown");
  const accepted = ["sent", "partial"].includes(state);
  const notes = {
    queued: "Queued; email submission has not been confirmed.",
    running: "Preparing the issue; email submission has not been confirmed.",
    sent: "Accepted by the email provider. Amazon ingestion and Kindle arrival are unverified.",
    partial: "Accepted by the email provider with notes. Read issues; Amazon ingestion and Kindle arrival are unverified.",
    empty: "No eligible content; nothing was sent.",
    failed: "Delivery failed. Inspect the error before deciding on a retry.",
    needs_review: "Delivery needs review. Do not queue another copy automatically.",
  };
  return {
    job_id: job?.id || null, state, provider_accepted: accepted,
    kindle_arrival: "unverified",
    provider_email_id: job?.result?.provider_email_id || null,
    articles: job?.result?.articles ?? null,
    issues: Array.isArray(job?.result?.issues) ? job.result.issues : [],
    error: job?.error || null,
    message: notes[state as keyof typeof notes] || "Inspect the job status before claiming delivery.",
  };
}

export function withDelivery(data: any) {
  return data?.job ? { ...data, delivery: deliverySummary(data.job) } : data;
}
