# Offline built-in OAuth characterization review

## Scope

From clean `737736d`, implement only the next [offline acceptance slice](../../build-plan.md#current-m4-subscription-access-slices): built-in synthetic OAuth failures, cancellation and same-process refresh serialization. `/skill:review` applies the five correctness/readability/architecture/security/performance axes. A fresh-context read-only reviewer supplements the author review; this is not a provider security certification.

**Verdict:** approve this bounded synthetic characterization. The independent re-review confirms the Important finding resolved; no unresolved Critical/Important finding remains within this slice. Final full verification below passes. Tests were run by the author, not independently rerun by the reviewer.

## Findings

- **Important — resolved:** negative-path fixture assertions originally ran inside SDK exception handling. A wrong expected authorization header still passed the `provider-rejected` test because the assertion became the expected error terminal. `test/helpers/pi-auth.mjs:60–69,303–316` now records fixture contract violations independently, checks them after stream settlement outside SDK callbacks, and requires the intended fault to have been delivered. The same header mutation passes before correction and fails afterward; both logs are retained. No production/SDK code is patched.
- **Suggestion — resolved:** the independent review identified missing targets for the new documentation links; this artifact supplies the target.
- **Suggestion — retained gate:** cancellation of an active auth caller precedes rotation persistence. Same-process in-memory serialization does not establish persistent-file locking, independent-client safety, native adapter refresh disposal or abrupt-parent reconciliation. Keep those distinct from this characterization and do not enable real shared-auth use.

## Five axes

- **Correctness:** 12 fixed synthetic SDK scenarios plus unauthorized helper activation. Deterministic barriers distinguish optimistic reads, lock entry, active refresh, caller settlement, persisted rotation and explicit subsequent streams. Missing OAuth/stored API keys, read/write failures, malformed/rejected refreshes and provider rejection/cancellation cannot become success or silently use ambient keys. One terminal is required and the exact request/refresh counts are asserted. Fixture failures are checked independently of SDK error conversion.
- **Readability:** a test-only child with explicit scenario branches and a small independent assertion guard. No general credential interface, new test framework or production abstraction.
- **Architecture:** installed ModelRuntime's actual built-in physical `openai-codex` route remains intact. Inject synthetic in-memory storage/null configuration before construction; no `getAuth`, AgentSession, second loop, production route or dependency change. Existing source verification additionally pins selected relevant auth/SSE artifacts, not the entire installation.
- **Security:** an allowlisted environment/generated empty home precedes SDK import. Deliberate ambient poison keys and synthetic JWT-shaped decoder input only. Mock fetch handles the fixed expected URLs; unexpected URLs fail independently. Only fixed verdicts escape the subprocess, including intentional provider/storage failures and fixture contract errors. Existing wire validation rejects built-in diagnostic bodies. Parent waits for child closure, checks its home is empty and removes only generated test paths. No real network, credentials, sign-in or hosted operation; no OS sandbox/identity-validation claim.
- **Performance:** 10-second child ceiling, 15-second parent SIGKILL ceiling and 4 KiB captured output limit. Fixed short streams, no retries, no production overhead; the focused suite takes about five seconds. Overlapping synthetic auth calls stress one in-memory lock only and do not grant concurrent production inference.

## Verification

- RED: missing helper fails the first targeted test (`.audit/pi-stream-auth/red.txt`). Initial implementation exposes the macOS `/var` versus `/private/var` cwd alias in the test setup; canonicalize the generated root with `realpath`, rather than weakening the environment assertion. Raw initial/diagnosis logs are retained.
- Stale-credential-under-lock mutation fails `serialized-refresh` (`stale-lock-control.txt`); restored byte-for-byte.
- Review false-positive reproduction: wrong expected bearer header incorrectly passes `provider-rejected` before correction (`swallowed-assertion-before.txt`) and fails after independent fixture/fault checks (`swallowed-assertion-after.txt`). Restore the mutation; no diagnostic body leaks.
- Reviewed focused checks: **13 pass**, zero failures/cancellations/skips (`focused-reviewed.txt`).
- Initial full verification was interrupted by the 240-second harness command timeout while existing frozen-browser tests were still progressing, with no recorded failure. It is not a passing full-suite result; retain `verify-timeout.txt` and rerun with sufficient command time after the review correction.
- Independent re-review: the fresh-context reviewer inspects the corrected assertions, restored source and before/after mutation logs; confirms the Important finding resolved and finds no remaining issue within scope. Raw review/re-review outputs are retained under the conversation's subagent artifacts (`4bad7175-331f-4079-82c9-7476a4b9da56`; resumed run `563f998c-99b3-4bb8-acfe-0f6d5abf165e`). Shared-file auth, native refresh disposal and crash/orphan/repair-budget parity remain outside that review.
- Final `npm run verify:all`: exit **0**, **2,115 Node and 30 Rust tests pass**, zero failures/cancellations/skipped Node tests or ignored Rust tests. Lint, formatting, TypeScript/syntax checks and native compilation pass. Existing Rust dependency future-incompatibility warnings remain. Raw log/status: `.audit/pi-stream-auth/verify-all.txt` and `verify-all.exit`. All three selected executable-source hashes match `source-sha256.txt`; **233** local documentation links/anchors pass (`links.txt`) and `git diff --check` is clean. Protected production/dependency paths match HEAD.

Accept only this synthetic built-in SDK slice. Remaining crash/repair-budget boundaries, orphan ownership/reconciliation, real shared-store safety, real controlled tool use and M4 acceptance remain gated. No production source, schemas, operator, workers, original demonstration checkout, dependencies or credentials change. Stop after this slice.
