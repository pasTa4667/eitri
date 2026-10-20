# Candidate B. Controller-private workspace coordinator

## Caller usage first

Existing callers retain the current scripted `check` option unchanged. Explicit offline configuration adds trusted synthetic source. The model still calls only `run_check({ kind })`.

Proposed application usage follows. These APIs are sketches, not implemented code.

```ts
const controller = await Controller.open({
  directory,
  policy,
  providerForCase,
  offlineWorkspace: {
    regressionDirectory: virtualPath('test/regression'),
    baseline: [
      {
        virtualPath: virtualPath('src/example.ts'),
        bytes: Buffer.from('synthetic A\n'),
      },
    ],
    editablePaths: [virtualPath('src/example.ts')],
    check: async (request) => {
      const files = await request.source.read();
      assert.equal(files[0].bytes.toString(), 'synthetic A\n');
      return {
        type: 'completed',
        check: scriptedReceipt(request.kind, request.source.revision),
      };
    },
  },
});
await controller.command({
  requestId: randomUUID(),
  intent: { type: 'investigate', issue },
});
```

Baseline bytes come from trusted in-memory application configuration. Controller copies them before its first await. There is no checkout-ingestion operation or source-directory callback.

An explicitly editable offline callback proves selected A survives current B.

```ts
check: async (request) => {
  const selectedA = request.source.revision;
  const a = await request.source.read();

  const b = await request.source.edit({
    expectedRevision: selectedA,
    virtualPath: virtualPath('src/example.ts'),
    expectedHash: sha256(hashOf(a[0].bytes)),
    bytes: Buffer.from('synthetic B\n'),
  });

  assert.notEqual(b.checkpoint.revision, selectedA);
  assert.equal(
    (await request.source.read())[0].bytes.toString(),
    'synthetic A\n',
  );

  return {
    type: 'completed',
    check: scriptedReceipt(request.kind, selectedA),
  };
}
```

`edit` is a trusted offline capability. It is not a model tool. Its authority is the intersection of the live admitted action, owning case, current epoch, configured editable paths and existing WorkspaceStore restrictions. An empty editable-path list grants no writes.

Supplying an expected edit revision does not select that revision for a check. Controller selects and durably records A before invoking the callback.

Reopening uses identical offline configuration.

```ts
await controller.close();
const reopened = await Controller.open(sameOptions);
const snapshot = await reopened.snapshot({ selected: caseId });
```

Recovery never invokes old callbacks or replays edits. It verifies retained selections against WorkspaceStore before enabling later actions. Snapshots remain scripted and expose no source capability.

## Problem and grounding

At `a447f0e`, Controller owns admission, persisted actions, epochs, budgets and conservative recovery. WorkspaceStore independently owns Git, materialized-byte integrity, edits and frozen reads. The missing association belongs between these existing owners.

I inspected the actual controller options, catalogue schema, command handling, provisioning, admission, `checkAllowance`, dispatch, finish, recovery and close. I also inspected WorkspaceStore types, opening and provisioning, native `run_check` admission, and existing dispatch/workspace tests. The supplied grounding agrees with these inspected integration points.

The observed worktree had an existing modification to `decisions.tsv`. I did not modify it or any repository source.

## Selected shape

Add a small non-exported `ControllerWorkspaces` class inside `src/controller.ts`.

It owns workspace association records and their cross-store reconciliation. Controller remains the sole owner of case status and action authority. WorkspaceStore remains the sole Git owner.

Keeping the coordinator private avoids creating an importable authority bypass. It is a domain boundary, not another execution adapter or Git wrapper.

### Data shapes

