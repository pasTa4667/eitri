# Post-reclaim live fixture-read attempt review

## Scope

Five-axis author `/skill:review` of the single genuine `npm run --silent test:pi-native-read -- --run` attempt that the operator approved after the [dead probe-owner reclaim](probe-lease-reclaim-review.md). It is evidence-only: no executable, test or dependency change. No independent-agent/cross-model audit is claimed.

## Result

On clean `eabb58d`, the command runs **once** from **2026-10-31T19:54:15Z** to **19:54:17Z**. It exits **1** with the fixed verdict `sign-in-required`, one `model` progress marker, no tool marker and finite stage **`stream-http-429`**. That stage comes only from the status number seen by the supported `onResponse` hook (`prototypes/pi-native-diagnostics.mjs:17`). The first model request passed profile entry, runtime creation and model selection, and the provider answered **HTTP 429**. This is a rate- or usage-limit response, **not an OAuth rejection**: credentials were accepted far enough for the provider to rate the request. `read_fixture` did not execute and no fixture content was sent. The [finite evidence](native-read-reclaim-actual.json) records it.

## Review

| Axis | Evidence and verdict |
|---|---|
| Correctness | Exit code, timestamps, stdout, stderr stage and commit are copied from `.audit/native-read-reclaim-attempt/`. Pre/post SHA-256 of the 14 executable files from the earlier fixture-read run plus `prototypes/pi-profile-login.mjs` match. The record keeps the generic verdict separate from the finite stage and does not claim the 18:54Z cause, a request count or which limit applied. |
| Readability | The evidence JSON keeps the shape of `native-read-actual.json`, so the two attempts compare field by field. |
| Architecture | No code changes. The reclaim did not need to act on a lease to reach the provider. Whether a lease was present before the run is not inspected. |
| Security | Only the status class leaves the helper; no headers, body, message, token, account or case path are recorded. No fixture bytes were sent. The failed native store and the lease left by the reaped helper stay private and untouched. |
| Performance | One provider request, then an immediate stop; no retry under the 429. |

**Critical:** none. **Important:** none in this evidence. **Next-step note:** a 429 calls for waiting until the Codex rate or usage window resets, not for signing in. Thanks to the reclaim, the next attempt needs no browser sign-in. It still needs separate approval.

## Verification

The attempt runs on sources identical to the [reclaim review](probe-lease-reclaim-review.md)'s verified tree: 128 focused and 2,324 Node/30 Rust passing tests. These are prior evidence on unchanged code, not a fresh run. Logs/status, timestamps and hashes are under `.audit/native-read-reclaim-attempt/`.
