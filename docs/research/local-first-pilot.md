# Local-first Sentry remediation pilot

Updated **2026-10-18 (UTC)** during build-plan finalization after research sign-off and the readiness audit. **Research handoff approved; application implementation has not started.** The user authorized adding Xcode and retaining Node 26 if compatible. Xcode 27.1 first-launch/license checks now pass. The required Metal Toolchain component was downloaded, and compiler-version/linker-presence checks pass. No GPUI application has been built yet. No project dependencies, Sentry services, or provider logins have been set up.

This is the approved research handoff. New implementation decisions and open questions are recorded in the [implementation design](../implementation-plan.md). The [initial landscape](sentry-agent.md) preserves broader comparisons, not current recommendations. See the [glossary](../../CONTEXT.md), [local-hosting ADR](../adr/0001-local-self-hosted-pilot.md), and [native-GPUI ADR](../adr/0002-native-gpui-for-learning.md).

## 1. Confirmed direction

The primary purpose is **learning to build a durable agent and learning GPUI**, not maximizing model coding ability or operating a production remediation platform.

| Area | Current decision |
|---|---|
| Audience | Private use, at most one team; no multi-organization product |
| Operator application | **Native desktop Rust/GPUI**, not a web client |
| Agent controller | **TypeScript, existing Node 26.5.0, Pi Durable, local SQLite**; Node 26 provisionally accepted after version-range/basic SQLite checks, full project compatibility still to verify; no celld |
| Host | The current **M3 Pro / 36 GiB Mac** |
| Sentry | Self-hosted locally; errors-only profile is the minimal proposed configuration |
| Inference | **Existing OpenAI/ChatGPT subscription through Pi's supported sign-in**; hosted inference/data boundary accepted; no local model required |
| Source hosting | **Private GitHub repository**, an explicit external-hosting exception |
| Demonstration project | A separate, minimal **React/TypeScript** project using Node tooling |
| Repository setup | User-initialized checkout at `../eitri-test-web-app`; origin points to `https://github.com/pasTa4667/eitri-test-web-app.git`. Read-only inspection found an untracked README and no commits yet. Remote privacy/entitlements were not independently checked. |
| Authority | Following supervised evaluation: automatic eligible coding attempts; native draft PRs where available, otherwise ordinary clearly marked WIP PRs; human merge, no deployment authority |
| Cost | Use the existing allowance without additional purchases, automatic top-ups, or paid-API fallback; entitlement/limit behavior must be verified |
| Policy | Unresolved High-priority or regressed/escalating investigation candidates, separate eligibility gates, and a manual path; no universal raw-event-count cutoff |
| Triage | Automatic assessment plus Sentry reviewed/assignment updates where appropriate; preserve native priority, no automatic archive/discard/resolve |
| Desktop lifecycle | Work continues after closing GPUI while the Mac/controller run; per-issue pause after the current action finishes, preserving phase/context across closure/restart until explicit continue |
| Remediation lifecycle | Triage → investigation and proposed solution → implementation → testing → PR creation → PR created; not Sentry's own status vocabulary |
| Pilot endpoint | Agent execution stops at PR creation with validation evidence; controller tracks the PR while retaining ownership until merge. A new report from a known fix-containing version may start fresh work with prior remediation history. No CI/review-comment iteration. |
| Future possibilities | Cloudflare may be reconsidered later; no pilot dependence on it or promise of effortless migration |

The agent must not initialize, clone, commit to, or scaffold the demonstration repository during this research session. The demonstration application does not belong inside the agent repository merely for convenience.

The local controller, UI, Sentry, and SQLite are self-hosted, but **GitHub and OpenAI are accepted external dependencies**: this is not an entirely self-hosted or air-gapped system. Source code/PR evidence goes to GitHub, and selected code/Sentry context goes to OpenAI. Minimize/redact evidence before sharing it; never copy secrets or raw sensitive telemetry into prompts or PRs. No paid GitHub Actions workflow or paid account upgrade is assumed.

## 2. Two separate applications

### Operator application: native GPUI

