# Sentry-to-PR agent: research and decision guide

Research checked: **2026-10-17 (UTC)**. Status: **initial landscape; research handoff approved, readiness audit completed; no application implementation started**. The subsequent choice to retain Node 26 and the separately authorized Xcode prerequisite setup are recorded in the current plan.

**Current plan and interview:** [Local-first pilot](local-first-pilot.md). Its accepted decisions take precedence over the original comparison options below. The pilot excludes required paid services; Seer and managed sandboxes are comparison material, not selected dependencies.

This document separates vendor-documented capabilities, our provisional recommendations, and decisions still belonging to the user. It is not an implementation specification. No software has been installed or exercised to validate these options.

## 1. Brief and boundaries

The requested outcome is an agent built with Pi Durable that automatically fetches Sentry reports, triages them, implements suitable fixes, and opens pull requests. A chat interface should let a person interact with the agent. This session is for research, technology selection, and documentation; implementation details belong to a later session.

The repository was empty at the start and remains documentation-only. The user initialized a separate demonstration checkout at `../eitri-test-web-app`; no application, Sentry instance, provider login, or integration has been set up by the agent. The chosen direction is a private/team-only local-first learning pilot: native Rust/GPUI operator application, Node/SQLite Pi Durable controller, self-hosted Sentry, a small React/TypeScript demonstration project on GitHub, and hosted inference through the existing OpenAI subscription without new spending. GitHub and OpenAI are explicit external dependencies. Learning takes precedence over model coding quality.

Working interpretation: “Pi Durable” means the official `@earendil-works/pi-durable` package. The separate `disler/durable-pi` project is an application built on it, not the official package itself. Confirm this interpretation if the community project was the intended starting point.

Vocabulary: see [CONTEXT.md](../../CONTEXT.md). In particular, a Sentry issue groups multiple events. Repeated occurrences should not automatically imply repeated coding attempts or PRs; the exact policy remains a decision.

## 2. What Pi Durable actually supplies

### Verified capabilities

The official README describes an **experimental TypeScript/JavaScript agent harness**, with an API that can change without notice. It persists conversation entries, queued inputs, application documents, model/tool work, and task checkpoints. Its built-in task machinery can resume interrupted work when the owning process reopens storage and resumes scheduling. It supports multiple conversations, subagent patterns, hooks, live views, and usage/cost accounting. [S1, S2]

It is **not the same API as the ordinary Pi coding-agent SDK**. The ordinary SDK embeds the terminal agent's sessions; Pi Durable is a separate harness, sharing components such as model access. Ordinary Pi extensions and SDK/UI integrations must not be assumed to work unchanged with Durable. [S1, S2]

Available documented storage backends include memory, local SQLite, JSONL, and SQLite-backed Cloudflare Durable Objects. The docs recommend SQLite over JSONL for long-running agents because JSONL also retains the whole history in memory. **One process owns a storage at a time; there is no cross-process locking.** [S1]

Pi Durable supplies coding tools and an execution-environment interface. Its separate `pi-env` package can run tools on a remote machine while the harness, storage, and credentials remain on the controller. Neither selecting a working directory nor using a remote execution environment automatically creates a security sandbox. [S1, S3]

### Important limits

- **Durability is not exactly-once execution.** An external action may succeed just before the process crashes, leaving its result unrecorded. Durable admission IDs do not make Git pushes, PR creation, or notifications exactly-once. Reconciliation and duplicate prevention remain application responsibilities. [S1]
- **Tool recovery depends on replay policy.** An interrupted replay-safe tool can run again. An unsafe tool returns an interrupted result rather than being blindly rerun. Do not interpret “resumes work” as “continues an arbitrary shell process from the exact instruction where it stopped.” [S1]
- **Stored state is not a running service.** A stopped machine does no work. Continuous automation needs an available host, process supervision, and recoverable storage.
- **SQLite is not an off-host backup.** The documented local default uses WAL with `synchronous=NORMAL`: process-crash recovery is different from power/host-failure durability. Backup, restore, and acceptable data loss remain operational decisions. [S1]
- **The harness is not the complete product.** Sentry ingestion, repository routing, eligibility policy, authenticated chat/approvals, execution isolation, and PR publication must be provided by the application or another service.

