# Additional offline native crash-boundary review

## Scope and verdict

From clean `839094b`, implement the first bounded part of the remaining [offline acceptance item](../../build-plan.md#current-m4-subscription-access-slices): admission/terminal/receipt/commit crash checks. Split out orphan reconciliation and repair budgets without marking those requirements complete. `/skill:review` applies correctness, readability, architecture, security and performance. This is an author review, not an independent-agent or cross-model audit.

**Verdict:** accept only the additional paused crash-boundary evidence. Final full verification below passes. Existing runtime code satisfies these tests; no production bug fix or full crash-parity acceptance is claimed.

## Findings

- **Important — resolved during author review:** the adapter's `afterTerminal` hook also runs on its error path. Merely reaching it could falsely certify a successful terminal. `test/helpers/pi-native.mjs:85` now supplies the adapter's failure flag; `test/helpers/pi-native-crash.mjs:58–60,74–75` refuses the new terminal/receipt checkpoints unless a validated successful stream actually delivered its terminal. Old callback consumers ignore the additional test-only argument.
- **Important — resolved during author review:** a string search could confuse the separate application action-result record with a native SDK tool-result checkpoint. `test/pi-native-boundaries.test.mjs:122–143` now inspects projected native model messages directly: exactly one assistant call and one non-error tool result with the exact call ID/content survive the committed-tool boundary; all earlier boundaries contain neither. The targeted final checks pass. The full suite is rerun after strengthening these assertions.
- **Suggestion — retained gate:** `test/pi-native-boundaries.test.mjs:85–90` requires no helper PID/home at each kill point, rather than treating eventual exit as orphan-recovery evidence. These tests intentionally cannot certify safety when a controller dies with a live helper or pending built-in refresh. The plan keeps orphan ownership/reconciliation and repair-budget exhaustion unchecked.
- No unresolved Critical/Important finding within this test-only slice. Full production compatibility and M4 remain unaccepted.

## Five axes

- **Correctness:** `test/pi-native-boundaries.test.mjs:33–172` kills the actual controller process at four deterministic checkpoints, reads real durable action rows before the kill, and reopens the actual catalogue/native SQLite twice. Pending model admissions cost exactly 120 seconds; an already retired model costs no second charge. No uncommitted assistant/tool call is invented. A tool checkpoint preserves its exact call ID, Unicode result and single action-result record. Pause, remaining allowance, attempt, repairs and exclusive issue ownership survive without model/tool dispatch. The fixed clock isolates recovery charges; it does not measure real inference quota or extend wall-clock guarantees.
- **Readability:** reuse the existing crash worker/provider and one small read-only catalogue helper. Four explicit boundary names and common assertions; no extra framework, generic crash harness or production abstraction.
- **Architecture:** the test-only faux alias still composes Pi Durable 1.3.0 with the reviewed installed ModelRuntime 1.4.0. Native storage remains the sole transcript; existing controller admission/finish/receipt/recovery code is unchanged. No new provider route, schema, lifecycle hook, tool executor or retry loop.
- **Security:** generated temporary catalogue/case directories and existing isolated helper homes only; synthetic in-memory provider/auth and fixed probe data. No real credentials, CLI storage, network, Docker, Sentry/GitHub or demonstration checkout operation. Read-only local SQL uses fixed statements. Test cleanup follows actual child exit; known helper PID/home observations come from the trusted test fixture, never model/user data. These are host-trusted fixtures, not an OS sandbox or generalized destructive-path API.
- **Performance:** four fixed subprocess cases, 20-second per-test ceiling and the existing 10-second helper ceiling. No sleeps to guess checkpoint ordering, retries, production queries or added runtime overhead. Focused new checks take about three seconds; the combined existing/new native checks take about eight seconds.

## Verification

- RED: all four tests fail against the original worker's unrelated `admitted` checkpoint (`.audit/pi-native-boundaries/red.txt`). This is missing test instrumentation, not a production regression.
- GREEN: all four pass after adding the precise checkpoints (`green.txt`).
- Conservative-accounting negative control: temporarily replace recovery's action charge with zero. The admission case fails at `0 !== 120000` (`mutation-accounting.txt`). Restore `src/controller.ts` byte-for-byte; `git diff --exit-code -- src/controller.ts` passes before the full run.
- After the terminal-success review correction, **25 native tests pass** with zero failures/cancellations/skips (`focused.txt`): new boundaries, existing streams/crashes and resource-release ordering.
- Final assertion review: **4 boundary tests pass**, zero failures/cancellations/skips (`focused-reviewed.txt`).
- The first full `npm run verify:all` passes **2,119 Node and 30 Rust tests** with exit 0 (`verify-all-before-final-assertions.txt` and `.exit`). This precedes the strengthened native model-message assertions and is not labeled final-source verification.
- Final-source `npm run verify:all`: exit **0**, **2,119 Node and 30 Rust tests pass**, zero failures/cancellations/skipped Node tests or ignored Rust tests. Lint, formatting, TypeScript/syntax checks and native compilation pass. Existing Rust dependency future-incompatibility notices remain. Raw log/status: `.audit/pi-native-boundaries/verify-all.txt` and `verify-all.exit`. All three executable-source identities still match `source-sha256.txt`; **236** local documentation links/anchors and `git diff --check` pass. Protected runtime/dependency paths match HEAD.

Accept only this evidence slice. Abrupt-parent orphan-resource reconciliation is the next pending plan slice; repair-budget checks, shared-file auth/native refresh disposal, separately approved real controlled tool use, production selection and M4 acceptance remain gated. Stop after this step.
