# PASS

## Review

No issues found.

The original P1 blocker is closed by the reviewed delta. Malformed envelopes no longer admit behavioral evidence or start speculative repair.

### Scope and evidence

Reviewed the supplied diff from `2646b909185a1cbb705dbb50f4d043884a2c23a6` to `4e9642b4a3ebaafad62d41b756ef7a583019d3a4`, its identity record, the original source review, selected design, actual private parser and complete added regressions.

`.audit/check-dispatch-fix-identity.txt` identifies only `src/controller.ts` and `test/check-dispatch.test.ts` as changed. It records unchanged production code in red-test commit `3d09be691eb8e6328f522902afae8dac30a10dc9` and equality between final source and the importing worktree. Committed ranges were assessed through supplied artifacts, not direct Git access.

### Correct

- The data shape remains the selected `CheckExecution` union. No public signature or ownership changes were introduced.
- All four scoped guards now compare actual own keys. Non-behavior envelopes require only `type`. Completed envelopes require exactly `check` and `type`. Receipts require exactly their six fields. Outputs require exactly `bytes`, `label` and `mime`. Counts prevent extras, including symbols, while membership prevents delimiter collisions. See `src/controller.ts:1104-1118, 1124-1129, 1146-1149`.
- Valid-result handling remains intact. Requested-kind matching, revision/configuration validation, simulated-only admission, artifact limits, byte validation/copying and normalized completed returns are unchanged. See `src/controller.ts:1130-1172`.
- Fourteen added malformed cases cover comma-containing names, inherited fields and symbol extras across the nested objects. Public Controller assertions require `invalid-check-execution`, unchanged triage/history fields, zero checks/artifacts and no follow-up provider call. See `test/check-dispatch.test.ts:511-654`.
- The newer-epoch regression genuinely invokes public Retry after the first callback times out. Before releasing that old callback, it verifies a higher epoch, distinct action, completed passing check and artifact attributed to the new action. After release, it compares the complete case, checks and artifact metadata and reads the exact new artifact bytes. See `test/check-dispatch.test.ts:656-754`.

### Fixed in the reviewed delta

The original `"check,type"` collision can no longer substitute for two required own properties. The completed-envelope guard rejects its one-key envelope before reading its inherited receipt. See `src/controller.ts:1118-1120`.

Recorded runtime evidence agrees:

- `docs/evidence/check-dispatch/key-fix-red-tests.txt:45, 72-75, 105-106` records the regression failing before the implementation fix, with 70 passes and one failure. The malformed return entered implementation and set `failedCandidate`.
- `docs/evidence/check-dispatch/key-fix-focused-tests.txt:53, 67, 98-101` records both the collision regression and genuine Retry regression passing, with 97 passes and zero failures.
- `.audit/check-dispatch-key-collision-after.txt:1-2` records the parent public reproduction returning `invalid-check-execution`, zero checks/artifacts and triage.

## Remaining verification gaps

- No edits, commits, tests, Docker runs, external actions or child launches occurred during this review.
- The original completed integrated log records 367 Node and 30 Rust passes. Those precede this correction.
- Final integrated completion was not established. `.audit/check-dispatch-final-verify-all.txt` was partial when read. This report does not claim a completed final integrated pass.

## Merge verdict

**OK with notes.** The source blocker and previously identified regression gaps are addressed. Parent integrated verification and acceptance remain outstanding.

## Principles applied

- **Model the Domain** kept the assessment within the existing execution union and private validation boundary.
- **Test Behavior, Not Implementation** required public Retry, persisted provenance and exact artifact bytes.
- **Prove It Works** separated inspected source and recorded runtime results from uncompleted integrated verification.

Throughput checkpoint is n/a, read-only investigation.