Research snapshot: official Pi `main` commit `8efd314fa3d3232ce197d8d7a6a5660530b9d83e`; the package manifest at research time reports version `1.3.0` and Node `>=22.19.0`. This is a source-tree observation, not a verification of the latest npm release. Pin and validate compatible package versions before implementation. [S4]

## 3. Approaches worth choosing between

| Approach | What we would own | Advantages | Main costs / reasons not to choose it |
|---|---|---|---|
| **A. Small Pi-native service** | Sentry intake, remediation policy, chat connection, isolated coding workflow, PR publication | Directly matches the requested Pi Durable goal; a narrow system can stay understandable | We own safety, recovery around external effects, and operation of an experimental dependency |
| **B. Adapt `disler/durable-pi`** | Sentry workflow plus maintenance of the adopted application | Existing browser client, terminal client, REST/SSE backend, and durable-job examples | Broader multi-device platform than this use case needs; dependency/version drift and a larger security surface |
| **C. Use Sentry Seer instead** | Configuration, integration, and human review; perhaps a small policy layer | Native telemetry context; documented root-cause, code-change, and PR workflow | Does not satisfy a strict Pi-native requirement; product constraints, pricing, and less control |
| **D. Pi policy/chat layer + Seer remediation** | Pi-based intake, policy, and operator experience; delegation and result tracking | Keeps a custom control layer without owning the entire coding loop | Two systems to coordinate; less direct control of fixing; billing and permission boundaries in both |

**After round 1:** a Pi-based self-hosted tool remains the direction. Seer is comparison-only; C and D are not pilot candidates. A is the smallest matching application shape, but the exact Node-versus-Workers/celld hosting choice remains open. B is reference material, not a selected platform.

### Seer: a real alternative, not merely a related product

Sentry documents automatic analysis, root-cause investigation, code generation, and PR creation. Its asynchronous issue-fix API exposes stopping points through PR creation. Seer also has a chat experience and a Slack integration. The current product docs describe an add-on with active-contributor pricing and GitHub.com/GitLab.com support; verify the actual account's entitlement and current pricing before selecting it. [S5, S6]

Sentry lists Claude Code, Cursor Cloud Agents, and GitHub Copilot as supported external coding-agent handoffs. **Pi Durable is not listed as a built-in handoff.** Calling Seer's API from our service is a different integration and should not be sold as native Pi support. [S6]

### Community web application: useful reference, not a security shortcut

`disler/durable-pi` documents a Node 24 backend, local SQLite, a Vue 3 browser client, terminal access, bearer-token authentication, and durable jobs with approval examples. Its README calls it a playground/agent network and says it pins Pi Durable `1.0.3`, older than the official source snapshot above. [S7]

The same README explicitly warns that a backend token effectively grants a shell, start directories are not sandboxes, some network configurations use plain HTTP, and the proactive demo has no login. Its optional third-party command guard **fails open** if the service is unavailable. We have not independently tested these claims or audited the code. Evaluate it as a reference or local experiment, not a production-ready security boundary. [S7]

## 4. Chat interface options

The chat interface should be a way to observe and control persisted work, not the only place where its state lives. Closing a browser or losing a chat connection should not cancel a coding attempt. A button click is not authorization by itself: every approval still needs a verified identity and permission check.

| Interface | Best fit | What it offers | Trade-off |
|---|---|---|---|
| **Slack app** | An internal team already working in Slack | Threads, mentions, buttons, shared discussion; Bolt's Socket Mode avoids a public inbound URL **for Slack traffic** | Workspace installation/scopes, identity checks, message-rate/length limits; telemetry leaves our service for Slack |
| **Telegram bot** | A personal/mobile-first assistant | Messages, inline buttons; long polling avoids an inbound bot webhook | Another data processor; weaker fit for an existing enterprise workflow; explicit user/chat allowlists needed |
| **GitHub issues/PR comments** | Developers who want work and decisions next to code | Existing repository identity, discussion, diffs, and review | Not a rich live agent console; an intake issue or other surface is needed before a PR exists; comments can be untrusted input |
| **Reuse the community browser client** | A local/operator console and willingness to adopt its backend | Existing Durable-oriented transcript, state/task inspection, steering | Coupled to its application contract; not a drop-in frontend for any Durable service; security/version concerns above |
| **Purpose-built web console** | A queue/dashboard, rich run inspection, or a future multi-user product | Full control of triage queue, chat, approvals, logs, and accessibility | Most product work: authentication, authorization, UI maintenance, streaming and reconnects |

