# Controller workspace design decision

## Decision

Select Candidate A. Add Candidate B's catalogue-side operation serialization and internally allocated edit request IDs.

For trusted offline callers, each case receives its own workspace binding. Each admitted check receives an immutable frozen source selection. Later edits cannot change that selection. Existing unconfigured callers and production main remain scripted.

The next maintainer inherits one controller authority owner, one Git owner and two new catalogue tables. There is no coordinator class, separate database or controller edit ledger.

The parent explicitly selected this contract. Its reply appears below.

Throughput checkpoint is n/a, read-only investigation.

## Review

- Correct. Both candidates preserve Controller action authority and reuse WorkspaceStore for Git and frozen-byte integrity. Both propose real temporary Git and SQLite tests through public Controller.
- Fixed. No files were changed. The selected synthesis resolves the design differences before implementation.
- Finding. P1 in Candidate B's unmodified design. Its captured handles reject after action settlement but lack A's explicit callback-lifetime revocation. Candidate B, lines 246–250, authorizes operations from the live Action. That Action can remain live after the callback returns while native persists its result. See `src/native.ts:267–269` and `src/native.ts:436–522`. Retained handles could therefore admit additional source operations during that interval. The smallest correction is A's lifetime flag, revoked in `finally`, including abort races. This is included in the selected contract.
- Merge verdict. OK with notes for the synthesized design. Implementation and runtime acceptance remain unverified.

## Rubric scores

Scores assess proposal completeness, not executed implementation. Five means the proposal fully addresses the criterion on paper.

| Authoritative criterion | A | B | Evidence and assessment |
| --- | ---: | ---: | --- |
| 1. Preserves action and epoch authority without callback-supplied paths or revisions. | 5 | 4 | A's “Select” and “Edit” sections capture exact Action authority, revoke callback handles and require implementation phase for edits. B captures Action authority but omits explicit callback-lifetime revocation. Neither permits callback-supplied frozen selections. Edit revision and virtual path are preconditions for an edit, not selection authority. |
| 2. Uses WorkspaceStore integrity and frozen bytes without another Git owner. | 5 | 5 | Both reuse `inspect`, `freeze`, `readFrozen` and `edit`. Neither requires another Git implementation. Their proposed associations supplement WorkspaceStore's existing frozen tuple. |
| 3. Handles cross-store crashes and missing or foreign state without replay or reset. | 4 | 5 | A retains provisioning and selection intent/receipt states and historical source records. B more explicitly serializes catalogue-side sequences and describes edit-effect receipt gaps. Its extra edit ledger is conservative but unnecessary for the selected bounded unit. |
| 4. Small interface with no new agent, HTTP or operator authority. | 4 | 3 | A adds one optional configuration and one callback capability. B adds another callback route, a coordinator interface, editable-path configuration and a third association table. Both keep model and HTTP authority unchanged. |
| 5. Proves A/B and restart behavior through public Controller with real Git and SQLite. | 5 | 5 | Both “Tests” sections cover public admission, A/B reads, later selection, restart, foreign state and actual process crashes. Neither report claims those proposed tests were executed. |
| **Total** | **23/25** | **22/25** | **A is the smaller base. B contributes explicit serialization and internal edit IDs.** |

### Grounding behind the decision

- `src/controller.ts:443–455` currently provisions only native state. Workspace readiness must not inherit its early return.
- `src/controller.ts:513–550` compares the exact persisted tool Action and epoch. This remains the authority gate.
- `src/controller.ts:575–646` owns callback dispatch and post-callback validation.
- `src/controller.ts:647–662` deletes live Action rows. Historical selections therefore need independent lifetime.
- `src/controller.ts:847–947` performs conservative recovery. Its existing catch marks native storage missing, so workspace errors need separate disposition.
- `src/workspace.ts:1287–1425` journals provisioning and rejects duplicate provisioning.
- `src/workspace.ts:1458–1575` owns edit intent and receipts.
- `src/workspace.ts:1576–1627` freezes only the expected current revision, then reads recorded frozen bytes independently of the current checkpoint.
- `src/workspace.ts:247–269` already enforces protected paths. Those restrictions remain unchanged.
- `test/workspace.test.ts:209–213` contains the historical no-controller-import assertion. Only that boundary assertion needs adjustment.

## Grafts and rejections