```ts
type OfflineWorkspaceOptions = Readonly<{
  regressionDirectory: VirtualPath;
  baseline: readonly BaselineFile[];
  editablePaths: readonly VirtualPath[];
  check(request: OfflineCheckRequest): Promise<CheckExecution>;
}>;

type OfflineEdit = Readonly<{
  expectedRevision: GitRevision;
  virtualPath: VirtualPath;
  expectedHash: Sha256 | null;
  bytes: Uint8Array;
}>;

type OfflineSource = Readonly<{
  revision: GitRevision;
  manifestDigest: Sha256;
  read(): Promise<readonly BaselineFile[]>;
  edit(input: OfflineEdit): Promise<SavedReceipt>;
}>;

type OfflineCheckRequest = AdmittedCheckRequest & Readonly<{
  source: OfflineSource;
}>;

type Options = BaseOptions & (
  | {
      check?: (request: AdmittedCheckRequest) => Promise<CheckExecution>;
      offlineWorkspace?: never;
    }
  | {
      check?: never;
      offlineWorkspace: OfflineWorkspaceOptions;
    }
);
```

`BaseOptions` is today’s Options without `check`. Runtime validation also rejects simultaneous configuration of both callback routes.

Keep `AdmittedCheckRequest` and `CheckExecution` in `domain.ts` unchanged. The offline request is a trusted TypeScript configuration boundary, not an HTTP DTO.

```ts
type WorkspaceBinding = Readonly<{
  caseId: string;
  repositoryId: RepositoryId;
}> & (
  | { state: 'pending' }
  | { state: 'provisioning' }
  | { state: 'ready' }
  | { state: 'uncertain'; reason: string }
);

type WorkspaceSelection = Readonly<{
  action: Action;
  repositoryId: RepositoryId;
  kind: Check['kind'];
  frozen: FrozenRevision;
}> & (
  | { state: 'selecting' }
  | { state: 'selected' }
  | { state: 'uncertain'; reason: string }
);

type WorkspaceEdit = Readonly<{
  requestId: RequestId;
  action: Action;
  selectionActionId: string;
  repositoryId: RepositoryId;
  expectedRevision: GitRevision;
  virtualPath: VirtualPath;
  expectedHash: Sha256 | null;
  bytesDigest: Sha256;
}> & (
  | { state: 'editing' }
  | { state: 'completed'; receipt: SavedReceipt }
  | { state: 'uncertain'; reason: string }
);
```

Use three coordinator-owned tables in the existing catalogue.

| Table | Identity and relationships |
| --- | --- |
| `workspace_bindings` | Primary key `case_id`, foreign key to cases. |
| `workspace_selections` | Primary key `action_id`, foreign key `case_id` to cases. |
| `workspace_edits` | Primary key `request_id`, foreign keys to case and selected action record. |

Each table stores validated JSON plus indexed identity columns. Historical selections and edits deliberately do not reference the disposable live `actions` row.

Selections retain the full admitted Action snapshot. Live permission always comes from comparison with Controller’s persisted action, never from historical association records.

A selected tuple cannot change from A to B. Its state can become uncertain following integrity failure, but recovery cannot replace its tuple.

Do not duplicate WorkspaceStore’s current checkpoint in the binding. Inspect obtains that checkpoint from its sole owner.

An `offline_workspace` metadata value records a versioned configuration digest and bootstrap state `opening | ready`. The digest covers baseline bytes, regression directory and editable-path set. It cannot certify callback behavior.

The physical root is the fixed private `offline-workspaces` child of Controller’s directory. No new caller-supplied physical path is needed.

### Exact private signatures

```ts
type WorkspaceAuthority = (
  action: Action,
  signal: AbortSignal,
) => void;

class ControllerWorkspaces {
  static open(
    directory: string,
    db: DatabaseSync,
    options: OfflineWorkspaceOptions,
    transaction: <T>(work: () => T) => T,
    authorize: WorkspaceAuthority,
    fault: (point: string, caseId: string) => void,
  ): Promise<ControllerWorkspaces>;

  admit(caseId: string): void;
  assertReady(caseId: string): void;
  provision(caseId: string): Promise<void>;
  recover(caseId: string): Promise<void>;

  select(
    action: Action,
    kind: Check['kind'],
    signal: AbortSignal,
  ): Promise<OfflineSource>;

  close(): Promise<void>;

  private edit(
    action: Action,
    input: OfflineEdit,
    signal: AbortSignal,
  ): Promise<SavedReceipt>;

  private readSelection(
    action: Action,
    signal: AbortSignal,
  ): Promise<readonly BaselineFile[]>;
}
```

