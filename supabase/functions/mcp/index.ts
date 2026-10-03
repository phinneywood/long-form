import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

const APP_API = "https://wuikfmmwvrzpaoevtskn.supabase.co/functions/v1/app-api";
const RESOURCE = "https://reader.antonioskilton.com/api/mcp";
const RESOURCE_METADATA = "https://reader.antonioskilton.com/.well-known/oauth-protected-resource";
const PROTOCOL_VERSION = "2025-06-18";

type RpcId = string | number | null;
type AuthInfo = { userId: string; email: string; clientId: string; scopes: string[]; tokenId: string };

const READ_SECURITY = [{ type: "oauth2", scopes: ["reader:read"] }];
const WRITE_SECURITY = [{ type: "oauth2", scopes: ["reader:read", "reader:write"] }];

const PROFILE_SCHEMA = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    id: { type: "string", minLength: 1, pattern: "\\S", description: "Opaque stable Long Form profile identifier." },
    email: { type: "string", description: "Long Form account email for display." },
    nickname: { type: "string", description: "Useful account label." }
  },
  required: ["id"],
  additionalProperties: false
};

const SOURCE_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    url: { type: "string" },
    enabled: { type: "boolean" },
    last_error: { type: ["string","null"] }
  },
  required: ["id","name","url","enabled","last_error"],
  additionalProperties: false
};
const ARTICLE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    url: { type: "string" },
    published_at: { type: ["string","null"] },
    source: { type: "string" }
  },
  required: ["title","url","published_at","source"],
  additionalProperties: true
};
const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    editorial_brief: {
      type: "string",
      maxLength: 3000,
      description: "Explicit reader interests and editorial preferences. This guides organization and Open Discovery; it never filters eligible RSS articles."
    }
  },
  required: ["editorial_brief"],
  additionalProperties: false
};
const EDITOR_SCHEMA = {
  type: "object",
  properties: {
    editorial_brief: {
      type: "string",
      maxLength: 3000,
      description: "Broad interests and stable reading preferences. Open Discovery uses this as its primary taste signal."
    },
    editorial_instructions: {
      type: "string",
      maxLength: 3000,
      description: "Optional additional editor guidance applied to organization, discovery, and the editor note. Fixed Long Form editorial rules always take precedence."
    }
  },
  required: ["editorial_brief","editorial_instructions"],
  additionalProperties: false
};

