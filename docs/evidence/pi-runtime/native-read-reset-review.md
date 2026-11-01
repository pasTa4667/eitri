# Post-reset live fixture-read review

## Scope and runtime result

Five-axis author `/skill:review` of the operator-approved single live fixture-read attempt and its evidence-only documentation update. The operator confirms the usage-window reset; no independent-agent/cross-model audit or independent usage inspection is claimed.

On clean `5bb29d4`, `npm run --silent test:pi-native-read -- --run` runs **once**, **2026-11-01T11:45:04Z–11:45:11Z**, exits **0**, and returns **`native-read-pass`**. The [finite evidence](native-read-reset-actual.json) retains the exact terminal: two model requests, one fixed source read, streaming, verified digest/result, Pause/reopen/Continue, preserved budget and disposal. Pre/post hashes of the same 15 executable files match each other and the previous attempt. No executable, test or dependency change.

## Findings

**Critical:** none identified in this documentation change.

**Important — unresolved verification blocker:** `test/pi-native-boundaries.test.mjs:138`. Full `npm run verify:all` exits **1**: **2,323/2,324 Node tests pass**, with no cancellations/skips. The native terminal SIGKILL test observes an assistant tool call with `stopReason: aborted` where it requires no uncommitted assistant transcript. A separate focused run passes all four boundary tests; that does not clear the full-suite failure or establish its cause. Investigate and deterministically reproduce the crash/Pause/terminal ordering before broader lifecycle acceptance; do not weaken the assertion, call it harmless flakiness, or claim a green suite. No lifecycle fix is included in this bounded live-attempt checkpoint.

**Suggestion:** keep any crash-boundary correction in its own tested slice; do not repeat genuine inference to debug a synthetic lifecycle failure.

## Five axes

| Axis | Evidence and assessment |
|---|---|
| Correctness | The launcher accepts success only after exact progress/terminal validation (`scripts/test-pi-tool.mjs:169–176`). Native assertions verify persisted result, unchanged paused counters, correlated tool result, digest acknowledgement and final no-redispatch reopen (`prototypes/pi-native-live.mjs:158–224`). The live probe passes, but the separate full-suite failure remains explicitly open. |
| Readability | Preserve the earlier finite-evidence shape; distinguish operator-reported reset, observed runtime success and incomplete overall verification. |
| Architecture | Reuse the existing opt-in harness. No production adapter selection or expanded source-tool authority; M4 remains open. |
| Security | Only the approved fixed file travels through the admitted tool. No raw source, model output, credentials, HTTP payloads or private case contents enter checked-in evidence. Successful-store removal follows validated reopen and controller close (`prototypes/pi-native-live.mjs:227–231`); no manual cleanup or auth repair. |
| Performance | Exactly two model requests and one read, completing within seven timestamped seconds; unchanged helper/command bounds, no genuine retry. |

## Verification and disposition

Before inference, focused live/read regressions pass **55/55**. Fresh TypeScript lint, formatting and type/syntax checks pass. The first full-verification command is terminated by the tool's **240-second** timeout; a second with sufficient allowance completes the Node suite with the failure above. Because that chain stops before Rust, Rust lint/format and native compilation/tests are run separately: **30/30** pass; existing dependency future-incompatibility notices remain. The isolated boundary check passes **4/4**, not a replacement full-suite result. No RED/GREEN addition is appropriate for documentation-only changes.

Finite logs, both full-verification outputs, isolated test output and source hashes are under `.audit/native-read-reset-attempt/`. Record the successful bounded live fixture read, not full-suite/M4 acceptance. Stop here; the unresolved crash-boundary verification needs a separate follow-up before further integration.