Slack's documented Socket Mode uses an outbound WebSocket and supports events/interactivity. Socket Mode apps currently cannot be listed in the public Slack Marketplace. This is suitable for many internal apps, not automatically for a public app business. Sentry webhooks would still need an independently reachable endpoint. [S8]

Telegram officially supports either long polling or webhooks, not both simultaneously. It is a reasonable personal option if policy permits sending the selected information there. [S9]

**After round 2:** the user clarified that the intended operator interface is **native desktop Rust/GPUI**, explicitly to learn GPUI. The earlier browser interpretation is superseded. React is for the separate demonstration project, not the operator application; see [Local-first pilot](local-first-pilot.md).

## 5. Technology stack options

### Coherent deployment choices

These are the original deployment comparisons, not accepted stack decisions. After round 1, required paid managed services are excluded and Cloudflare is future-only. A local celld-based alternative is assessed in [Local-first pilot](local-first-pilot.md).

| Stack | Components | When it makes sense | Main trade-off |
|---|---|---|---|
| **1. Small persistent service — provisional default** | TypeScript, Node 24 LTS, Pi Durable, local SQLite on persistent storage, Sentry API, source-host API, one chat adapter; coding in an isolated environment | A personal/internal pilot with modest concurrency and no existing platform requirement | Operate a host and backups; single owner per harness storage, not automatic horizontal scaling |
| **2. Controller + managed coding sandboxes** | The same controller/state service, with per-attempt remote environments such as E2B or Daytona | Prefer delegating execution infrastructure and need disposable environments | Vendor cost, region/privacy review, lifecycle/recovery integration, and target-test compatibility |
| **3. Cloudflare controller + remote executor** | TypeScript, Workers/Durable Objects with Pi's documented SQLite adapter; coding on a separate VM/sandbox | Existing Cloudflare expertise or a strong preference for managed controller infrastructure | More distributed pieces; Workers are not a normal checkout/build/test machine; platform limits and remote execution must be handled |
| **4. Adopt the community platform** | Its Node 24 backend, Vue 3 client, REST/SSE contract, SQLite, and existing deployment tooling | Its operator UX and multi-device features are genuinely needed | Maintain an application fork/adaptation; more system than a single-purpose remediation service |

Node 24 is currently LTS; the Node project recommends LTS releases for production. Bun is possible through Pi's portable storage interfaces/adapters, but is not a reason to increase integration work for a first agent. A Python controller would need a JavaScript boundary for Pi Durable; it is not the native path. The target repository can still use Python, Java, Ruby, etc.—**controller language and application language are separate choices**. [S1, S4, S10]

A local Node execution environment gives tools host access; isolation must be supplied separately. A hardened container on a dedicated worker is one option for trusted internal code, while a disposable VM or a managed sandbox may provide a more appropriate boundary for untrusted workloads. Neither choice removes the need for limited credentials, network policy, and restricted mounts. E2B and Daytona document remote execution environments, but neither has been validated against this project's as-yet-unknown repositories. [S11, S12]

### Service integrations

- **Sentry: direct API first for a narrow workflow.** The issue-list API supports filtering and pagination, and issue-event retrieval provides detailed occurrence context. A summary/list response is not all the evidence needed to fix a defect. Read-only intake can use `event:read`; any later Sentry mutations require a deliberate separate decision. Respect the account's region/base URL. [S13, S14]
- **Source host: confirm GitHub versus GitLab/self-hosted first.** If GitHub, a repository-scoped GitHub App is the preferred unattended identity; short-lived installation tokens and permission subsets are documented. A fine-grained personal token is a simpler pilot alternative but ties operation to a person. PR creation and code pushes need their respective permissions; a PR-only permission is not enough to publish commits. [S15, S16]
- **Use a supported API client when it reduces real work.** For example, GitHub's docs point to Octokit for installation-token lifecycle management. An HTTP framework is only needed if our chosen integrations need HTTP endpoints. No choice between Hono/Fastify/etc. is necessary yet. [S15]
- **MCP is optional, not the architecture.** It can help expose investigation tools, but adds server/auth/tooling surfaces. Do not assume it supplies durable workflow policy, least privilege, or duplicate prevention. Evaluate it only if specific required capabilities make it worthwhile.