const TOOLS: any[] = [
  {
    name: "get_profile",
    description: "Return the Long Form profile represented by the authenticated connection.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: PROFILE_SCHEMA,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: READ_SECURITY,
    _meta: { "openai/profile": true, securitySchemes: READ_SECURITY }
  },
  {
    name: "list_sources",
    description: "List the user's recurring RSS/Atom sources. Long Form organizes eligible articles dynamically at issue time rather than assigning sources to preset categories.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: { type: "object", properties: { sources: { type: "array", items: SOURCE_SCHEMA } }, required: ["sources"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: READ_SECURITY,
    _meta: { securitySchemes: READ_SECURITY }
  },
  {
    name: "find_feeds",
    description: "Find RSS or Atom feeds for a website or validate a direct feed URL.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", minLength: 1, description: "A website URL or direct RSS/Atom feed URL." } },
      required: ["url"],
      additionalProperties: false
    },
    outputSchema: {
      type: "object",
      properties: {
        feeds: { type: "array", items: { type: "object", properties: { url:{type:"string"}, title:{type:"string"}, method:{type:"string"} }, required:["url","title","method"], additionalProperties:true } },
        powered_by: { type: "string" }
      },
      required: ["feeds"],
      additionalProperties: true
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    securitySchemes: READ_SECURITY,
    _meta: { securitySchemes: READ_SECURITY }
  },
  {
    name: "add_source",
    description: "Add a recurring website or RSS/Atom source. No category or section is required.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", minLength: 1, description: "Website URL or direct RSS/Atom feed URL." },
        name: { type: "string", maxLength: 120, description: "Optional display name. Long Form will infer one if omitted." }
      },
      required: ["url"],
      additionalProperties: false
    },
    outputSchema: { type: "object", properties: { source: SOURCE_SCHEMA }, required: ["source"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    securitySchemes: WRITE_SECURITY,
    _meta: { securitySchemes: WRITE_SECURITY }
  },
  {
    name: "preview_sources",
    description: "Browse recent articles across all active recurring sources without sending anything or applying delivery-history suppression.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        items: { type: "array", items: ARTICLE_SCHEMA },
        feeds: { type: "array", items: { type: "object", additionalProperties: true } }
      },
      required: ["items","feeds"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    securitySchemes: READ_SECURITY,
    _meta: { securitySchemes: READ_SECURITY }
  },
  {
    name: "get_editorial_brief",
    description: "Return the explicit Long Form editorial brief used for organization and Open Discovery. It is never used to omit eligible RSS articles.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: BRIEF_SCHEMA,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: READ_SECURITY,
    _meta: { securitySchemes: READ_SECURITY }
  },
  {
    name: "update_editorial_brief",
    description: "Replace the explicit Long Form editorial brief. This affects organization and Open Discovery, not RSS article eligibility.",
    inputSchema: BRIEF_SCHEMA,
    outputSchema: BRIEF_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: WRITE_SECURITY,
    _meta: { securitySchemes: WRITE_SECURITY }
  },
  {
    name: "get_editor_settings",
    description: "Return the user's editable Long Form editor settings: the editorial brief and additional instructions. Fixed product rules are not user-editable.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: EDITOR_SCHEMA,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: READ_SECURITY,
    _meta: { securitySchemes: READ_SECURITY }
  },
  {
    name: "update_editor_settings",
    description: "Replace the user's editable Long Form editor settings. These may shape organization, discovery, and the editor note but cannot override fixed product rules or RSS eligibility.",
    inputSchema: EDITOR_SCHEMA,
    outputSchema: EDITOR_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: WRITE_SECURITY,
    _meta: { securitySchemes: WRITE_SECURITY }
  },
  {
    name: "get_delivery_history",
    description: "List articles recently delivered by Long Form, including standalone packets and recurring issues. Use this to answer what was sent recently or avoid recommending articles already delivered.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Maximum delivered articles to return. Defaults to 20." }
      },
      additionalProperties: false
    },
    outputSchema: {
      type: "object",
      properties: {
        items: { type: "array", items: { type: "object", properties: {
          title:{type:"string"}, url:{type:"string"}, published_at:{type:["string","null"]},
          delivered_at:{type:"string"}, delivery_kind:{type:"string"}, packet_name:{type:["string","null"]}, job_id:{type:["string","null"]}
        }, required:["title","url","published_at","delivered_at","delivery_kind","packet_name","job_id"], additionalProperties:false } },
        limit: { type: "integer" }
      },
      required: ["items","limit"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: READ_SECURITY,
    _meta: { securitySchemes: READ_SECURITY }
  },
  {
    name: "send_packet",
    description: "Queue a standalone Long Form EPUB from 1–20 article URLs and send it to the user's configured Kindle. Use dedupe_key to make repeated automation runs idempotent.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 80, description: "Packet title shown on the EPUB and email subject." },
        urls: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1 }, description: "Public article URLs to include, in reading order." },
        dedupe_key: { type: "string", minLength: 1, maxLength: 120, pattern: "^[A-Za-z0-9._:-]+$", description: "Optional caller-chosen idempotency suffix, for example tonights-reading:2026-09-30. Reusing it with the same packet returns the existing job instead of sending twice." }
      },
      required: ["name","urls"],
      additionalProperties: false
    },
    outputSchema: { type: "object", additionalProperties: true },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    securitySchemes: WRITE_SECURITY,
    _meta: { securitySchemes: WRITE_SECURITY }
  },
  {
    name: "send_custom_issue",
    description: "Queue supplied custom content as a validated Long Form EPUB to the configured Kindle. Provide content or ordered sections, not both. Use markdown or semantic HTML for structured documents; preserve headings, lists, code and tables. Never flatten DOCX/PDF layouts into hard-wrapped prose. Text is literal; formatted content is sanitized. Source links are citations, not article extraction. Use dedupe_key to prevent repeat sends and get_packet_status to verify provider acceptance; Amazon ingestion is not confirmed.",
    inputSchema: {
      type: "object", properties: {
        title: {type:"string",minLength:1,maxLength:80},
        content: {type:"string",minLength:1,maxLength:250000},
        format: {type:"string",enum:["text","html","markdown"]},
        sections: {type:"array",minItems:1,maxItems:20,items:{type:"object",properties:{title:{type:"string",minLength:1,maxLength:200},content:{type:"string",minLength:1,maxLength:250000},format:{type:"string",enum:["text","html","markdown"]}},required:["title","content"],additionalProperties:false}},
        source_links: {type:"array",maxItems:40,items:{type:"string",maxLength:2048}},
        dedupe_key: {type:"string",minLength:1,maxLength:120,pattern:"^[A-Za-z0-9._:-]+$"}
      }, required:["title"], oneOf:[{required:["content"],not:{required:["sections"]}},{required:["sections"],not:{required:["content"]}}], additionalProperties:false
    },
    outputSchema:{type:"object",additionalProperties:true},
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true},
    securitySchemes: WRITE_SECURITY, _meta:{securitySchemes:WRITE_SECURITY}
  },
  {
    name: "get_packet_status",
    description: "Get delivery status for send_packet or send_custom_issue. sent means email provider acceptance, not confirmed Amazon ingestion.",
    inputSchema: {
      type: "object",
      properties: { job_id: { type: "string", minLength: 1, description: "Job ID returned by send_packet." } },
      required: ["job_id"],
      additionalProperties: false
    },
    outputSchema: { type: "object", additionalProperties: true },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: READ_SECURITY,
    _meta: { securitySchemes: READ_SECURITY }
  },
  {
    name: "send_now",
    description: "Queue the user's current Long Form issue for immediate delivery to the configured Send-to-Kindle address.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: { type: "object", additionalProperties: true },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    securitySchemes: WRITE_SECURITY,
    _meta: { securitySchemes: WRITE_SECURITY }
  }
];

