# Admitted-action deadline verification

## Scope and source

Source `90df0ea519d8b3fff8550105ba27727bb272eea3` completes the next offline prerequisite after `69c5485`. The [reference](../../action-deadline.md) describes the contract. The [source identity](source-identity.txt) records commits, protected paths and byte comparisons.

Callbacks receive a fixed `deadlineAt` derived from the existing admitted Action. Model and tool lifetimes sample current controller allowance rather than starting another full relative window. Preparation consumes the original allowance. Exact endpoint equality denies new effects even when timer delivery is withheld.

Persisted Action, nested action-source JSON, canonical worker requests, acceptance journals and worker acknowledgment timestamps are unchanged. Historical acceptance is not execution authority. This unit does not implement accepted-request consumption.

## Design and ownership

Two independent Codex sketches compared derived endpoints with controller-owned action scopes. Parent and a fresh Codex judge selected the derived endpoint. The [design](design.md) retains the decision and required transition-boundary corrections. A duplicated persisted deadline and a larger lifecycle migration were rejected. Deterministic cancellable wakeups came from the other candidate.

Model the Domain kept timing in the existing action tuple and explicit action-scoped completion markers. Laziness Protocol avoided a schema migration and new execution ledger. Sequence Work into Verifiable Units placed deadline correctness before executable handoff. Build the Lever produced rerunnable deadline, transaction-barrier and subprocess regressions. Fix Root Causes moved authorization to effect boundaries and contained interruption failure at the abort listener. Prove It Works required independent parent execution and direct persisted-value assertions.

One owner wrote each source revision. Parent planning and evidence writes used separate files. All designers, implementation owners and reviewers used `openai-codex/gpt-6.1-sol`. Review independence is fresh context, not model-family diversity. No Claude review was used.

## Parent verification

- The [baseline](baseline.txt) passes 669 Node tests and 30 Rust tests.
- The [initial focused run](parent-focused-before-review.txt) passes all 70 new deadline tests before source-review corrections.
- The [initial full run](parent-full-before-review.txt) passes 739 Node tests and 30 Rust tests. It predates the review fixes and is not final acceptance evidence.
- The [final five regressions](parent-final-regressions.txt) pass queued admission, staged rollback and persistent-clock subprocess checks with positive controls.
- The parent [final full run](parent-final-full.txt) executes `npm run verify:all` successfully. All 744 Node tests and 30 Rust tests pass. No tests fail, cancel or skip. Lint, formatting and TypeScript checks pass.
- The writer [final full run](writer-final-full.txt) independently passes the same gates with 744 Node tests and 30 Rust tests.

The parent final run begins with the one-line native guard still uncommitted. The owner commits it during verification without changing executable bytes. The source identity record proves the tested working-tree delta equals the final commit delta. It also proves the final reviewed delta equals the committed delta. No executable working-tree diff remains after verification. Existing Rust dependency future-compatibility warnings remain.

Behavioral coverage includes model and tool admission, delayed timer registration, early and canceled wakeups, exclusive expiry with withheld wakeups, case and action limits, preparation delays, pending pause, successful self-transitions, stale Retry cleanup, metadata-delayed assessments, legacy recovery and historical acceptance bytes. These are offline faux-provider and temporary-store tests, not live model or Docker acceptance.

## Review failures and corrections

The original [standards and comment review](standards-review.md) passes with no comment deletions or suppressions required. The original [correctness review](initial-correctness-review.md) finds two P1 blockers despite green tests.

First, a persistently invalid clock causes `stopCheck()` to throw from an AbortSignal listener. Node defers that exception outside the lifetime catch. The [parent red reproduction](parent-review-red.txt) records the actual `run_check` subprocess failure. The fix contains the stop failure and always rejects interruption. The subprocess now survives subsequent event-loop turns, returns uncertainty, retains the original action and allowance, and records no evidence or result note.

Second, Retry can revoke completion while an old action-result note waits on the native mutation line. The same parent red reproduction records the stale durable payload. Native result admission now uses public transaction operations and checks current or confirmed authority inside that transaction. Existing request-ID replay preserves the original settled submission. The [first green reproduction](parent-review-green.txt) passes all three cases.

The [intermediate delta review](intermediate-delta-review.md) finds a further preparation window. Retry can arrive during awaited transaction staging after the first guard. Parent independently reproduces this at test-only checkpoint `0bc9f06` in a detached worktree. The [staged red output](parent-staged-red.txt) records one passing control and one expected failure, with both stale entry and settled submission present.

The final correction checks authority after awaited submission staging, still inside the transaction callback. Rejection discards both records. Parent reruns the identical staged regression and all five final cases successfully. Fresh Codex [final delta review](final-delta-review.md) passes with no findings. Reviewers have source access but no shell. Runtime and hash checks above are parent evidence, not reviewer-executed claims.

## Interrupted work and evidence handling

The first source owner exceeds its 1800000ms overall limit after a successful pre-delta full run and leaves a narrow cleanup correction. Parent inspects the preserved diff and confirms no orphaned test process remains. A fresh owner finishes that correction at `c806269`. The review-fix owner later completes the two blockers and final staging guard. No interrupted run is counted as final proof.

An early review-fix full command stops on a test lint warning. The owner corrects the alias without suppression and completes later full runs. Original local logs remain under `.audit`. Committed text copies remove trailing whitespace and final blank lines only. Reviewer reports retain their original conclusions unchanged. Runtime artifact-path write warnings do not describe application failures.

The parent-created detached red worktree remains at `/tmp/eitri-deadline-red.ddZrSz`, pinned to `0bc9f06`. It is retained as reproduction state, not an execution workspace or an active process.

## Limits and next work

Cancellation remains cooperative. A storage commit can cross the final synchronous authority sample. These checks do not provide hard-realtime interruption or atomic authorization across the controller and native stores. Revocation after that sample is not retroactive rollback. A persistently invalid custom clock prevents normal accounting until corrected; the subprocess checks failure containment and retained state, not autonomous recovery from an invalid clock.

No Docker dispatch, monitored fixture change, credential access, service activation, application inference, publication, deployment or containment change occurred. Production main, HTTP, workspace and validator execution, worker assets, Rust source and dependencies remain unchanged. M2 and later human-presence gates remain open.

Next work remains authority-aware accepted-request consumption, cancellation drainage, trusted cleanup reconciliation and native non-simulated check admission. No remote is configured. Delivery stays local and no PR is opened.
