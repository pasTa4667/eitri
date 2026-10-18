---
status: accepted
---

# Keep the pilot local-first without new service spending

The pilot is a private tool, at most for one team, running its controller, native UI, SQLite state, and self-hosted Sentry on the existing Mac. The controller uses Node and SQLite rather than celld. We accept local setup and maintenance instead of managed remediation/execution services; Seer remains a comparison only. Cloudflare is a future possibility, not a pilot dependency or a promised zero-effort migration.

GitHub hosts the private demonstration repository and PRs, and inference uses the user's existing OpenAI/ChatGPT subscription through Pi's supported sign-in. These are explicit external-hosting/data-processing exceptions, so this is not fully self-hosted or air-gapped. Reusing the subscription avoids another local model service and leaves resources for Sentry, at the cost of provider/network dependence and sending selected code/context to OpenAI. No additional purchases, automatic top-ups, or paid-API fallback are authorized; eligibility, quotas, and billing behavior must be validated during implementation. See [subscription model research](../research/subscription-model-access.md).

During implementation design, the user also selected learning credential storage with an existing 1Password account. This adds encrypted hosted credential storage as an exception, without a new subscription. It does not authorize creating a vault in an unchecked account or sharing with colleagues/groups: account and inherited access must be reviewed before setup, and sharing is not part of the pilot. Credential scope and runtime authorization remain in the [implementation design](../implementation-plan.md#1password-learning-direction-and-credential-options).
