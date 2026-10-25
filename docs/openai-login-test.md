# OpenAI login-only experiment

## Accepted decision

The operator approves a **manual, opt-in token-exchange experiment on Pi AI/Pi Durable 1.3.0**, without waiting for an upstream identity-validation correction. Occasional browser reauthentication remains acceptable. A successful login exchange and complete ID-token validation are different properties; the SDK gap does not demonstrate that login fails or that OpenAI accepts fake credentials.

This supersedes the earlier blanket prohibition on implementing any browser-login experiment, **not** the [identity-validation findings](openai-identity-review.md). The narrow exception permits receiving and discarding a credential, never activating an account, persisting the returned tokens or using them for a request. It is not a provider-policy exemption, proof of safety from local/private use, general security waiver, M4 acceptance or approval for inference. Persistent sign-in and everyday use require a separate decision. No SDK patch, upgrade or independent OAuth implementation is selected.

This decision is recorded here rather than in a new ADR: it is a reversible diagnostic boundary, not a new production authentication architecture.

## Observed outcome and revised direction

The operator reports browser rejection `3p_delegated_access_policy_denied`: OpenAI says this OSS sign-in is unavailable for the selected Enterprise workspace. The terminal JSON verdict was not supplied, so successful exchange is not inferred. This denial is independent of ID-token validation. The direct route is **parked**, not retried automatically. The [actual-Pi prototype](pi-runtime-prototype.md) is the subsequent approved experiment; it uses a genuine Pi process and Pi-owned authentication rather than importing credentials into this test.

## Run manually on this Mac

From the repository, in an ordinary interactive terminal:

```sh
npm run --silent test:openai-login -- --run
```

The command opens the system browser at OpenAI. Sign in and approve **Eitri**, not Pi. You do not generate, paste or copy any token. Read the terminal result when the browser returns. The pinned SDK's browser success page confirms callback receipt **before** token exchange, so it is not the final result. If the browser cannot return automatically, cancel rather than pasting its callback URL. Manual callback entry is deliberately unavailable.

Without `--run`, or with `--help`, the command prints help and does not open storage, a listener or a browser. Unknown/duplicate arguments fail without echoing their contents. `--run` requires macOS and terminal stdin/stdout; redirected/noninteractive execution is refused. A nondefault `PI_OAUTH_CALLBACK_HOST` is refused before loading OAuth, preserving `127.0.0.1:1455`. If that port is busy, stop the other pending login yourself and retry deliberately; this command does not terminate other processes.

The final JSON uses only fixed status fields. Exit 0 / `token-exchange-succeeded` means **the pinned SDK completed its token exchange** and accepted its existing token-shape/plan-scope checks. It does not mean that ID-token signature/claims/nonce were verified, an account became active, a model was discovered, or inference entitlement was proved. Exit 1 with `failed`, `cancelled` or `timed-out` is not evidence of a particular account/plan problem; provider error bodies are intentionally hidden. Do not paste authorization/callback URLs, codes or tokens into chat or diagnostics.

## Data and lifetime boundaries

- [`scripts/test-openai-login.mjs`](../scripts/test-openai-login.mjs) invokes the public provider-owned `OAuthAuth.login` directly. It never invokes `Models.login`, which would write returned credentials. No refresh, discovery, model request, API-key resolution, alternate-provider route or production dispatch is called.
- The [existing private Eitri store](openai-credentials.md) supplies only Eitri's app name and stable installation UUID, and is closed before OAuth begins. First use may create `~/.eitri-oauth/credentials.sqlite` with an empty credential state and its 0700/0600 protections. Reading its state may load previously saved Eitri credentials into this process, but they are not used, refreshed, replaced or deleted. No Pi/Codex CLI credentials or 1Password items are read. There is no second installation-identity store or schema change.
- Returned credentials are not retained in a store, printed, exposed to GPUI or used for inference. The result is discarded and the disposable process exits. This is process-lifetime disposal, **not guaranteed memory zeroization** or forensic erasure from OS dumps/backups. The browser necessarily handles the authorization URL; no promise is made about browser history or provider records.
- Browser launching uses fixed `/usr/bin/open`, argument-array execution without a shell, a ten-second child deadline and an allowlisted environment excluding provider/vault secrets. Only the exact OpenAI authorization origin/path and Eitri host/name/loopback URI are accepted. SDK notifications and raw errors are not printed; notification failures abort instead of throwing before the SDK establishes its cleanup.
- Ctrl+C/SIGTERM and the five-minute overall deadline abort the attempt. Cooperative SDK cleanup gets an event-loop turn; then the process exits, bounding even an uncooperative dependency and closing remaining process-owned sockets. This does not close the system browser or retract an already completed remote authorization. No retry is automatic.

