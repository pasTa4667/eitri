# Watchdog delta review

**PASS**

Reviewed `8fe2b81a0dd2b48f3c25a165ac56e571f7baed91..352bf1568b176d9afd4351aca5e2c9c8fc6731e4`.

## Method

Read the supplied exact-range patch, current acceptance-worktree source, supporting runtime logs, and prior harness review. The final-head artifact and worktree branch reference both identify `352bf1568b176d9afd4351aca5e2c9c8fc6731e4`.

Scope was only the host-SIGKILL test's 27 insertions and 2 deletions. Its data shape remains a journal-acquired container ID and absolute deadline, checked against Docker inspection state.

Read poteto-mode fully, including Principles, and the scoped comment-review instructions. No edits, shell commands, Docker, external access, or subagents.

Throughput checkpoint. Not applicable to this read-only investigation.

## Review

- **Correct.** After killing and awaiting the host, the test requires an acquired journal container and validates its full immutable ID. See `test/integration/frozen-browser.test.ts:527-538`.
- **Correct.** The positive witness inspects that exact ID, rejects `exited`, and accepts `running` only if inspection returns before the original recorded deadline. Both ID equality and the witness are mandatory. A merely created container, expired polling window, or late inspection cannot pass. See `test/integration/frozen-browser.test.ts:539-560`.
- **Correct.** The subsequent wait still uses `run.intent.deadline`. The same container must then be `exited` with exactly `124`, not the earlier driver failure `1`. No timer or deadline is reset. See `test/integration/frozen-browser.test.ts:561-566`. The unchanged watchdog schedules exit `124` against its supplied absolute deadline at `worker/frozen-browser/watchdog.mjs:30`.
- **Correct.** Exact uncertain recovery, owned removal, repeated-request equality, and retained owner-marker assertions remain unchanged. See `test/integration/frozen-browser.test.ts:567-581`.
- **Correct.** Only this test's allowance changes to `8000`. The delayed-start test remains at `30000` and retains its original-deadline and exact-124 assertions. See `test/integration/frozen-browser.test.ts:503,802,854-867`. The supplied patch contains no production, driver, container-security, or helper changes.

No issues found.

## Runtime evidence and limits

`validator-acceptance-docker.txt` records the prior 19/20 run and the watchdog assertion failure `1 !== 124`. `validator-watchdog-failure.txt` records exit `1` and `frozen-driver-failed` after roughly 10.6 seconds, before the old 30000 ms allowance. Recovery subsequently reported uncertain/no-replay and owned removal in `validator-watchdog-failure-recovery.txt`.

The precise driver exception was not captured. Click and screenshot timeouts are a source-supported explanation, not an established exception diagnosis. See `worker/frozen-browser/driver.mjs:310,318,351-353`.

The budget-only prototypes each passed once. Separately, `validator-watchdog-fixed.txt` records one passing final-candidate test with zero skips. Together with the mandatory source assertions, that supports the added pre-deadline running witness and exact exit `124`. It does not establish a passing final full suite.

## Scoped comments and suppressions

The patch touches only `test/integration/frozen-browser.test.ts`. Added comments, added suppressions, comment deletions, and `MUST KILL` flags are all zero. No edits were applied.

## Principles applied

- **Prove It Works.** Checked source identity and supplied runtime artifacts. Kept focused success separate from full-suite acceptance.
- **Test Behavior, Not Implementation.** Required observed running execution and preserved literal exit `124` and recovery outcomes.

## Verdict

**Merge verdict. OK for this scoped delta.**

**Safe to run the complete actual-Docker acceptance suite under the existing reviewed policy.** Final full-suite acceptance remains pending.