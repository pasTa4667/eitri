### Overview

**The smallest next implementation unit is integrating the accepted validator unchanged and still unwired.** October 19 acceptance proves the fixed synthetic browser contract, not controller authority or M2 completion (`docs/work-log.md`, “Validator acceptance continuation on October 19”).

A controller binding is more than assigning `Options.check`: action identity is unavailable to that callback, current evidence schemas require scripted receipts, and validator cleanup outlives the runner’s timeout.

### Key concepts

- **Frozen identity:** `WorkspaceStore.freeze()` records case/revision/manifest; `readFrozen()` verifies detached commit bytes (`src/workspace.ts:1576–1629`).
- **Authority:** the controller admits and validates `Action`s. Validator epochs are correlation data, not dispatch permission (`src/controller.ts:472–528`).
- **Observation:** `FrozenBrowserReport` independently carries outcome, cleanup and evidence; it is not a `CheckResult` (`../eitri-validator-acceptance/src/frozen-browser.ts:21–82`).
- **Evidence admission:** native storage assigns check/artifact IDs, binds provenance and guards active action/epoch. Assessment subsequently verifies artifacts and phase requirements (`src/native.ts:405–509`; `src/controller.ts:569–643`).

### How it works

Existing flow:

`run_check → admitted tool action → host.check → CheckResult → recordCheck → checkpoint → assessment`

A future binding would insert:

`host-selected freeze + actual action → validator → conservative report mapping → native evidence storage`

1. **Construct a host-owned request.** Use the existing tool action’s case, UUID, epoch and remaining allowance, plus a recorded baseline/candidate freeze. The exact request parser disallows arbitrary commands, paths or scenarios (`../eitri-validator-acceptance/src/frozen-browser.ts:215–245`).
2. **Observe immutable bytes.** The validator reads frozen bytes, builds its COPY-only derived image and runs only the protected static-browser scenario. Project JavaScript runs in Chromium, never project Node (`docs/frozen-browser.md`, “Fixed execution contract,” in the acceptance worktree).
3. **Map behavior deliberately.** `baseline-reproduced` could produce a passing baseline check; `candidate-passed` could produce a passing browser check. Use the frozen revision as `candidate` and verified configuration digest as `configuration`. Decode the verified PNG into an artifact output. Infrastructure, uncertainty, unrelated failure and cancellation must not become speculative repair failures.
4. **Retain existing gates.** Browser success alone cannot advance testing: baseline/unit/regression/build, current candidate, common configuration and browser artifacts remain mandatory (`src/controller.ts:603–638`). The validator supplies no unit/build/checkpoint execution.

**Missing seams before binding:**

| Seam | Concrete gap |
|---|---|
| Action context | `Options.check(id, kind, signal)` and `RuntimeHost.check(kind, signal)` omit the admitted `Action` (`src/controller.ts:426–429`; `src/native.ts:258`). Recording guards occur after external execution; dispatch needs its own permission check. |
| Workspace ownership | Controller/native do not provision or own `WorkspaceStore`, map repository identities, or select freezes corresponding to `Case.base`/`candidate`. |
| Truthful receipts | Case, check and artifact validation require `simulated === true` (`src/controller.ts:178`; `src/native.ts:376,439`; `src/artifacts.ts`, `validateArtifact`). Do not silently relabel real observations or relax these gates. |
| Outcome policy | Generic failed checks affect repair state (`src/controller.ts:540–567`). Infrastructure/unrelated/cancelled/uncertain results need separate conservative handling. |
| Cleanup policy | Behavioral success can coexist with incomplete cleanup. `CheckResult` cannot express that distinction or durable validator-report correlation. |
| Deadline/drainage | Tool time starts before validator admission. Pass remaining allowance, not a fresh minute. Validator adds up to ten seconds of finalization; native timeout stops waiting without draining the underlying operation (`src/native.ts:194–212`, `abortable()`; validator `finalize()`/`close()`). |
| Recovery/capacity | Controller and validator have independent journals and uncertainty handling. Validator allows one distinct active request; controller capacity can be two. Ownership, scheduling and no-replay correlation need decisions. |
| Configuration | All required phase checks need a common configuration digest; independently invented adapter hashes will fail the current equality gate. |

**Recommended bounded next unit**

Integrate accepted source, tests, assets, declarations and new module documentation **without production imports, controller/schema changes or execution activation**.

Falsifiable acceptance:

- Executable/test/assets/declaration bytes match accepted source `352bf15`; final module documentation matches `88f8909`.
- Controller/native/HTTP/startup retain no validator/workspace execution wiring.
- Parent local verification passes without unexpected skips; 311 tests is the accepted-branch baseline, not fresh integrated-main evidence.
- Main’s existing work log, decisions and evidence remain intact.
- No new Docker, fixture, project Node, credential or external work is implied.

A later separate unit could expose action context and test conservative report admission using synthetic reports, still without enabling Docker dispatch.

### Where things live

- `src/domain.ts`: `Action`, `CheckResult`, `Check`, artifact contracts.
- `src/controller.ts:413–643`: callback bridge, action authority, checkpoint and assessment gates.
- `src/native.ts:194–260,405–509`: tool lifecycle and guarded evidence persistence.
- `src/workspace.ts:1576–1629`: freeze and frozen-byte reader.
- `../eitri-validator-acceptance/src/frozen-browser.ts`: request/report contracts, admission, durable effects and cleanup.
- `../eitri-validator-acceptance/worker/frozen-browser/`: trusted driver/watchdog, fixed scenario and COPY-only Dockerfile.
- `../eitri-validator-acceptance/docs/frozen-browser.md`: interface and explicit limitations.
- `docs/evidence/frozen-browser/validator-acceptance.md`: existing parent acceptance evidence.

### Gotchas

- Settled duplicates return saved reports without renewed allowance or repaired cleanup. Controller admission must reject stale correlation.
- Baseline “pass” means reproducing A; candidate “pass” means observing B in this synthetic scenario—not general application health.
- Full validator evidence can reach 8 MiB; a text artifact permits only 256 KiB. Dumping the complete report into one text output is not generally valid.
- Unknown daemon builds block further admission. Sixteen nonrefundable attempts and retained cache are not physical-disk quotas.
- Existing 20 Docker/311 local results were inspected as recorded acceptance, not rerun.

**Cherry-picking without documentation clobber:** Yes, by replaying commit changes or a scoped final-tree delta—not replacing the branch tree. The unique branch delta adds only ten paths: module, two tests, four worker assets, two declaration files and new `docs/frozen-browser.md`. Its unique commits do not modify main’s existing work log, decisions or evidence. Shared controller/domain/native/workspace/artifact sources are identical.

The two-endpoint comparison nevertheless shows older work-log/decision content and missing parent evidence on the branch. Copying its entire tree would clobber documentation. No cherry-pick was attempted.