# Admission-time execution facts verification

## Accepted scope

Source commit `e72a2b0448924b9ab9c15e93bdcc762f8f9d2357` moves controller facts retention from successful worker return to live admission. A synchronous observer runs after worker COMMIT and before execution or frozen reads. The [reference](../../controller-worker-history.md#controller-retained-live-execution-facts) defines attribution and persistence behavior.

The observer carries detached acceptance, consumed-run identity, and actual interval. Controller storage keeps its existing facts shape. Observer failure preserves charged pending history and bypasses execution, result recording, and cleanup. Scope consumption caches the failure and reports failed drainage after journal closure. Existing consumption and joined callers never produce retrospective observations.

## Design choice and throughput

Two independent GPT sketches compare operation-scoped observation with journal-bound retention. A fresh GPT cross-judge and the parent select operation-scoped observation.

| Alternative | Decision |
| --- | --- |
| Optional low-level observer, required controller-scope retention | Selected. Preserves worker-only callers and existing scope ownership. |
| Mandatory journal-opening capability | Rejected. Couples attribution to acquisition and moves failure ownership unnecessarily. |

The parent rejects mandatory no-op callbacks for unrelated worker-only callers. There is one live notification boundary and no post-return retention fallback.

Blocking work consists of grounding, two sketches, a cross-judge, baseline checks, and a failing reproduction. One isolated owner implements the coupled worker, scope, and controller change. Read-only reviewers inspect a frozen twelve-file snapshot. Separate output files and a single source writer prevent overlapping writes.

Model the Domain selects the admission envelope and private new/existing union. Laziness Protocol preserves existing storage and three-argument worker-only calls. Separate Before Serializing Shared State selects one source owner and separate review artifacts. Sequence Work into Verifiable Units puts checks before acceptance. Build the Lever leaves rerunnable behavioral and process-kill tests. Prove It Works requires parent execution and post-run byte comparison.

## Parent verification

The parent runs `npm run verify:all` after local fast-forward integration on main. It passes lint, formatting, type and syntax checks, all 1,099 Node tests, and all 30 Rust tests. There are no failures, cancellations, skipped Node tests, or ignored Rust tests. Existing future-incompatibility warnings for Rust dependencies `block` and `proc-macro-error2` remain. The [complete parent log](parent-verify-all.txt) records the run.

The original temporary-store reproduction fails before implementation because facts are unavailable at the first scripted worker command. It passes after integration. The [red log](reproduction-red.txt) and [green log](reproduction-green.txt) record that comparison. Committed regressions additionally establish ordering before `executeAdmitted` and frozen reads.

Relevant checks can be rerun with these commands.

```sh
node --test test/controller-worker-admission-retention.test.ts test/controller-worker-admission-crash.test.ts test/frozen-browser-admission-observer.test.ts test/worker-execution-scope-observer.test.ts
npm run verify:all
```

Tests use actual temporary SQLite and Git stores, scripted external commands, and actual SIGKILL. They cover charged pending state after a real SQL retention failure, zero execution work, cached failure after trigger removal, failed drainage after resource release, original attribution after revocation and Retry, detached observations, joins, existing records, async-return rejection, and both sides of the separate-store crash gap.

All twelve executable and test files match the [reviewed source identities](source-identity.txt) before and after parent verification. Checked-in logs remove trailing whitespace and the final extra blank line only. Raw originals remain in `.audit/`.

## Independent review

Fresh `openai-codex/gpt-6.1-sol` [correctness review](code-review.md) passes with no findings. A separate GPT [comment audit](comment-audit.md) finds no changed comments or suppressions and requires zero deletions. Both inspect actual recovered files. Their hash and execution claims are explicitly attributed to the parent or writer. The full parent run closes the verification gate that remained pending in the correctness report.

Review independence is by context, not model family. The parent reads both complete reports and independently checks the source diff, tests, and hashes.

## Interrupted and failed attempts

The initial writer passes 312 final focused tests. An earlier full run passes 1,098 Node and 30 Rust tests before final test-only strengthening. A subsequent final full run is interrupted when the writer reaches its 30-minute runtime limit. That interrupted run is not counted as passing.

Harness cleanup removes the managed worktree after timeout. The parent restores the retained twelve-file patch into `../eitri-admission-retention-next` and verifies every hash against the frozen review manifest. A fresh finalizer changes no source bytes, passes static checks and 55 changed-suite tests, and commits the exact recovered files.

The first parent full attempt fails after the finalizer removes its temporary dependency symlink during that run. This is an orchestration error, not an accepted verification result. The passing parent run uses main's stable dependency directory. Raw failed and interrupted logs remain local under `.audit/` and `/tmp/`.

## Limits

Worker and controller commits remain separate. A crash between them can leave charged history without independent facts. Recovery never backfills those facts. Admission facts do not prove execution began or completed. An invalid asynchronous observer can continue its own work despite return-contract rejection.

These tests do not establish actual Docker containment, daemon cleanup, physical cache reclamation, or monitored fixture validation. Production main, HTTP, native real-check admission, schemas, dependencies, Rust source, and containment policy remain unchanged. No credential access, live service activation, application inference, publication, or deployment occurs. M2 and later human-presence gates remain open.
