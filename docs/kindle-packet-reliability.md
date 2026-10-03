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

References: [Supabase CPU limits](https://supabase.com/docs/guides/troubleshooting/edge-function-cpu-limits), [runtime limits](https://supabase.com/docs/guides/functions/limits), [existing reliability task](https://trello.com/c/WOECHU0K), [LangGraph documentation](https://docs.langchain.com/oss/python/langgraph/overview).
