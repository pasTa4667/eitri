# Pi runtime feasibility checkpoint

## Decision and scope

The operator authorizes a **prototype before any architecture replacement**. The direct Eitri sign-in attempt was denied by OpenAI with `3p_delegated_access_policy_denied` and the browser explanation that open-source app sign-in is unavailable for the selected Enterprise workspace. This is operator-reported browser evidence, not a captured terminal verdict, an ID-token-validation failure or a general claim that all Enterprise integrations are unavailable. The request ID is `b69b721b-eeea-4fb4-8cd8-1fbef16b4f1a`.

The operator reports successful everyday Pi use with the Enterprise account. Session metadata independently selects `openai-codex/gpt-6.1-sol`; this identifies the selected provider/model, not the workspace or an entitlement audit. The installed Pi coding-agent is **1.4.0**. Eitri's Pi AI/Pi Durable dependencies remain **1.3.0**; using the already-installed executable for this experiment is not a project upgrade.

Investigate the actual Pi CLI through its supported RPC interface, with Pi managing its own existing credentials. Do not copy/import tokens, impersonate Pi from a custom OAuth implementation, change workspace permissions, purchase access, fall back to API keys, or assume that a successful call grants general Enterprise integration permission. Pi may refresh its own stored OAuth credential while running; Eitri must not inspect or retain it.

## Bounded prototype contract

1. **Local preflight:** default/help performs no process/auth/network activity. Explicit activation pins the installed executable and `openai-codex/gpt-6.1-sol`. Use Pi's non-secret `auth check --json --no-refresh` interface and require configured OAuth; never use credential-printing switches.
2. **Synthetic RPC turn:** use an empty temporary working directory and an in-memory session. Disable tools, extensions, MCP, skills, prompt templates, themes and context files; supply fixed system/append prompts. Disable automatic catalogue/update/package network activity with Pi's `--offline` option, which does **not** forbid the explicitly requested inference. Verify selected provider/model/API/endpoint and an empty, nonpersistent session before sending the one fixed prompt. Disable agent/provider retries and automatic compaction in fixed temporary project settings; approve only that generated empty project for this process. Do not send RPC settings mutations: source inspection shows they persist global settings.
3. **Honest result:** require an acknowledged started prompt, one assistant turn, observed text streaming, a matching successful final assistant message and non-aborted `agent_settled`, then successful child shutdown. `agent_end`, accepted commands, exit 0 alone, fake responses and partial/error messages cannot pass. Refuse tools, retries, compaction, wrong provider/model, malformed/oversized output and unexpected exits. Bound deadlines, stream sizes and child teardown; emit only fixed/allowlisted operational metadata, never raw stderr, thoughts, responses, model configuration or credentials.
4. **Stop:** run offline failure/success tests, then one approved real synthetic inference through Pi. Record exactly what passed/failed. No source inspection/edit/check commands, repository upload, hosted Sentry/GitHub access, operator/controller wiring, schema migration or replacement of Pi Durable follows automatically.

This is a diagnostic process with no model-callable tools, **not an OS sandbox** against a compromised Pi installation or same-user process. Pi can access its own configuration/credentials under the invoking user's permissions. Existing global model/proxy configuration remains Pi-owned; startup/model identity must be checked rather than assuming built-in configuration. A successful fixed-prompt test does not establish restricted-tool enforcement, crash-safe model accounting, per-case history/expiry, concurrent credential refresh, durable restart semantics, cancellation during a real tool, or production readiness.

## Ordered plan and acceptance

