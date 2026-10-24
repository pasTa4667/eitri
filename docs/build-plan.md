# eitri: implementation blueprint and build plan

Current implementation authorization and milestone acceptance are recorded in the [work log](work-log.md). The scope limits and gates below remain binding.

This consolidates the completed interview. The [decision record and evidence](implementation-plan.md), [domain glossary](../CONTEXT.md), and [storage ADR](adr/0004-catalogue-and-session-stores.md) explain the choices. Defaults below describe the planned pilot, not completed or tested integrations.

## 1. Approval scope and limits

Approve a staged local implementation: TypeScript controller, native Rust/GPUI operator application, controlled React demonstration project, the existing hosted Sentry project, and restricted execution on the existing licensed OrbStack installation. Learning agents and GPUI takes precedence over model performance.

Approval would permit source/manifests, local Git initialization for `eitri`, project dependencies and lockfiles, native builds, worker images, and the local service/test stages below. It does **not** authorize publishing the controller project, buying anything, changing global Docker context/default shell/toolchains, sharing a vault, or bypassing a failed gate.

**Hosted Sentry selection:** the operator selected the existing hosted project for M3: organization `pasta-re`, project ID `4512275993002064`, API origin `https://sentry.io`. This supersedes the local Sentry installation and installer-Bash prerequisite; do not install Sentry or a newer Bash for this milestone. Hosted telemetry is an explicit exception to local-first storage, not permission to upload repository contents or arbitrary diagnostics. Use existing account features only, with no new spending. Node stays **26.5.0**. Credential, permission, monitored-build and publication gates remain explicit.

Human-presence gates remain explicit:

- Review the intended company 1Password account and proposed permissions before creating an empty vault; check actual access before adding secrets. No invitations, all-team grants, or share links. Owner/admin governance is not equivalent to a personal-only vault.
- Generate/store GitHub and Sentry tokens directly in their own interfaces and 1Password; never paste values into this conversation.
- Confirm target-repository privacy and baseline branch before the first push. Preserve the existing README; do not silently rename `master`, force-push, or change repository visibility.
- Complete supported OpenAI sign-in and approve the first small real inference/tool verification. No copied CLI credentials or paid API-key fallback.
- Enable live remediation deliberately after readiness checks. Merging a PR and activating an updated demonstration build remain operator actions.

No CI/review-comment repair loop, automatic merge/deployment, automatic Sentry resolution/priority changes, web operator UI, agent swarms, vault-management UI, vector database, or general worker internet access. Future coding-time documentation/error-code research is recorded but not implemented here.

## 2. Runtime and small source layout

- Controller: one Node process; Node HTTP/SSE, `node:sqlite`, TypeScript, Pi Durable/Pi AI, and Node's built-in test runner. No ORM, queue server, or second backend.
- Start with published Pi packages **1.3.0**, verifying exports against inspected commit `8efd314fa3d3232ce197d8d7a6a5660530b9d83e` before relying on them; lock compatible dependencies. Experimental API mismatch is a stop/review condition.
- Operator: published **GPUI 0.2.2**, matching published-source examples, installed Rust **1.97.1**, Xcode **27.1**, and the installed Metal toolchain. Actual build compatibility is unverified; do not silently upgrade Rust or switch to newer-monorepo examples.
- Sentry: existing hosted organization `pasta-re`, project `4512275993002064`. Verify project/latest-event access, classification, grouping and permitted update behavior before enabling intake. Hosted service versions are not locally pinned. No self-hosted image, Compose service or installer is required. The earlier empty-list connection check is not populated-response or event-detail verification.
- Worker: pinned Linux ARM64 Node/Playwright/Chromium/dependency image, with matching Playwright package/browser versions. Reuse OrbStack through an explicit process-local Docker context.
- Prefer one root Node package (`src/`, `test/`), `operator/` for Rust, and only the small separate worker build/driver assets needed for isolation. The demonstration stays in `../eitri-test-web-app`. Do not scaffold generic providers/plugins or future concurrency infrastructure.

## 3. Modules and authority

The **controller module** presents the same small interface to the HTTP adapter and tests:

```text
snapshot(selection, cursor?) -> operator projection
command(requestId, expectedControlVersion?, intent) -> durable receipt
watch(selection) -> initial snapshot + committed projection updates + close
```

