import { advertisedTools, CORE_TOOL_NAMES, withDelivery } from "../functions/mcp/workflow.ts";
function assert(value: unknown, message = "Assertion failed"): asserts value { if (!value) throw Error(message); }

Deno.test("default discovery is compact while full reader compatibility remains discoverable", () => {
  const tools = [...CORE_TOOL_NAMES, "list_sources", "send_publication"].map(name => ({name}));
  assert(advertisedTools(tools,"https://app/api/mcp").length === 7);
  assert(advertisedTools(tools,"https://app/api/mcp?toolset=reader") === tools);
});

Deno.test("queue and observed delivery distinguish provider acceptance from Kindle arrival", () => {
  for (const status of ["queued","running","sent","partial","empty","failed","needs_review"]) {
    const data = withDelivery({created:false,job:{id:"same-job",status,error:"detail",result:{provider_email_id:"provider-id",articles:3,issues:["One image unavailable"]}}});
    assert(data.job.id === "same-job" && data.created === false, "Preserve existing job and dedupe result");
    assert(data.delivery.provider_accepted === ["sent","partial"].includes(status));
    assert(data.delivery.kindle_arrival === "unverified" && data.delivery.issues[0] === "One image unavailable");
    if (status === "partial") assert(!data.delivery.message.includes("omitted"), "An image note is not an omitted article");
  }
});
