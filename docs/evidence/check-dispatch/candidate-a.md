# Admitted check execution candidate A

## Usage first

Recommend an immutable request envelope and a discriminated result. Callback authors receive the actual admitted identity without access to mutable controller authority.

```ts
await Controller.open({
	...options,
	check: async (request) => ({
		type: 'completed',
		check: {
			kind: request.kind,
			candidate: scriptedRevision,
			configuration: scriptedConfiguration,
			passed: true,
			simulated: true,
			outputs: [],
		},
	}),
});
```

Infrastructure failure is not a failed behavioral check:

```ts
await Controller.open({
	...options,
	check: async (request) => {
		assert.equal(request.caseId, expectedCaseId);
		assert.ok(request.remainingMs > 0);
		return { type: 'infrastructure' };
	},
});
```

Native passes its existing admitted action:

```ts
const execution = await host.check(action, kind, signal);

if (execution.type === 'completed') {
	return native.recordCheck(action, checkId, execution.check, signal);
}

// Settle the existing tool action, then terminate the native turn.
// Do not fabricate a Check or invoke checkpoint.
```

## Problem and grounding

Inspection confirmed HEAD `c045082a84fa3d71f04bf620a12c31d6712d4d98` and a clean working tree.

`src/controller.ts:40,426` omits admitted action identity from the configured callback. Native already admits the tool before calling it. `recordCheck` guards evidence after execution. Ordinary failed receipts reach `checkpoint`, which can trigger implementation and repair state.

`docs/evidence/validator-integration/validator-next-how.md` correctly separates this boundary from workspace ownership, real validator reports, and cleanup drainage.

There is one additional integration constraint. `finishAction` unconditionally applies attention on uncertainty. Recovery also applies attention for interrupted tools and unsettled native tasks. Those paths can override an operator pause. The new result union alone cannot satisfy the pause requirement.

For callback authors, the change removes inferred action identity and unreliable failed-check workarounds. Maintainers retain separate controller authority and native evidence ownership.

## Shape A, immutable envelope

```ts
// src/domain.ts
export type AdmittedCheckRequest = Readonly<{
	caseId: string;
	actionId: string;
	epoch: number;
	kind: Check['kind'];
	remainingMs: number;
	signal: AbortSignal;
}>;

export type CheckExecution =
	| { type: 'completed'; check: CheckResult }
	| { type: 'infrastructure' }
	| { type: 'unrelated' }
	| { type: 'cancelled' }
	| { type: 'uncertain' }
	| { type: 'cleanup-incomplete' };

// Controller Options. Replace the old signature.
check?: (request: AdmittedCheckRequest) => Promise<CheckExecution>;

// RuntimeHost
check(
	action: Action,
	kind: Check['kind'],
	signal: AbortSignal,
): Promise<CheckExecution>;

// Controller implementation sketches
private executeCheck(
	id: string,
	action: Action,
	kind: Check['kind'],
	signal: AbortSignal,
): Promise<CheckExecution>;

private checkRequest(
	id: string,
	action: Action,
	kind: Check['kind'],
	signal: AbortSignal,
): AdmittedCheckRequest;

private parkCheck(action: Action, reason: string): void;

// File-private host-boundary parser
function parseCheckExecution(
	value: unknown,
	kind: Check['kind'],
): CheckExecution;
```

Only `completed` carries evidence. There is no cleanup boolean that can contradict success. Reliable observations with incomplete cleanup return `cleanup-incomplete` without evidence.

### Authority and allowance

Immediately before callback invocation, the controller synchronously:

1. Reads the persisted action and compares every Action field with the native action.
2. Requires matching case, tool kind, epoch, native readiness, running status, enabled dispatch, and a non-aborted signal.
3. Charges elapsed case allowance.
4. Computes remaining allowance from persisted authority:

```ts
remainingMs = Math.min(
	caseRemainingMs,
	admitted.limitMs - Math.max(0, now - admitted.startedAt),
);
```

Nonpositive allowance denies dispatch. Capture time consistently for charging and the calculation.

Freeze a new request object containing scalar copies and the signal. Do not expose Action or Case. Do not freeze the signal itself. Invoke the callback without an intervening await.

The allowance is a dispatch-time snapshot. It neither renews the tool deadline nor proves worker cleanup.

### Return parsing

Treat the callback return as `unknown`, despite its TypeScript signature.

The controller parser accepts exact variant keys. For completed receipts, it validates requested kind, existing receipt fields, simulated admission, output limits, and bytes through `validateOutput`. Reject extra fields, including evidence attached to a non-behavior outcome.

