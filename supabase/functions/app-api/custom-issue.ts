import { admin, json } from "./core.ts";
import { customIssueInput } from "../_shared/custom-issue.ts";

export async function queueCustomIssue(req: Request, userId: string): Promise<Response> {
  const body = await req.json().catch(()=>({}));
  const issue = customIssueInput(body);
  const key = body.dedupe_key ?? crypto.randomUUID();
  if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{1,120}$/.test(key)) return json({error:"Invalid dedupe key."},400);
  const result = await admin.rpc("queue_custom_issue", { p_user_id: userId, p_issue: issue, p_idempotency_key: `custom-issue:${userId}:${key}` });
  if (result.error) {
    if (result.error.message.includes("different issue")) return json({error:result.error.message},409);
    if (result.error.message.includes("not configured")) return json({error:result.error.message,setup_url:"https://reader.antonioskilton.com/?setup=kindle"},400);
    throw result.error;
  }
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!row?.job_id) throw new Error("Long Form did not return a custom issue job.");
  return json({ok:true,created:row.created,worker_triggered:Boolean(row.worker_request_id),job:{id:row.job_id,status:row.job_status,packet_name:issue.title}},202);
}
