# Offline accepted-request consumption

## Controller configuration

`Controller.open()` accepts optional `offlineWorkerConsumption?: true`. Only absence and literal `true` are valid. Consumption requires `offlineWorkspace`, the independently pinned `offlineWorkerJournal`, and `offlineWorkerAcceptance: true`. The controller snapshots configuration before asynchronous work.

Only `baseline` and `browser` callback sources receive frozen `workerConsumption`. Callbacks explicitly complete acceptance before consumption.

```ts
await source.workerAcceptance.accept();
const result = await source.workerConsumption.consume();
```

`consume()` takes no arguments. Callers cannot replace the request, acceptance, owner, configuration, signal, allowance, deadline, or authority guard. Mutating a detached acknowledgment does not change the captured acceptance. Missing or unfinished acceptance rejects instead of implicitly accepting.

The result contains `acceptanceId` and a detached terminal `RecoveryRun`. It includes outcome and historical cleanup, but no evidence bytes, PNG, artifact output, or native receipt. It cannot be passed off as a simulated completed check.

## Current authority and timing

The controller authenticates the complete persisted action, epoch, strict running status, native and workspace readiness, callback lifetime, signal, selected source, retained intent, and positive case and action allowance. Pending pause denies new consumption. Current-completion permission grants no worker authority.

Preparation consumes the original [admitted-action endpoint](action-deadline.md). The original request allowance and historical acceptance deadline grant no current execution time.

The worker translates a fresh remaining duration into one immutable worker deadline T. It samples worker time before controller allowance and caps that duration by the original request allowance. It validates safe-integer arithmetic and nondecreasing worker samples.

After SQL staging and at every forward boundary, an ordered sampling bracket derives an effective deadline H.

```text
B = worker time before the synchronous authority sampler
R = positive current controller allowance
A = worker time after the sampler returns
H = min(previous H, T, B + R)
```

`A < H` is required. Equality is expired. The bracket charges sampler work without assuming simultaneous clock observations. A later larger allowance cannot extend H or T. New client timeouts are bounded by H, and consumption cancellation tightens without moving its endpoint later.

The post-staging check precedes synchronous COMMIT without another await or caller hook. Denial rolls back admission and accounting. Persistence can cross the last synchronous authority sample. This is not distributed atomic authorization or hard realtime interruption.

## Worker journal and recovery

The worker boundary adds independently pinned `mode: 'consumption-only'`. It exposes `accept`, `consume`, `inventory`, and `close`, not ordinary `validate`. The controller retains this handle inside a callback-scoped owner.

The first committed consumption admission lazily upgrades metadata to version 3. One transaction replaces the original logical action row with a consumed-acceptance record and charges one attempt and one existing context reservation. The nested record retains the complete original acceptance and one pending execution with explicit admitted timing. No controller consumption ledger or second acknowledgment is stored.

Versions 1 and 2 keep their existing strict parsers. Existing ordinary execution still requires its full request-duration timing. Consumed execution uses its explicit shortened admission ceiling. `admitFrozenBrowserReport()` remains unchanged and does not admit this shortened consumption as an ordinary report. Old binaries reject version 3.

Concurrent exact retries join one execution and charge once. A later existing pending consumption rejects with `validator-unsettled`, without execution. Recorded or settled consumption returns detached history. Original acceptance retries return the original acknowledgment. Ordinary `validate()` continues rejecting accepted action keys. Missing or conflicting identity, exhausted quota, unknown build, or unresolved cleanup prevents fresh consumption.

The [association observation](worker-association.md) preserves the original acceptance fields with optional nested `consumption`. An active consumption has an explicit detached pending state. Recorded and settled executions retain outcome and cleanup history. Inspection uses the held journal without waiting for execution settlement or reopening its exclusive lease.

Reopening pending consumption durably records `interrupted-run-no-replay` uncertainty with null evidence. It does not execute the request again. Journal-only, acceptance-only, and consumption-only opening do not finalize historical cleanup. Default standalone execution opening retains its existing cleanup behavior. Historical observation never restores callback authority.

## Live admission observation

Low-level `consume` accepts an optional fourth argument, `FrozenBrowserAdmissionObserver`. Its detached observation contains `acceptance`, `consumedRun`, `admittedAt`, and `deadline`. Only a newly committed admission notifies its initiating observer. Joined callers and existing or recovered records do not notify.

The observer must synchronously return `undefined`. A throw or invalid return prevents entry into execution, frozen reads, result recording, and cleanup. The charged pending admission remains committed. Raw journal closure releases resources without repeating the observer failure. Worker-only callers can omit the observer and retain their existing offline behavior.

Controller-owned consumption always supplies its private observer. It transactionally retains [independent execution facts](controller-worker-history.md#controller-retained-live-execution-facts) before execution. It never retains facts from a successful historical return. The scope caches retention failure and reports it through controller drainage after releasing the journal. Admission facts do not prove execution started or completed. The [admission-retention verification record](evidence/admission-retention/verification.md) records the temporary-store, authority, and crash checks.

## Cancellation and ownership

The controller registers an ephemeral scope before callback entry. It owns lazy journal opening, captured acceptance, one consumption promise, cancellation, and drainage. It stores no durable accounting.

Callback return, throw, interruption, authority loss, pause, and controller close revoke forward work. Returning without awaiting consumption does not release the journal while admitted work can still mutate it. Execution does not occupy the controller workspace queue. Accepted inspection has separate drainage.

Repeated close calls share completion. Controller close includes pending opens and waits for worker settlement, journal closure, and accepted inspections before closing workspace storage. It does not require arbitrary callback code to return.

Cleanup has its existing separate bounded allowance. It can settle cancelled or uncertain work after forward authority ends. Unknown builds, unresolved acquisition, and incomplete cleanup remain durable. Local client closure and a settled cleanup record do not establish Docker daemon drainage or physical cache reclamation.

## Scope

This is an opt-in offline library handoff. The later [targeted cleanup command](worker-cleanup.md) reconciles historical cleanup for one consumed run without restoring callback authority. Its synthetic verification does not establish actual daemon cleanup. The separate [historical report query](worker-reports.md) retrieves retained consumed reports without recovery or worker effects. Production main remains unwired. Native real-check admission, trusted live cleanup reconciliation, actual fixture validation, and M2 acceptance remain separate work. No new HTTP or native UI capability enables it.

The [verification record](evidence/worker-consumption/verification.md) distinguishes actual temporary-store and subprocess checks from scripted external effects. Same-UID hostile writers, arbitrary unobserved clock changes, power-loss durability, and hard realtime interruption remain outside the established guarantee.