Copy receipt fields, output records, and bytes before any await or persistence. Malformed results become conservative internal failures, never behavioral failures.

After parsing, recheck cancellation and authority. Extend existing native write guards to reject expired action or case allowance. Preserve current permission to record a reliable already-dispatched receipt during `pause-requested`. A new callback must not start during that status.

Native retains its existing evidence validation because durable persistence is a separate trust boundary.

### Module ownership

| Module | Ownership |
| --- | --- |
| `src/domain.ts` | Request and execution types. No validator or storage representations. |
| `src/controller.ts` | Authority, request construction, callback parsing, durable stop policy. |
| `src/native.ts` | Existing action lifecycle, completed evidence recording, native-turn termination. |
| `src/artifacts.ts` | Existing output validation and limits. No schema changes. |

One callback argument and one result union hide authority lookup, allowance arithmetic, malformed-return handling, and durable stopping. No generic executor or additional execution API is needed.

## Exact failure and pause policy

Every conservative stop retains issue ownership, phase, base, candidate, failedCandidate, and repairs. It creates no check or artifact and never invokes checkpoint.

| Event | Policy |
| --- | --- |
| Valid completed result | Preserve ordinary pass/fail receipts, artifacts, repair behavior, and assessment gates. |
| Five non-behavior variants | Park a running case in `needs-attention`, with fixed reasons `check-infrastructure`, `check-unrelated`, `check-cancelled`, `check-uncertain`, or `check-cleanup-incomplete`. |
| Callback absent | Park with `check-not-configured`. |
| Callback throws without cancellation | Park with `check-callback-failed`. Do not persist arbitrary exception text. |
| Malformed or contradictory return | Park with `invalid-check-execution`, before any output storage. |
| Cancellation or expiry at dispatch | Do not invoke the callback. Park a still-running owning epoch with `check-cancelled` or `check-allowance-exhausted`. |
| Cancellation or expiry at return | Discard the result and apply the same stop policy. |
| Invalid or stale authority | Deny dispatch or evidence. Park only the still-running owning epoch with `check-dispatch-denied`. Never alter a newer epoch. |
| Stop during pause-requested | Persist `paused`, clear accounting, advance epoch and version, and retain the fixed stop reason. |
| Already paused, stopped, terminal, newer epoch, or closing | Do not apply stale-result mutations. Preserve disposition. |

`parkCheck` is synchronous, transactional, and idempotent for the owning epoch. Persist the stop before returning the non-behavior result to native. Native settles the tool and terminates the turn.

Make two bounded lifecycle corrections:

- `finishAction` must not replace `pause-requested`, `paused`, or an already durable check stop with timeout attention. It still accounts time and removes the action.
- Recovery must preserve paused disposition and existing check-stop reasons through interrupted-action and unsettled-native-tool handling. Interrupted running tools otherwise retain existing uncertainty behavior.

A crash before stop persistence follows ordinary interrupted-tool recovery without replay. A crash afterward retains the durable stop.

This does not provide atomic rollback of evidence already committed before cancellation. Existing artifact persistence has multiple guarded writes. Late results first observed after authority loss cannot begin admission.

## Shape B, action-scoped completion capability

A structurally different alternative gives callbacks host-issued completion methods:

```ts
check: async (scope) => {
	if (syntheticInfrastructureFailure)
		return scope.stop('infrastructure');

	return scope.complete(scriptedResult(scope.request.kind));
};

type StopKind = Exclude<CheckExecution['type'], 'completed'>;

declare const completionBrand: unique symbol;

type CheckCompletion = CheckExecution & {
	readonly [completionBrand]: true;
};

interface CheckScope {
	readonly request: AdmittedCheckRequest;
	complete(result: CheckResult): CheckCompletion;
	stop(reason: StopKind): CheckCompletion;
}

// Alternative signature, not an additional supported API.
check?: (scope: CheckScope) => Promise<CheckCompletion>;
```

The implementation keeps the brand private. Each invocation owns one completion token. `complete` parses its input and checks authority. The host checks returned token identity, rejects repeated completion, and applies the same durable policy as A. Cross-case or forged tokens fail closed.

B hides result construction and token ownership. It exposes a completion protocol and requires invocation-local mutable state. Calling `complete` cannot persist evidence immediately because the callback may subsequently throw. Final host validation remains necessary.

B therefore adds lifecycle rules without removing the essential return boundary.

## Synthesis decision

Recommend A as this candidate package’s base. Parent synthesis remains pending.

