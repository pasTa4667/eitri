# Candidate B. Explicit admitted check request

The output tool blocked the authoritative path because it is outside the working directory. This response contains the complete artifact for runtime persistence.

## Usage first

Scripted hosts receive the actual admitted action and return an execution outcome.

```ts
const controller = await Controller.open({
	...options,
	check: async ({ action, kind, remainingMs, signal }) => {
		signal.throwIfAborted();
		assert(action.kind === 'tool' && remainingMs > 0);
		return {
			type: 'completed',
			check: scriptedReceipt(action.caseId, kind),
		};
	},
});
```

Unavailable validation does not produce a failed check.

```ts
check: async () => ({ type: 'infrastructure' })
```

Native execution passes its existing admitted action.

```ts
const execution = await host.check(action, kind, signal);
if (execution.type !== 'completed') return execution;
return native.recordCheck(action, checkId, execution.check, signal);
```

The outer `run_check.execute` returns `control: { terminate: true }` for non-behavior outcomes. The controller persists the conservative disposition before returning that outcome.

## Problem and grounding

Inspected HEAD is `c045082a84fa3d71f04bf620a12c31d6712d4d98`. `git status --short` reported no changes.

Grounding is `docs/evidence/validator-integration/validator-next-how.md` and current controller, native, domain, artifact, and callback-test definitions.

`NativeCase` admits an action before calling `host.check`, but drops its identity at `src/native.ts:258`. The controller bridge at `src/controller.ts:426` invokes the configured callback without dispatch validation. `recordCheck` guards evidence afterward. `checkpoint` interprets ordinary failed checks as repair evidence at `src/controller.ts:540–567`.

This unit adds dispatch authority and truthful execution outcomes. It does not bind the validator.

Ground and Sketch are complete. The parent owns synthesis and implementation. No runtime experiment is authorized.

## Shape

### Recommended contracts

```ts
// src/domain.ts. In-memory contracts only.
export type AdmittedCheckRequest = Readonly<{
	action: Readonly<Action & { kind: 'tool' }>;
	kind: Check['kind'];
	remainingMs: number;
	signal: AbortSignal;
}>;

export type CheckExecution =
	| { type: 'completed'; check: CheckResult }
	| { type: 'infrastructure' }
	| { type: 'unrelated-failure' }
	| { type: 'cancelled' }
	| { type: 'uncertain' }
	| { type: 'cleanup-incomplete' };

export type CheckCallback =
	(request: AdmittedCheckRequest) => Promise<CheckExecution>;

// Controller Options replaces the existing positional callback.
check?: CheckCallback;

// RuntimeHost retains the internal admitted-action boundary.
check(
	action: Action,
	kind: Check['kind'],
	signal: AbortSignal,
): Promise<CheckExecution>;

// Existing guarded persistence boundary remains.
validateCheckAction(action: Action): void;

// src/check-execution.ts.
export function parseCheckExecution(
	value: unknown,
	kind: Check['kind'],
): CheckExecution;

// Controller-private policy.
private dispatchCheck(
	id: string,
	action: Action,
	kind: Check['kind'],
	signal: AbortSignal,
): Promise<CheckExecution>;

private stopCheck(action: Action, reason: string): void;
```

Only `completed` carries a receipt. It means reliable completion with complete cleanup. Observed behavioral success with incomplete cleanup becomes `cleanup-incomplete`, without a receipt.

The parser treats callback returns as `unknown`. It rejects unknown tags, extra keys, missing payloads, receipts attached to stop variants, requested-kind mismatch, and invalid completed receipts. It retains simulated-only validation and existing artifact limits.

The parser returns detached receipt objects and copied output bytes. Callback mutation after resolution cannot alter evidence admission.

Per **Model the Domain**, the discriminant replaces optional combinations of behavioral result, cancellation, and cleanup state. Per **Boundary Discipline**, callback data becomes domain data at the host boundary. Neither browser wire types nor storage/provenance objects enter this API.

### Dispatch authority

Immediately before callback invocation, the controller:

1. Reads the persisted action and current case in a transaction.
2. Charges elapsed case time.
3. Requires running status, ready native storage, matching epoch, and an active tool action belonging to the actual case.
4. Compares the supplied action with persisted identity, start, limit, epoch, and accounting origin.
5. Rejects shutdown, startup, aborted signals, exhausted case allowance, and expired action allowance.
6. Creates a frozen action copy and frozen request.
7. Invokes the callback without an intervening `await`.

