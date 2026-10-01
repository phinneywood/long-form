# Personal publication — implementation and evaluation contract

Decision input: Antonio's September 30, 2026 request. Current implementation is in GitHub; this is an engineering contract, not a parallel status document.

## Boundaries

The daily issue retains every deterministically eligible subscribed original. A finite featured reading path is a view of that complete issue, with remaining originals accessible under Further reading. Both paths have explicit ends and approximate reading time. Choosing a path does not consume, hide, or mark the other articles delivered. The exact complete edition is the default Kindle artifact. Tonight is a separate selected edition with a stated budget and no obligation to clear anything.

Persist editions, provenance, recorded reasons, original text and reading state. A single editor conversation receives the current edition, reading passage, explicit brief, actual subscription/library records and delivery history. Preference suggestions require a separate confirmation; conversation guidance is temporary. Fixed rules remain outside editable guidance. The agent cannot access arbitrary SQL or choose tenant identity.

Reuse the app API, worker, frozen outbox, OAuth and MCP. Web previews never send. An edition send uses the reviewed frozen artifact; retries reuse a tenant-bound request key and exact bytes. Submitted means provider acceptance, not Amazon arrival. Scheduled publications also become readable editions. Existing history with expired bodies is identified as metadata-only, never reconstructed as the original artifact.

## Observable acceptance checks

1. Thirty-plus eligible originals appear exactly once; the primary path fits a soft budget, deliberately diversifies topics/sources and has an end. Supplements remain bounded by the existing four-item rule. The raw feed is separate and unfiltered by AI.
2. Lead explanation refers to the actual title, recorded ordering/rationale, brief and provenance. Inferred explanations are identified; no invented historical reasons.
3. Temporary nighttime steering influences a subsequent nighttime composition. A durable change is proposed separately and only applied on confirmation; conflicting product instructions cannot drop daily originals.
4. Reading discussion receives original article text and an identified paragraph range; another-perspective requests search actual subscribed/library context with citations.
5. Nighttime composition requires 3–5 distinct originals, at least three sources, and 75–130% of the requested reading time measured from extracted text. The model chooses and sequences a deterministically feasible bundle. Exclude delivery repeats over 30 days and composed-edition repeats over 14 days. Reject infeasible results rather than silently changing the budget or adding unsuitable filler. Evaluate subject diversity and restorative/non-work character separately from those structural constraints.
6. Send selected edition through frozen production delivery; repeat request returns the same job and bytes. Failed extraction never becomes a false successful send. Partial status exposes preparation notes, including actual omissions; it does not imply missing articles. Edge workers preserve JPEG/PNG/GIF and existing publisher fallbacks. WebP-only conversion is explicitly omitted where WASM would exhaust the delivery runtime CPU budget, while original text remains intact.
7. Topic/history answers retrieve actual retained records and dates; bounded coverage is disclosed.
8. Sources → chronological feed → original reader works independently of models.
9. Model timeouts, invalid plans and unavailable keys leave originals/reader/raw feed accessible; deterministic daily delivery retains existing behavior.
10. Chromium/WebKit at 320/390 pixels: edition → reader → editor → reader position → edition → send/status. Screenshots, no overflow, no nested modal dependency.
11. Compare observed behavior against current official competitor capabilities; Kindle and global mobile chat excluded from the differentiation claim. Failure is recorded explicitly.

Run deterministic regression tests, adversarial fixtures, repeated model evaluation and real browser journeys. A passing mocked UI journey does not substitute for production editorial behavior or delivery.