`admit` and `assertReady` are synchronous for use inside existing catalogue transactions. Never hold a SQLite transaction across an await.

The authority closure performs exact `checkAllowance` validation and requires running status before beginning new selection, read or edit work. It also requires a ready binding.

Recheck authority after every awaited storage operation and before dispatching a callback. Preserve the existing post-callback guard.

Source closures capture the actual Action and signal. They accept no case ID, action ID, epoch or frozen tuple. Retained closures reject after settlement, epoch change or closing.

Read returns fresh buffers. Edit copies input bytes before its first await.

Serialize coordinator operations across precondition, intent, effect and receipt. Revalidate after waiting in its queue. WorkspaceStore’s queue alone does not protect the catalogue-side sequence.

## Module map and exact integration

### `src/controller.ts`

- Add the private coordinator, offline configuration types and association schema.
- `Controller.open` opens the coordinator before recovery and scheduling. Its failure cleanup closes any opened coordinator.
- `Controller.admit` calls `workspaces?.admit(c.id)` after case insertion, within the existing command transaction. Generate a distinct repository UUID per case.
- `Controller.provision` establishes workspace readiness before native readiness makes the case executable. Do not retain the current native-not-provisioning early return as a workspace bypass.
- `admitAction` requires binding readiness in configured mode for both model and tool actions.
- `continue` and `retry` retain current version, note, budget, repair and epoch semantics. Add only offline readiness as another prerequisite.
- `dispatchCheck` selects source before constructing the offline request and recalculates allowance afterward. Invoke exactly one callback route.
- Keep `parseCheckExecution` unchanged. After parsing an offline completed receipt, require its candidate to equal the selected revision. Mismatch calls `stopCheck`; do not overwrite the candidate silently.
- `finishAction` deletes live authority only. It retains association history.
- `recover` reconciles workspace records before deleting actions or advancing epochs. Preserve existing accounting, interrupted-tool, pause and unsettled-native-tool behavior.
- Handle workspace recovery failures separately from the current catch that marks native storage missing.
- `close` drains and closes the coordinator before closing the catalogue. Cleanup must run even after native close failure.

### Other modules

- `src/workspace.ts` remains the sole filesystem and Git owner. No proposed new integrity primitive is necessary.
- `src/domain.ts` retains current transport and receipt shapes.
- `src/native.ts` retains current tool arguments and receipt ordering.
- `src/http.ts` receives no new authority or fields.
- `src/main.ts` stays unconfigured and scripted.
- Fixtures remain untouched.

The only historical assertion needing adjustment is the no-runtime-wiring assertion in `test/workspace.test.ts`. Permit the explicit controller seam while retaining native/main/HTTP ownership restrictions and all integrity tests.

## Durable transitions and recovery

### Mode and root bootstrap

Only an empty catalogue may first enable offline mode.

Record mode, configuration digest and `opening` before creating the fixed root or opening WorkspaceStore. Record `ready` after successful opening.

Reject enabling over existing scripted cases with `offline-workspace-migration-required`. Reject reopening durable offline state without offline configuration or with a mismatched digest. Never silently downgrade to scripted execution.

After interrupted bootstrap, reopen a valid existing owned WorkspaceStore and finish the bootstrap receipt. Missing, partial or foreign roots fail conservatively. Do not recreate or reset them.

A ready metadata record never authorizes creating a fresh root.

### Case provisioning

1. Admission atomically stores a pending binding with the case and command receipt.
2. Persist provisioning intent before calling WorkspaceStore.
3. Provision using controller-derived case/repository IDs and copied synthetic bytes.
4. Require exact identity and ready state before persisting the binding receipt.
5. Only then may native provisioning complete execution eligibility.

