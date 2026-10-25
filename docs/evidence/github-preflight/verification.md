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

## Remaining gate and limits

- The PAT prefix and authenticated reads establish format/read access, not its complete selected-repository list or Contents/PR write grants. Obtain operator confirmation from GitHub's token settings: only this repository, Contents read/write, Pull requests read/write, Metadata read, no extra grants.
- Agree that `master` is the PR base. Do not rename it. Future fixes use independent session-owned fix branches and tested commits.
- No first-push approval is inferred from "ready". The baseline needs no push; any later publication remains separately gated and must refresh remote state.
- M3 remains incomplete pending the operator confirmations. No production dispatch, model inference, hosted telemetry, permission changes, PR creation, merge, deployment, or original-checkout edits occur.

## Review and verification

Five-axis author review, not independent-agent or cross-family assurance: no Critical, Important, or Suggestion findings remain. Correctness distinguishes observed read access from unverified write scope and preserves the unfinished gate. Readability and architecture follow existing setup/work-log evidence conventions without adding a production integration. Security review checks that recorded metadata contains no credentials or arbitrary API content. Performance review notes four bounded requests without polling/retries.

This is an operational setup/documentation slice, not a behavior change: no application tests or builds are rerun and no new test is claimed. Documentation whitespace, linked-path existence, and consistency of the projected evidence with local commit/README identity are checked before committing.
