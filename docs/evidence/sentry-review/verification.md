# Hosted review and assignment checkpoint

## Scope and verdict

**The M3 review/assignment slice is complete; M3 itself remains incomplete.** Starting from controller commit `f2fa38a`, the operator authorized Sentry reads/writes for this work and supplied assignee user ID **`5090062`**. This is a fixed synthetic acceptance check, not controller intake, automatic triage or live remediation. The GitHub credential/privacy/default-branch and first-push gates remain separate and unperformed.

The existing synthetic profile-name issue **`155897738`**, project **`4512275993002064`** in **`pasta-re`**, is now reviewed and assigned to that user. It remains **High / unresolved**, with **`hasSeen: false`**. No issue/event is created or resent, and no email is sent by the instrument; Sentry may perform its normal assignment notifications/subscriptions. The other synthetic issues are untouched.

## Actual observations and retained failures

[hosted-observations.json](hosted-observations.json) retains the chronological, allowlisted records, including failures rather than replacing them with a green verdict:

1. Initial activation observes `inbox` as an object, substatus `new`, no assignee, and `hasSeen: false`. `PUT {"inbox":false}` succeeds in effect: a fresh GET observes `inbox: null`, substatus `ongoing`, unchanged High/unresolved and unchanged seen state. The following assignment attempt fails. This early instrument did not retain HTTP status or distinguish timeout from rejection; the exact cause of that first failure is not established.
2. A separate read-only reconciliation confirms review persisted and the issue remains unassigned. No mutation is replayed automatically.
3. An explicit assignment-only attempt retains HTTP **400**. A subsequent bounded diagnostic attempt classifies the response as **`non-organization-member`**. The attempted assignee was the token's authenticated user **`5105406`**, incorrectly assumed to be the operator. A separate organization-member lookup returns **403** with the existing token; no scope, membership or permission is broadened.
4. After the operator supplies **`5090062`**, the corrected instrument explicitly separates authenticated identity from assignee. Assignment-only recovery observes the reviewed/unassigned state, sends exactly `PUT {"assignedTo":"user:5090062"}`, receives HTTP **200**, then independently reads the expected user assignment with unchanged priority/status/seen/substatus. It does not repeat review.
5. A final passive invocation of the final instrument again observes reviewed/assigned state, High/unresolved, `ongoing` and `hasSeen: false`, with **zero attempted writes**.

The initial failures, later successful assignment, and final passive observation are separate executions. No successful combined final-source activation is claimed: review was demonstrated by the earlier activation, assignment by the corrected recovery, and the persisted joint state by the final read. The final static-review substatus guard is exercised in tests and its expected state is present in the final hosted inspection; no extra remote write is made for that guard.

## Instrument and limits

```sh
# Passive inspection; reads the fixed credential once, makes two GETs, writes no Sentry state.
node scripts/check-sentry-review.mjs
```

The fixed account is `aurumcars.1password.eu`; only `op://Eitri/Sentry/password` is loaded using the existing bounded credential loader. The token stays in memory. Only IDs, fixed verdicts/stages/error categories, HTTP statuses and selected issue state are printed. No raw response, name, email, title, token or arbitrary error text is retained. These IDs remain operational metadata, not anonymous data.

`--activate` explicitly requests review plus assignment and requires an unreviewed, unassigned issue. `--assign-reviewed` explicitly requests assignment-only recovery and requires an already reviewed, unassigned issue. Both refuse an existing assignment rather than overwriting it. **Do not rerun activation to obtain another green log:** the existing completed state intentionally fails these mutation preconditions. Use passive inspection. Importing the module does not load credentials or contact Sentry.

There are at most six requests in a full activation, four in assignment recovery and two in inspection. A shared **60-second** deadline covers headers and streamed bodies, each body is at most **1 MiB**, UTF-8 is strict, redirects and unexpected response URLs are refused, and caller credentials/cookies are omitted. The initial 15-second total budget was too restrictive for a multi-request instrument; a fake-clock regression demonstrates six three-second responses, without claiming that timeout caused the first hosted failure. Deadline settlement does not wait for stalled cleanup. Known assignment validation messages map only to fixed codes; other diagnostics remain `unclassified`.

There is no automatic retry, polling, membership lookup, invitation, scope change, controller integration, generic update API or new dependency. Attempted writes are recorded before dispatch because a failed response does not prove absence of a remote effect. Failure requires passive reconciliation and deliberate recovery. Reads and writes are not atomic; the instrument cannot protect against a concurrent human change after its preflight or guarantee exactly-once remote effects. Hosted changes and activity/notification history cannot be undone by reverting the source commit. No cleanup or restoration is attempted.

## Verification and review

The focused suite `node --test test/sentry-review.test.mjs` passes **44 tests**, including exact routes/payloads, read-only defaults, target/project identity joins, explicit owner versus token identity, pre-existing assignment preservation, fresh readback requirements, wrong status/priority/seen/substatus, permissions, missing fields, privacy canaries, strict UTF-8/size/URL checks, lost responses, bounded stalled headers/bodies and actual invalid-argument CLI subprocesses. Initial missing-implementation RED, explicit-owner RED and substatus RED failures are retained in `.audit/sentry-review-*.txt`.

The [five-axis author review](review.md) records applied feedback. This is not independent-agent or cross-family assurance. The first full invocation was interrupted by the harness's 300-second command timeout while existing frozen-browser tests were still progressing, with no complete-suite verdict. A subsequent complete `npm run verify:all` exits **0**, passing **1,888 Node tests and 30 Rust tests**, including TypeScript/syntax checks, both linters, formatting and native compilation. There are no failures, cancellations, skipped Node tests or ignored Rust tests. Existing Rust dependency future-incompatibility warnings remain. The complete Node suite takes about 498 seconds; local raw output and exit status are `.audit/sentry-review-complete-verify-all.txt` and `.audit/sentry-review-complete-verify-all.exit`.

Verified final SHA-256 identities (unchanged across full verification):

- `scripts/check-sentry-review.mjs`: `bcb85995a917f1d1024a1aba09dfed6499fbcef42beb92d0ae58c3e2e65fe3fa`
- `test/sentry-review.test.mjs`: `5ca303299d7c7318d2bfa315dff0c7b0e4b929e9e1e81f689d2cc3b98d2766b3`

## Official references

- [Update an issue](https://docs.sentry.io/api/events/update-an-issue/): only submitted attributes change; user/team identifiers and `event:write`/`event:admin` scopes. The documentation's review-flag description is contradicted by the source and actual hosted readback above.
- [Retrieve an issue](https://docs.sentry.io/api/events/retrieve-an-issue/): organization-scoped details and `expand=inbox`.
- [Sentry update_inbox implementation](https://github.com/getsentry/sentry/blob/master/src/sentry/issues/update_inbox.py): false removes from inbox and marks reviewed; unresolved `new` issues can become `ongoing`.
- [Actor validation](https://github.com/getsentry/sentry/blob/master/src/sentry/types/actor.py) and [issue validator](https://github.com/getsentry/sentry/blob/master/src/sentry/api/helpers/group_index/validators/group.py): assignment identity/membership rules. These moving upstream sources explain behavior; no hosted Sentry version pin or source-identical deployment is claimed.
