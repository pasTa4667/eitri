# Bounded live Pi/native probe

The operator explicitly approves one live-native integration attempt after the successful standalone tool probe and offline Codex crash/expiry checks. This is not production selection, M4 acceptance or autonomous remediation.

## Contract

- Opt-in `npm run test:pi-native -- --run`; default/help performs no credential, database or inference work.
- Real controller admissions, native Pi Durable SQLite, real elapsed-time accounting and the dedicated Pi-managed Eitri profile. Installed ModelRuntime 1.4.0 remains external; project dependencies stay 1.3.0.
- At most two explicit model requests and exactly one fixed `probe({})`, returning a random verification string. No shell, source edit, validation worker, assessment tool, Sentry/GitHub operation or publication. Only fixed synthetic issue metadata and the probe transcript are transmitted.
- Pause from inside the admitted probe, verify its durable result and absence of the next model request; close/reopen the same controller store, then explicitly Continue with unchanged usage/attempt/repair state. The second model must echo the actual correlated result. Final parking and another reopen must not dispatch or replay work.
- Each model helper has one request and a 60-second lifetime; the complete command has a 120-second child lifetime and 125-second launcher backstop. Existing controller deadlines/allowance remain authoritative. No automatic retries, compaction or billing fallback. Requested output tokens are not a server-enforced Codex ceiling.
- Helpers use empty temporary HOME/cwd, a clean environment, the fixed selected OAuth route and metadata-only credential checks before provider registration. Pi alone owns renewal/persistence. Each helper holds the existing version-2 sole-process probe lease; interruption leaves sign-in blocked and permits only the existing explicit fresh-login recovery after actual process exit.
- Validate bounded cross-version events and strict tool/result semantics before delivering a terminal. Reap the helper and dispose its recorded home before native receipts/capacity release. IPC disconnection terminates an orphan; existing resource reconciliation precedes any store reopen.
- Preserve the production faux-only provider guard. The harness uses an explicit test-only metadata alias, not a production provider registration; finite evidence separately identifies the genuine route. SQLite stores aliased provider/model metadata, not proof of production routing.
- Retain private native data on failure; never reset/resume a failed case automatically. On success, verify durable reopen before deleting the generated probe store. Emit finite non-secret results only, not raw model text, tool result, credentials or provider diagnostics.

## Acceptance

Targeted offline tests must cover the new path and refusal/cancellation behavior before the single approved real attempt. Run the repository's full verification and five-axis `/skill:review`. Record the live verdict and numeric exit honestly; on failure stop without another inference attempt or credential repair. Real refresh, crash recovery, general tool confinement and production readiness must not be inferred from a successful probe.

## Verification checkpoint

The 16 new tests and the existing standalone/Codex/profile suites pass together (53/53). They use intercepted transport and generated synthetic credentials, never the operator's profile. Full `npm run verify:all` exits **0** with **2,266 Node and 30 Rust tests passing**, no failures/cancellations/skips or ignored Rust tests. Lint, formatting, type/syntax checks and native compilation pass; existing Rust dependency future-incompatibility notices remain. The [five-axis author review](evidence/pi-runtime/native-live-review.md) records the reviewed boundaries.

Run the approved genuine command **once**. It exits **1**, after one `model` progress marker, with finite verdict **`sign-in-required`**. It does not verify a tool result or successful live/native integration. The marker precedes helper/provider execution, so the actual number of provider HTTP requests is unknown. This deliberately broad failure can also mean protocol, helper, output-validation or cleanup failure; **it is not proof of an OAuth rejection**. The [finite evidence and source identities](evidence/pi-runtime/native-live-actual.json) retain that distinction; raw logs/status are under `.audit/pi-native-live/`.

Stop without retry, re-login, lease removal or credential repair. Failed private native data is retained, not inspected/exported into repository evidence. Local diagnosis or another genuine attempt needs a separate explicit follow-up. This completes the command implementation and authorized attempt, **not successful live-native acceptance, production selection or M4**.

## Local failure-stage follow-up

The operator's next live-implementation request authorizes local diagnostic work only; no additional inference attempt or profile repair is performed. The live helper now sends at most one exact allowlisted `{ failureStage }` IPC frame on failure. After helper closure and cleanup attempts, the adapter forwards it through the native harness. The launcher independently validates the shape/value and prints `Pi native failure stage: <stage>.` to stderr; stdout's finite verdict and nonzero failure status remain unchanged. A diagnostic cannot accompany a successful command, and invalid/extra/duplicate frames fail closed.

Stages are local locations: `bootstrap`, `request-validation`, `profile`, `runtime`, `model-selection`, `stream`, `event-validation`, `result-validation`, `terminal-validation`, `profile-release`, `transport`, and `cleanup`. They do not establish OAuth rejection, request count or the root cause. Killed/unreportable helpers fall back to `transport`; failed cleanup takes precedence. Failures outside the stream adapter may still have only the generic verdict. No raw provider errors, credential values, transcript, tool result, identity or private case path is printed. Failed stores and uncertain profile leases remain untouched.

The [five-axis author review](evidence/pi-runtime/native-live-diagnosis-review.md) records RED/GREEN and **25 focused tests**, plus full verification with **2,275 Node/30 Rust tests**, all passing. This completes local live-path instrumentation, not retrospective diagnosis of the earlier attempt or successful live-native acceptance. Stop before another genuine attempt or explicit fresh-login recovery; those remain a separate operator decision.