| Choice | Source | Reason |
| --- | --- | --- |
| Direct Controller catalogue ownership. | A | Action removal and source disposition can share a transaction. |
| Explicit binding and retained ActionSource states. | A | Distinguishes never-started work, ambiguous effects and historical associations. |
| Callback-lifetime revocation and implementation-only edits. | A | Retained callbacks do not retain authority. |
| Serialized source operations. | B | Protects controller preconditions, intents and receipts across asynchronous storage calls. WorkspaceStore's queue covers only its own operations. |
| Controller-generated edit request IDs. | B | Callers supply edit preconditions and bytes, not storage receipt identity. |
| No coordinator class or separate database. | Reject B structure | The selected unit does not need another authority/transaction interface. |
| No controller edit ledger. | Reject B expansion | WorkspaceStore already journals edits. Controller's interrupted tool Action supplies conservative execution recovery. |
| One configured repository ID, separate case workspaces. | A | WorkspaceStore already supports this isolation. Per-case repositories would consume its four-repository quota sooner. See `src/workspace.ts:50–65` and `src/workspace.ts:1324–1335`. |
| No editable-path allowlist. | Reject B expansion | Retain existing WorkspaceStore restrictions without another policy configuration. |
| No candidate-equals-source-SHA requirement. | A | Source provenance is a separate association. Simulated receipt and assessment semantics remain unchanged. |
| No alternate callback route. | Reject B expansion | Keep the current callback entry point and add a scoped second argument only in configured mode. |

## Selected contract

### Trusted caller usage

```ts
const controller = await Controller.open({
  directory,
  policy,
  providerForCase,
  offlineWorkspace: {
    repositoryId,
    regressionDirectory,
    baseline,
  },
  check: async (request, source) => {
    if (!source) throw new Error('offline-source-required');

    const selectedFiles = await source.readSelected();

    return simulatedReceipt(request.kind, selectedFiles);
  },
});
```

The example callback remains simulated. No checkout path, command, runner or real evidence is introduced.

### Public types and signatures

Keep these types in `src/controller.ts`. Export the two offline types only as needed by trusted callers.

```ts
export type OfflineWorkspaceOptions = Readonly<{
  repositoryId: RepositoryId;
  regressionDirectory: VirtualPath;
  baseline: readonly BaselineFile[];
}>;

export type OfflineActionWorkspace = Readonly<{
  selection: FrozenRevision;
  readSelected(): Promise<readonly BaselineFile[]>;
  edit(
    expectedRevision: GitRevision,
    input: Omit<BrokerEdit, 'requestId'>,
  ): Promise<SavedReceipt>;
}>;

type CheckCallback = (
  request: AdmittedCheckRequest,
  source?: OfflineActionWorkspace,
) => Promise<CheckExecution>;
```

Extend existing Controller options with:

```ts
offlineWorkspace?: OfflineWorkspaceOptions;
check?: CheckCallback;
```

Unconfigured dispatch invokes `check(request)` with exactly one argument. `AdmittedCheckRequest`, `CheckExecution`, HTTP DTOs and native tool arguments remain unchanged.

The source capability accepts no case ID, action ID, epoch or replacement frozen tuple. Its edit revision cannot retarget the selected source.

### Durable types

```ts
type WorkspaceBinding = Readonly<{
  caseId: string;
  repositoryId: RepositoryId;
  sourceDigest: string;
}> & (
  | Readonly<{ state: 'planned' }>
  | Readonly<{ state: 'provisioning' }>
  | Readonly<{ state: 'ready'; baseRevision: GitRevision }>
  | Readonly<{ state: 'uncertain'; reason: string }>
);

type ActionSource = Readonly<{
  action: Readonly<Action>;
  kind: Check['kind'];
}> & (
  | Readonly<{
      state: 'selecting';
      expected: WorkspaceCheckpoint;
    }>
  | Readonly<{
      state: 'selected';
      frozen: FrozenRevision;
    }>
  | Readonly<{
      state: 'settled';
      frozen: FrozenRevision;
    }>
  | Readonly<{
      state: 'interrupted';
      reason: string;
      frozen: FrozenRevision | null;
    }>
);
```

Add two catalogue tables.

```sql
CREATE TABLE workspace_bindings (
  case_id TEXT PRIMARY KEY REFERENCES cases(id),
  value TEXT NOT NULL
);

CREATE TABLE action_sources (
  action_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  value TEXT NOT NULL
);

CREATE INDEX action_sources_case ON action_sources(case_id);
```

Do not foreign-key `action_sources.action_id` to disposable live Actions.

Validate persisted discriminants, identity columns, Action fields, check kinds and frozen identity at the storage boundary. The selected tuple is immutable even when its lifecycle state changes.

Record versioned offline configuration identity and bootstrap state in existing metadata. Configuration identity covers repository ID, regression directory and canonical baseline paths and byte hashes. Copy baseline bytes before the first await.