The canonical checklist is [M4 in the build plan](build-plan.md#current-m4-subscription-access-slices):

- Prototype first: offline regression tests plus one actual Pi-owned synthetic streamed turn under the contract above. Record provider/runtime versions and limits. No architecture change.
- If successful, separately design/approve the smallest runtime seam: compare retaining Pi Durable with a Pi-owned inference adapter against using the full coding-agent runtime. Establish one authoritative transcript, checkpoint/restart/budget rules, and how existing container-only tools/evidence stay enforced. Do not run two competing agent loops or silently replace native durability with JSONL.
- Implement an offline compatibility slice only after that decision, including hostile-tool/pause/restart/accounting/retention tests; obtain separate approval for further real tool-using inference. Broader integration waits for those results.

## Sources inspected

The installed package's complete relevant CLI/RPC/JSON/configuration/security documentation and RPC example were read before implementation. Public counterparts:

- [CLI integration](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/cli-integration.md), [RPC protocol](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/rpc.md), [commands](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/rpc-commands.md), [events](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/json.md).
- [CLI flags](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/cli.md), [security](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/security.md), and [configuration](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/configuration.md).

The public `RpcClient` is not used by this disposable probe: the installed implementation echoes raw child stderr, retains it without a bound and merges the entire parent environment. A small bounded protocol reader is warranted here instead of adding a dependency or weakening the diagnostic's secrecy contract. This is not a proposed production RPC framework.

## Run and results

```sh
npm run --silent probe:pi-runtime          # help only: no runtime/credential access
npm run --silent probe:pi-runtime -- --run # deliberate repeat of the real experiment
node --test test/pi-runtime.test.mjs       # offline fake-child protocol tests only
```

The prototype is [`prototypes/pi-runtime.mjs`](../prototypes/pi-runtime.mjs). It is a fixed, Mac-installation-specific experiment, not a general RPC client or a production route. Its 60-second overall deadline includes a ten-second auth-preflight cap; child teardown escalates to SIGKILL after one second and waits for process closure before deleting its generated temporary directory. It never restores or edits global settings and never reads a credential file itself. Pi can legitimately refresh its own OAuth state. Changing the installed CLI version requires reviewing the prototype's version/contract guard, not silently upgrading anything.

**The actual experiment passed.** On 2026-10-25, the existing Pi 1.4.0 executable completed one streamed `openai-codex/gpt-6.1-sol` assistant turn with the exact synthetic marker, zero tool executions, non-aborted settlement and exit 0. Pi's non-secret preflight reported configured OAuth. The global settings file's bytes were unchanged. [Retained observations](evidence/pi-runtime/actual.json) include selected installed-source hashes, scope and limitations, not tokens, raw stderr, wire transcripts or thoughts. No new browser sign-in or Eitri client registration was needed. No other model is claimed tested.

This establishes **basic Pi-owned inference/RPC feasibility**, not blanket authorization or full compatibility for Eitri. In particular, workspace identity is operator-reported rather than independently inspected, the provider is labeled legacy, and one successful call is not a commitment that the route will remain available. The direct Eitri `openai` sign-in rejection and ID-token findings are not fixed by this result; they belong to a different parked route.

The 23 offline tests pass. They cover default help, early events before prompt acknowledgment, discarded diagnostics, no-key fallback, startup identity/persistence/resource refusal, malformed/oversized output, request rejection, tool/retry/multiple-turn refusal, missing streaming, provider error, premature exit, aborted/late runs, cancellation with process reaping, hung work and uncooperative shutdown. RED first fails on the missing module. A review regression then demonstrates that a new `agent_start` after settlement could be accepted; the fixed reader rejects late/repeated runs. The tests use real fake-child subprocesses, not hosted inference. The ordinary full test suite never runs the real probe. Final regression/build results are recorded in the [work log](work-log.md#pi-owned-runtime-feasibility-prototype).

## Five-axis author review

| Axis | Finding and disposition |
|---|---|
| Correctness | `prototypes/pi-runtime.mjs:99–170,219–259`: require correlated acknowledgment, observed deltas, successful authoritative final message, settlement and normal shutdown. **Important, fixed:** late/repeated `agent_start` now fails; the regression was RED first. No fake-child pass is labeled live evidence. |
| Readability | One fixed prompt/model and three RPC commands; deliberately not a configurable production protocol framework. |
| Architecture | `prototypes/pi-runtime.mjs:15–83`: real external Pi process, Pi-owned auth and temporary settings; no new OAuth implementation, project dependency change, controller/GPUI integration or competing production loop. |
| Security | `prototypes/pi-runtime.mjs:16–83,175–216`: sanitized environment, OAuth-only metadata preflight, disabled tools/resources, no credential-printing commands, strict LF/UTF-8/byte limits and discarded stderr. Temporary project settings avoid global RPC-setting writes. The installed Pi process is trusted, not sandboxed by its cwd or flags. Enterprise policy compliance, credential-refresh races and future untrusted-tool containment remain unproven. |
| Performance | `prototypes/pi-runtime.mjs:16,38–52,260–272`: bounded preflight, attempt, pipes and kill/reap cleanup; one prompted synthetic turn, no automatic experiment retry or provider/model switch. Background transport behavior is not packet-captured or generally certified. |

This is an author review, not an independent-agent or cross-model security audit. No unresolved Critical/Important defect is identified within the narrow prototype contract; the production compatibility gaps above remain required next work. **Stop before changing the architecture.**
