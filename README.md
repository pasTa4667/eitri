# eitri

Local investigation and fix-PR pilot using the existing hosted Sentry project. The durable controller and scripted native operator are verified within their recorded scope. Sandboxed execution and live integrations remain gated by the [build plan](docs/build-plan.md). The [work log](docs/work-log.md) owns current acceptance status.

## Check this checkout

Use Node 26.5.0.

```sh
npm ci --ignore-scripts
npm run verify:all
npm run doctor
npm run check:sdk
npm run probe:sdk
```

`verify` lints and checks formatting for TypeScript/JavaScript, type-checks, and runs the native-SQLite, control, recovery, HTTP, and temporary-Git workspace tests. `verify:all` also checks Rust linting/formatting and runs the operator tests. `doctor` reports local prerequisites without reading secrets; hosted Sentry needs no installer Bash and remains a separate live check. `check:sdk` accepts only the operator-reviewed package/source hashes and fails on unreviewed differences.

`probe:sdk` runs a throwaway faux-model experiment against a temporary real Pi SQLite store. It is not a live inference or the M0 controller.

`npm run --silent probe:openai-oauth` characterizes Pi AI 1.3.0 using synthetic transports; its exit-1 `blocked` diagnostic is not a live login test. [Offline private credentials](docs/openai-credentials.md) and the [identity review](docs/openai-identity-review.md) remain retained. The [direct login experiment](docs/openai-login-test.md) was subsequently denied for the operator's Enterprise workspace, independently of the ID-token gap; that route is parked.

The approved [actual-Pi prototype](docs/pi-runtime-prototype.md) instead uses the already-installed Pi CLI 1.4.0 and Pi-owned OAuth through RPC. One genuine, tools-disabled streamed `openai-codex/gpt-6.1-sol` turn passed. `npm run --silent probe:pi-runtime` shows help; adding `-- --run` deliberately repeats that inference. No credentials are copied, no repository/conversation is supplied, and project dependencies remain 1.3.0. Production architecture, operator dispatch and remediation are unchanged.