This is the desktop application for inspecting issues, chatting with the agent, and observing/controlling remediation work. Learning GPUI is an explicit goal, which justifies choosing it over a lower-effort existing UI. The earlier browser-GPUI interpretation is superseded; browser WASM support, Trunk, browser fallback frameworks, and cross-origin-isolation requirements are **not pilot requirements**.

GPUI is pre-1.0 and documents breaking changes. Its native macOS path uses Metal and documents full Xcode/macOS tooling requirements. Pin a compatible release/revision and validate native input, streaming, keyboard interaction, and reconnect behavior during implementation. The source contains useful native input and list examples. No assumption is made that all prerequisites are installed. [R1, R2]

Rust is the client language, not a reason to rewrite Pi Durable or add a second Rust backend. A narrow connection to the local TypeScript service is sufficient in principle. The user confirmed that this service should continue after closing the desktop window while the Mac is awake and the controller runs. Manual pause/continue applies to one issue's remediation session: finish the current action, then start no further work until explicit continue. Paused work retains its phase/context across closure/restart; closing the UI is not itself a pause. Process supervision, transport, and the concrete mechanism for enforcing these semantics remain implementation topics.

### Demonstration project: small React application

This is the monitored application that deliberately produces errors. The user selected React/TypeScript with Node tooling, separate from the GPUI operator application.

**Minimal proposed realization:** Vite's React/TypeScript template, the React Sentry SDK configured against **local Sentry**, a few trigger controls, and small testable functions containing bounded defects. Node runs development/build/test tooling; a separate Node application API, database, Next.js/SSR layer, or authentication system is not necessary merely to have a React test target. Exact test tooling belongs to implementation design. [R26, R27]

Start with error monitoring only, not tracing/replay/profiling. Readable stack traces and mapping to the correct local source/revision must be verified; a minified stack with no source mapping is poor investigation evidence. Do not copy the SaaS DSN or optional cloud integrations from documentation examples. [R27]

## 3. Local capacity and Sentry profile

The confirmed host reports Apple M3 Pro, **36 GiB unified memory**, 12 logical CPUs, and approximately 120 GiB free filesystem space at research time. Its active Docker-compatible engine reports Linux ARM64, 12 CPUs, approximately 31.4 GiB total memory, and OrbStack. These observations are not a memory reservation or a performance benchmark. If local inference is added later, it would share physical memory with the Linux VM; it is not required for the selected hosted-inference path.

Sentry's **errors-only** profile contains Issues, Alerts, Integrations, Dashboards, Releases, and Errors without the full tracing/profiling/replay stack. It is the smallest documented Sentry profile matching this pilot. Self-hosted Sentry excludes Seer and other closed-source AI features. [R4, R5]

The observed release **26.10.0** requires at least **2 CPUs and 7,000 MB available to the container engine for errors-only**, versus 4 CPUs and 14,000 MB for the default profile. These are installer floors, not a total machine budget or guaranteed steady-state usage. General documentation calls for 16 GB host RAM plus swap, at least 20 GB free disk, and recommends more RAM. Images, retained events, builds, and the OS require extra headroom; local model weights/context would be an additional cost only if local inference is introduced later. [R4, R6]

**Proposed configuration direction:** pinned stable errors-only release, low-volume synthetic data, bounded retention, one coding attempt/model request at a time. Validate ARM64 image availability and simultaneous Sentry/controller/GPUI/coding-job resource use before treating the setup as ready. Exact memory allocations and install configuration are deferred.

### Readiness audit and authorized Xcode setup

Read-only checks found Node **26.5.0**, npm **12.1.0**, Rust/Cargo **1.97.1**, Command Line Tools, and the existing OrbStack/Compose installation. The agent repository is still documentation-only and not a Git working tree. The test checkout remains README-only with no commits. No Sentry-named containers/images were found. No credentials were inspected and no model request was made.

The user chose to reuse Node 26 rather than install Node 24. Pi Durable 1.3.0 declares Node `>=22.19.0`, and the inspected Vite 8.3.4 manifest declares `^20.19.0 || >=22.12.0`; both allow 26.5.0. A no-file, in-memory ESM/`node:sqlite` create/insert/query check passed on the installed Node. This is a basic compatibility signal, **not** a full Pi Durable/Vite application test. Verify actual project installs, startup, build, and tests during implementation before claiming full compatibility; discuss any necessary runtime change rather than altering the global Node installation silently. [R30, R31]

