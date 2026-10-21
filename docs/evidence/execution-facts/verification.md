# Controller live execution facts verification

## Implemented scope

Source commit `c8122e32c3b2dc7ef537288a9c494fdb9c59317b` retains successful live consumption identity and actual timing in existing controller action sources before callback delivery. The [reference](../../controller-worker-history.md#controller-retained-live-execution-facts) describes the API and failure semantics.

Two independent GPT sketches compare embedded facts with a separate catalogue table. The parent and fresh GPT cross-judge select embedded facts. A separate table and schema migration add no required trust boundary. The selected design incorporates strict binding checks, validation before historical selection, and failure memory at both scope and controller drainage layers.

Model the Domain determines the typed facts record and retained/unavailable union. Laziness Protocol keeps existing action-source storage and metadata binding. Sequence Work into Verifiable Units puts grounding and type checks before implementation, followed by focused tests, review, and full verification. Prove It Works requires the parent to run the actual tests and compare the reviewed bytes.

## Reproducible checks

The parent runs these commands on the reviewed source bytes.

```sh
node --test test/controller-worker-execution-facts.test.ts test/worker-execution-scope.test.ts
npm run verify:all
shasum -a 256 -c docs/evidence/execution-facts/source-identity.txt
```

- [Parent focused output](parent-focused.txt) records 23 passing tests, with zero failures, cancellations, or skips.
- [Parent full output](parent-verify-all.txt) records passing lint, formatting, type and syntax checks, 1,047 passing Node tests, and 30 passing Rust tests. No tests fail, cancel, skip, or remain ignored.
- The [identity manifest](source-identity.txt) matches all four reviewed source and test files before and after parent full verification.

The tracked parent full log omits one terminal blank line to pass `git diff --check`. Its raw output remains unchanged in `.audit/execution-facts-parent-verify-all.txt`. No result line changes.

The writer separately passes 63 focused tests and the complete 1,047 Node and 30 Rust suite. Its local logs remain in `.audit/execution-facts-focused.txt` and `.audit/execution-facts-verify-all.txt`. Existing Rust dependency future-incompatibility warnings remain.

## Review

The [fresh GPT correctness review](code-review.md) passes with no blockers. Its tool permissions allow source inspection but not execution or hashing. It explicitly attributes those checks to the parent. The [comment audit](comment-audit.md) finds no added comments or suppressions and requires no deletions.

The [final evidence audit](evidence-audit.md) passes without material flags or corrections. It checks the parent transcript, retained logs, source identities, review limitations, and checkpoint claims without rerunning tests.

Grounding, design, implementation, and review use `openai-codex/gpt-6.1-sol`. These are fresh contexts within one model family, not cross-family assurance.

## Failed intermediate checks

The writer records initial type-narrowing and test-only typing failures in `.audit/execution-facts-unit1-*`, `.audit/execution-facts-unit3-*`, and `.audit/execution-facts-unit4-*`. Two intermediate facts runs pass 12 tests and fail 3 because test expectations use a fixed acceptance ID instead of the actual acceptance. A failed local edit leaves the second run unchanged. Corrected tests pass.

A direct scope regression first passes 2 tests and fails 4. It exposes expected journal-opening authority revocation incorrectly becoming failed drainage. The implementation now distinguishes those revocations from real opening and retention failures. The red output remains in `.audit/execution-facts-scope-revocation-before.txt`. None of these attempts is counted as a passing final run.

## Evidence limits

Tests use real temporary SQLite and Git stores. External worker commands remain scripted. SQLite triggers inject persistence failures. Parent tests verify committed facts before callback delivery, restart retention, append conflicts, unchanged authority rules, detached reads, no historical backfill, and remembered drainage failure.

Capture covers successful live worker returns, not every committed admission. Worker rejection or process death before controller commit can leave pins unavailable. Worker and controller writes are not atomic. Inspection does not acquire the journal, but controller startup still inventories it.

No converter call, native real-check admission, production or HTTP wiring, table or schema change, dependency change, monitored fixture edit, credential access, live service, application inference, Docker dispatch, containment change, publication, or deployment occurs. M2 and later human-presence gates remain open. No remote is configured, so delivery remains local.
