# ISSUES

## Review

Reviewed `.audit/action-deadline-review.patch` against the corresponding source and installed SDK implementation.

- Correct. The endpoint is derived without changing persisted `Action`. Callback requests contain frozen scalar deadlines. Assessment and checkpoint mutations authenticate their action within their controller transactions. Stale retirement avoids charging a newer epoch. See `src/domain.ts:157-171`, `src/controller.ts:1317-1330`, `src/controller.ts:1394-1436`, `src/controller.ts:1445-1483`.

### Finding P1. Timer sampling errors can escape through the check abort listener

**Locations.** `src/native.ts:660-668`; `src/controller.ts:1343-1345`, `src/controller.ts:1225-1233`.

The new lifetime catches a sampling error and calls `abort.abort(error)`. During `run_check`, the abort listener synchronously calls `stopCheck()` before rejecting its interruption promise. `stopCheck()` samples the clock again through `charge()` or `attention()`. If the clock remains invalid, that call throws from the AbortSignal listener. Node reports listener exceptions as uncaught exceptions, outside the lifetime's catch.

**Concrete reproduction.**

1. Start a `run_check` callback that waits on a gate.
2. Set its custom controller clock from `1000` to `-1`.
3. Deliver the registered action wakeup.
4. Leave the clock invalid through abort delivery.

The sampling-error path can terminate the controller process instead of aborting only that lifetime.

**Missing coverage.** `test/action-deadline.test.ts:665-709` exercises model and `probe` operations. Neither installs the check-specific abort listener. Its synchronous `assert.doesNotThrow()` also cannot detect Node's deferred uncaught listener exception.

**Smallest fix.** Contain errors from `stopCheck()` inside the abort listener and always reject the interrupted operation. Add a subprocess regression using an active `run_check`, requiring process survival after another event-loop turn.

### Finding P1. Retry can revoke authorization while an old result note is queued

**Locations.** `src/native.ts:223-228`, `src/native.ts:552-576`.

The result-note guard runs before `await native.note(...)`. That method uses `root.submit()` without passing any authority guard into native admission. The installed SDK queues admission on its mutation line and later appends the display-only entry. See `node_modules/@earendil-works/pi-durable/dist/harness/submissions.js:31-33,129-145` and `node_modules/@earendil-works/pi-durable/dist/session/session.js:154-161`.

Consequently, a Retry committed while the note waits in that queue does not prevent the old `eitri.action-result` write. The guard at line 228 detects revocation only after the misleading bookkeeping is durable.

**Concrete reproduction.**

1. Complete an assessment that enters attention and receives completion confirmation.
2. Hold a real native `root.commit()` barrier ahead of the action-result submission, after its first authorization.
3. Issue Retry without awaiting its native note delivery. Wait for `after-command-commit`.
4. Release the native barrier.

The queued old action-result entry has no admission-time authorization check and is appended despite Retry.

**Missing coverage.** `test/action-deadline.test.ts:350-447` interposes Retry before the first result-note guard. It does not interpose Retry while native note admission is queued.

**Smallest fix.** Revalidate current-or-confirmed completion authority on the native mutation line immediately before admitting the result entry. Preserve existing idempotency and storage formats. Add the queued-note Retry regression, asserting that no old action-result entry appears.

## Verification

These findings follow from source and SDK control flow. I did not execute tests because this reviewer has no command-execution tool.

After adding the regressions, run the bounded deadline and check-dispatch tests. The **Prove It Works** principle drove direct source and SDK inspection rather than reliance on reported green checks.

- Merge verdict. **BLOCK**.