A later read-only installer check found an additional prerequisite: the published self-hosted Sentry 26.10.0 installer requires **Bash ≥4.4**, but the available `/bin/bash` is **3.2.57**, with no Homebrew/local alternative at the checked paths. Homebrew exists. The [build plan](../build-plan.md) proposes installing a newer Bash binary solely for that installer after sign-off, without changing the system/default shell or upgrading Node. Nothing was installed by this check. [R6]

Xcode **27.1** (build **27A9275**) is installed at `/Applications/Xcode.app`. The user completed Apple's first-launch/license prompts; both checks now return success. Metal verification initially found a missing separate component, so the authorized prerequisite setup added **Metal Toolchain 27A266a** through Apple's `xcodebuild -downloadComponent MetalToolchain` (approximately **839 MB**). No optional simulator/platform download was requested. [R32]

Post-install verification resolves and runs the Metal compiler (**Apple metal 32023.921**) and resolves an executable `metallib` linker. The observed global developer directory now points to `/Applications/Xcode.app/Contents/Developer`; the agent did not run an explicit global `xcode-select --switch` command. These prerequisite checks pass, but no Metal source, GPUI application, or project dependency build has been performed. Prerequisite setup is a narrow authorization, not permission to scaffold projects, authenticate providers, or start Sentry.