The approved [offline stream-only experiment](docs/pi-runtime-compatibility.md#offline-sdk-seam-characterization) starts with a synthetic SDK seam check: `npm run --silent probe:pi-stream -- --offline`. Default/help does not construct a runtime. It requires the reviewed installed SDK/source identities, uses a generated empty home and synthetic in-memory OAuth/provider data, and performs no real login or inference. The fixture round trip now exercises bounded runtime-validated context/event conversion and a correlated subprocess pipe. Unsupported shapes and malformed/stale/duplicate frames fail closed. The [caller-control prerequisite](docs/pi-runtime-compatibility.md#caller-controlled-offline-stream-lifecycle) also checks admission at model/fixture-tool boundaries, non-renewing allowance ceilings and cancellation/reaping. The [native composition checks](docs/pi-runtime-compatibility.md#offline-controllernative-composition), run with `node --test test/pi-native-stream.test.mjs`, also exercise real native SQLite, probe/results, Pause/Continue, preserved allowances and SIGKILL recovery. The [resource-release checks](docs/pi-runtime-compatibility.md#native-model-resource-release-ordering), run with `node --test test/pi-native-release.test.mjs`, require adapter drainage before native receipts, capacity release and cooperative close/reopen. The [isolation/expiry checks](docs/pi-runtime-compatibility.md#offline-case-isolation-and-expiry), run with `node --test test/pi-native-isolation.test.mjs`, verify separate sequential case contexts and terminal-only detail removal without deleting the other case or a synthetic global-auth sentinel. The [built-in OAuth checks](docs/pi-runtime-compatibility.md#offline-built-in-oauth-characterization), run with `node --test test/pi-stream-auth.test.mjs`, characterize synthetic refresh serialization, auth/provider failures and cancellation without real Pi storage or network. The [additional native crash-boundary checks](docs/pi-runtime-compatibility.md#offline-native-crash-boundaries), run with `node --test test/pi-native-boundaries.test.mjs`, preserve paused admission/terminal/receipt/commit state across SIGKILL and repeated reopen. All those kill points have no live helper. The [offline orphan-reconciliation checks](docs/pi-runtime-compatibility.md#offline-orphan-resource-reconciliation), run with `node --test test/pi-native-orphans.test.mjs test/pi-native-resources.test.mjs`, additionally retain a live helper across parent SIGKILL and require recorded exit plus empty-home cleanup before native redispatch. Ambiguous ownership blocks recovery; no recorded PID is signaled. The [offline repair-budget checks](docs/pi-runtime-compatibility.md#offline-native-repair-budgets), run with `node --test test/pi-native-repairs.test.mjs`, preserve two-cycle limits across pause/reopen and a nonzero-counter SIGKILL; unchanged candidates spend no cycle, infrastructure failures park, and exhaustion cannot redispatch. The [offline parity review](docs/evidence/pi-runtime/parity-review.md) maps all six synthetic acceptance criteria to evidence. The [later operator decision](docs/pi-auth-ownership.md#disposition) supersedes its shared-store/lossless-refresh gates with a dedicated Pi profile and re-login recovery. The [offline dedicated-profile slice](docs/pi-dedicated-profile.md), run with `node --test test/pi-profile.test.mjs test/pi-native-profile.test.mjs`, adds exclusive private profile selection, Pi-owned synthetic file persistence/rotation and fail-closed sign-in-required handling with native lifecycle/crash/expiry checks. The separately approved [dedicated-profile sign-in command](docs/pi-profile-login.md) is implemented and reviewed; the operator's [real sign-in observation](docs/pi-profile-login.md#operator-verification) supplies terminal verdict `oauth-saved` with no inference. The subsequently approved [controlled tool-use probe](docs/pi-controlled-turn.md) passes one genuine dedicated-profile attempt: two explicit streams, one fixed side-effect-free tool and verified result, captured exit 0. `npm run test:pi-tool -- --run` deliberately repeats real inference and is not an unattended test. Explicit fresh-login recovery can reclaim a dead sole-process login/probe owner; native/ambiguous leases remain blocked. This is not a production adapter, full compatibility acceptance or M4 acceptance.

The separately approved [offline built-in Codex/native composition](docs/pi-native-codex.md), run with `node --test test/pi-native-codex.test.mjs`, joins the unmodified installed Codex SSE path to controller/native admissions, one fixed probe, SQLite and pause/reopen checks. Credentials and HTTP/SSE are synthetic; those original fixtures refuse file-profile use. The separately approved [synthetic file-profile refresh slice](docs/pi-native-codex-profile.md), run with `node --test test/pi-native-codex-profile.test.mjs`, composes Pi-owned file rotation with native Pause, deadline/close disposal and sign-in-required blocking. Only generated temporary profiles with fixed synthetic credentials are permitted. The separately approved [offline crash/expiry follow-on](docs/pi-native-codex-crash.md), run with `node --test test/pi-native-codex-crash.test.mjs test/pi-native-codex-profile.test.mjs`, adds parent-SIGKILL at both synthetic refresh checkpoints, orphan reconciliation before native recovery, blocked stale auth and terminal-only expiry preserving another unfinished case and synthetic auth. None of these slices enables live native inference or completes M4.

The separately approved [bounded live/native probe](docs/pi-native-live.md) connects genuine inference to the real controller/native SQLite lifecycle in an opt-in harness: `npm run test:pi-native` shows help; `npm run test:pi-native -- --run` deliberately makes at most two model requests and executes one harmless fixed tool. It verifies Pause/Continue across reopen, result persistence and preserved accounting. It does not enable production dispatch, worker/source-edit tools, hosted mutations or publication. The first genuine attempt stops with `sign-in-required` and exit 1; its cause is undiagnosed, and successful live-native acceptance remains open. Do not repeat a failed attempt or clear a profile lease automatically; the command retains failed native data privately and stops.

## Lint and format

```sh
rustup component add clippy rustfmt
npm run lint          # Oxlint for TS/JS; Clippy for Rust (warnings fail)
npm run format        # Oxfmt for TS/JS and root JSON config; rustfmt for Rust
npm run format:check  # Check formatting without writing
```

Each command also has `:ts` and `:rust` variants (for example, `npm run lint:ts`). Rust linting uses the same macOS/Xcode environment as the operator build. Generated evidence and Markdown are not reformatted.

## Run the scripted controller

```sh
npm start
```

The controller binds `127.0.0.1:43127`. Data defaults to `~/Library/Application Support/eitri`; set `EITRI_DATA_DIR` to select a private test directory. The mode-0600 `connection.json` contains the current bearer capability. Do not copy it into chat or a URL. `Check now` admits only synthetic issues. No live provider or publication route is enabled.

## Check the 1Password / Sentry connection

```sh
npm run check:sentry -- --account <1Password-account-UUID-or-hostname>
```

This opt-in probe reads only `op://Eitri/Sentry/password` with desktop approval and tests read-only issue access to the configured hosted project. It prints no credentials or issue contents and does not change `npm start` or enable live remediation. Hosted Sentry is also the selected M3 target; no local Sentry or installer-Bash setup is required. `npm run doctor` checks local tools only and does not certify hosted access. See [setup and limitations](docs/setup.md#check-the-existing-hosted-sentry-connection).

To find issue IDs first, use the opt-in [single-page discovery command](docs/sentry-discovery.md).

To observe one explicitly selected issue, run the opt-in command:

```sh
npm run --silent observe:sentry -- --account <explicit-account> --issue <positive-decimal-id>
```

The command prints one JSON observation with validated identity, native classification, event time, and structural counts. Add `--reported-context` to include a validated event environment and release when Sentry reports them. This operational metadata is not anonymous. Use `--silent` for machine consumption without npm's banner. See the [read-only observation interface and limits](docs/sentry-observation.md). The [hosted checkpoint](docs/evidence/hosted-monitored/verification.md) verifies four populated synthetic issues, latest-event access, revision-bound grouping and validation exclusion. Its temporary monitored build is stopped. The subsequent [review/assignment checkpoint](docs/evidence/sentry-review/verification.md) verifies review and assignment to the operator-selected user, separately from seen/status/priority. Sentry controller intake remains disabled, and `npm start` is unchanged.

## Run the native operator

In a second terminal, with the same `EITRI_DATA_DIR` if overridden:

```sh
npm run operator
```

The pinned GPUI 0.2.2 build uses process-local Xcode selection, not a toolchain upgrade. `npm run test:operator` exercises GPUI input handlers and the Rust client against a real scripted controller. The operator has typed check cards and on-demand text/PNG artifact viewing. Its client verifies provenance, byte limits, and checksums off the render thread. Tests include real-controller artifact retrieval and native PNG decoding. Screen capture now works. The [forge-style overview](docs/evidence/native-visual/forge-overview.png) and [constrained editor](docs/evidence/native-visual/constrained-after.png) have actual native captures. The missing-text production feature was fixed without upgrading GPUI. The scripted pilot's native acceptance includes a stable text/PNG viewer and observed image-handle release. Live integration gates remain closed. See [rendering verification and its limits](docs/native-rendering.md).

## Offline workspace preparation

The [workspace library](docs/workspace.md) adds managed Git, guarded one-file edits, durable crash receipts, and immutable exports. Trusted offline controller callbacks can use it. Production workspace routes and model-edit tools remain disabled. Its tests use synthetic temporary repositories, not the demonstration fixture. The separate [profile-name capture](docs/fixture-profile-name.md) now acquires only the actual helper's bytes with explicit uncommitted-copy provenance. It does not execute project code or enable a browser scenario.

## Offline browser and application validation

The [M2 acceptance evaluation](docs/m2-acceptance.md) maps the milestone requirements to runtime evidence, records the verdict and preserves remaining gates. Production entry points do not enable worker dispatch. Fast checks run in `npm run verify`; actual Docker checks require explicit opt-in.

The [frozen browser validator](docs/frozen-browser.md), [controller-owned workspace](docs/controller-workspace.md) and [accepted-request handoff](docs/worker-consumption.md) bind execution to an admitted action and immutable revision. The [consumed-browser handoff](docs/native-browser-check.md#offline-tool-handoff) retains real receipts and PNGs across reopen without replay. Cancellation, deadlines, cleanup ownership and uncertainty remain separate from behavioral outcomes.

The [installed scenario baseline](docs/fixture-profile-name.md#installed-scenario-baseline) contains both latent defects and both deterministic controls, with its README preserved and a local checkpoint on unchanged `master`. The opt-in [full-application controller checks](docs/fixture-application-check.md) run protected unit/build/browser observations against exact reviewed baseline or one-target scripted patch bytes. These are scripted checks, not AI-generated repairs. Arbitrary generated Node code, combined fixes and runtime dependency installation remain excluded. A separately approved [temporary monitored build](docs/evidence/hosted-monitored/verification.md) has sent synthetic hosted events and is now stopped; the original sibling checkout remains unchanged.

## Containment gate

The trusted fixed-browser ARM64 Chromium probe and opt-in managed validator use the explicitly reviewed syscall policy and 256-task limit. See the [containment history](docs/containment-review.md) and [M2 evaluation](docs/m2-acceptance.md) for scope, evidence and limits. No privileged, `SYS_ADMIN`, host IPC/network, or no-sandbox workaround was used. Arbitrary generated execution, production dispatch and live remediation remain disabled.

## Review the setup and progress

- [Manual integration setup](docs/setup.md) lists the company-vault, token, sign-in, and live-mode gates.
- [SDK review](docs/sdk-review.md) describes the observed API differences and the recommended dependency decision.
- [Work log](docs/work-log.md) records the workflow, milestone checklist, and continuation checkpoint.
- [Decision trail](decisions.tsv) records choices and evidence.
