# Controlled Pi tool turn — five-axis author review

## Scope and verdict

Use `/skill:review` for the operator-approved next [M4 plan item](../../build-plan.md#current-m4-subscription-access-slices), against the [bounded probe contract](../../pi-controlled-turn.md). Review tests first, then the implementation and verification. This is an **author review**, not an independent-agent/cross-model audit.

**No remaining Critical or Important implementation findings within this standalone contract.** One genuine dedicated-profile attempt passes, with captured exit 0. Do not extend that verdict to native/controller integration, arbitrary tools or M4 acceptance.

## Findings

- **Critical:** none found.
- **Important:** none remaining within scope. The first installed-SDK synthetic success test exposed a test-fixture mismatch: this model declares tools through `additional_tools` transcript items, not top-level `body.tools`. Correct the fixture, not the provider or model compatibility flags. The initial multi-test run timed out because the synthetic cancellation fetch ignored abort and the test runner's SIGTERM timeout was handled by the child. The repaired fixture observes abort; the test runner has a SIGKILL backstop. Production keeps its 120-second hard lifetime. These were offline failures, not live-provider failures.
- **Suggestion / later integration gate:** `scripts/test-pi-tool.mjs:18–44` runs a disposable sole credential process, not the native adapter. Keep `prototypes/pi-native-stream.mjs` synthetic-only until a separately scoped implementation joins actual credential use to controller admission/receipt/resource reconciliation. Do not infer live Pause/restart/expiry parity from this standalone success.
- **Suggestion / documented limit:** `prototypes/pi-controlled-turn.mjs:57–64` supplies `maxTokens: 256`, but the pinned Codex builder does not transmit an output-token ceiling. Keep the real bound documented as the whole-process deadline plus consumed-event limits, not a guaranteed server token cap. No compatibility override or custom payload workaround is added.

## Five axes

| Axis | Assessment |
|---|---|
| Correctness | `prototypes/pi-controlled-turn.mjs:18–123` requires exact OAuth metadata and physical route, a terminal one-tool call with empty arguments, original call-ID result correlation, and a second terminal text acknowledgement of a random 128-bit value. No further tool is executed. Tests cover wrong/multiple tools, extra args, missing/late/oversized events, absent text deltas, wrong acknowledgement, denial and cancellation before either model dispatch. |
| Readability | A small fixed-turn function separates protocol expectations from the disposable CLI/process boundary. No configurable prompt/tool/provider framework. Progress labels are advisory; only the post-close finite report is a pass. |
| Architecture | `scripts/test-pi-tool.mjs:24–40` uses public installed ModelRuntime plus Pi-owned built-in OAuth/persistence. `prototypes/pi-profile-login.mjs:36–60` reuses the existing private-path/lease implementation, without initializing missing probe paths. Login retains its initialization behavior. No controller/native/operator/worker changes, dependency upgrade, second agent loop, RPC prompt or custom credential store. |
| Security | `scripts/test-pi-tool.mjs:52–73,92–136` selects OS home, strips inherited secrets/config/injection, hides raw child stderr, bounds and validates stdout, waits for closure and removes only empty owned scratch. Metadata rejects API-key/foreign entries before command-valued key resolution. `prototypes/pi-profile-login.mjs:76–106` permits explicit fresh-login recovery only for dead known version-2 sole-process owners; live/reused PIDs, native records and ambiguity block. No automatic token retry, lock removal, process signaling by recovery, case-budget reset or raw transcript persistence. |
| Performance | Exactly two explicit SSE model requests, zero provider retries and one no-input random-string tool; no shell, repository, Docker or integration operation. 120-second hard child lifetime/125-second parent backstop, 4,096 consumed events and 1 MiB serialized-event ceiling per stream, 4 KiB parent protocol limit. The SDK parser/network allocation is trusted code, not bounded by a sandbox or these post-parser checks. |

## Verification

- RED: `.audit/pi-controlled-turn/red.log` records the new focused test failing on the missing implementation module.
- `.audit/pi-controlled-turn/installed-initial.log` preserves the incomplete initial run; the test-fixture mismatches above are not counted as passes.
- Final full **`npm run verify:all` exits 0**, with **2,224 Node and 30 Rust tests passing**, zero failures/cancellations/skipped Node tests or ignored Rust tests. Lint, formatting, TypeScript/syntax and Rust compilation pass. Existing Rust dependency future-incompatibility notices remain. `.audit/pi-controlled-turn/verify-all.log` retains raw output; it includes all **32 new tests** plus the existing sign-in and native lifecycle suites. Only Markdown/evidence JSON is edited afterward.
- One actual `npm run test:pi-tool -- --run` exits **0**, after progress `model → tool → model` and finite report `tool-turn-pass`, `requests: 2`, `toolExecutions: 1`, `streamed: true`, `resultVerified: true`. `.audit/pi-controlled-turn/actual.log` and `actual-status.txt` retain the finite terminal output/status. The [committed report](controlled-turn-actual.json) records exact executable/test/configuration SHA-256 identities. No raw model text, random tool output, account identity, credentials or provider errors are retained.

## Limits and stop point

The real run establishes one selected-route inference/tool-result success through the dedicated profile. Pi may refresh credentials internally; real refresh, cancellation and fresh-login recovery are **not independently observed** by that success. Synthetic built-in refresh/error/cancellation and actual process SIGKILL remain offline proof. No claim of Enterprise policy certification, global-settings byte comparison, HTTP-payload audit, independent-client auth concurrency, power-loss durability or lossless token rotation.

This unit is complete. Production dispatch, real native/controller integration, M4 acceptance, publication, live remediation and later plan steps remain open/disabled. No further live attempt or integration follows automatically.
