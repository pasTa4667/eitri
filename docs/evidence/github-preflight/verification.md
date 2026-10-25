# Read-only GitHub preflight

## Scope

Continuation from `b5d051f`. The operator confirms the demonstration repository discovered from its Git remote, reiterates that fix PRs use feature/fix branches, and reports the GitHub token ready after receiving fine-grained PAT setup instructions. This authorizes credential loading and read-only verification, not publication or live remediation.

## Credential acquisition

The proposed `op://Eitri/GitHub/token` read fails before any GitHub request. A bounded item inspection reports only field-presence/format booleans: no `token` field, one nonempty `password` field with fine-grained PAT format. The subsequent fixed-reference read uses `op://Eitri/GitHub/password` in the previously reviewed `aurumcars.1password.eu` account. No value, raw CLI diagnostic, authorization header, or full API payload is printed or retained.

The one-shot Node instrument invokes the installed `/opt/homebrew/bin/op` with only HOME/PATH/USER/TMPDIR inherited, a 60-second subprocess timeout and 16-KiB output limit (64 KiB for item inspection). It keeps the credential in memory; no environment-file, worker or controller credential wiring is added.

## Actual hosted observations

At `2026-10-25T11:51:59.217Z`, four fixed GET requests to `https://api.github.com` return HTTP 200. Redirects are refused, the requests share a 45-second abort signal, each body is capped at one MiB, and only allowlisted metadata survives. API version: `2026-03-10`. Local raw projected evidence: `.audit/github-preflight-read-only.json`.

| Check | Observation |
|---|---|
| Repository | `pasTa4667/eitri-test-web-app`, ID `1423372464` |
| Visibility | `private: true`, `visibility: private` |
| Availability | Not archived; not disabled |
| Default branch | `master`, currently unprotected |
| Default-branch commit | `103db4755657e9a1595120164242a7b9323defcd` |
| README blob at that commit | `f30f0bbb568bbe6880b10eb440360fe95c97eea8` |
| PR-list read | HTTP 200, bounded to one entry; no PR content retained |
| Reported user push permission | `true`; not proof of token write scope |
| Remote writes | Zero |

The read paths are `/repos/pasTa4667/eitri-test-web-app`, `/branches/master`, `/contents/README.md?ref=103db4755657e9a1595120164242a7b9323defcd`, and `/pulls?state=all&per_page=1` under that repository.

Local read-only Git commands independently observe the same origin, a clean `master`, HEAD `103db4755657e9a1595120164242a7b9323defcd`, and the identical README blob. The baseline is already present remotely; this continuation neither pushes it nor claims who published it. There is no reason to push an identical baseline again.

## Gate state at the read-only checkpoint

- The PAT prefix and authenticated reads establish format/read access, not its complete selected-repository list or Contents/PR write grants. Obtain operator confirmation from GitHub's token settings: only this repository, Contents read/write, Pull requests read/write, Metadata read, no extra grants.
- Agree that `master` is the PR base. Do not rename it. Future fixes use independent session-owned fix branches and tested commits.
- No first-push approval is inferred from "ready". The baseline needs no push; any later publication remains separately gated and must refresh remote state.
- M3 remains incomplete pending the operator confirmations. No production dispatch, model inference, hosted telemetry, permission changes, PR creation, merge, deployment, or original-checkout edits occur.

## Review and verification

Five-axis author review, not independent-agent or cross-family assurance: no Critical, Important, or Suggestion findings remain. Correctness distinguishes observed read access from unverified write scope and preserves the unfinished gate. Readability and architecture follow existing setup/work-log evidence conventions without adding a production integration. Security review checks that recorded metadata contains no credentials or arbitrary API content. Performance review notes four bounded requests without polling/retries.

This is an operational setup/documentation slice, not a behavior change: no application tests or builds are rerun and no new test is claimed. Documentation whitespace, linked-path existence, and consistency of the projected evidence with local commit/README identity are checked before committing.

## Operator confirmation and M3 setup acceptance

After checkpoint commit `bcf867e`, the operator answers "yes" to the explicit confirmation that the token selects only this repository with Contents and Pull requests read/write, and that `master` is the base for future fix PRs. This closes the outstanding settings/base questions above; it is operator attestation, not API introspection or a successful write test.

M3 is accepted for hosted integration and credential setup:

| M3 requirement | Evidence |
|---|---|
| Reviewed account/vault and direct token storage | Operator setup confirmations; fixed GitHub and Sentry password references, no values in chat |
| Populated project/issue/latest-event access | [Hosted observations](../hosted-monitored/verification.md) |
| Known-revision synthetic reporting, grouping/native classification, validation exclusion | [Monitored-build checkpoint](../hosted-monitored/verification.md), including retained original failure and corrected verification |
| Permitted review/explicit-owner assignment | [Sentry review checkpoint](../sentry-review/verification.md) |
| GitHub privacy/read access, baseline/README identity | Four actual GETs and independent local Git identity checks above |
| Repository-restricted token grants and agreed PR base | Operator confirmation; token scope remains attested, not independently proven |
| Baseline publication disposition | Exact local commit is already on remote `master`; no push is needed, authorized or performed in this continuation |
| Automation remains disabled | No production source/configuration change; no dispatch or live activation |

Future fixes must use session-owned feature/fix branches, preserve the default branch/README, and satisfy the plan's revision, publication and live-enablement gates. This confirmation does not authorize future remote writes, M4 sign-in/first inference, automatic merge or deployment. No additional credential read or hosted request is made to record it.

The acceptance update receives a five-axis author review with no findings: it preserves the observed-versus-attested distinction, records the existing-baseline no-op without fabricating a push, keeps later authority gates intact, follows existing documentation structure and adds no runtime/performance surface. Local whitespace, link and checklist-consistency checks pass. No application tests/builds are rerun for this documentation-only update.
