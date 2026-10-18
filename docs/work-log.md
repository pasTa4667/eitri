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
- [x] **Independent workstreams.** The continuation harness exposes subagents. Two read-only explorers cover controller/resource ownership and containment-policy provenance. The parent owns this checkout. Any later implementation delegate uses a separate worktree. Preserve the fixture's uncommitted work.
- [ ] **Shared mutable state.** One controller owns the catalogue. Separate native files and artifact directories by session UUID. Bind the singleton port before opening production storage. No shared generated source or worker scratch.
- [ ] **Smallest safe decomposition.** One implementation owner with separate design and review passes. Complete each milestone's checks before enabling the next integration.

### Execution units

- [x] Prerequisite audit and manual setup guide. Never read or log token values.
- [x] M0. Durable catalogue, per-session Pi stores, controller commands, guarded runner, recovery, retention, and HTTP tests.
- [x] M1. Native GPUI build, authenticated connection, controls, native input, and scripted visual/artifact verification.
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

Five mandatory milestones remain, M2 through M6. M0 and the scoped scripted M1 checks are verified. External human-presence gates remain explicit. M7 is optional. Rigor remains high because generated code execution, credentials, and repository writes cross trust boundaries.

The operator approved the documented SDK differences and continuation with published 1.3.0. `docs/sdk-review.md` retains that decision and the two control-ownership designs. Approved source hashes are fixed separately from each fresh comparison.

M0 evidence is `docs/evidence/m0-tests.txt`: `npm run verify` passes TypeScript and 23 tests, including fail-closed handling of corrupt durable allowance state. Tests use real temporary catalogue/native SQLite files, fake adapters, and four actual SIGKILL/reopen cases, including the gap after an application tool receipt but before the SDK's tool checkpoint. Incomplete native tool work parks conservatively even when the action ledger was already cleared. Tool results are journaled in the native file before action completion; active time uses a monotonic process clock. They cover duplicate claims, safe pause, Continue/Retry, passive and active note delivery, provisioning recovery, auth-time dispatch denial, allowance/repair limits, same-revision phase gates, capacity-two isolation, deletion failure/expiry, authenticated HTTP/SSE, and singleton-before-storage. Model/integration outcomes remain explicitly scripted.

`npm run check:sdk` now returns `approved-differences` for exactly the approved hashes. `npm run doctor` still exits 1 for missing installer Bash, which is deferred to M3.

The scripted TypeScript controller is implemented in `src/`, with Node HTTP/SSE and tests in `test/`. `npm start` binds the fixed loopback port before opening application storage, creates a private per-run connection capability, and runs only the faux provider. Live model routes and publication are denied. Tests remove only their own temporary data. No external account, vault, item, service token, OAuth state, GitHub push, or PR was created. Only the explicitly labeled trusted probe containers described below were created and removed. The existing fixture remains unchanged.

M1 compiles with published GPUI 0.2.2, installed Rust 1.97.1, and process-local Xcode/Metal. Its artifact resource and on-demand native cards are implemented. Its M1 verification record is `docs/evidence/native-visual/forge-sse-tests.txt`, with 42 Node tests and 30 Rust tests passing. The earlier `docs/evidence/artifact-resources-tests.txt` remains historical evidence for the artifact backend and client. These include artifact provenance, immutable reads, corruption and link rejection, crash ordering, native PNG decoding, stale response rejection, HTTP validation, body timeout, Unicode/input handlers, and real-controller reconnect/expiry behavior. Network work is off the render thread; redirects and ambient proxies are disabled. Drafts are case-scoped and clear only on matching acknowledgments.

Before the user's screen-capture approval, the native binary stayed alive but owned-window capture failed. `docs/evidence/native-artifacts-smoke.json` records that historical result. A later diagnostic found screen capture unauthorized and the macOS privacy log attributed the request to Cursor. The user then granted screen capture. Preflight now returns true and actual native window capture succeeds. No accessibility permission was granted or bypassed.

The first successful capture exposed missing client text. GPUI had selected `NoopTextSystem` because normal builds omitted `font-kit`; test-support enabled it indirectly and masked the problem. Commit `313792f` enables that single feature without upgrading GPUI. Actual capture and local OCR verify restored text.

The Eitri-inspired basalt/copper theme is integrated as `bded3a5`. Constrained native captures exposed collapsed history and unreachable Save. Commit `94ee0ca` adds a detail scrolling fallback; `f47a762` and `7072ada` reproduce and contain nested wheel propagation. Real captures now show a reachable Save button, focused multiline Unicode editor, and readable evidence controls. `docs/native-rendering.md` and `docs/operator-style.md` link the evidence and distinguish fixture-driven states from OS input automation.

