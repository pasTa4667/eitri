# Implementation run

## Definition of done

Complete the mandatory M0 through M6 acceptance gates in `docs/build-plan.md` with recorded runtime evidence. M7 requires an optional operator-led merge and build activation. A failed prerequisite is not a completed milestone. Live remediation, sign-in, first inference, repository publication, vault creation, and deployment retain the plan's human gates.

The user's implementation request authorizes local implementation under the existing build plan. Historical interview statements that implementation is not yet approved remain historical records.

## Workflow

- [x] Read the Principles section of the poteto-mode skill.
- [x] Phase A: Frame.
- [x] Phase B: Design the workflow.
- [ ] Phase C: Run the loop.
- [ ] Phase D: Keep the audit trail.
- [ ] Phase E: Verify and hand back.

### Throughput checkpoint

- [x] **Blocking first steps.** Gates run before fan-out. Inspect installed tools, existing fixture, exact SDK exports, and required operator setup. Verify real native SQLite and last-dispatch gating before M1.
- [ ] **Independent workstreams.** n/a: This harness exposes no subagent tool. Perform SDK, fixture, and environment exploration sequentially. Preserve the fixture's uncommitted work.
- [ ] **Shared mutable state.** One controller owns the catalogue. Separate native files and artifact directories by session UUID. Bind the singleton port before opening production storage. No shared generated source or worker scratch.
- [ ] **Smallest safe decomposition.** One implementation owner with separate design and review passes. Complete each milestone's checks before enabling the next integration.

### Execution units

- [x] Prerequisite audit and manual setup guide. Never read or log token values.
- [ ] M0. Durable catalogue, per-session Pi stores, controller commands, guarded runner, recovery, retention, and HTTP tests.
- [ ] M1. Native GPUI build, authenticated connection, controls, and native input verification.
- [ ] M2. Existing fixture integration, scoped file broker, immutable validation, and restricted ARM64 worker checks.
- [ ] M3. Local Sentry and operator-reviewed credentials. Stop at named human gates.
- [ ] M4. Supported OpenAI login and approved first inference. No ambient API-key fallback.
- [ ] M5. Publication ambiguity, ownership, merge lineage, cleanup, and recurrence tests.
- [ ] M6. Operator-enabled live demonstration with honest outcomes.
- [ ] M7. Optional operator-led merge and recurrence. skip: Not authorized by the implementation request alone.
- [ ] Opening a PR. skip: Publishing the controller repository is excluded by the build plan.

## Initial observations

- `eitri` initially contained only `CONTEXT.md` and `docs/`. Initialized local Git on `main` as permitted by the build plan.
- The existing `../eitri-test-web-app` has uncommitted application source, tests, a lockfile, and a local `.env`. It has no local commits and remains on `master`. Read only the environment variable name, `VITE_SENTRY_DSN`, not its value.
- Node is 26.5.0. Rust is 1.97.1. Xcode 27.1 is installed. Use process-local `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` because the global directory points to Command Line Tools.
- OrbStack reports Linux aarch64, 12 CPUs, and 33671933952 bytes of VM memory. No context change is needed.
- 1Password CLI 2.30.3 is installed. A metadata-only `op account list` timed out. No account selection, vault permission check, or secret read has succeeded.
- No Homebrew Bash was found at `/opt/homebrew/bin/bash`. Install only when the Sentry stage needs it.
- The npm registry exposes the planned Pi Durable and Pi AI 1.3.0 packages. Exact runtime compatibility remains to test.

## Current checkpoint

Seven mandatory milestones remain, M0 through M6. This is a multi-hour implementation with external human-presence gates, not a single scaffold change. M7 is optional. Rigor is high because generated code execution, credentials, and repository writes cross trust boundaries.

Application implementation is paused at the explicit SDK review condition in build-plan section 2. `docs/sdk-review.md` records two control-ownership designs, the actual published API differences, and a limited runtime compatibility prototype. The recommendation is to retain published 1.3.0 after the operator accepts those differences. Do not mark M0 complete or proceed around the review condition.

Verified observations are in `docs/evidence/`. `npm run check` succeeds. `npm run doctor` exits 1 for missing installer Bash. `npm run check:sdk` exits 1 for actual source and public API differences. `npm run probe:sdk` completes with a real temporary native SQLite file, a faux provider, and an unanswered denied submission. It is not a live-model or controller acceptance test.

No account, vault, item, token, OAuth state, controller database, application source, container, push, or PR has been created. Local Git, the Node dependency lockfile, prerequisite tools, and the throwaway prototype are the artifacts of this run. The existing fixture remains unchanged.

Next action is operator review of `docs/sdk-review.md`. After acceptance, add TypeScript build tooling and implement the catalogue-first M0 design with the remaining race, budget, dispatch, and cleanup acceptance tests. Do not request GitHub or Sentry token values in chat.

No subagent or compaction tool is exposed. No independent model review was performed. The design comparison and comment review were sequential self-review.

## Checkpoint policy

Update this file and `decisions.tsv` after each substantial unit. Record commands and actual results. Do not call a simulated run a live model result. No compaction tool is exposed by this harness. These files are the continuation record for automatic or operator-triggered compaction.
