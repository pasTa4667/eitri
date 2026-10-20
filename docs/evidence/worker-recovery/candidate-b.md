# Controller-owned worker intent and association journal

## Overview

Implement a durable controller worker-intent association journal as the next bounded prerequisite. Do not extend validator internals in this increment.

The journal records which admitted action intended to run which frozen browser request. It later associates a returned run UUID and cleanup claim with that intent. It does not dispatch Docker, establish executed cleanup, or admit real native checks.

This gives importing engineers durable history when a callback times out before returning a report. The controller retains action association and disposition ownership. The validator retains resource and cleanup ownership. `WorkspaceStore` retains source integrity ownership.

This is a prerequisite, not complete worker-run correlation. The validator generates its run UUID inside `execute`. Its public API cannot expose that UUID before execution or recover it through a guaranteed non-executing lookup. A controller-only change can persist an independent intent UUID before effects, but cannot promise the validator's exact run UUID before effects. [S2, S3]

Throughput checkpoint. Not applicable, read-only investigation.

## Key concepts

- **Worker intent.** Controller history containing the admitted action, frozen selection, check kind, independent configuration digest, and exact browser request.
- **Separate identities.** The controller allocates an intent UUID. The validator allocates a run UUID. Neither substitutes for the other.
- **Association claim.** A returned report matches an independently persisted expectation. Matching does not authenticate execution or cleanup.
- **Interrupted intent.** Effects may exist without an associated report. History must survive action settlement and native-details expiry.
- **Cleanup claim.** The journal records `report.cleanup`. It does not replace the validator's owned-resource verification.

`admitFrozenBrowserReport` checks bounded detached data, request consistency, scenario classification, and artifact integrity. It explicitly does not prove authorship, containment, resource ownership, or executed cleanup. [S4]

The following principles shaped this recommendation. Their leaf skills were read this session.

- Model the Domain led to explicit association states instead of completion flags beside optional IDs.
- Type System Discipline led to distinct intent and run identities and an `unknown` report boundary.
- Make Operations Idempotent led to exact duplicate handling and recovery without replay.
- Laziness Protocol excluded a second database and duplicate resource bookkeeping.
- Test Behavior, Not Implementation led to public Controller acceptance cases.

## How it works

### Existing boundary

1. The controller persists an admitted action. `checkAllowance` compares the supplied action against every persisted action field and checks state, epoch, cancellation, and remaining allowance. [S1]
2. Offline source selection persists `selecting`, freezes a checkpoint, then persists `selected` before callback entry. [S1, S5]
3. `dispatchCheck` races callback completion against cancellation. Its `finally` revokes source handles. Underlying unrelated callback effects may continue after that race ends. [S1, S6]
4. `finishAction` can delete the live action while source history remains. That history contains no worker run identity or cleanup record. [S1]
5. The unwired validator independently journals its run UUID, request, resource names, deadline, and reservation before execution effects. It returns its report after finalization. [S2, S3]

The gap is between durable owners.

```text
Controller catalogue                         Validator journal
  action + selected source
          |
  intent UUID + exact request ----future----> validate(request, signal)
          |                                      run UUID + resources
  awaiting report                               result + cleanup
          |                                         |
          +--------- associate returned report <----+
          |
  historical association, never a native check
```

### Proposed prerequisite

Add one `worker_intents` table to the existing catalogue. Retain the full action snapshot because `actions` rows are ephemeral. Reference the case and historical source association.

Enforce one intent per action. Enforce uniqueness of associated validator run UUIDs across this catalogue.

Enable this journal only through trusted offline configuration that pins a configuration digest. Persist configuration identity. Reject changed or omitted configuration on reopen once enabled. Existing unconfigured scripted behavior remains unchanged.

Expose `source.beginWorkerIntent()` for baseline and browser checks only. Derive the following from persisted controller records rather than callback input.

