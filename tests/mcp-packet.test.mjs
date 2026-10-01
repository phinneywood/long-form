import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("MCP exposes standalone packet delivery through the authenticated app API", async () => {
  const [mcp, api] = await Promise.all([
    readFile("supabase/functions/mcp/index.ts", "utf8"),
    readFile("supabase/functions/app-api/index.ts", "utf8"),
  ]);

  assert.match(mcp, /name: "send_packet"/);
  assert.match(mcp, /name: "get_packet_status"/);
  assert.match(mcp, /apiAsUser\(auth\.userId, "\/one-time\/queue", "POST"/);
  assert.match(mcp, /apiAsUser\(auth\.userId, `\/one-time\/jobs\/\$\{jobId\}`, "GET"\)/);

  assert.match(api, /route==="\/one-time\/queue"/);
  assert.match(api, /admin\.rpc\("queue_one_time_packet"/);
  assert.match(api, /idempotencyKey=`one-time:\$\{user\.id\}:\$\{dedupeKey\}`/);
  assert.match(api, /eq\("user_id",user\.id\)\.eq\("reason","one_time"\)/);
});

test("standalone packet MCP requires Long Form write scope and never accepts a user id", async () => {
  const mcp = await readFile("supabase/functions/mcp/index.ts", "utf8");
  const sendPacket = mcp.slice(mcp.indexOf('name: "send_packet"'), mcp.indexOf('name: "get_packet_status"'));
  assert.match(sendPacket, /securitySchemes: WRITE_SECURITY/);
  assert.doesNotMatch(sendPacket, /user_id/);
});
