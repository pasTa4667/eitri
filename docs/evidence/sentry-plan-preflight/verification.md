# Hosted Sentry availability after subscription expiry

## Scope and result

On **2026-11-01**, from clean `16f7a5b`, the operator requests the next planned step, continued live integration where possible, `/skill:review`, and a stop. They report that their Sentry subscription expired and ask whether the expected free plan supports testing. Complete only a read-only hosted-service preflight using existing commands; no new implementation is needed.

**Existing issue and latest-event reads work. Actual billing tier, remaining ingestion quota and fresh-event delivery are unverified.** Do not interpret successful reads as proof of a free-plan downgrade or permission to incur charges.

## Live observations

Using the previously reviewed explicit account `aurumcars.1password.eu`, run each command once:

```sh
npm run --silent check:sentry -- --account aurumcars.1password.eu
npm run --silent observe:sentry -- --account aurumcars.1password.eu --issue 155897738
```

Both exit **0**, with empty stderr. Their normalized stdout is:

```json
{"connected":true,"organization":"pasta-re","projectId":"4512275993002064","sampledIssues":1,"liveRemediation":false}
```

```json
{"source":{"provider":"sentry","organization":"pasta-re","projectId":"4512275993002064","issueId":"155897738"},"classification":{"origin":"sentry","priority":"high","status":"unresolved"},"event":{"kind":"available","eventId":"5520d52f536941658325efeaf4d6d234","occurredAt":"2026-10-24T13:00:29.994Z","evidence":{"reportedExceptionCount":1,"reportedStackFrameCount":0}}}
```

This verifies the existing synthetic issue and one retained latest event, not new ingestion, complete inventory, assignment/review permissions or continued retention beyond the observation date. IDs and timestamps are operational metadata, not anonymous data. Local command outputs are retained under ignored `.audit/sentry-plan-preflight/`; no token or raw issue response is retained.

## Free-plan assessment and remaining checks

The [official pricing page](https://sentry.io/pricing/), checked on the observation date, lists the Developer plan at **$0**, limited to **one user**, with **unlimited projects** and a **30-day lookback**. That is compatible in principle with a small, single-user error-monitoring demonstration. The fetched pricing text does not establish a Developer error-event quota; do not substitute the paid Team plan's quota or an old third-party figure.

The [documented organization-read API](https://docs.sentry.io/api/organizations/retrieve-an-organization/) does not document a subscription-tier or remaining-quota result. No billing endpoint is guessed, billing permission expanded or downgrade inferred. The operator must confirm the actual tier, usable error-event quota and absence of paid overage in [organization subscription settings](https://sentry.io/settings/pasta-re/billing/overview/) before a fresh hosted transmission. If that page redirects, use the organization's Subscription settings in Sentry. No billing change, new event, SDK activation or issue mutation is performed here. Fresh-event testing, if wanted, needs its own bounded authorization.

## Next integration gate

The pending [live native fixture-read acceptance](../../pi-native-read.md) is independent of Sentry. Its previous attempts failed at the **model provider's** `stream-http-429`, before the read tool or fixture upload. A Sentry downgrade cannot clear that limit. No model request is made in this preflight; a confirmed usage-window reset and separately approved bounded attempt remain required. Successful fixture-read acceptance, production dispatch and M4 stay open.

## Verification and five-axis author review (`/skill:review`)

Focused regression command:

```sh
node --test test/sentry.test.ts test/sentry-command.test.ts test/sentry-observation.test.ts test/sentry-context.test.ts test/sentry-context-command.test.ts
```

**319/319 tests pass**, zero failures/skips. The commands above supply actual hosted runtime verification. No behavior changes or new tests; RED/GREEN is not applicable to this documentation-only checkpoint. Full suite/build are not rerun on unchanged executable code. Markdown links, whitespace and documentation-only scope are checked before commit.

- **Correctness:** normalized live results support read availability only; account-tier, quota and ingestion uncertainty remain explicit. No M4 or successful fixture-read claim.
- **Readability:** one checkpoint separates observations, public plan information and remaining gates.
- **Architecture:** existing bounded readers are reused; controller, Pi, workers, dependencies and schemas remain unchanged.
- **Security:** the existing fixed-reference 1Password loader keeps the token in process memory. No credentials, names, issue text or raw remote error bodies enter evidence; no writes or scope expansion.
- **Performance:** one bounded connection GET and one bounded issue/latest-event observation; no polling, pagination or retries are added.

**Verdict:** no Critical or Important finding in this documentation change. This is an author review, not an independent-agent or cross-model audit. Actual account billing/quota and fresh ingestion remain operational gates, not verified successes. Stop after recording this preflight.