- Case, action, and epoch.
- Selected frozen tuple.
- Check kind and corresponding role.
- Configuration digest from trusted configuration.
- Exact allowance bounded by the current action and case budgets.
- Fixed `synthetic-click-v1` scenario.

Parse the constructed request with `frozenBrowserRequest`. Persist it before returning the handle. Reuse that exact request on duplicates. Do not recompute its allowance.

Run creation through the existing source-operation serialization and authority checks. No SQLite transaction spans an await.

Once a handle can escape, effects may have started. An unassociated intent therefore remains uncertain. Do not infer `not-needed` after a crash immediately following intent commitment. A separate prepared-versus-started protocol could reduce false-positive uncertainty, but is unnecessary for this prerequisite.

The handle exposes `recordReport(unknown)`. Validate the report against the saved expectation through the existing pure converter. Check run UUID uniqueness. Persist a compact detached association containing the report digest, outcome, and cleanup claim. Do not duplicate the screenshot and complete provenance in the controller catalogue.

Report recording is historical bookkeeping, not renewed source authority. An issued handle may associate its report after timeout or pause while the controller remains open. It can update only its own intent. It cannot edit source, append native evidence, renew allowance, or change a newer epoch's disposition.

For this increment, any callback that creates a worker intent cannot return `completed` into native storage. Use conservative `uncertain` disposition, or `cleanup-incomplete` when appropriate. Ordinary scripted callbacks that create no intent retain existing behavior.

Awaiting, interrupted, and cleanup-incomplete associations block Continue and Retry in this opt-in mode. Preserve pending pause settlement and terminal status. A clean current association does not auto-requeue or provide evidence. An interrupted intent remains blocked even if a late clean report is recorded. Clearing that interruption requires a future trusted reconciliation API.

### Crash cases

| Boundary | Required behavior |
| --- | --- |
| Before intent commit | No handle escapes. This API authorizes no worker effect. |
| After commit, before handle delivery | Reopen preserves an interrupted intent. Do not infer absence of effects. |
| After handle delivery, before validator admission | Preserve uncertainty. Do not invoke `validate` to discover whether admission occurred. |
| After validator admission, before returned report | Controller retains the exact request without a run UUID. Validator retains resource ownership. Replay neither owner. |
| After report return, before association commit | Controller remains interrupted. Trusted reconciliation remains necessary. |
| After association commit, before acknowledgment | Exact duplicate recording returns the saved association without another row. |
| Different report under one intent | Reject the conflicting digest. A cleanup revision requires a future explicit API. |
| Same run UUID under another intent | Reject the collision, including null-evidence reports. |
| Abort followed by late report | Record history only. Preserve pause precedence and newer-epoch disposition. |
| Native-details expiry | Retain worker and source history. Details deletion is not worker cleanup. |
| Corrupt association | Park execution without marking healthy native storage missing. |
| Controller close | Drain admitted catalogue operations and retain unresolved history. Do not claim external work drained. |

The no-replay restriction matters because `validate` executes a previously unseen request. A settled duplicate returns saved history only when the validator already knows that identity. The controller cannot establish that fact through today's public API. [S3]

## Where things live

### Existing source references

- **[S1] `src/controller.ts`.** Catalogue tables at lines 193–204. Source selection and recovery at 454–619. Allowance, callback disposition, and action settlement at 998–1184. Recovery at 1377–1466. Native-details expiry at 1468–1514. Close at 1620–1638.
- **[S2] `src/frozen-browser.ts`.** Intent and resource state at 140–166. Request identity key at 256–257. Run UUID allocation and initial durable intent at 1740–1775.
- **[S3] `src/frozen-browser.ts`.** Interrupted recovery at 1507–1521. Active and settled deduplication at 1597–1641. Owned resource removal and finalization at 2215–2277. Close at 2279–2293.
- **[S4] `src/frozen-browser.ts:502–605`.** Pure report conversion. `docs/frozen-browser.md` explains claim-verification limits and durable ownership.
- **[S5] `src/workspace.ts:97–101` and `1576–1625`.** Frozen identity, freeze, and verified historical reads. `docs/controller-workspace.md` explains source ownership and revocation.
- **[S6] `docs/check-execution.md`.** Controller ownership and Limits sections preserve simulated-only evidence and distinguish cancellation from drainage.
- **[S7] `docs/work-log.md:192–214`.** Offline workspace ownership and pure converter completion. Cleanup correlation and real evidence persistence remain deferred.
- **[S8] `.audit/worker-correlation-plan.md`.** Scope permits the smallest prerequisite and requires conservative crash and cleanup behavior.

