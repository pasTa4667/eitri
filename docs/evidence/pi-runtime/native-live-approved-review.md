# Approved live-native follow-up review

## Scope

Five-axis author `/skill:review` of the separately approved attempt on `532eea2` and its evidence/plan updates. No independent-agent or cross-model audit is claimed. The existing live command is run once; no executable, dependency, schema or credential-handling change is made. No new behavioral test is needed for this evidence-only change; the existing 25 focused live-native tests pass before the attempt.

## Review

| Axis | Evidence and verdict |
|---|---|
| Correctness | `native-live-approved-actual.json:8` records exit **1**, not success. Its finite stdout/stderr match the locally saved command output. `prototypes/pi-native-live-child.mjs:52-54` sets `profile` before entering the credential callback and `runtime` at callback entry, so this stage precedes runtime creation/provider streaming. The invocation marker is not counted as an HTTP request; request count remains unmeasured. No exact failed check, OAuth rejection or explanation of the earlier attempt is claimed. |
| Readability | `docs/pi-native-live.md:37` separates this follow-up from the original attempt and diagnostic implementation. It names the observed stage, uncertainty and stop condition directly. |
| Architecture | `docs/build-plan.md:276-277` completes only the authorized attempt and retains a separate diagnosis/recovery decision. Successful live-native acceptance, production selection and M4 remain open. The existing controller/native/helper boundaries are unchanged. |
| Security | Evidence contains only finite verdict/stage, timestamps, source hashes and public configuration. No credential, lease owner, raw provider error, transcript, account identity or private-case path/content is inspected/exported. `prototypes/pi-profile-login.mjs:40` keeps probe recovery disabled; no sign-in, lease removal or automatic repair is performed. |
| Performance | One bounded command, no live retry, no new process/service/polling behavior. Existing helper/launcher deadlines and disposal remain unchanged. Pre/post-attempt executable hashes match. |

**Critical:** none. **Important:** none in these evidence-only changes. **Suggestion:** none required. Approve the evidence/plan update, **not live-native acceptance**.

The live gate remains blocked at profile entry. Path/mode/auth-file-metadata and lease checks are possible locations, not established causes. Further private-profile diagnosis, explicit supported fresh sign-in/recovery and any later inference need separate approval. Preserve failed native data privately; do not force success by bypassing the guard.

## Verification

- Focused: `node --test test/pi-native-live.test.mjs`, **25/25 passing**, exit **0**, zero failures/cancellations/skips. Log: `.audit/native-live-approved-focused.txt`.
- Full `npm run verify:all`: exit **0**, **2,275 Node and 30 Rust tests pass**, zero failures/cancellations/skipped Node tests or ignored Rust tests. Lint, formatting, TypeScript/syntax checks and native compilation pass. Existing Rust dependency future-incompatibility notices remain. Log/status: `.audit/native-live-approved-verify-all.txt` and `.exit`.
- Genuine command: `npm run --silent test:pi-native -- --run`, exactly once, exit **1**, `sign-in-required`, stage `profile`, no verified tool result. Finite logs, timestamps, numeric status and source hashes: `.audit/native-live-approved-attempt/`.
- No executable changes or new tests; no retry, sign-in, credential/lease repair, worker execution, hosted mutation, publication or production enablement.
