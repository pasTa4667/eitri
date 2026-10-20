# Durable validator reservation and recovery inventory

## Overview

Recommend extending the existing validator journal with a non-executing reservation and inspection API. Do not add a worker coordinator or parallel cleanup database.

The bounded implementable unit is **durable validator reservation and offline recovery inventory**. It gives a future controller adapter a durable run identity before worker effects. It lets maintainers inspect interrupted execution and unresolved cleanup without contacting Docker.

This prerequisite does not dispatch workers, consume reservations, authorize controller checks, or admit native evidence.

I read the requested files completely, including source continuations after truncated reads. This design uses the supplied d932d8c checkpoint. I did not independently resolve Git HEAD or execute project commands.

throughput checkpoint: n/a, read-only investigation

## Key concepts

### Authority remains divided

The controller owns persisted actions, epochs, allowance, and frozen source selection. The validator owns worker intent, resource accounting, ownership labels, and cleanup. `WorkspaceStore` owns Git and frozen-byte integrity.

These boundaries already exist in `src/controller.ts` through `ActionSource`, `selectActionSource`, and `dispatchCheck`. `src/workspace.ts` implements `freeze` and `readFrozen`.

A reservation establishes validator-journal identity. It does not establish current controller permission.

### The journal already owns correlation

`Intent` contains the run UUID, full request, request digest, configuration digest, owner UUID, resource names, admission time, deadline, and reservation. `Ledger` records build uncertainty and resource acquisition. `Result` distinguishes pending, recorded, and settled work. See `src/frozen-browser.ts:140-162`.

The existing idempotency key is case, action, and epoch. The full request digest rejects changes under that key. See `src/frozen-browser.ts:256-257` and `validate` at line 1597.

Keep that key. Adding check kind to it would permit another execution under the same admitted action.

### Report consistency is not ownership

`admitFrozenBrowserReport` explicitly converts detached claims into scenario data, not controller admission or a receipt. Matching digests do not establish authorship or executed cleanup. See `src/frozen-browser.ts:502-505`.

A callback-supplied run UUID must therefore never substitute for lookup through the owned journal.

## How it works

### Existing flow

1. The controller persists an admitted action and selects a frozen source before callback entry.
2. `dispatchCheck` checks authority before callback effects and after callback return.
3. `FrozenBrowserValidator.validate` rejects conflicting duplicates, unrelated concurrent execution, unresolved builds, and exhausted budgets.
4. `execute` allocates and saves a run before frozen reads or Docker calls. It charges accounting in the same transaction.
5. Build and resource intents are saved before effects. Outcome is saved before cleanup.
6. `finalize` verifies ownership before removal and persists cleanup separately from outcome.
7. Startup converts pending runs to uncertain without replay, then retries cleanup.

Relevant implementation locations are `src/frozen-browser.ts:1597`, `1740`, and `2243`. Startup recovery is at lines 1507-1525.

The last step matters. Current `open` can contact Docker before returning. It is not an offline inspection API.

### Proposed change

Extract the existing initial allocation and first save into one internal reservation operation. Reuse it from the executor and a new journal-only interface.

Keep the existing owner marker, database, tables, request parser, accounting, and resource ledger. Do not introduce a separate journal class that can independently acquire ownership.

A reservation returns only after the metadata and run transaction commits. If saving fails, preserve the existing broken-journal behavior. Never return an accepted UUID before persistence.

Reuse `Result.kind === 'pending'` for reservations. The ledger already distinguishes work with no recorded resource effects from work whose effects may have started.

Add an explicit journal-only opening mode:

- Perform existing marker, inode, schema, configuration, digest, accounting, and record validation.
- Convert interrupted pending runs to recorded uncertain results, as current recovery does.
- Do not call `finalize`.
- Do not invoke Docker during opening, reservation, inspection, or close.
- Expose cleanup as unresolved until a settled cleanup record exists.

A new reservation remains pending during its journal-only session. Reopening records uncertainty, even if its ledger contains no resources. A later normal opening can finalize that run as uncertain with `not-needed` cleanup. It must not execute the scenario.

Do not add a public `complete`, `recordReport`, `markClean`, or reservation-consumption method in this unit. A later controller integration must independently establish live authority before consuming a reservation.

