# Controller workspace verification

## Outcome

The next offline integration unit is implemented in source merge `3026f47b6effa7d52dd28286506c6f9179023841`. Trusted configured callbacks receive a controller-owned workspace and an action-scoped frozen source selection. Production main remains unconfigured and scripted.

Parent `npm run verify:all` passes 420 Node tests and 30 Rust tests at `1b73c768ea92e647fb3f38fe3f6cc62a842c2c88`. The merged executable and test files are byte-identical to that tested commit. Parent then runs all 38 focused tests and the protected recovery reproduction directly on main. All pass.

The [interface reference](../../controller-workspace.md) describes configuration, capabilities, durable states and limits.

## Source and scope

The [source identity record](source-identity.txt) records exact tested and integrated SHAs, the four changed source/test files and unchanged protected modules. `src/controller.ts` owns the feature. The new integration tests and crash helper use real temporary Git and SQLite. The existing workspace test changes only its historical prohibition on a controller import.

`domain.ts`, `native.ts`, HTTP, production main, WorkspaceStore, the browser validator, worker assets, Rust production code and dependency manifests are unchanged. No Docker dispatch, real fixture work, credentials, service activation, live inference, publication or restriction change is part of this unit. No remote is configured, and no PR was opened.

## Design

The [grounding](grounding.md), [candidate A](candidate-a.md), [candidate B](candidate-b.md) and [design decision](design-decision.md) preserve the alternatives and parent selection.

| Alternative | Decision |
| --- | --- |
| Controller catalogue owns bindings and retained action selections. | Selected. Action settlement and source disposition share the existing transaction owner. |
| Private coordinator with extra callback route and edit ledger. | Rejected. WorkspaceStore already owns edit intents and receipts. |
| Serial source operations and controller-generated edit IDs. | Taken from B. They protect asynchronous preconditions without adding another owner. |

One isolated writer owned the coupled source changes. Read-only designs and fresh source/comment reviews ran separately. The parent owned integration, documentation and final verification.

## Review found a real defect

The [initial source review](source-review.md) blocks acceptance despite the worker's [417 passing tests](initial-verify.txt). Ambiguous provisioning checked matching IDs and checkpoint sequence zero, but not the configured initial bytes.

The [parent red reproduction](foreign-provision-before.txt) kills the controller after provisioning intent. It creates pristine C through WorkspaceStore under the same IDs, then reopens with configured A. The original implementation invokes one callback with literal C and leaves the binding ready.

Commit `556039f6b28cce999f885b7fe5544bc6dc1276d6` adds three [red regressions](provision-red.txt). Commit `1b73c768ea92e647fb3f38fe3f6cc62a842c2c88` verifies complete initial frozen files with the same configuration fingerprint. Changed bytes, extra paths and missing paths all [pass green](provision-green.txt). Existing ready B is not compared against initial A.

The [fixed parent reproduction](foreign-provision-after.txt) records zero callbacks, an uncertain binding, `workspace-initial-source-mismatch` and healthy native storage. Fresh [delta source review](provision-review.md) and [comment review](provision-comments.md) find no issues. The reviewers inspect source and tests but do not independently execute runtime tests.

The parent also found test cleanup could close a fixture before releasing a held operation. Commit `4c6bafec4638d77962bb0169d5f7954fc688ef65` moves gate-release hooks before fixture cleanup. Its [focused verification](teardown-focused.txt) preserves the successful-path assertions. Modified crash finalizers await child termination.

## Executed checks

| Command and location | Result and evidence |
| --- | --- |
| `npm run verify:all` in the implementation worktree at `1b73c76`. | 420 Node and 30 Rust tests pass. Lint, formatting and TypeScript pass. [Full log](final-verify-all.txt). |
| `node --test test/controller-workspace.test.ts` on merged main. | 38 pass, zero failures, cancellations or skips. [Log](main-focused.txt). |
| `node docs/evidence/controller-workspace/reproduce-foreign-provision.mjs` on merged main. | Zero callbacks and uncertain binding. [Log](main-reproduction.txt). |
| Source comparison between `1b73c76` and merge `3026f47`. | Executable/test bytes match. Protected modules match inherited main. [Identity](source-identity.txt). |

Full verification sets `CARGO_TARGET_DIR=/Users/felix.langbein/projects/eitri/operator/target` to reuse the existing build cache. It does not change dependencies or toolchains. Rust reports existing future-compatibility notices for `block` and `proc-macro-error2`. The commands still exit successfully.

The standalone reproduction accepts an optional source repository path. It uses only synthetic owned temporary state, faux inference, real Git and SQLite. It awaits child termination before cleanup. Its final form adds a bounded IPC wait and default repository resolution to the initial scratch instrument. Both retain the same behavioral assertions.

Raw command logs remain in `.audit` in the parent or implementation worktree. Only trailing whitespace in the checked-in red regression log is removed. The first worker verify command timed out and is not counted as a pass. The adequate-timeout worker run and parent final run are separate evidence. The later [focused fix log](provision-focused.txt) covers 38 tests.

## Remaining limits

Source provenance is separate from the simulated candidate/evidence contract. Real browser reports, non-simulated admission and durable worker cleanup correlation remain future work. M2 and all later human-presence gates remain open.

No workspace deletion, retention or quota reclamation is added. Existing workspace limits and shared-inventory uncertainty remain. An admitted noncancellable edit can finish after pause. Close drains owned workspace operations, not arbitrary unrelated callback effects. The post-native-close injected error test does not prove recovery from a stuck native close.

Review uses the configured `openai-codex/gpt-6.1-sol` family. It does not provide cross-family assurance. Process-crash tests do not establish power-loss or hostile same-UID guarantees.

## Principles and choices

- Model the Domain selects discriminated binding and source states.
- Laziness Protocol keeps the existing catalogue and WorkspaceStore instead of another coordinator.
- Separate Before Serializing Shared State gives the writer an isolated worktree and each reviewer a separate report.
- Make Operations Idempotent requires exact recovery or conservative parking without callback or edit replay.
- Sequence Work into Verifiable Units preserves red-before-green commits and checks the corrected source before integration.
- Test Behavior, Not Implementation requires public Controller calls and literal A/B/C byte assertions.
- Build the Lever leaves rerunnable integration tests and a protected recovery reproduction.
- Fix Root Causes verifies complete initial content rather than adding more identity guards.
- Prove It Works requires parent runtime verification and source-byte identity, not worker self-report.
