# Repeated rate-limited live fixture-read attempt review

## Scope

Five-axis author `/skill:review` of the single genuine `npm run --silent test:pi-native-read -- --run` attempt the operator requested as the next plan step after the [previous rate-limited attempt](native-read-ratelimit-review.md). The operator again anticipated a rate-limit error and asked that it be treated as completing this step. It is evidence-only: no executable, test or dependency change. No independent-agent/cross-model audit is claimed.

## Result

On clean `cbedd52`, the command runs **once** from **2026-10-31T20:10:12Z** to **20:10:13Z**. It exits **1** with the fixed verdict `sign-in-required`, one `model` progress marker, no tool marker and finite stage **`stream-http-429`**. The stage comes only from the status number seen by the supported `onResponse` hook (`prototypes/pi-native-diagnostics.mjs:17`). The provider limited the first model request a third time: about 3 minutes after the 20:07Z attempt and 16 minutes after the 19:54Z one. This is **not an OAuth rejection**. `read_fixture` did not execute and no fixture content was sent. The [finite evidence](native-read-ratelimit2-actual.json) records it.

The preceding review suggested waiting for the usage window to reset first. This attempt did not wait; the operator requested it expecting the 429. It therefore adds nothing about the reset time. Profile entry again needed no browser sign-in after a failed helper, consistent with the [dead probe-owner reclaim](probe-lease-reclaim-review.md); lease state was not inspected.

## Review

| Axis | Evidence and verdict |
|---|---|
| Correctness | Exit code, timestamps, stdout, stderr stage and commit are copied from `.audit/native-read-ratelimit2-attempt/`. Pre/post SHA-256 of the same 15 executable files match each other and the two earlier attempts' hashes. The record keeps the generic verdict separate from the finite stage and labels the step complete by operator disposition, not as a successful fixture read. |
| Readability | The evidence JSON keeps the shape of `native-read-ratelimit-actual.json`, so the three attempts compare field by field. Only the `limits` text differs. |
| Architecture | No code changes. The 429 is reported by the existing finite stage, without new handling. |
| Security | Only the status class leaves the helper. No headers, body, message, token, account or case path are recorded. No fixture bytes were sent. The failed native store and any lease left by the reaped helper stay private and untouched. |
| Performance | One provider request, then an immediate stop. There is no retry under the 429. |

**Critical:** none. **Important:** none in this evidence. **Suggestion:** three 429s within 16 minutes make further immediate attempts uninformative. The next attempt should follow a confirmed reset of the Codex usage window, for example after the operator checks usage status in the Pi or ChatGPT client.

## Verification

Before the attempt, focused `node --test test/pi-native-live.test.mjs test/pi-native-read.test.mjs` passes **55/55**, exit **0**, with zero failures, cancellations or skips. Sources are identical to the [reclaim review](probe-lease-reclaim-review.md)'s verified tree, which passed 2,324 Node and 30 Rust tests. That full run is prior evidence on unchanged code, not a fresh run. Focused output, logs/status, timestamps and hashes are under `.audit/native-read-ratelimit2-attempt/`.
