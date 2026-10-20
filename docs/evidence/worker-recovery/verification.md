# Worker recovery inventory verification

## Scope

This continuation starts at `d932d8c` after pure browser report conversion. Merge `447f0d07e038d174b1ceed430e42188f1b8b3485` implements an owned journal-only recovery inventory as the next bounded prerequisite. Parent full verification passes 613 Node tests and 30 Rust tests. Full controller-worker correlation remains incomplete.

The [reference](../../worker-recovery.md) defines the API. The [synthesis](design.md), [first candidate](candidate-a.md), [second candidate](candidate-b.md), and [cross-judge](design-judge.md) record the decision. The selected inventory stays inside the validator owner. Public reservation and a second controller ledger are deferred.

## Baseline

Parent `npm run verify:all` passes 554 Node tests and 30 Rust tests before implementation. The [baseline log](baseline.txt) records lint, formatting, type checks, syntax checks, and tests.

## Initial implementation and rejected defects

Implementation `6d94d000122539e44f063c1aa5a2ef9e04adcbf3` changes only `src/frozen-browser.ts` and `test/frozen-browser.test.ts`. Worker [focused verification](initial-worker-focused.txt) passes 34 tests. Worker [full verification](initial-worker-verify.txt) passes 588 Node tests. The parent independently runs the [34 focused tests](initial-parent-focused.txt).

The [fresh source review](initial-source-review.md) nevertheless blocks acceptance. Mutable opening options can change a journal-only request into effectful recovery. Unknown runtime mode values silently select execution. The reviewer reproduces a Docker sentinel invocation in a synthetic journal. No real Docker runs. Its separate full test command times out at 200 seconds, so that review does not claim a full-suite pass.

The parent independently reproduces both execution-handle exposure and empty-directory initialization. The [red output](mode-before.txt) comes from the unformatted `.audit` original of [the checked-in reproduction](reproduce-mode.mjs). Only formatting differs between the scripts. The rerunnable command is `node docs/evidence/worker-recovery/reproduce-mode.mjs <checkout-directory>`.

The [comment review](comment-review.md) finds no suppressions, required deletions, or open constraints. It retains two public API contract comments. No comment changes are required.

## Corrected source and final verification

Test-only commit `a3c31a614cc7c5b2cdfd110dccf9d765a7ebc69c` reproduces both dispatch defects. The [red run](mode-red.txt) reports four passing valid controls and 21 failed tests, including three parent groups. Source-only correction `27f56f14b7039f345372ce0741bf8b510ba954ff` captures and validates the opening mode before awaits and owner registration. All three mode branches use that immutable local.

The red, green, journal, and worker full-verification logs are pre-commit working-tree runs. Their identity with the later commits is worker-attested, not recorded in those log headers. After the evidence audit flagged that limit, the parent independently executes the 25 mode tests at exact red commit `a3c31a6` and at integrated green commit `447f0d0`. Both new logs record HEAD, the command, and an empty tracked source diff against HEAD.

| Command | Result |
| --- | --- |
| Worker `node --test --test-name-pattern='frozen browser opening mode' test/frozen-browser.test.ts`. | [25 tests pass](mode-green.txt) after the source correction. |
| Worker `node --test --test-name-pattern='frozen browser journal' test/frozen-browser.test.ts`. | [34 tests pass](mode-journal.txt). |
| Worker `npm run verify`. | Lint, formatting, compilation, syntax checks, and [613 Node tests pass](worker-final-verify.txt). |
| Parent `node docs/evidence/worker-recovery/reproduce-mode.mjs .`. | [Both scenarios reject](mode-after.txt) without execution handles or file initialization. |
| Parent mode tests at exact red `a3c31a6`. | [Four controls pass and 21 tests fail](parent-pinned-red.txt), including three parent groups. The expected exit is 1. |
| Parent mode tests at integrated green `447f0d0`. | [All 25 tests pass](parent-pinned-green.txt), with exit 0. |
| Parent `npm run verify:all`. | Lint, formatting, type and syntax checks, [613 Node tests and 30 Rust tests pass](final-verify-all.txt). |

The integrated parent run follows writer completion. Its log records the tested HEAD and zero exit status. Before and after verification, `git diff -- src test worker operator package.json package-lock.json` is empty. That checks the unstaged tracked diff, not staged or untracked files. Subsequent `git diff HEAD` and untracked-path checks are separately recorded in the source identity file. Existing Rust dependency future-compatibility notices remain in that successful log.

The copied baseline log omits one final blank line. Both copied red-mode logs trim four whitespace-only lines. Raw outputs remain at `.audit/worker-correlation-baseline.txt` and `.audit/worker-recovery-parent-pinned-red.txt` in the main checkout and `.audit/worker-recovery-mode-red.log` in the implementation worktree. No other log content changes.

The [fresh delta review](delta-review.md) independently runs the 25 mode tests and the parent reproduction. Both prior findings are resolved, with no new concrete defect in the fix's scope. It confirms that the correction adds no comments or suppressions. Source and comment reviews use the configured GPT family.

The [source identity record](source-identity.txt) includes exact Git comparison commands and zero exit statuses. Integrated executable and test bytes match `27f56f1`. Protected source, worker, Rust, fixture policy, and dependency bytes remain unchanged. The original implementation, red test commit, and green source correction remain in history.

The [cross-family evidence audit](evidence-audit.md) by `anthropic/claude-opus-5-5` finds no code blocker or invented runtime claim. It independently verifies Git identities, protected bytes, real SIGKILL implementation, positive sentinel assertions, reproduction behavior on archived red and green source, copied-log provenance, and test counts. It does not rerun the full suites. It reports five nonblocking evidence and wording notes.

The parent addresses all five notes after the audit. The original worker logs are labeled as pre-commit evidence. Independent parent pinned red and green runs now supplement them. This document names the exact unstaged-diff command and its limits. The work log identifies worker-run counts. Append-only decision rows record the red and green evidence, merge-before-delta-review ordering, and whitespace normalization. The audit report remains unchanged and describes the earlier document state.

The local implementation, review, parent verification, and continuation record are complete. No PR is opened because no remote is configured and publication remains outside scope.

## Test boundary

All new execution observations use private transcript or sentinel executables and real temporary Git and SQLite stores. They establish API effects, persisted identity, interrupted recovery, and ownership checks, not live containment or cleanup.

Actual SIGKILL tests cover committed pending admission and both sides of recovery COMMIT. Recovery save failure, unknown build state, acquisition intents and IDs, historical incomplete cleanup, snapshot detachment, protected-file replacement, owner exclusion, and close drainage have focused coverage. The complete expected inventory is asserted alongside no-effect checks. An execute-mode positive sentinel control verifies that the invocation observer works.

No real Docker acceptance run is required or claimed for this inventory unit. Worker assets, container restrictions, controller, workspace implementation, native evidence, HTTP, production main, Rust, and dependencies remain outside source scope.

## Remaining gates

A later unit must persist the controller-to-validator owner association and design the execution-authority handoff. Admission acknowledgment gaps, cancellation drainage, trusted cleanup reconciliation, Retry policy, real candidate semantics, and native evidence persistence remain open. No service, credential, model-inference, publication, deployment, or original demonstration-project change is part of this continuation. M2 and later human-presence gates remain open.