### Private responsibilities

Candidate A's private method boundary remains appropriate:

```ts
private async openWorkspaces(): Promise<void>;

private async ensureWorkspace(id: string): Promise<void>;

private workspaceReady(id: string): boolean;

private async selectActionSource(
  id: string,
  action: Action,
  kind: Check['kind'],
  signal: AbortSignal,
): Promise<OfflineActionWorkspace>;

private async readSelectedSource(
  id: string,
  action: Action,
  kind: Check['kind'],
  signal: AbortSignal,
): Promise<readonly BaselineFile[]>;

private async editActionSource(
  id: string,
  action: Action,
  expectedRevision: GitRevision,
  input: Omit<BrokerEdit, 'requestId'>,
  signal: AbortSignal,
): Promise<SavedReceipt>;
```

Serialize workspace operations across controller validation, durable intent, store effect and controller receipt. Revalidate after queued waits and awaited storage operations. Never hold a SQLite transaction across an await.

Do not keep the queue occupied while invoking the trusted callback. Its `readSelected` and `edit` methods need that queue.

## Lifecycle and recovery rules

### Open and provisioning

1. First enablement requires an empty catalogue. Reject implicit migration of existing scripted cases.
2. Persist offline bootstrap intent before root creation. Derive the root internally as the controller's `workspaces` child.
3. Established stores require existing ownership state. Never let a missing or emptied ready store become fresh initialization.
4. Open WorkspaceStore before recovery while dispatch remains disabled.
5. Admission atomically creates the case, guard and planned binding.
6. Planned provisioning may issue its first effect. Persist provisioning intent first.
7. An ambiguous provisioning record may only inspect and adopt an exact ready initial workspace whose checkpoint equals its base. Otherwise park.
8. Ready bindings verify identity, saved base and integrity. Their current checkpoint may legitimately be B rather than the base.
9. Require workspace readiness in scheduling, execution admission, Continue and Retry. Preserve pending pauses.
10. Handle workspace failure separately from native missing-storage recovery.

Reopening without matching offline configuration must reject rather than silently resume scripted mode.

### Selection and callback lifetime

1. Check exact live persisted tool authority, running status, binding readiness and allowance.
2. Inspect the bound workspace.
3. Revalidate authority and persist `selecting` with the observed checkpoint.
4. Freeze exactly that revision through WorkspaceStore.
5. Revalidate and persist `selected` before callback entry.
6. Return detached, frozen selection metadata and a frozen capability object.
7. `readSelected` loads the exact action's recorded tuple and calls `readFrozen`. It never substitutes the current checkpoint.
8. Revoke the capability when callback lifetime ends, including callback failure and abort-race completion.
9. Retained handles also reject after settlement, epoch change, cancellation or close.
10. Retain existing parser, post-callback guards and simulated receipt semantics.

Recalculate dispatch-time remaining allowance after source selection. Selection work consumes the existing admitted limit.

### Edits

An edit requires running implementation phase, exact persisted tool authority, a ready binding, live callback lifetime and a nonaborted signal.

Copy edit bytes before the first await. Allocate the WorkspaceStore request ID internally. Preserve expected-revision, expected-hash, path and quota checks.

WorkspaceStore remains the sole edit intent/receipt owner. A successful edit to B never changes selected A.

An already-admitted noncancellable edit may finish after pause or cancellation. This records an effect, not permission for another operation or accepted check completion. Do not claim rollback.

### Settlement and restart

Update source disposition when removing live Action authority. Retain the frozen tuple and full admitted Action snapshot. Failed or uncertain execution must not become a successful-looking source settlement.

Recovery must:

- Verify historical frozen tuples without selecting latest.
- Preserve known A even when the current checkpoint is B.
- Mark unfinished selections interrupted.
- Treat orphan freezes as storage facts, not dispatch receipts.
- Park unreadable, foreign or inconsistent associations.
- Never replay callbacks, edits or ambiguous provisioning.
- Preserve existing bounded charging and unsettled-native-tool reconciliation.
- Preserve paused and terminal dispositions.

A healthy explicit Retry creates fresh action and epoch authority. It may select current B. It cannot revive A's old callback or repeat its edit.

### Close

Disable new operations first. Drain controller commands, native runtimes, runners and admitted workspace operations. Close WorkspaceStore before the catalogue and release ownership on failure paths too.

Workspace cleanup must still run after native-close failure. Close does not delete workspace state or promise to drain arbitrary unrelated callback effects.

## Implementation scope

One writer owns the complete seam in the assigned implementation worktree.