Compute allowance using the controller clock:

```ts
remainingMs = Math.min(
	case.remainingMs,
	action.limitMs - Math.max(0, now - action.startedAt),
);
```

Reject nonpositive allowance. Never grant a fresh minute.

A pending pause denies new dispatch. Existing in-flight reliable receipts may finish during `pause-requested`, preserving current behavior.

After callback resolution, recheck signal and authority before accepting the parsed result. Strengthen `validateCheckAction` with persisted-action comparison and deadline checks. Keep its guards before artifact writes, within native commits, and before checkpointing.

The callback receives no mutable authority shared with bookkeeping. A signal and allowance do not establish cleanup drainage. Existing underlying work may outlive timeout, but late results must not admit evidence or overwrite newer control state.

### Module ownership

| Module | Responsibility |
| --- | --- |
| `src/domain.ts` | Request and execution types. Existing persistent types retain their meanings. |
| `src/check-execution.ts` | Strict callback parsing and detached payloads using existing artifact validators. |
| `src/controller.ts` | Authority, allowance, request construction, and durable conservative disposition. |
| `src/native.ts` | Pass actual admitted action, branch on execution outcome, and persist only completed receipts. |
| `src/artifacts.ts` | Existing artifact validation and limits. |

No generic executor, registry, observer, run handle, workspace ownership, or validator imports are introduced.

## Exact failure and pause policy

| Observation | Policy |
| --- | --- |
| Completed pass or behavioral fail | Existing receipt, artifact, assessment, baseline, and repair behavior. |
| Infrastructure | Stop with `check-infrastructure`. |
| Unrelated failure | Stop with `check-unrelated-failure`. |
| Callback cancellation | Stop with `check-cancelled`. |
| Uncertainty | Stop with `check-uncertain`. |
| Incomplete cleanup | Stop with `check-cleanup-incomplete`, even after observed success. |
| Missing callback | Stop with `validation-not-configured`. |
| Callback rejection | Stop with `check-callback-failed`. |
| Malformed or contradictory return | Stop with `invalid-check-execution`. |
| Invalid dispatch authority | Do not invoke callback. Stop with `check-dispatch-denied` unless pause or newer state already owns disposition. |
| Signal timeout or abort | Existing action-timeout handling stops progression. Reject every later result. |

“Stop” is one transaction scoped to the still-current action and epoch.

- For `running`, charge elapsed time and use the existing attention transition. Persist `needs-attention`, reason, cleared accounting, and advanced epoch/version.
- For `pause-requested`, preserve that status and attach the finite reason. The existing execute epilogue settles to `paused`.
- For `paused`, preserve pause.
- For newer epochs or terminal dispositions, do nothing.
- Repeated settlement is a no-op.
- Leave phase, base, candidate, failedCandidate, and repairs unchanged.
- Retain issue ownership.
- Create no check or artifact. Ordinary action-result journaling remains permitted.

Two existing paths require local pause-precedence fixes. `finishAction(..., uncertain=true)` currently calls `attention` unconditionally. Recovery also calls `attention` for interrupted tools and can replace paused status when `hasUnsettledTool()` is true.

Preserve pending or settled pause in those branches. Preserve already durable attention reasons during restart. Interrupted tools without pause retain existing uncertainty handling and do not replay. These are disposition guards, not a timeout/drainage rewrite.

## Structurally distinct alternative

An action-scoped completion capability removes returned receipts.

```ts
check: async (execution) => {
	const { action, kind } = execution.request;
	await execution.complete(scriptedReceipt(action.caseId, kind));
};

check: async (execution) => {
	execution.stop('infrastructure');
};

interface CheckExecutionCapability {
	readonly request: AdmittedCheckRequest;
	complete(value: CheckResult): Promise<void>;
	stop(
		reason:
			| 'infrastructure'
			| 'unrelated-failure'
			| 'cancelled'
			| 'uncertain'
			| 'cleanup-incomplete',
	): void;
}

type CapabilityCallback =
	(execution: CheckExecutionCapability) => Promise<void>;
```

The controller owns revocation and one-shot settlement. Native supplies its guarded evidence writer behind `complete`. Completion arguments still require boundary parsing.

This shape hides evidence writing and late-write guards. It exposes temporal obligations instead. No settlement, duplicate settlement, and completion followed by rejection each need policy. A callback can complete and then hang, leaving already stored evidence and an unsettled action.