### Model/provider choices

| Strategy | Advantage | Cost / limitation |
|---|---|---|
| **One hosted model/provider** | Simplest credentials, tracing, behavior, and initial evaluation | Per-token cost and provider/data-policy dependency |
| **Different models for triage and coding** | Potentially reduce spend on high-volume classification | More evaluation/configuration; cheaper triage can wrongly discard important bugs |
| **Self-hosted/local model** | More control over where inference runs | Hardware/operations burden and coding-quality/context limits to validate |

**After round 4:** use the user's existing OpenAI/ChatGPT subscription through Pi's supported sign-in; hosted inference and its data boundary are accepted. Local Ollama/`qwen3:4b` is no longer required. See [subscription model access](subscription-model-access.md) for the selected path, retained alternatives, provider-policy evidence, and the no-additional-spending boundary. Account/model entitlement still needs implementation-time verification; do not add an automatic paid fallback.

### What not to add by default

No present evidence requires LangChain/LangGraph, a second workflow engine such as Temporal, Redis, a vector database, Kubernetes, or a swarm of agents. Pi Durable already supplies persisted task/conversation machinery. Add a separate database, queue, search system, or specialist agents only for a demonstrated need; they are not prerequisites for “an agent.”

## 6. Fetching and triage: approach, not implementation

| Intake option | Strength | Limitation |
|---|---|---|
| **Scheduled API polling** | No Sentry inbound endpoint; can discover existing backlog; easy to constrain scope | Detection latency, pagination/rate-limit work, recurring API calls |
| **Issue lifecycle webhooks** | Notification of creation/state changes | Not equivalent to every new occurrence or every priority change; requires authenticated inbound handling |
| **Issue-alert webhooks** | Sentry alert rules can filter what wakes the service | Only selected alert-triggering cases reach the service |
| **Webhooks plus periodic reconciliation** | Low latency plus recovery/backlog coverage | More moving parts; still needs a deliberate selection and duplicate policy |

Sentry separately documents issue lifecycle webhooks and issue-alert webhooks. Its integration platform provides signatures for authenticity. Repeated events, notifications, or poll results must not automatically create new PRs. Polling and webhooks are intake mechanisms, not the definition of a unit of work. [S13, S17, S18, S19]

**Provisional recommendation:** polling for a low-volume pilot if minutes of latency are acceptable; add webhooks plus periodic reconciliation when response-time requirements justify it. No polling interval or webhook scheme is selected yet.

Suggested meaning of **triage**, still to confirm: decide relevance, impact/priority, repository ownership, whether an automated fix is appropriate, and what happens next. This is different from mutating a Sentry issue's status, assigning an engineer, or claiming a root cause with certainty. Some reports describe infrastructure, a third-party outage, missing evidence, or already-fixed code; “do not attempt a patch” must be a valid result.

## 7. Safety and evaluation questions that affect architecture

These are requirements to resolve, not detailed implementation tasks for this session:

- **Authority:** can the agent start coding without approval, push branches, open draft/ready PRs, update Sentry, merge, or deploy? These are separate permissions. **Accepted initial ceiling:** automated eligible fixes and draft PRs following supervised evaluation, human merge, no deployment authority.
- **Trust boundaries:** treat event messages, breadcrumbs, logs, repository files, PR comments, and model output as untrusted. They can contain instructions, secrets, or attacker-controlled text. Prompts alone are not an access-control mechanism.
- **Data:** decide what telemetry/source code may go to model providers, chat services, and sandbox vendors; identify region/retention constraints. Redact/minimize data before copying it to another surface, and restrict who can see it.
- **Execution:** dependency installation and tests execute repository code. The worker must not inherit production credentials or unrestricted access to the controller, host filesystem, or other runs.
- **Recovery:** preserve enough evidence to distinguish a failed attempt from an action that succeeded without its result being recorded. Chat outages should not lose the attempt or its approvals. Host loss and process restart are different failure cases.
- **Relevance:** map the deployed release and stack frames to the correct repository/ref. A successful edit against today's default branch is not necessarily a fix for the deployed error.
- **Evidence:** a PR should explain the issue, proposed cause, changed behavior, and actual validation. Passing existing tests is not proof the reported defect is fixed; inability to reproduce or run required checks must remain visible.
- **Limits and stop behavior:** bound spend, time, concurrency, repeat attempts, and PR volume; allow an authorized human to stop future actions. A per-attempt cap alone does not prevent an organization-wide spend burst.
- **Feedback:** decide whether scope ends at PR creation or includes CI/review follow-up and post-release observation. An opened or merged PR does not establish that the Sentry issue is resolved.