Authorized source and tests:

- `src/controller.ts`.
- New public-controller workspace integration tests and crash helper.
- Narrow adjustment of `test/workspace.test.ts:209–213`.

The parent owns project documentation.

No production changes to `domain.ts`, `native.ts`, `http.ts` or `main.ts`. No changes to WorkspaceStore restrictions, fixtures, dependencies, deletion or retention.

## Acceptance tests

Use faux providers, synthetic bytes, real temporary Git and real SQLite. Do not set private Controller fields or replace storage with mocks.

1. Unconfigured callbacks retain one-argument dispatch and existing simulated receipt behavior.
2. Duplicate investigation preserves its binding. Requeue creates another binding. Capacity-two edits remain case-isolated.
3. Public phase progression reaches implementation. An admitted callback selects literal A, edits to literal B and reads literal A again.
4. A later admitted action selects B under fresh authority.
5. Close/reopen preserves current B and historical A's exact Action, case and epoch association.
6. Read-only catalogue inspection supplements public Controller assertions. After Controller closes, WorkspaceStore independently reads recorded A.
7. Foreign or tampered associations park before callback entry.
8. Captured handles reject after callback completion, pause, epoch change, cancellation and close.
9. Stale edit revisions and hashes reject without changing the selected tuple. Existing protected-path checks remain intact.
10. Missing ready storage is not recreated. Configuration mismatch and omitted offline mode cannot silently downgrade execution.
11. Workspace errors do not incorrectly mark healthy native storage missing.
12. Close waits for admitted workspace work and releases ownership despite native-close failure.

Actual SIGKILL coverage must include:

| Boundary | Required restart result |
| --- | --- |
| Admission committed, provisioning not started. | Planned provisioning can proceed once. |
| Provision intent, before effect. | Inspect or park. Never blindly repeat. |
| Store ready, before controller binding receipt. | Adopt only exact pristine initial state. |
| Action admitted, before selection. | Existing interrupted-tool recovery. No callback replay. |
| Selection intent, before freeze. | Interrupted source. No latest fallback. |
| Freeze complete, before selection receipt. | Orphan freeze grants no execution authority. |
| Selection receipt, before callback. | Preserve A and park interrupted execution. |
| Edit intent or committed edit before callback settlement. | WorkspaceStore reconciliation and interrupted tool recovery. No edit replay. |
| Native receipt, Action removal or SDK checkpoint gaps. | Preserve existing conservative native recovery. |

Callback counts and literal byte assertions must prove non-replay and A/B behavior.

The supervisor should run focused tests, `npm run verify`, then parent integration `npm run verify:all`. This read-only review executed no tests.

## Parent's explicit contract selection

The supervisor replied:

> Select Candidate A with B's serialization and internally allocated edit request IDs, as you recommend. I read both candidates and grounding in full. Keep one Controller-owned WorkspaceStore, two catalogue tables, no coordinator class/database/edit ledger, and no domain/native/HTTP/main production changes. Export OfflineWorkspaceOptions and OfflineActionWorkspace from controller.ts only as needed by trusted callers. Use your exact optional configuration, second callback argument, discriminated binding and retained ActionSource states. Source edit takes Omit<BrokerEdit,'requestId'> and generates its request ID internally. Edits require running implementation phase and exact live persisted tool authority. Revalidate after queued waits and every awaited effect, never hold SQLite transactions across await, and revoke handles when callback lifetime ends including abort races. Copy baseline and edit bytes before the first await. Both selected record and returned selection metadata must be detached and immutable. Reopen must verify historical frozen A without selecting latest B, never recreate a missing ready store, never replay callbacks/edits, and distinguish workspace failure from missing native storage. Preserve pending pause and healthy explicit Retry semantics. WorkspaceStore remains sole edit intent/receipt owner. Source provenance must not change simulated candidate receipt semantics. No project docs edits by writer, parent owns them. Narrow historical test boundary update is authorized. Require public Controller real-Git/SQLite A/B and stale/foreign tests plus actual SIGKILL intent/effect/receipt coverage and close-drain verification. The scope and tradeoffs are accepted; proceed to final synthesis for the sole writer.

## Principles applied

- **Model the Domain** changed the representation to discriminated bindings and retained action-scoped selections.
- **Make Operations Idempotent** changed recovery to inspection, exact adoption or conservative parking rather than uncertain replay.
- **Laziness Protocol** changed the selection to direct catalogue ownership with two tables and no duplicate edit journal.

Each named principle's leaf skill was read in full. Both candidates and grounding were read completely. No nested agents were used and no source files were changed.