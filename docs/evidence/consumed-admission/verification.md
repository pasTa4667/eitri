# Consumed-report conversion verification

## Accepted source

Source commit `0a13199` adds the pure consumed-history converter. It changes only `src/frozen-browser.ts`, `test/frozen-browser-consumed-admission.test.ts`, and `test/frozen-browser-consumed-report.test.ts`. The [source identity](source-identity.txt) records full commit identity, file hashes and patch hash. Integrated executable and test bytes match the final isolated worktree. No executable working-tree diff remains after verification.

## Design and review

Two independent GPT sketches compare flat and nested expectations. Both score 10/10 against ordinary compatibility, independent correlation, strict detachment, shared validation and a small pure boundary. Parent and cross-judge choose the flat expectation because it needs fewer public wrappers. The [design](design.md) records the contract and graft preserving ordinary validation ordering. Model the Domain shaped the expectation and existing behavioral-or-blocked result. Prove It Works required real temporary-journal and byte assertions.

Fresh GPT [source review](source-review.md) passes with no findings. The [comment audit](comment-audit.md) recommends zero deletions or suppressions. Two subsequent test-only additions assert literal outcomes and reject corrupt PNG bytes with recomputed size/digest. A fresh [final test review](final-test-review.md) passes on those additions. Converter and historical-retrieval test hashes do not change between source review and final verification. The final new-test hash is `95903f6e3ce67fabc608be99da034be71b721150622363a2291e2f878d41c33c`.

All delegated roles use `openai-codex/gpt-6.1-sol`. This is fresh-context independence, not cross-family assurance. Reviewers have source-inspection tools but no execution tool. Runtime results and hashes come from the parent and implementation owner, not independent reviewer execution.

## Executed checks

| Check | Actual result | Evidence |
|---|---|---|
| Parent baseline ordinary admission | 134 tests pass before mutation | Local `.audit/consumed-admission-baseline-tests.txt` |
| Parent initial focused conversion, ordinary admission and retrieval | 274 tests pass before final test-only additions | Local `.audit/consumed-admission-parent-focused.txt` |
| Parent initial `npm run verify:all` | 995 Node and 30 Rust tests pass before final test-only additions | Local `.audit/consumed-admission-parent-full.txt` |
| Parent final focused conversion, ordinary admission and retrieval | 275 tests pass | [Final focused log](parent-focused.txt) |
| Writer final `npm run verify:all` | 996 Node and 30 Rust tests pass | [Writer full log](writer-full.txt) |
| Parent first final `npm run verify:all` | 994 of 996 Node tests pass, two fail; Rust stages do not run | [Failed full log](parent-failed-full.txt) |
| Parent unchanged failing suites, without overlapping full runs | 72 tests pass | [Timeout recheck](timeout-recheck.txt) |
| Parent integrated `npm run verify:all` at `0a13199` | 996 Node and 30 Rust tests pass | [Integrated full log](parent-full.txt) |

Retained log copies remove only trailing whitespace and final blank lines for Git whitespace checks. Original raw parent logs remain in the local `.audit` directory. The raw writer log remains in the retained implementation worktree's `.audit` directory.

Passing final runs have no failed, cancelled or skipped tests. Full verification includes TypeScript/JavaScript lint, formatting and type checks, Rust lint and formatting, and operator tests. Existing Cargo future-incompatibility warnings name `block 0.1.6` and `proc-macro-error2 2.0.1`.

The first focused writer attempt fails because its new no-effects test enumerates methods by reading an existing prototype getter. Descriptor inspection repairs the test. The [writer history](writer-history.txt) distinguishes this attempt, the initial full pass and final additions. The final test-only changes do not modify converter logic.

The parent's first final run overlaps the writer's full verification and fails two unchanged timing-sensitive assertions. The invalid-clock positive-control subprocess reaches its one-second kill without the expected stdout. The artifact-resource case-count check exceeds its five-second settlement allowance. Their source and runtime dependencies remain unchanged. Both suites pass together without overlapping full runs, and the subsequent integrated full run passes without any code change. Scheduling pressure is an inference, not a proven root cause. The failed run remains recorded and is not counted as a pass.

## Behavioral evidence and limits

The actual temporary SQLite journal tests consume and retrieve shortened baseline history with both successful and incomplete cleanup. Literal assertions cover outcome, original allowance/digest, pinned actual timing and exact PNG bytes. Ordinary conversion still rejects the shortened report. Files, journal rows and scripted worker calls remain unchanged around retrieval/conversion.

Unknown-input tests cover strict structures, selector/request/configuration/timing mismatches, unsafe intervals, evidence validation, blocked precedence, null evidence, safe high endpoints, accessors/proxies, snapshot limits and detached outputs. Scripted external effects are not real Docker execution.

No production main, controller, native, HTTP, workspace, worker asset, Rust, dependency, schema or containment change occurs. No monitored fixture edit, credential access, service activation, application inference, publication or deployment occurs. No remote is configured, so PR creation is skipped and delivery remains local. Native real-check admission, controller retrieval correlation, actual fixture validation and M2 acceptance remain open.

## Reproduce

Run these commands from the repository root at the accepted source.

```sh
node --test test/frozen-browser-consumed-admission.test.ts test/frozen-browser-admission.test.ts test/frozen-browser-consumed-report.test.ts
npm run verify:all
git diff 17c87f3 0a13199 --name-only
shasum -a 256 src/frozen-browser.ts test/frozen-browser-consumed-admission.test.ts test/frozen-browser-consumed-report.test.ts
```
