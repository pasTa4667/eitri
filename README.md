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

`verify` lints and checks formatting for TypeScript/JavaScript, type-checks, and runs the native-SQLite, control, recovery, and HTTP tests. `verify:all` also checks Rust linting/formatting and runs the operator tests. `doctor` reports local prerequisites without reading secrets; installer Bash remains missing until M3. `check:sdk` accepts only the operator-reviewed package/source hashes and fails on unreviewed differences.

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

## Run the native operator

In a second terminal, with the same `EITRI_DATA_DIR` if overridden:

```sh
npm run operator
```

The pinned GPUI 0.2.2 build uses process-local Xcode selection, not a toolchain upgrade. `npm run test:operator` exercises GPUI input handlers and the Rust client against a real scripted controller. The operator has typed check cards and on-demand text/PNG artifact viewing. Its client verifies provenance, byte limits, and checksums off the render thread. Tests include real-controller artifact retrieval and native PNG decoding. Screen capture now works. The [forge-style overview](docs/evidence/native-visual/forge-overview.png) and [constrained editor](docs/evidence/native-visual/constrained-after.png) have actual native captures. The missing-text production feature was fixed without upgrading GPUI. The scripted pilot's native acceptance includes a stable text/PNG viewer and observed image-handle release. Live integration gates remain closed. See [rendering verification and its limits](docs/native-rendering.md).

## Containment gate

The default ARM64 Chromium probe fails with `No usable sandbox!`. The reviewed namespace candidate passes USER namespace controls but stops at `chroot`. No privileged, `SYS_ADMIN`, host IPC/network, or no-sandbox workaround was used. See [the containment review](docs/containment-review.md). Generated execution and live integrations remain disabled.

## Review the setup and progress

- [Manual integration setup](docs/setup.md) lists the company-vault, token, sign-in, and live-mode gates.
- [SDK review](docs/sdk-review.md) describes the observed API differences and the recommended dependency decision.
- [Work log](docs/work-log.md) records the workflow, milestone checklist, and continuation checkpoint.
- [Decision trail](decisions.tsv) records choices and evidence.