Its implementation owns admission, lifecycle, budgets, integration intents, and cleanup. GPUI never writes native documents, advances phases directly, or receives service credentials.

Internal seams exist only where behavior actually varies: Pi's real/faux model provider, real/fake external integrations, and the restricted execution adapter versus a test adapter. Tests cross these seams through the controller interface; do not mock away the real catalogue transactions or native durability being tested. Credential loading and Git/resource management are private modules/functions, not generic plugin frameworks.

| Data | Authority and lifetime |
|---|---|
| Catalogue | Atomic issue claim, case identity, workflow/control version, pause intent, allowance counters, integration/provisioning intents, PR tracking, compact history, expiry metadata |
| Native case SQLite | That case's conversation/tasks and rich application documents: investigation, proposal, notes, assessments, check receipts, artifact manifests |
| Git/workspace module | Managed mirror, branches, source checkpoints and disposable per-case working files; never the operator's checkout |
| Artifact module | Case-scoped logs/screenshots/traces outside the disposable workspace; bounded and retention-managed |
| Credential module | 1Password static secrets in controller memory, global private OAuth state, and per-run local connection capability; never case payloads |

Use application-level UUIDs everywhere outside a native case file. Native conversation/task IDs are not globally unique across files. Catalogue control state is authoritative for action permission; a stale native snapshot or model assertion cannot override it. Streamed tokens do not increment command-control versions by themselves.

Illustrative private application-data layout, outside Git and worker mounts:

```text
config.json                 non-secret URLs, IDs, selected model, secret references
connection.json             per-controller-run localhost capability, mode 0600
oauth.json                  writable global OAuth state, mode 0600
catalogue.sqlite
cases/<session-id>/session.sqlite
cases/<session-id>/artifacts/
workspaces/<session-id>/
repositories/<repository-id>.git
```

Parent directories are private (0700). Credentials are excluded from case expiry. Restart guarantees cover process crashes, not an unverified power-loss guarantee: Pi's SQLite adapter defaults to WAL/synchronous NORMAL. Preserve control intents durably in the catalogue and surface any checkpoint/integrity mismatch rather than inventing progress. No raw transcripts or complete response snapshots remain hidden in permanent catalogue receipts; any temporary case-owned delivery/provisioning payload is bounded and cleared after handoff or case cleanup.

## 4. Admission, lifecycle, and budgets

### Admission and recovery

Poll every **60 seconds**, plus **Check now**. Unresolved High or regressed/escalating issues are investigation candidates; other issues remain visible and manually selectable. High is not proof of a fixable defect. Missing signals are shown as unknown, not Low.

Admission transaction: check project/environment/repository policy, local dispositions and existing ownership; atomically create the issue claim, case record, and provisioning intent. Initialize the case file idempotently; no model/worker starts before it is ready. A crash finishes provisioning or parks that same claimed case, not another queued owner.

One unfinished session owns an issue, including queued, paused, Needs attention, and Awaiting merge work. Reports attach to that case. Ownership is separate from an execution slot: prototype limit **1**, no global current-issue/conversation variable. Fake-provider tests also exercise two distinct issues concurrently so a later capacity increase does not require redesign; real parallel execution remains unapproved.

On explicit controller restart, reconcile owned resources, checkpoints, native work, and uncertain external intents before dispatch. Recover previously unpaused work within its preserved allowance. Keep paused/Needs attention cases paused and local No fix needed/dismissed dispositions suppressed. Do not recreate a missing expired case database as a fresh conversation. Uncertain data/state is visible Needs attention, never invented progress.

### Phase interface

The agent submits a structured phase-completion assessment with evidence references, not a command to set the next phase. Controller code validates its shape, current execution/version, permissions, and required observations. Semantic diagnosis and coverage remain judgments, not certified facts.

| Phase | Required before progression |
|---|---|
| Triage | Recorded assessment and candidate/fix-eligibility reasons; only allowed Sentry review/assignment actions, with observed results |
| Investigation and proposed solution | Relevant event/source revision, prior-attempt brief, reproduced target failure, bounded proposal/affected paths and validation approach |
| Implementation | Allowed change, saved source checkpoint, tests/regression additions; no unsupported dependency/build/policy changes |
| Testing | Required green checks for that exact candidate and validation configuration, baseline reproduction, browser evidence, testing assessment and limitations |
| PR creation | Current valid evidence, no pending pause, eligible allowance, current branch/base checks, and reconciled publication intent |
| PR created | Agent execution stops; case remains owned/Awaiting merge and metadata polling continues |

