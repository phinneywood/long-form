# Kindle packet reliability — October 3, 2026

Production one-off packet attempts were terminated with `CPUTime` at approximately 2,000 ms, before a frozen outbox or provider submission. The one-off path previously extracted up to three articles concurrently, processed images and packaged the issue in a single invocation. Recurring publications already used preparation continuations.

Original URL packets now prepare and checkpoint one article per invocation through the existing tenant-scoped `checkpoint_digest_preparation` RPC. Checkpoints bind the packet name and ordered URLs, retain a shared image byte budget, and serialize prepared binary assets explicitly. Completed articles are reused after failure. Successful continuations do not consume failure attempts. EPUB creation and QA begin only after every original is saved. Queue processing stops after one preparation or packaging stage; remaining selected work is kicked separately.

The packet path applies the recurring publication safeguard against costly WebP transcoding. Compatible publisher images are retained; unsupported conversions are reported as media warnings while keeping the authored text. This can produce an honest `partial` result and does not indicate missing articles. The existing frozen outbox, provider idempotency key, receipt reconciliation and ambiguous-send cutoff remain in place. No schema, account, schedule, authentication or UI change is required.

Live-source inspection also found that Readability discarded the code examples inside Mintlify's authored documentation container. Extraction now uses `#content.mdx-content` directly before applying the existing sanitizer. Other pages retain the existing Readability path. On snapshots of the five official LangGraph pages, every original preformatted block was preserved exactly:

| Original | Preserved code blocks |
| --- | ---: |
| LangGraph overview | 3 |
| Thinking in LangGraph | 12 |
| Workflows and agents | 19 |
| Persistence | 3 |
| Interrupts | 33 |

Regression coverage exercises ordered complete originals, binary checkpoint round-trips, conversion warnings, failure during checkpoint writes, reconciliation after provider acceptance, input identity mismatch, and invocation boundaries. Documentation extraction checks preserve code, headings and the final authored paragraph while excluding navigation and controls.

Live provider acceptance, Amazon mail-server receipt, Kindle arrival and the iOS ChatGPT host are separate observations. Passing mocked delivery or browser tests does not establish those outcomes. Production retry results are recorded in the release pull request and the existing reliability Trello card.

The live regular-Chat structured-document check found an older database validator still rejecting `markdown`, despite API/worker support. A follow-up migration aligns the queue's accepted formats with `text`, `html` and `markdown`. Its Postgres regression first reproduces the rejection, applies the migration, and verifies exact Markdown storage, idempotent reuse, unsupported-format rejection and unchanged backend-only execution grants.

References: [Supabase CPU limits](https://supabase.com/docs/guides/troubleshooting/edge-function-cpu-limits), [runtime limits](https://supabase.com/docs/guides/functions/limits), [existing reliability task](https://trello.com/c/WOECHU0K), [LangGraph documentation](https://docs.langchain.com/oss/python/langgraph/overview).

## Publisher failures and image URL recovery

A later original-packet attempt exposed two distinct publisher conditions: an HTTP 403 response and an HTTP 200 browser-verification page. Neither contains a usable original article. Previously the worker discarded the typed HTTP cause while adding article-position context, then treated every ordinary error as retryable (up to three attempts with ten-/twenty-minute delays).

Article context now preserves its cause. Permanent HTTP/content failures stop immediately with an explicit error; transient HTTP failures retain the three-attempt cap and respect a longer publisher Retry-After. Browser-verification pages are recognized before Readability, never packaged, and never bypassed. Unknown delivery/receipt failures retain the existing frozen-payload reconciliation behavior. Claim and failure-state database writes are checked for errors.

Encoded publisher image URLs previously swallowed the wrapper's outer width/quality parameters, producing paths such as image.png&w=3840&q=75 and HTTP 400 responses. Query parsing now separates wrapper options from the encoded publisher URL, preserving the publisher's own query string and existing absolute URLs. URL validation, image limits and unsupported-conversion warnings remain unchanged.

When PMC actually returns article HTML, its explicitly labelled authored section is preserved, including references and tables. Scholarly citation metadata supplies the title, all listed authors and publication date. This is not a CAPTCHA workaround: another accessible original publisher URL is required when the host blocks the worker.

Regression coverage includes wrapped permanent/transient HTTP errors, long HTTP-200 verification pages, actual worker terminal/retry states, zero submission on extraction failure, Retry-After, image URL queries, scholarly structure, and existing checkpoint/frozen-outbox/provider-receipt behavior. Deployment and live delivery observations are recorded in the release pull request; provider acceptance is not proof of Kindle arrival.
