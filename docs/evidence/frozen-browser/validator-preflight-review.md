# Frozen browser acceptance security review

**ISSUES**

Reviewed SHA `09dd3372ca5c9966c47800b89cadcb4fc42b3ac7`.

**Full-suite verdict. Do not run the full actual-Docker suite unchanged yet.** Its failure paths can discard ownership accounting while Docker effects remain unresolved. This finding concerns the acceptance harness, not an identified containment escape in the validator.

## Method

Read-only inspection of `src/frozen-browser.ts`, `worker/frozen-browser/*`, and `test/integration/frozen-browser.test.ts`. Read `docs/frozen-browser.md` and the parent's `validator-acceptance-plan.md`. Inspected supporting workspace, artifact validation, policy, and selected fast-test code.

Resolved the worktree's HEAD reference to the exact SHA above. `watchdog_diff` reported no tracked changes. This was a checked-out source review, not a committed-range diff review.

No edits, shell commands, Docker, external tools, subagents, or runtime tests were performed.

Throughput checkpoint. Not applicable to this read-only investigation.

## Review

### Correct

- Admission accepts exact request fields and semantic identities rather than caller-selected commands or execution configuration. Frozen bytes must match a recorded revision and verified Git objects. See `src/frozen-browser.ts:189-217` and `src/workspace.ts:1601-1627`.
- Host storage checks private directory ownership, canonical paths, inode identities, regular files, hard links, and the original owner marker. Established accounting is validated rather than recreated. See `src/frozen-browser.ts:1090-1326`.
- The Dockerfile contains only fixed configuration and COPY instructions. Snapshot bytes are separate from the absolute trusted Node entrypoint. No project package scripts or configuration are invoked. See `worker/frozen-browser/Dockerfile:1-7` and `src/frozen-browser.ts:1574-1604`.
- Before start, the host checks immutable image/container identities, applied containment settings, mounts, environment, seccomp, quotas, and restart policy. Runtime witnesses additionally check whole-container process ancestry and narrowly defined nested capabilities. See `src/frozen-browser.ts:747-922,1817-1984`.
- Protocol parsing binds complete canonical records to the request and nonce. PNG validation checks bytes, CRCs, decompression bounds, and integrity. Late event overflow remains fatal through shutdown. See `src/frozen-browser.ts:982-1032`, `src/artifacts.ts:99-205`, and `worker/frozen-browser/driver.mjs:317-350`.
- Durable intent precedes effects. Container acquisition is committed before start. Outcomes are committed before cleanup. Interrupted pending runs do not replay, and unknown builds block new admissions. See `src/frozen-browser.ts:1302-1320,1408-1424,1621-1647,1737-1749,1813-1815`.
- Cleanup checks labels, names, and acquired IDs, removes the actual container, and confirms absence through successful bounded listings. PID1 independently enforces the original absolute deadline. See `src/frozen-browser.ts:1985-2075` and `worker/frozen-browser/watchdog.mjs:3-30`.

### Finding 1. P1. Fixture teardown can destroy unresolved ownership accounting

**Location.** `test/integration/frozen-browser.test.ts:97-102`.

The fixture deletes its entire root after `validator.close()` unless `retainState()` was explicitly called. Only the deliberate lost-build test calls it at line 621.

`close()` drains active execution but does not retry a settled incomplete cleanup. See `src/frozen-browser.ts:2077-2090`. Therefore, if an ordinary acceptance case returns `uncertain` with an unresolved build, or returns incomplete cleanup, its failed assertion is followed by deletion of the journal, names, reservations, and ownership marker. The unresolved daemon effect can remain.

The crash tests have the same accounting-loss path. For example, watchdog assertions occur before reopening the validator at `test/integration/frozen-browser.test.ts:431-441`. A failure there reaches fixture teardown without recovery.

The dependent container also has no unconditional cleanup registration. It is created at lines 517-528 and removed only after intervening recovery operations and assertions at line 562. An earlier failure retains that container and its referenced image while the fixture can delete the validator records.

This contradicts the documented requirement to retain unresolved ownership accounting for parent diagnosis.

**Smallest fix.** Preserve and print the fixture directory unless reclamation is positively established. Register failure-safe cleanup or retention for crash-test resources and the dependent container before subsequent assertions. Do not add global pruning or discard unresolved-build records.

### Finding 2. P2. Cancellation can pass without observing running execution

**Location.** `test/integration/frozen-browser.test.ts:359-378`.

The polling loop breaks when it observes `running`, but it can also expire with a valid acquired container ID. The only post-loop assertion checks that ID's syntax.

Consequently, cancellation while the container remains merely `created` can satisfy the later cancelled-outcome and removal assertions. That does not establish the documented acceptance claim of cancellation during actual execution.

**Smallest fix.** Record and assert that the owned container was observed running before aborting. Keep failure-safe resource handling when that assertion fails.

## Principles applied

- **Prove It Works.** Verified source identity and implementation directly. Did not treat prior green runs or source inspection as runtime acceptance.
- **Boundary Discipline.** Reviewed request, filesystem, Docker, protocol, and cleanup boundaries separately.
- **Test Behavior, Not Implementation.** Distinguished acquiring a container ID from observing running execution.

## Merge verdict

**BLOCK the unchanged full acceptance run pending failure-safe harness handling.** Finding 2 is an additional acceptance-coverage note.

No containment relaxation, source-Node execution, global pruning, or new authority is needed to address these findings. Passing a later source re-review would still not constitute actual-Docker runtime acceptance.