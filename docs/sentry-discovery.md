# Discover Sentry issue IDs

Run the opt-in command with an explicit 1Password account:

```sh
npm run --silent list:sentry -- --account <explicit-account>
```

Select an `issueId` from `items`, then run the [observation command](sentry-observation.md):

```sh
npm run --silent observe:sentry -- --account <explicit-account> --issue <selected-id>
```

The discovery command accepts exactly one account, including `--account=<explicit-account>`. It validates arguments before loading `op://Eitri/Sentry/password`. Success prints one metadata-only JSON line. Invalid arguments print usage. Operational failures print only `Sentry discovery failed.` to stderr and exit 1 with empty stdout.

`listSentryIssues(token, { signal }?)` in `src/sentry.ts` returns a `SentryIssuePage`. Its source is Sentry organization `pasta-re`, project `4512275993002064`. Its literal scope is `coverage: 'single-page-only'`, `statsPeriod: '14d'`, `query: ''`, `sort: 'date'`, and `maxResults: 25`. Items preserve response order and contain only validated issue IDs and native priority/status classification. Missing or unfamiliar bounded classifications become `unknown`.

The operation makes one fixed GET to the organization's issues endpoint. The empty query includes all statuses. It follows no redirects, pagination, links, or retries. Empty and full pages both remain single-page-only. The response body is limited to 1 MiB, the normalized result to 8192 bytes, and the complete operation to 15 seconds. Cancellation and failures discard private details.

Issue IDs and classifications are operational metadata, not anonymous data. Discovery does not establish inventory completeness, project existence from an empty page, controller admission, regression, escalation, or remediation authority. The separate [hosted checkpoint](evidence/hosted-monitored/verification.md) verifies discovery of four synthetic hosted issues; it does not establish inventory completeness or compatibility with every response shape. The command's automated tests use offline doubles and actual CLI subprocesses without credentials or live services. Real socket-cleanup guarantees remain unverified.
