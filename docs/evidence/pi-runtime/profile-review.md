# Dedicated-profile slice — five-axis author review

## Scope and method

Requested `/skill:review`, applying code-review-and-quality, security-and-hardening and performance-optimization. Reviewed tests first, then the complete changed implementation and its existing native/controller callers against the [offline profile contract](../../pi-dedicated-profile.md) and [approved v1 decision](../../pi-auth-ownership.md#disposition). This is an author review, not an independent-agent/cross-model audit.

## Findings

**Critical: none. Important: one found and fixed; none outstanding within the synthetic-only increment.**

**Important — resolved:** provider registration starts SDK background availability checks, which can resolve/execute an unrelated stored API key's `!command`. Checking only the selected credential after registration was too late. `prototypes/pi-native-child.mjs:77–81` now uses public metadata-only `listCredentials()` to require exactly the selected OAuth entry **before registration**, without parsing/exporting credentials or replacing Pi's store. A controlled scratch-file canary fails against the old ordering (`.audit/pi-profile-command-red.txt`) and passes with the fix. No user command or credential is used.

| Axis | Review result |
|---|---|
| Correctness | `prototypes/pi-profile.mjs:16–76` requires explicit existing private paths, atomically excludes contenders and retains uncertainty after any failed use. `prototypes/pi-native-stream.mjs:14–18,115–123` places the entire reaped/cleaned operation inside the lease. Native/controller failure classification (`src/native.ts:212–224`, `src/controller.ts:1859–1877`) preserves the existing lifetime/accounting and stale-action checks; only a fixed trusted ControlError gets the sign-in-required reason. Timeout and Pause precedence remain unchanged. |
| Readability | One small lease module, no credential parsing/store/repair in the parent, no queue or generic provider framework. Fixed errors deliberately discard caught SDK/OS diagnostics. |
| Architecture | `ModelRuntime.create({ authPath })` uses the supported public file-store surface (`prototypes/pi-native-child.mjs:57–76`); no deep auth-store import or second transcript/agent loop. The small native change transports one finite failure category rather than introducing another lifecycle authority. Main/HTTP/GPUI still cannot select a live route. |
| Security | Current-user ownership, exact access modes, directory/file kinds, single-link and byte bounds checked before SDK construction. Missing/malformed/non-OAuth/expired inputs fail closed. Child environment is allowlisted, fetch is forbidden before imports, model configuration discovery is disabled and the fixed synthetic route cannot fall back to an API key/provider. Auth values never cross the parent protocol. Dead/malformed ownership never grants reuse. Existing resource reconciliation precedes native restart and lease refusal. No dependencies or real credentials added/read. |
| Performance | A fixed number of path checks and one atomic exclusive lease per model action, bounded metadata/file sizes and no new polling/lock-wait loop. Existing helper deadline and native disposal govern execution. Busy profiles fail immediately rather than consuming a queued allowance. No optimization claim or new benchmark is needed. |

**Suggestion / future gate:** `prototypes/pi-profile.mjs:35–59,71–76` intentionally never automatically reclaims a failed/stale lease. Implementing a supported operator-present sign-in/recovery flow later must establish owner/helper disposal and explicit operator authorization before clearing uncertainty. Do not turn this suggestion into an automatic token repair or a lease deletion in this slice.

## Verification

- RED: `test/pi-profile.test.mjs` fails before the module exists (`.audit/pi-profile-red.txt`).
- Behavioral RED: malformed native profile incorrectly completes as `assessment-required` before integration (`.audit/pi-native-profile-red.txt`).
- Rotation RED: without synthetic refresh support, the file-store rotation test parks `sign-in-required` rather than passing (`.audit/pi-profile-rotation-red.txt`).
- GREEN: the original **20** focused tests pass (`.audit/pi-profile-lifecycle-green.txt`); after the security-review fix all **21** focused profile/native tests pass (`.audit/pi-profile-post-review-green.txt`). This includes actual installed SDK file-store rotation, native SQLite, subprocess reaping, parent SIGKILL/live-orphan reconciliation, pause/deadline budgets and case expiry.
- Final `npm run verify:all` exits **0**: **2,165 Node and 30 Rust tests pass**, zero failures/cancellations/skipped Node tests or ignored Rust tests. Lint, formatting, TypeScript/syntax checks and native compilation pass. Existing Rust dependency future-incompatibility notices remain. All 13 frozen executable/manifest source hashes still match after verification (`.audit/pi-profile-source-sha256.txt`). An initial run was interrupted by the harness's 240-second command timeout during the existing long frozen-browser tests, not by a reported assertion failure; its partial output is `.audit/pi-profile-verify-all-timeout.txt`. It is not counted as a passing full suite. A second preliminary run was deliberately interrupted after the review fix changed source; its partial/canceled output is `.audit/pi-profile-verify-all-pre-review.txt` / `.exit`, not a passing final result. The final frozen-source run uses `.audit/pi-profile-verify-all.txt` and `.audit/pi-profile-verify-all.exit`.

## Limits and decision

Accept only the offline dedicated-profile/auth-failure increment. The actual profile paths used are generated temporary directories, including the normal-profile sentinel; no user's existing Pi state is opened. Synthetic provider refresh exercises the built-in **file store**, not a live OpenAI exchange. Crash cases conservatively block an admitted profile use; they do not prove kill-at-every-refresh-write-point or preserve a rotated login. The earlier built-in OpenAI OAuth characterization remains separate.

Private-path checks assume no malicious same-user hierarchy replacement during use, and process-crash records are not a power-loss/fsync promise. Exclusive Eitri use does not make this profile safe to share with arbitrary independent Pi clients. Production workers/mounts and dispatch remain unchanged; no worker or live inference is exercised. Dedicated-profile sign-in eligibility, explicit blocked-lease recovery after supported re-login, a genuine controlled tool-using turn, final production-route selection and M4 acceptance remain separately gated. Stop after this increment.
