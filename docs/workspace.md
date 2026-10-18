# Offline workspace preparation

The unwired library in `src/workspace.ts` provides the managed-Git and file-broker seam for later M2 integration. It does not add operator controls, agent tools, controller permissions, or generated execution. The real demonstration fixture remains untouched.

## Ownership and source

One trusted owner opens a private mode-0700 store. Input consists of opaque identifiers and copied file bytes with canonical relative paths. The library does not inspect or clone a source checkout. Known environment, credential, and Git metadata paths are rejected, but arbitrary source contents are not secret-scanned.

The store owns bare Git object repositories and separate case worktrees. Fixed `/usr/bin/git` operations use isolated environment/configuration and raw object plumbing. Hooks, filters, signing, credentials, external diff, replacement objects, and transports are not enabled. Model-supplied commands are not accepted.

Each case owns its branch, source manifest, checkpoint, and edit receipts. The broker accepts one file replacement or creation with an expected revision and prior file hash. It permits source changes and new regression tests while protecting baseline tests and configuration, including nested paths. Unknown files, links, permission changes, replaced directories, and other inventory differences prevent edits rather than being erased.

## Commit and recovery

SQLite records the payload and edit intent before source mutation. The broker writes the file, creates and verifies a Git checkpoint, advances the owned ref with compare-and-swap, and persists the checkpoint and receipt before acknowledgment. Repeating a completed request returns its original receipt. Conflicting reuse and stale revisions or file hashes cannot write.

An inode-bound ownership marker is checked before SQLite may recover its own hot rollback journal. Parsed catalogue state is checked before Git or source operations. Incomplete provision/edit intents become uncertain without source replay, ref repair, reset, or cleanup. Initial store-creation crashes fail closed instead of adopting partial state.

Recovery is deliberately conservative. A pending intent causes other ready workspaces in the same store to park on reopen because their metadata inventory is shared. No reconciliation or production cleanup API is implemented yet. Duplicate provisioning is rejected; exports allocate bounded resources rather than offering request-replay semantics.

## Frozen exports

Freeze requires a clean ready checkpoint. Export accepts only a recorded case-owned frozen revision and reads verified commit blobs, not the current worktree. Exporting old A after an edit to B still produces A. Git and controller storage are not copied from the store.

Read-only file permissions are not a containment boundary. Future validation must mount source read-only inside a positively verified container and use separate bounded scratch. A malicious concurrent same-UID host writer is outside the library's guarantee. Process-crash tests do not establish power-loss durability.

## Pilot limits

The store bounds files to 1 MiB each, 1,024 files and 32 MiB per source manifest, with 512-byte paths and at most 16 path segments. It also bounds repositories, cases, receipts, attempts, Git output, metadata, freezes, and exports.

Lifetime caps are eight cases, four repositories, 64 freezes, and 16 exports. Each case has at most 128 edit receipts. Each repository has a 512 MiB reservation budget and at most 128 attempts. An attempt reserves its payload plus 8 MiB, so the byte budget can stop work earlier. Reclamation is not implemented. These are preparation limits, not a production retention policy.

## Verification and remaining gates

Parent `npm run verify:all` passed 88 Node tests and 30 Rust tests on integrated commit `7f28bf3`. The [captured output](evidence/workspace/tests.txt) includes real temporary Git repositories, immutable export checks, hostile Git canaries, identity mismatch preservation, and actual SIGKILL boundaries, including a hot SQLite journal. Fresh security and comment reviews found no actionable issues. They used the same configured model family, not cross-family assurance.

M2 is not accepted. Production ingestion, control-epoch and native receipt integration, trusted immutable validation/scenario drivers, real fixture integration, and managed-worker containment remain outstanding. The trusted fixed-browser feasibility probe now passes with the separately approved `chroot` and task-limit changes; see [its scope](containment-review.md). Credential, sign-in, publication, and live-remediation gates remain pending.
