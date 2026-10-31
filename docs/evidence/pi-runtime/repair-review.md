# Review: offline native repair-budget parity

Scope: next M4 task after `2b0f520`, using `/skill:review` across all five axes. This is an author source/test review, not an independent-agent or cross-model audit.

## Findings

- No Critical or Important findings within this bounded offline contract.
- **Suggestion — scope limit:** `test/pi-native-repairs.test.mjs:217` kills at model admission after the second repair checkpoint, with pause persisted and no live helper. This is nonzero-counter crash evidence, not an exhaustive Cartesian product of repair counts and every earlier crash/resource/auth boundary. Do not claim production or full shared-auth parity from it.

## Five axes

| Axis | Review |
|---|---|
| Correctness | `test/pi-native-repairs.test.mjs:45` compares actual native check sequences, unchanged/changed candidates, counters, exact simulated elapsed charges, preserved messages and refusal to Continue/redispatch. Pause covers both initial and first-repair failure. Infrastructure produces no failed-validation receipt or additional cycle. The SIGKILL case at line 217 retains count 2 and a 120-second conservative model charge; one fresh resumed model validates candidate 3 and parks, without creating candidate 4. A mutation allowing an extra cycle fails with `3 !== 2`, proving the guard assertion is active. |
| Readability | One focused test module and one small crash worker follow neighboring native tests. `prototypes/pi-native-child.mjs:92` contains a fixed synthetic response policy, not a generic model-script injection system. The default probe behavior remains unchanged. |
| Architecture | `test/helpers/pi-native.mjs:63` passes only a trusted fixed-fixture selector. All actual model calls still traverse installed ModelRuntime 1.4.0 and validated transport; Pi Durable 1.3.0 remains sole native transcript/tool-loop owner. Catalogue/native budget logic is tested, not replaced or mocked. No production source, dependency or schema changes. |
| Security | `prototypes/pi-native-stream.mjs:26` allowlists the selector before resource creation/spawn, and the child validates it again at line 78. The generated empty home, allowlisted environment, forbidden fetch, synthetic in-memory credentials, source checks, bounded protocol and drainage remain intact. The selector supplies neither executable code nor arbitrary responses/paths. Tests remove only their own generated temporary roots. No real credentials, login, provider request, Docker or hosted operation. |
| Performance | Each helper still performs one stream and closes under its existing ten-second bound. Test polling and process-kill cases have explicit deadlines; unchanged production hot paths and no new runtime service/cache/retry loop. Context scanning is bounded by the existing protocol. |

## Verification

- TDD RED: three new checks fail with the old probe-only helper (wrong parked status/counter), retained in `.audit/pi-native-repairs/red.txt`. The fixed repair fixture makes them pass; `.audit/pi-native-repairs/green.txt` records the initial three-case run.
- Final focused run passes **4 tests**, including exact allowance assertions and actual SIGKILL/reopen, with no failures/cancellations/skips: `.audit/pi-native-repairs/focused.txt`.
- Negative control changes the controller's `repairs >= 2` exhaustion guard to `> 2` only through a process-local Node loader hook, without editing production files. The initial-failure case fails at its final counter assertion with **3 instead of 2**: `.audit/pi-native-repairs/mutation-exhaustion.txt`. The normal full suite uses no hook.
- The first full verification hit the tool's 240-second timeout while existing tests were still progressing. Its incomplete log is `verify-all-timeout.txt`; it is not a pass. The rerun preserves all repository commands/test timeouts.
- Final `npm run verify:all`: **exit 0; 2,144 Node and 30 Rust tests pass**, no failures/cancellations/skipped Node tests or ignored Rust tests. Includes TS/JS lint, formatting, type/syntax checks, Rust lint/format and native compilation. Existing Rust dependency future-incompatibility notices remain. Raw log/status: `.audit/pi-native-repairs/verify-all.txt`, `verify-all.exit`. All final executable-source identities match `source-sha256.txt`; all **248** local documentation links/anchors and whitespace/protected-path checks pass.

## Verdict and limits

Accept only this verified synthetic repair-budget evidence. No production fix was required. Explicit Retry/new-allowance behavior remains the existing controller contract; these checks deliberately use Continue, never Retry, so no reset is smuggled into restart evidence. Test outcomes/revisions are simulated, not real code repair or repository validation. Real shared-auth/native refresh disposal, offline-parity review, separately approved genuine controlled tool use, production selection and M4 acceptance remain gated. Stop after this slice.
