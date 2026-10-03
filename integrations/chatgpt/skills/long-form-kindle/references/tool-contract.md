# Long Form tool contract

Require a connected Long Form account. Server: `https://reader.antonioskilton.com/api/mcp`. The connection supplies account identity; the service supplies the Kindle recipient. Delivery requires OAuth `reader:read reader:write`; status/history requires `reader:read`.

| Material | Tool | Input |
| --- | --- | --- |
| Setup | `get_kindle_setup` | No arguments; saved address, approved sender and Amazon/web links |
| Save address | `configure_kindle` | Explicitly supplied `kindle_email` ending in @kindle.com / @free.kindle.com; no sends |
| Public original articles | `send_packet` | `name` (1–80 characters), `urls` (1–20 public http(s) URLs), optional `dedupe_key` |
| Supplied/generated custom document | `send_custom_issue` | `title` (1–80 characters), exactly one of `content` or `sections`, optional `source_links`, `dedupe_key` |
| Queued delivery | `get_packet_status` | `job_id` from `job.id` |
| Delivery evidence | `get_delivery_history` | optional `limit` (1–100) |

Custom document details:
- `content`: 1–250,000 characters. `format`: `text` (default), `markdown`, or `html`.
- `sections`: 1–20 objects in reading order, each with `title` (1–200 characters), `content` (1–250,000 characters), optional `format`. Total content limit: 1,000,000 characters.
- `source_links`: up to 40 http(s) URL strings, appended as a Sources entry. They are not fetched as original articles.
- Plain text is literal and escaped. Markdown is parsed with GFM support and sanitized; HTML is sanitized by Long Form. Prefer Markdown or semantic HTML for structured documents, and preserve code whitespace. Custom issues use their title on the cover and named chapters in Kindle navigation. Supported public images use the canonical embedding pipeline; unsupported images can yield `partial` with explicit diagnostics.
- `dedupe_key`: 1–120 letters, numbers, dots, underscores, colons, or hyphens. Same key + same payload returns the existing job. Same key + different payload returns a conflict.
- Delivery responses retain `{ok, created, worker_triggered, job}` and add `delivery`. Status retains `{job}` and adds the same `delivery` summary: job_id, state, provider_accepted, unverified kindle_arrival, provider_email_id, articles, issues, error and message. History retains article `items` and adds recent `jobs`, including pending/failure states and custom issues.

| Status | Meaning / action |
| --- | --- |
| `queued`, `running` | In progress; check this job rather than send again. |
| `sent` | Email provider accepted the EPUB; Amazon ingestion remains unconfirmed. |
| `partial` | Provider accepted it with notes (possibly images or omitted content); inspect `result.issues` and media diagnostics. |
| `failed` | Preparation or delivery failed; inspect `error`; do not blindly resend. |
| `needs_review` | Ambiguous delivery; requires reconciliation to avoid duplicate sending. |
| `empty` | No issue sent; custom requests must contain readable content. |

The service generates its dated cover and EPUB using `makeEpub()`, validates navigation/OPF/NCX/XHTML/assets/reading order with `validateEpub()`, and freezes exact attachment bytes with MIME `application/epub+zip` before Resend. Retries use that frozen payload and provider idempotency key. The service sends as `Long Form <reader@antonioskilton.com>`; never mislabel it as the assistant Gmail sender.

Default discovery exposes seven tools: profile, setup, configure, packet, custom issue, status and history. The full web UI remains at https://reader.antonioskilton.com on the same account. Advanced tools remain callable; full compatibility discovery is available at the same MCP endpoint with `?toolset=reader`. OAuth uses the query-free protected-resource URL. New-account minimal setup leaves daily delivery off; existing schedules are unchanged. Amazon sender approval remains unverified.
