# Admitted check execution

Configured scripted adapters receive admitted action identity and return distinct behavioral or non-behavior outcomes. The controller owns dispatch permission and conservative disposition. Source merge `d9da6f6` implements this interface. The [verification record](evidence/check-dispatch/verification.md) records 382 Node and 30 Rust tests passing.

## Callback interface

A configured scripted callback receives one `AdmittedCheckRequest`.

| Field | Meaning |
| --- | --- |
| `caseId` | The case owning the admitted tool action. |
| `actionId` | The actual admitted action UUID. |
| `epoch` | The action's control epoch. It is correlation data, not independent authority. |
| `kind` | The requested check kind. |
| `remainingMs` | Dispatch-time allowance, bounded by remaining case and action budgets. It is not a renewed minute. |
| `signal` | The admitted operation's cancellation signal. |

The request is a frozen object containing detached scalar values. It does not expose the mutable `Action` or `Case`. The signal is not frozen. Controller authority checks still decide dispatch and evidence admission.

The callback returns a `CheckExecution` variant.

| Variant | Meaning |
| --- | --- |
| `completed` | Carries one ordinary `CheckResult`. A reliable behavioral failure is `check.passed === false`. |
| `infrastructure` | Validation could not supply a reliable behavioral result. |
| `unrelated-failure` | The failure does not establish the target defect. |
| `cancelled` | Validation was cancelled. |
| `uncertain` | The execution outcome cannot be established. |
| `cleanup-incomplete` | Resource cleanup remains incomplete, including after an observed behavioral success. |

Only `completed` can carry a check. Non-behavior variants cannot carry evidence, a receipt or extra fields. All check receipts remain explicitly simulated. A real `FrozenBrowserReport` is not accepted or relabeled by this interface.

## Controller and native ownership

The controller owns persisted action lookup, dispatch-time allowance, strict callback-return parsing and conservative stopping. It compares the actual admitted action against persisted authority immediately before dispatch. The native module supplies that action and remains the evidence writer.

Before evidence admission, the controller checks cancellation, control state and remaining allowance again. Native retains its guarded writes. Callback-owned receipt objects and output bytes must not remain shared with persistence.

A non-behavior outcome stops a running case in Needs attention without a check, artifact, implementation transition or repair-history change. It retains issue ownership. A pending operator pause retains precedence and settles through the existing native-turn epilogue. Restart must not replay a stopped check or replace an already durable conservative disposition.

Ordinary completed pass and fail receipts retain the existing assessment and repair rules. Reliable already-dispatched receipts can record during Pause requested. The existing completed failed-baseline pause interaction is not changed by this unit.

## Limits

This is an internal scripted adapter interface, not an agent-supplied execution configuration. No positional legacy callback is retained. No model can supply commands, paths, images or scenarios through it.

The dispatch allowance is a snapshot. A cancellation signal does not prove underlying work or worker cleanup has drained. Artifact persistence remains non-atomic across blobs, manifests and check receipts. This unit does not roll back evidence committed before a later cancellation.

The optional [controller-owned offline workspace](controller-workspace.md) configuration adds case ownership and action-scoped frozen source selection. It does not change these simulated receipt semantics. Docker dispatch, browser-report mapping, non-simulated evidence admission and durable worker cleanup correlation remain separate work. The accepted browser validator stays unwired. HTTP and native operator protocols do not change.

## Design and verification

The [shared task](evidence/check-dispatch/task.md), [candidate A](evidence/check-dispatch/candidate-a.md), [candidate B](evidence/check-dispatch/candidate-b.md) and [cross-judge](evidence/check-dispatch/design-judge.md) record the alternatives. Both candidates prefer a returned union over a completion-token protocol. The parent selected A's flat request with B's explicit unrelated-failure spelling and pending-pause settlement policy.

The [24 focused baseline tests](evidence/check-dispatch/baseline-tests.txt) pass before implementation. Final integrated verification passes 382 Node and 30 Rust tests. Source and comment reviews pass after the reproduced exact-key parser defect is repaired. Regression coverage includes public Retry into a newer epoch before an old timed-out result returns. No new Docker acceptance or M2 completion is claimed.
