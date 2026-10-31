# Offline case-isolation and expiry review

## Context and verdict

From clean `9535f1c`, implement only the next listed [offline acceptance slice](../../build-plan.md#current-m4-subscription-access-slices): two sequential cases and eligible terminal-case expiry. `/skill:review` is applied across all five axes below. This is an **author review**, not independent-agent or cross-model assurance.

**Verdict:** approve this test-only acceptance increment. No unresolved Critical or Important finding within its scope. Existing runtime behavior satisfies these checks; no production fix, new adapter authority, full compatibility parity or M4 acceptance is claimed.

## Findings

| Severity / status | Finding and recommendation |
|---|---|
| **Important — Testing correctness / resolved** | The initial test compared the other case's entire projection unchanged after restart, incorrectly requiring an unchanged epoch. Existing `src/controller.ts:2172` increments recovery epochs. `test/pi-native-isolation.test.mjs:193–203` now requires exactly the expected increment per reopen while comparing every other field/message unchanged. Recovery code is unchanged; the initial failure is not evidence of a runtime defect. |
| **Suggestion — Scope / retained gate** | The synthetic global-auth file at `test/pi-native-isolation.test.mjs:57–62` is a deletion-boundary sentinel, not the SDK's credential store. Keep built-in provider-auth errors/cancellation/refresh serialization and cross-process shared-auth safety open; file preservation does not establish them. |
| **Suggestion — Scope / retained gate** | `test/pi-native-isolation.test.mjs:69–81,207–210` verifies cooperative helper disposal and empty generated homes for sequential work, not abrupt-parent orphan reconciliation or simultaneous execution. Keep those separate acceptance gates; no production route is selected. |

## Five axes

- **Correctness:** `test/pi-native-isolation.test.mjs:105–159` checks separate issue/context/case/action/tool-call/projected-message IDs, exact case-specific Unicode tool results, one probe and two installed-SDK streams per case, and different SQLite inodes. Lines 160–228 check unfinished-case cleanup refusal, explicit terminal cleanup, retention immediately before/at 30 days, startup expiry, preserved other-case projection/inode, guarded duplicate investigation, refused expired notes and reopen without new work. Lines 229–251 check empty pending deliveries/actions and absence of private probe-result text from catalogue value tables. Two temporary mutations fail for the intended reasons: foreign context and delayed expiry. Both source files are restored to HEAD bytes.
- **Readability:** one bounded parameterized test for maintenance, startup and explicit cleanup; reuse the existing native fixture provider and public controller commands. No new framework, runtime fixture abstraction or dependency.
- **Architecture:** the catalogue and native SQLite retain their existing authority. The installed SDK is used only through the existing test-only faux alias and validated synthetic helper. No controller/native/provider/tool implementation, schemas, manifests or production dispatch changes.
- **Security:** private generated fixtures only; no real credential-store access, hosted requests, inference or Docker. The synthetic auth sentinel is explicitly not used as a credential. Helper homes are empty before removal and absent afterward; no persistent helper transcript is added. Catalogue queries use fixed table names from a test-local literal list, not untrusted SQL identifiers. Cleanup targets only test-created paths. This is application-level deletion evidence, not forensic erasure or a sandbox claim.
- **Performance:** four bounded streams per test, sequential helpers, finite polling/test deadlines and temporary SQLite connections closed in `finally`. No production cost or unbounded concurrency; three cases add roughly six seconds in the focused run. Existing installed-source identity prerequisites remain binding.

## Verification

- Initial run: three failures from the incorrect post-reopen epoch expectation; preserved in `.audit/pi-native-isolation/initial.txt`. Correct the test expectation, not runtime behavior. Initial corrected run: **3 pass** in `green.txt`.
- Negative controls: temporarily inject the first case request as a user message into the second case's model context; the maintenance test fails with `foreign issue context`. Temporarily change maintenance retention from `>=` to `>`; the same test fails with `ready !== expired` at the exact boundary. Logs/status: `foreign-context-red.txt/.exit` and `expiry-boundary-red.txt/.exit`. These are deliberate mutation failures, not pre-existing production defects.
- Restored focused suite: **24 pass**, zero failures/cancellations/skips, in `.audit/pi-native-isolation/focused.txt` and `focused.exit`. Subsequent review strengthens same-case epoch/tool-call binding and catalogue scans; final full verification below includes those assertions.
- Final executable-source `npm run verify:all`: exit **0**, **2,102 Node tests and 30 Rust tests pass**, zero failures/cancellations/skipped Node tests or ignored Rust tests. Lint, formatting, TypeScript/syntax checks and native compilation pass. Existing Rust dependency future-incompatibility warnings remain. Log/status: `.audit/pi-native-isolation/verify-all.txt` and `verify-all.exit`; all six selected source identities match `source-sha256.txt` after verification.
- Documentation: **225** local links/anchors pass (`.audit/pi-native-isolation/links.txt`); `git diff --check` passes. Protected production/helper/dependency paths match HEAD.

The plan checks off only sequential isolation/expiry. Remaining crash/repair-budget boundaries, abrupt-parent orphan ownership/reconciliation, built-in synthetic auth parity and separately approved real controlled tool use remain open. Production/operator/worker code, credentials, dependency versions/lockfile and demonstration checkout stay unchanged. No publication, deployment or live-remediation activation occurs. Stop after this slice.