No fix needed is a local terminal outcome with a reason and manual-requeue suppression. A suspected defect that cannot be reproduced, ambiguous scope, unsupported change, missing evidence, auth/quota/infrastructure failure, exhausted allowance, or exhausted repair cycles goes to **Needs attention**, not a fabricated fix.

### Execution control

- **Pause:** durably request a safe boundary; the admitted action may finish, but no next model/tool action is admitted. Save its result/checkpoint, phase, notes, and counters, then acknowledge Paused and release execution resources. Internal native-run cancellation/closure may be used only after this application protocol; SDK abort alone is not the pause feature.
- **Continue:** resume the same manually paused case and remaining allowance/repair count.
- **Retry:** explicit Needs attention intervention with a note; same case/history, new bounded allowance and repair budget. Old usage remains recorded. A closed-without-merge PR retry returns to investigation, not blindly to publication.
- **Requeue:** a fresh linked session for a terminal case, subject to ownership and eligibility checks. Does not erase the earlier assessment.
- **Dismiss locally:** stop/suppress suitable parked work with a reason, without resolving Sentry. An open published PR remains tracked; do not drop its ownership merely to dismiss it. Close it externally first if abandoning that handoff.
- Parked/Awaiting merge/finished chat saves notes without inference. Active-work messages are durably recorded and steered at a safe boundary by the runner, never by an HTTP handler starting an unrestricted generation. Expired detailed history is read-only summary view; requeue for new work.

Each allowance is **10 minutes active work**, excluding queued, paused, and PR-waiting time. Persist consumed time and charge an interrupted in-flight action conservatively on recovery; restart is not a reset. Bound model requests initially to **120 seconds**, generated commands to **60 seconds**, and browser scenarios to **60 seconds**, each also bounded by remaining allowance. Timeouts preserve uncertainty/partial results; remote side effects are reconciled. No independent 20-turn limit.

After an initial candidate validation failure, permit at most **two repair/test cycles**. Auth/quota/infrastructure failures do not trigger speculative code repair. Retry/backoff is bounded and never switches billing routes. On expiry, no extra model call is made merely to write a stop summary.

Every inference dispatch and tool execution must fail closed on control/allowance errors, including SDK follow-ups/compactions. Do not rely on prompt instructions or a throwing non-tool hook: the SDK may report and skip such hooks. Disable unsolicited background compaction initially; test the last inference-dispatch seam with a counting faux provider. Viewing/reconnecting must not start a worker or model. Native busy state is not the operator application's execution status.

## 5. Workspace and validation contract

Use a controller-owned repository mirror and per-case branch/worktree. The operator's original checkout is never switched, reset, cleaned, or automatically updated. Git subprocesses use fixed argv/URLs and explicit credentials, with hooks, external drivers, ambient credential fallback, and untrusted configuration execution disabled. Never load target-repository extensions/configuration as host code.

**Proposed containment default:** generated shell/build/test programs execute only in the container, with source mounted **read-only** and bounded temporary scratch. Source changes use the read/edit/write interface through a trusted file broker that can touch only allowed regular files in that case's controller-owned worktree; it cannot execute supplied code. It validates virtual paths, symlinks, sizes and protected files, records/checkpoints a change before reporting it saved, and refuses unexpected dirty/human changes rather than overwriting them. Generated shell commands cannot edit host source; they must use the scoped file tools. Mount only the fixture's declared source/configuration paths, never shared Git metadata. This is deliberately narrower than an unrestricted developer shell and avoids a container-to-host copyback mechanism. Recover interrupted writes from their intent/checkpoint or park uncertainty; do not promise durability for an uncommitted action.

Start with non-root generated/browser processes, no home/credential/shared-Git-metadata/Docker-socket mounts, no external network, dropped capabilities, bounded PIDs, **2 CPU / 4 GiB RAM**, source/scratch limits, and private shared memory rather than host IPC. Give the trusted container supervisor a fixed lifetime slightly beyond the ten-minute allowance so orphaned worker commands cannot run indefinitely after controller death. Do not use privileged/SYS_ADMIN/no-sandbox/host-network troubleshooting fallbacks. Verify actual ARM64 Chromium sandbox compatibility before proceeding; provisional resource defaults may be tuned only within the approved isolation contract.

