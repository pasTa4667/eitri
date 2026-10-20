# Absolute admitted-action deadline synthesis

## Problem and usage

Callbacks need the fixed endpoint of their admitted action before any later executable handoff can be safe. AdmittedCheckRequest gains deadlineAt in the controller clock domain. remainingMs stays an entry-time sample. Neither grants future execution authority.

## Selection

Parent selects candidate A, derived endpoint and one private native lifetime helper. Codex judge e50d4d16 agrees after two required corrections. Candidate B's controller-owned runAction rewrite is deferred. Its deterministic cancellable wakeup dependency and canceled-delivery protection are grafted into A. Persisted deadline duplication is rejected.

Scores from the judge for A are 4,5,5,4,4 for authority freshness, retry safety, compatibility, interface size and testability. B scores 4,5,5,4,5. The narrower existing ownership split breaks the tie.

## Chosen data shape

Persisted Action stays unchanged. D is the validated safe-integer sum of startedAt and limitMs. AdmittedCheckRequest gains the immutable scalar deadlineAt. Native owns one per-action lifetime with signal, current-time guard, cancellable wakeup and disposal. Controller owns complete persisted identity authentication, accounting and effective remaining allowance. No new worker wire contract or durable ledger.

## Required corrections from judgment

Authenticate action immediately before controller assessment and checkpoint mutations, within their transaction. A final native guard cannot undo an already committed late transition. A legitimate transition can change epoch/status itself. Distinguish current authority for new effects from controller-confirmed completion that allows only retirement of that exact action. Do not infer legitimate completion from arbitrary epoch mismatch or missing action. No later Retry may be charged or changed by old cleanup. The implementation owner must choose the smallest explicit internal transition result or action-scoped completion marker and report it before final acceptance.

Refresh before ordinary action-result notes and successful model publication. For an authenticated self-transition, allow only its existing completion bookkeeping, not another evidence write, acceptance or execution. Preserve progress, no-fix and failing-baseline behavior.

Supervisor clarification to cbb60716. Existing bounded action-result notes remain permitted after explicitly controller-confirmed stopCheck, assessment or checkpoint transitions. Confirmation is bound to the exact case/action/epoch and committed outcome. It cannot be inferred from epoch mismatch or a missing action. Retirement and notes cannot charge or authorize another effect in a newer epoch. An operator Retry that supersedes the confirmation must prevent misleading old success bookkeeping. Add a specific interposed-Retry regression rather than deleting existing result-note expectations.

## Invariants

- Admission uses one clock sample for charging and startedAt.
- Effective remaining is min of current case remainder and D minus now. Equality with D is expired.
- Full persisted identity and epoch are checked before accounting or changing the current case.
- Final check entry follows source preparation and worker-intent hooks with no intervening await or callback.
- Native model and tool timers both use fresh remaining time. Early wakeups rearm. Canceled delivery is harmless. Sampling errors abort only the old lifetime.
- All authority uses controller time. Custom clocks are nonnegative safe integers and nondecreasing within an instance. No cross-restart monotonic comparison.
- Pending pause still permits existing ordinary check settlement within budget, but denies new provider/callback/source/acceptance entry. Timeout preserves pending pause. Failing baseline keeps its existing exception.
- Preserve unresolved-action recovery charging. Do not reconstruct scopes or replay callbacks.
- Canonical worker requests, digests, journal formats, acceptance deadlines, quotas and validate rejection of accepted keys remain unchanged.

## Terminal publication ordering

Supervisor clarification to cbb60716 after focused implementation checks. Successful model terminal publication must immediately follow final synchronous authorization and retirement. Existing watcher notifications and after-model-action-receipt fault hooks must not intervene. A narrow separate receipt-notification operation may run after output publication. Do not invoke caller publication callbacks inside SQLite transactions. Add deterministic ordering regressions and preserve exactly-once cleanup, crash behavior and controlled model errors.

## Verification and boundaries

Behavioral tests cover delayed setup, endpoint minus one/equality/plus one, withheld and early wakeups, canceled wakeups, case versus action caps, metadata-delayed assessment, valid self-transitions, pause, Retry isolation, source/intent preparation, acceptance history bytes, legacy recovery and invalid timestamps. Use faux providers and real temporary SQLite. Keep a rerunnable deterministic test artifact.

Parent baseline verify:all passes 669 Node and 30 Rust tests at 69c5485. Review and final parent verification will follow implementation. No speed claim is made.

No worker consumption, Docker dispatch, production activation, native real receipts, monitored fixture changes, credential access, service activation, publication or deployment. M2 and later gates stay open. Cancellation is cooperative. No drainage or hard-realtime guarantee is added.