Native artifact viewing exposed an SSE body-reader timeout inherited from its response-header deadline. Commits `541fa99` and `6e6397a` add the failing regression and a private fixed-loopback reader with separate bounded header and line deadlines. Independent static review found no issues, and the full integrated suite passes.

Actual native text and PNG artifact captures remain visible after an additional twenty-second wait. Fixture-driven deselection removes the image; weak references confirm both raw and rendered image handles are released. Physical GPU-memory reclamation is not measured. `docs/evidence/native-visual/viewer-verification.json` records the exact scope and stopped owned processes. M1 is accepted for the scripted pilot using actual native rendering plus the existing native input, connection, and event tests. No OS-level input automation was used.

A standalone, trusted Chromium containment probe was built and run with no repository/credential mounts or live agent. Its final result is **blocked**: sandbox-enabled ARM64 Chromium exits with `No usable sandbox!`. Applied and effective isolation/resource settings are recorded in `docs/evidence/chromium-containment.json`. Read-only root, unavailable host/socket paths, denied egress, non-root UID, dropped capabilities, seccomp, no-new-privileges, and cgroup limits were observed. No page action or screenshot succeeded. The owned probe container was removed; the pinned local image remains for reproduction.

The earlier stop was the failed containment gate. The continuation tested a reviewed six-rule namespace/seccomp candidate under the unchanged remaining restrictions. All positive USER namespace controls pass, and negative controls retain their expected denials. At that checkpoint, Chromium stopped at `sys_chroot("/proc/self/fdinfo/")`. `docs/containment-review.md` records paired reports. Both owned containers were removed. The operator subsequently explicitly approved the separate `chroot` experiment. Its reviewed opt-in candidate was tested with every other restriction unchanged. After the separately approved task-ceiling experiment and diagnostic corrections below, the fixed trusted browser probe is positively verified; see the current containment review.

No security bypass, fixture edit, Sentry service, live application inference, existing integration-token read, GitHub push, or PR was performed. The agent changed no global Docker, kernel, or toolchain configuration. The user explicitly granted screen capture. Scripted M1 acceptance is now verified; M2 through M6 remain incomplete. Do not request token values in chat.

The earlier run had no subagent or compaction tool. Its design comparison and comment review were sequential self-review. The continuation now has subagents and uses independent exploration and review.

## Earlier continuation framing

This run resumed from `77bb89a`, which includes `d11c927` plus lint and format setup. The inherited checkpoint remains authoritative. The operator requested continued implementation and commits for finished units. This is interpreted as approval for the narrow local namespace/seccomp experiment described in `docs/containment-review.md`, not broader privileges or disabled sandboxing.

The definition of done remains M0 through M6 acceptance on real artifacts. Security-sensitive rigor remains high. Operator-presence gates cannot be completed by local implementation alone. Local code and mocked integration tests may proceed, but they do not enable live remediation.

Policy provenance and existing resource seams were independently reviewed. The smallest contained experiment was run and remains blocked. Authenticated case-scoped artifacts were implemented in an isolated worktree and integrated as `0925818` after independent static review. Native-case manifests own provenance and reference immutable private bytes. The controller rechecks artifact integrity during evidence admission. ID-only authenticated HTTP reads are passive and serialized against expiry. Focused parent verification passed 26 artifact, evidence, and crash-recovery tests; TypeScript, lint, and format checks pass. The native card/client unit was independently reviewed and integrated as `1141a89`. At that earlier artifact checkpoint, parent verification passed `npm run verify:all` with 42 Node tests and nine Rust tests, including real HTTP artifact retrieval. The native binary built and launched, but capture was not yet authorized. The later native verification above supersedes that acceptance status. Independent source reviews found no actionable defects in either unit, but do not replace runtime or visual evidence. Each finished unit receives its own verification and commit. M2 generated execution remains blocked until positive sandbox verification. The remaining M3, M4, and M6 gates stay explicit. `.audit/resume-todos.md` tracks this run's checklist. `decisions.tsv` remains the committed decision trail.

## Resume point after offline workspace preparation