Allowed initial autonomous changes are the fixture's `src/**` and new regression tests; baseline tests, package/lock/build configuration, workflow files, `.git` metadata, and controller policies are protected. New dependencies or a wider fix need attention. Agent-written tests are useful but are not permission to weaken the trusted checks.

### Proposed demonstration contract

| Stable scenario | Intended behavior and initial fixture |
|---|---|
| `profile-name` | Shared display-name helper returns trimmed names and `Anonymous` for a missing/blank name or profile. The initial implementation dereferences the missing value and throws; a button triggers it. Inspect all callers, not just the button handler. |
| `cart-total` | Shared total helper returns `0` for an empty list and sums a normal list. The initial implementation reduces without an initial value and throws for an empty list. |
| `expected-validation` | Deliberately reported, handled invalid input; the existing error display is correct. Assess and record No fix needed, not a speculative patch. |
| `transient-upstream` | Local deterministic simulation fails once and succeeds on a second button press; no real external outage or service. Assess its transient nature without changing correct application behavior. |

Use synthetic inputs, stable per-scenario Sentry fingerprints/tags, a known immutable build release, and explicit `demo` versus `validation` environments. Existing normal-path tests start green; the trusted targeted probe exposes the current defect, and the agent adds its regression coverage. The other intentionally latent bug is not a permanently red global test blocking an unrelated fix. Keep expected outcomes in a controller-owned manifest outside the agent's editable files. This is a controlled learning fixture, not a claim of benchmark-quality autonomous diagnosis.

### Revision-bound checks

Before validation, freeze a candidate Git commit. Run checks against a fresh immutable snapshot of **that commit**, with build/cache output in scratch, not against a mutable checkout. Generic editing/shell tools are not offered as a way to modify the validation snapshot. Any subsequent edit—including a human edit before Continue/Retry—creates a new checkpoint and invalidates old gates.

A controller-created receipt records session/action/check IDs, base or candidate SHA, scenario/input and validation-manifest digest, image/driver versions, actual outcome/exit status, timing, assertions, artifact IDs/checksums, and whether it was simulated. A positive baseline reproduction is distinct from an arbitrary failed startup. A model-written “passed” or a screenshot alone is not a receipt.

Publication requires:

1. The target scenario fails on the base revision for the reported reason and passes on the candidate.
2. Existing normal-path unit checks, applicable new regression checks, type/build checks, and one real-browser target scenario are green for the same candidate/configuration.
3. Actual browser action/assertion records and artifacts for claimed browser verification, plus a testing assessment and limitations.
4. No stale revision, missing required artifact, unresolved infrastructure result, or simulated-agent success being passed off as a live fix.

The agent may explore the UI using controlled local click/fill/keyboard/snapshot operations. Mandatory scenario expectations live outside its editable files and run in a fresh browser context. These observations are not proof of complete coverage or semantic correctness. Candidate Sentry reporting is disabled/excluded during offline validation; the separately monitored demo still reports normally.

## 6. External integrations and history

### Credentials

Use the existing company 1Password account and installed CLI with explicit account/secret references. Desktop approval loads only the configured static GitHub/Sentry tokens privately into controller memory. They are not printed, stored in model messages, passed through GPUI, or inherited into worker environments. The runtime cannot create/share vaults or read arbitrary references on the model's request.

CLI desktop authorization is account-wide, not a vault-scoped service identity. Locking 1Password does not revoke already-loaded copies or stop the controller. Explicit reload may require approval and replaces the active values; provider-side revocation/rotation is separate. No service account or Connect deployment in this pilot. Actual company vault permissions remain an operator-reviewed setup gate, not an ongoing guarantee against later admin changes.

Pi OAuth state is global, writable, private and shared safely across case runtimes; serialize refresh/store updates. Reuse Pi's supported sign-in rather than inventing OAuth or copying another application's tokens. Register only the selected OpenAI route/model, require the OAuth credential type, and disable ambient API-key/other-provider fallback even if the environment contains keys. Available model IDs and actual permitted tool use are verified after sign-in, not assumed from a catalogue.

### Sentry

