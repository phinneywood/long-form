import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("delivery history is a read-only OAuth-scoped MCP tool", async () => {
  const mcp = await readFile("supabase/functions/mcp/index.ts", "utf8");
  const start = mcp.indexOf('name: "get_delivery_history"');
  const end = mcp.indexOf('name: "send_packet"', start);
  assert.ok(start >= 0 && end > start);
  const tool = mcp.slice(start, end);
  assert.match(tool, /readOnlyHint: true/);
  assert.match(tool, /securitySchemes: READ_SECURITY/);
  assert.doesNotMatch(tool, /user_id/);
  assert.match(mcp, /apiAsUser\(auth\.userId, `\/delivery-history\?limit=\$\{requested\}`, "GET"\)/);
});

test("delivery history API is tenant scoped and bounded", async () => {
  const api = await readFile("supabase/functions/app-api/index.ts", "utf8");
  const start = api.indexOf('route==="/delivery-history"');
  const end = api.indexOf('route==="/export"', start);
  assert.ok(start >= 0 && end > start);
  const route = api.slice(start, end);
  assert.match(route, /\.eq\("user_id",user\.id\)/);
  assert.match(route, /Math\.max\(1,Math\.min\(100/);
  assert.match(route, /delivery_kind/);
  assert.match(route, /packet_name/);
});
