# Five-axis author review

Scope: `scripts/check-sentry-review.mjs`, `test/sentry-review.test.mjs`, the retained hosted evidence and current setup/plan references. This is the requested `/skill:review` by the implementation author, not independent-agent or cross-family review.

## Findings and applied feedback

| Severity | Reference | Finding | Applied feedback |
|---|---|---|---|
| Important | `scripts/check-sentry-review.mjs:8,149–181` | The token's authenticated user is not necessarily an assignable operator. Actual hosted assignment rejects that user as a non-member. | Pin the explicitly operator-selected assignee `5090062`, retain authenticated identity separately, and test differing identities and exact assignment payload/readback. The regression fails before correction; hosted recovery succeeds afterward without scope changes. This defect was exposed at runtime, not credited to static review. |
| Important | `scripts/check-sentry-review.mjs:165–181`; `test/sentry-review.test.mjs:269–277` | Assignment readback checked status/priority/seen but could accept an unexpected change of reviewed substatus. | Add exact post-review/pre-assignment substatus comparison. A targeted regression first accepts the bad state, then fails closed after the fix. |
| Important | `docs/build-plan.md:163` | The old plan says `inbox: true` marks reviewed, conflicting with the observed hosted effect. | Correct the current contract to `inbox: false`, distinguish review from seen, and record the expected `new` to `ongoing` transition without claiming resolution. |
| Suggestion | `scripts/check-sentry-review.mjs:57–61,93,115–127`; evidence verification | A single 15-second total budget is tight for six serial requests; a generic error also hid why assignment failed. | Bound the entire finite instrument at 60 seconds; retain only stage/status and fixed rejection categories. Add fake-clock latency/stall checks. Preserve the original failure without retrospectively asserting its cause. |
| Suggestion | `test/sentry-review.test.mjs:279–308` | Invalid CLI selection and missing write scope need executable boundary checks. | Add five actual subprocess usage checks and four malformed/missing permission cases; no credential reads or hosted calls run in these tests. |

## Final five-axis result

- **Correctness:** Review and assignment are verified independently through fresh issue GETs. Existing assignments and unsuitable states are refused. Correct operator identity is distinct from authentication. Partial failures and final pass remain separate evidence; the instrument never retries automatically. No unresolved Critical or Important finding remains.
- **Readability:** One explicitly opt-in fixed acceptance instrument with a small state projection and bounded request helper. Modes are named and documented; no email-address configuration or generic update surface is introduced.
- **Architecture:** No changes to controller intake, main, HTTP, UI, native stores, workers or dependencies. The existing credential loader and fixed target are reused. Keeping this unwired avoids turning a feasibility check into a production mutation adapter. The private read-only transport in `src/sentry.ts` is not widened into an arbitrary writer merely to share transport code.
- **Security:** Fixed HTTPS origin/issue/project/assignee, redirect refusal, omitted ambient cookies, credential syntax validation, bounded strict response decoding, allowlisted output and fixed errors. The token is never passed to a browser or logged. No new permissions or memberships are granted. Preflight/readback do not provide an atomic concurrency guarantee, and that limit is explicit.
- **Performance:** Two, four or six bounded sequential requests; one finite deadline; no unbounded list, pagination, retries or polling. No performance optimization claim. Deadline and stalled-body/late-response cleanup are exercised with mocked clocks and streams.

Focused verification: **44 passing tests**; actual hosted assignment/readback and final passive inspection pass. Complete `npm run verify:all` exits 0 with **1,888 Node tests and 30 Rust tests** passing, plus lint/format/type/syntax checks and native compilation. No tests are skipped or disabled. The interrupted first attempt and final source hashes are retained in [verification.md](verification.md).
