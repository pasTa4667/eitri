# Offline Codex file-profile crash/expiry — five-axis review

## Scope and verdict

Author review using `/skill:review`; not an independent-agent or cross-model audit. Reviewed seven added acceptance checks, the existing crash fixture's four fixed Codex modes, and documentation against the [approved offline contract](../../pi-native-codex-crash.md). Production/runtime implementation is unchanged.

**No unresolved Critical or Important finding within this offline slice.** Acceptance excludes real native inference, credential recovery and M4 completion.

## Findings

- **Important — resolved (failure-path cleanup):** `test/pi-native-codex-crash.test.mjs:53` now retains/awaits an in-progress recovery open during teardown, and `:128` captures an unexpectedly successful short open so it can be closed if the refusal assertion fails. This prevents test failures from abandoning a controller/recovery promise while deleting its files. The bounded checkpoint wait also ensures a missing fixture mode fails promptly rather than waiting for the outer test timeout.
- **Critical:** none.
- **Suggestion:** no extra implementation required in this slice. Inside-write faults, lease recovery and broader tool confinement remain explicit untested gates, not inferred successes.

## Five axes

| Axis | Evidence and conclusion |
|---|---|
| Correctness | `test/pi-native-codex-crash.test.mjs:25` covers both existing refresh checkpoints with/without persisted Pause. Resource/action identities, actual SIGKILL, a live stopped orphan and unchanged short-refusal state precede `:143`'s held open. `:154` requires helper absence/home removal before recovery; `:161` checks Pause/Continue, exact interrupted charge, stale-profile refusal before helper spawn, no tool result/effect and two stable reopen cycles. `test/pi-native-codex-profile.test.mjs:399` covers maintenance/startup at the 30-day boundary and explicit deletion, rejects unfinished cleanup and preserves the other database/transcript plus both auth locations. Restored mutations prove the interrupted-charge and exact-expiry oracles catch those regressions. |
| Readability | Two observable checkpoint names and a paused flag describe four finite crash cases. Existing fixture/provider/profile helpers are reused; expiry cases use the existing fixture with explicit clock advance/restart elapsed time. No generic crash framework or redundant runtime logic is introduced. |
| Architecture | `test/helpers/pi-native-crash.mjs:6` selects only fixed test modes and `:43` reuses the existing synthetic Codex provider/IPC checkpoints. Controller/native admission, transcript ownership, drainage, resource reconciliation and dedicated-profile leases are unchanged. No production alias/provider is registered, no schema/dependency/worker/operator change. |
| Security | Every credential is fixed synthetic data under a generated private temporary home. Existing Codex-child validation and replaced fetch remain authoritative; there is no real-service fallback. Only test-created PIDs are stopped/killed/resumed; the reconciler still never signals recorded PIDs. A dead native lease is retained even after saved rotation, not reset or token-retried. Auth paths/private account markers remain absent from requests/projections. The generated normal-profile sentinel is a deletion/non-use guard, not access to the operator's normal profile. |
| Performance | Four bounded crash cases and three expiry cases add no production work. Checkpoint waits are bounded at eight seconds, test lifetimes at 20/25 seconds, helpers retain their ten-second lifetime, and existing reconciliation has a twelve-second ceiling. Polls yield with finite deadlines. The 50 ms negative observation is supported by actual PID/home/resource assertions at the later admission boundary, not treated alone as proof of arbitrary scheduling order. |

## Verification

- RED: unsupported fixed crash mode never reaches a Codex checkpoint. The first command is interrupted at its 60-second harness limit after two outer test timeouts (`red.txt`). The added bounded IPC wait gives a focused missing-checkpoint failure after eight seconds (`red-focused.txt`, exit 1); no runtime requirement is weakened.
- GREEN: four new crash cases pass (`green.txt`, exit 0). Combined new crash/original file-profile/three new expiry checks pass **18/18**, no failures/cancellations/skips (`focused.txt`, exit 0).
- Mutation: suppressing the existing recovery charge makes the new crash check fail `0 !== 120000` (`mutation-charge.txt`, exit 1). Changing maintenance expiry from `>=` to `>` makes the new threshold check fail `ready !== expired` (`mutation-expiry.txt`, exit 1). Both production-source mutations are restored; no production diff remains.
- Final full `npm run verify:all`: exit **0**, **2,250 Node and 30 Rust tests pass**, no failures/cancellations/skipped Node tests or ignored Rust tests. Lint, formatting, type/syntax checks and native compilation pass. Existing Rust dependency future-incompatibility notices remain. The first full command is interrupted by its 240-second harness limit before a Node summary, not reported as a suite failure or pass (`verify-all-interrupted.txt`). The completed background run's result is retained in `verify-all.txt` / `verify-all.exit`; `source-sha256.txt` records the final unchanged executable identities.

Raw paths above are under `.audit/pi-native-codex-crash/`. No real profile, login, hosted inference, Docker, Sentry/GitHub action, publication or deployment is used.

## Retained limits

The crash tests stop before synthetic rotation-response delivery or after observed saved rotation at provider dispatch, not inside the SDK's write/lock release. Before SSE delivery no tool proposal/result is committed; these are not new post-tool crash tests. Expiry is exercised after successful synthetic work, not as a claim of combined crash-plus-expiry in one case. Dedicated-profile re-login remains an accepted operational recovery trade-off, not implemented native-lease reset, lossless refresh or shared-client safety. Broader restricted-worker/source-edit integration, real native approval, production selection and M4 acceptance remain separately scoped gates. Stop after this slice.
