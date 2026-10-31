# Post-login bounded live-native attempt review

## Scope

Five-axis author `/skill:review` of the operator-requested next attempt on `da86228` and its finite evidence/plan updates. No independent-agent or cross-model audit is claimed. The operator reports signing in; no login terminal verdict or numeric login exit is supplied. This request authorizes one bounded genuine attempt, not automatic retries, auth repairs or production enablement. No executable or dependency change is made.

## Review

| Axis | Evidence and verdict |
|---|---|
| Correctness | `native-live-post-login-actual.json` matches captured stdout/stderr and shell exit **1**: generic `sign-in-required`, finite stage `event-validation`, one model-invocation marker and no tool marker. `prototypes/pi-native-live-child.mjs:122-123` assigns this stage after receiving a non-error stream event; it proves the runtime callback/stream path is reached, not a particular HTTP count or event-shape mismatch. `docs/pi-native-live.md:59` retains these limits and does not mislabel the generic verdict as OAuth rejection. The exact validation check remains unknown; no success or tool result is claimed. |
| Readability | `docs/pi-native-live.md:55-63` separates operator-reported login from the observed attempt and clearly states the new stream-validation blocker. Evidence uses finite verdicts/stages, not raw provider output. |
| Architecture | `docs/build-plan.md:278-279` completes this attempt only, preserving the next local-diagnosis scope and M4/production gates. Existing controller/native authority, strict protocol validation, lifecycle, tools and credential ownership remain unchanged. No speculative fix or relaxed validation is introduced. |
| Security | The live command uses the already-reviewed dedicated-profile helper. No new credential/profile inspection, lease removal, raw event/case inspection, token copying, browser action or ambient paid-key fallback is added. Evidence excludes credentials, identity, transcript, raw events and private paths. Failed private data is retained, not exported. Source hashes match before/after. Another login is not inferred to be necessary from a local validation stage. |
| Performance | Exactly one opted-in command runs under existing two-request/one-tool ceilings and helper/launcher deadlines. No retry, polling service, dependency or persistent runtime overhead is introduced. The attempt finishes in four seconds; no optimization claim is made. |

**Critical:** none. **Important:** none in these evidence/plan changes. **Suggestion:** none required. Approve the attempt record, **not successful live-native acceptance or M4**. The unresolved live blocker is event validation; it is recorded, not waived.

## Verification

- Fresh focused command before the attempt: `node --test test/pi-native-live.test.mjs`, exit **0**, **25/25 passing**, zero failures/cancellations/skips. Log/status: `.audit/native-live-post-login-attempt/focused.txt` and `focused.exit`.
- Genuine command: `npm run --silent test:pi-native -- --run`, exactly once, **17:44:00Z–17:44:04Z on 2026-10-31**, exit **1**, stage `event-validation`, no verified tool result. Finite logs/status and source identities: `.audit/native-live-post-login-attempt/`.
- Pre/post-attempt executable/dependency hashes match (`source-sha256.txt`, `source-sha256-after.txt`). No new behavior/test is introduced, so no new RED/GREEN cycle is appropriate.
- Retain the preceding unit's full `npm run verify:all` result on identical executable/dependency sources: **2,275 Node and 30 Rust tests passing**, exit **0**, with lint/format/type/syntax/native compilation passing and existing Rust future-incompatibility notices. This is prior evidence in `.audit/native-live-profile-entry-verify-all.txt`, **not a fresh full-suite claim**. Do not repeat an unchanged full suite merely for reassurance.
- Stop without another live attempt, sign-in, lease/credential repair, raw private-data inspection, worker execution, hosted mutation, publication or production enablement.
