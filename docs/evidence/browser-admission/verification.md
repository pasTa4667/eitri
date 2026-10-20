# Browser report conversion verification

## Scope

Commit `bd01ff66e71b59c396792eb5120a1cc0e50d4005` adds a pure conversion boundary for future trusted validator callers. It does not admit a controller check or enable Docker dispatch. Parent verification passes 554 Node tests and 30 Rust tests. Fresh source and comment reviews find no issues.

The inherited checkpoint is `9c862a0f04056b2a88c01fe12525e80e47ef7ef8`. Controller-owned offline workspace selection is already implemented. Native check and artifact receipts remain simulated. Source identity alone does not establish behavioral evidence.

## Design decision

The [first candidate](candidate-a.md) proposes a synchronous in-module conversion with a behavioral or blocked result. The [second candidate](candidate-b.md) compares that boundary with eventual controller-owned admission. Both recommend pure conversion as the next bounded unit.

The [cross-judge](design-judge.md) selects the first candidate with strict own-data validation before parsing or serialization. The judge also requires deadline enforcement for unrelated failure, not only the four behavioral outcomes.

| Alternative | Decision |
| --- | --- |
| In-module conversion using existing private parsers and classification. | Selected. It avoids copying the lifecycle verifier or exporting private helpers. |
| Controller-owned real receipts and durable worker associations. | Deferred. They require cleanup reconciliation, drainage, candidate semantics and native persistence work. |
| Full containment verification or configuration-contract extraction. | Excluded from this pure consistency boundary. |

The data shape is `FrozenBrowserExpectation` plus the `FrozenBrowserAdmission` discriminated union. Behavioral results carry a detached report and one copied PNG output. Blocked results retain the report without admit-ready outputs.

A matching request or digest proves consistency with independently supplied expectations, not authorship. Claimed containment, ownership and cleanup are not independently verified. The helper cannot authorize persistence or advance a case.

One writer owns the coupled source, tests and reference documentation. Read-only design alternatives run separately. Source review and parent verification follow implementation. No PR is planned because no remote is configured and controller publication is outside the approved scope.

## Baseline

Parent `npm run verify:all` passes 420 Node tests and 30 Rust tests at the inherited revision. [Complete log](baseline.txt).

The first command timed out after 200 seconds. It is not counted as a pass. The successful rerun has a 1200-second command timeout and completes before source edits.

## Implemented contract

`admitFrozenBrowserReport` first validates and detaches both arguments as bounded own-data objects. It rejects accessors, proxies, serialization hooks, hidden or symbol keys, cycles and malformed JSON-like values before parsing or serialization. It then reuses existing request, outcome, cleanup and evidence parsers and the existing scenario classifier.

The converter compares independently expected request and configuration identity, frozen source identity, request digest, recorded times, transfer manifest and PNG integrity. It shares only stage, literal and event validation with the existing runtime observation path. Incomplete cleanup blocks eligibility after validation. Infrastructure, unrelated failure, cancellation and uncertainty never become failed behavioral checks. Cancellation can retain diagnostic B without becoming a pass.

The applied inspection hash receives format validation when present. Its absence is allowed because the applied record otherwise remains opaque claimed data. An explicit fabricated unsafe-report test proves this narrow limit rather than asserting containment.

The [source identity](source-identity.txt) records the three implementation files, exact comparison commands and unchanged protected code. No controller, native, domain, workspace, artifacts, production main, HTTP, worker, Rust or dependency changes occur. Catalogue schemas remain unchanged inside the protected controller and workspace modules.

## Executed checks

| Command | Result |
| --- | --- |
| Worker `node --test test/frozen-browser-admission.test.ts test/frozen-browser.test.ts`. | [317 tests pass](worker-focused.txt). |
| Worker `npm run verify`. | [554 tests pass](worker-verify.txt), with lint, formatting and type checks. |
| Parent `node --test test/frozen-browser-admission.test.ts test/check-dispatch.test.ts test/controller-workspace.test.ts test/evidence.test.ts test/artifact-resources.test.ts`. | [260 tests pass](focused.txt), with no failures, cancellations or skips. |
| Parent `npm run verify:all`. | [554 Node and 30 Rust tests pass](final-verify-all.txt), with lint, formatting and type checks. |

Checked-in baseline and earlier concurrent-run logs omit one final blank line from the raw `.audit` copies. Candidate B omits four trailing Markdown hard-break spaces. No other content is normalized. Existing Rust dependency future-compatibility notices remain in the successful full log. No Docker suite is run for this pure conversion unit. New reports are synthetic fixtures and do not prove browser execution.

## Review status

Fresh [comment review](comment-review.md) finds no issues, suppressions or required deletions. The public API contract comment remains. Fresh [source review](source-review.md) finds no actionable bugs or required-contract coverage gaps. Both reviewers inspect the exact delta and current files without independently executing tests. Source and comment reviews use the configured GPT family.

The [cross-family evidence audit](evidence-audit.md) by `anthropic/claude-opus-5-5` passes with no P0 or P1 issues. It checks the active parent transcript, every linked artifact and this run's decision rows without executing tests. Its Git-object inspection is limited, and it labels parent-generated comparisons accordingly.

The audit records three P2 evidence notes. The parent addresses each after the audit. The source identity file now includes exact comparison commands and protected paths. A fresh commit-range patch compares byte-for-byte equal to the working-tree patch used by both reviewers. Finally, the parent reruns `npm run verify:all` after the worker and reviewers finish. All 554 Node and 30 Rust tests pass again. The final log records the tested HEAD and empty source/test diffs before and after the command. The [earlier successful parent run](parent-concurrent-verify-all.txt) remains available separately.

The worker created `bd01ff6` while the first parent focused run was active. The focused run tested the pre-commit tree, and the earlier parent full run began after the commit but before the worker session returned. The final post-writer run removes that concurrency from the acceptance check. No executable bytes change during the evidence corrections.

## Remaining work

Controller admission, durable worker cleanup correlation, cancellation drainage, real candidate semantics, suite configuration compatibility and native persistence recovery remain separate prerequisites. M2 and later human-presence gates remain open.

## Principles and choices

Model the Domain selects a distinct behavioral or blocked result rather than a simulated check. Prove It Works requires direct parent conversion and controller regression tests plus full verification. Sequence Work into Verifiable Units keeps this pure prerequisite separate from worker lifecycle and receipt persistence.
