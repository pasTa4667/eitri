# Offline consumed-report handoff verification

## Accepted scope

This increment follows `0f8633c`. Configured offline callbacks can request real baseline or browser admission through `run_check`. The callback returns only `{ type: 'consumed-browser' }`. The controller obtains the exact settled report after successful scope drainage. Native admission retains responsibility for fresh authority, outcome derivation, PNG bytes, receipts, and checkpoints.

The [identity manifest](source-identity.txt) records the final six source and test files. The [design](design.md) records the selected boundary and throughput checkpoint.

## Design and review

Two independent GPT sketches compare controller-owned post-close retrieval with scope-owned acquisition. The parent and fresh GPT cross-judge select the existing exact-run reader. A separate callback-result union distinguishes intent from execution outcomes. No worker or journal API changes are needed.

The fresh GPT [correctness review](source-review.md) passes without findings. It independently runs 39 new handoff tests, 176 supporting tests, and `npm run check`. It verifies the frozen hashes before and after review. All delegated roles use `openai-codex/gpt-6.1-sol`. Independence is by context, not model family.

The separate GPT [comment audit](comment-review.md) recommends deleting three added comments. The parent deletes all three and restores none. The drain, cleanup, and original-action publication expressions already identify the operations. No behavior or workaround changes follow review. Further extraction would add indirection rather than remove a workaround. No new suppression directives remain.

Model the Domain selects separate callback-intent and host-evidence unions. Prove It Works requires actual tool calls, temporary SQLite persistence, literal PNG assertions, and parent execution. Sequence Work into Verifiable Units separates the verified code increment from this evidence update. The parent reads each named principle's leaf skill in full.

## Parent verification

The parent executes the following command after the comment deletions.

```sh
npm run verify:all > .audit/report-handoff-parent-verify-all.log 2>&1
```

It exits zero. TypeScript lint, formatting, type and syntax checks, all 1,219 Node tests, Rust Clippy, Rust formatting, and all 30 Rust tests pass. There are no failures, cancellations, skips, or ignored Rust tests. Existing Rust dependency future-incompatibility warnings remain.

The full log has SHA-256 `23acde08ce08aa46c85fddfa4d59db6adbfc8e9810f9e41cb482ec079500125a`. The exit status is retained in `.audit/report-handoff-parent-verify-all.exit`.

## Writer recovery

The writer reaches its 30-minute runtime limit before delivering a final report. Its six changed files, complete diff, hash manifest, and logs remain in the checkout. No validation process remains running when the parent resumes. The parent verifies all six hashes against the retained writer manifest before starting independent review.

The writer's final focused log records 212 passing tests. Its final full log records 1,219 passing Node tests and 30 passing Rust tests. Earlier debugging logs remain under `.audit/handoff-*`. These writer results are separate from reviewer and parent execution. The timeout is not a completed writer handoff and does not establish acceptance by itself.

## Behavioral coverage and limits

The 39 new tests call faux-provider `run_check` with scripted workers and real temporary catalogue and native SQLite stores. They cover all four behavioral outcomes, literal PNG persistence and reopening, exact selection across multiple runs, strict markers, missing facts, blocked admission, failed retirement, joined and unawaited consumption, sticky retention and close failures, journal release and contention, authority races, shutdown, duplicates, and unchanged simulated completion.

The native publisher now passes the original admitted action object to checkpoint publication instead of its detached provenance snapshot. This preserves controller completion-token identity without weakening authority validation.

These checks establish offline handoff only. They do not establish actual Docker execution, containment, live cleanup, hostile same-UID authorship, monitored fixture validation, or M2 acceptance. Worker and controller commits remain separate crash boundaries. Native artifact, receipt, note, and checkpoint publication remain non-atomic.

Production main and HTTP activation remain unchanged. No worker assets, dependencies, schemas, Rust source, containment policy, monitored fixture, credentials, live services, application inference, remote publication, or deployment change. No remote is configured, so PR creation is skipped.
