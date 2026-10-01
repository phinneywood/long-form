import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Long Form plugin package is directory-ready", async () => {
  const plugin = JSON.parse(await readFile("plugin/long-form/plugin.json","utf8"));
  const mcp = JSON.parse(await readFile("plugin/long-form/mcp.json","utf8"));
  assert.equal(plugin.$schema,"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.equal(plugin.name,"long-form");
  assert.equal(mcp.mcpServers["long-form"].type,"streamable-http");
  assert.equal(mcp.mcpServers["long-form"].url,"https://reader.antonioskilton.com/api/mcp");
  const oi=plugin.extensions["com.openai"];
  for(const key of ["websiteURL","supportURL","privacyPolicyURL","termsOfServiceURL"]) assert.match(oi.interface[key],/^https:\/\//);
  assert.equal(oi.review.test_cases.positive.length,5);
  assert.equal(oi.review.test_cases.negative.length,3);
  assert.ok(oi.review.test_cases.positive.some(x=>x.tools_triggered.includes("get_delivery_history")));
  assert.ok(oi.review.test_cases.positive.some(x=>x.tools_triggered.includes("send_packet")));
  assert.equal(oi.review.commerce,false);
});

test("plugin review prompts cover the agreed user-level capabilities", async () => {
  const plugin=JSON.parse(await readFile("plugin/long-form/plugin.json","utf8"));
  const tools=plugin.extensions["com.openai"].review.test_cases.positive.flatMap(x=>x.tools_triggered.split(/,\s*/));
  for(const required of ["get_delivery_history","list_sources","find_feeds","add_source","send_packet","get_packet_status"]) assert.ok(tools.includes(required),required);
});
