# Candidate A. Controller-owned catalogue state machine

## Caller usage first

Explicit trusted configuration enables synthetic offline workspaces. Existing callers and production main remain scripted.

```ts
const controller = await Controller.open({
  directory,
  policy,
  providerForCase,
  offlineWorkspace: {
    repositoryId: repositoryId(syntheticRepositoryUuid),
    regressionDirectory: virtualPath('regression'),
    baseline: [
      {
        virtualPath: virtualPath('src/value.ts'),
        bytes: Buffer.from('export const value = 1;\n'),
      },
    ],
  },
  check: async (request, source) => {
    assert(source);
    const files = await source.readSelected();
    return simulatedReceipt(request.kind, files);
  },
});

await controller.command({
  requestId: randomUUID(),
  intent: { type: 'investigate', issue },
});
```

`simulatedReceipt` denotes existing test-helper logic, not a proposed execution module. The caller supplies copied synthetic bytes, never a checkout path. Controller chooses case, action, epoch and frozen revision.

An implementation-phase callback can prove that selected A survives an admitted edit to B.

```ts
check: async (request, source) => {
  assert(source);
  const a = await source.readSelected();

  const b = await source.edit(source.selection.revision, {
    requestId: requestId(randomUUID()),
    virtualPath: virtualPath('src/value.ts'),
    expectedHash: sha256(hashOf(a[0].bytes)),
    bytes: Buffer.from('export const value = 2;\n'),
  });

  assert.notEqual(b.checkpoint.revision, source.selection.revision);
  assert.deepEqual(await source.readSelected(), a);
  return simulatedReceipt(request.kind, a);
}
```

This edit capability belongs only to the trusted offline callback. It is not exposed to the model or HTTP. Tests reach implementation through existing valid simulated baseline and assessment flows.

Reopening requires the same configuration.

```ts
await controller.close();

const reopened = await Controller.open(sameOptions);
const result = await reopened.snapshot({ selected: caseId });
assert.equal(result.selected!.case.status, 'needs-attention');
// Expected when the previous process interrupted an admitted tool.

await reopened.close();
```

## Problem and grounding

Controller owns admission, durable Action authority, epochs, Retry and conservative recovery. WorkspaceStore owns Git integrity, journalled effects and recorded frozen bytes. Their missing association belongs in Controller’s catalogue.

I inspected the actual implementations of provisioning, action admission, check allowance/dispatch, action settlement, Retry, recovery and close in `src/controller.ts`. I also inspected WorkspaceStore types and freeze/readFrozen implementation, `RuntimeHost`, admitted-check DTOs and public-controller dispatch tests.

Load-bearing integration points are:

- `src/controller.ts:443` owns provisioning.
- `src/controller.ts:513` validates exact persisted check authority.
- `src/controller.ts:575` dispatches checks.
- `src/controller.ts:647` removes settled Action records.
- `src/controller.ts:847` recovers outstanding work.
- `src/workspace.ts:1576` freezes only the current checkpoint.
- `src/workspace.ts:1601` reads a previously recorded tuple independently of current worktree bytes.

Workspace provisioning rejects duplicate calls. Recovery cannot safely repeat provisioning after an uncertain intent. Selection A cannot be reconstructed by freezing current B. Historical selection records must survive deletion of outstanding Action rows.

## Data shapes

Keep the protocol and declarations in `src/controller.ts`. Reuse WorkspaceStore’s existing types.

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
    edit: BrokerEdit,
  ): Promise<SavedReceipt>;
}>;

type CheckCallback = (
  request: AdmittedCheckRequest,
  source?: OfflineActionWorkspace,
) => Promise<CheckExecution>;

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

Add catalogue tables:

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

Selections do not reference the ephemeral `actions` table. Decode and validate discriminants, IDs, exact Action fields, check kind, bounds and frozen case identity at the storage boundary.

Persist offline-mode metadata and configuration identity. Compute identity from canonical sorted virtual paths, lengths, byte hashes, repository ID and regression directory. Copy caller buffers at open.

A catalogue containing offline bindings must not silently reopen without matching offline configuration. Enabling this feature against existing scripted cases should reject rather than retrofit their identity. A new empty catalogue is eligible.

## Exact signatures

Extend existing private Options with:

```ts
offlineWorkspace?: OfflineWorkspaceOptions;
check?: CheckCallback;
```

Existing one-argument callbacks remain assignable. In scripted mode invoke them with exactly one argument. `AdmittedCheckRequest` remains unchanged.