The implementation interview also identified a **version-matching gate**: the researched GPUI examples come from a Zed revision configured for Rust 1.98.1, while installed Rust is 1.97.1. Published GPUI 0.2.2 comes from an older source revision configured for Rust 1.90 and is the proposed first-build candidate; neither configuration establishes minimum supported Rust or proves dependency compatibility. Use matching published-source examples rather than assuming current-monorepo examples compile unchanged. No Rust upgrade was performed. Evidence and the proposed compatibility check are in the [implementation design](../implementation-plan.md#additional-implementation-facts-and-proposed-defaults).

### Container runtime licensing

The active engine is OrbStack, whose free tier is personal/non-commercial; business/commercial use requires a paid plan. A private team project does not automatically qualify. Docker Desktop has its own free-use eligibility conditions. [R7, R8]

During implementation round 9, the user confirmed **OrbStack is already licensed for this use** and chose to reuse it. No purchase, trial, license-key inspection, runtime change, or container start occurred. **Colima with Docker Engine** remains an unselected free alternative; its default VM is too small for Sentry's installer floor. [R9]

## 4. Controller and optional infrastructure

**Chosen:** existing Node 26.5.0 + Pi Durable + local SQLite, rather than celld. Node 26 replaces the earlier Node 24 LTS recommendation at the user's request, subject to the compatibility checks above. Pi Durable already supplies persistent conversations, application state, and task checkpoints. One process owns a harness storage at a time; the SQLite file is not an off-host backup. External actions such as GitHub publication still need duplicate prevention and reconciliation. See the [initial research](sentry-agent.md) for the official harness evidence and limitations.

Keep coding execution separate from controller credentials and restricted to the demonstration repository. A working directory is not a sandbox. Running tests or installing packages executes repository code; a learning project is not a reason to expose production credentials or the entire home directory. The precise container/VM boundary is deferred to the implementation grill.

**Deferred:** celld, Cloudflare deployment, distributed storage, additional workflow engines, Redis, vector search, and specialist-agent swarms within one issue. The user now explicitly requires a structure that can support concurrent sessions for different issues later, with an overview of all sessions; the prototype still executes one session at a time. See the [implementation design](../implementation-plan.md) for workspace/ownership decisions. Celld can run a Workers/DO application locally without a cloud bucket, but brings its own compatibility/lifecycle requirements. Its experimental container path has explicit macOS egress limitations. It is not required to make the selected Node harness durable. [R10, R11, R12]

## 5. Selected model access: existing OpenAI subscription

**Selected:** Pi's OpenAI provider with **Sign in with ChatGPT**, using the user's eligible existing subscription allowance. The user accepted the hosted-inference/data boundary. Pi Durable is not limited to local models; Ollama and a local model are no longer required pilot dependencies. [R13]

See [subscription model access](subscription-model-access.md) for the inspected Pi implementation, first-party policy sources, and retained alternatives. During implementation, verify account-specific eligibility, the actual available model, permitted tool use, streaming completion, credential refresh, and quota/error behavior. A provider login or bundled model catalog alone does not prove access. No login or model request has been performed here.

Use one authorized account/model connection for the personal pilot. **No additional purchases, automatic top-ups, or paid-API fallback** are authorized. If access or quota fails, preserve the work and expose the blocked condition; do not switch silently to another billed route. Exact model selection and auth provisioning are deferred until the actual account-specific availability can be checked.

Claude API credits and the previously researched local `qwen3:4b` remain comparison/future alternatives, not additional services to install or configure. A scripted provider test may verify mechanics, never demonstrate an actual model-generated fix. [R25]

## 6. Reusing Sentry's own prioritization

### What exists without our own severity engine

Sentry's public documentation and its **26.10.0 source** distinguish three concepts:

| Signal | Meaning | Planning use |
|---|---|---|
| **Priority: High / Medium / Low** | Basic error priority is largely derived from event log level: Error/Fatal → High, Warning → Medium, Info/Debug → Low when no enhanced severity result is available | Reuse as an attention/ordering signal, not proof of business impact |
| **Escalating** | Occurrence volume exceeds a per-issue historical forecast; Sentry can resurface an archived-until-escalating issue and bump its priority | Reuse when actually supplied by the local installation; do not rebuild the forecasting algorithm |
| **Regressed** | A resolved issue recurs according to Sentry's resolution/release rules | Reuse as a reason to investigate renewed behavior |

The basic priority assignment is in the shipped event-manager source. Escalation forecasting and priority updates are in the shipped Python source and scheduled tasks, not inherently a call to Seer. This is stronger evidence than assuming SaaS marketing implies self-hosted support. However, we have **not run the selected errors-only installation**: include a local smoke check of surfaced priority, substatus, and API behavior before relying on those paths. [R19, R20, R21, R22, R23, R24]

### What we must not assume

- **Enhanced ML-based priority is not our local feature.** The docs describe a plan-gated enhancement. The source explicitly gates enhanced severity on Seer-related features and calls a Seer severity service; self-hosted docs exclude Seer/AI features. Do not enable a flag and pretend the service now exists. [R4, R19, R22]
- **High is not an intelligent certification of a critical bug.** A plain captured Error normally starts High. An expected but incorrectly reported validation error can therefore also be High.
- **Escalation is not instantaneous semantic severity.** It is volume-relative, uses historical data, and is subject to issue state/archiving rules. The documented algorithm has a younger-than-seven-days fallback, but a fresh toy project still has little meaningful history. Do not require escalation before the pilot can attempt its first fix. [R20]
- **Manual priority changes affect automation.** Sentry documents that manually setting priority disables automatic priority adjustment for that issue; the source checks the priority lock. A manually changed demo is not proof that automatic escalation worked. [R19, R23]
- **Event level, priority, and substatus are separate fields.** “Critical” is not an additional Sentry priority tier. Prefer the vendor's exact terms in the UI and glossary.

### Accepted candidate policy: Sentry signals plus separate fix eligibility

The user accepted Sentry-native candidate selection rather than another severity classifier, with the limited triage write-back boundary below:

1. Read native priority/status and keep their origin visible.
2. Use unresolved **High** issues and **regressed/escalating** issues as investigation candidates; keep other issues visible and allow a deliberate manual request. This candidate policy is accepted.
3. Before coding, apply a small explicit eligibility check: allowed project/environment/repository, actionable code-level evidence, no existing attempt/PR or known fixed revision, bounded permitted changes, and a viable validation route.
4. Keep high-risk or uncertain cases for human attention rather than equating urgency with permission to edit.
5. Record the reason for candidate selection separately from the reason coding was allowed or declined. Do not invent another numeric criticality score or a universal occurrence threshold.

A temporary upstream outage, expected validation behavior, or infrastructure problem can deserve investigation without a speculative repository patch. Sentry's urgency signals cannot determine all of those boundaries for us. The selected model may assist interpretation but does not grant itself authority.

**Fallback:** if required native signals are absent or unusable in the pinned local release, show that limitation and use the previously proposed explicit impact/relevance rubric. Do not silently treat missing priority as Low or replace missing functionality with a paid service.

**Accepted automatic triage:** assess candidates automatically, then mark an issue reviewed and assign a configured owner where appropriate after actual assessment. Show the explanation in the operator application. Review/assignment are the approved Sentry mutations, not permission to use every operation exposed by a write-scoped token.

Preserve Sentry's native automatic priority. Do **not** automatically change priority, archive, discard, or resolve issues, including when a PR is created. Additional write-back such as comments would be a separate scope decision, not assumed. The issue-update API supports review/assignment with write scope; manually overriding priority would disable native automatic adjustment. [R19, R23, R29]

## 7. GitHub publication and the zero-paid-services constraint

The user selected **GitHub**, not a local Forgejo/GitLab installation, and initialized the local demonstration checkout at `/Users/felix.langbein/projects/eitri-test-web-app`. Its configured origin is `https://github.com/pasTa4667/eitri-test-web-app.git`. Read-only inspection found no commits yet and an untracked README; no target instructions were present. This verifies local checkout/configuration, not remote privacy, reachability, or draft entitlements. The agent has made no changes there.

No paid GitHub plan or hosted CI is assumed. Validate changes locally. A repository-scoped GitHub App remains an unattended-auth option; a fine-grained token can be simpler for a personal pilot. Credential details belong to implementation design, and publication should not expose the controller's credentials to arbitrary code in the test checkout.

**Draft-PR compatibility issue:** GitHub's current REST API documentation includes plan restrictions for drafts in private repositories. Do not assume a free private repository has native draft PRs; verify against the actual account/repository later. [R28]

If native drafts are unavailable, the no-upgrade alternative is an **ordinary PR clearly marked as agent-generated work in progress**, with no automatic merge/deploy. This is **not equivalent to a draft**: a title/label does not make the PR technically unmergeable or suppress review notifications. The user accepted this fallback rather than a required paid upgrade. Do not publish ordinary PRs while claiming they are native drafts.

Opening or merging a PR does not establish that the running application includes the fix or that the Sentry issue is resolved. The implementation interview refined the stopping point: **agent execution ends at PR creation**, but lightweight controller-side PR-status tracking continues, keeping the case owned/in progress while awaiting merge. CI/review-comment iteration and automatic deployment remain out of scope. The accepted post-merge rule requires a new occurrence from a known version incorporating the merged fix, not merely an error arriving after merge. Older or unknown versions cannot spawn another agent. A qualifying recurrence creates a fresh session with earlier attempts, failed checks, and fix history available; closed-without-merge cases instead pause for operator attention. Details are in the [implementation design](../implementation-plan.md).

## 8. Per-issue remediation lifecycle

A **remediation session** is the work on one Sentry issue. The user requested explicit phases:

**Triage → Investigation and proposed solution → Implementation → Testing → PR creation → PR created**

| Phase | Meaning |
|---|---|
| **Triage** | Assess the candidate, decide its next disposition/eligibility, and perform only the approved review/assignment write-back. |
| **Investigation and proposed solution** | Gather evidence, identify a plausible bounded cause, and record the intended remedy and validation approach. |
| **Implementation** | Make the eligible change in the restricted test checkout/working branch, not directly in a deployed application. |
| **Testing** | Run the selected local checks and record their actual results and limitations. |
| **PR creation** | Publish the proposal and evidence to GitHub in the accepted native-draft or ordinary-WIP mode. |
| **PR created** | Agent handoff endpoint; controller-side PR tracking and issue ownership continue while awaiting merge. No automatic merge, deployment, CI/review iteration, or Sentry resolution. |

These are **our application's work phases**, not custom values to write into Sentry's native issue status/substatus. The proposed solution is an artifact of investigation; it does not introduce an unrequested mandatory human-approval gate before every eligible implementation.

Pause/continue is separate from progress. A session can be paused within a phase after the current action completes, preserving that phase and context. Paused intent survives client closure/controller restart until an explicit continue. Closing GPUI alone does not pause the controller, and pause does not undo Sentry/GitHub effects or freeze an OS process. Do not treat abort/cancellation as though it automatically supplied these pause semantics.

The sequence is the successful path, **not a promise that every issue must reach a PR**. Non-fixable or out-of-scope cases need a visible disposition; missing evidence or failed validation must lead to correction or human attention rather than a fabricated success. Detailed failure outcomes, retry limits, rollback behavior, transitions, and persistence/schema choices belong to the next implementation grill.

## 9. Minimal demonstration and learning plan

Keep a few representative cases, not a realistic product:

1. A small deterministic valid-input defect, triggerable from the React page, with testable intended behavior.
2. Another bounded defect, or a variation of the first, to exercise priority/status handling without requiring large event volumes.
3. An expected/handled invalid-input case that must not automatically invite a patch merely because telemetry exists.
4. A local simulation of an upstream/transient failure for investigation/escalation versus speculative code changes.

Repeat one defect to exercise Sentry grouping and duplicate suppression. Use synthetic data and local triggers; no public deployment, real transactions, load generator, or live external outage. Keep known expected outcomes for evaluation independent of the model's explanations. The exact defects, controls, regression checks, and fixtures belong to implementation design.

### Rollout status

1. Research handoff confirmed by the user; read-only readiness audit completed. Xcode 27.1 first-launch/license checks pass; the required Metal Toolchain is installed and compiler/linker prerequisite checks pass. Actual project builds remain for the approved implementation phase.
2. Conduct the separate implementation-design grill; do not scaffold as part of this session.
3. In the user's separately initialized GitHub-backed folder, create the minimal React project and establish real error delivery to self-hosted Sentry.
4. Verify native GPUI startup, the chosen provider's permitted authentication and Pi tool use, readable error context, and actual Sentry priority/status behavior.
5. Exercise supervised triage, including negative cases and repeated events, allowing only the Sentry write-back actions the user explicitly approves.
6. Allow restricted coding attempts and the agreed GitHub publication mode; expose actual validation results and failures.
7. Exercise controller restart, desktop-client disconnect, the agreed persistent per-issue pause/continue semantics, repeated delivery, failed attempts, and ambiguous external publication results. Never auto-merge/deploy. Verify that paused work stays paused across restart and that completed external actions are not blindly repeated.

Learning success includes understanding state/recovery, safe tool use, native UI integration, and explainable decisions. Correct code fixes are desirable, but this is not a model-quality benchmark. Failed or declined attempts must remain visible; never manufacture a patch or a success report to complete the demonstration.

## 10. Research handoff and deferred implementation

Round 4 confirmed the existing OpenAI subscription/data boundary, automatic triage with limited review/assignment write-back, and persistent per-issue pause/continue. The user also supplied the explicit remediation phases above. The user confirmed shared understanding and approved the research handoff. This was **not permission to begin application coding**; the subsequent readiness audit and Xcode prerequisite setup were authorized separately.

Implementation must be designed in the separate grill the user requested. Deferred subjects include native UI layout/transport, Pi provider/credential wiring, exact available model, lifecycle transition/retry/failure rules, schemas, tool contracts, prompts, numeric policy/timing/caps, sandbox boundaries, Sentry/forge credentials, process supervision, installation, source-map/test setup, backups, and deployment files. These are deliberate handoff items, not claims of a tested design.

Initial implementation defaults to validate are errors-only Sentry, a minimal Vite React/TypeScript test application, modest concurrency, and simple scheduled intake before adding webhook infrastructure if warranted. Exact configuration remains deferred. Container-runtime license eligibility, ARM64 Sentry readiness, account/model entitlement, and private-repo draft availability are validation gates; none justifies silent paid upgrades or scope expansion.

The documentation records agreed intent and researched options. It is not runnable software or a full state-machine specification. Use the approved handoff and readiness findings as inputs to the separate implementation-design interview; no source-code implementation, Sentry startup, or provider authentication has been authorized yet.

## Sources

- **R1 — GPUI native examples:** https://github.com/zed-industries/zed/blob/56934ec0560bce8929025497411de7f5322fb6ca/crates/gpui/examples/README.md
- **R2 — GPUI maturity and native macOS prerequisites:** https://github.com/zed-industries/zed/blob/56934ec0560bce8929025497411de7f5322fb6ca/crates/gpui/README.md
- **R4 — Self-hosted Sentry capabilities, Seer exclusion, and sizing:** https://develop.sentry.dev/self-hosted/
- **R5 — Errors-only mode:** https://develop.sentry.dev/self-hosted/optional-features/errors-only/
- **R6 — Release-specific installer floors:** https://github.com/getsentry/self-hosted/blob/26.10.0/install/_min-requirements.sh
- **R7 — OrbStack free personal versus paid commercial use:** https://orbstack.dev/pricing
- **R8 — Docker Desktop free-use conditions:** https://docs.docker.com/subscription/desktop-license/
- **R9 — Colima platforms, runtimes, and VM defaults:** https://github.com/abiosoft/colima/blob/main/README.md
- **R10 — celld overview/local mode:** https://github.com/denoland/celld/blob/90b43017241f81189453d326d05948f388b34652/README.md
- **R11 — celld compatibility:** https://github.com/denoland/celld/blob/90b43017241f81189453d326d05948f388b34652/docs/cloudflare-compat.md
- **R12 — celld container/macOS limitations:** https://github.com/denoland/celld/blob/90b43017241f81189453d326d05948f388b34652/docs/services/containers.md
- **R13 — Pi local/custom model providers:** https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/ai/README.md
- **R14 — Ollama local API/tool support:** https://docs.ollama.com/openai and https://docs.ollama.com/capabilities/tool-calling
- **R15 — Ollama local-only mode and Metal:** https://docs.ollama.com/faq and https://docs.ollama.com/gpu
- **R16 — llama.cpp local alternative:** https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- **R19 — Sentry basic/enhanced priority and manual locks:** https://docs.sentry.io/product/issues/issue-priority/
- **R20 — Sentry escalation algorithm and new-issue fallback:** https://docs.sentry.io/product/issues/states-triage/escalating-issues/
- **R21 — Sentry status/regression semantics:** https://docs.sentry.io/product/issues/states-triage/
- **R22 — Release-specific basic priority and Seer-gated severity:** https://github.com/getsentry/sentry/blob/26.10.0/src/sentry/event_manager.py (functions `_get_severity_metadata_for_group`, `_get_priority_for_group`, `_get_severity_score`)
- **R23 — Release-specific priority escalation/lock behavior:** https://github.com/getsentry/sentry/blob/26.10.0/src/sentry/issues/priority.py
- **R24 — Release-specific native escalation path and scheduling:** https://github.com/getsentry/sentry/blob/26.10.0/src/sentry/issues/escalating/escalating.py and https://github.com/getsentry/sentry/blob/26.10.0/src/sentry/tasks/weekly_escalating_forecast.py
- **R25 — Optional local model size, quantization, tool capability, license, and identifier:** https://ollama.com/library/qwen3:4b
- **R26 — Vite React/TypeScript template and Node tooling:** https://vite.dev/guide/
- **R27 — React Sentry SDK and readable stack traces:** https://docs.sentry.io/platforms/javascript/guides/react/
- **R28 — GitHub PR API, including private-repository draft restrictions:** https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request
- **R29 — Sentry review/assignment/priority/status write-back and scope:** https://docs.sentry.io/api/events/update-an-issue/
- **R30 — Pi Durable Node requirement and built-in SQLite adapter:** https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/package.json and https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/src/storage/sqlite/node.ts
- **R31 — Inspected Vite Node engine range:** https://registry.npmjs.org/vite/8.3.4
- **R32 — Official Xcode distribution/components:** https://developer.apple.com/xcode/resources/ and https://apps.apple.com/app/xcode/id497799835 and https://developer.apple.com/documentation/xcode/downloading-and-installing-additional-xcode-components

All capability claims above are documentation/source evidence, not live integration guarantees. No Sentry, model, GPUI application, or GitHub publication has been exercised as part of this research.
