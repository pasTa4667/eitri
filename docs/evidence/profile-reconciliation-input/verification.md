# Profile-name reconciliation-input verification

## Scope

This continuation starts at `a6259ad`. Source `74c6eb22b30914ebed3be3b9f7b98be72779ac15` adds `captureProfileNameReconciliationInput` for callers preparing a protected-test reconciliation. The [capture reference](../../fixture-profile-name.md#reconciliation-input-capture) defines its API and limits.

The operation captures exactly the helper, its existing unit tests, and the existing application tests. It returns raw bytes and content identities without executing or interpreting them. The fixed tuple contains no compatibility verdict, source revision, test result, or controller authority. The existing helper-only capture retains its descriptor and digest.

The plan requires green existing normal-path checks. Current protected fixture tests require uppercase names and a null-user exception. The protected browser definition requires trimmed case-preserving names and `Anonymous`. This increment acquires reproducible inputs for that unresolved decision. It does not change, exclude, or reconcile those expectations.

## Design and ownership

Two independent Codex designs compare a shared acquisition engine with a separate bundle reader. Parent and a fresh Codex judge select shared ownership to avoid duplicated filesystem policy. The selected design adopts path-specific tuple types and cleanup-failure checks from the separate-reader design.

One policy preserves existing helper error behavior for both APIs. An unsafe opened descriptor rejects before metadata comparison. A close failure supersedes an acquisition failure, but every acquired handle receives a closure attempt. Final descriptor, path, and directory checks cover every selected file after all reads. Sequential checks are not an atomic snapshot or protection against hostile same-UID races.

One isolated writer owns the four coupled source, test, and API-reference files. Parent reads the complete diff and runs the actual capture. There are no concurrent source writers. New tests use a separate subprocess worker, leaving the old helper tests and worker byte-unchanged.

The named principles changed these choices.

- Model the Domain fixes the three paths and their order in a typed tuple.
- Laziness Protocol puts acquisition policy in one private reader rather than two implementations.
- Separate Before Serializing Shared State gives the writer its own worktree and reports their own paths.
- Build the Lever leaves committed rerunnable boundary tests and deterministic filesystem instrumentation.
- Test Behavior, Not Implementation requires literal output, bytes, and independently pinned digest expectations.
- Sequence Work into Verifiable Units verifies acquisition before integration and wider acceptance.
- Prove It Works checks the actual API against the real fixture bytes and reviewed file identities.

The throughput checkpoint uses grounding and design as blocking steps, one implementation owner for the coupled reader and tests, and fresh read-only reviews after mutation stops. Parent owns final acceptance and integration. Separate source-writing lanes would overlap on the same resource lifecycle.

## Runtime checks

Parent runs the focused checks on the implementation worktree.

```sh
node --test test/fixture-profile-name.test.ts test/fixture-profile-name-reconciliation.test.ts
```

All 23 tests pass. Eleven new tests cover literal output and canonical digest, root independence, mutation of each input, detached buffers, raw binary and size bounds, unsafe inputs at every position, fixed-path access, no code execution, bounded short reads, cross-file mutation, route replacement, descriptor lifetime, and cleanup precedence. The unchanged helper checks also pass.

Parent baseline `npm run verify:all` passes 1,757 Node tests and 30 Rust tests. Final integrated `npm run verify:all` passes 1,768 Node tests and 30 Rust tests, including lint, formatting, and type checks. There are no failures, cancellations, skips, or ignored Rust tests. Existing Rust dependency future-incompatibility notices remain.

Parent also invokes both capture APIs against the actual sibling checkout. Independent Python hashing supplies the expected descriptor and bundle digest before the capture. The returned raw bytes match direct reads of the three allowlisted files.

| Virtual path | Bytes | SHA-256 |
|---|---:|---|
| `src/lib/errors.js` | 525 | `5fa6710bb0c4f120408d489d0b16f6a21bfc6e539081ab1d9fda7a3bddb1fa07` |
| `src/lib/errors.test.js` | 1181 | `ac97491a98eb301f923f2d808073cdaf0dd4550e4c9ebd706c88469b1815fc5d` |
| `src/App.test.jsx` | 1566 | `ac3efd3b466391ec6b46605eedd15db5bb29c4c4681cbbc2f8adc81866559ee5` |

The actual bundle digest is `98539080e5a47bae27608cb59fa96673d36fdf489f2de59fea08ae309afa0860`. The helper-only capture still returns `4a0ca6e84af5aa34eb429049c177762746b9acc0c6c0f35d75503900e51c2312`. No fixture code runs. Saved before and after snapshots prove unchanged content, device, inode, size, mode, and nanosecond modification/change times for the three files. Sibling Git status remains untracked and is not evidence of file integrity.

## Independent reviews

The fresh Codex comment audit requires zero deletions. It retains two public API contract comments and finds no suppressions.

Fresh Codex Standards and Spec reviewers each report zero findings on `a6259ad...74c6eb2`. Both read the complete four-file patch and verify every frozen file hash in the writer and main checkouts. Their reviews are source-only. Runtime checks belong to the parent. Independence is by fresh context within the Codex family, not cross-family agreement. Run receipts identify the installed `codex` CLI but do not expose its serving model identifier. That identifier was not observed and is not inferred from the parent's model.

The writer corrects initial test-expectation, typing, and lint errors before its passing checks. Its sandbox cannot write shared Git metadata, so parent creates the source commit. The comment auditor's initial heredoc fails because its sandbox cannot create the shell temporary file. Its read-only Python retry verifies the patch and hashes. None of these failed checks is counted as passing.

A separate decision-trail reviewer launches as `anthropic/claude-opus-5-5:high`. It confirms honest capture-only scope and flags three handback risks. The handback must distinguish capture from the unfinished normal-path checks. The exact external Codex model identifier must remain unobserved rather than guessed. File-integrity evidence needs a saved after-snapshot rather than Git status or an unrelated digest file. Parent saves the after-snapshot, records the comment audit, and updates this record. An earlier `claude-sonnet-4-6` audit launch returns HTTP 404 before any review or mutation. Its same-tool retry succeeds.

## Retained evidence and limits

Local artifacts are `.audit/continuation-baseline.txt`, `.audit/continuation-parent-focused.txt`, `.audit/continuation-final-verify-all.txt`, `.audit/continuation-review.patch`, `.audit/continuation-review-hashes.txt`, `.audit/continuation-actual-expected.json`, and `.audit/continuation-integrated-actual-capture.json`. File-integrity snapshots are `.audit/continuation-fixture-before.json` and `.audit/continuation-fixture-after.json`. They supersede the decision trail's initial integration row, whose evidence pointers did not contain the stat metadata. The local decision trail is `.audit/continuation-decisions.tsv`. Committed behavior checks are `test/fixture-profile-name-reconciliation.test.ts` and its subprocess worker.

Captured buffers remain mutable. Their recorded checksums do not authenticate provenance. A genuine operating-system close failure cannot prove descriptor release. The caller owns any later display or persistence policy.

Protected-test reconciliation still needs an explicit decision before expectations change. React validation, M2 acceptance, hosted Sentry compatibility, genuine model inference, and production activation remain open. No original fixture edits, `.env` or `dist` reads, credentials, live-service calls, application inference, remote writes, publication, or deployment occur. No remote is configured, so PR creation is skipped.