// One authenticated application capability layer for UI and external agents.
const PUBLICATION_TOOLS:any[] = [
 {name:"list_publications",description:"List finite Long Form editions, featured paths, original-article metadata and preparation status. No inbox or automatic send.",path:"/publication/editions",method:"GET",properties:{},required:[],read:true},
 {name:"read_publication_article",description:"Read an original in the exact edition by its zero-based position, including numbered paragraphs and reading state.",path:"/reader/article",method:"POST",properties:{edition_id:{type:"string"},position:{type:"integer",minimum:0}},required:["edition_id","position"],read:true},
 {name:"discuss_reading",description:"Ask the same editor using actual edition/article/library/delivery context. Steering is temporary and proposals are never durably saved by this call. Does not send. Supply a stable request_key for retries.",path:"/editor/message",method:"POST",properties:{question:{type:"string",maxLength:4000},request_key:{type:"string",minLength:8,maxLength:120},edition_id:{type:"string"},position:{type:"integer",minimum:0},paragraph:{type:"integer",minimum:0}},required:["question","request_key"],read:false},
 {name:"compose_reading_edition",description:"Compose Tonight’s Reading with original articles, a time budget and no recent repeats. Nothing is sent; inspect returned preparation status and edition before sending. Stable request_key required.",path:"/publication/compose",method:"POST",properties:{request:{type:"string",maxLength:4000},minutes:{type:"integer",minimum:10,maximum:120},request_key:{type:"string",minLength:8,maxLength:120}},required:["request","minutes","request_key"],read:false},
 {name:"send_publication",description:"Only after the user explicitly asks to send this reviewed edition: queue its exact frozen EPUB to their configured Kindle address. Never recompose. Reuse request_key on retry and observe status; sent/partial mean provider acceptance, not Kindle arrival.",path:"/publication/send",method:"POST",properties:{edition_id:{type:"string"},request_key:{type:"string",minLength:8,maxLength:120}},required:["edition_id","request_key"],read:false},
 {name:"get_publication_status",description:"Observe preparation/delivery status, omissions and edition identity. Never infer delivery from queuing.",path:"/publication/job",method:"GET",properties:{id:{type:"string"}},required:["id"],read:true},
];
for(const t of PUBLICATION_TOOLS){const security=t.read?READ_SECURITY:WRITE_SECURITY;TOOLS.push({name:t.name,description:t.description,inputSchema:{type:"object",properties:t.properties,required:t.required,additionalProperties:false},annotations:{readOnlyHint:t.read,destructiveHint:false,idempotentHint:true,openWorldHint:true},securitySchemes:security,_meta:{securitySchemes:security}});}