Proposed private Controller methods:

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
  edit: BrokerEdit,
  signal: AbortSignal,
): Promise<SavedReceipt>;
```

The capability captures case/action/kind/signal. Its methods accept no alternative case or caller-supplied freeze.

## Module map

- `src/controller.ts` owns the binding and selection state machines, catalogue rows, sole WorkspaceStore instance and capability closures.
- `src/workspace.ts` remains the sole Git/filesystem owner. No new API is required.
- `src/domain.ts`, `src/native.ts`, `src/http.ts` and `src/main.ts` need no changes.
- `test/controller-workspace.test.ts` owns public-controller integration coverage.
- Existing crash-worker conventions can support additional fault boundaries.
- `test/workspace.test.ts` needs a narrow update to its historical no-controller-import assertion. Retain the native/main/HTTP boundary and integrity assertions.

There is no coordinator database, execution adapter or new agent tool.

## Durable lifecycle

### Open

Derive the store directory internally as `join(controller.directory, 'workspaces')`.

First enablement records a root-creation intent before filesystem effects. Create this root only for a new empty catalogue. An interrupted initial setup may fail conservatively. Do not repair it by recreating ownership metadata.

For established stores, missing root or ownership state never causes replacement. WorkspaceStore.open retains its ownership validation.

Open WorkspaceStore before `recover`, while `starting` still prevents dispatch. Close it on every failed-open path.

### Provision

`admit` inserts a planned binding in the same transaction as case and issue guard. Duplicate admission retains the binding. Requeue receives a fresh binding.

`provision` calls `ensureWorkspace` even if native storage is already ready.

| Binding | Operation |
|---|---|
| `planned` | Persist provisioning intent, then call WorkspaceStore.provision. |
| `provisioning` | Inspect only. Adopt an exact ready, pristine initial resource or park uncertainty. |
| `ready` | Verify case/repository identity, saved base revision and workspace integrity. |
| `uncertain` | Do not provision, reset or dispatch. |

After successful initial provision, persist ready with the returned base revision.

A provisioning receipt can be recovered only when WorkspaceStore reports the exact case/repository ready and its initial checkpoint equals its base. Absent, foreign or interrupted state parks. Never repeat provision from a provisioning row.

A ready workspace can legitimately have current B differing from its saved base. Do not reject ordinary edits by requiring current revision to remain the base.

Runnable eligibility requires native ready and workspace ready. Preserve pauses arriving during either provisioning stage. Workspace failure must not incorrectly set native storage to missing.

### Select

Inside `dispatchCheck`, retain existing exact `checkAllowance` checks and running-status requirement. Missing callback stops before source effects.

In configured offline mode:

1. Inspect the bound ready workspace.
2. Revalidate persisted action after that await.
3. Persist selecting with the observed checkpoint, exact Action and check kind.
4. Call WorkspaceStore.freeze with the bound case and observed revision.
5. Revalidate action, signal and running status.
6. Persist selected with the exact recorded frozen tuple.
7. Invoke the callback with its scoped capability.

The callback cannot run before the selected receipt exists.

`readSelected` fetches the exact action’s selected record, validates identity and calls readFrozen. It never chooses latest, re-inspects to replace A, or accepts caller-supplied frozen metadata.

A duplicate selection attempt may reuse only an exact still-active selected record. Selecting, interrupted or settled records do not authorize replay.

Freeze the capability object and selection metadata. Each method checks a captured callback-lifetime flag. Revoke it in `finally`, including abort-race outcomes. Retained handles reject after completion, action settlement, epoch change, cancellation or close.

Keep existing post-callback allowance validation, strict receipt parser and conservative outcomes. Workspace SHAs remain source provenance, not real evidence. Do not overwrite or automatically validate `CheckResult.candidate` using the workspace revision. Existing simulated candidate/configuration rules remain intact.

### Edit

The edit capability requires:

- Exact persisted tool Action.
- Running status and implementation phase.
- Ready binding.
- Live callback and unexpired allowance.
- Nonaborted signal.
- WorkspaceStore’s existing expected revision/hash and path restrictions.

Copy input bytes before awaiting. Revalidate immediately before enqueueing WorkspaceStore.edit and after completion.

A successful B edit does not alter selected A.

WorkspaceStore.edit has no cancellation argument. A pause arriving after an edit was admitted can let that effect finish. It cannot authorize subsequent effects or accepted check completion. Do not promise rollback or instantaneous effect cancellation. Preserve pause precedence through stopCheck and the native epilogue.

### Settle and recover

Update selected to settled, or selecting/selected to interrupted on uncertainty, in the same catalogue transaction that removes its Action. Retain historical rows. Failed callback settlement must not masquerade as successful source receipt settlement.

Before recovery removes outstanding Actions or increments epochs:

- Preserve known tuples.
- Mark unfinished source records interrupted.
- Apply existing bounded charging and interrupted-tool parking.
- Never replay callbacks or reconstruct missing selections.

A freeze without a controller receipt is an orphan store fact, not evidence that dispatch occurred. A receipt whose recorded tuple cannot be read parks. An active selection without its Action also parks.

Verify historical tuples through readFrozen during reopen. Historical A need not equal current B.

Preserve paused and terminal dispositions. An uncertain binding blocks tick, action admission, Continue and Retry. Healthy bindings retain existing Retry behavior. Retry creates new action/epoch authority and may select B; it never revives A’s old execution authority.

Keep existing native unsettled-checkpoint reconciliation. Handle workspace errors separately from the existing catch that marks native storage missing.

### Close

Set closing first. Drain commands, close native runtimes and await runners using existing allSettled behavior. Then close WorkspaceStore before closing the catalogue and releasing ownership guards.

Attempt all cleanup even after a native close failure. New source operations reject once closing begins. WorkspaceStore.close drains its admitted queue.

Do not delete workspace state during close or native expiry. Arbitrary callback-effect drainage remains an inherited limitation, not a new guarantee.

## Tests

Use real temporary Git and SQLite, synthetic bytes and faux providers.

1. Existing unconfigured callback arity, scalar request keys, receipt parsing and scripted results remain unchanged.
2. Public Controller admission provisions before execution eligibility. Duplicate investigation preserves binding. Requeue and capacity-two cases remain isolated.
3. In implementation phase, select literal A, edit to literal B, read A again, then have a later admitted action select B. Assert bytes, action IDs and epochs.
4. Close/reopen preserves current B and historical A association. Inspect catalogue rows as a secondary durable witness. With Controller closed, reopen WorkspaceStore and read its recorded A tuple to verify historical bytes without adding a historical-reader API.
5. Foreign/stale/tampered Actions reject before source effects. Captured capabilities reject after completion, pause/epoch change, cancellation and close. Stale edit revisions/hashes reject without retargeting A.
6. SIGKILL boundaries cover admission, provision intent, store ready before binding receipt, Action before selection, selection intent, freeze before selection receipt, selected receipt before callback, and existing native receipt/action/SDK gaps. Callback counts prove no replay.
7. Missing or foreign workspace state, invalid freeze and interrupted edits park without reset, reprovisioning or latest fallback.
8. Pause during provision or admitted edit preserves pause semantics. Uncertain binding blocks Retry. Healthy ordinary failures retain Retry behavior.
9. Config mismatch, omitted mode and legacy-case enablement cannot create unbound dispatch. Failed-open cleanup releases both owners.
10. Native detail cleanup does not delete workspaces.

Suggested implementation commands:

```sh
node --test test/controller-workspace.test.ts test/check-dispatch.test.ts test/workspace*.test.ts test/recovery.test.ts
npm run verify
```

Parent integration retains `npm run verify:all`. No tests were executed for this read-only design.

## Structurally distinct alternative rejected

A dedicated `ControllerWorkspaceCoordinator` could own another association database and WorkspaceStore. Controller would pass action grants through `provisionCase`, `selectForAction`, `finishAction` and `recoverCase`.

This loses on interface depth and protocol ownership. Action removal and selection settlement would no longer share one transaction. Recovery would reconcile three stores. Callers would need to remember coordinator receipts and stale-grant rules.

The selected design keeps association and Action disposition in one catalogue transaction. WorkspaceStore already hides Git complexity. Another coordinator adds a protocol rather than hiding it.

## Rationale and red-flag screen

Selected candidate is the Controller-owned state machine. Parent synthesis has not occurred.

- **Model the Domain** shaped explicit binding and action-source states instead of nullable latest-revision fields.
- **Make Operations Idempotent** shaped receipt reconciliation and parking rather than uncertain replay.
- **Laziness Protocol** shaped direct reuse of Controller’s catalogue and WorkspaceStore instead of another coordinator.

Those three leaf skills were read in full.

The design has one owner per invariant. It adds no pass-through module, stage pipeline, revision cache or transport API. The trusted caller gets copied bytes and scoped capabilities, not paths or a Git protocol.

Accepted tradeoffs include conservative parking after ambiguous intent, retained historical rows, and the optional second callback argument. Retention and reclamation remain deferred.

## Bounded unit and residual risks

**Yes, this can be one bounded implementation unit.** One writer should own the schema, provision/dispatch/recovery/close integration and crash tests. Do not expose half the protocol as usable dispatch.

Deferred work includes deletion, retention, quota reclamation, Docker, real evidence, checkout ingestion, live inference, services, credentials, publication, broader edit authority, multi-process exclusion and power-loss guarantees.

Residual risks are schema decoding, exception cleanup ordering, shared workspace inventory uncertainty, noncancellable admitted edits and existing callback drainage limits.

The configured artifact write was blocked because the destination is outside the working directory. This complete artifact is returned for runtime persistence.