A crash with pending means no workspace effect was admitted. Provisioning may proceed once.

A crash with provisioning means an effect might have occurred. Recovery inspects only. It may adopt an exact ready workspace because both identities were fixed before effects.

Missing, uncertain or foreign state parks the binding. Do not repeat WorkspaceStore’s duplicate-rejecting provision after ambiguous intent.

A previously ready missing workspace is never recreated. A pause arriving during provisioning stays paused.

### Action-scoped selection

1. Validate the live tool action and running case.
2. Inspect the bound workspace and verify exact identity.
3. Persist selecting intent containing the full Action, check kind and intended frozen tuple derived from the checkpoint.
4. Freeze exactly that checkpoint.
5. Verify the tuple using `readFrozen`.
6. Revalidate authority and persist selected receipt before callback entry.

Later edits change the current checkpoint, not the selected tuple.

`freeze` currently accepts no signal. It may complete after cancellation. Recheck before recording selection or entering the callback. An orphan freeze grants no authority.

On restart, validate retained selected tuples through `readFrozen` while dispatch is disabled. Selected A need not equal current B.

Invalid associations or unreadable freezes make the binding uncertain and prevent future dispatch. Preserve paused disposition with a diagnostic reason and block continue/retry through readiness. Preserve terminal disposition with a warning.

A selecting record left by a crash becomes uncertain even if its orphan freeze exists. Do not infer callback completion or select current B.

A historical selected record without a live action remains an association, not permission. Recovery never invokes its callback.

### Admitted edits

Before editing:

- Validate exact live action, selection and cancellation.
- Validate configured path authority.
- Generate the request UUID internally.
- Persist edit intent with action identity, expected revision and operation digest.

WorkspaceStore still enforces revision/hash checks, protected paths, quotas, commit integrity and ref updates.

After receiving a receipt, persist the completed edit receipt even if control changed during the await. This records an observed effect, not permission for another effect. Then recheck authority and stop if necessary.

The selected revision remains A even when B committed.

An editing record left by a crash becomes uncertain and parks the binding without replay. A ready current B does not authorize inventing a missing controller receipt. This avoids adding a WorkspaceStore receipt-lookup API to this unit.

### Close

Set Controller closing before draining work. Reject new source-capability operations. Drain admitted coordinator operations and close WorkspaceStore before closing the catalogue.

Do not delete source, exports or association records. Existing native-detail expiry must not traverse the workspace root.

An arbitrary trusted callback can already ignore cancellation. This design does not claim to drain its unrelated side effects. Its retained workspace capabilities must reject after closing or loss of action authority.

## Tests

Use public Controller execution, faux providers, actual temporary private directories, real Git and real SQLite. Do not mock storage or set private controller fields.

1. **Compatibility.** Existing unconfigured dispatch tests retain their exact scalar request shape, candidate handling, six-field simulated parser, allowance accounting and fault hooks.
2. **Case isolation.** At capacity two, provision distinct bindings and repositories. Editing case one leaves case two’s literal bytes unchanged.
3. **A/B selection.** In one admitted callback, read A, edit to B, then read selected A again. Assert literal bytes and different revisions. Return a simulated receipt for A.
4. **Durable association.** Assert selection Action, case and epoch match the live admission and native Check.actionId. Assert Check.candidate equals A.
5. **Reopen.** Close and reopen identically. Assert retained A association through read-only catalogue SQLite. A new admitted callback reads current B. After Controller closes, existing WorkspaceStore `readFrozen` can independently verify retained A’s literal bytes. This supplements, rather than replaces, public Controller assertions.
6. **Stale authority.** Retain a source closure and prove reads/edits reject after settlement or epoch advance without Git effects.
7. **Foreign state.** Tampered case, repository, epoch and frozen associations park before callback entry.
8. **Edit restrictions.** Reject stale revision, stale file hash, ungranted paths and existing protected paths. Selection remains unchanged.
9. **Receipt association.** Reject a receipt for B when A was selected. Preserve `simulated: true` and every conservative CheckExecution outcome.
10. **Crash matrix.** Kill after pending admission, provisioning intent, workspace provision return, action admission, selection intent, freeze return, selected receipt, edit intent and edit return. Reopen adopts only safe completed provisioning and otherwise parks without callback/edit replay.
11. **Pause and Retry.** Pause during provisioning/check execution preserves precedence. Retry retains existing control semantics and cannot heal uncertain workspace state.
12. **Native recovery.** Existing SDK-checkpoint-gap behavior remains parked.
13. **Missing storage.** Missing ready root fails open without recreation. Missing case or foreign repository parks without reset.
14. **Mode safety.** Durable offline configuration cannot reopen scripted; historical scripted cases cannot silently migrate.
15. **Close failures.** Native-close failure still drains/releases workspace ownership. Old capabilities reject after close.

