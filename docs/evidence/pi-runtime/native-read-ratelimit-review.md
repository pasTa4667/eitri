# Rate-limited live fixture-read attempt review

## Scope

Five-axis author `/skill:review` of the single genuine `npm run --silent test:pi-native-read -- --run` attempt the operator requested as the next plan step after the [post-reclaim 429](native-read-reclaim-review.md). The operator anticipated another rate-limit error and asked that it be treated as completing this step. It is evidence-only: no executable, test or dependency change. No independent-agent/cross-model audit is claimed.

## Result

On clean `7eea92b`, the command runs **once** from **2026-10-31T20:07:16Z** to **20:07:18Z**. It exits **1** with the fixed verdict `sign-in-required`, one `model` progress marker, no tool marker and finite stage **`stream-http-429`**. As before, the stage comes only from the status number seen by the supported `onResponse` hook (`prototypes/pi-native-diagnostics.mjs:17`). The provider rate- or usage-limited the first model request again, about 13 minutes after the 19:54Z attempt. This is **not an OAuth rejection**. `read_fixture` did not execute and no fixture content was sent. The [finite evidence](native-read-ratelimit-actual.json) records it.

Profile entry succeeded with no browser sign-in, although the 19:54Z helper had failed. That outcome is consistent with the [dead probe-owner reclaim](probe-lease-reclaim-review.md). Lease state was not inspected, so it is not direct proof of the reclaim.

## Review

| Axis | Evidence and verdict |
|---|---|
| Correctness | Exit code, timestamps, stdout, stderr stage and commit are copied from `.audit/native-read-ratelimit-attempt/`. Pre/post SHA-256 of the same 15 executable files match each other and the 19:54Z attempt's hashes byte for byte. The record keeps the generic verdict separate from the finite stage. It labels the step complete by operator disposition, not as a successful fixture read. |
| Readability | The evidence JSON keeps the shape of `native-read-reclaim-actual.json`. It adds only `sourceHashesMatchPriorAttempt` and `operatorDisposition`, so the attempts compare field by field. |
| Architecture | No code changes. The 429 is reported by the existing finite stage, without new handling. |
| Security | Only the status class leaves the helper. No headers, body, message, token, account or case path are recorded. No fixture bytes were sent. The failed native store and any lease left by the reaped helper stay private and untouched. |
| Performance | One provider request, then an immediate stop. There is no retry under the 429. |

**Critical:** none. **Important:** none in this evidence. **Suggestion:** a further attempt should follow a longer wait, or the operator should confirm the Codex usage window has reset. Two 429s 13 minutes apart suggest a usage limit, not a short burst limit, but this is not measured.

## Verification

Before the attempt, focused `node --test test/pi-native-live.test.mjs test/pi-native-read.test.mjs` passes **55/55**, with zero failures, cancellations or skips. Sources are identical to the [reclaim review](probe-lease-reclaim-review.md)'s verified tree, which passed 2,324 Node and 30 Rust tests. That full run is prior evidence on unchanged code, not a fresh run. Logs/status, timestamps and hashes are under `.audit/native-read-ratelimit-attempt/`.
