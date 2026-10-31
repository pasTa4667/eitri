# Live-native event-validation diagnosis review

## Scope

Five-axis author `/skill:review` of the next local live-path diagnosis after `91fae2e`. No independent-agent/cross-model audit is claimed. This changes the actual live helper's finite diagnostics, not the offline adapter or production provider. Tests use generated synthetic profiles and intercepted HTTP/SSE. No genuine inference, credential/lease repair, private-event/case inspection or publication occurs.

## Review

| Axis | Evidence and verdict |
|---|---|
| Correctness | `prototypes/pi-native-live-child.mjs:114-133` labels receiver failures with a fixed event type, separately from metadata aliasing and pipe writes. `:156-159` restores terminal-validation location after sending the terminal frame. `test/pi-native-live.test.mjs:123-150` holds the actual SDK SSE path open at a tool-call start, requires one model boundary, no tool/retry, the specific diagnostic, helper exit/home removal, retained failure store and blocked profile lease. `:187-237` isolates rejection to the scratch field with an otherwise identical synthetic receiver input. Validation itself is unchanged; this is diagnosis, not a fix or proof of the historical genuine event. |
| Readability | `prototypes/pi-native-diagnostics.mjs:3-43` keeps supported event types and finite stages together. Stage assignments sit at their checks; no error-text parsing or guessed OAuth cause. |
| Architecture | Existing helper IPC, adapter drainage and launcher validation carry the new stages unchanged. No new transport, transcript, runtime, credential store, schema, dependency or production route is added. Changes stay in the live-path prototype and its test fixtures. |
| Security | `prototypes/pi-native-diagnostics.mjs:35-43` maps unknown/non-string types to the generic stage and still requires exactly one allowlisted field. `test/pi-native-live.test.mjs:152-185` refuses private/type-injection/extra-field data; `:286-335` exercises launcher acceptance of the fixed new stage and retains existing refusal/leak checks. No raw event, thinking/text, result, credential, identity or private path is added to diagnostics. Strict unknown-field rejection remains intact. |
| Performance | The only new per-event work is an eleven-element fixed lookup; diagnostic count/byte bounds and existing deadlines/reaping remain unchanged. The held-open test waits for no timer or terminal mutation to trigger rejection. No retry, additional inference request, polling service or optimization claim. |

**Critical:** none. **Important:** none introduced or unresolved within this diagnostic scope. **Suggestion:** none required. Approve local diagnosis/instrumentation only, **not live-native acceptance**.

**Pre-existing live blocker, not waived:** `prototypes/pi-stream-protocol.mjs:77-88` rejects SDK scratch fields in partial tool-call blocks. A separately scoped compatibility fix must preserve strict bounds, unsupported-field refusal, tool/result semantics and terminal/correlation checks; do not broadly strip unknown data or wait for SDK mutation. Another genuine attempt needs explicit approval.

## Source-backed diagnosis

The source-pinned installed `node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js` under `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/`:

- `:431-447` creates a tool-call block containing `partialJson`, then pushes `toolcall_start` with that same output object.
- `:611-617` updates the scratch buffer and pushes the same partial during argument deltas.
- `:673-687` deletes `partialJson` in place before `toolcall_end`.

Its `dist/utils/event-stream.js:41-50` queues/delivers event references; `:65-80` yields them without snapshotting. Both files are already included in `prototypes/pi-stream-source.json`; no source pin or installed package changes. The live helper snapshots at consumption (`prototypes/pi-native-live-child.mjs:126`), so fully buffered fixtures can mask scratch fields after finalization. The held-open SSE fixture (`test/fixtures/pi-tool-preload.mjs:195-213`) prevents later finalization/error cleanup from masking the intermediate shape. The minimal receiver comparison proves the strict schema's scratch-field rejection independently of SDK exception handling.

This establishes a reproducible incompatibility on the real live-command code path. It does **not** establish the exact event/check or HTTP count of the earlier genuine failure, and does not exclude other live incompatibilities. No private data is read to strengthen that claim.

## Verification

- RED: the new held-open integration test reports only the old generic stage; the finite-stage test rejects the missing new stages. Two failures, one passing strict-receiver characterization. Log/status: `.audit/native-live-event-diagnosis/red.txt`, `red.exit` (**1**).
- Initial full focused run has one outdated malformed-stream expectation: the same failure is now precisely `event-validation-toolcall_start`. Update only that stage expectation; do not relax protocol validation. Log/status: `focused-initial.txt`, `focused-initial.exit` (**1**) in the same audit directory.
- Final focused suite: `node --test test/pi-native-live.test.mjs`, **29/29 passing**, exit **0**, zero failures/cancellations/skips. Four new checks cover held-open SDK partials, finite mapping/refusal, isolated scratch-field refusal and launcher output. Log/status: `focused.txt`, `focused.exit`.
- Final `npm run verify:all`: exit **0**, **2,279 Node and 30 Rust tests passing**, zero failures/cancellations/skipped Node tests or ignored Rust tests. Lint, formatting, TypeScript/syntax checks and native compilation pass. Existing Rust dependency future-incompatibility notices remain. Log/status: `.audit/native-live-event-diagnosis/verify-all.txt`, `verify-all.exit`. Executable/dependency source identities match `.audit/native-live-event-diagnosis/source-sha256.txt`; no executable edits follow this verification.

Stop after this diagnosis. Real credentials/leases and failed private native data remain untouched. No compatibility repair, new live attempt, worker execution, production enablement or M4 acceptance is performed.
