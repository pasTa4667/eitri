# Hosted Sentry prerequisite slice: review and verification

## Scope

From `ed319f8`, the operator selected the existing hosted Sentry solution for M3. This slice records that choice and removes only the now-inapplicable local installer/Bash prerequisite. It does not complete M3, authenticate to Sentry, activate a monitored build, implement intake, or authorize remote mutations/publication. Earlier local-installation evidence remains historical and unchanged.

## Five-axis review

This is the requested author `/skill:review` self-review, not independent-agent or cross-family assurance. The review includes the new tests, implementation and documentation.

| Axis | Result |
| --- | --- |
| Correctness | Only the local Sentry installer probe and its Bash-version logic are removed. Other tool/package checks still fail closed. The report explicitly labels hosted verification `not-checked`; the M3 checklist retains populated-event, synthetic reporting, update and publication gates. |
| Readability | The selected target and superseded prerequisite are explicit in the plan/setup/README. No new mode or configuration layer is introduced. |
| Architecture | The local doctor remains separate from credential-bearing opt-in Sentry commands. Production controller and Sentry library behavior are unchanged. |
| Security | No credential reads, authenticated network requests, new dependencies or permission changes. Tests use a disposable layout and stub every subprocess; exact argv assertions preserve version-only 1Password access, process-local Docker context and read-only Git status. |
| Performance | One subprocess is removed. Remaining time/output bounds are unchanged; no new polling or service calls. |

### Finding and applied feedback

**Suggestion — `scripts/doctor.mjs`, terminal summary:** the saved report marks hosted verification as unchecked, but users reading only terminal output could mistake a successful local doctor for integration readiness. Add the same explicit manual-verification warning to stdout. The new assertion fails before the addition and passes afterward. Also strengthen the regression from program-name checks to complete subprocess argv checks.

No outstanding Critical or Important findings remain. No unrelated code was changed.

## Verification

- Initial RED: `node --test test/doctor.test.mjs` fails because the old doctor attempts the now-forbidden installer-Bash subprocess. Both subprocess tests therefore fail on the original script.
- Initial GREEN: both tests pass after removing that probe; compatible local-tool transcripts exit 0 and an incompatible Rust transcript still exits 1.
- Review RED/GREEN: the stdout-warning assertion fails before its implementation, then both tests pass afterward.
- Final `npm run verify:all` exits 0: **1,839 Node tests and 30 Rust tests pass**, with no failures, cancellations, skips or ignored Rust tests. Includes lint, formatting, TypeScript/syntax checks and native compilation. Existing Rust dependency future-incompatibility notices remain.

Local raw logs: `.audit/hosted-sentry-doctor-{red,green}.txt`, `.audit/hosted-sentry-review-{red,green}.txt`, `.audit/hosted-sentry-verify-all.txt`, and `.audit/hosted-sentry-final-verify-all.txt` (with final exit file). The committed rerunnable check is `test/doctor.test.mjs`.

The command tests execute an exact copy of the doctor script in a temporary synthetic repository layout. They write and inspect actual JSON reports but stub local tool results. They do not verify installed tool versions or hosted permissions. The real checkout's historical `docs/evidence/prerequisites.json` is not overwritten. No live credential/service check, original fixture change, installation, push or deployment occurs in this slice.

## Next boundary

Use the existing opt-in discovery/observation commands with an explicitly selected reviewed 1Password account to verify populated hosted issue/latest-event access. An empty issue list or latest-event 404 cannot establish successful event access. Synthetic hosted reporting and review/assignment mutations remain deliberate operator actions; live remediation stays disabled.
