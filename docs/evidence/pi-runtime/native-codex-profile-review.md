# Offline Codex file-profile/native refresh — five-axis review

## Scope and verdict

Author review using `/skill:review`; not an independent-agent or cross-model audit. Reviewed the new fixed synthetic file-profile helper/tests, bounded adapter/child selection, syntax check and documentation against the [approved contract](../../pi-native-codex-profile.md).

**Approve only this offline slice. No unresolved Critical or Important finding.** Real profiles, live inference, production selection and M4 acceptance remain gated.

## Findings

- **Important — resolved (test oracle):** the initial microtask-only negative observation in `test/pi-native-codex-profile.test.mjs:283` did not catch deliberately skipping the cleanup await in `prototypes/pi-native-stream.mjs:165`. Asynchronous filesystem disposal could still be pending at the first assertions. The test now allows an explicit 100 ms I/O observation window and reasserts home existence, pending completion and withheld receipt before releasing cleanup. The strengthened mutation run fails on premature home removal; the original await is restored. This is a finite observed mutation check, not proof against arbitrary scheduling delays.
- **Critical:** none.
- **Suggestion:** no additional change required within this scope. The untested local-write/crash/shared-client boundaries below remain explicit limitations, not completed acceptance claims.

## Five axes

| Axis | Evidence and conclusion |
|---|---|
| Correctness | `test/pi-native-codex-profile.test.mjs:155` verifies built-in rotation, second-helper reuse, Unicode native result, SQLite reopen and Pause/Continue without tool replay or renewed allowance. `:222` interrupts before rotation response delivery and after saved rotation, asserting actual PID absence, held disposal, pending catalogue action, no receipt/effect, close ordering, blocked auth and unchanged counters across repeated reopen. `:326` and `:348` cover throwing callbacks and rejected refresh. Cooperative close already records the failed action as sign-in-required; the initial expectation of one restart redispatch was corrected after tracing existing `Controller.finishAction`, not by relaxing runtime policy. |
| Readability | Profile-specific synthetic data/refresh checks live in `prototypes/pi-native-codex-profile.mjs:5`, keeping the existing child focused on one stream. Two named checkpoint strings identify observable boundaries rather than implying internal persistence hooks. No generic credential-store/provider framework is introduced. |
| Architecture | `prototypes/pi-native-codex-child.mjs:149` selects the supported built-in `authPath` surface. Installed SDK owns auth, Pi Durable owns transcript/tools, controller owns admission/accounting, and `test/helpers/pi-native.mjs:69` supplies only trusted test hooks. The existing lease, resource ownership and drainage are reused unchanged. No production source, schemas, dependencies/lockfile, worker/operator or demonstration checkout changes. |
| Security | `prototypes/pi-native-stream.mjs:24` limits the new fixtures to generated canonical temporary-profile homes before lease access; original fixtures still refuse file profiles. `prototypes/pi-native-codex-profile.mjs:10` requires exact synthetic OAuth contents before SDK construction, rejecting extra command-valued credentials (`test/pi-native-codex-profile.test.mjs:367`). Fetch replacement precedes SDK import and retains no network fallback. Fixed endpoint/grant/bearer checks, sanitized environment, finite IPC checkpoints and fixed error text prevent accidental real-service or diagnostic disclosure. Failure blocks reuse, even after saved rotation; no credential repair or automatic lease reset. |
| Performance | One bounded helper per admitted action; at most one synthetic refresh and one intercepted inference request per helper, two IPC checkpoints, no retries, existing ten-second lifetime/transport ceilings. Hung test callbacks cannot prevent helper cancellation/reaping; late acknowledgments cannot revive disconnected/killed children. No new production hot-path work or performance claim. |

## Verification

- Initial RED: **2/2 fail** with no refresh/provider checkpoints because the new fixture is unsupported. `.audit/pi-native-codex-profile/red.txt`.
- Initial broader GREEN attempt: six pass and two close tests fail on the incorrect redispatch expectation; preserved in `green-initial.txt`. The controller already parks cooperative auth failure without retry.
- Focused run: **30/30 pass** across new file-profile, original Codex/native and existing native-profile suites. `focused.txt`.
- Mutation: original insufficient oracle passes the non-awaited-cleanup mutation (`mutation.txt`); strengthened oracle **fails** on early home removal (`mutation-strengthened.txt`). Mutation restored before full verification.
- Final full `npm run verify:all`: exit **0**, **2,243 Node and 30 Rust tests pass**, no failures/cancellations/skipped Node tests or ignored Rust tests. Lint, formatting, type/syntax checks and native compilation pass. Existing Rust dependency future-incompatibility notices remain. `verify-all.txt` / `verify-all.exit`.

All raw paths above are under `.audit/pi-native-codex-profile/`. The full run includes all eleven new tests. No genuine login/inference, real credential-store inspection, Docker, hosted service, publication or deployment is performed.

## Retained gates

These tests interrupt cooperative work before response delivery or after observed persistence, **not inside the SDK's local write/lock release**. Re-login recovery acceptance is not lossless-refresh proof. No new parent-SIGKILL/orphan/expiry or independent-client coverage is added for this built-in file-provider combination. No restricted-worker/source-edit tool integration, live native route, M4 acceptance or native-owner lease recovery is authorized. Stop after this slice.
