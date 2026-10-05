# Long Form 1.2.0 release

October 3, 2026. The simplified ChatGPT workflow is deployed and the existing personal cloud plugin is updated in place. The full web reader/editor remains available on the same account.

## Changes

Default MCP discovery now exposes seven tools: profile, Kindle setup, save Kindle address, original article packet, supplied document, packet status and history. ChatGPT selects one-off material; Long Form extracts originals or formats documents, validates EPUBs and uses the existing authenticated frozen-outbox delivery pipeline. Advanced capabilities remain callable; full discovery uses the same endpoint with `?toolset=reader` and the canonical query-free OAuth resource.

Kindle setup reads/writes the same settings as the web UI. New accounts can finish with no feeds, schedule or test issue; daily delivery stays off. Existing schedules remain unchanged. The UI includes a Kindle-only shortcut and a setup deep link. Amazon sender approval and Kindle arrival remain unverified.

Sending/status responses preserve existing job fields and add a consistent delivery summary. History includes bounded actual delivery attempts and accepted articles, including custom issues; preparation-only jobs are excluded. Stable keys, provenance, document structure and exact retry payloads remain in place.

## Source and deployment

- Product implementation: https://github.com/phinneywood/long-form/pull/78 (merged).
- Delivery-history correction from live verification: https://github.com/phinneywood/long-form/pull/79 (merged).
- Skill/package source: https://github.com/phinneywood/chatgpt-plugins/pull/4 (merged).
- App API v64; MCP v16. Existing custom OAuth/session authentication retained. No schema or worker changes.
- Existing personal plugin identity retained; uploaded through Upload new version and visibly reports 1.2.0. Existing account connection remains intact. Registered service tools were refreshed after deployment.
- Archive SHA-256: `2d0d6538ab04ef0228f3a560ebff874cb2a95ae369b07fb95a66eca41da7294f`.
- SKILL.md SHA-256: `943bef08b017ba27ceeb4880eb0baac6fb491b162e67b30f53f118cb92d38d1a`. The native Work skill's saved remote bytes match.

## Verification gates

| Gate | State | Evidence and boundary |
| --- | --- | --- |
| Static package | Passed | Archive extracted and convention validator passed; this is not a complete host/schema/security validator. Native skill validator also passed. |
| Installation persisted | Passed | Existing cloud plugin detail reports 1.2.0 and connected account; no duplicate installation or connector removal. |
| Source equality | Passed | Packaged instruction/contract bytes equal source; native Work instruction/contract bytes verified after save. Host-generated metadata can differ. |
| Ordinary Chat instruction loading | Passed | Fresh web Chat native reader opened `skills://plugins/long-form-kindle/long-form-kindle/skill.md` and reported new Setup / Prepare and send / Observe sections. |
| Ordinary Chat bundled reference | Passed after corrected path | Reader opened `skills://plugins/long-form-kindle/long-form-kindle/references/tool-contract.md`. Initial attempts omitted the skill-directory segment and failed; no GitHub fallback was used. |
| Ordinary Chat service behavior | Passed for read-only setup | After Refresh tools, a fresh Chat called `Long_Form.get_kindle_setup`, returned actual configured address, sender, unverified Amazon approval and daily-delivery state. No configuration or send performed. |
| Workflow behavior | Passed in simulation | Independent original-URL send and prepare-only structured-document tests used correct route/format, stable key, bounded status checks and precise partial-image reporting; no real email. |
| Product regression | Passed | CI type checks, backend and Node suites; Chromium and WebKit mobile/desktop reader, editor, settings, onboarding and new Kindle-only journey. No new real email sent for testing. |
| Production | Passed | Seven tools on default endpoint; 22 on reader compatibility discovery; live profile/history/status reads succeed; deployed frontend includes Kindle-only setup and publication UI. |
| iOS Chat host | Unverified for this release | WebKit product checks pass. The ChatGPT iOS host has not been tested after this update. |

Native-reader check: personal verification record retained privately.

Fresh service setup check: personal verification record retained privately.

## Limits and remaining work

ChatGPT still displays the connected-service entry alongside the combined skill plugin. Removing that shared entry previously disconnected the account; it was preserved. The connected service works from regular Chat and its self-contained tool descriptions support the core flow without requiring the skill.

The earlier LangGraph primary-source packet failed after three interrupted preparation attempts. Reconciliation found no frozen attachment, send-start time or provider receipt. This release exposes that failure accurately; it does not claim to repair that extraction failure or to have delivered the packet. Investigate that worker interruption separately before a controlled retry.

## Restore and invocation

If rollback is needed, restore product code before PR78 and the prior package manifest/skill, upload a new version of the same plugin identity, redeploy the previous API/MCP sources, then refresh registered tools. Preserve the working connection.

Regular Chat: select the connected Long Form service and ask to set up Kindle, send specified original URLs/documents, or check status/history. The full reader remains at https://reader.antonioskilton.com. The skill is a thin companion for preparing packets and preserving document structure.
