# OpenAI ID-token and identity review

## Outcome

The M4 **contract review is complete; the credential-activation gate fails** on Pi AI 1.3.0. OpenAI requires validated identity in this local/public-client flow, not just possession of an access token. Not displaying a profile, accepting occasional browser re-login, or using TLS is not a documented exemption. Keep Pi AI/Pi Durable 1.3.0 pinned.

The operator subsequently approves a narrow [login-only experiment](openai-login-test.md#accepted-decision): receive and discard the SDK result without activating an account, saving returned tokens or performing inference. That exception supersedes the earlier blanket block on any login experiment, not the findings below or the persistent-use gate. Login can succeed despite the validation gap; no live Eitri login failure or exploit is established here.

Persistent sign-in still requires an upstream correction or an explicitly approved SDK change with a supported validation boundary, or a separate operator decision about that scope. No candidate version, dependency change or independent OAuth flow is selected. Review/experiment completion is **not** M4 acceptance or authorization for refresh with real stored credentials, discovery, inference or production dispatch.

The findings below concern the direct `openai` provider flow, not every authentication route offered by Pi. The later [actual-Pi RPC prototype](pi-runtime-prototype.md) passes one synthetic inference using Pi-owned `openai-codex` OAuth after the direct Eitri route is denied for Enterprise. That is a distinct feasibility observation, not remediation of this ID-token gap or approval of an architecture migration.

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

## Required before the persistent login-wrapper task

An upstream fix or separately approved SDK change must provide validated identity before credential activation, or a supported pre-activation seam carrying the ID token and the bound expected nonce/client/issuer for maintained-library verification. Also account for returning client/identity matching and retained identity/ID-token metadata; a login-only check followed by refresh that drops this metadata is insufficient. Exact API, dependency and storage changes require their own bounded design/approval; this review does not authorize them.

Acceptance must include synthetic valid-token control and rejection of malformed tokens, invalid signatures/algorithms, wrong issuer/audience, expired tokens, missing/mismatched nonce or subject, and returning-account/client mismatches. Rejection, cancellation, verification/key-fetch failure and persistence failure must leave the prior active credential unchanged and return sanitized errors without API-key fallback. Test retained metadata across reopen and rotating-token refresh. These are **future acceptance requirements**, not tests implemented or passed here. Real callback lifecycle/security remains a separate login-wrapper gate.

The already accepted occasional browser re-login does not need an upgrade merely to improve convenience. It does not waive identity validation or authorize overwriting an unknown account’s registration. No upstream issue, SDK patch, upgrade, token/inference request or real login is performed by this review.

## Upstream correction investigation

After the contract review, the operator approves **investigation only**, keeping 1.3.0 pinned and live sign-in disabled. Public read-only checks on 2026-10-25 identify no supported correction in the inspected sources. The [evidence record](evidence/openai-oauth/upstream-investigation.json) retains source identities, issue states, search scope and verification limits.

- The npm registry reports **1.4.0** as latest. Its [tagged OAuth source](https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/ai/src/auth/oauth/openai-chatgpt.ts#L183-L222) and [main at `d5b3de22`](https://github.com/earendil-works/pi/blob/d5b3de22d0e24a3e9c38a9410d3329b099717283/packages/ai/src/auth/oauth/openai-chatgpt.ts#L183-L222) are byte-identical. Both still check ID-token presence only, discard it and rebuild refresh credentials without identity metadata. The [main login options](https://github.com/earendil-works/pi/blob/d5b3de22d0e24a3e9c38a9410d3329b099717283/packages/ai/src/auth/types.ts#L205-L218) still expose only installation ID and app name. No validation seam or expected-account/client inputs are added there. The npm artifact itself is not downloaded, installed or executed; tagged-source inspection is not replacement-version certification.
- [Issue #10300](https://github.com/earendil-works/pi/issues/10300) remains open for ID-token retention/account identity. Comments describe local metadata and validation patches, not a merged supported API. Their code and claimed tests are not independently verified here. One [validation proposal](https://github.com/earendil-works/pi/issues/10300#issuecomment-6152358387) explicitly keeps new access/refresh tokens when refresh identity verification is unavailable or its time checks fail. That described policy differs from Eitri's fail-closed acceptance above; adopting it would require a separate design decision, not copying a claimed fix.
- [Issue #11313](https://github.com/earendil-works/pi/issues/11313), **“Verify the ID token in Sign in with ChatGPT,”** requests signature/claim/nonce verification, retained subject, returning-subject checks and refresh verification. It is closed with API reason `not_planned`, but its [sole comment](https://github.com/earendil-works/pi/issues/11313#issuecomment-6359140701) says it was auto-closed by the new-contributor policy. Do not report that as a maintainer's technical rejection or approval. The [contribution policy at the inspected commit](https://github.com/earendil-works/pi/blob/d5b3de22d0e24a3e9c38a9410d3329b099717283/CONTRIBUTING.md#contribution-gate) confirms that distinction and requires maintainer approval before a PR.
- Bounded GitHub PR searches for `JWKS` and `idToken` in titles/bodies identify no correction; the latter returns only historical subscription-auth PR #459. This is not proof that no differently named, private or unindexed fix exists. Fresh OpenAI sign-in/accounts guidance still requires validated identity before activation and retained account/client binding.

**Decision:** retain the pin and the failed live gate. Investigation is complete, **remediation is not**. Prefer following the existing upstream requests rather than submitting a duplicate. Waiting for a reviewed upstream correction, asking maintainers about the existing request, or designing a maintained SDK patch are separate next choices. No contact, public submission, patch, new dependency or change to the storage allowlist is authorized by this investigation. Any candidate still needs the acceptance tests above and separate approval before adoption; do not advance the browser-login task.

This documentation-only continuation adds no runtime behavior, so no new RED/GREEN test is appropriate. The 24 existing OAuth-characterization/private-store tests pass with no failures, cancellations or skips. Full application/native tests and builds are not rerun for this documentation-only investigation; the earlier full verification below remains historical. Local evidence/source-hash, link and whitespace checks cover the new records.

Five-axis **author review**: correctness distinguishes inspected source from package execution and auto-closure from technical rejection; readability keeps the evidence in this existing contract; architecture preserves the supported SDK boundary and pin; security retains the **Important unresolved live-login blocker** and rejects treating unverified patch claims as remediation; performance has no runtime change. No new Critical/Important finding in these documentation changes remains. This is not an independent security audit.

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
