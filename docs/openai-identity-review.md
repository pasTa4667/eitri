# OpenAI ID-token and identity review

## Outcome

The next M4 **contract review is complete; the live-sign-in gate fails** on Pi AI 1.3.0. OpenAI requires validated identity in this local/public-client flow, not just possession of an access token. Not displaying a profile, accepting occasional browser re-login, or using TLS is not a documented exemption. Keep Pi AI/Pi Durable 1.3.0 pinned and the offline credential integration available; do not implement/enable browser login on this basis.

The next step requires an upstream correction or an explicitly approved SDK change with a supported validation boundary. No candidate version, dependency change, independent OAuth flow or security waiver is selected here. Review completion is **not** M4 acceptance or authorization for sign-in, refresh with real credentials, discovery, inference or production dispatch.

## Official contract

The following public documentation was freshly fetched for this review; no authenticated endpoint or account data was accessed. These are documentation requirements, not verified provider behavior or account entitlement.

| Source | Relevant passage and consequence |
|---|---|
| [OpenAI local-app sign-in, step 4](https://developers.openai.com/siwc/token-sharing-open-source/sign-in#4-validate-the-id-token-and-chatgpt-plan-permission) | “Verify its signature against OpenAI’s published JWKS. Check the issuer, audience against the issued client ID, expiration, and the nonce saved for this attempt.” It also says “Use its validated `sub` as the account identity.” The requirement applies to this public-client plan-use flow, not only website sessions. |
| [Same page, steps 4–5](https://developers.openai.com/siwc/token-sharing-open-source/sign-in#5-store-credentials-in-a-local-file) | “For a returning account, confirm the new ID token’s verified identity matches the selected account before replacing credentials.” Save validated identity, tokens, scopes and expiry; retain the ID token for returning-sign-in hints. `chatgpt.tokens.use.direct` is a separate permission check, not identity validation. |
| [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions) | Keep issued-client registrations associated with validated ID-token identity. “Complete and validate the selected account’s OAuth flow before making it active.” A host ID is “not a token or proof of identity”; email is not a registration/workspace key. |
| [OpenAI signature-validation example](https://developers.openai.com/siwc/website) | Verify the signature using discovery/JWKS, issuer and client audience, required `sub`/`exp`/`iat`, bounded clock tolerance and the original nonce. The local-app guide explicitly references this verification example; the website’s confidential-client/secret/session-cookie flow is **not** imported into Eitri. |
| [OIDC Core §3.1.3.7](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation) | Direct token-endpoint communication permits TLS server validation in place of signature checking, but still requires issuer, audience, expiration and the sent nonce to be checked. That limited alternative neither excuses the pinned SDK’s absence of claim checks nor overrides OpenAI’s explicit JWKS instruction. |

Identity is the verified issuer/subject associated with the issued client registration, not the installation UUID, email, plan scope, access-token contents or a model-list response. Validate a pending sign-in before replacing the active credential. Hints may be expired and are not authentication proof; validate the **new** ID token each time. Do not infer identity by decoding an unverified JWT or by treating a refresh success as a fresh login proof.

## Pinned supported interface

Inspected installed package: `@earendil-works/pi-ai` **1.3.0**, matching `package.json`/lockfile. Paths below are relative to that package unless otherwise stated.

| Location | Observed boundary |
|---|---|
| `dist/auth/oauth/openai-chatgpt.js:153–170` | Code exchange checks only nonempty `id_token` and returns `credentialFromTokenResponse`; no JWT verification or claims survive. Its comment says Pi does not use the token to identify the user. This explains implementation intent, not an exemption from the provider contract. |
| `dist/auth/oauth/openai-chatgpt.js:128–151,192–235` | The returned credential contains access/refresh/expiry/client/scopes only. Login generates and sends a nonce, but never compares it with a token claim. Every login uses dynamic registration. |
| `dist/auth/types.d.ts:198–238` | `LoginOptions` has only `getDeviceId` and `agentName`. The built-in login exposes no token-response validation hook. The extensible `OAuthCredential` type permits metadata in principle; it does not make the discarded ID token available. |
| `dist/models.js:352–400` | `Models.login` receives the already-filtered provider result, persists it through `CredentialStore.modify`, then returns it. A caller validating only after return is too late to protect the active store, and still lacks the ID token. |
| `src/openai-credentials.ts:40–58` (repository) | The offline store deliberately accepts only the current synthetic OAuth shape, not ID tokens or verified issuer/subject metadata. This is not a live identity store. Future reviewed integration must preserve verified identity/client metadata and the retained ID token through refresh. Sign-out retains the identity/client mapping but clears access, refresh and ID tokens; do not silently loosen the store’s allowlist. |

The public `auth_url` notification exposes the authorization URL, so a wrapper can observe the outgoing nonce. It still cannot recover the discarded ID token through the built-in login result or the store. Wrapping `CredentialStore.modify` alone cannot validate missing evidence. Replacing `OAuthAuth.login` would mean supplying the missing protocol implementation, not merely wrapping the supported built-in flow.

Do not intercept global `fetch`, scrape callback/browser state, patch `node_modules`, copy CLI credentials, or trust provider claims without verification as a workaround. The existing probe’s transport replacements remain disposable offline test instrumentation only.

Selected source SHA-256 identities (not an attestation of all transitive dependencies):

```text
4cf9fc758a07ffe4ee022326404b5dcc86767ee4154945c0417c7f95eaecdcc2  dist/auth/oauth/openai-chatgpt.js
5624951d7fa7c436427b28ef6975051b91690e5e6341d84ab89ad3f1e1adc3d8  dist/models.js
88d316378c9fa239ac09be5df410c40b22e405c39a221c9db6fa855649d53366  dist/auth/types.d.ts
```

## Required before the login-wrapper task

An upstream fix or separately approved SDK change must provide validated identity before credential activation, or a supported pre-activation seam carrying the ID token and the bound expected nonce/client/issuer for maintained-library verification. Also account for returning client/identity matching and retained identity/ID-token metadata; a login-only check followed by refresh that drops this metadata is insufficient. Exact API, dependency and storage changes require their own bounded design/approval; this review does not authorize them.

Acceptance must include synthetic valid-token control and rejection of malformed tokens, invalid signatures/algorithms, wrong issuer/audience, expired tokens, missing/mismatched nonce or subject, and returning-account/client mismatches. Rejection, cancellation, verification/key-fetch failure and persistence failure must leave the prior active credential unchanged and return sanitized errors without API-key fallback. Test retained metadata across reopen and rotating-token refresh. These are **future acceptance requirements**, not tests implemented or passed here. Real callback lifecycle/security remains a separate login-wrapper gate.

The already accepted occasional browser re-login does not need an upgrade merely to improve convenience. It does not waive identity validation or authorize overwriting an unknown account’s registration. No upstream issue, SDK patch, upgrade, token/inference request or real login is performed by this review.

## Verification and five-axis author review

This task changes documentation only; no new runtime behavior calls for a RED/GREEN test. Existing characterization and offline credential tests are rerun rather than adding tests that assert prose. The [work log](work-log.md#m4-id-token-and-identity-contract-review) records commands/results. The probe’s expected exit-1 `blocked` result still means a failed live gate, not a failed experiment or a demonstrated exploit against OpenAI.

| Axis | Review result |
|---|---|
| Correctness | Provider-specific requirements and the narrower OIDC TLS alternative are distinguished; installed code/types and synthetic observations support the blocker. Review completion is separate from remediation and M4 acceptance. |
| Readability | One contract record with exact sources, source locations and a bounded next gate; no speculative implementation. |
| Architecture | Reuses the supported SDK boundary analysis; no independent OAuth flow, new dependency, schema change or controller wiring. |
| Security | **Important, unresolved integration blocker:** pinned login cannot satisfy the documented identity contract. No live path is enabled; mock acceptance is not described as real credential acceptance. No new Critical/Important finding in these documentation changes. |
| Performance | No executable changes, new network path, key-fetch loop or runtime cost. JWKS handling remains future work, not an implemented cache. |

This is an author review, not an independent-agent or cross-model security audit. Only public documentation was fetched; no real credential store was opened or hosted authentication/inference exercised.
