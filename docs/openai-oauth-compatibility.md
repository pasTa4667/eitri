# OpenAI OAuth compatibility prerequisite

## Current decision

**Keep Pi AI/Pi Durable 1.3.0 pinned.** The [offline credential-storage and refresh slice](openai-credentials.md) is implemented and verified with synthetic credentials only; no SDK upgrade was needed. The [completed ID-token/identity review](openai-identity-review.md) confirms a credential-activation gap: OpenAI requires validation that the pinned built-in login cannot supply through its supported interface. M4 acceptance and persistent sign-in remain gated. The operator now approves a separate [discard-only login experiment](openai-login-test.md), without remediation or activation of returned credentials. This bounded diagnostic exception does not certify identity validation or authorize persistent use/inference.

The operator accepts occasional explicit browser re-login. Automatic refresh and browser reauthorization are different operations: the probe observes correct issued-client reuse during refresh, while the repeat-registration mismatch affects a new browser sign-in. It does not show that Pi requires daily login. The dropped ID token affects returning-sign-in hints/identity handling, not the observed refresh operation. Do not infer a specific refresh lifetime or this account's behavior from the synthetic test.

The malformed-ID-token test supplies a mocked token-endpoint response. It demonstrates missing validation in the SDK, not acceptance of fake credentials by OpenAI, a failed real login, or an exploit against the authenticated endpoint. OpenAI's documented validation requirement remains unresolved before credential activation; the approved experiment discards the result. Do not weaken that requirement, copy Pi/Codex CLI credentials, impersonate Pi, or implement an independent OAuth protocol to conceal the mismatch.

Eitri would use Pi as a library, not as an authentication or inference proxy. Eitri must introduce itself as **Eitri**, maintain its own stable host identity and private credentials, and obtain its own OpenAI registration and consent. A successful Pi CLI login is not evidence that Eitri is authorized or that its account has inference entitlement.

OpenAI documents dynamic registration for open-source and locally hosted apps without a client secret or partner API key. Paid/remotely hosted apps have a separate participation process. Identity sign-in alone does not authorize ChatGPT plan usage. Eligibility and limits remain account-specific.

## Rerunnable offline reproduction

```sh
npm run --silent probe:openai-oauth
node --test test/openai-oauth-compatibility.test.mjs
```

The probe deliberately returns **exit 1** with `verdict: blocked` for the current SDK. Its three gap identifiers retain the original characterization; that diagnostic does not forbid the offline work authorized above. Exit 2 with `probe-error` means the experiment failed; it is not evidence of a specific SDK gap. The regression tests pass when they observe those distinct outcomes. Passing tests do **not** mean M4 is accepted. Changed SDK behavior requires fresh review rather than preserving these negative observations as desired product behavior.

The disposable process invokes the real public `Models.login`, provider and refresh implementation with an in-memory credential store. Before dynamically loading Pi, it replaces `fetch` and the HTTP callback-listener factory with synthetic transports. Manual callback input is generated internally. It opens no browser or socket, reads no existing credential store, sends no hosted request, and performs no inference. Authentication environment resolution is disabled for the model collection. No user credentials are needed. All token responses, authorization callbacks and host identifiers are synthetic.

Only booleans, gap identifiers and selected installed-source hashes leave the process. Authorization URLs, PKCE material, tokens and raw errors are omitted. Transport replacements are restored on exit and must never be imported into the controller. This is trusted dependency characterization, not a sandbox against malicious dependencies or a substitute for real callback/HTTP testing.

[Recorded observations](evidence/openai-oauth/observations.json) identify the installed package and hash its OAuth and Models JavaScript files; they do not attest every imported file or the entire dependency tree.

| Contract | Observed Pi AI 1.3.0 behavior | Result |
|---|---|---|
| Actual app name and stable host identifier | Two sign-ins use the supplied `Eitri` name and the same synthetic host ID | Supported in this probe |
| PKCE and initial issued client | Challenge matches the exchange verifier; exchange uses callback-issued client ID | Supported in this probe |
| Returning sign-in | Second `Models.login` uses `dynamic_agent_client` again despite the first credential being saved | Documented mismatch on browser reauthorization; not an automatic-refresh failure |
| ID-token validation | A nonempty string that is not even a JWT is accepted and persisted as an OAuth credential | **Unresolved before credential activation** |
| ID-token retention | Returned credential omits the ID token used for returning-sign-in hints | Returning-sign-in/identity handling gap; not evidence that refresh fails |
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

## Next session: implement the offline credential slice

This handoff's offline slice is now **complete**; the heading is retained for existing links. The [implementation, verification and author review](openai-credentials.md) use the supported `CredentialStore`/`Models` APIs, not a new OAuth protocol. The original slice requirements were:

1. Implement application-owned private credential persistence: 0700 directory and 0600 file outside repositories, case stores and worker mounts; atomic writes; serialized mutations/refresh; preserve the issued client ID and stable installation identity across reopen.
2. Use synthetic credentials and mocked token responses to test persistence/reopen, rotating-token refresh, cancellation and fail-closed storage/auth errors. Reuse Pi's refresh implementation. Never read another application's real credential store.
3. Enforce the selected OpenAI OAuth-only boundary with tests: an absent/invalid OAuth credential or failed refresh must not fall back to ambient API keys, another provider or another billing route. Do not expose credentials through model messages, case data, GPUI or logs.
4. Run the applicable focused checks, full repository verification and review. Keep production login/inference dispatch disabled. This slice does not require a browser or live provider request.

The subsequent [identity-contract review](openai-identity-review.md) is complete: validation is required, and the pinned built-in flow offers no supported way to recover and validate the discarded ID token before activation. The operator approves an intervening [login-only experiment](openai-login-test.md) on unchanged 1.3.0: no activation, persistence of returned tokens or inference. An upstream correction or separately approved SDK change remains the remediation path for persistent login; no compatible upgrade is identified or authorized. The prior [SDK approval](sdk-review.md) covers selected M0 files, not full OAuth compatibility.

The experiment is a terminal command, not a production login wrapper or operator feature. Persistent use, account-specific discovery and the first genuine streamed tool-using turn remain separate decision/approval gates. Actual provider login, real callback handling, remote revocation and entitlement are **not** verified by the synthetic probe or implementation tests. No production login command is exposed.

## Verification and review

The new subprocess regression first fails because the probe does not exist, then passes after implementation. A failure-injection test initially omits forwarding its preload argument in the test helper; that test-harness error is corrected. Final focused checks exercise the known blocked SDK observations and sanitized probe-failure output. The initial formatting check reports formatting differences; targeted formatting corrects them without suppressions.

Five-axis author review distinguishes characterization from certification, checks the exact state/scope failure causes rather than accepting any rejection, and confirms that transport replacement stays outside production. No independent-agent or cross-model review is claimed. Full-suite verification is recorded in the [work log](work-log.md#openai-oauth-m4-compatibility-prerequisite).
