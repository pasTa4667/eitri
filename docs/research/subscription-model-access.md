# Model access through existing subscriptions

Research checked **2026-10-17 (UTC)**. **Decision accepted:** use the existing OpenAI/ChatGPT subscription through Pi's supported sign-in, including the hosted-inference data boundary. No login, account change, download, or paid API request is authorized during this research session.

## Short answer

**Pi Durable is not local-model-only.** It uses Pi's model-provider layer, which supports hosted OpenAI/Anthropic models, local compatible servers, API keys, and provider-specific OAuth. Model hosting, authentication/billing, and durable execution are separate choices. The ordinary Pi CLI and a custom Durable application are not the same program; existing CLI credentials must not be assumed to appear automatically in our application. [P1]

The user already has Claude and Codex-related subscriptions. The selected OpenAI subscription route removes local inference from the required pilot stack, subject to implementation-time eligibility validation. It does not mean any subscription token is a general-purpose API key or that all requests are unlimited/free.

## Options

| Route | Technical/policy position | Incremental-spend implication |
|---|---|---|
| **OpenAI: Sign in with ChatGPT through Pi's provider** | Current Pi source has the official dynamic client-registration flow and checks the required ChatGPT plan-use grant. OpenAI documents this path for open-source and locally hosted apps, with eligibility and consent requirements. | Eligible requests use the authorized plan allowance/available credits; usage limits still apply. No separate paid API key should be enabled as a fallback. |
| **Claude API with included subscription credits** | Current Anthropic documentation says eligible **Max and Team**, but not Pro, plans can claim monthly Claude API credits. Link the appropriate Console organization and use its API key—not a Claude Code session token. | The documented credit-only route does not require a Platform payment method. Existing purchased credits, auto-reload, or invoice billing can still permit spending after included credits, so account configuration must be checked. |
| **Ollama + `qwen3:4b`** | Previously selected small local learning model; no subscription connection or external inference. | Local resource/maintenance cost, no model-service usage bill. |

**Selected:** the user's existing OpenAI/ChatGPT subscription through Pi's supported Sign in with ChatGPT path. The user accepted hosted inference and sending selected code/context to that provider. This avoids a local model service and leaves more Mac memory for Sentry. Qwen is an optional future local alternative, not a required installation or silent automatic fallback. Select the concrete hosted model after account-specific availability and a successful end-to-end tool-using turn are verified. Strong coding performance is not required for this learning project.

## OpenAI details worth knowing

Pi's pinned OpenAI provider exposes “Sign in with ChatGPT.” Its OAuth implementation uses dynamic registration, a persisted installation identity, the public Responses API resource, and an explicit ChatGPT-plan-use scope. This is not merely a suggestion to copy the Codex CLI's credentials or impersonate its client. [P2]

OpenAI's current documentation explicitly covers **open-source and locally hosted applications**. Eligible plan users must grant inference access separately from identity-only sign-in. User/workspace eligibility, allowed models, granted scopes, and current limits determine access; possessing a Codex-related subscription alone is not an entitlement check for every model/endpoint. [P3]

The documented plan-sharing route has request/tool/streaming restrictions. Pi's actual tool use, streamed completion, cancellation, credential refresh, restart behavior, and usage-limit failures must be validated during implementation. A bundled model catalog is not proof of access. Do not treat a failed/partial stream as a completed model turn. [P4]

For this pilot, use one authorized personal account connection rather than offer a team a shared consumer-token pool. Team-wide use and managed-workspace rules require a later explicit review. Do not assume a later public/paid/remote product has the same permitted integration scope.

## Claude: distinguish SDK support, subscription login, and API credits

Pi technically contains an Anthropic OAuth implementation, but **technical availability does not establish permission for a custom application to reuse Claude subscription credentials**. Anthropic's current policy says developers building applications should use API-key authentication or a supported provider, prohibits intermediating Claude.ai credentials/session tokens, and distinguishes that from an end user signing in to the unmodified official Claude Code binary. We should not plan to copy Claude Code OAuth tokens into our agent. [P1, P5]

The first-party **API credits for subscribers** documentation is a separate legitimate route for a custom agent. It currently lists Max 5x/20x and Team eligibility, explicitly excludes Pro, and describes monthly credits usable on the Claude API after linking a Console organization. A Platform payment method is not required. The user's exact Claude plan is unknown, so do not assume eligibility or an amount. [P6]

When included API credits run out, a credit-only organization stops serving requests. An organization with purchased credit, auto-reload, or invoice billing can continue with additional spend. A “no extra spending” pilot must not rely on a generic budget warning as though it were a hard stop. Do not change billing settings in this research session. [P6]

Running the unmodified official Claude Code binary with the user's own login is another distinct, documented possibility. Making it an agent worker would introduce another harness and a separate recovery/execution boundary; it is not direct Claude model access in Pi Durable and is not recommended merely to avoid choosing one model provider. [P5]

## Privacy, cost, and failure boundaries

- Hosted inference is an **accepted** exception to the original local-inference direction: prompts, selected source code, and selected Sentry evidence are sent to that provider. The local controller, SQLite, UI, and Sentry can still remain on the Mac.
- “Already subscribed” means an existing paid allowance, **not** fully self-hosted inference, unlimited capacity, zero resource cost, or unrestricted automation rights.
- Minimize/redact telemetry before sending it. Do not expose provider credentials to the GPUI client, the test repository, arbitrary test commands, GitHub PRs, or source control.
- The intended spending policy is no additional purchases, no automatic top-ups, and no automatic paid-API fallback. Provider/account settings and actual error behavior need verification before claiming a hard cap.
- Exhausted quota, revoked consent, authentication failure, or a provider outage must leave work blocked/retryable with an explanation, not trigger a new billed route or lose the remediation state.
- Local inference remains an explicit option if hosted data processing or subscription eligibility is unacceptable.

## Sources

- **P1 — Pi model layer, hosted/local providers and provider-owned OAuth:** https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/ai/README.md
- **P2 — Pi OpenAI subscription provider and OAuth implementation:** https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/ai/src/providers/openai.ts and https://github.com/earendil-works/pi/blob/8efd314fa3d3232ce197d8d7a6a5660530b9d83e/packages/ai/src/auth/oauth/openai-chatgpt.ts
- **P3 — OpenAI plan usage for locally hosted/open-source apps:** https://developers.openai.com/siwc/quickstart and https://developers.openai.com/siwc/token-sharing-open-source
- **P4 — OpenAI account-specific inference and preview limitations:** https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference and https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- **P5 — Anthropic authentication/credential policy and official-Claude-Code distinction:** https://code.claude.com/docs/en/legal-and-compliance
- **P6 — Claude Max/Team API credit eligibility, billing, and exhaustion behavior:** https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers

These are source/documentation observations, not confirmation of this user's exact plan entitlements or a tested Durable application connection. No credentials or billing settings were inspected.
