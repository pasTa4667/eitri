## Review

- Correct. Invalid-clock aborts now reject the interruption promise even when `stopCheck()` throws. The aborted catch returns `uncertain`, and the listener is removed. See `src/controller.ts:1343-1375`.
- Correct. Public Tx methods preserve the result payload, timestamp, request ID and settled write record. See `src/native.ts:228-258` and installed SDK `dist/types.d.ts:724-744`.

### Finding P1. Retry can still revoke confirmation during transaction preparation

**Location.** `src/native.ts:244-258`.

The admission guard precedes two awaited operations. Retry can commit while `appendEntry()` or `createSubmission()` is pending. The callback then completes without another guard, committing the stale result. The guard at line 263 runs after persistence.

**Source-derived repro.** Wrap the public commit callback's `tx.appendEntry()` for `eitri.action-result`. Call the real method, then gate its fulfillment. Commit Retry through `controller.command()`, wait for `after-command-commit`, and release the gate. The staged result and submission persist despite revoked confirmation. No inaccessible SDK operations are needed.

**Smallest fix.** Recheck authority after `createSubmission()` inside the commit callback so revocation rejects and discards the staged writes. Add this interposed-await regression. The existing test gates admission before the callback, not during its awaited operations.

- Comments. No added comments or suppressions in the four-file patch. Deletions and `MUST KILL` flags total zero.
- Runtime limitations. Read-only tools prevented execution and independent hash recomputation. The supplied green artifact records three passing tests, but not the interposed-await repro. No full suite was duplicated.
- Principle applied. **Prove It Works** drove inspection of the installed public Tx contract and transaction staging implementation.

**Merge verdict. BLOCK pending the P1 correction or a targeted repro disproving it.**