Publish Sentry and demonstration ports only on loopback, not the LAN. Read configured project/environment data, normalize/redact evidence, and preserve native priority/status origin. Allow only review and configured-owner assignment after assessment. The documented review flag is `inbox: true`, distinct from `hasSeen`; verify its effect against the pinned installation before enabling it. Send only whitelisted fields, not a copied issue object. Preserve observed human assignments and priorities; expose conflicting/unknown remote changes rather than claim cross-system atomicity. Before implementation/publication, refresh the issue's eligibility; an externally resolved/ignored issue or unavailable prerequisite parks the case rather than overriding operator intent. No publish/archive/discard/resolve/priority mutation, comments, Seer, or new severity engine.

### GitHub publication

Verify the configured repository is private and token access is repository-restricted before the first push. Publish the **tested commit**, not a newly reconstructed untested commit. Use an owned branch; refuse unexpected remote-head/default-base changes rather than force-push or silently publish an untested integration.

Persist publication intent before push/create-PR, with stable branch, candidate SHA, and unique case/publication marker. On timeout/restart, reconcile remote ref and PR before retrying. Exact-once external effects are not promised. Do not treat generic permission/API failures as draft unavailability. Use native draft when available; otherwise the accepted clearly marked ordinary WIP PR, explicitly mergeable. PR body contains controller-produced local check summaries/revision IDs and limitations, not secrets or full raw artifacts.

PR creation ends agent work and allows workspace removal only after archival succeeds. Keep branch/checkpoints, history/evidence and ownership while the PR is open. Poll status without a model. Closed without merge → Needs attention; stale/API failure → unknown status with ownership retained. No CI/review-comment loop or automatic merge/deployment.

### New reports after merge

Only a genuinely new event from a known served version containing the actual merged fix can automatically claim a fresh session. Unknown/older versions do not. The demo release tag is its clean immutable build's full Git revision, not a dirty/HMR checkout's HEAD. Record GitHub's confirmed actual merge revision, fetch/verify its lineage, and distinguish it from the earlier tested candidate. Squash/rebase uncertainty fails closed; a timestamp after merge is insufficient. A later revert can legitimately qualify because lineage is not proof the bug stayed fixed.

Supply the new investigation a bounded prior-attempt brief: hypotheses, meaningful changes/failed checks, outcomes, tested versus merged revisions, operator interventions and limitations. Label judgments versus observations. Use compact summaries and read-only Git/check references rather than replaying full past transcripts or cloning old screenshots/logs into every new case. Retained full history/evidence remains available to the operator until expiry. An expired artifact is explicitly unavailable, not reconstructed from a model claim.

## 7. Local interface and GPUI

Proposed v1 endpoints:

- `GET /v1/snapshot` — overview and optional selected-session projection.
- `GET /v1/events?selected=<session-id>` — authenticated SSE; **first frame is a snapshot**, followed by committed projection updates.
- `POST /v1/commands` — typed intents: check-now, investigate/requeue, pause, continue, retry, dismiss, post-message/note, credential reload, live-mode enable/disable, workspace cleanup, details cleanup.
- Scoped message-page and artifact reads by session/artifact ID. No arbitrary file paths, SQL, document operations, phase setters, or model-generated host commands.

Bind a single fixed loopback port before opening the production catalogue; fail on collision rather than starting a second controller on another port. That fixed singleton endpoint is a deliberate pilot ceiling: alternate profiles/ports require an OS-backed per-store ownership guard first. Publish the random per-run bearer capability only in the private connection file. Require it for reads/SSE/commands; never put it in query strings. Validate Host/Origin/content type/body size; no permissive CORS or unauthenticated localhost control.

Command envelope: generated request ID, typed intent, session/issue identity, and expected control version for resuming/destructive operations. Same ID/body finds the durable receipt; conflicting reuse/stale state is rejected, not reinterpreted. Pause/check-now can express idempotent desired intent without racing every streamed token. Pause acknowledgment initially means Pause requested, not falsely Paused. Delivery/provisioning reconciliation is idempotent across the catalogue/native-file seam.

Frames carry protocol version, controller boot ID, and increasing wire sequence. Reconnect/reselection obtains a fresh snapshot, not a replay assumption; discard frames from old stream generations. Bound slow-client queues and coalesce to a new snapshot. Translate committed native views into small application DTOs; do not port Chord operations to Rust or send secrets/provider objects. Command authority stays server-side even if a view is briefly behind a case-file update.

