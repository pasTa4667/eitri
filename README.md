# eitri

Local Sentry investigation and fix-PR pilot. The durable controller and scripted native operator are verified within their recorded scope. Sandboxed execution and live integrations remain gated by the [build plan](docs/build-plan.md). The [work log](docs/work-log.md) owns current acceptance status.

## Check this checkout

Use Node 26.5.0.

```sh
npm ci --ignore-scripts
npm run verify:all
npm run doctor
npm run check:sdk
npm run probe:sdk
```

`verify` lints and checks formatting for TypeScript/JavaScript, type-checks, and runs the native-SQLite, control, recovery, HTTP, and temporary-Git workspace tests. `verify:all` also checks Rust linting/formatting and runs the operator tests. `doctor` reports local prerequisites without reading secrets; installer Bash remains missing until M3. `check:sdk` accepts only the operator-reviewed package/source hashes and fails on unreviewed differences.

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

This opt-in probe reads only `op://Eitri/Sentry/password` with desktop approval and tests read-only issue access to the configured hosted project. It prints no credentials or issue contents and does not change `npm start` or enable live remediation. See [setup and limitations](docs/setup.md#check-the-existing-hosted-sentry-connection).

To find issue IDs first, use the opt-in [single-page discovery command](docs/sentry-discovery.md).

To observe one explicitly selected issue, run the opt-in command:

```sh
npm run --silent observe:sentry -- --account <explicit-account> --issue <positive-decimal-id>
```

The command prints one JSON observation with validated identity, native classification, event time, and structural counts. Add `--reported-context` to include a validated event environment and release when Sentry reports them. This operational metadata is not anonymous. Use `--silent` for machine consumption without npm's banner. See the [read-only observation interface and limits](docs/sentry-observation.md). Live event-detail access remains unverified. Sentry controller intake remains disabled, and `npm start` is unchanged.

## Run the native operator

In a second terminal, with the same `EITRI_DATA_DIR` if overridden:

```sh
npm run operator
```

The pinned GPUI 0.2.2 build uses process-local Xcode selection, not a toolchain upgrade. `npm run test:operator` exercises GPUI input handlers and the Rust client against a real scripted controller. The operator has typed check cards and on-demand text/PNG artifact viewing. Its client verifies provenance, byte limits, and checksums off the render thread. Tests include real-controller artifact retrieval and native PNG decoding. Screen capture now works. The [forge-style overview](docs/evidence/native-visual/forge-overview.png) and [constrained editor](docs/evidence/native-visual/constrained-after.png) have actual native captures. The missing-text production feature was fixed without upgrading GPUI. The scripted pilot's native acceptance includes a stable text/PNG viewer and observed image-handle release. Live integration gates remain closed. See [rendering verification and its limits](docs/native-rendering.md).

## Offline workspace preparation

The [workspace library](docs/workspace.md) adds managed Git, guarded one-file edits, durable crash receipts, and immutable exports. Trusted offline controller callbacks can use it. Production workspace routes and model-edit tools remain disabled. Its tests use synthetic temporary repositories, not the demonstration fixture. The separate [profile-name capture](docs/fixture-profile-name.md) now acquires only the actual helper's bytes with explicit uncommitted-copy provenance. It does not execute project code or enable a browser scenario.

## Unwired browser validation

The [frozen browser validator](docs/frozen-browser.md) is integrated as a callable module. Production entry points do not enable it. It checks recorded frozen bytes through the protected synthetic browser scenario. Its fast tests run in `npm run verify`; actual Docker acceptance remains an explicit separate command. The [integration record](docs/evidence/validator-integration/verification.md) records 311 Node, 30 Rust and 20 Docker tests passing. This is not M2 completion or real fixture validation.

The opt-in [profile-name controller handoff](docs/controller-workspace.md#browser-scenario-selection) now selects the protected helper probe through trusted offline configuration. Its [verification record](docs/evidence/profile-controller-handoff/verification.md) records 1,284 Node tests, 30 Rust tests, and six Docker tests passing. The actual helper baseline reaches a native real receipt and PNG, preserved across reopen without replay. The later [approved fixture reconciliation](docs/evidence/profile-reconciliation/verification.md) aligns protected tests with the plan and verifies isolated unit, build, and React browser checks against a scripted candidate. Production dispatch and controller React integration remain disabled or incomplete. The [installed scenario baseline](docs/fixture-profile-name.md#installed-scenario-baseline) now provides both latent defects and both deterministic controls in the sibling checkout, with a local `master` checkpoint and a guarded `--installed` verification mode. It does not activate a monitored build or complete M2.

The [guarded fixture scenarios](docs/evidence/fixture-scenarios/verification.md) extend the disposable application recipe with independent profile and cart candidates, handled validation, and deterministic transient recovery. Actual checks use freshly built output. The original demonstration checkout and production dispatch remain unchanged. The verified source passes 1,785 Node tests and 30 Rust tests. M2 remains open.

The opt-in [protected profile-name probe](docs/profile-name-probe.md) checks the actual captured helper and managed scripted candidates through a trusted CDP function handle. Its [verification record](docs/evidence/profile-name-probe/verification.md) records 1,258 Node tests, 30 Rust tests, three profile Docker tests, and 22 synthetic/controller Docker regressions passing. The probe does not change the demonstration checkout or enable production dispatch. React validation and M2 acceptance remain open.

The [admitted check interface](docs/check-execution.md) now supplies scripted adapters with the actual action identity and remaining allowance. Non-behavior outcomes stop conservatively without fabricated failed checks or repair work. Final verification passes 382 Node and 30 Rust tests. Production browser dispatch remains disabled. The later [consumed-browser handoff](docs/native-browser-check.md#offline-tool-handoff) admits real native receipts offline.

The opt-in [accepted-request handoff](docs/worker-consumption.md) now consumes the exact accepted request once under current callback authority. It retains ownership through cancellation and settlement. That prerequisite alone does not admit native real receipts. Parent and writer verification each pass 812 Node and 30 Rust tests. Default-clock regressions reproduce and correct a sampling-boundary defect. Production main remains unwired. See the [consumption verification record](docs/evidence/worker-consumption/verification.md).

## Containment gate

The trusted fixed-browser ARM64 Chromium probe passes with the explicitly approved syscall policy and 256-task limit. Managed worker and validation integration remain incomplete. See [the containment review](docs/containment-review.md) for scope and evidence. No privileged, `SYS_ADMIN`, host IPC/network, or no-sandbox workaround was used. Generated execution and live integrations remain disabled.

## Review the setup and progress

- [Manual integration setup](docs/setup.md) lists the company-vault, token, sign-in, and live-mode gates.
- [SDK review](docs/sdk-review.md) describes the observed API differences and the recommended dependency decision.
- [Work log](docs/work-log.md) records the workflow, milestone checklist, and continuation checkpoint.
- [Decision trail](decisions.tsv) records choices and evidence.