### Proposed placement

Keep the controller-owned journal beside `ActionSource` in `src/controller.ts`. Add `test/controller-worker-intents.test.ts`.

Reuse synthetic report patterns from `test/frozen-browser-admission.test.ts`. Reuse temporary Git, SQLite, faux-provider, and SIGKILL patterns from `test/controller-workspace.test.ts`.

No validator, worker, HTTP, native receipt, or production entry-point edit is needed.

## Gotchas

- A controller intent UUID does not solve pre-effect validator run UUID discovery.
- `allowanceMs` participates in validator request identity. Recomputing it later can cause `validator-identity-conflict`. Persist the original request. [S3]
- The validator establishes its deadline at validator admission. A controller intent timestamp cannot be presented as that deadline. Future dispatch integration must prevent delayed handoff from renewing controller allowance. [S1, S2]
- Settled `validate` repeats do not repair cleanup. Reopening the validator can retry finalization, so existing `open` is not an inert history reader. [S3]
- A lost build response can leave daemon effects unresolved even when no derived tag currently exists. Cancellation and empty listings are not cleanup proof. [S3]
- A null-evidence report does not independently establish report-side configuration identity. [S4]
- Controller recovery contains a broad catch that marks native storage missing. Worker association failures must not escape into that catch. [S1]
- Action-source settlement is not worker cleanup settlement.
- Two journals do not become atomic through correlation. This proposal makes missing association visible and conservative.

## Small type and API sketch

These are proposed types, not existing exports. Runtime parsers must validate branded IDs, persisted rows, and returned reports.

```ts
type WorkerIntentId =
	string & { readonly __brand: 'WorkerIntentId' };

type WorkerRunId =
	string & { readonly __brand: 'WorkerRunId' };

type WorkerAssociation = Readonly<{
	intentId: WorkerIntentId;
	runId: WorkerRunId;
	reportDigest: Sha256;
	outcome: FrozenBrowserOutcome;
	cleanupClaim: FrozenBrowserCleanup;
}>;

type WorkerIntentState =
	| Readonly<{ state: 'awaiting-report' }>
	| Readonly<{ state: 'interrupted'; reason: string }>
	| Readonly<{
		state: 'associated';
		association: WorkerAssociation;
	}>
	| Readonly<{
		state: 'interrupted-associated';
		reason: string;
		association: WorkerAssociation;
	}>;

type WorkerIntent = Readonly<{
	version: 1;
	intentId: WorkerIntentId;
	action: Readonly<Action>;
	expected: FrozenBrowserExpectation;
	createdAt: number;
}> & WorkerIntentState;

type WorkerIntentHandle = Readonly<{
	intentId: WorkerIntentId;
	request: FrozenBrowserRequest;
	recordReport(value: unknown): Promise<WorkerIntent>;
}>;

type WorkerIntentSource = OfflineActionWorkspace & Readonly<{
	beginWorkerIntent(): Promise<WorkerIntentHandle>;
}>;

type WorkerIntentOptions = Readonly<{
	configurationDigest: Sha256;
}>;

interface WorkerIntentHistory {
	workerIntents(caseId: string): Promise<readonly WorkerIntent[]>;
}
```

