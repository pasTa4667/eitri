# Controller and offline workspace grounding

## Overview

At `a447f0e`, Controller owns durable admission and action permission. WorkspaceStore separately owns managed Git, source integrity and frozen bytes. No controller, native, HTTP or production-main code connects these owners.

`AdmittedCheckRequest` carries action identity but no selected revision. A simulated callback still supplies `CheckResult.candidate`. The missing association belongs inside Controller's existing provisioning, dispatch, recovery and close paths. WorkspaceStore should remain the sole Git owner.

This investigation followed the simple one-explainer route without nested agents. Throughput checkpoint is n/a for read-only investigation. The **Laziness Protocol** principle shaped the recommendation to extend existing ownership paths rather than add another execution adapter. Its leaf skill was read in full.

## Key concepts

- `src/domain.ts` `Case` contains control status, native availability, version, epoch, budgets and candidate receipts. It has no workspace binding.
- `src/domain.ts` `Action` contains case, epoch, action identity, kind, start time, duration limit and starting usage. Controller persists one outstanding action per case.
- `src/native.ts` `RuntimeHost` connects native execution to controller authority. Native owns conversation/tasks and evidence documents.
- `src/workspace.ts` `Workspace` distinguishes provisioning, ready, editing and uncertain state. `FrozenRevision` contains case, revision and manifest digest, but no action or epoch.
- Controller catalogue, native case storage and workspace journal have separate SQLite transactions.

## How it works

### Admission and runtime

`Controller.command` parses commands, serializes handling and checks durable request receipts inside a catalogue transaction. Conflicting request-ID reuse fails.

`Controller.admit` checks configured project/environment/repository and unresolved status. It writes the provisioning case and issue guard atomically. Duplicate investigation returns the existing owner, including parked and terminal cases. Requeue creates a fresh linked case.

After command commit, `command` calls `provision` and `deliver`. `provision` opens native storage before marking native state ready and changing provisioning status to queued. A concurrent provisioning pause remains paused. Existing fault boundaries include `after-command-commit`, `before-native-provision` and `after-native-provision`.

`Controller.runtime` caches an opening promise per case. It validates directories and the native file. It creates a missing native file only while native state is provisioning. `NativeCase.open` checks durable case/issue identity, rejects non-`faux` providers, disables background compaction and retries, and runs tools sequentially.

`Controller.tick` schedules only queued, native-ready cases. `execute` persists running status, increments epoch/version and starts accounting before `NativeCase.run` submits an epoch-keyed input.

### Persisted action authority

`NativeCase.open` wraps every model request and tool operation. `Controller.admitAction` rejects startup/close dispatch, exhausted allowance, wrong control/native state and an already outstanding action. It persists Action before effects. Model requests are capped at 120 seconds and tools at 60 seconds.

The provider invocation also calls `Controller.permitAction`. Check execution has the stronger exact persisted-field comparison in `Controller.checkAllowance`.

The `run_check` tool accepts only check kind. It passes the actual admitted Action to `Controller.dispatchCheck`. Before callback invocation, `checkAllowance` verifies owning case, tool kind, control/native state, epoch and every persisted Action field. It charges elapsed time and computes remaining case/action allowance. Dispatch additionally requires running status.

The callback receives a frozen detached request plus the action signal. It cannot supply commands or paths. `parseCheckExecution` strictly validates callback-owned keys and copies output bytes. Only `completed` with `simulated: true` can carry evidence. Controller checks action authority and allowance again after callback return.

Non-behavior outcomes park running work without speculative repair. Pending pause retains precedence through the native epilogue. Missing check configuration also stops conservatively.

### Evidence ordering

`NativeCase.recordCheck` repeats cancellation/action guards around persistence. Its ordering is:

1. Artifact blobs.
2. Artifact manifest commit.
3. Check document commit.
4. `eitri.check` note.
5. Controller checkpoint.
6. Tool-level `eitri.action-result` note.
7. `Controller.finishAction` removes the action ledger entry.
8. The SDK completes its own tool checkpoint.

These stages are not atomic across storage owners. `Controller.assess` later verifies control version, phase, candidate/configuration and required checks before progression. Candidate authority currently comes from scripted check receipts, not workspace selection.

### Recovery and close

`Controller.open` keeps `starting` true throughout `recover`, so native storage may open without admitting effects.

Recovery provisions eligible native state, validates outstanding Action records and conservatively charges the unaccounted admitted bound. An interrupted running tool parks with `interrupted-tool-effect-uncertain`. An interrupted model can return to queued if allowance remains. Pause requested settles to paused. Existing parked and terminal dispositions survive.

Recovery increments epoch, then checks `NativeCase.hasUnsettledTool`. This catches a crash after action removal but before the SDK checkpoint. Otherwise runnable work parks with `incomplete-native-tool-checkpoint`. Native tasks are reconciled before normal dispatch resumes. A missing previously ready native database is never recreated.

`Controller.close` disables dispatch, waits for its command queue, closes native runtimes with `allSettled`, waits for runners, clears watchers and closes the catalogue. It releases its process-local directory guard and reports native-close failure. This is the existing lifecycle location for closing a controller-owned workspace store. It does not prove arbitrary callback effects have drained.

### Workspace APIs

