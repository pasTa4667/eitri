# Offline worker association verification

## Scope and source

This unit implements historical controller-to-validator association. It does not enable execution handoff or M2 acceptance.

The executable and test source is commit `183bf56578758983b10a193a9e380fb7dce66f66`, compared with `952acf4`. The [source identity](source-identity.txt) records both revisions, changed paths and a labeled post-verification source-diff check. The original clean-tree checks before and after the full run are preserved in the active transcript and independently confirmed by the [evidence audit](evidence-audit.md).

The [API reference](../../worker-association.md) describes configuration, retained intent, inspection results and limits.

## Design

Two read-only designs were compared. The selected design stores immutable intended requests in existing controller action-source records and derives observations from the independently pinned owned journal. The rejected design also stored observed run IDs in a new association table. No requirement needs that additional acknowledgment commit or duplicate history.

The parent and a fresh-context cross-judge agreed on the selected design. Both designers, the cross-judge, implementer and source reviewers used `openai-codex/gpt-6.1-sol`. Their independence is context separation, not model diversity. Only the subsequent evidence audit uses a different model family. Binding options are copied before asynchronous work. Existing journal identity is verified before binding persistence and controller recovery. Inspection owns journal opening, exact comparison and closing. Callers cannot submit inventory or override expected identity.

Model the Domain shaped immutable intent and discriminated observations. Prove It Works shaped public API checks and actual SIGKILL/reopen evidence rather than acceptance from compilation or a worker report.

## Parent verification

The parent ran these commands on committed source with an empty tracked source diff before and after verification.

- `npm run verify:all` passes 631 Node tests and 30 Rust tests. Lint, formatting and TypeScript checks pass. The [complete log](parent-verify-all.txt) records zero failed, cancelled or skipped Node tests and zero failed or ignored Rust tests.
- `node --test test/controller-worker-association.test.ts` independently passes all 18 focused tests with zero failures, cancellations or skips. The [focused log](parent-focused.txt) includes actual SIGKILL/reopen at the intent-commit and pre-intent boundaries.
- `git diff --check 952acf4...183bf56578758983b10a193a9e380fb7dce66f66` passes.

The focused checks exercise baseline and candidate requests, selected A after an edit to B, original allowance retention, identity and request mismatches, strict retained-intent parsing, changed or omitted configuration, unavailable and busy journals, detached results, inspection drainage on close, and both interruption constructors. Sentinel assertions require zero worker validation calls and no Docker invocation. Snapshot comparisons require unchanged checks, artifacts, case state and worker history during inspection. A pending-journal control permits only the existing durable uncertainty recovery.

An earlier parent baseline `npm run verify:all` was interrupted at the 200-second command limit. It is not a passing baseline or evidence of a code failure. The completed parent run above supersedes that incomplete check. The worker separately reported 18 focused tests and 631 Node tests passing before the independent parent checks. Worker reports are not substituted for parent evidence.

Rust emits existing future-compatibility warnings for dependencies `block` and `proc-macro-error2`. Clippy and the operator suite still pass. No dependency was changed.

## Review status

Independent [comment review](comments-review.md) inspected the exact source diff and found zero comments or suppressions to remove. Independent [correctness/specification review](spec-review.md) and [standards review](standards-review.md) both pass with no findings. These fresh-context reviewers inspected the exact parent-supplied committed diff and actual source. They did not run tests. Both prompts disclosed the parent runtime results. The specification reviewer explicitly did not treat those results as correctness proof. The standards reviewer also consulted the verification log. Neither review was blind to the green suite.

The local unit passes source review and parent verification. The cross-family [evidence audit](evidence-audit.md) by `anthropic/claude-opus-5-5` passes with six nonblocking documentation corrections. The [resolution record](audit-resolution.md) addresses each correction. No PR is opened because the repository has no configured remote. Publication and later live integration are not part of this unit.

## Authority limits

A match is historical attribution, not current action permission or validation evidence. Journal-only opening can write SQLite recovery and convert pending work to recorded uncertainty before identity comparison. It performs no worker execution or live cleanup. Empty resources, old deadlines and saved cleanup do not prove present daemon state.

The controller does not discover expected journal identity. Trusted provisioning must supply it independently. Historical journal availability, supported worker configuration and existing same-UID filesystem trust remain required. No durable record of a prior inspection survives loss of the journal.

This unit does not dispatch Docker, consume reservations, acknowledge admission, drain cancellation, reconcile live cleanup or admit real native receipts. Production main remains scripted and unconfigured. No original fixture edits, credentials, live services, application inference, GitHub writes, publication, deployment or containment changes occurred. Execution handoff, admission acknowledgment recovery, cancellation drainage and trusted cleanup reconciliation remain separate prerequisites. M2 and later human-presence gates remain open.
