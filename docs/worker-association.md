# Offline worker association

## Configuration

`Controller.open()` accepts optional `offlineWorkerJournal` configuration with these fields.

| Field | Meaning |
| --- | --- |
| `directory` | Existing canonical owned validator journal directory. |
| `ownerId` | Independently provisioned lowercase owner UUID. |
| `configurationDigest` | Independently provisioned validator configuration SHA-256. |

This option requires `offlineWorkspace`. The controller copies and validates both options before its first await. It resolves the journal path and rejects symlinked or noncanonical directories through the existing journal opener.

The catalogue retains one immutable binding. Opening verifies the configured journal before saving a new binding, recovering cases, or scheduling actions. Reopening with an omitted or different binding fails. The controller never discovers its expected identity from inventory. Provisioning the journal and supplying trusted identity are external prerequisites.

## Retained intent

For `baseline` and `browser` checks, explicit `offlineWorkerJournal` configuration enables one `workerIntent` in the existing `action_sources` record. The controller saves it after frozen source selection and its final current-authority and allowance check, without an intervening await, before entering the check callback.

The intent contains the canonical `FrozenBrowserRequest` and its SHA-256 digest. The request retains the selected frozen tuple, admitted case and action IDs, original epoch, `synthetic-click-v1`, kind-derived role, and original `Math.min(60_000, remainingMs)` allowance. `baseline` maps to the `baseline` role. `browser` maps to `candidate`.

Edits after selection do not change the intent. Settlement, both interruption paths, action deletion, and epoch advancement preserve it. Existing sources without intent remain unrecorded. Other check kinds never acquire intent. Callbacks receive no raw journal handle or worker request override. Explicit [offline worker acceptance](worker-acceptance.md) can supply a scoped zero-argument acceptance capability.

## Inspection

`controller.inspectWorkerAssociation(caseId, actionId)` accepts only the two IDs. It serializes with workspace operations and opens only the pinned directory using literal `mode: 'journal-only'`. The opener verifies independent owner and configuration expectations before application recovery writes. Every inspection closes the journal in `finally`. Controller close drains accepted inspections before closing storage. Later inspections reject with `controller-closed`.

The detached result has one of these states.

| State | Fields | Meaning |
| --- | --- | --- |
| `unrecorded` | None | The retained source has no worker intent. |
| `absent` | `intent` | No journal run has the exact case, action, and epoch key. Absence does not prove no work occurred. |
| `conflict` | `intent`, `runs` | A same-key run differs from the complete canonical request, saved and recomputed request digests, or pinned configuration. |
| `matched` | `intent`, `run` | Exactly one execution or acceptance matches the complete request and every request and configuration digest. |

A different action or epoch is never substituted. Missing source records and unavailable, busy, foreign, corrupt, or unsupported journals raise errors rather than returning absence. The existing opener rejects invalid journal requests and digests before association comparison. Mutating returned intent, outcome, cleanup, or resource data cannot change retained history or later observations.

Inspection writes no acknowledgment, observed run ID, or association state. A match is historical attribution, not current execution authority or validation evidence. Inspection does not change case budget, disposition, epoch, checks, artifacts, worker quotas, original deadlines, or cleanup. Journal-only opening can recover SQLite and durably convert a pending run to recorded uncertainty. It never replays the callback or performs worker execution or cleanup, and rejects mismatched configured identity before application recovery writes. SQLite itself may recover a hot journal while opening.

## Limits

Historical inspection requires the original journal and a supported validator configuration. No durable record of earlier observations survives independently of that journal. Same-UID hostile filesystem writers remain outside the existing trust boundary.

Inspection does not dispatch workers, reserve execution capacity, drain cancellation, reconcile live cleanup, or authorize native real-check receipts. Matched offline acceptance is historical acknowledgment, not execution permission. It does not connect production main to validator execution. These protocols remain separate work.