- The implementation plan is unfinished. M1 scripted acceptance is verified, including native glyphs, forge styling, constrained layout, focused editor, stable artifact viewing, and raw/rendered image-handle release. Verification limits remain explicit in `docs/native-rendering.md`.
- The trusted browser feasibility gate now passes with the explicitly approved seven-rule policy and 256-task limit. Sandbox rows, negative controls, actual click/result, and owned-container cleanup are verified in `docs/evidence/chromium-contained-browser-verification.json`. M2 itself remains unaccepted. Next work is a managed snapshot worker and immutable validation/scenario driver, then reviewed controller/native integration. Generated execution remains disabled.
- Unwired workspace/file-broker preparation is integrated as `7f28bf3` after parent source review, fresh security/comment reviews, and parent `npm run verify:all` with 88 Node and 30 Rust tests passing. See `docs/workspace.md` and `docs/evidence/workspace/tests.txt`. Tests use synthetic bytes and temporary Git only. No controller/native/HTTP entry point imports it. M2 itself remains unaccepted. Immutable validation-driver integration, generated execution, and real fixture changes remain gated. The original fixture is untouched. The worktree `../eitri-workspace-broker` holds the integrated original commit `c7e23ba`; do not replay it.
- M3 through M6 remain pending, including operator-reviewed vault permissions, direct token setup, repository privacy/default-branch confirmation, supported OpenAI sign-in and first-inference approval, and deliberate live remediation activation.
- The artifact implementation worktrees remain available at `../eitri-artifact-resources` and `../eitri-native-artifacts`. Their committed changes are integrated on `main`; do not replay their commits. Temporary native-smoke data is retained under `.audit/` and contains synthetic cases only.

## Earlier audit at `567a48a`

A read-only evidence audit by `openai-codex/gpt-6.1-sol` found no material discrepancies at that checkpoint. It confirmed the namespace approval was an interpretation, not a separate affirmative approval, and that no `chroot` addition was applied. Visual/operator acceptance, image-handle cleanup, positive browser containment, and live gates were open then. Later evidence above closes the scoped M1 visual and handle-release checks, not physical VRAM measurement or the containment/live gates.

## Native visual audit at `5b430a2`

A fresh read-only evidence audit by `openai-codex/gpt-6.1-sol` checked original transcript outputs and actual images. It supported the recorded checks, fixture-driven captures, image-handle release, and scoped scripted M1 acceptance. It found stale current-status statements in this file that still described M1 as unaccepted. Those statements are now corrected or explicitly historical. The decision log remains append-only.

Both audits used the configured model family, so cross-model-family review is not satisfied. OS-level input automation and physical VRAM measurement are not claimed. M2 acceptance and live gates remain open.

## Offline workspace unit

The first writer timed out with retained uncommitted files and an interrupted verification. A fresh delegate completed that same implementation, added hot-journal identity-mismatch regressions, and committed only the five authorized source/test files. No design restart or runtime wiring occurred.

The library keeps Git, manifests, scoped one-file changes, durable intents/receipts, and frozen exports behind one owned boundary. An interrupted intent parks uncertainty rather than replaying source writes. Marker-bound SQLite rollback is storage recovery only. Initial creation fails closed, shared-store pending intents conservatively park other ready workspaces, and lifetime quotas have no reclamation API yet. Same-UID adversarial races and power-loss guarantees are not established.

Fresh security and comment reviews found no actionable findings in the exact committed files. The public API contract comment remains; no suppressions or comment deletions were needed. Reviews used `openai-codex/gpt-6.1-sol`, the configured family. Parent integrated verification passed independently. This proves the offline seam, not M2 containment or live acceptance.

## Approved containment continuation

The operator explicitly approved the single `chroot` experiment and invited discussion of other easing if evidence warrants it. The reviewed opt-in policy is integrated as `8cba063`; defaults and all other syscall/resource restrictions remain fixed. Paired reports preserve the launch failure without that rule and progress past launch with it.

The default headless shell rejected `chrome://sandbox`. Commit `02e6c6d` selects pinned bundled full Chromium without weakening sandbox checks. Its diagnostic navigation also failed. Rather than broadening policy or guessing another flag, `d4f7938` adds a bounded process/resource census and browser logs. That diagnostic run records two task-limit denials and matching thread-allocation errors. The operator subsequently approved only the 128-to-256 task-ceiling experiment. No further restriction change is approved. All owned probe containers were removed.

Parent `npm run verify:all` passes 89 Node and 30 Rust tests. Evidence and the exact remaining gate are in `docs/containment-review.md`. The real fixture and live/integration gates are untouched.

## Verified browser feasibility

The operator-approved task experiment is integrated as `e86e52a`, with the 128-task mode retained as control. Same-image comparison proves the only applied contract change is the task ceiling. The 256-task run avoids observed quota denials and reaches Chromium's sandbox page. Its first check still failed because the probe expected an obsolete label. `c314b4d` adds a strict four-row parser and negative regressions, and moves the click test to an ordinary document without bypassing the privileged page's CSP.

Fresh same-family review found no acceptance gaming. Parent then ran both modes against the same pinned image. The 128-task control fails; the 256-task candidate reports supported, verifies namespace/PID/network/BPF protection, and completes the literal click/result assertion. All negative syscall controls and other applied restrictions remain intact. Both owned containers are removed. Parent `npm run verify:all` passes 114 Node and 30 Rust tests.

