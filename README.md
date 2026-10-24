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

The command prints one JSON observation with validated identity, native classification, event time, and structural counts. Add `--reported-context` to include a validated event environment and release when Sentry reports them. This operational metadata is not anonymous. Use `--silent` for machine consumption without npm's banner. See the [read-only observation interface and limits](docs/sentry-observation.md). The [hosted checkpoint](docs/evidence/hosted-monitored/verification.md) verifies four populated synthetic issues, latest-event access, revision-bound grouping and validation exclusion. Its temporary monitored build is stopped. Sentry controller intake remains disabled, and `npm start` is unchanged.

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
