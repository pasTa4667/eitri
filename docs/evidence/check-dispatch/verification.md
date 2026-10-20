# Admitted check execution verification

Scripted adapter authors now receive the actual admitted case, action and epoch with a bounded allowance. Infrastructure, unrelated failure, cancellation, uncertainty and incomplete cleanup no longer need to masquerade as failed behavioral checks. The controller owns dispatch and conservative disposition. Native storage remains the evidence writer.

The source merge is `d9da6f648f71d87b3e3a485d15a2c297591ebaed`. It preserves the isolated implementation, failing regression and repair commits. [Source identity](source-identity.txt) confirms the imported source matches final `4e9642b4a3ebaafad62d41b756ef7a583019d3a4`. No runtime workspace or browser-validator binding was added. M2 remains incomplete.

## Design and scope

The [shared task](task.md) and [design synthesis](design.md) define the accepted contract. [Candidate A](candidate-a.md) and [candidate B](candidate-b.md) independently prefer an immutable request and returned union over a completion capability. The [cross-judge](design-judge.md) prefers A's flat identity fields. The parent agrees and grafts B's explicit unrelated-failure name and pending-pause settlement policy. The scoring is design judgment, not a runtime measurement.

`AdmittedCheckRequest` is a frozen scalar object with case ID, action ID, epoch, requested check kind, remaining milliseconds and signal. The signal itself is not frozen. `CheckExecution` has one completed variant carrying an ordinary simulated receipt and five non-behavior variants without evidence. No legacy positional overload remains.

The implementation validates persisted action authority before callback effects and again before evidence admission. It charges elapsed time, bounds remaining allowance by both case and action budgets, parses unknown results, and copies receipt data and bytes before later persistence. Exact own-key membership and count reject extra, inherited and symbol-backed substitutes.

Non-behavior results preserve phase, baseline, candidate, failed candidate, repair count and issue ownership. A running case stops in Needs attention. A pending pause keeps precedence and settles through the existing native-turn epilogue. Narrow timeout and recovery guards preserve already durable dispositions. Ordinary completed checks keep their existing repair rules, including the existing failed-baseline pause interaction.

## Completed verification

Parent acceptance command was `npm run verify:all` against the final imported source.

- [Final integrated verification](final-verify-all.txt) passes all 382 Node tests and 30 Rust tests. No tests fail, cancel or skip. TypeScript checks, both linters and both format checks pass. Existing dependency future-compatibility warnings for `block` and `proc-macro-error2` remain.
- [Focused repaired verification](key-fix-focused-tests.txt) passes 97 controller, evidence, artifact, HTTP and recovery tests. The original [24-case baseline](baseline-tests.txt) precedes implementation.
- The public controller tests prove actual persisted action correlation, frozen request isolation, capacity-two separation, rejection before callback effects, remaining allowance and late-result guards, all non-behavior outcomes with existing repair history, strict result parsing, pause and restart behavior.
- Two tests genuinely fork a child, observe a committed stop while its action row still exists, send SIGKILL, await exit and reopen the real catalogue and native store. They cover ordinary attention and pending pause without replay.
- The new Retry regression obtains a completed check and artifact in a newer epoch before releasing the old timed-out callback. It verifies unchanged case disposition, check and artifact metadata, provenance and exact artifact bytes afterward.
- [Initial source review](initial-source-review.md) found one blocker. The [fresh correction review](final-source-review.md) closes it. Initial and final [comment reviews](final-comment-review.md) report no added comments or suppressions. The source reviewers explicitly rely on supplied Git-range artifacts where their tools cannot inspect committed ranges.

The source review completed while the final integrated log was still partial. Its pending-verification note is historical. The completed parent result above supplies final acceptance. No actual Docker acceptance was rerun for this synthetic-only change. The existing browser validator, worker assets, package configuration, HTTP adapter and Rust production code are unchanged.

## Failures retained and corrected

The initial implementation is `2646b909185a1cbb705dbb50f4d043884a2c23a6`. Its [first attempted full run](worker-first-lint-failure.txt) stopped at lint because of a new-array spelling in a test. The writer changed that spelling without a suppression. Its first full run passed 367 Node tests but failed the Rust real-controller artifact test. The [failed run](worker-before-rust-fixture.txt) remains retained.