### Small type and API sketch

The organizing shape is an owned reservation plus a discriminated journal view. These are proposed exports.

```ts
type ValidatorOwnerId = string & {
	readonly __brand: 'ValidatorOwnerId';
};

type WorkerRunId = string & {
	readonly __brand: 'WorkerRunId';
};

type FrozenBrowserReservation = Readonly<{
	ownerId: ValidatorOwnerId;
	runId: WorkerRunId;
	request: FrozenBrowserRequest;
	requestDigest: Sha256;
	configurationDigest: Sha256;
	admittedAt: number;
	deadline: number;
}>;

type FrozenBrowserRunView = Readonly<{
	reservation: FrozenBrowserReservation;
	build: 'not-started' | 'unknown' | 'completed';
}> & (
	| Readonly<{
		state: 'pending';
		cleanup: 'unresolved';
	}>
	| Readonly<{
		state: 'recorded';
		outcome: FrozenBrowserOutcome;
		cleanup: 'unresolved';
	}>
	| Readonly<{
		state: 'settled';
		report: FrozenBrowserReport;
	}>
);

type FrozenBrowserJournal = Readonly<{
	reserve(
		request: FrozenBrowserRequest,
	): Promise<FrozenBrowserReservation>;

	inspect(
		expected: FrozenBrowserReservation,
	): Promise<FrozenBrowserRunView>;

	listRuns(): Promise<readonly FrozenBrowserRunView[]>;

	close(): Promise<void>;
}>;
```

Add overloads to the existing validator:

```ts
static open(options: {
	workspace: WorkspaceStore;
	directory: string;
	mode: 'journal-only';
}): Promise<FrozenBrowserJournal>;

static open(options: {
	workspace: WorkspaceStore;
	directory: string;
	mode?: 'execute';
}): Promise<FrozenBrowserValidator>;
```

Validate branded identifiers and hashes at public and SQLite boundaries. Inspection compares the full expected reservation, including owner, run, request, configuration, and timing. A foreign owner or run fails even when the request matches.

Return detached snapshots. Journal-only mode requires runtime enforcement as well as the narrow TypeScript return type.

Keep the existing directory-owner exclusion. Serialize new reservation and inspection operations with journal saves. Add a close admission barrier and drain accepted journal operations before closing SQLite. The existing single active executor is not itself a queue for these new asynchronous mutations.

`listRuns` remains bounded by the existing 16-attempt lifetime ceiling.

### Duplicate semantics

An exact duplicate returns the original identity and timing without another accounting charge. Reopening must not renew the deadline.

After reopening, an interrupted reservation remains interrupted. Returning its identity does not grant execution permission. Existing `validate` continues rejecting unsettled records.

Reservation consumption is explicitly deferred. Its future API must distinguish a newly admitted reservation from a duplicate and reject reservations interrupted by reopening.

## Where things live

| Location | Responsibility |
| --- | --- |
| `src/frozen-browser.ts:140-162` | Existing intent, ledger, and result shapes. |
| `src/frozen-browser.ts:1247-1250` | Exact two-table schema. Retain these tables. |
| `src/frozen-browser.ts:1292-1525` | Opening, record validation, and startup recovery. Add the journal-only branch here. |
| `src/frozen-browser.ts:1564-1595` | Transactional metadata and run persistence. Reuse this boundary. |
| `src/frozen-browser.ts:1597` | Existing duplicate and execution admission behavior. Preserve default-mode behavior. |
| `src/frozen-browser.ts:1740` | Execution. Replace its initial allocation block with the shared internal reservation operation. |
| `src/frozen-browser.ts:2243` | Owned cleanup and settled-report persistence. Do not call from journal-only mode. |
| `src/controller.ts` | Action authority, `action_sources`, frozen selection, conservative disposition, and native-detail expiry. No change in this unit. |
| `src/workspace.ts`, `freeze` and `readFrozen` | Verified immutable source selection. Reservation does not allocate exports or read source. |
| `test/frozen-browser.test.ts` | Existing synthetic validator tests. Add public journal-mode coverage here or in a focused sibling file. |

`docs/check-execution.md` states that receipts remain simulated and cancellation does not prove drainage. `docs/controller-workspace.md` separates source provenance from validation evidence. The final work-log sections retain durable cleanup correlation and native admission as open prerequisites.

