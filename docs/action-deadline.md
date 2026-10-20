# Admitted-action deadlines

## Endpoint and allowance

Each admitted action has one exclusive endpoint in the controller clock domain.

```text
D = action.startedAt + action.limitMs
remainingMs = max(0, min(currentCase.remainingMs, D - now))
```

Admission uses one clock sample for charging the case and recording `startedAt`. Model actions have a maximum limit of 120,000 ms. Tool actions have a maximum limit of 60,000 ms. The available case allowance can shorten either limit. Equality with D is expired, even if no timer callback has run.

`AdmittedCheckRequest.deadlineAt` is D. Its frozen `remainingMs` is a callback-entry sample, not a renewable duration or permission for future execution. Source preparation and worker-intent hooks consume the original action's time. The controller samples again after those hooks, immediately before callback entry. Expired preparation produces no callback invocation.

Persisted `Action` and nested action-source action JSON keep their existing fields. The endpoint is derived, not stored. Unsafe endpoint addition fails with `invalid-action-state`.

## Authority and completion

The controller authenticates the complete persisted action and its epoch before charging the case or authorizing effects. Assessment and checkpoint transitions authenticate within their mutation transaction, after asynchronous preparation. Native guards result notes, evidence writes, and successful model publication. Pending pause denies new provider, callback, source, and acceptance entry. An already-entered ordinary check can still settle within both budgets. Timeout preserves pause precedence. A failing baseline retains its existing attention behavior during pending pause.

A committed assessment, checkpoint, or check stop can revoke its own action epoch. A private completion marker binds that exact admitted action object to the committed case epoch, attempt, status, and version. `mayRecordCompletion()` permits only the existing bounded action-result bookkeeping and retirement. It does not authorize evidence, execution, source access, acceptance, or another control effect. Retry or another superseding control change invalidates the marker. Old retirement can remove only its exact action and settle its source history; it cannot charge or save a newer case epoch.

Successful model terminal publication follows synchronous controller authorization and retirement without an intervening watcher or fault hook. Receipt notification now follows terminal publication and stream closure. Notification errors cannot retract an already-published model result. Tool receipt hooks remain after retirement and before tool completion returns. Retirement is attempted once on each native path.

## Clock and wakeups

Controller clock values are nonnegative safe integers and nondecreasing within one controller instance. Invalid or backward samples fail with `invalid-clock`. There is no persisted monotonic clock comparison across restarts. Artifact, note, and worker acceptance timestamps retain their existing clock conventions.

Native model and tool actions share one private lifetime helper. It owns the cancellation signal, a cancellable wakeup, synchronous allowance guards, and disposal. Wakeups use fresh remaining time. Early wakeups rearm rather than manufacture expiry. Canceled or duplicate delivery cannot affect another generation or action. Sampling errors abort only that lifetime.

`Controller.open()` accepts an optional deterministic wakeup dependency.

```ts
actionWakeup?: (delayMs: number, callback: () => void) => () => void;
```

The returned function cancels that wakeup. The default uses `setTimeout` and `clearTimeout`. Tests control logical clock advancement separately from wakeup delivery. A frozen custom clock plus real sleep does not establish expiry. Synchronous guards reject late effects even when wakeup delivery is withheld.

## Recovery and worker history

Restart does not recreate lifetimes or replay callbacks. Unresolved actions retain conservative recovery charging.

```text
cost = min(case.remainingMs,
           max(0, action.limitMs - (case.usedMs - action.usedAtStart)))
```

Reopening before or after D does not refund this reservation. Interrupted-tool uncertainty and pause precedence remain unchanged.

Canonical worker requests, digests, journal versions, acceptance quotas, and acknowledgment bytes are unchanged. The historical worker acknowledgment deadline remains `acceptedAt + request.allowanceMs`. It can differ from D and grants no execution authority. Retained worker intent keeps its preparation-time allowance even when the callback-entry sample is smaller. Accepted keys remain non-executable through `validate()`.

## Limits and tests

Cancellation remains cooperative. These guards do not establish drainage, hard realtime interruption, distributed atomic authorization, worker consumption, real receipts, or production activation. A storage commit can cross D after its final synchronous authority sample. Evidence already committed before a later revocation is not rolled back.

`test/action-deadline.test.ts` covers admission, native wakeups, exclusive expiry, metadata-delayed assessments, self-transition bookkeeping, Retry isolation, complete identity authentication, and legacy recovery. `test/action-deadline-entry.test.ts` covers source and intent preparation boundaries and exact historical acceptance bytes. Existing check, controller, workspace, acceptance, association, artifact, and recovery suites retain their pause and storage-order regressions.