The worker found a legacy JavaScript check callback embedded in `operator/src/artifact_tests.rs`. Parent inspected and approved only its signature and completed-envelope migration. Payloads, assertions and timeouts were unchanged. [Rust verification](worker-rust-verification.txt) then passes all 30 tests. The [initial parent integrated run](initial-parent-verify-all.txt) also passes 367 Node and 30 Rust tests. None of these earlier passes is presented as proof of the later repair.

Fresh review found that comma-joining property names was not an exact-key check. A sole own property named `check,type`, together with inherited `type` and `check`, could admit malformed failed evidence. Parent [public-Controller reproduction](reproduce-key-collision.mjs) failed before the fix with this observed state in [the red output](key-collision-before.txt).

```json
{"status":"needs-attention","reason":"assessment-required","phase":"implementation","failedCandidate":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","repairs":0,"checks":1,"artifacts":0}
```

Red regression commit `3d09be691eb8e6328f522902afae8dac30a10dc9` changes tests only. Its [test run](key-fix-red-tests.txt) has 70 passes and one failure. Green repair `4e9642b4a3ebaafad62d41b756ef7a583019d3a4` changes four guards in the existing private parser to compare actual key count and membership. It adds no interface, helper module or lifecycle change. Fourteen malformed-object cases and the newer-epoch regression extend the tests.

The identical reproduction passes against the repaired imported source. [Green output](key-collision-after.txt) records the following state.

```json
{"status":"needs-attention","reason":"invalid-check-execution","phase":"triage","failedCandidate":null,"repairs":0,"checks":0,"artifacts":0}
```

Run `node docs/evidence/check-dispatch/reproduce-key-collision.mjs .` to repeat that check. It creates and removes only its own synthetic temporary data. The complete [fix report](key-fix.md) distinguishes red, focused green and final integrated acceptance.

Committed logs normalize whitespace only. The two complete parent logs and corrected Rust log omit one trailing empty line each. The red regression log removes spaces from two otherwise empty assertion lines. Original outputs remain in the parent's `.audit` directory, the isolated writer's `.audit` directory and `/tmp/check-dispatch-key-fix-red.log`. Raw review reports retain their original runtime paths, with corresponding artifacts copied beside this document.

## Throughput and decision trail

Grounding reused the unchanged-source analysis from the prior integration. Two read-only designers and a cross-judge selected the interface before implementation. One isolated writer owned the coupled source migration. A fresh writer fixed the reproduced review defect within two files. Parent alone imported source, ran integrated acceptance and owned the documentation and append-only [decision trail](../../../decisions.tsv).

Model the Domain and Type System Discipline selected exclusive outcomes. Boundary Discipline put parsing beside controller authority. Laziness Protocol rejected completion capabilities and compatibility overloads. Separate Before Serializing Shared State isolated source ownership. Fix Root Causes replaced ambiguous key serialization throughout the parser. Test Behavior, Not Implementation required public Controller effects and actual process crashes. Sequence Work into Verifiable Units preserved the red test before its green fix. Prove It Works required parent reproduction and complete integrated verification rather than accepting worker pass counts.

## Limits and remaining work

The result is VERIFIED for this internal scripted interface. Every receipt remains simulated. There was no real fixture modification, project Node execution, credential lookup, live service or provider, GitHub write, deployment or containment change. No generated execution was enabled.

Remaining allowance is a dispatch-time snapshot, not a worker cleanup guarantee. Underlying asynchronous work can outlive timeout. Existing artifact persistence remains non-atomic across blobs, manifests and receipts. Already committed evidence is not rolled back on a later cancellation. Reliable completed failed-baseline behavior during a pending pause remains unchanged and explicitly tested.

Controller-owned workspace lifecycle, frozen revision selection, real-report admission and durable worker cleanup correlation remain separate work before actual browser dispatch. This unit does not complete M2 or later human-presence gates.

The [final evidence and decision-trail audit](evidence-audit.md) passes with no blocking discrepancy or material overclaim. It independently checks Git ancestry and bytes, raw logs, the reproduction, source, regressions and authorized session checkpoints. Earlier tracked evidence and decision rows are unchanged. All configured roles used `openai-codex/gpt-6.1-sol`. Same-family review is recorded, not cross-family assurance.
