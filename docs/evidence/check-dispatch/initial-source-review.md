# ISSUES

## Review

Reviewed `2646b909185a1cbb705dbb50f4d043884a2c23a6` against `c045082` using the supplied identity record and complete implementation diff, then inspected the actual production files and every changed test. Committed ranges are not directly available through these tools.

### Correct

- The data shape matches the selected design. `AdmittedCheckRequest` contains detached scalar authority and a signal. `CheckExecution` distinguishes completed checks from five non-behavior outcomes. See `src/domain.ts:121-135`.
- Dispatch compares every persisted Action field, verifies case/epoch/status/native authority, charges elapsed time, and calculates the lesser remaining allowance. The callback receives a frozen request. See `src/controller.ts:513-540, 578-599`.
- Completed receipts are validated and copied before subsequent authority checks. `validateOutput` copies bytes with `Buffer.from`. Native persistence retains signal and authority guards. See `src/controller.ts:614-627, 1099-1166`, `src/artifacts.ts:26-43`, and `src/native.ts:436-440`.
- Non-behavior outcomes bypass `recordCheck` and checkpoint processing, terminate the native turn, and preserve pending pause. Settlement and recovery preserve existing conservative dispositions. See `src/native.ts:264-275` and `src/controller.ts:555-573, 638-657, 890-914`.
- All callback callers found by the cross-file search are migrated or intentionally reject execution. The embedded JavaScript migration preserves its fixture payloads and assertions. See `operator/src/artifact_tests.rs:25-30`.
- The new tests exercise public Controller operations with temporary catalogue/native SQLite stores and literal observable assertions. They cover identity, immutability, capacity-two isolation, denied dispatch, repair-history preservation, malformed returns, timeout, pause and restart. See `test/check-dispatch.test.ts:85-731`.
- Crash tests genuinely fork a worker, block after the durable stop, send `SIGKILL`, await exit and reopen storage. See `test/check-dispatch-crash-worker.ts:24-28` and `test/check-dispatch.test.ts:592-661`.
- Ordinary completed receipt and repair behavior remains exercised by the migrated evidence tests and passing/failing baseline pause tests. See `test/evidence.test.ts:120-304` and `test/check-dispatch.test.ts:663-698`.

### Finding

**P1. The completed-result key guard accepts malformed envelopes and admits their behavioral evidence.**

Location is `src/controller.ts:1103, 1117-1119`.

The guard serializes property names with commas. A single own property named `"check,type"` produces the same string as the required two properties. The parser then reads inherited `type` and `check` values.

A configured callback can return this object through the public API:

```ts
Object.assign(
  Object.create({
    type: 'completed',
    check: {
      kind,
      candidate: 'a'.repeat(40),
      configuration: 'b'.repeat(64),
      passed: false,
      simulated: true,
      outputs: [],
    },
  }),
  { 'check,type': true },
)
```

Its only own key is an invalid extra field. Nevertheless, the parser accepts it as completed. Native records the failed check, and a browser check sets `failedCandidate` and enters implementation through `src/controller.ts:680-686`.

This contradicts the required fail-closed handling of malformed callback returns. The defect is introduced by the new parser.

The smallest fix is to compare actual key membership and count, not comma-joined strings. Require exactly the own keys `type` and `check`. Add this input to the public Controller malformed-result tests and assert `invalid-check-execution`, no evidence, and unchanged repair state.

### Fixed

None. This review was read-only.

## Validation gaps

- No tests, Docker commands or external actions were run during this review. The reported 82 focused, 367 Node and 30 Rust passes remain worker-reported results, not independently executed verification.
- Parent integrated `verify:all` acceptance remains pending. This report does not declare it complete.
- The late-result tests resolve old callbacks only while the case remains stopped. They do not retry or continue into a newer epoch before releasing the old callback. See `test/check-dispatch.test.ts:511-590`. Add that public-API regression to prove new-epoch safety directly.
- The malformed-result matrix lacks the property-name collision above. See `test/check-dispatch.test.ts:430-480`.

## Merge verdict

**BLOCK.** Correct the malformed-envelope admission and add its regression test. Then obtain parent integrated verification.

The validator remains unwired. No broader timeout rewrite or validator activation is recommended.

## Principles applied

- **Test Behavior, Not Implementation** shaped the test assessment. Public Controller effects, persisted evidence and real process death counted as proof, not private-method assertions.
- **Prove It Works** shaped the verification claims. Actual source and supplied Git evidence were inspected; worker pass counts were not treated as completed integrated verification.

Throughput checkpoint is n/a for this read-only investigation.