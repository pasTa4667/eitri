# OpenAI OAuth compatibility prerequisite

## Current decision

**M4 is blocked before application login implementation.** The documented OpenAI route is suitable for considering a locally hosted app, but the pinned Pi AI 1.3.0 login implementation does not meet the current registration and ID-token contract. Stop for a dependency/design decision; do not weaken the contract, copy Pi/Codex CLI credentials, impersonate Pi, or implement an independent OAuth protocol to conceal the mismatch.

Eitri would use Pi as a library, not as an authentication or inference proxy. Eitri must introduce itself as **Eitri**, maintain its own stable host identity and private credentials, and obtain its own OpenAI registration and consent. A successful Pi CLI login is not evidence that Eitri is authorized or that its account has inference entitlement.

OpenAI documents dynamic registration for open-source and locally hosted apps without a client secret or partner API key. Paid/remotely hosted apps have a separate participation process. Identity sign-in alone does not authorize ChatGPT plan usage. Eligibility and limits remain account-specific.

## Rerunnable offline reproduction

```sh
npm run --silent probe:openai-oauth
node --test test/openai-oauth-compatibility.test.mjs
```

The probe deliberately returns **exit 1** with `verdict: blocked` for the current SDK. Exit 2 with `probe-error` means the experiment failed; it is not evidence of a specific SDK gap. The regression tests pass when they observe those distinct outcomes. Passing tests do **not** mean M4 is accepted. Changed SDK behavior requires fresh review rather than preserving these negative observations as desired product behavior.

The disposable process invokes the real public `Models.login`, provider and refresh implementation with an in-memory credential store. Before dynamically loading Pi, it replaces `fetch` and the HTTP callback-listener factory with synthetic transports. Manual callback input is generated internally. It opens no browser or socket, reads no existing credential store, sends no hosted request, and performs no inference. Authentication environment resolution is disabled for the model collection. No user credentials are needed. All token responses, authorization callbacks and host identifiers are synthetic.

Only booleans, gap identifiers and selected installed-source hashes leave the process. Authorization URLs, PKCE material, tokens and raw errors are omitted. Transport replacements are restored on exit and must never be imported into the controller. This is trusted dependency characterization, not a sandbox against malicious dependencies or a substitute for real callback/HTTP testing.

[Recorded observations](evidence/openai-oauth/observations.json) identify the installed package and hash its OAuth and Models JavaScript files; they do not attest every imported file or the entire dependency tree.

| Contract | Observed Pi AI 1.3.0 behavior | Result |
|---|---|---|
| Actual app name and stable host identifier | Two sign-ins use the supplied `Eitri` name and the same synthetic host ID | Supported in this probe |
| PKCE and initial issued client | Challenge matches the exchange verifier; exchange uses callback-issued client ID | Supported in this probe |
| Returning sign-in | Second `Models.login` uses `dynamic_agent_client` again despite the first credential being saved | **Blocked** |
| ID-token validation | A nonempty string that is not even a JWT is accepted and persisted as an OAuth credential | **Blocked** |
| ID-token retention | Returned credential omits the ID token required for returning-sign-in hints | **Blocked** |
| OAuth state | Wrong state rejects with the specific mismatch error before token exchange | Supported in this probe |
| Plan-use grant | Missing `chatgpt.tokens.use.direct` rejects with the specific scope error; stored credential remains unchanged | Supported in this probe |
| Refresh | Uses saved issued client ID and replaces access/refresh tokens and expiry in the in-memory store | Supported in this probe |

The malformed-token observation establishes missing ID-token validation, not an exploit demonstrated against OpenAI's real authenticated token endpoint. It does not separately exercise every signature, issuer, audience, expiration, nonce or account-switch case. In the inspected source, login only checks ID-token presence, drops the value, and exposes no returning-registration option. `LoginOptions` supplies only app name and device ID. Refresh correctly reuses the issued client ID; **refresh and browser reauthorization are different operations**.

## Documented contract and sources

Official pages were freshly retrieved during this checkpoint:

- [Overview](https://developers.openai.com/siwc/token-sharing-open-source): the local/open-source route, user consent, stable host identity and issued client registration. Paid/remote apps require a separate participation process.
- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in): actual app name on initial registration; saved issued `client_id` on reauthorization; ID-token signature/JWKS, issuer, audience, expiration and nonce validation; plan-use grant; retained validated identity and ID token. A returning callback may omit `client_id`; an unexpected replacement must be refused.
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions): keep account/client associations separate, serialize rotating-token refresh, retain registration/host identity across sign-out, and distinguish local sign-out from confirmed remote revocation.
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference): account-specific model discovery; public Responses API rather than ChatGPT backend endpoints; `store: false`, `stream: true`; success requires the terminal completion event.
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations): request/tool restrictions still apply when using an SDK.

These are documentation observations, not a guarantee of policy eligibility or demonstrated account access. No application registration or consent was created in this step.

## Next decision and remaining gates

Prefer a reviewed upstream Pi fix or a separately approved, verified SDK upgrade that addresses returning registration and validated identity retention. No candidate version is claimed to solve these gaps yet. The prior [SDK approval](sdk-review.md) covers selected M0 files, not OAuth compatibility; it does not waive these requirements. No dependency or lockfile is changed here.

After that decision, implement only the opt-in application wrapper and private, atomic credential persistence (0700 directory/0600 file outside Git/case stores), with serialized refresh, cancellation, redacted failures and an OAuth-only provider policy. Do not silently fall back to an environment API key. Account-specific discovery and the first genuine streamed tool-using turn remain separately approved live checks. Durable-controller dispatch, provider login, real callback handling, cross-process persistence/refresh, revocation, cancellation and entitlement are **not** verified by this probe. No production login command is exposed.

## Verification and review

The new subprocess regression first fails because the probe does not exist, then passes after implementation. A failure-injection test initially omits forwarding its preload argument in the test helper; that test-harness error is corrected. Final focused checks exercise the known blocked SDK observations and sanitized probe-failure output. The initial formatting check reports formatting differences; targeted formatting corrects them without suppressions.

Five-axis author review distinguishes characterization from certification, checks the exact state/scope failure causes rather than accepting any rejection, and confirms that transport replacement stays outside production. No independent-agent or cross-model review is claimed. Full-suite verification is recorded in the [work log](work-log.md#openai-oauth-m4-compatibility-prerequisite).