Before unattended use, evaluate on a small representative historical sample, including non-fixable cases. Measure incorrect eligibility decisions, independently reviewed fix correctness, duplicate/irrelevant PRs, human review effort, and cost per accepted fix. Do not optimize merely for number of PRs opened. The exact acceptance criteria belong to the next design rounds.

The pilot must not require paid services. Resource consumption, electricity, storage, and maintenance still exist even when recurring vendor fees are zero. The active capacity question is whether self-hosted Sentry, local inference, and coding jobs can coexist on available hardware. Paid-service comparisons above are retained only as research context.

## 8. Decision tree and interview frontier

Round 1 is answered. See [Local-first pilot](local-first-pilot.md) for accepted constraints, new findings, the planned demonstration project, the proposed non-count-based triage policy, and the next questions.

The self-hosting trade-off is captured in [ADR 0001](../adr/0001-local-self-hosted-pilot.md). Native GPUI, Node/SQLite, GitHub, the current Mac, and a React/TypeScript demonstration project are now chosen. The local-model selection, researched Sentry-native urgency signals, remaining policy boundaries, and operational expectations are documented in the current plan.

Deferred: tool signatures, prompts, schemas, state-machine implementation, API routes, deduplication algorithms, Docker/deployment files, and coding. Research decisions still need final shared-understanding confirmation before a separate implementation-design session.

## 9. Sources

First-party documentation is the basis for capability claims. The community application is explicitly identified as such. Links were fetched during this research; provider capabilities, APIs, pricing, and repository branches can change.

- **S1 — Official Pi Durable README:** https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/README.md
- **S2 — Official Pi Durable introduction:** https://earendil.com/posts/pi-durable/
- **S3 — Official remote execution environments:** https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/env/README.md
- **S4 — Pi Durable package manifest:** https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/durable/package.json
- **S5 — Start Seer issue fix API:** https://docs.sentry.io/api/seer/start-seer-issue-fix/
- **S6 — Seer product capabilities, requirements, and pricing description:** https://docs.sentry.io/product/ai-in-sentry/seer/
- **S7 — Community Durable Pi application:** https://github.com/disler/durable-pi/blob/37165c619573dbaf425463038bbffecfe576beec/README.md
- **S8 — Slack Socket Mode:** https://docs.slack.dev/apis/events-api/using-socket-mode/
- **S9 — Telegram bot update delivery and behavior:** https://core.telegram.org/bots/faq
- **S10 — Node.js release status:** https://nodejs.org/en/about/previous-releases
- **S11 — E2B documentation:** https://e2b.dev/docs
- **S12 — Daytona documentation:** https://www.daytona.io/docs/en/
- **S13 — Sentry organization issue listing:** https://docs.sentry.io/api/events/list-an-organizations-issues/
- **S14 — Sentry issue-event details:** https://docs.sentry.io/api/events/retrieve-an-issue-event/
- **S15 — GitHub App installation-token scope and lifecycle:** https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
- **S16 — GitHub PR API:** https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request
- **S17 — Sentry issue lifecycle webhooks:** https://docs.sentry.io/organization/integrations/integration-platform/webhooks/issues/
- **S18 — Sentry issue-alert webhooks:** https://docs.sentry.io/organization/integrations/integration-platform/webhooks/issue-alerts/
- **S19 — Sentry integration webhook format and signatures:** https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
