# Read-only Sentry observations

`observeSentryIssue` lets a library consumer inspect one selected Sentry issue without admitting it to remediation. It returns a `SentryObservation`, not the controller's `Issue` type. Production main remains synthetic.

## Interface

```ts
import { observeSentryIssue } from './src/sentry.ts';

const observation = await observeSentryIssue(token, issueId, { signal });
```

The caller supplies an already loaded API token, a positive decimal issue ID of at most 20 digits, and an optional cancellation signal. The function does not load credentials, log evidence, write files, poll, or mutate Sentry.

The source is fixed to `https://sentry.io`, organization `pasta-re`, and project `4512275993002064`. Each call performs at most two sequential GETs.

1. Read the selected issue through the [issue-details endpoint](https://docs.sentry.io/api/events/retrieve-an-issue/).
2. After validating issue and project identity, read its latest event through the [issue-event endpoint](https://docs.sentry.io/api/events/retrieve-an-issue-event/).

The function follows no response links, redirects, pagination, or retries. The requests omit ambient credentials and carry only the supplied bearer token and JSON Accept header.

## Returned evidence

The result contains these allowlisted fields.

- A source tuple with the Sentry organization, project ID, and selected issue ID.
- Native Sentry priority and status, labeled with their Sentry origin. Missing or unfamiliar bounded strings become `unknown`.
- An available-event variant with `eventID`, a UTC-normalized `dateCreated`, and reported exception and stack-frame counts.
- An unavailable-event variant only when the latest-event endpoint returns HTTP 404.

Event identity uses `eventID`, not the separate `id` field. The event must identify the selected issue through `groupID` and the configured project through `projectID`.

An unavailable event means the endpoint returned not-found. It does not prove that the issue never had events. Structural counts describe the returned payload. Zero counts do not establish that no exception occurred. The two reads are not an atomic snapshot.

## Privacy and limits

The function omits all free-text telemetry. Titles, exception types and values, functions, filenames, source context, environment, release, tags, users, requests, breadcrumbs, arbitrary contexts, and extras do not enter the result. It makes no attempt to redact arbitrary text into safe diagnostic evidence.

The returned IDs, timestamps, classifications, and counts remain operational metadata. They are not anonymous data. The caller owns any later display or persistence policy.

One 15-second deadline covers both requests and streamed bodies. Each body is limited to 1 MiB. The parser accepts at most 32 event entries, eight reported exceptions, 128 frames per stacktrace, and 1,024 total frames. The normalized JSON result is limited to 2,048 UTF-8 bytes. Exceeded limits reject instead of returning silently truncated evidence.

The function validates selection and credential syntax before requesting data. It checks remote identities, timestamps, selected structures, UTF-8, response status, and the exact response URL. Cancellation or failure aborts active requests and cancels unread bodies. Settlement does not wait for stalled cleanup. Timers and caller listeners are removed after completion.

All failures reject with a fresh `Error('Sentry observation failed.')`. Original errors, causes, response bodies, and remote error details do not escape. Authorization failures, malformed successful responses, cancellation, and timeouts never become event absence.

## Verification and limits

Run the focused boundary tests.

```sh
node --test test/sentry.test.ts test/sentry-observation.test.ts
```

These tests use mocked fetch responses and timers. They check literal returned observations, identity binding, request destinations, privacy canaries, limits, deadline sharing, cancellation, late responses, and cleanup.

Parent verification passes all 196 focused tests and `npm run verify:all` with 1,480 Node tests and 30 Rust tests. Fresh `openai-codex/gpt-6.1-sol` standards and specification/security reviews report no findings. Reviewers inspect source only. They do not independently execute tests. Both reviews use the same model family.

They do not establish hosted event-detail permission, populated-response compatibility, or real socket cleanup. A later explicit hosted check remains separate. No environment, repository association, deployed revision, regression flag, escalation flag, fix eligibility, or remediation authority is inferred. There is no controller intake, UI, new command, or event persistence in this unit.
