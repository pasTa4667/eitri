# Native consumed-browser checks

`NativeCase.recordConsumedBrowserCheck(action, checkId, value, signal)` records a provenance-bearing baseline or browser receipt from an unknown settled consumed-report envelope. This is a library operation. The existing `run_check` tool and production dispatch do not call it.

## Inputs and authority

The caller supplies an existing tool action, a check UUID, an unknown report envelope, and a cancellation signal. The caller cannot supply the expected revision, execution pins, passed flag, or output artifacts.

The optional `RuntimeHost.captureConsumedCheckAuthority` capability supplies a detached `NativeExecutionAnchor` and an `assertCurrent` closure. Hosts without that capability reject real admission. The controller implementation authenticates the complete active action and requires all of the following.

- The same selected action source, original worker request, and independently retained admission facts.
- A positive current action and case allowance with no cancellation or controller shutdown.
- The configured and retained worker binding, including directory, owner, and configuration.
- The selected baseline revision matching the established base, or the original workspace base before the first baseline establishes it.
- The selected browser revision matching a non-null current candidate.

The closure compares its original capture with current authority at publication gates. It does not replace the capture with newer state. Reliable recording can finish during `pause-requested` while the same action remains authorized. Paused, retired, expired, or superseded actions cannot publish historical success.

The native operation constructs its expectation from the anchor and calls the existing `admitFrozenBrowserConsumedReport` converter. It does not trust a previously converted admission or a historical observation as publication authority. Owner attribution comes from the controller binding and admission-retention chain, not the submitted report.

## Outcomes

`NativeRealCheckResult` has two variants.

- `recorded` contains a `RealBrowserCheck` and its artifact reference.
- `unavailable` contains a blocked reason and creates no receipt, manifest, or behavioral checkpoint.

Malformed claims and missing authority reject. They do not become failed behavioral checks. An unavailable result does not finish the action as reliable success. Action retirement remains the embedding's responsibility.

The converter alone determines the literal outcome and passed flag. `baseline-reproduced` and `candidate-passed` pass. `baseline-not-reproduced` and `candidate-failed` fail. Only baseline and browser checks can use this operation.

## Receipts and bytes

`Check` distinguishes simulated receipts from `RealBrowserCheck`. `CheckResult` remains simulated-only, so the ordinary configured callback cannot mint real attribution. Direct `recordCheck` also rejects false simulation and execution provenance.

A real receipt has `simulated: false` and compact `NativeBrowserProvenance`. The case's simulation flag remains unchanged because it describes faux-model operation. A real check does not establish that a genuine model produced a fix.

The private `StoredRealCheck` retains `NativeRealExecutionV1`, including its independent anchor and the converter's detached complete report. Public metadata derives provenance from that envelope rather than storing a second summary. Each real receipt references exactly one fixed-label PNG manifest. An orphan manifest is not execution authority.

The complete report duplicates screenshot base64 alongside the immutable blob. Serialized execution envelopes are limited to 8 MiB plus 512 KiB each and 32 MiB per case. Existing artifact byte and count quotas also apply. Converter limits can reject a report below the storage ceiling.

Native metadata and reopening replay conversion for each real receipt. They compare derived receipt fields, artifact links, actual blob bytes, and PNG structure. They restore no live authority and never replay a controller checkpoint. Real `verifyArtifacts` resolves the stored receipt by ID rather than using caller-supplied artifact links.

## Publication and recovery

One native publication queue serves both receipt kinds and rejects duplicate check IDs or a second receipt for the same action. Closure rejects new publication and drains the queue before closing native storage.

Publication retains the existing order of blobs, manifests, receipt, descriptive note, and controller checkpoint. Authority checks guard those stages. Revocation cannot roll back a write already underway.

Blob-only, manifest-without-receipt, and receipt-without-checkpoint states remain possible. Restart validates retained real receipts but does not reconstruct receipts from orphans or silently apply missing checkpoints. The native file, filesystem, and controller catalogue are not one atomic transaction.

## Verification and limits

The [verification record](evidence/native-consumed-check/verification.md) records checks and GPT review. New tests use scripted worker claims with literal PNG bytes and actual temporary native SQLite persistence. Existing process-kill tests cover the retained recovery ordering.

These checks establish consistency and persistence, not actual Docker execution, containment, cleanup, daemon quiescence, or hostile same-UID authorship. Production report handoff, actual fixture validation, M2 acceptance, and later human-presence gates remain separate work.
