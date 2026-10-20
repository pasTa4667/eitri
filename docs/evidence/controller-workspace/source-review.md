## Review

Reviewed `a447f0e..4c6bafec4638d77962bb0169d5f7954fc688ef65` using the supplied complete diff and actual final source/tests. No files changed.

Throughput checkpoint is n/a, read-only investigation.

### Correct

- Action authority checks compare the persisted Action fields and epoch. Source operations also require running status and live callback authority. Edits require implementation phase. See `src/controller.ts:452–456`, `src/controller.ts:557–571` and `src/controller.ts:1001–1035`.
- Callback completion revokes retained capabilities before native settlement. Unconfigured callbacks retain one-argument dispatch. See `src/controller.ts:1112–1127` and `test/controller-workspace.test.ts:172–191`.
- Tests exercise real Git and SQLite for case isolation, frozen A after editing B, fresh Retry authority and restart preservation. See `test/controller-workspace.test.ts:193–350`.
- Recovery preserves historical selections rather than selecting the latest checkpoint. Missing established stores fail closed. Tests cover foreign associations and actual SIGKILL boundaries. See `src/controller.ts:574–607` and `test/controller-workspace.test.ts:579–639,734–865`.
- Close drains admitted workspace operations before closing storage, including after native-close failure. Pending-pause drainage and ownership release have focused tests. See `src/controller.ts:1623–1638` and `test/controller-workspace.test.ts:433–518`.
- Production main remains unconfigured and scripted at `src/main.ts:19–33`. The diff adds no callback-supplied selection identity, checkout path or execution command.

### Finding

**P1. Ambiguous provisioning can adopt foreign initial bytes.**

**Location.** `src/controller.ts:373–388`.

The saved configuration digest includes the configured baseline paths and byte hashes at `src/controller.ts:236–249`. However, recovery of a `provisioning` binding accepts an existing workspace based only on matching case/repository identity, ready state, checkpoint equal to base and sequence zero. It never verifies that the pristine workspace contains the configured baseline.

**Evidence.** This is a static contract contradiction, not runtime-reproduced by me. After a crash at `after-workspace-provision-intent`, an owned workspace provisioned with literal C under the same case/repository IDs satisfies every adoption check. Reopening with configured literal A therefore records C's base as ready. Subsequent source selection freezes that workspace at `src/controller.ts:461–500`, despite the binding's configuration digest describing A.

This violates the selected contract's requirement to adopt only the exact initial workspace or park uncertainty. Existing SIGKILL tests restore the controller's own provisioning effects; they do not substitute different pristine bytes.

**Smallest fix.** Before adopting an ambiguous provisioning effect, verify its complete initial paths and bytes against the captured baseline through WorkspaceStore. Park any mismatch or unverifiable state without reprovisioning. Add a real SIGKILL regression with different pristine bytes under matching IDs. Assert an uncertain binding, healthy native storage, no callback entry and denied Retry.

### Verification notes

Tests were inspected, not independently executed. The supervisor should run the new regression, `node --test test/controller-workspace.test.ts`, and `npm run verify:all`.

The **Prove It Works** principle changed the review to inspect actual source/tests rather than accept the implementation report. Reported passing tests remain unverified here.

The comment review found no added comments or suppressions to flag. Deletion count is zero.

- Merge verdict: BLOCK