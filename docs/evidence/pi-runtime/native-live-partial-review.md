# Live-native partial-event compatibility review

## Scope

Five-axis author `/skill:review` of the next narrow live-adapter fix after `aa47add`. No independent-agent/cross-model audit is claimed. Changes affect the actual live helper, its focused snapshot seam and test transport; the offline adapter, common-subset protocol, production source, auth logic and dependency versions/lockfile remain unchanged. Generated synthetic credentials and intercepted HTTP exercise the live command path without accessing the operator's profile or running genuine inference.

## Review

| Axis | Evidence and verdict |
|---|---|
| Correctness | `prototypes/pi-native-live-events.mjs:7-21` snapshots immediately and projects only string `partialJson` on the indexed `toolCall` of start/delta events. `prototypes/pi-native-live-child.mjs:123-159` retains metadata aliasing, immediate receiver validation, terminal/result equality, exact fixed-tool arguments and correlated result checks. `test/pi-native-live-events.test.mjs:38-101` verifies detached Unicode partials, unchanged argument data/terminals and refusal of delta/terminal mismatch or duplicate terminal. `test/pi-native-live.test.mjs:123-165` completes actual controller/native Pause/reopen/Continue with the paced SDK stream, exactly one tool and two disposed helpers. `:167-206` cancels an open normalized start without delivering a terminal, preserving the uncertain synthetic lease. |
| Readability | The 22-line snapshot module states the single pinned-SDK exception explicitly. It is not a general sanitizer or new schema/conversion framework. Event diagnostics remain next to the conversion/validation boundaries. |
| Architecture | The compatibility exception belongs only to the live helper before the existing shared strict receiver; no common protocol expansion, SDK patch, credential store, second loop, persistence schema, production provider or new dependency. `test/fixtures/pi-tool-preload.mjs:195-224` advances synthetic SSE only after each helper-written start/delta frame, avoiding reliance on timing or SDK finalization. Native remains the sole tool/transcript owner. |
| Security | `prototypes/pi-native-live-events.mjs:8-17` validates original JSON, well-formed strings and bytes before scratch omission, requires a string and never mutates SDK objects. `test/pi-native-live-events.test.mjs:103-163` refuses malformed/oversized buffers, unknown/namespace/custom-tool fields and scratch outside the one permitted location. `:165-186` keeps stale identity/epoch/sequence/route rejection authoritative. Terminal scratch stays unsupported; an argument key named `partialJson` is preserved. No raw event/error, account identity, credential or private case path enters diagnostics. Profile leases, request ceilings and tool admission are unchanged. |
| Performance | One existing snapshot plus an additional bounded JSON validation/encoding pass per event; no polling, retry, extra model request or unbounded collection is introduced in runtime code. Original per-event byte validation precedes omission; shared normalized-frame cumulative limits, fixed helper/command lifetimes and disposal ordering remain. This is a compatibility correction, not a measured performance optimization. |

**Critical:** none. **Important:** none unresolved within this bounded fix. **Suggestion:** none required. Approve the compatibility save point only, **not successful genuine live-native acceptance or production selection**.

## Source and test evidence

The already source-pinned installed Pi AI `dist/api/openai-responses-shared.js` creates `partialJson` at `:431-447`, updates it at `:611-617`, and deletes it in place before tool-call end at `:673-687`. The source-pinned event stream queues object references. The [preceding diagnosis](native-live-event-review.md#source-backed-diagnosis) records these facts and the reproducible strict-schema rejection; no source pin or package is changed here.

The paced transport now gates its delta on a validated/written start, and its final batch on a validated/written delta. Both intermediate snapshots must therefore cross the actual live helper while scratch still exists. It cannot pass merely because a fully buffered terminal mutated the shared SDK object first. The unchanged direct strict-receiver scratch-refusal test remains at `test/pi-native-live.test.mjs:243-293`; only the live compatibility seam knows the exception. Snapshot refusal assertions run outside SDK callbacks, and integration success requires the complete native result, not a swallowed fetch assertion or an expected generic failure.

## Verification

- RED unit: absent snapshot module, exit **1**; `.audit/native-live-partial-fix/red-unit.txt` and `red-unit.exit`.
- RED integration: `node --test --test-name-pattern='paced SDK' test/pi-native-live.test.mjs`, exit **1**; native reaches Needs attention instead of expected Pause because the uncorrected helper rejects the intermediate event. Logs: `red-integration.txt`, `red-integration.exit` in the same directory.
- Initial GREEN: **34/34 passing**, exit **0** (`focused-initial.txt`, `focused-initial.exit`). Strengthen coverage with the complete terminal/argument-data and delta-mismatch check, then format the changed executable files.
- Final focused: `node --test test/pi-native-live-events.test.mjs test/pi-native-live.test.mjs`, **35/35 passing**, exit **0**, zero failures/cancellations/skips. Logs: `focused.txt`, `focused.exit`.
- Full `npm run verify:all`: exit **0**, **2,285 Node and 30 Rust tests passing**, zero failures/cancellations/skipped Node tests or ignored Rust tests. Lint, formatting, TypeScript/syntax checks and native compilation pass. Existing Rust dependency future-incompatibility notices remain. Logs: `verify-all.txt`, `verify-all.exit`.
- Final executable/dependency identities: `.audit/native-live-partial-fix/source-sha256.txt`. No executable edits follow the successful full verification.

Stop after this fix. No genuine attempt, credential/lease repair, sign-in, raw private event/case inspection, remediation worker execution/source edits, hosted mutation or publication occurs. The earlier genuine failure's exact event/check remains unproven and other live incompatibilities may remain. A later bounded genuine attempt still needs explicit operator approval; successful live-native acceptance, M4 and production selection remain open.
