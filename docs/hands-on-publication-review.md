# Hands-on publication review — 5 October 2026

The publication remains subject to Antonio’s product acceptance. Delivery work is tracked in [PHI-5](https://linear.app/phinneywood/issue/PHI-5/complete-the-authenticated-product-walkthrough-and-acceptance-review); implementation is [PR 73](https://github.com/phinneywood/long-form/pull/73).

## Observed journey

Used the existing paused Resend validation account’s real stored editions and original article text in the deployed app’s developer replay. The account had nine nighttime editions and no daily edition. Walked Today → edition → original → editor → preferences → Library at phone width. The original presentation showed “Your first publication is waiting to take shape” despite the available editions; the latest original headlines were below a large generic introduction. Reading had competing page and article-frame scrollbars, with discussion below the article viewport. The editor put its question box after all conversation history. Nine generic nighttime titles on the same date made past editions hard to identify.

## Focused fixes

- Today leads with the latest daily edition, falling back to the available nighttime edition, its actual date, finite reading time, direct reading action and original headlines. Complete subscribed coverage remains accessible.
- The original stays in its script-free sandbox, sized to its complete content. The page scrolls once; Edition, Discuss and Save stay visible. Paragraph context and position survive discussion, reload and return navigation. Real article markup exposed a mismatch between DOM text and extracted text around inline tags; paragraph matching now normalizes that spacing and prefers an exact paragraph match.
- The editor’s question form comes before recent conversation; newest responses appear first. The actual paragraph in view can be inspected before asking. Durable preference confirmation remains separate. Basic bold emphasis in model answers renders after HTML escaping.
- Past editions show their lead headline. The chronological feed has a hash route so reload and browser history keep that view. Failed prepare/send requests restore their buttons instead of throwing a second error.

## Repeatable browser workflow

`/developer` exists only in protected Vercel preview builds. Production builds exclude both developer files. Capture a short-lived session belonging to the existing **paused validation account** with:

```sh
LF_QA_TOKEN_FILE=/private/path/session LF_QA_OUT=test-results/account-snapshot.json node scripts/capture-qa.mjs
```

The capture validates the account before fetching its editions, reading/library, discussion, delivery status and source feed. It captures originals for the newest edition by default; set `LF_QA_EDITIONS` to explicitly include more. Keep sessions and snapshots private and uncommitted. Revoke the temporary session after capture.

Open the preview’s developer pane, choose or paste the snapshot, and switch 320 / 390 / 1440 widths. The pane uses the current app code, synthetic credentials, memory storage and replay-local reading state. Reset discards local changes. Every other mutation, including editor submissions, preferences and delivery, returns a visible “No request was sent” failure. Empty-edition and API-failure scenarios are available. A restrictive connection policy blocks live requests.

This workflow reviews authentic stored content and app navigation without weakening normal account authentication. It does **not** validate a new model response or a production delivery; those require separate live tests on the validation account. It does not copy the personal account’s reading or discussion history. Automatic approval review rejected the attempted personal snapshot as broader than the authorized app inspection, so that session was revoked and the review continued with the isolated validation account.

## Verification and remaining acceptance

Browser regression covers complete versus featured originals, page scrolling, sticky discussion, actual paragraph context, save/return/reload, preference confirmation, source feed reload, exact-send review, status wording, Library, nighttime-only Today and API recovery. Developer regression verifies zero outgoing API requests, isolated storage, local save/reset and blocked sends. Build regression verifies the developer pane is absent from production and present only in previews. Existing interface/database and settings/onboarding checks are retained.

The manual replay initially omitted embedded image data to make cloud-browser loading reliable. The second pass retained the frozen images in the Science News and JSTOR originals while omitting images from the larger Aeon original; complete media acceptance remains open. A fresh live editor request on the paused validation account explained the first two Science News paragraphs, cited the correct edition/original, and separated the article’s claims from interpretation. It did not compose or send a new edition. Quality across repeated fresh editorial composition and the personal account journey remain unaccepted. Existing Kindle reliability repairs are not reopened by this review.
