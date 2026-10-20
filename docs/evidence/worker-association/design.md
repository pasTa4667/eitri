# Controller worker association design

## Problem

The controller owns admitted actions and frozen selections. The validator owns run history. Historical attribution must not grant current execution authority.

## Usage

Trusted offline configuration pins an existing journal directory, expected owner UUID and expected configuration digest independently of inventory. Controller.open verifies and persists that binding before recovery or scheduling. A public inspection accepts only case and action IDs and returns a detached historical observation. No callback or production main receives a validator capability.

## Shape

Extend existing action_sources JSON with optional immutable canonical FrozenBrowserRequest and its digest. Legacy sources retain absent intent. Record once after final allowance calculation, before callback entry, only for baseline/browser checks under explicit journal configuration. Role derives from kind. Scenario is synthetic-click-v1. Frozen identity comes from the selected source. Preserve intent in every settlement/interruption constructor.

Inspection serializes with workspace operations. It opens the independently pinned journal with literal journal-only mode, verifies owner/configuration, loads retained intent and derives an observation. Match requires exact action key, complete canonical request, original allowance and all request/configuration digests. Journal failures are errors, not absence. Results confer no authority or evidence. Close drains accepted inspection and releases journal ownership in finally.

Model the Domain shaped immutable intent plus a discriminated observation union rather than a mutable association lifecycle.

## Synthesis decision

Use candidate B. Parent and fresh-context cross-judge agree. Designers and cross-judge use the configured openai-codex/gpt-6.1-sol model. No cross-family design judgment is claimed. B scores 25 versus A's 22 on independent provenance, authority separation, restart fidelity, interface size and behavioral testability. These are design judgments, not measurements of runtime behavior.

Graft A's pre-await configuration snapshot, required workspace, verified immutable binding before startup recovery, serialized inspection, finally-close and same-key conflict checks. Reject A's callback method, new association table, saved acknowledgment and observed run IDs. Do not duplicate owner/configuration per intent.

## Tradeoffs

An observation requires the original owned journal to remain available under a supported configuration. No durable record of prior inspection is kept. This removes another commit boundary and duplicate ledger. Journal-only opening may write recovery uncertainty before identity comparison. Same-UID hostile writers remain outside the existing guarantee.

## Open gates

No Docker dispatch, reservations, admission acknowledgment protocol, cancellation drainage, live cleanup, real native check admission, production main changes or M2 acceptance. Independently provisioned identity must be explicit configuration, never discovered from untrusted inventory. No remote publication is configured.

## Implementation

One source owner implements this single association seam, tests it through public behavior with seeded owned journals and actual SIGKILL/reopen, and reports exact evidence. Parent reviews and verifies after completion. Independent review follows a settled diff.
