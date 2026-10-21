# Controller historical correlation verification

## Accepted artifact

The continuation starts at `9500610`. Source commit `4a5cc23cf0424cfe925bc7b52d9c16da8d9246b1` adds the offline historical query described in the [reference](../../controller-worker-history.md). The [source hashes](source-identity.txt) match the reviewed files before and after parent verification.

Two independent GPT sketches compared an action-only query with a caller-selector-bound query. The [cross-judge](design.md) selected action-only inputs, existing source validation, one historical read transaction, and existing inspection drainage. The parent accepted that synthesis. There is no new durable execution-fact record.

The result separates controller-retained request attribution from journal-derived identity and timing. It does not invoke report admission or create native checks.

## Actual checks

The parent ran `npm run verify:all` successfully against the final source bytes. The [full log](parent-full.txt) records 1,024 Node tests and 30 Rust tests passing. There are no failures, cancellations, or skips. This command also passes TypeScript checks, both language lint gates, and both formatting gates. Existing Rust dependency future-incompatibility notices remain.

The parent then ran `node --test test/controller-worker-consumed-history.test.ts test/controller-worker-association.test.ts test/frozen-browser-consumed-report.test.ts` at `4a5cc23`. The [focused log](parent-focused.txt) records all 65 tests passing.

The implementation owner separately passed [73 focused tests](writer-focused.txt), [1,024 Node tests](writer-node.txt), and [30 Rust tests](writer-rust.txt). Its initial combined verification did not pass. Do not treat these separate commands as a successful writer `verify:all` run.

Tests use actual temporary controller and worker stores with seeded history and scripted effects. Literal assertions cover attribution, exact-key selection, shortened historical timing, historical states, diagnostic reports, detachment, read-only files, queue serialization, busy scopes, and closure. Transaction tests observe a read-only connection with `BEGIN` before validation reads and retained through closure. No live Docker run is performed.

## Review

Fresh GPT [source review](source-review.md) passes without correctness or contract blockers. It ran no tests. Parent and writer commands supply runtime evidence. Its optional P3 queued controller-input capture test is deferred because current capture is correct by inspection and the requested unit is complete.

The [comment audit](comment-review.md) requires zero deletions and finds no suppressions. The two added public API contract comments remain. The parent reread the production and test diff before committing and found no further required cleanup.

All delegated design, implementation, and review roles use `openai-codex/gpt-6.1-sol`. This is fresh-context review within one model family, not cross-family assurance. The source review incorrectly attributes documentation edits to the writer. The parent wrote both documentation files.

## Failed and incomplete checks

Initial [type checking](initial-typecheck.txt) rejects a union result assembled without a sufficiently narrow discriminant. The final code returns the discriminated alternatives correctly.

An [initial controller test run](initial-controller-tests.txt) is incomplete. An [intermediate run](intermediate-controller-tests.txt) cancels one gated scope-opening race test at its timeout. The corrected fixture synchronization passes in focused and full final runs. These attempts are not passes.

The [initial combined verification](writer-initial-full.txt) stops at a test `no-this-alias` lint warning. The final test removes that alias without a suppression. Final parent full verification passes.

The harness initially rejects the unavailable `general-purpose` agent name before launching work. The parent reports the rejection and retries using the available `delegate` agent. No partial source edit results from that launch failure.

## Scope and remaining work

Production changes are confined to `src/controller.ts` and `src/frozen-browser.ts`. Worker scope, production main, HTTP, native storage, workspace, worker assets, Rust, dependencies, schema, accounting, and containment configuration remain unchanged.

Historical consistency does not establish authorship, independently retained execution identity or timing, current authority, executed cleanup, containment, or daemon quiescence. Controller startup remains recovery-capable. Process-local ownership adds no cross-process exclusion or hostile same-UID guarantee.

Durable execution-fact retention, native real-check admission, actual fixture validation, and M2 acceptance remain open. Human-presence gates remain binding. No credential access, service activation, application inference, original fixture edit, publication, deployment, or containment change occurs. No Git remote is configured, so delivery stays local.
