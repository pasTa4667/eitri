# Validator harness review

**PASS**

Reviewed `09dd3372ca5c9966c47800b89cadcb4fc42b3ac7..8fe2b81a0dd2b48f3c25a165ac56e571f7baed91`.

## Method

Read the supplied exact range patch and current source. Confirmed HEAD through the worktree branch reference and supplied HEAD artifact. Compared implementation against the security findings, retention synthesis, and judge.

The reviewed data shapes are fixture-local cleanup callbacks, purpose-bound auxiliary containers, and an explicit observed-running witness.

Read-only review. No edits, shell commands, Docker, external access, or subagents.

Throughput checkpoint. Not applicable to this read-only investigation.

## Review

- **Correct.** Fixture roots are retained unconditionally and printed before fallible setup. Root deletion and `retainState()` are gone. The single finalizer attempts every registered callback independently and aggregates failures afterward. See `test/integration/frozen-browser.test.ts:49-78,107-110`.
- **Correct.** Acquired workspace and validator handles receive immediate cleanup registration. Reopened handles use the same finalizer. A failing close cannot suppress subsequent callbacks. See `test/integration/frozen-browser.test.ts:543-551,635-644,665-670,699-704,749-755,842-851`.
- **Correct.** All three crash-helper paths register kill-and-await cleanup before waiting for readiness. Their close promises are observed immediately and reused on the normal path. See `test/integration/frozen-browser.test.ts:519-528,610-634,809-818`.
- **Correct.** Auxiliary cleanup is registered and its unique name printed before create. Purpose determines both name prefix and expected label. Removal requires exact name, immutable image, inspected ID, expected label, and acquired-ID agreement when available. Removal uses only that immutable ID, without force. Successful bounded listings confirm absence by name and acquired ID. See `test/integration/frozen-browser.test.ts:149-224`.
- **Correct.** A lost create response remains visibly unresolved even after an empty listing. Its final assertion fails, and accounting remains retained. See `test/integration/frozen-browser.test.ts:165-169,203-207`.
- **Correct.** Cancellation requires the journal-acquired container ID to match inspection and report `running`. Polling or assertion failure still aborts validation, attempts validator closure, and awaits validation independently. Errors are preserved. See `test/integration/frozen-browser.test.ts:436-484`.
- **Correct.** The exact patch preserves the original containment, classification, deadline, cancellation-outcome, sentinel, incomplete-cleanup, reconciliation, and reservation assertions. Production executable behavior is unchanged.

No issues found.

## Scoped comments and suppressions

Touched files are `test/integration/frozen-browser.test.ts` and `src/frozen-browser.ts`.

One comment was removed at the former `src/frozen-browser.ts:706`. Its archive-sniff claim was ambiguous beside the conditional PAX implementation. It did not define a public API contract. No comments or suppressions were added.

`MUST KILL` flags, restorations, and edits are zero. The unchanged public API documentation at `src/frozen-browser.ts:1049` is outside this delta.

## Verification boundary

Read the source-extracted finalizer checker and its passing output, including the real stopped-child check. Read the supplied `npm run verify` log reporting 311 passes and zero failures. These artifacts do not establish actual-Docker acceptance.

**Prove It Works** shaped this distinction. Source inspection and local checks do not replace the pending protected failure injections and complete Docker suite.

## Verdict

**Merge verdict. OK for this scoped delta.**

**Safe to run the full unchanged-policy actual-Docker acceptance suite, including the planned protected failure injections. Runtime acceptance remains unproven.**