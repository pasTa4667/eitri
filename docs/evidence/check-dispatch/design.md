# Admitted check execution design

## Problem

The configured callback currently loses its admitted tool action identity. A generic failed receipt can turn infrastructure failure into repair work. This unit adds an action-bound dispatch contract and conservative synthetic execution outcomes. It does not bind the browser validator.

## Usage and chosen data shape

```ts
check: async ({ caseId, actionId, epoch, kind, remainingMs, signal }) => {
  signal.throwIfAborted();
  return {
    type: 'completed',
    check: { kind, candidate, configuration, passed: true, simulated: true, outputs: [] },
  };
}

check: async () => ({ type: 'infrastructure' });
```

```ts
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
  | { type: 'unrelated-failure' }
  | { type: 'cancelled' }
  | { type: 'uncertain' }
  | { type: 'cleanup-incomplete' };
```

Controller Options.check becomes `(request: AdmittedCheckRequest) => Promise<CheckExecution>`. No old overload survives. RuntimeHost.check takes `(action: Action, kind: Check['kind'], signal: AbortSignal)` and returns CheckExecution. Native passes the actual admitted action. Native remains the evidence writer and only records the completed variant. Non-completed variants settle the tool and terminate its native turn.

Controller owns request construction, authority checks, callback-return parsing and durable conservative stopping. Keep its parser file-private unless implementation proves a concrete shared owner is needed. Callback authors receive no mutable Action or Case, persisted bookkeeping or validator representation. Only a new scalar request object is frozen. The signal itself is not frozen.

## Authority and parsing

Compare the supplied action against every persisted Action field. Require owning case, tool kind, matching epoch, ready native store, running status, enabled dispatch, positive allowance and a non-aborted signal immediately before callback invocation, without an intervening await. Charge elapsed time and compute remainingMs as the lesser of case allowance and admitted action limit minus elapsed action time. Use a consistent clock reading, not a new full minute.

Parse callback results as unknown at this boundary. Require exact variant keys and a requested-kind-matching completed receipt. Preserve existing simulated-only checks and artifact limits. Validate and copy receipt fields, output records and bytes synchronously before any later await. Non-behavior variants cannot contain a receipt or observations.

Recheck authority, signal and remaining allowance before admission of the returned result. Strengthen existing native write guards accordingly. An already-dispatched reliable completed receipt may still record during pause-requested, as before. New callback dispatch cannot start there.

## Stop policy

All non-behavior variants preserve phase, base, candidate, failedCandidate, repairs and issue ownership. They produce no check or artifact and never call checkpoint.

| Event | Fixed reason |
| --- | --- |
| infrastructure | check-infrastructure |
| unrelated-failure | check-unrelated-failure |
| cancelled | check-cancelled |
| uncertain | check-uncertain |
| cleanup-incomplete | check-cleanup-incomplete |
| Missing callback | validation-not-configured |
| Callback rejection | check-callback-failed |
| Malformed or contradictory return | invalid-check-execution |
| Expired allowance | check-allowance-exhausted |
| Invalid owning action | check-dispatch-denied |

For the still-owning running epoch, stop durably in needs-attention. For pause-requested, save the finite reason but retain pause-requested. Settle the admitted action, terminate the turn, and let the existing execute epilogue reach paused. Do not mutate a newer epoch or terminal, already paused or already stopped disposition. Cancellation or expiry at return discards any completed result before admission. Do not store arbitrary exception text as a reason. Error paths must not trigger further provider dispatch or speculative repair.

Bounded finishAction and recovery changes must preserve pending or settled pause and an existing durable conservative stop. Interrupted running tools otherwise retain current uncertainty behavior and no replay. These are disposition guards, not a drainage or timeout-service rewrite.

## Scope decisions

Ordinary completed pass/fail behavior, including the existing failed-baseline checkpoint behavior during a pending pause, remains unchanged. This unit does not claim to fix every possible completed-check pause interaction. Its pause precedence requirement concerns non-behavior, timeout and recovery stopping.

Existing artifact persistence is not atomic across blobs, manifests and check receipts. This unit rejects late callback results before admission begins and strengthens existing write guards. It does not roll back already committed evidence or redesign persistence.

The dispatch-time allowance is a snapshot. Underlying work may outlive timeout. No worker cleanup drainage, durable browser-report correlation, real evidence admission, workspace lifecycle or execution activation is established.

## Synthesis decision

Parent selects candidate A, agreeing with the cross-judge. A scores 10 and B 9 on the task rubric. Those are design judgments, not measurements. Both independently reject the structurally different completion-capability alternative. It exposes a new settlement protocol without removing return-time validation.

Graft B's explicit unrelated-failure spelling and pending-pause settlement policy. Reject B's full Action snapshot and separate exported parser. Reject completion tokens, persistence methods and execution handles. No contested design remains after these explicit policy decisions, so no interrogate round is needed.

Model the Domain selects exclusive execution variants. Boundary Discipline keeps callback parsing with controller authority and evidence persistence with native. Laziness Protocol selects the small scalar request and no new parser module. Type System Discipline requires exhaustive variant handling. Separate Before Serializing Shared State gives one isolated writer the coupled source migration.

## Implementation and verification

One writer owns src/domain.ts, src/controller.ts, src/native.ts and all check callback migrations in test/evidence.test.ts, test/http.test.ts, test/crash-worker.ts, test/artifact-resources.test.ts and test/recovery.test.ts. Add test/check-dispatch.test.ts and a narrow test/check-dispatch-crash-worker.ts only if needed. No other production files should change without parent review of the design deviation. During full verification, the parent approved a test-only migration in operator/src/artifact_tests.rs after its embedded JavaScript callback was found to use the legacy signature. Preserve that fixture's payloads, assertions and timeouts. This does not change Rust production code or protocols. The original node_modules symlink is support only and must not be committed.

Acceptance is the shared brief's controller-interface matrix. Prove actual identity and immutable request isolation, capacity-two separation, denied dispatch with zero callback effects, remaining budget and late-result rejection, all five non-behavior outcomes with existing repair history, malformed return rejection, pause precedence and restart without replay. Exercise a genuine crash after durable stop before native settlement, including pending pause. Existing evidence/artifact/repair tests must remain meaningful after callback migration.

Run focused checks before full local verification. Parent reviews the exact diff, runs integrated verify:all and obtains fresh source/comment review. No Docker rerun is appropriate because this unit must not change or activate the accepted validator. Parent writes the final rationale, evidence and decision trail after reviewing the code.
