# Historical consumed-report verification

## Source

Source commit is `de4ce5181ae9dfa62f4449241388ec242ad3be4a`, based on `94af4e8`. It changes only `src/frozen-browser.ts` and adds `test/frozen-browser-consumed-report.test.ts`.

Parent hashes before source review, after review and after integrated verification match.

| File | SHA-256 |
| --- | --- |
| `src/frozen-browser.ts` | `943367ac519af74b1b7d5571a610316b7f31d95928331b86fd3f398b8fd48965` |
| `test/frozen-browser-consumed-report.test.ts` | `0ccc92775c07c454216522dcfb241ea9ddaf70d3c76123eb2c356b1b550e3ab1` |

## Design and review

Two independent GPT sketches compare a static exact-record query with a restricted public reader handle. The parent and fresh cross-judge choose the static query. The [design](design.md) records the state union, private read-only acquisition and rejected lifecycle overhead.

The [comment audit](comment-review.md) requires no deletions or suppressions. The [source review](source-review.md) finds no source-level issues. That reviewer has no execution or hashing tool. Its report does not establish runtime success or independent hashes. The parent supplies those checks.

All delegated roles use `openai-codex/gpt-6.1-sol`. These are fresh-context reviews, not cross-family assurance. The final [evidence audit](evidence-audit.md) passes with no material discrepancy or required correction. It inspects recorded execution and hashes, not a separate test run or hash computation.

## Executed checks

| Owner and checkout | Command | Result |
| --- | --- | --- |
| Writer, isolated worktree | `node --test test/frozen-browser-consumed-report.test.ts` | 18 pass. |
| Parent, isolated worktree | `node --test test/frozen-browser-consumed-report.test.ts test/frozen-browser-cleanup-reconciliation.test.ts test/frozen-browser-cleanup-crash.test.ts test/frozen-browser-consumption-clock.test.ts test/frozen-browser-admission.test.ts` | 212 pass, zero failures, cancellations or skips. |
| Writer, isolated worktree | `npm run verify:all` | Exit 0. 873 Node and 30 Rust tests pass. |
| Parent, integrated main at source commit | `npm run verify:all` | Exit 0. 873 Node and 30 Rust tests pass. |

Both full runs include TypeScript checks, lint, formatting, Rust lint, Rust formatting and operator tests. Existing Rust dependency future-incompatibility notices remain.

Earlier writer attempts are not counted as passes. The initial focused log records eight failures from an overbroad close mock affecting fixture teardown and an error matcher excluding `artifact-size-limit`. The initial type check rejects a test's union-valued opening mode. Final tests remove the close mock, include the artifact error and narrow each opening overload. A broader intermediate focused log ends without a suite summary and is not complete verification. Those local logs remain as `consumed-report-focused-initial.log`, `consumed-report-check-initial.log` and `consumed-report-focused-timeout.log` under the writer's `.audit` directory.

Raw parent logs remain local at `.audit/consumed-report-parent-focused.txt`, `.audit/consumed-report-parent-full.txt` and `.audit/consumed-report-parent-full.exit`. Writer logs remain in the retained sibling worktree at `../eitri-worker-report-next/.audit/consumed-report-verify-all.log` and `.exit`. Tests are the committed rerunnable proof. Raw logs are not committed.

## Behavior and scope

The focused tests use actual temporary SQLite journals and a scripted client transcript. They check literal report and PNG output, shortened timing, detached results, unchanged rows and files, malformed selectors, corruption, legacy journals, real SIGKILL-created rollback state, sidecar refusal, ownership and failure release. Scripted client effects are not live Docker evidence.

The shared acquisition catch now releases process-local ownership even when database closure throws. The parent explicitly accepts this narrow improvement instead of preserving an ownership leak. Normal writer recovery, hot-sidecar handling, provisioning and drainage retain their existing paths.

The parent's protected-path diff is empty for production main, controller, HTTP, native, workspace, worker assets, Rust and dependencies. No real Docker dispatch, monitored fixture edit, credential access, service activation, application inference, publication, deployment or containment change occurs in this unit. Native real-check admission, actual fixture validation and M2 remain open.

The writer's final handoff says changes are uncommitted. That is a stale handoff snapshot. The parent commits the unchanged source and fast-forwards main before its integrated full run.