Only the trusted fixed-browser feasibility gate is accepted. Full M2, arbitrary generated commands, managed worker/validation integration, and all later live gates remain incomplete. The read-only design report recommends a browser-only frozen-export validator before any project Node/build execution or controller wiring. It identified a host UID 501 versus container UID 1001 export-permission issue. The reviewed throwaway controlled-COPY instrument is integrated as `2532270`. Its first parent run failed before container creation because BuildKit treated local-ID FROM as a registry reference. Frozen A and workspace B were preserved and owned scratch removed. See `docs/frozen-browser-prototype.md`. The separate fixed-local-tag/ancestry correction is integrated as `5265951`. Its build and ancestry checks passed, then a pre-start environment-order assertion rejected equivalent bindings. All owned resources were removed. The exact unique-binding comparison is corrected as `88e30af`. Its next parent run verifies COPY hashes/read-only modes under UID1001 and Chromium sandbox status, then stops at an overbroad all-process capability assertion on mask `0000000000200000`. That run did not capture the failing process. The diagnostic run at `08b2599` subsequently identifies a zygote in a distinct user namespace with single-UID/GID mapping and exactly the namespace-local mask documented by pinned Chromium source. Initial-namespace processes remain at zero effective capabilities. The narrowly witnessed correction is integrated as `6c4f3a3` after fresh security review. The parent run now observes literal frozen A in Chromium after the workspace became B, with COPY hashes/modes, unchanged export, absent project-Node canary, and owned cleanup verified. Docker cache reclamation is not claimed. Parent verification passes 114 Node and 30 Rust tests. See `docs/evidence/frozen-browser-copy-verification.json`. Three fresh read-only designs were compared. All choose recorded-frozen bytes rather than physical-export knowledge. The selected base is Design A's small callable module, with automatic cleanup acknowledgment from C. B's streaming observation/artifact interface and C's extra run handle are deferred until a caller needs them. The first increment, `WorkspaceStore.readFrozen(frozen, signal)`, is integrated as `64814eb` after fresh security review and parent `npm run verify:all` with 128 Node and 30 Rust tests. It returns detached verified bytes without paths or export allocation. Queued cancellation cannot start work, and active Git reads stop before cancellation settles. No validator, Docker, controller, native, or HTTP behavior changes. See `docs/evidence/frozen-reader/verification.json`. The worktree `../eitri-frozen-byte-reader` retains the already-integrated original commit; do not replay it. The design cross-review selected `FrozenBrowserValidator.open/validate/close`, automatic finalization, and finite COPY contribution accounting rather than an invented physical-cache quota. The isolated unwired module candidate `0fd7549` remains unmerged in `../eitri-frozen-browser-validator` on `implement/frozen-browser-validator`. The event-completeness fix `9b2a55a` passed fresh delta review and parent verification with 192 Node and 30 Rust tests. Lifecycle and comment reviews were also clear. Parent then ran the first actual synthetic Docker case. It failed before browser acceptance. A bounded diagnostic observed Docker treating the supplied tar input as Dockerfile text and rejecting its first `pax-0` header; the diagnostic reported owned cleanup removed. Archive correction `1e92adb` passed fresh delta review and real archive-reader tests. A further parent Docker diagnostic built the derived image successfully, then stopped before container creation because Docker omits empty `Cmd` while the validator requires `[]`. Owned image cleanup was confirmed. Empty-command correction `4b11d90` passed fresh delta review and parent verification with 228 Node and 30 Rust tests. Raw absent/null/empty-array inspection is normalized to canonical saved `Cmd: []`; nonempty commands and noncanonical stored forms remain rejected. The next actual run passed complete applied-container inspection, but Node could not load the watchdog. Parent copied metadata from only that owned container and measured the trusted asset directory as `0444`, which denies UID1001 traversal. Owned container/image cleanup was confirmed. An isolated writer is correcting only Dockerfile asset placement while retaining root-owned `0444` files and unchanged containment. The earlier 193-of-194 fast run failed on **1 ms remaining**, not a provider dispatch. Read-only investigation found separate timer/accounting mechanisms; the historical cause remains unproved, and this module makes no controller changes. Evidence is recorded in `docs/evidence/frozen-browser/`. Remaining actual-Docker cases are unrun, and the module is still unmerged and unaccepted. The contribution ceiling is 16 nonrefundable 40 MiB attempts, not a physical daemon-disk bound. All production entry points and later live gates remain unchanged. Actual physical cache overhead remains an explicit later validation-module concern; input reservations must not be presented as a hard disk quota. All owned resources were removed; A/B were preserved before scratch cleanup. No capability, accepted environment value, automatic fallback, or containment change is authorized. No original fixture edit, host mount, project Node execution, production API, or new restriction change is authorized by that prototype.

## Checkpoint policy

Update this file and `decisions.tsv` after each substantial unit. Record commands and actual results. Do not call a simulated run a live model result. No compaction tool is exposed by this harness. These files are the continuation record for automatic or operator-triggered compaction.
