# Accepted-request consumption verification

## Scope and source

Source `6778eabc5af9831e098b627fb61728ed8934d6ad` completes the next offline prerequisite after `b16c629`. The [reference](../../worker-consumption.md) describes the opt-in API. The [source identity](source-identity.txt) records ordered commits, protected paths, final hashes, and parent verification identity.

A callback explicitly accepts its captured request, then calls zero-argument `workerConsumption.consume()`. One worker transaction retains original acceptance history, admits execution, and charges quota once. The controller retains ownership through cancellation and settlement. Pending inspection does not wait for execution or hold the workspace queue.

Consumption returns historical outcome and cleanup without evidence bytes or native receipts. Production main remains unwired. No actual Docker or demonstration fixture validation is claimed.

## Design and correction

Two independent GPT sketches and a GPT cross-judge selected an atomic nested worker record, with a callback-scoped owner and zero-argument capability. A second accounting ledger and an extra consumption table were rejected. Versions 1 and 2 remain readable. First successful consumption lazily transitions to version 3. Old binaries reject version 3.

The first design incorrectly required each later controller allowance to cover the complete fixed worker endpoint. Parent default-clock verification found [four failures](parent-default-clock-red.txt), despite passing deterministic tests. The [instrumented run](clock-diagnostic.txt) recorded ample controller allowance and a cancelled, charged execution with owned cleanup.

Two fresh GPT reviews independently reproduced the defect. [Review A](clock-review-a.md) and [review B](clock-review-b.md) show that the predicate required every later sampler to be no slower than the initial sampler. Freezing clocks, retrying until success, and adding jitter tolerance were rejected.

The correction preserves the durable endpoint T as an immutable ceiling. Ordered worker-before, controller-allowance, and worker-after samples derive a nonincreasing effective endpoint H. H is bounded by its previous value, T, and worker-before plus current allowance. Equality expires. H bounds actual client timeouts and consumption cancellation. Cleanup retains independent authority.

Fix Root Causes changed the timing invariant instead of masking the failure. Model the Domain kept durable consumption separate from its ephemeral lifetime. Laziness Protocol kept one journal and unchanged acceptance history. Sequence Work into Verifiable Units separated worker, controller, failing timing regressions, and correction. Build the Lever produced committed rerunnable SQLite, clock, and SIGKILL tests. Prove It Works required default-clock execution and direct durable observations.

## Verification

The parent [baseline](baseline.txt) passes 744 Node tests and 30 Rust tests. The [worker-only checks](parent-worker-focused.txt) pass 28 tests. The [initial controller checks](parent-controller-before-fix.txt) pass 21 deterministic tests. These earlier runs do not establish final timing correctness.

Test-only commit `55616e677eaf3091798934138ddf2870a478c9d8` precedes the timing fix. The parent independently runs its three nonzero-latency regressions in a detached worktree. [All three fail](parent-clock-red.txt) with `worker-authority-denied`. That synthetic reproduction worktree remains at `/tmp/eitri-consumption-red.wwTs0Z`.

The parent [final focused run](parent-final-focused.txt) passes all 68 tests. Coverage includes actual SQLite, real local SIGKILL, exact identity, one-charge concurrent retry, lazy migration, malformed history, pending inspection, no replay, exclusive expiry, sampler latency, shortened client budgets, nonextension, invalid clocks, callback revocation, close drainage, and owned cleanup.

The identical original four-case default-clock script [passes all four cases](parent-default-clock-green.txt) after correction. The committed integration suite separately tests both roles without clock patches or success retries. Synthetic clients emit the protected scenario protocol. These are not real browser-containment runs.

The parent [final full run](parent-final-full.txt) executes `npm run verify:all` at committed source `6778eabc`. All 812 Node tests and 30 Rust tests pass, with no failures, cancellations, or skips. Lint, formatting, TypeScript, and Rust gates pass. The writer independently passes the same gates and totals in its [final full run](writer-final-full.txt).

Parent full verification runs in the isolated implementation worktree. Fresh source review passes before main fast-forwards to that exact source commit. Main executable and test bytes match the verified commit. A subsequent [main check](main-check.txt) passes TypeScript and both default-clock integration roles directly from main. The source identity record shows no change to production main, native receipt code, HTTP, workspace, worker assets, containment policy, Rust source, or dependencies. Existing Rust future-compatibility notices remain.

## Reviews and evidence handling

The initial [worker source review](worker-review.md) passes. Its scope is the worker protocol before controller integration. The [worker comment review](worker-comment-review.md) and [controller comment review](controller-comment-review.md) require zero deletions or suppressions.

The [final source review](final-source-review.md) covers the complete feature and amended clock contract. It passes with no P0 or P1 findings and independently runs all 68 focused tests. Its review starts with the clock correction uncommitted. Final hash comparisons prove those bytes match `6778eabc`. The report incorrectly counts 12 captured hashes. The [captured manifest](review-captured-identity.txt) has 11 entries, including the patch, and all 11 match. Added source contains no comments or suppressions.

That reviewer also starts a compatibility command that exceeds its 240-second bound. It is incomplete, not a pass. The successful parent full run covers those suites. The first parent baseline command and an early worker regression command also stop at tool timeouts. Neither is counted as acceptance evidence.

All designers, implementation owners, reviewers, and the evidence audit use `openai-codex/gpt-6.1-sol`, as requested. Independence is fresh context, not model-family diversity. No Claude review is used. Original review reports retain their initial scope and findings. Copied text logs remove trailing whitespace and final blank lines only. Artifact-path write warnings describe harness output routing, not application failure. Local original logs remain under `.audit` and the retained implementation worktree.

The final GPT [evidence audit](evidence-audit.md) passes on substantive evidence and decisions. It identifies the hash-count correction above. The original review report is preserved unchanged. Its separate comparison of all 12 changed source and test files confirms current main and the implementation worktree match.

## Limits and next work

Current controller permission is sampled synchronously, not atomically across stores. Persistence or effects can cross the last sample. Cancellation is cooperative. Compatible elapsed milliseconds remain an assumption. Hard realtime interruption, arbitrary unobserved clock changes, same-UID hostile writers, and power-loss durability are not established.

A settled cleanup record is historical. Client drainage does not prove daemon drainage, and unknown builds or incomplete cleanup remain durable blockers. Physical cache reclamation is not claimed.

No actual Docker dispatch, monitored fixture edits, credential access, live service activation, application inference, publication, deployment, or containment changes occur. Native real-check admission, trusted live cleanup reconciliation, real fixture validation, and M2 acceptance remain open. Delivery stays local because no remote is configured.