## Gotchas

### Crash cases

| Boundary | Required result |
| --- | --- |
| Before reservation commit | No accepted reservation. Reopen sees either no record or a fully committed record. |
| After commit before response | Stable run identity and original timing. No second charge. Restart records uncertainty without replay. |
| Journal-only close after reservation | No Docker call and no cleanup acknowledgment. |
| Interrupted build or acquisition | Preserve the ledger and expose unresolved cleanup without daemon inspection. |
| Removal succeeds before settled save | Preserve uncertainty. Later normal recovery may inspect again and converge. |
| Settled incomplete cleanup | Preserve the exact incomplete report. Behavioral success does not override incomplete cleanup. |
| Corrupt row or replaced marker | Fail closed. Do not regenerate identity or adopt resources. |
| Close races with reservation | Drain accepted operations. Reject later admission. Never acknowledge an uncommitted reservation. |

A settled incomplete report can change after later normal cleanup recovery. Inspection is a snapshot, not permanent admission permission.

The existing unknown-build state is especially important. An empty current resource listing does not prove that late daemon effects cannot appear. Journal-only mode cannot resolve that uncertainty.

### Proposed tests

These are acceptance targets, not tests executed during this task.

1. Reserve through the public journal-only API, close, and reopen. Compare literal identity, request, original deadline, and interrupted state.
2. SIGKILL a child after reservation commit but before response. Reopen without Docker. Assert one record, stable identity, and no replay.
3. Repeat exact requests before and after reopening. Assert one accounting charge and unchanged timing.
4. Change source, role, scenario, or allowance under the same case/action/epoch. Assert conflict and unchanged durable records.
5. Inspect with a foreign owner, foreign run, configuration mismatch, or changed request. Assert rejection.
6. Mutate returned snapshots and bytes. Inspect again and assert original values.
7. Open trusted synthetic fixtures containing recorded work, unknown builds, acquisition intents, and settled incomplete cleanup. Assert preserved uncertainty and zero spawned Docker processes.
8. Race duplicate reservations, distinct reservations, inspection, and close. Assert consistent identities, accounting, and drainage.
9. Inject save failures and exhaust quotas. Assert no accepted reservation, accounting reset, or refund.
10. Preserve existing default-mode validator tests and protected worker and containment bytes.

Synthetic journal fixtures must not require a production arbitrary-report import API. They prove persistence and conservative interpretation, not actual cleanup or report authorship.

### Alternatives rejected

| Alternative | Reason |
| --- | --- |
| New controller worker coordinator and cleanup ledger | Duplicates validator ownership and creates cross-database reconciliation. |
| Trust pure-converter output | Consistency does not establish authorship or executed cleanup. |
| Add only `runId` to `CheckExecution` | Does not bind the owned store, full request, configuration, or unresolved cleanup. |
| Inspect through current `open` | Startup can call Docker. |
| Extract a second public journal owner | Expands ownership and compatibility work unnecessarily. |
| Add controller dispatch and reservation consumption now | Requires a separate authority handoff, cancellation policy, and evidence-admission design. |

### Principles applied

- **Model the Domain** changed the proposal from loose IDs and booleans to an owned reservation and discriminated recovery view.
- **Make Operations Idempotent** changed duplicate behavior to preserve identity, deadlines, and accounting. Restart records uncertainty instead of replaying effects.
- **Type System Discipline** changed journal-only opening to a narrow interface without execution or report-writing methods. Runtime enforcement remains necessary.

I read each named principle's leaf skill in full.

## Evidence and residual scope

I read `.audit/worker-correlation-plan.md`, the three requested source files, both requested interface documents, and the complete work log. I also inspected the beginning of `test/frozen-browser.test.ts` for synthetic fixture conventions.

This prerequisite does not complete controller correlation. A later unit must persist the selected validator-store association before dispatch, consume only live reservations, reject stale epochs, reconcile orphan associations without replay, and gate Retry and evidence on unresolved owned work.

No Docker execution, credentials, live inference, project commands, repository edits, or commits occurred. The requested external artifact write was blocked by the tool's workspace restriction. This complete artifact is returned for runtime persistence.