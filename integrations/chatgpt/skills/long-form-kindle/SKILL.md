---
name: long-form-kindle
description: Set up Kindle and send original article packets or supplied documents through Long Form. Use for send this to Kindle, make a Long Form issue, or prepare a Kindle reading packet; observe status without duplicate sends.
---

# Long Form Kindle

Use the connected Long Form service. In regular ChatGPT, select its connected service as well as this skill if tools are absent. The skill alone cannot deliver. The full web reader, editor, sources and schedules remain at https://reader.antonioskilton.com using the same account.

## Setup

Call `get_kindle_setup` when setup is needed. If no address is saved, ask for the user's Amazon Send-to-Kindle address; call `configure_kindle` only with the address they supply. Never infer it from their sign-in email. Show the returned approved sender and Amazon settings link: the user approves the sender in Amazon. This step is unverified by Long Form. No feeds, schedule or test issue are required. Account identity comes from the connection; delivery always uses its saved address.

## Prepare and send

Preparing content or installing the skill does not authorize delivery. A prepare-only result is a checked draft payload; EPUB conversion and validation happen during an authorized send. “Send this to Kindle” authorizes that specific issue. Respect the user's authorial boundary; use writers-packet for substantial writing preparation and generate publication prose only when requested.

- Original web reading: select public article URLs in reading order and use `send_packet`. Long Form extracts the originals; do not substitute generated summaries.
- Supplied or explicitly requested custom writing: use `send_custom_issue` with content OR ordered sections. Source links are citations, not article extraction. Preserve complete text, headings, lists, links, code indentation and tables. Use `markdown` for Markdown, `html` for semantic HTML, and `text` only for plain prose. Read structured originals; never email hard-wrapped PDF extraction as a replacement. Split major chapters into named sections. Check completeness and structure before sending; surface uncertainty. Do not pad reading time or add unsolicited exercises.

Create one stable `dedupe_key` per authorized logical send. Retain it and the returned job ID. After an uncertain response, reuse the same key and identical payload. Never invent a new key to evade a conflict or failure. Sending tools queue immediately.

## Observe

Use `get_packet_status` with bounded checks. If still queued/running, report the job ID and pending state. Inspect errors and issues. `sent`/`partial` mean email-provider acceptance; Kindle arrival is unverified. Explain partial notes without assuming an article was omitted. `failed`/`needs_review` require inspection before retry. History includes recent jobs and accepted articles; empty history does not authorize a resend.

If tools or authentication are unavailable, prepare independently and explain the required connection. Do not substitute email tools or custom delivery plumbing. See [the tool contract](references/tool-contract.md) for limits and advanced compatibility tools. Keep updates short and synchronize material project changes to the existing Trello record under the user's operating manual.
