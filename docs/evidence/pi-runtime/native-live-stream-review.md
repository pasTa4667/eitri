# Live-native stream-failure diagnosis review

## Scope

Five-axis author `/skill:review` of the local stream-failure diagnosis after `ac683ae`. No independent-agent/cross-model audit is claimed. This changes only the actual live helper's finite diagnostics and its test fixtures, not the offline adapter, production `src/`, auth logic, schemas or dependencies. Tests use generated synthetic profiles and intercepted HTTP. No genuine inference, sign-in, credential/lease repair, private-case inspection or publication occurs.

## Diagnosis from existing evidence

| Attempt (UTC) | Stage | Preceded by |
|---|---|---|
| 17:00:51 | `profile` | earlier failure; lease left blocked |
| 17:44:00 | `event-validation` | operator re-login |
| 18:29:28 | `profile` | 17:44 failure; lease left blocked |
| 18:32:51 | **pass** | operator re-login |
| 18:54:39 | `stream` | the successful run; lease free |

Two of the four failures are lease blocks, not credential failures: `prototypes/pi-profile-login.mjs:40,77,108-110` make any failed sole-process use leave `eitri-use` behind, and `withProfileProbe` passes `recover: false`, so only `npm run test:pi-login -- --run --recover` (a full browser sign-in) can reclaim it. That is the mechanism behind "I have to re-log every time", independently of whether the saved token is still valid.

The 18:54 `stream` failure is a different class and its cause is **not recoverable** from local evidence: `prototypes/pi-native-live-child.mjs` discards the error, and the retained store under the launcher's temp home records only `sign-in-required`. The pinned SDK refreshes stored OAuth automatically when fewer than five minutes remain (`pi-ai/dist/auth/resolve.js:96-108`), so "no automatic re-authentication on our end" is not the mechanism unless that refresh fails. `auth.json` was rewritten at 18:55:42Z, one minute after that failure, and no lease exists now: the operator already recovered with a fresh sign-in.

The generic `stream` stage conflated (1) auth resolution/refresh failing in request setup before any HTTP request, (2) a non-2xx response (401 rejected token, 400 rejected request shape, 429 usage limit, 5xx), and (3) no response (network/DNS). This slice separates those finitely; it does not identify the historical cause.

## Review

| Axis | Evidence and verdict |
|---|---|
| Correctness | `prototypes/pi-native-diagnostics.mjs:59-69` classifies with the pinned SDK refresh literal first, then absence of a response, then a finite status class; non-integer status stays generic `stream`. `prototypes/pi-native-live-child.mjs:130-133` keeps only `response.status` from the supported `onResponse` hook, which `pi-ai/dist/api/openai-codex-responses.js:286` awaits before checking `response.ok`; `:145-146` classifies only on an `error` event, leaving iterator throws at generic `stream`. `test/pi-native-live.test.mjs:73-122` drives the real installed SDK: `refresh-denied` with a token inside the five-minute window performs one actual built-in refresh against the synthetic token endpoint and reports `stream-refresh`; 403/401/429/thrown fetch report their stages; each retains failed native data, reaps the helper and leaves the lease blocked. `:244-282` pins the full mapping and refuses mimicking text and out-of-set stages. |
| Readability | The finite stream set and its lookup sit beside the existing event set in one module. The classifier is a flat ordered chain with one comment per decision. The test loop now reads from one scenario→stage table instead of a nested ternary. |
| Architecture | Reuses the existing helper IPC, single-diagnostic adapter/launcher limits and `validateNativeDiagnostic` allowlist unchanged; the launcher prints new stages without edits (`test/pi-native-live.test.mjs:382-432`, `launcher-diagnostic-refresh`). The hook and the literal come from already pinned files (`types.d.ts`, `openai-codex-responses.js`, `lazy.js`, `resolve.js` in `prototypes/pi-stream-source.json`). No new transport, runtime option that changes behavior, credential access, retry, schema, dependency or production route. |
| Security | Headers and bodies from `onResponse` are dropped; `errorMessage` is compared by prefix and never stored, sent or printed. Every emitted stage is from the frozen allowlist, so provider-controlled strings cannot cross IPC or reach stderr. Launcher leak checks (`/private-|synthetic-account|access_token|refresh_token/`) still cover the new scenario. A status class is non-secret; no account identity, token, URL or case path is added. |
| Performance | One assignment per HTTP response and one constant-time lookup on the failure path. Deadlines, reaping, byte/diagnostic bounds and `maxRetries: 0` are unchanged. |

**Critical:** none. **Important:** none introduced or unresolved within this diagnostic scope. **Suggestion (not implemented, operator decision):** a dead `probe` owner could be reclaimed with the same ESRCH check the login command already uses (`prototypes/pi-profile-login.mjs:82-91`), without a browser sign-in. The current coupling is deliberate (`docs/pi-profile-login.md`); changing it is a separate design decision, not a bug fix.

Approve local diagnosis/instrumentation only, **not live-native acceptance**.

## Verification

- RED: `nativeStreamFailureStage` missing; the suite cannot load. Log/status: `.audit/native-live-stream-diagnosis/red.txt`, `red.exit` (**1**).
- GREEN: `node --test test/pi-native-live.test.mjs`, **35/35**, then **36/36** after the launcher scenario, exit **0**, zero failures/cancellations/skips. Logs: `green-initial.txt`, `focused-live.txt` with `.exit` files.
- Shared-fixture focused run (`pi-native-live`, `pi-native-live-events`, `pi-native-read`, `pi-tool`, `pi-controlled-turn`, `pi-native-codex-profile`): **105/105**, exit **0**. Log/status: `focused.txt`, `focused.exit`.
- Final `npm run verify:all` on the final sources: exit **0**, **2,310 Node and 30 Rust tests passing**, zero failures/cancellations/skipped Node tests or ignored Rust tests. Lint, formatting, TypeScript/syntax checks and native compilation pass; existing Rust dependency future-incompatibility notices remain. Log/status: `verify-all.txt`, `verify-all.exit` (an earlier identical-result run is kept as `verify-all-initial.*`). Final executable/fixture identities: `source-sha256.txt`.

Stop after this diagnosis. Real credentials/leases and failed private native data remain untouched. No genuine attempt, lease-recovery change, worker execution, production enablement or M4 acceptance is performed.