**Remote effects are not undone by discarding local tokens or reverting this code.** Registration/consent may leave an Eitri authorization in ChatGPT. The pinned SDK uses dynamic registration on every new login; repeated experiments may create additional registrations even though the host UUID is stable. Remote revocation is not attempted. Disconnect the experiment's Eitri authorization in ChatGPT Settings afterward; do not remove unrelated app authorizations. A late browser completion after local cancellation may also leave remote state. If uncertain, inspect ChatGPT Settings rather than assuming cancellation revoked access.

## Verification and review

The regression suite runs the real pinned SDK with **synthetic browser, callback-server and token transports** in disposable subprocesses and real temporary Eitri SQLite stores. It exercises default/invalid-argument refusal, TTY/platform/host refusal, Eitri/host/state/PKCE forwarding, SDK exchange, malformed/rejected/network/scope failures, busy port, cancellation/deadline, hung-fetch process termination and cooperative callback cleanup. It proves the returned token canaries are absent from the newly initialized database and prior credentials/database bytes remain unchanged on success and failure. Fake transports do not certify real browser/socket behavior, hosted login, remote revocation or entitlement.

```sh
node --test test/openai-login.test.mjs test/openai-oauth-compatibility.test.mjs test/openai-credentials.test.ts
npm run verify:all
```

RED first fails because the command is absent. Further adversarial tests expose immediate process exit preempting cooperative SDK cleanup; one event-loop turn before exit fixes it. An initial accelerated deadline also fires during module loading rather than at the intended hung-fetch stage; deterministic test instrumentation corrects that harness error. The uncooperative-fetch case deliberately cannot reach SDK cleanup and verifies bounded process termination instead, not a fabricated cleanup receipt. Results are in the [work log](work-log.md#m4-opt-in-login-only-experiment).

Five-axis **author review**, not independent-agent or cross-model assurance:

| Axis | Finding and disposition |
|---|---|
| Correctness | `scripts/test-openai-login.mjs:49–135`: await the actual SDK exchange, not the browser callback page; discard the result. **Important, fixed:** cancellation originally exited before cooperative cleanup; the failing regressions now pass. |
| Readability | One disposable command, one existing identity store and fixed status output; no auth framework or future-use abstraction. |
| Architecture | `scripts/test-openai-login.mjs:54–70`: reuse supported store identity and provider-owned OAuth without `Models.login`, schema changes, operator wiring or SDK changes. |
| Security | `scripts/test-openai-login.mjs:19–37,76–111`: explicit activation, local callback, fixed browser destination, sanitized child environment/errors and no token activation/persistence. **Important, unresolved SDK limitation:** ID-token identity validation remains absent; accepted only for this discard-only experiment, not persistent use/inference. |
| Performance | `scripts/test-openai-login.mjs:44–47,96–108,125–135`: five-minute attempt, ten-second opener and bounded process exit; no daemon, polling or extra model activity. |

No new unresolved Critical/Important implementation finding remains within this diagnostic contract. Actual hosted login is **not run during implementation**. The separately approved user invocation above is the next observation, not an automatically completed acceptance gate. The operator UI and `npm start` remain scripted.