## Recommendation and synthesis decision

Recommend the explicit envelope and returned union as the parent’s synthesis base. No capability graft is needed.

The envelope concentrates authority and disposition behind one callback operation. Evidence persistence stays with its existing owner. Callback authors choose one result rather than coordinating settlement calls.

The capability hides more persistence detail but exposes a harder lifecycle contract. That complexity does not earn its place in this unit.

The red-flag screen favors the envelope:

- No validator representation leakage.
- No additional evidence writer.
- No public completion protocol.
- No hand-synchronized registry.
- No alternate legacy entry point.
- No pass-through-only controller bridge. It adds authority and policy.

Per **Migrate Callers Then Delete Legacy APIs**, migrate every caller and remove positional callback support in the same change.

## Tradeoffs accepted

- We accept finite reason codes without callback diagnostics in exchange for a small, strictly parsed contract.
- We retain native persistence validation in exchange for preserving its guarded storage boundary.
- We accept unproven cleanup drainage because execution activation remains outside scope.

## Caller migration list

Inventory used:

```sh
rg -n 'RuntimeHost|NativeCase.open|validateCheckAction|check:|check\(' src test --glob '*.ts'
```

- `src/controller.ts` replaces `Options.check` and the bridge.
- `src/native.ts` replaces `RuntimeHost.check`, its invocation, and the tool-output branch.
- `test/evidence.test.ts:179,272` destructures request kind and wraps ordinary receipts in `completed`.
- `test/http.test.ts:189` and `test/crash-worker.ts:37` migrate identically.
- `test/artifact-resources.test.ts:67,188,241` wraps receipts. Invalid receipt fixtures stay invalid inside `completed`.
- `test/artifact-resources.test.ts:253–266` updates its read-only native host signature. Unexpected execution traps remain.
- `test/recovery.test.ts:120` retains its no-replay assertion under the new signature.

No other direct host construction or production check callback appeared in this inventory. HTTP and Rust protocols remain unchanged.

## Controller-interface test matrix

All behavioral tests use public Controller operations, temporary SQLite/native stores, and faux providers. No private-method casts.

| Scenario | Required observable result |
| --- | --- |
| Successful callback | Captured request matches active SQLite action, actual case/epoch, requested kind, and bounded remaining allowance. Stored evidence references that action. |
| Request mutation | Frozen copies reject or ignore mutation. Controller bookkeeping and evidence provenance remain unchanged. |
| Capacity two | Distinct per-case requests, actions, and signals. Reverse completion preserves evidence ownership. |
| Expired dispatch | Injected clock exhausts allowance before callback. Callback count and new evidence count remain zero. |
| Invalid/stale action | Adversarial persisted-action fixture rejects dispatch before callback effects. Use existing fault injection, adding one narrow admitted-action fault point only if necessary. |
| Late completion | Hold callback past timeout or authority loss, then return valid success. No new check or artifact appears. |
| Ordinary pass/fail | Existing baseline, artifacts, configuration equality, assessment gates, and two-repair-candidate expectations remain valid. |
| Every non-behavior variant | From testing with existing candidate/repair history, only disposition/accounting/version/epoch/reason change. No implementation transition, failedCandidate mutation, repair increment, evidence, or subsequent provider dispatch. |
| Operator pause | Pause while callback is blocked, then return each non-behavior outcome. Final status is paused. Cover timeout separately. |
| Malformed results | Reject null, arrays, unknown tags, extra keys, contradictory payloads, kind mismatch, non-simulated receipts, and invalid artifacts. No repair mutation. |
| Callback absent/rejected | Conservative attention with finite reason and no failed check. |
| Restart | Preserve pause or attention, issue ownership, candidate history, and evidence counts. Include interruption before native tool settlement. Never replay callback. |
| Scope regression | No new frozen-browser/workspace execution imports. Existing simulated-only guards and artifact limits remain active. |

## Open questions and risks

Can existing fault hooks cover both crash windows, after conservative disposition and before native tool settlement? Acceptance must prove both.

Will future validator binding need durable diagnostics beyond finite reasons? That later unit must decide separately. This proposal claims neither report persistence nor worker cleanup.

## Next implementation step

After parent synthesis, implement the union, parser, and dispatch guard with the first public Controller test proving actual action identity and immutable request isolation.