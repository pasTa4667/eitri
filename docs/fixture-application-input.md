# Full-application fixture inputs

`captureFixtureApplicationInput` is the acquisition boundary for immutable application validation. It does not run application code, select a controller scenario, or produce validation evidence. The separate opt-in [protected application checker](fixture-application-check.md) enforces execution policy and records real controller receipts.

```ts
import { captureFixtureApplicationInput } from '../src/fixture-profile-name.ts';

const capture = await captureFixtureApplicationInput(canonicalDemonstrationDirectory);
const workspace = await store.provision({
  caseId,
  repositoryId,
  baseline: capture.files.map(({ virtualPath, bytes }) => ({ virtualPath, bytes })),
});
if (workspace.state !== 'ready') throw new Error('Workspace is not ready');
const frozen = await store.freeze(caseId, workspace.checkpoint.revision);
const files = await store.readFrozen(frozen, signal);
```

## Contract

The fixed path set and order come from the 28 entries in [`installed-inputs.json`](../scripts/profile-reconciliation/installed-inputs.json). They include application source, existing tests, HTML, package/lock manifests and build/browser configuration. Paths are copied and frozen at module initialization; later mutations of the imported JSON object cannot change selection. There is no caller-supplied path list, enumeration, overlay, patch application or Git inspection. README, `.env`, `.git`, `dist` and dependencies are not acquired.

Unlike the recipe's `--installed` mode, this API **does not require the recorded baseline sizes/hashes**. It captures observed raw bytes, allowing a future caller to import changed application inputs without mislabeling them as the reviewed installed baseline. Acquisition is not approval to execute changed package scripts, dependencies, configuration or tests. A later validator must independently enforce its protected-input and dependency policy.

`FixtureApplicationInputV1` contains:

- `version: 1`, `kind: 'fixture-application-input'` and `provenance: { kind: 'uncommitted-copy' }`.
- Ordered `files`, each with `virtualPath`, byte `size`, raw-byte `sha256` and detached mutable `bytes` Buffer.
- `captureDigest`, the `domain.digest` of the descriptor with each file's `bytes` omitted. Order is significant; directory names and metadata are excluded.

No original Git revision is asserted, even when the selected checkout has commits. Managed provisioning and freezing supply a separate revision identity. Later brokered edits create distinct candidate checkpoints; frozen reads retain the full original input set independently of subsequent checkout edits or caller Buffer mutations.

## Acquisition and limits

All three capture APIs share the existing [bounded acquisition contract](fixture-profile-name.md#acquisition-contract). Every selected directory route is checked, including `e2e` and `src/pages`. All leaves pass preflight before any descriptor opens. Opened descriptors remain held until final checks of every selected leaf and directory. Successful return requires every descriptor close to succeed. Observed mutations reject the complete capture; failures use the existing sanitized `ControlError` codes.

The fixed 28-file set and 1 MiB per-file limit bound payload allocation to 28 MiB and simultaneously open file descriptors to 28. Canonical root length remains bounded to 4096 bytes. The operator must supply a quiescent, operator-controlled directory. Sequential reads/rechecks are not an atomic filesystem snapshot or protection from malicious same-UID namespace races. Captured source/configuration can itself contain secrets; this API must not automatically publish its bytes.

## Verification and remaining work

`test/fixture-application.test.ts` checks complete descriptors, per-input digest sensitivity, detached bytes, exclusions, inventory mutation, every leaf's safety/size checks, additional directory routes, injected mutation/I/O/closure failures, non-execution, and complete managed baseline/candidate frozen reads. Existing helper/reconciliation tests continue to exercise the shared engine.

A local smoke check captures the installed sibling's actual 28 reviewed inputs and verifies byte-exact managed Git freezing. Its capture digest is `d4248bff339806048ec9958ad0a43a4a55719f0a4e357d9ec4d496f14cf02718`. The original inputs have the same digest after the check. This is acquisition and Git persistence verification, **not application execution** or a browser result.

The [five-axis review](evidence/fixture-application-input/review.md) records the acquisition finding. The separate [application-check boundary](fixture-application-check.md) executes protected unit/build/browser checks against exact managed revisions. Production activation and full M2 acceptance remain open.
