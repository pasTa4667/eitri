# Read-only Sentry observations

`observeSentryIssue` lets a library consumer inspect one selected Sentry issue without admitting it to remediation. It returns a `SentryObservation`, not the controller's `Issue` type. Production main remains synthetic.

## Observe one issue from the CLI

```sh
npm run --silent observe:sentry -- --account <explicit-account> --issue <positive-decimal-id>
```

This opt-in command reads only `op://Eitri/Sentry/password` through `/opt/homebrew/bin/op` with explicit account selection and desktop approval. It loads the token once and observes the selected issue once. It does not poll, write files, admit controller intake, or enable remediation. `npm start` is unchanged.

Add `--reported-context` to include the event's reported environment and release when available. The flag is optional and accepts no value.

```sh
npm run --silent observe:sentry -- --account <explicit-account> --issue <positive-decimal-id> --reported-context
```

Supply `--account` and `--issue` exactly once, in either order. Both `--name value` and `--name=value` are accepted. The account must contain 1 to 253 ASCII characters, start with a letter or digit, and otherwise contain only letters, digits, dots, or hyphens. The issue ID must contain 1 to 20 ASCII digits with no leading zero. Unknown options, duplicate options, positional arguments, option terminators, and empty or malformed values fail before credential loading. There is no token flag or target override.

Success exits with code 0, writes one JSON observation line to stdout, and leaves stderr empty. Use `npm run --silent` for machine consumption because npm otherwise prints its own banner. Invalid input exits with code 1 and writes only the following line to stderr:

```text
Usage: npm run observe:sentry -- --account <explicit-account> --issue <positive-decimal-id>
```

Operational failures exit with code 1 and write only `Sentry observation failed.` to stderr. Both failure paths leave stdout empty. The JSON remains operational metadata, not anonymous data. The separate [hosted checkpoint](evidence/hosted-monitored/verification.md) verifies live access to four synthetic issues and their latest events; it does not establish compatibility with every event shape.

## Library interface

```ts
import { observeSentryIssue } from './src/sentry.ts';

const observation = await observeSentryIssue(token, issueId, { signal });
const contextual = await observeSentryIssue(token, issueId, {
  eventContext: 'reported-environment-release',
  signal,
});
```

The caller supplies an already loaded API token, a positive decimal issue ID of at most 20 digits, and an optional cancellation signal. Set `eventContext` to `'reported-environment-release'` to request context. The default call returns `SentryObservation`; the opt-in call returns `SentryEventContextObservation`. An options variable with an optional mode returns the union of both types. The function does not load credentials, log evidence, write files, poll, or mutate Sentry.

The source is fixed to `https://sentry.io`, organization `pasta-re`, and project `4512275993002064`. Each call performs at most two sequential GETs.

1. Read the selected issue through the [issue-details endpoint](https://docs.sentry.io/api/events/retrieve-an-issue/).
2. After validating issue and project identity, read its latest event through the [issue-event endpoint](https://docs.sentry.io/api/events/retrieve-an-issue-event/).

The function follows no response links, redirects, pagination, or retries. The requests omit ambient credentials and carry only the supplied bearer token and JSON Accept header. An absent or undefined `eventContext` selects the default mode. Any other runtime value except the supported literal rejects before making a request.

## Returned evidence

The result contains these allowlisted fields.

- A source tuple with the Sentry organization, project ID, and selected issue ID.
- Native Sentry priority and status, labeled with their Sentry origin. Missing or unfamiliar bounded strings become `unknown`.
- An available-event variant with `eventID`, a UTC-normalized `dateCreated`, and reported exception and stack-frame counts.
- An unavailable-event variant only when the latest-event endpoint returns HTTP 404.
- In opt-in mode, an available event also contains `context.environment` and `context.release`. Each is either `{ kind: 'reported', value }` or `{ kind: 'not-reported' }`.

In opt-in mode, the parser reads only `tags[].key === 'environment'` and `release.version` from the event body. It ignores top-level environment fields and unrelated release properties. Missing or null `tags` means environment is not-reported. Missing or null `release`, or a missing or null `release.version`, means release is not-reported. A missing environment tag means environment is not-reported. An empty, non-string, or malformed selected value rejects the observation.

The environment grammar is ASCII. It starts with one letter or digit, followed by zero to 63 letters, digits, dots, underscores, or hyphens. The release grammar starts with one letter or digit, followed by zero to 199 letters, digits, dots, underscores, plus signs, at signs, or hyphens. The parser does not trim, coerce, or accept Unicode.

The parser accepts at most 128 tags. Every tag must be an object with a string `key` of at most 200 characters. It rejects non-array tags, malformed tag entries, and every duplicate environment tag, even when duplicate values match. Unrelated tag values are not inspected. `release` must be an object when present and non-null. Other release fields are ignored.

Event identity uses `eventID`, not the separate `id` field. The event must identify the selected issue through `groupID` and the configured project through `projectID`.

An unavailable event means the endpoint returned not-found. It does not prove that the issue never had events. Structural counts describe the returned payload. Zero counts do not establish that no exception occurred. The two reads are not an atomic snapshot.

## Privacy and limits

By default, the function omits all free-text telemetry, including environment, release, and tags. In opt-in mode, it includes only the validated environment tag value and release version. Titles, exception types and values, functions, filenames, source context, users, requests, breadcrumbs, arbitrary contexts, and extras do not enter the result. It makes no attempt to redact arbitrary text into safe diagnostic evidence.

The returned IDs, timestamps, classifications, counts, and opted-in identifiers remain operational metadata. They are not anonymous data. The caller owns any later display or persistence policy.

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

Those automated tests do not establish hosted event-detail permission, populated-response compatibility, or real socket cleanup. The separately approved [hosted checkpoint](evidence/hosted-monitored/verification.md) now establishes the first two for its four synthetic issues only, without a general socket-cleanup guarantee. Reported environment and release are bounded metadata from the returned event. They do not prove a deployed revision, repository association, fix eligibility, or admission to remediation. The observation also infers no regression or escalation status. There is no controller intake, UI, or event persistence in this unit.
