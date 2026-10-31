# Read-only live profile-entry diagnosis review

## Scope

Five-axis author `/skill:review` of the operator-approved read-only diagnosis on `7d90ea4` and its evidence/plan updates. No independent-agent or cross-model audit is claimed. No application executable, auth logic, test or dependency changes are made. This is a live-profile metadata observation, not another offline compatibility slice, an auth repair or a genuine inference attempt.

## Review

| Axis | Evidence and verdict |
|---|---|
| Correctness | `native-live-profile-entry.json` records seven passing canonical/path/auth-file metadata checks and a present lease. The one-shot process uses the OS-user home (like the launcher), a clean environment, `realpath` and `lstat`; it repeats the predicates in `prototypes/pi-profile-login.mjs:15-23,44-61`. `withProfileProbe` disables recovery at line 40; an existing lease therefore blocks at line 77 before callback entry at line 101. `docs/pi-native-live.md:49-51` limits this to the current blocker, not retrospective proof of either historical failure's exact check, OAuth rejection or recovery eligibility. No call to the mutating probe helper is needed to establish lease presence. |
| Readability | `docs/pi-native-live.md:45-53` separates the approved metadata diagnosis from prior genuine attempts, names the current blocker and states exactly what remains unknown. Evidence records finite verdicts, not filesystem paths, permission dumps or raw errors. |
| Architecture | `docs/build-plan.md:277-278` completes only diagnosis and retains a separate owner/liveness or supported fresh-login/recovery decision. Existing exclusion is intentional, not a bug to bypass. No diagnostic framework, new CLI, credential store, auth mutation or production wiring is added. |
| Security | The diagnostic reads no credential bytes, lease-owner contents or private-case data. It performs no mkdir, chmod, write, unlink, directory enumeration, lease acquisition, PID probing/signaling, SDK/runtime construction, login or inference. Ancestors are checked before traversing further. Evidence contains no credentials, owner PID, account identity or private path. Read-only metadata checks are a point-in-time observation, not protection against malicious same-user races or authorization to recover a lease. |
| Performance | One bounded process under a 15-second tool timeout; a fixed seven checks plus one lease-presence lookup, with no recursive scan, polling, network or persistent service. No performance optimization or new runtime overhead is introduced. |

**Critical:** none. **Important:** none in the evidence/plan changes. **Suggestion:** none required. Approve this diagnosis/evidence update only, **not lease recovery, live-native acceptance or M4**.

## Verification

- Actual approved metadata diagnosis: captured exit **0**, seven passing checks and `present-blocks-probe`; no credential contents read or profile mutations. Exit 0 means the diagnostic completed, not that probe entry is available.
- Full `npm run verify:all`: exit **0**, **2,275 Node and 30 Rust tests passing**, zero failures/cancellations/skipped Node tests or ignored Rust tests. Lint, formatting, TypeScript/syntax checks and native compilation pass; existing Rust dependency future-incompatibility notices remain. Log/status: `.audit/native-live-profile-entry-verify-all.txt` and `.exit`.
- Existing tests include lease exclusion/retention in `test/pi-controlled-turn.test.mjs:155,170` and live-native cancellation/re-entry refusal in `test/pi-native-live.test.mjs:120`. These use generated synthetic profiles, not the operator's credentials.
- No new behavior/fix is implemented, so no new RED/GREEN test or executable change is appropriate. The current lease stays untouched; owner/liveness and recovery eligibility remain unknown. No further inference is authorized.
