# Live-native failure-stage review

## Scope

Five-axis author `/skill:review` of the local diagnostic follow-up to `c34fa2b`. No independent-agent/cross-model audit is claimed. This changes the live probe path, not the offline parity implementation or production dispatch. No inference attempt, credential access, lease repair or private-case inspection is performed.

## Review

| Axis | Reviewed evidence and verdict |
|---|---|
| Correctness | `prototypes/pi-native-live-child.mjs:118` distinguishes SDK stream failures, event conversion and semantic result validation without interpreting the provider error. `prototypes/pi-native-stream.mjs:151` accepts one exact finite IPC failure, rejects malformed/duplicate diagnostics, and refuses success if any diagnostic arrived. Closure and cleanup precede the public callback. Existing accounting, Pause/Continue and durable reopen still pass. |
| Readability | `prototypes/pi-native-diagnostics.mjs:4` names local failure locations in one frozen list; stage assignments sit beside the actual checks. No error-message parsing or inferred OAuth cause. |
| Architecture | `prototypes/pi-native-live.mjs:65` forwards a trusted callback through the existing live stream adapter. `scripts/test-pi-tool.mjs:116` validates again before printing to stderr; final JSON/verdict and production faux-only authority are unchanged. No dependency, credential-store or schema change. |
| Security | `prototypes/pi-native-diagnostics.mjs:19` requires exactly one allowlisted field. Unknown/private strings and extra fields are refused without printing them. The launcher retains its 4096-byte bound and one-diagnostic limit. `test/pi-native-live.test.mjs:65` and `:165` exercise injected private values, extra fields and invalid completions with intercepted fetch only. No raw errors, transcript, tool result, account identity or credential data is added to output. |
| Performance | At most one compact failure frame per helper and one printed diagnostic per command. Existing deadlines, process reaping and resource cleanup remain authoritative; no retry, additional request, polling loop or service is added. |

**Critical:** none. **Important:** none unresolved within this diagnostic scope. **Suggestion:** none required. Approve this local instrumentation only, not live-native acceptance.

## Verification and limits

- RED: five existing negative scenarios fail because their diagnostic observations are empty (`.audit/native-live-diagnosis-red.txt`).
- The first implementation run identifies malformed synthetic output at `event-validation`, not the initially expected `stream`; adjust the oracle to the actual validation location, not the implementation to hide the error.
- Focused: **25/25** live-native tests pass, including nine new checks. Generated synthetic profiles and intercepted HTTP/SSE exercise the actual installed SDK/live helper. Profile/cleanup failures and pre-dispatch cancellation retain finite diagnostics and reaping. Logs: `.audit/native-live-diagnosis-focused.txt`.
- Full `npm run verify:all`: exit **0**, **2,275 Node and 30 Rust tests pass**, zero failures/cancellations/skips/ignored Rust tests. Lint, formatting, type/syntax checks and native compilation pass. Existing Rust dependency future-incompatibility notices remain. Logs/status: `.audit/native-live-diagnosis-verify-all.txt` and `.exit`. The only subsequent executable-file edit changes an IPC comment, not behavior.

The previous genuine failure's cause and HTTP request count remain unknown. A stage identifies the local check that failed, **not an OAuth rejection or root cause**. Startup/native-harness failures outside the helper may still have only the generic verdict; abrupt kill or unreportable IPC failure falls back to `transport`, and cleanup failure takes precedence over a helper stage. There is no retrospective diagnosis or successful live-native claim. Another genuine attempt and any necessary explicit fresh sign-in remain a separate operator decision; no automatic reuse or recovery is enabled.
