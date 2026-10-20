# Offline worker request acceptance

## Configuration and callback

`Controller.open()` accepts `offlineWorkerAcceptance?: true`. Only absence and literal `true` are valid. Enabling it requires `offlineWorkspace` and a pinned `offlineWorkerJournal`. Options and independent journal identity are copied before asynchronous work.

After retaining exact worker intent, an enabled `baseline` or `browser` callback receives frozen `source.workerAcceptance`. Its zero-argument `accept()` returns a detached acknowledgment with these fields.

| Field | Meaning |
| --- | --- |
| `acceptanceId` | Stable worker-owned UUID. |
| `request` | Complete original canonical frozen browser request. |
| `requestDigest` | SHA-256 of that request. |
| `configurationDigest` | Pinned execution configuration SHA-256. |
| `ownerId` | Independently expected journal owner. |
| `acceptedAt` | Original worker timestamp in milliseconds. |
| `deadline` | Exactly `acceptedAt + request.allowanceMs`. |

Callback entry does not accept work. Other checks have no capability. Callers cannot override the request, identity, signal, allowance, deadline, or authority guard. Concurrent exact retries return the original acknowledgment. Neither timestamp is renewed, including after expiry. This historical `deadline` is separate from the [admitted-action endpoint](action-deadline.md) exposed as callback `deadlineAt`.

## Authority and persistence

The capability serializes with workspace operations and opens only the existing pinned journal in `acceptance-only` mode. The opener verifies independent owner and configuration expectations before application recovery writes. SQLite itself may recover a hot journal while opening.

Acceptance finishes asynchronous storage guards, stages its candidate, and writes one worker transaction. Immediately before synchronous COMMIT, the controller guard must return literal `true`. Promises, thenables, missing returns, and `false` are denied. No await or caller hook follows that guard before COMMIT.

The guard rechecks callback lifetime, signal, controller state, complete persisted action, epoch, strict `running` status, native and workspace readiness, positive case and action allowance, selected source, and unchanged retained intent. Authority is checked before and after asynchronous operations, including before delivering the acknowledgment. Pause requests revoke acceptance even though ordinary check results can still return while pause is pending.

Denied authority rolls back staged state without poisoning the worker handle. Ambiguous persistence failures require reopening. Revocation after COMMIT rejects delivery but leaves the historical acceptance inspectable. Closing rejects new operations and drains already accepted operations before storage closes. Repeated worker close calls share completion.

## Journal and historical inspection

The existing `runs` table holds a private union of execution records and `offline-acceptance` facts. An acceptance has no resources, reservation, outcome, evidence, or cleanup assertion. The acknowledgment is a projection of this fact, not a second stored record.

Version 1 keeps its existing strict execution parser and bytes until the first successful acceptance. That transaction upgrades metadata to version 2 and wraps existing execution rows with their explicit kind. Version 2 validates contiguous row IDs and unique action keys and UUIDs across both kinds. Old binaries reject version 2.

Execution attempts and contribution count only execution rows. Acceptance history has a separate protocol cap of 256 records. This default is not a measured capacity requirement and is outside the hashed execution limits. The execution configuration digest does not change. There is no automatic deletion or refund.

All opening modes preserve acceptance unchanged, including after expiry. `validate()` rejects an acceptance key before frozen reads or client invocation. Worker acceptance and inventory borrow no frozen inputs. Existing controller startup integrity checks still read retained frozen sources.

[Worker association inspection](worker-association.md) returns acceptance as a matched `run` with `state: 'accepted'`, `kind: 'offline-acceptance'`, and the acknowledgment fields. Existing execution observations keep their shape. A match proves historical association only. Reopening never accepts replacements, replays callbacks, renews deadlines, or restores authority.

## Limits

Acceptance is not an execution reservation or permission to execute. It creates no completed check, artifact, native real receipt, or improved controller allowance. Other checks remain simulated. Production main is not connected to this capability.

History is finite, the format upgrade is one-way, and association requires the original trusted journal and supported configuration. Same-UID hostile writers remain outside the trust boundary. COMMIT can cross a deadline after the final synchronous authority sample. This is not distributed atomic authorization.

[Admitted-action deadlines](action-deadline.md) bound current controller authority without changing acceptance bytes. Subsequent opt-in [accepted-request consumption](worker-consumption.md) adds guarded execution and callback-owned drainage while preserving this acknowledgment. Trusted live cleanup reconciliation, real fixture validation, and native real-check admission remain separate work.