function rpcResult(id: RpcId, result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
function rpcError(id: RpcId, code: number, message: string, data?: unknown, status = 200) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
function toolResult(data: unknown, isError = false, meta?: Record<string,unknown>) {
  return {
    content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
    structuredContent: typeof data === "object" && data !== null ? data : { value: data },
    ...(meta ? { _meta: meta } : {}),
    ...(isError ? { isError: true } : {})
  };
}
function bearer(req: Request) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}
function randomToken() {
  const b = new Uint8Array(32); crypto.getRandomValues(b);
  let s = ""; for (const x of b) s += String.fromCharCode(x);
  return "mr_delegate_" + btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function sha256(v: string) {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
  return Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("");
}
async function authenticate(raw: string): Promise<AuthInfo | null> {
  if (!raw) return null;
  const { data, error } = await admin.rpc("mcp_validate_oauth_access_token", {
    p_token_hash: await sha256(raw),
    p_resource: RESOURCE
  });
  if (error || !Array.isArray(data) || !data.length) return null;
  const access:any=data[0];
  return {
    userId: access.user_id,
    email: access.email,
    clientId: access.client_id,
    scopes: access.scopes || [],
    tokenId: access.token_id
  };
}
function hasScopes(auth: AuthInfo, required: string[]) {
  return required.every(s => auth.scopes.includes(s));
}
function authChallenge(required: string[], kind: "invalid_token" | "insufficient_scope" = "invalid_token") {
  const scope = required.join(" ");
  const description = kind === "invalid_token" ? "Connect Long Form to continue." : "Reconnect Long Form with the requested permissions.";
  return `Bearer resource_metadata="${RESOURCE_METADATA}", scope="${scope}", error="${kind}", error_description="${description}"`;
}
function authToolError(required: string[], kind: "invalid_token" | "insufficient_scope" = "invalid_token") {
  return toolResult(
    { error: kind === "invalid_token" ? "Authentication required." : "Additional Long Form permission is required." },
    true,
    { "mcp/www_authenticate": [authChallenge(required, kind)] }
  );
}
async function apiAsUser(userId: string, path: string, method = "GET", body?: unknown) {
  const raw = randomToken();
  const hash = await sha256(raw);
  const { data: session, error: se } = await admin.from("sessions").insert({
    user_id: userId,
    token_hash: hash,
    expires_at: new Date(Date.now() + 2 * 60_000).toISOString()
  }).select("id").single();
  if (se) throw se;
  try {
    const r = await fetch(APP_API + path, {
      method,
      headers: { Authorization: `Bearer ${raw}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await r.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || `HTTP ${r.status}` }; }
    if (!r.ok) throw Object.assign(new Error(data?.error || `Long Form API returned HTTP ${r.status}`), { status: r.status, data });
    return data;
  } finally {
    await admin.from("sessions").delete().eq("id", session.id);
  }
}
function sourceView(source: any) {
  return {
    id: source.id,
    name: source.name,
    url: source.url,
    enabled: source.enabled,
    last_error: source.last_error || null
  };
}
async function dashboard(userId: string) {
  return await apiAsUser(userId, "/me");
}
function sourcesFrom(me: any) {
  if (Array.isArray(me?.sources)) return me.sources;
  return (me?.sections || []).flatMap((section: any) => section.feeds || []);
}
function requiredScopes(toolName: string) {
  const tool = TOOLS.find(t => t.name === toolName);
  return (tool?.securitySchemes?.find((s: any) => s.type === "oauth2")?.scopes || []) as string[];
}
async function callTool(name: string, args: any, auth: AuthInfo) {
  const capability=PUBLICATION_TOOLS.find(t=>t.name===name);
  if(capability){const endpoint=capability.method==="GET"&&args?.id?`${capability.path}?id=${encodeURIComponent(args.id)}`:capability.path;return toolResult(await apiAsUser(auth.userId,endpoint,capability.method,capability.method==="GET"?undefined:args));}
  switch (name) {
    case "get_profile": {
      const profile = { id: auth.userId, email: auth.email, nickname: "Long Form" };
      return {
        content: [{ type: "text", text: JSON.stringify(profile) }],
        structuredContent: profile,
        isError: false
      };
    }
    case "list_sources": {
      const me = await dashboard(auth.userId);
      return toolResult({ sources: sourcesFrom(me).map(sourceView) });
    }
    case "find_feeds": {
      const url = String(args?.url || "").trim();
      if (!url) return toolResult({ error: "url is required." }, true);
      return toolResult(await apiAsUser(auth.userId, "/discover", "POST", { url }));
    }
    case "add_source": {
      const url = String(args?.url || "").trim();
      if (!url) return toolResult({ error: "url is required." }, true);
      const before = await dashboard(auth.userId);
      const previous = new Set(sourcesFrom(before).map((source: any) => source.id));
      const after = await apiAsUser(auth.userId, "/feeds", "POST", {
        url,
        ...(args?.name ? { name: String(args.name).trim() } : {})
      });
      const sources = sourcesFrom(after);
      const source = sources.find((item: any) => !previous.has(item.id)) || sources.at(-1);
      if (!source) return toolResult({ error: "Source was added but could not be read back." }, true);
      return toolResult({ source: sourceView(source) });
    }
    case "preview_sources":
      return toolResult(await apiAsUser(auth.userId, "/preview", "POST", {}));
    case "get_editorial_brief": {
      const me = await dashboard(auth.userId);
      return toolResult({ editorial_brief: String(me?.settings?.editorial_brief || "") });
    }
    case "update_editorial_brief": {
      const editorialBrief = String(args?.editorial_brief || "").trim();
      if (editorialBrief.length > 3000) return toolResult({ error: "Editorial brief must be 3,000 characters or fewer." }, true);
      const after = await apiAsUser(auth.userId, "/settings", "PATCH", { editorial_brief: editorialBrief });
      return toolResult({ editorial_brief: String(after?.settings?.editorial_brief || "") });
    }
    case "get_editor_settings": {
      const me = await dashboard(auth.userId);
      return toolResult({
        editorial_brief: String(me?.settings?.editorial_brief || ""),
        editorial_instructions: String(me?.settings?.editorial_instructions || ""),
      });
    }
    case "update_editor_settings": {
      const editorialBrief = String(args?.editorial_brief || "").trim();
      const editorialInstructions = String(args?.editorial_instructions || "").trim();
      if (editorialBrief.length > 3000) return toolResult({ error: "Editorial brief must be 3,000 characters or fewer." }, true);
      if (editorialInstructions.length > 3000) return toolResult({ error: "Additional editor instructions must be 3,000 characters or fewer." }, true);
      const after = await apiAsUser(auth.userId, "/settings", "PATCH", {
        editorial_brief: editorialBrief,
        editorial_instructions: editorialInstructions,
      });
      return toolResult({
        editorial_brief: String(after?.settings?.editorial_brief || ""),
        editorial_instructions: String(after?.settings?.editorial_instructions || ""),
      });
    }
    case "get_delivery_history": {
      const requested = args?.limit === undefined ? 20 : Number(args.limit);
      if (!Number.isInteger(requested) || requested < 1 || requested > 100) return toolResult({ error: "limit must be an integer from 1 to 100." }, true);
      return toolResult(await apiAsUser(auth.userId, `/delivery-history?limit=${requested}`, "GET"));
    }
    case "send_custom_issue":
      return toolResult(await apiAsUser(auth.userId, "/custom-issue/queue", "POST", args));
    case "send_packet": {
      const nameArg = String(args?.name || "").trim();
      const urls = Array.isArray(args?.urls) ? args.urls.map((url: unknown) => String(url || "").trim()) : [];
      const dedupeKey = args?.dedupe_key === undefined ? undefined : String(args.dedupe_key || "").trim();
      if (!nameArg || nameArg.length > 80) return toolResult({ error: "Packet name must be 1–80 characters." }, true);
      if (!urls.length || urls.length > 20) return toolResult({ error: "Add between 1 and 20 article URLs." }, true);
      if (dedupeKey !== undefined && !/^[A-Za-z0-9._:-]{1,120}$/.test(dedupeKey)) return toolResult({ error: "Invalid dedupe key." }, true);
      return toolResult(await apiAsUser(auth.userId, "/one-time/queue", "POST", {
        name: nameArg,
        urls,
        ...(dedupeKey === undefined ? {} : { dedupe_key: dedupeKey })
      }));
    }
    case "get_packet_status": {
      const jobId = String(args?.job_id || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(jobId)) return toolResult({ error: "A valid packet job ID is required." }, true);
      return toolResult(await apiAsUser(auth.userId, `/one-time/jobs/${jobId}`, "GET"));
    }
    case "send_now":
      return toolResult(await apiAsUser(auth.userId, "/send-now", "POST", {}));
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { rpcCode: -32602 });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, content-type, accept, mcp-protocol-version",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    } });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", "Allow": "POST", "Cache-Control": "no-store" }
    });
  }

  let msg: any;
  try { msg = await req.json(); } catch { return rpcError(null, -32700, "Parse error", undefined, 400); }
  const id: RpcId = msg?.id ?? null;
  if (msg?.jsonrpc !== "2.0" || typeof msg?.method !== "string") return rpcError(id, -32600, "Invalid Request", undefined, 400);

  try {
    if (msg.method === "initialize") {
      const requested = String(msg.params?.protocolVersion || PROTOCOL_VERSION);
      const protocolVersion = ["2025-06-18", "2025-03-26"].includes(requested) ? requested : PROTOCOL_VERSION;
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "long-form", version: "0.2.0" },
        instructions: "Manage Long Form sources, editor settings, daily issues, and standalone article packets delivered to the user's Kindle."
      });
    }
    if (msg.method === "ping") return rpcResult(id, {});
    if (msg.method === "tools/list") return rpcResult(id, { tools: TOOLS });
    if (msg.method.startsWith("notifications/")) return new Response(null, { status: 202 });

    if (msg.method === "tools/call") {
      const name = String(msg.params?.name || "");
      const args = msg.params?.arguments || {};
      const required = requiredScopes(name);
      const auth = await authenticate(bearer(req));
      if (!auth) return rpcResult(id, authToolError(required.length ? required : ["reader:read"]));
      if (!hasScopes(auth, required)) return rpcResult(id, authToolError(required, "insufficient_scope"));
      try {
        return rpcResult(id, await callTool(name, args, auth));
      } catch (e: any) {
        if (e?.rpcCode) return rpcError(id, e.rpcCode, e.message);
        return rpcResult(id, toolResult({ error: String(e?.message || e) }, true));
      }
    }

    return rpcError(id, -32601, "Method not found");
  } catch (e: any) {
    console.error(e);
    return rpcError(id, -32603, "Internal error", { message: String(e?.message || e).slice(0, 400) });
  }
});
