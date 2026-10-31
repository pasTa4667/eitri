# Dead probe-owner lease reclaim review

## Scope

Five-axis author `/skill:review` of the operator-approved dead probe-owner reclaim after `fa0581e`. No independent-agent/cross-model audit is claimed. The operator approves the recommendation recorded in the [stream-failure review](native-live-stream-review.md): an ordinary probe may take over the `eitri-use` lease of a **dead version-2 probe owner**, using the ESRCH check that explicit login recovery already uses, so a failed probe no longer forces a browser sign-in. Tests use generated homes, synthetic credentials and intercepted HTTP. No genuine inference, sign-in, real profile access, credential repair or private-case inspection occurs in this slice.

## Change

`prototypes/pi-profile-login.mjs:42` now enters the existing takeover branch for probes. `:86` limits an ordinary probe to a previous owner of kind `probe`; explicit `--recover` login still accepts dead `login` or `probe` owners. Every other guard is the existing one: private canonical paths, existing private single-link `auth.json`, a lease directory containing exactly `owner.json`, a bounded private version-2 record, the `recovery` subdirectory that serializes takeover (`:83`), and ESRCH from `process.kill(pid, 0)` (`:89`). Release still requires the lease to hold exactly this process's own record.

## Review

| Axis | Evidence and verdict |
|---|---|
| Correctness | A probe is the sole credential process (no auth helper/agent), so ESRCH for its recorded PID proves its credential use ended. `test/pi-profile-login.test.mjs:106` reclaims a dead probe owner, runs once with this process's own record and leaves only `auth.json`, with credential bytes unchanged. `:129` covers ten refusals and checks the lease is byte-identical afterwards: dead login, dead native v1, pending/missing record, unknown file, interrupted `recovery`, leftover `owner.next`, live probe owner, PID 1 (EPERM), own PID (an in-process failure never retries) and missing auth. `:176` races two probes over one dead owner: exactly one runs. `:74` now also covers explicit login recovery of a dead probe owner. `test/pi-tool.test.mjs:105` runs six real failing tool probes (denied, refresh-denied, bad tool, deadline, hung, cancel): each makes only its one request/refresh, leaves a probe lease whose PID is gone, and a later separate probe passes. `:158` shows a SIGKILLed held probe blocks both an ordinary probe and `--recover` while alive, then either can reclaim it. `test/pi-native-live.test.mjs:338` reclaims only after the cancelled live helper is reaped. |
| Readability | One guard line plus comments that state the policy at the exported entry points. Probes pass `recover: true`, and `:86` narrows that to probe owners. This is slightly indirect but keeps one takeover path; renaming the flag would churn the login CLI for no behavioral gain. |
| Architecture | Reuses the existing lease protocol and takeover branch, adding no new state, file, process signal or dependency. Native version-1 `withDedicatedProfile` leases, production `src/`, schemas and the launcher are unchanged. Within one live-native run, a failed helper is still never followed by another: `test/pi-native-live.test.mjs:115` and `test/pi-native-read.test.mjs:136-139,242` pin one model helper per failed run, and `maxRetries: 0` remains (`prototypes/pi-native-live-child.mjs:128`). Before this change the lease also blocked any such retry. Now that guarantee rests on harness behavior and those assertions alone. |
| Security | The owner record is validated before any PID probe (keys, version, kind, positive safe integer, private single-link file ≤128 bytes). No process is signaled; PID reuse or EPERM blocks. An interrupted **login** stays blocked for probes because its credential state may be partial; only a fresh sign-in can replace it. A probe killed mid-refresh may leave a stale `proper-lockfile` lock, which Pi itself expires (30 s for async writes). It may also leave a truncated in-place `auth.json` write, which the existing metadata check refuses. If the server rotated the refresh token before Pi persisted it, the next probe's refresh fails at `stream-refresh` and still requires sign-in; it is not hidden or retried. Reusing a saved token is limited to a separately started probe command. This matches the [re-login trade-off](../../pi-auth-ownership.md#disposition) in substance and narrows "do not retry uncertain tokens automatically" to the failed run itself. |
| Performance | One extra comparison on the takeover path. No polling, waiting or retries. |

**Critical:** none. **Important:** none. **Suggestions (not implemented):**

1. If a token-family revocation is observed after a reclaimed probe, record it as evidence; it would argue for re-coupling reclaim to refresh state.
2. Leftover `recovery`/`owner.next` from a process killed during takeover still needs a fresh-login investigation, as before; no automatic cleanup is added.

Approve the dead probe-owner reclaim only. This does not establish live-native acceptance, real refresh/crash recovery or M4.

## Verification

- RED: `node --test test/pi-profile-login.test.mjs` fails the reclaim and concurrency tests, 26 passed / 2 failed. The ten refusals and explicit login recovery of a dead probe already pass as characterization. Log/status: `.audit/probe-lease-reclaim/red.txt`, `red.exit` (**1**).
- First GREEN run: the profile tests pass. Eight older tests that asserted the superseded "blocked until browser sign-in" policy fail as expected (`green-initial.txt`, exit **1**). They are rewritten to assert the approved behavior; none is skipped or weakened.
- Focused (`pi-profile-login`, `pi-tool`, `pi-controlled-turn`, `pi-native-live`, `pi-native-read`, `pi-login`): **128/128**, exit **0**, zero failures/cancellations/skips (`focused.txt`, `focused.exit`).
- `npm run verify:all`: exit **0**, **2,324 Node and 30 Rust tests passing**, zero failures/cancellations/skipped Node tests or ignored Rust tests. Lint, formatting, TypeScript/syntax checks and native compilation pass (`verify-all.txt`, `verify-all.exit`). Source identities: `source-sha256.txt`.
