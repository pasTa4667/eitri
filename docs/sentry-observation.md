# Read-only Sentry observations

`observeSentryIssue` lets a library consumer inspect one selected Sentry issue without admitting it to remediation. It returns a `SentryObservation`, not the controller's `Issue` type. Production main remains synthetic.

## Observe one issue from the CLI

```sh
npm run --silent observe:sentry -- --account <explicit-account> --issue <positive-decimal-id>
```

This opt-in command reads only `op://Eitri/Sentry/password` through `/opt/homebrew/bin/op` with explicit account selection and desktop approval. It loads the token once and observes the selected issue once. It does not poll, write files, admit controller intake, or enable remediation. `npm start` is unchanged.

Supply `--account` and `--issue` exactly once, in either order. Both `--name value` and `--name=value` are accepted. The account must contain 1 to 253 ASCII characters, start with a letter or digit, and otherwise contain only letters, digits, dots, or hyphens. The issue ID must contain 1 to 20 ASCII digits with no leading zero. Unknown options, duplicate options, positional arguments, option terminators, and empty or malformed values fail before credential loading. There is no token flag or target override.

Success exits with code 0, writes one serialized `SentryObservation` JSON line to stdout, and leaves stderr empty. Use `npm run --silent` for machine consumption because npm otherwise prints its own banner. Invalid input exits with code 1 and writes only the following line to stderr:

```text
Usage: npm run observe:sentry -- --account <explicit-account> --issue <positive-decimal-id>
```

Operational failures exit with code 1 and write only `Sentry observation failed.` to stderr. Both failure paths leave stdout empty. The JSON remains operational metadata, not anonymous data. Live observation access remains unverified.

## Library interface

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
node --test test/sentry.test.ts test/sentry-observation.test.ts test/sentry-command.test.ts
```

The library tests use mocked fetch responses and timers. They check literal returned observations, identity binding, request destinations, privacy canaries, limits, deadline sharing, cancellation, late responses, and cleanup. The command tests run the actual script in subprocesses with a test-only preload. They retain the real credential loader and observer, replace subprocess and fetch calls with fail-closed doubles, and capture call records on a separate pipe. No live 1Password or Sentry calls run in these tests.

Prior library verification recorded 196 focused tests and `npm run verify:all` with 1,480 Node tests and 30 Rust tests. Command integration verification passes all 273 focused Sentry tests and `npm run verify:all` with 1,557 Node tests and 30 Rust tests. The command adds 77 subprocess tests. An npm-entry smoke check also confirms invalid input produces exact fixed usage, empty stdout, and exit code 1 without credential access.

Fresh `openai-codex/gpt-6.1-sol` standards and specification/security reviews report no findings on the command integration. Reviewers inspect source only. They do not independently execute tests. Both reviews use the same model family.

They do not establish hosted event-detail permission, populated-response compatibility, or real socket cleanup. A later explicit hosted check remains separate. No environment, repository association, deployed revision, regression flag, escalation flag, fix eligibility, or remediation authority is inferred. There is no controller intake, UI, or event persistence in this unit.