`beginWorkerIntent` rejects unsupported kinds, stale authority, exhausted allowance, and inconsistent selected source. An exact duplicate returns the existing intent only while creation authority remains valid.

`recordReport` rejects mismatched requests, reused run UUIDs, and conflicting repeats. Recording an interrupted intent cannot erase its interruption.

Apply fixed association count and byte limits. A conservative proposed starting bound is 16 lifetime intents per case and 128 per catalogue, without refunds or eviction. These are proposed controller limits, not inherited validator quotas.

The smallest done predicate is durable intent creation, exact report association, interrupted recovery without replay, mismatch rejection, and conservative incomplete cleanup disposition. No test needs to instantiate `FrozenBrowserValidator`.

## Proposed tests

Use public Controller and callback APIs with synthetic source and reports. No Docker or project-code execution is required.

1. Create and associate an intent, close, and reopen. Assert exact action, frozen tuple, original allowance, run UUID, outcome, and cleanup claim. Include an ordinary no-intent scripted check as a positive control.
2. Mutate returned requests, reports, and history. Reopen and assert the original persisted literal values.
3. SIGKILL after intent commit and after simulated worker admission. Reopen with retained interrupted history, no replay, conservative case disposition, and healthy native storage.
4. SIGKILL after association commit before acknowledgment. Assert exactly one association and idempotent exact-report recording.
5. Change every request identity component, including allowance and manifest digest. Assert rejection and unchanged saved history. Separately reject run UUID reuse across actions.
6. Associate behavioral success with incomplete cleanup. Assert retained success history, cleanup-incomplete disposition, unchanged repairs, and no native evidence.
7. Return a report after cancellation and action settlement. Assert historical association without allowance renewal, new evidence, or newer-epoch changes. Cover pending pause separately.
8. Attempt Continue and Retry with unresolved history. Assert denial and retained issue ownership. Cover clean current association without automatic requeue.
9. Expire terminal native details and reopen. Assert retained intent history and terminal status.
10. Close during admitted journal work. Assert drainage and durable history. Retained handles called after close reject without implying worker drainage.

No tests were run during this investigation.

## Alternatives and ranking

| Rank | Alternative | Judgment |
| --- | --- | --- |
| 1 | Controller-owned intent and association journal | Smallest independent prerequisite. Preserves accepted validator execution. Leaves exact run discovery and trusted cleanup reconciliation explicit. |
| 2 | Validator `prepare`, `executePrepared`, and lookup API | Stronger eventual solution. Changes admission states, quotas, deduplication, cancellation, and accepted crash boundaries. Too broad here. |
| 3 | Read-only validator lookup by action identity | Useful later, but does not replace durable controller intent. Existing validator open can perform cleanup. |
| 4 | Add returned run UUID to `ActionSource` | Reject. Loses the pre-report crash window and conflates source and worker lifetimes. |
| 5 | Controller-owned Docker inspection and cleanup | Reject. Duplicates resource ownership rules and violates this increment's scope. |
| 6 | Treat converter eligibility as native admission | Reject. Consistent fabricated reports can pass without authentic execution or cleanup. [S4, S7] |

The next stronger increment should provide a trusted validator identity and reconciliation API. Do not bridge the remaining gap through replay or weaker native admission.

## Evidence and residual risks

All requested files were inspected, including source continuations after tool truncation. Relevant local skills were read. The requested base was `d932d8c`; Git identity was not independently checked.

No repository edits, Docker, credentials, inference, project commands, commits, or subagents were used. Writing the requested external artifact was attempted, but the tool blocked an outside-working-directory write. This response supplies the artifact for runtime persistence.

Residual risks remain explicit. Missing run UUIDs cannot be recovered through current public APIs. Cleanup claims remain unauthenticated. Interrupted associations have no clearing operation in this increment. Same-UID hostile writers, multi-process ownership, physical disk reclamation, and power-loss durability remain outside the proposed guarantee.