GPUI MVP: session overview/filters, selected phase and control status, conversation/notes, patch/assessment text, check/artifact cards and screenshots, and explicit control/link buttons. Show Needs attention, Awaiting merge, Queued, Paused and historical cases without calling them running agents. Native text entry supports Unicode, selection, clipboard and multiline input. Use matching GPUI examples and a plain renderer first, without a component kit or vault-settings UI. HTTP/SSE work runs off the render thread; disconnect/reconnect cannot lose accepted commands or freeze typing. Expired details disable the old raw chat view while keeping compact history.

## 8. Cleanup contract

- After confirmed PR creation and successful source/history/evidence archival, stop execution and remove that session's disposable worktree/cache. No fix needed/dismissed outcomes clean similarly after archiving any work. Dirty/unarchived unexpected files block removal with a warning.
- Keep pending/paused/Needs attention recovery data. A PR-closed case whose workspace was already cleaned reconstructs from its saved checkpoint on explicit Retry.
- Full conversations/logs/screenshots/traces expire **30 days after merge, No fix needed, or dismissal**. Awaiting merge remains unfinished. Adding a note does not reset a terminal case's clock.
- Keep compact attempt summaries, revision/PR links, and ownership/disposition/version guards longer. They contain no hidden full transcripts. Do not automatically copy full older raw records into newer case files to defeat expiry.
- On expiry or confirmed explicit details cleanup: detach readers, close that case's native harness, remove its database/sidecars/raw artifacts, and mark availability accurately. Close failures or unsafe paths are reported/retried; never claim deletion succeeded when it did not. Never reopen a deleted native file implicitly.
- Cleanup only recorded eitri-owned paths. Never delete the original demonstration checkout, another case, source-repository history, remote GitHub/Sentry objects, global credentials, or 1Password items. Ordinary cleanup cannot drop a work guard and start another agent.
- Enforce expiry while the controller runs or at its next safe start, with no new login/cleanup daemon. This is normal application deletion, not forensic secure erasure of OS backups, user exports, or hosted copies. Explicit cleanup distinguishes workspace removal from loss of detailed evidence and requires confirmation for the latter.

## 9. Staged build and acceptance gates

Each stage must pass before enabling the next riskier integration. Simulated runs are labeled and cannot publish a live “model-generated fix.”

| Stage | Deliverable and acceptance |
|---|---|
| **M0 — Durable core, no live integrations** | Small Node package; real temporary catalogue and per-case native SQLite; faux model/integration/execution adapters. Prove atomic duplicate admission, interrupted provisioning recovery, safe phase completion, fail-closed model/tool dispatch, pause/Continue/Retry, no wakeup from notes, preserved restart budgets and per-file expiry. A second controller must fail before opening/running work. If the pinned SDK cannot meet these contracts, stop for design review rather than weakening them. |
| **M1 — Native operator** | Compile GPUI with installed tools and matching pinned examples; exercise keyboard/text/clipboard/multiline input. Connect to the real local interface with scripted cases and streaming. Closing/reopening UI does not stop/reset controller work; dropped/slow SSE, stale commands, duplicate request IDs, wrong capability and expired-history views are handled safely. No Docker, secrets, provider login or live model needed. |
| **M2 — Restricted worker and local fixture** | Prepare pinned ARM64 image and scaffold the separate fixture while preserving its README. Existing normal-path checks green; two deterministic latent logic defects plus expected-error/transient controls. Prove denied host-sentinel/home/socket access, denied egress, non-root/sandboxed Chromium, bounded resources, safe brokered edit/checkpoint/cancellation, immutable-candidate checks and honest artifacts. Create the local baseline checkpoint without renaming the existing branch. Fixed probes demonstrate base failure/candidate success with scripted test patches, explicitly not an AI-fix claim. No GitHub push or real model. |
| **M3 — Hosted Sentry and credential setup** | Use the existing hosted project; no local Sentry/Bash installation. Guided operator-reviewed vault/token setup; no values in chat. Verify populated project/issue/latest-event access. Trigger synthetic errors from a known-revision monitored build, verify grouping/priority/latest-event/review/assignment semantics and excluded validation traffic. Verify GitHub privacy/access and agree the target/default branch before pushing the local baseline; ask before any branch rename. Keep live automation disabled. |
| **M4 — Subscription inference gate** | Operator completes supported sign-in into the private global OAuth store and selects an available model. Run one approved small genuine tool-using turn with streaming. Test refresh/error/cancellation mechanics and no-API-key fallback with mocks; simulated quota failure is not proof of real entitlement. If subscription access fails, stop—no billed key, other provider, local-model install, or top-up substitution. |
| **M5 — Publication/recovery tests** | Fake GitHub proves ambiguous push/create responses reconcile to one managed PR; auth errors are not draft fallback. Verify open PR holds ownership with zero agent activity, post-handoff workspace removal/reconstruction, closed-unmerged parking, actual merged-version gating and seeded history in a fresh recurrence case. Test 30-day deletion, manual cleanup and protected unfinished cases with a controllable clock, including reopen/cleanup failure. |
| **M6 — Controlled live demonstration** | Enable live work deliberately. Attempt one actual eligible issue through investigation, code change, same-commit unit/build/browser proof and private draft/WIP PR. Expected/transient controls must not receive speculative fixes. Exercise Pause/Continue and one forced repair/budget-stop path. Model failure must honestly reach Needs attention; any human-assisted fix is labeled, never replaced with a hidden scripted “AI” success. |
| **M7 — Optional operator-led merge/recurrence exercise** | Operator merges and activates a known build manually; old/unknown-version reports do not start another agent. To test a true recurrence, the operator may deliberately introduce a later fixture regression. A fresh linked session gets prior-attempt history. No automatic merge, checkout update, deployment, or fake regression success. |

