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

## Separately approved follow-up attempt

After an explicit approval for **one** bounded live-native attempt, run the unchanged command on `532eea2` once. It exits **1** with `sign-in-required` and the finite stage **`profile`**, after one model-invocation progress marker. This stage precedes the credential callback and `ModelRuntime.create`; no provider stream or tool execution is reached. There is no network capture, and the marker itself is not an HTTP request count. The earlier attempt's cause/request count remain unknown.

The stage narrows this attempt to local profile-entry checks, not an OAuth rejection. Path ownership/modes, auth-file metadata and exclusive-use lease acquisition are among those checks; the exact failing check is not established. Do not infer a stale lease or inspect/repair the private profile to force progress.

The [finite evidence](evidence/pi-runtime/native-live-approved-actual.json) and [five-axis author review](evidence/pi-runtime/native-live-approved-review.md) record this failed attempt separately from the original failure. No executable change is needed. Stop without retry, sign-in, credential/lease repair or private-case inspection; retain failed native data privately. Successful live-native acceptance and M4 remain open. Local profile diagnosis, fresh supported sign-in/recovery and any later inference require their own explicit approval. The subsequent approval below covers only read-only metadata diagnosis.

## Approved read-only profile-entry diagnosis

The operator explicitly approves bounded local profile-entry diagnosis, with no credential contents, repairs, sign-in or inference. One clean-environment Node process selects the OS-user home, repeats the live probe's canonical-home, ownership, directory/file type, mode, auth single-link and size guards using only `realpath`/`lstat`, then checks lease presence without acquiring it.

All current path/auth-file metadata checks pass. **The exclusive-use lease exists and blocks ordinary probe entry.** `withProfileProbe` always passes `recover: false`; an existing lease therefore fails the guard at `prototypes/pi-profile-login.mjs:77`, before the runtime callback. No workaround or new command is needed to establish this current blocker.

The [finite observation](evidence/pi-runtime/native-live-profile-entry.json) and [five-axis author review](evidence/pi-runtime/native-live-profile-entry-review.md) record only metadata verdicts. Credential contents, lease owner, process liveness and private case data are not read. This observation does not prove which check failed in either historical attempt, whether the owner is dead, whether fresh-login recovery is eligible, or whether credentials are valid. The diagnosis performs no profile writes, lease acquisition/removal, PID signaling, runtime creation, login or inference.

Stop after this diagnosis. Lease-owner/liveness diagnosis or explicit fresh supported sign-in/recovery needs a separate operator decision; no later inference follows automatically. The existing guard is intentional, not an auth bug to bypass. Successful live-native acceptance and M4 remain open.

## Operator-reported sign-in and approved next attempt

The operator reports completing sign-in and explicitly asks to try the next step again. No terminal login verdict or numeric login exit is supplied, so this is operator-reported sign-in, not an independent credential/lease inspection. Run the unchanged live-native command on `da86228` **once**, after all 25 focused tests pass.

The command exits **1** with generic verdict `sign-in-required` and local stage **`event-validation`**. Unlike the earlier profile-entry failure, this attempt passes profile entry, runtime creation and model selection, then reaches the helper's validation of a non-error provider event. No fixed-tool execution marker is emitted and no tool result is verified. The exact event/check and HTTP request count are unmeasured; the finite stage is not an OAuth rejection or a reason to request another login.

The [finite evidence](evidence/pi-runtime/native-live-post-login-actual.json) and [five-axis author review](evidence/pi-runtime/native-live-post-login-review.md) record the attempt. Executable/dependency source hashes remain unchanged. Retain the preceding unit's full 2,275 Node/30 Rust verification as prior evidence, not a new full-suite run; no behavior change or new test is introduced here.

Stop without retry, sign-in, credential/lease repair, raw event/private-case inspection or weakened validation. Failed native data remains private. A separately scoped local stream-validation diagnosis is next; another live attempt requires explicit approval. Successful live-native acceptance, production selection and M4 remain open.