Add `test/controller-workspace.test.ts` and a crash-worker helper. Reuse existing parser and recovery tests without weakening assertions.

Implementation validation should run focused controller, dispatch, recovery and workspace tests, followed by `npm run verify`. Parent integration retains `npm run verify:all`.

## Rejected structurally distinct alternative

### Direct catalogue ownership in Controller

This alternative puts bindings, selections, edit intents and reconciliation directly into Controller’s existing methods. `dispatchCheck` directly calls inspect/freeze/readFrozen/edit. There is no coordinator or separate association owner.

It saves a private class and injected authority/transaction closures. It can preserve equal authority strength if every path performs the correct checks.

It loses on recovery depth. Controller’s current recovery catch marks native storage missing. Direct ownership makes workspace failures easy to misclassify. It also makes it easier to bypass workspace readiness when native is ready, delete historical associations with live actions, or select current B after losing A.

The coordinator hides these cross-store rules behind provision/recover/select. Its interface earns its place by owning reconciliation, not forwarding Git methods.

A coordinator with its own SQLite database is also rejected. It would unnecessarily separate association receipts from action authority and add another recovery protocol.

## Rationale and synthesis decision

Select the private coordinator using the existing catalogue.

The **Model the Domain** principle changed the state representation. Explicit pending/provisioning/ready/uncertain bindings distinguish never-started work from ambiguous effects. Explicit selecting/selected/uncertain records prevent “latest revision” recovery. I read its leaf skill in full.

The **Make Operations Idempotent** principle changed recovery. Only pending provisioning may issue its effect. Ambiguous provisioning reconciles by inspection or parks. Selection and edit recovery do not replay. I read its leaf skill in full.

Red-flag screening found:

- One Git owner.
- One writer for association tables.
- No importable coordinator internals.
- One callback route per configured mode.
- No transport leakage.
- No duplicated current-checkpoint state.
- No load/freeze/save phase-module chain.

Accepted tradeoffs are conservative parking, three small tables, retained history without cleanup, fixed configuration across reopen and one repository per case. The last choice consumes WorkspaceStore’s existing four-repository quota sooner.

## Boundedness and deferred work

This is implementable as one bounded unit by one writer. Provisioning, selection and recovery share action authority and should not land as independently usable partial features.

The first implementation step is mode/binding provisioning with crash tests, followed by selection and admitted edit capabilities against the same contract.

Defer:

- Historical scripted-case and seed migration.
- New actions selecting arbitrary old revisions.
- Automatic edit-effect recovery.
- Source-checkout ingestion.
- Real evidence and real runners.
- Docker, credentials, inference and services.
- Fixtures, dependencies and publication.
- Workspace deletion and retention.
- Restriction changes.

Workspace SHAs remain simulated candidate identifiers. They do not become real evidence.

Residual risks include existing quotas, shared-inventory uncertainty, process-local ownership and unproven power-loss or hostile same-UID behavior. Configuration hashing cannot certify callback semantics.

The configured artifact write was blocked because its destination is outside the working directory. This complete artifact is returned for runtime persistence.