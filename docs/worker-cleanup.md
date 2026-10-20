# Targeted consumed-run cleanup

## Command

`FrozenBrowserValidator.reconcileConsumed(options)` reconciles historical cleanup for one consumed acceptance. The command returns a detached acceptance ID and a settled `RecoveryRun`. A settled run can still have incomplete cleanup. The result contains no evidence bytes or browser report.

The options contain these fields.

- `workspace` supplies the existing constructor dependency. Cleanup does not call its methods.
- `directory` identifies an existing worker journal. The command does not provision storage.
- `expectedIdentity` independently pins `ownerId` and `configurationDigest`.
- `consumedRun` contains exactly `acceptanceId`, `runId`, and `requestDigest`.

The identity and selector use bounded own-data snapshots before asynchronous work. The command matches both retained acceptance and nested execution identities before application recovery writes or worker effects. An ordinary execution or an unconsumed acceptance is not a valid target. SQLite can perform hot-journal recovery while opening storage.

## Recovery

The command changes only the selected consumed record. A pending execution becomes recorded uncertainty with `interrupted-run-no-replay` and null evidence. The command never replays execution.

Recorded runs and settled runs with incomplete cleanup use the existing ownership-checked finalizer. Container removal precedes image removal. Newly discovered resource identity is saved before deletion. Removal requires an absence confirmation. Wrong labels, ambiguous acquisition, and unresolved build state retain incomplete cleanup.

A settled run with successful historical cleanup returns without another application write or worker call. Explicit retries of incomplete cleanup receive a fresh bounded cleanup interval. They receive no execution allowance and make no new accounting charge.

The original acceptance, request, admitted timing, outcome, evidence, accounting, and metadata version remain unchanged. Unrelated logical rows remain unchanged. A failed or ambiguous save rejects rather than acknowledging settlement.

## Ownership

The command holds the existing process-local directory ownership through finalization, queued persistence, and private closure. Its promise settles after closure. Concurrent ownership attempts for the same directory reject, including duplicate commands. The command adds no joining mechanism or cross-process lock.

A surviving independent process must not share ownership. A caller closes its existing journal handle before using the command. No cleanup handle or execution capability escapes.

Existing ordinary and restricted opening behavior remains unchanged. Journal-only, acceptance-only, and consumption-only opening can normalize interrupted pending work but do not finalize historical cleanup. Ordinary opening retains its automatic finalization behavior.

## Limits

This is an offline worker library command. It does not restore callback authority, admit native checks, export trusted reports, or enable production execution. Unknown builds and unresolved acquisition can remain incomplete indefinitely.

Successful cleanup records historical ownership checks and absence observations. It does not establish daemon quiescence, exclude late effects, or reclaim retained cache. Existing trusted-owner, same-UID, and power-loss limitations remain.

The [verification record](evidence/worker-cleanup/verification.md) distinguishes real temporary SQLite and subprocess interruption checks from scripted external effects. M2 acceptance and the later human-presence gates remain open.