A provides the required authority and failure distinction without introducing completion tokens. Retain B’s emphasis on return-time validation, not its completion protocol.

Red-flag screening favors A:

- One execution API replaces the old one.
- No public parser or importable execution internals.
- No additional authority writer.
- No pass-through-only module.
- One exhaustive controller outcome mapping drives stopping.
- No validator, wire, workspace, or provenance types escape through the callback.

B risks temporal decomposition through completion-token creation, callback return, and settlement.

## Tradeoffs accepted

- We accept structurally forgeable TypeScript values in exchange for a small callback contract. Runtime parsing decides admission.
- We accept no observations on conservative outcomes in exchange for excluding contradictory evidence.
- We accept a snapshot allowance in exchange for no execution handle or deadline service.
- We accept narrowly scoped pause corrections because existing lifecycle behavior otherwise violates the task.

Principles applied after reading their leaf skills:

- **Model the Domain** changed the output into six exclusive variants rather than optional failure fields.
- **Boundary Discipline** placed unknown-return parsing and stopping at the controller boundary.
- **Exhaust the Design Space** prompted comparison with a completion capability, rather than another envelope spelling.

## Caller migration list

Migrate in one wave, without an overload:

- `src/controller.ts` changes Options.check and its native bridge.
- `src/native.ts` changes RuntimeHost.check and run_check.
- `test/evidence.test.ts:179,272` takes request.kind and wraps ordinary receipts in completed.
- `test/http.test.ts:189` and `test/crash-worker.ts:37` do the same.
- `test/artifact-resources.test.ts:67,188,241` wraps receipts. Malformed receipt fixtures remain inside the completed payload.
- `test/artifact-resources.test.ts:265` audits the explicit RuntimeHost fixture. Its throwing sentinel remains valid.
- `test/recovery.test.ts:120` retains its throwing no-replay callback under the new signature.

Keep existing CheckResult fixture helpers as receipt helpers. Repository-wide TypeScript search found no other configured check callbacks.

## Controller-interface test matrix

Use public Controller methods, faux providers, and real temporary SQLite/native stores. No private-method casts.

| Exercise | Required observation |
| --- | --- |
| Actual admitted identity | Request identity matches the action row and resulting check/artifact provenance. Kind matches the request. Remaining allowance is positive and bounded. |
| Mutation attempt | Frozen request cannot mutate persisted action authority. |
| Capacity two | Concurrent gated callbacks have distinct case/action bindings. Stopping one leaves the other unchanged. |
| Expired dispatch | Inject clock expiry between admission and dispatch. Callback effect counter remains zero. |
| Invalid authority | Controlled action-row fault fixtures alter ID, case binding, kind, or epoch before validation. Callback counter remains zero. |
| Completed pass/fail | Preserve literal existing evidence, configuration, artifact retrieval, phase, and repair expectations. |
| Every conservative variant | Assert exact unchanged candidate, failedCandidate, repairs, phase, check count, artifact count, and artifact directory contents. Assert disposition and issue ownership. |
| Pause races | Pause while callback is gated. Non-behavior results end paused without evidence. Reliable already-dispatched completed receipts preserve current behavior. Pause before dispatch denies callback execution. |
| Timeout and late completion | Release a completed result after cancellation. No late evidence appears. Operator pause remains paused. |
| Malformed returns | Reject null, arrays, unknown variants, missing receipt, wrong kind, invalid simulated flag, extra fields, contradictory evidence, oversized outputs, and invalid bytes. |
| Retained mutable output | Callback-side mutation after parsing cannot change admitted receipt or bytes. |
| Restart | Every persisted stop and paused stop survives reopen without replay or additional evidence. Exercise interrupted-action and unsettled-tool recovery. |
| Import review | No runtime frozen-browser/workspace import, HTTP/Rust changes, schema changes, dependencies, or fixture changes. |

For stale-authority fixtures, the existing Options.fault interface can support a `before-check-dispatch` point before validation. Tests may use controlled SQLite corruption there without exposing controller internals.

Parent validation should run focused boundary/evidence/resource/recovery tests, full `verify:all`, and fresh source/comment reviews. No tests ran for this design task.

## Open questions and risks

- Does parent synthesis retain current recording permission for a reliable already-dispatched receipt during pause-requested?
- Can the existing non-atomic artifact persistence limitation remain explicit?
- Will the later validator binding require durable cleanup/report correlation before retry? This unit supplies neither.

## Next implementation step

Add the request and union, then prove one successful callback and one conservative stop through Controller before migrating every caller.