`WorkspaceStore.open` requires an existing private empty directory, or its exact inode-bound ownership marker and journal. Ownership checks precede SQLite hot-journal recovery. Reopening validates journal structure, inventory and ready workspace integrity.

Interrupted provisioning/edit intents become uncertain without source replay, reset or ref repair. Shared metadata inventory means another ready workspace can also park after an interrupted intent.

`provision({caseId, repositoryId, baseline})` accepts only opaque branded IDs and copied virtual-path bytes. It journals intent before creating the repository, case branch/worktree, initial verified commit and materialized files. Ready state is persisted last. Duplicate provisioning rejects rather than returning an existing workspace.

`inspect(caseId)` retrieves identity/state and verifies ready integrity. There is no public list or nullable lookup API. Missing cases reject with `workspace-not-found`.

`read(caseId, path)` requires verified ready state. `edit(caseId, expectedRevision, edit)` checks current revision, previous file hash, protected paths and quotas. It records intent/payload, changes source, creates/verifies a commit, advances the owned ref with compare-and-swap, then persists checkpoint/receipt. Completed request replay returns the original receipt. Interrupted effects park.

`freeze(caseId, expectedRevision)` requires that exact current clean checkpoint. It durably records and returns the case/revision/manifest tuple. Repeating the same current freeze does not allocate another record. It cannot newly freeze old A after current state becomes B.

`readFrozen(frozen, signal)` requires the exact recorded tuple, verifies inventory and Git objects, and returns fresh paths and buffers. It reads committed blobs rather than worktree bytes. Recorded A survives broker editing to B and reopening. Cancellation rejects queued work and stops an active Git child before settling.

`exportRevision` allocates a separate bounded physical export. It is unnecessary for this controller association. `WorkspaceStore.close` rejects new work, drains its queue, closes SQLite and releases its process-local owner guard.

## Where things live

- `src/controller.ts` owns `admit`, `provision`, `runtime`, `admitAction`, `checkAllowance`, `dispatchCheck`, `finishAction`, `recover` and `close`.
- `src/native.ts` owns `RuntimeHost`, guarded execution, `recordCheck`, `hasUnsettledTool` and `reconcile`.
- `src/domain.ts` defines Action, Case and admitted-check DTOs.
- `src/workspace.ts` owns WorkspaceStore and all Git/filesystem integrity operations.
- `test/controller.test.ts` covers duplicate admission, interrupted provisioning, pause, retry, missing native files and capacity-two isolation.
- `test/check-dispatch.test.ts` covers persisted Action tampering, case separation, old-epoch completion, pause precedence and strict simulated receipt admission.
- `test/recovery.test.ts` and crash workers exercise actual SIGKILL boundaries, including native-checkpoint gaps and durable check stops.
- `test/workspace.test.ts` covers real Git isolation, stale revisions, A/B exports and provisioning/edit crashes.
- `test/workspace-frozen-read.test.ts` covers A/B reads across reopen, forged tuples, detached bytes, actual Git cancellation and unchanged inventory.
- `test/workspace-ownership.test.ts` and `test/workspace-boundary.test.ts` cover ownership-before-rollback and byte-only inputs.
- `docs/check-execution.md`, `docs/workspace.md` and `docs/build-plan.md` define existing contracts. The latest unit in `docs/work-log.md` accepts admitted scripted dispatch but leaves workspace ownership and M2 acceptance pending.

## Gotchas

The smallest feasible seam is an explicitly configured offline Controller option with a durable per-case workspace binding and action-scoped frozen selection. Provision/reopen must establish the binding before execution eligibility. Selection must derive from controller-owned state and the actual persisted tool action, not callback-supplied paths or revisions. Existing `WorkspaceStore.inspect`, `freeze` and `readFrozen` provide the integrity operations. This is a placement recommendation, not a finalized API.

The important crash boundaries are:

- Catalogue admission before workspace provisioning intent.
- Workspace provisioning effects before controller ready receipt.
- Admitted Action before freeze.
- Durable freeze before catalogue selection receipt.
- Selection receipt before callback effects.
- Native check receipt before action and SDK settlement.

Recovery must distinguish never-started provisioning from a missing previously ready resource. It cannot blindly repeat duplicate-rejecting `provision`, silently choose latest B after losing selection A, or replay an uncertain check. A freeze can survive without its controller receipt. The reverse association needs verification before use. Existing recovery deletes action rows, so selection-record recovery lifetime needs an explicit decision.

`test/workspace.test.ts` currently asserts that controller/native/main/HTTP do not import workspace code in `workspace owns real independent worktrees and literal raw checkpoints without runtime wiring`. Explicit offline wiring requires a scoped update to that historical assertion, not weaker integrity checks.

Existing native expiry deletes case detail directories. This unit must not extend deletion or retention to workspaces. Workspace ownership should not inherit that disposable-directory assumption. `src/main.ts` must stay unconfigured and scripted.

Workspace lifetime quotas and shared-inventory uncertainty remain limitations. Process-local owner sets do not provide OS-backed multi-process exclusion. Same-UID hostile races, power-loss durability and callback cleanup drainage are not established. Real browser reports and non-simulated evidence remain outside scope.

The configured artifact write was blocked because its authoritative destination is outside the working directory. This complete report is returned for runtime persistence.