### Current M2 application-validation slices

After the installed local fixture baseline, continue in these bounded increments:

- [x] Acquire the fixed full-application inputs safely and demonstrate complete managed baseline/candidate frozen reads. See [input capture](fixture-application-input.md) and the work log for verification and limits.
- [x] Run protected application unit/build/browser checks from those exact managed revisions through the controller; preserve normal tests, target red/green proof, deterministic controls and truthful artifacts. See the [protected application-check contract](fixture-application-check.md) and [verification](evidence/fixture-application-check/verification.md) for the reviewed-byte policy and remaining limits.
- [x] Evaluate full M2 acceptance against the containment, cancellation, immutable-revision and evidence requirements above. [M2 is accepted for the fixed-probe/scripted-patch contract](m2-acceptance.md), with retained verification and explicit limits. Production dispatch, arbitrary generated execution and later presence-gated integrations remain disabled.

### Current M3 hosted-integration slices

- [x] Record the hosted Sentry decision and remove the local installer/Bash gate from `npm run doctor`, without claiming live service verification.
- [ ] Verify populated hosted issue/latest-event responses using the existing opt-in discovery/observation commands and an explicitly selected reviewed 1Password account. If the project is empty, coordinate synthetic reporting rather than inventing a successful event check.
- [ ] Prepare and explicitly activate a known-revision synthetic monitored build; demonstrate grouping, native classifications and exclusion of offline validation traffic. DSN setup and hosted event transmission remain deliberate operator actions.
- [ ] Verify permitted review/assignment behavior with explicit approval for remote mutations; do not resolve or reprioritize issues automatically.
- [ ] Complete GitHub credential/privacy/default-branch checks and obtain first-push approval. No branch rename or publication follows from hosted Sentry selection.

M3 remains incomplete until its acceptance row is demonstrated. Discovery and observations alone do not authorize polling, controller intake, model dispatch or live remediation.

Minimum durable/race checks, exercised through the same controller interface:

- Poll/manual/restart intake of one issue creates one owner, including while paused, awaiting merge, or provisioning.
- Paused case A releases capacity for case B; fake capacity-two runs cannot share conversations, source files, ports, receipts, counters or artifact IDs.
- A stale/late phase result or older candidate's green result cannot advance current work; every claimed required browser check has a real receipt.
- Repeated notes, reconnects, case-file views, SDK hook errors, failed streams, quota/auth failure and process restart cannot cause unauthorized inference or paid fallback.
- Kill at intent/effect/receipt boundaries; recover conservatively without double-publishing or silently replaying an unsafe command.
- Workspace removal preserves inspectable history/evidence; expiry removes only eligible raw data while compact guards still block duplicate work.

**Done means demonstrated and labeled outcomes, not promises of production readiness.** Builds, native/tool entitlement, Chromium isolation, hosted Sentry behavior and external API semantics are still validation gates. Record evidence and any failure before broadening scope or permissions.
