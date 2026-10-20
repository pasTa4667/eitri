# Offline request acceptance verification

## Scope and source

Commit `07646ae4af3f8c2f569d9e2e5e19f637712635e2` implements the next offline prerequisite after `7e02846`. It is integrated locally on main. The [source identity](source-identity.txt) records the exact revisions, changed paths and protected-byte checks. The [reference](../../worker-acceptance.md) defines the API and limits.

An explicitly enabled baseline or browser callback can ask the worker to retain the exact controller intent while authority is current. The worker owns one non-executable acceptance fact. Existing association inspection recovers a lost acknowledgment from that fact. Acceptance grants no execution permission, reserves no execution quota and establishes no validation result.

## Design and ownership

Two independent sketches and a fresh Codex cross-judge compared charged dormant execution with worker-owned uncharged acceptance. Parent and judge selected acceptance. A second controller acknowledgment and startup repair were rejected because historical inspection already requires the original journal. The selected design adds one worker record variant, not a second lifecycle ledger.

Model the Domain separates acceptance from pending execution through a discriminated union. Laziness Protocol removes duplicate acknowledgment storage. Separate Before Serializing Shared State gives one writer the isolated implementation checkout while reviewers remain read-only. Exhaust the Design Space led to two structurally distinct sketches. Build the Lever and Test Behavior, Not Implementation produced rerunnable public API, subprocess and SIGKILL tests rather than a narrative assertion of correctness. Sequence Work into Verifiable Units required focused checks before full verification. Fix Root Causes led to a shared guard-return check at both denial paths. Prove It Works required parent execution against the actual source and locally integrated artifact.

Grounding, both sketches, cross-judge, writers, comment reviewers and source reviewers used `openai-codex/gpt-6.1-sol`. Independence is fresh context, not model diversity. No Claude review was used in this continuation.

## Parent verification

The parent ran the following against the final executable and test bytes.

- `npm run verify` passes lint, formatting, TypeScript checking and all 669 Node tests. The [full Node log](parent-verify.txt) records no failures, cancellations or skips.
- `npm run lint:rust`, `npm run format:check:rust` and `npm run test:operator` pass independently. The [Rust log](parent-rust.txt) records all 30 tests passing, none failed or ignored. These commands used the existing `operator/target` cache through `CARGO_TARGET_DIR` where applicable.
- After fast-forward integration, `node --test test/frozen-browser-acceptance.test.ts test/controller-worker-acceptance.test.ts` passes all 38 tests. The [focused log](parent-focused.txt) includes actual SIGKILL before and after worker COMMIT, first-use migration and lost-result recovery.
- `git diff --check 7e02846...07646ae` passes. The repaired review patch and reconstructed committed patch are byte-identical with SHA-256 `a2519fd14c528472a1d9915ef187d25a9b526d71c228ba2fc366162c56223f12`. The source diff remains empty after verification.

The parent Node and Rust runs together cover every gate in `verify:all`. The writer separately completed `npm run verify:all` on the same bytes with 669 Node and 30 Rust tests passing. Existing Rust dependency future-compatibility warnings remain. Dependencies are unchanged.

Behavioral tests cover exact concurrent retries, detached outputs, denied and revoked authority, callback expiry, pause, timeout, Retry, closing, changed source/action/epoch, final pre-COMMIT checks, quota preservation, finite metadata capacity, legacy parsing, one-way lazy migration, cross-kind uniqueness, ambiguous persistence failure, all opening modes and historical inspection. Positive observer controls detect synthetic client calls and frozen reads. Acceptance operations perform neither. Existing controller startup frozen-source integrity checks are preserved.

## Review defect and resolution

Original [comment review](comments-review.md) and [standards review](standards-review.md) pass. Original [specification review](spec-review.md) blocks the initial diff on a genuine invalid-async-guard bug despite the green initial suites.

The parent reproduced a rejecting async guard through the actual acceptance fixture. `accept()` rejects with `worker-authority-denied`, but the discarded guard Promise also emits an unhandled rejection. The [red output](acceptance-async-guard-red.txt) records that independent failure. Controller-supplied synchronous guards were unaffected.

The fix shares `requireCurrentAuthority()` between both acceptance paths. Only literal synchronous `true` permits acceptance. Invalid native Promises have their rejection observed without an await. Arbitrary thenables are not invoked. Four subprocess regressions cover rejecting async functions and ordinary `Promise.reject()` guards on new and existing keys, unchanged durable state and subsequent valid reuse. The writer demonstrated all four red before green.

The identical parent reproduction now records no unhandled rejection in the [green output](acceptance-async-guard-green.txt). Fresh Codex [delta review](delta-review.md) passes comments, correctness/specification and standards. It confirms the original blocker is resolved and the final guard still immediately precedes synchronous COMMIT. Parent full verification above follows this fix.

Reviewers could inspect source but had no shell. Patch hashes and command results were parent-supplied, explicitly labeled in their reports. Original reports predate the fix and are retained unchanged. Their provisional verification notes are superseded by the completed parent gates above, not silently edited.

## Interrupted work and evidence handling

The first writer hit its 1800000ms overall timeout during full verification. Its changes remained uncommitted and no process remained. A fresh writer inherited the existing worktree and verification logs. This timeout is not counted as a passing full run. A later post-fix run stopped on formatting in the changed regression test. Scoped formatting and a complete rerun resolved that gate. Neither incomplete run overrides the subsequent completed checks.

Raw parent logs remain under `.audit`. Committed copies preserve output except trailing whitespace and final blank-line normalization if required by `git diff --check`. Review reports retain their original conclusions and provenance. The artifact-path write warnings in reviewer reports describe runtime output routing, not application failures. Runtime-managed reports were successfully read and copied by the parent.

The final Codex [evidence audit](evidence-audit.md) passes with no issues or wording corrections. It directly inspects retained logs, source and review history. Its lack of shell prevents independent hash and normalization checks, which remain parent-verified. Parent final documentation edits add only this audit link and outcome.

## Limits and next work

Acceptance history has a finite protocol limit of 256 records. It does not consume or guarantee executable capacity. The worker format upgrades to version 2 only with successful first acceptance. Downgrades are unsupported. Historical inspection requires the original trusted journal and compatible execution configuration. Same-UID hostile writers remain outside the existing trust boundary.

No Docker dispatch, monitored demonstration project build or execution, original fixture edit, credential access, service activation, application inference, publication, deployment, worker change or containment change occurred. Production main, HTTP, native evidence admission, Rust source and dependency files are unchanged.

Authority-aware execution consumption, absolute controller deadlines, running-work cancellation drainage, trusted cleanup reconciliation and native non-simulated check admission remain separate prerequisites. M2 and later human-presence gates remain open. No remote is configured, so no PR is opened.
