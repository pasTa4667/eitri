# Worker recovery inventory

`FrozenBrowserValidator.open` accepts `mode: 'journal-only'` to inspect an existing validator journal without contacting Docker. The returned `FrozenBrowserJournal` has only `inventory()` and `close()`. The mode does not enable controller dispatch or non-simulated check admission.

## Inventory

`RecoveryInventory` contains the validator owner UUID, configuration digest, lifetime attempt count, supplied-input contribution, and runs in admission order.

Each `RecoveryRun` contains the run UUID, complete saved request, request and configuration digests, original admission time and deadline, build state, and image and container acquisition states. A recorded result has an outcome and `cleanup: 'unresolved'`. A settled result has an outcome and its historical `FrozenBrowserCleanup`.

The inventory does not expose the nonce, raw evidence, screenshots, physical host paths, or mutation capabilities. Each call returns a detached snapshot. Changing that snapshot does not change the journal.

## Opening and recovery

Opening captures its mode before the first await. Omitted mode retains default execution. Values other than `undefined` and `'journal-only'` reject with `invalid-validator-mode` before ownership or filesystem effects. Later caller mutation cannot change the selected mode.

Journal-only opening requires an existing complete owned journal. It retains the existing marker, protected-file identity, policy, configuration, schema, row-digest, committed-evidence, accounting, and uniqueness checks. It does not initialize empty directories or missing journal files.

Pending runs become recorded uncertainty with `interrupted-run-no-replay` and null evidence before opening returns. This transition is durable. Journal-only opening does not finalize those runs or retry cleanup. Unknown builds and acquisition intents remain unresolved.

The mode is not filesystem-read-only. SQLite hot-journal recovery and the pending-to-recorded transition can write the journal. Opening, inspection, and closing perform no worker execution, resource cleanup, or borrowed workspace reads.

## Lifetime

The existing single-owner exclusion covers the journal-only handle. Inventory calls check protected-file identities. Closing rejects new reads, drains accepted reads, closes SQLite, and releases ownership. Repeated close calls share completion.

## Authority limits

A journal record identifies locally persisted work under the existing trusted-owner assumption. It is not current controller permission. A settled cleanup record is historical, not a fresh assertion about the Docker daemon. Empty resource states, elapsed deadlines, and successful behavior do not settle recorded cleanup.

The mode does not create reservations, charge or refund quota, renew deadlines, accept reports, clear interruption, or authorize controller evidence. Same-UID hostile writers and hardware power-loss durability remain outside the guarantee. Existing configuration validation also prevents using this mode as an archive reader across configuration changes.

The [verification record](evidence/worker-recovery/verification.md) records tests and review. The subsequent [offline worker association](worker-association.md) binds controller intent to this journal's historical inventory. Subsequent opt-in [accepted-request consumption](worker-consumption.md) adds an authority-aware execution handoff and callback-owned drainage. Historical inventory still grants no permission to execute. Trusted live cleanup reconciliation and native real-check admission remain later prerequisites.
