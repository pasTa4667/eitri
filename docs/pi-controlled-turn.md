# Controlled Pi tool-use probe

The operator explicitly approves this bounded next M4 step after dedicated-profile sign-in. **One actual attempt passes**, with `tool-turn-pass` and captured shell exit **0**. The [finite evidence](evidence/pi-runtime/controlled-turn-actual.json) records executable identities and limits; the [five-axis author review](evidence/pi-runtime/controlled-turn-review.md) records verification. This is a standalone entitlement/tool-round-trip probe, not production integration or M4 acceptance.

## Command and bounds

```sh
npm run test:pi-tool -- --run
```

Default/help has no credential or inference effects. `--run` makes real subscription requests and must be deliberate; this session authorizes only the recorded attempt, not unattended repeats. No browser/terminal presence is needed for inference after the separately completed operator-present login.

The launcher selects the OS user's dedicated `~/Library/Application Support/eitri/pi/auth.json`, never ambient HOME. It spawns a disposable sole credential-using process with an empty temporary HOME/cwd, dedicated Pi directory, fixed environment, no stdin, no ambient keys/proxies/Node injection/1Password tokens and no target project discovery. It consumes only bounded finite progress/report frames, discards raw child stderr and accepts success only after child close/exit 0 and empty scratch-home removal. Raw model tokens are consumed internally, never printed or stored; progress labels indicate dispatch, not evidence by themselves.

The reviewed installed **ModelRuntime 1.4.0** uses public `create`, metadata-only `listCredentials`, `getPhysicalModel` and `streamSimple`, with Pi's built-in OAuth/file store and `modelsPath: null`, `allowModelNetwork: false`, `refreshOnCreate: false`. Exactly the selected OAuth credential is required **before** any auth resolution. Only the fixed physical `openai-codex/gpt-6.1-sol` route/API/endpoint is dispatched; unavailable/failed access stops, never switches model, provider or billing route. Project packages remain **1.3.0**; no private auth import, `getAuth`, credential copy, custom store, RPC prompt or agent session.

Exactly two explicit SSE streams (`maxRetries: 0`) are permitted. The first must complete with exactly one `eitri_probe({})` call; unknown/multiple tools or extra arguments are refused. That fixed in-process tool only generates a random 128-bit hex string. The second receives the actual tool result under the original call ID and must finish without tools, echoing the string. Text deltas must have been observed, terminals must match SDK results, and late/missing/failed terminals never pass. Each consumed stream is bounded to 4,096 events and 1 MiB of serialized events. These are consumption limits, not pre-parser network/memory isolation.

The whole credential process has a **120-second hard lifetime**, including both streams and auth work; the launcher kills/waits at 125 seconds as a backstop. `maxTokens: 256` is supplied, but the pinned Codex request builder does not transmit a token ceiling: **do not claim a server-enforced token bound**. Cancellation/timeout cannot authorize another stream/tool and may lose usable login, as accepted by the v1 decision. This is trusted host SDK code, not a sandbox.

## Profile ownership and failure recovery

The probe reuses the login module's private-path checks and atomic `eitri-use` exclusion but **never creates missing profile directories/auth**. Its bounded version-2 `{version, kind: "probe", pid}` record identifies the sole credential process, with no credential-using helper. A successful callback checks the private auth file/ownership again and releases only its own lease. Failure leaves the lease blocked. No case data, pause flag, allowance or repair budget is opened/reset.

Only an operator-chosen **fresh sign-in**, after the failed probe exits, can recover this known dead sole-process owner:

```sh
npm run test:pi-login -- --run --recover
```

Recovery now accepts dead version-2 login **or probe** owners only after ESRCH. Live/reused PIDs, native version-1 owners, pending/unknown records and interrupted recovery still block. No process is signaled by recovery, no store lock is deleted, no uncertain saved token is retried and no case automatically resumes. Do not remove leases blindly. This broadens only the existing explicit fresh-login recovery, not native/helper recovery.

## Verification and stop point

- **32 new tests** cover fixed tool/result semantics, cancellation at both model-admission boundaries, malformed/missing/oversized/late output, credential refusal, bounded launcher frames, synthetic built-in refresh/SSE, denial, hung work, deadlines, SIGINT, cross-process exclusion and actual probe SIGKILL before explicit fresh login.
- Full `npm run verify:all` passes **2,224 Node and 30 Rust tests**, with lint/format/type/syntax/native compilation passing. Rust's existing dependency future-incompatibility notices remain.
- The live command passes once: two model streams, one fixed tool execution, observed text streaming and verified result, captured exit 0. Real refresh and recovery are **not** claimed from this success.

Keep the synthetic native adapters synthetic-only. This probe does not connect real model results to native SQLite, controller admissions/receipts or restricted worker tools, and does not establish live Pause/restart/expiry parity. Those remain a separate scoped integration/acceptance decision. Production dispatch, publication, live remediation and later plan steps remain disabled. Stop after this unit.
