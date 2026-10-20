# Frozen browser validator integration

The accepted validator is available on main for an importing colleague. Source integration commit `8517aca40c87bcc9050c56e0537dfceffcac8a24` merges `88f89090de567fa6eb10afc9f5f196892a22731f` without changing executable bytes. The controller remains scripted and does not import the validator. This completes source integration, not M2 or controller execution authorization.

## Scope and choice

The previous run accepted the isolated module but left it unmerged. This unit imports its source, tests, worker assets, declarations and module documentation. It preserves main's earlier evidence and the abandoned validator worktree. No new API, scenario, dependency, policy, execution setting or production permission was added.

The [boundary exploration](validator-next-how.md) recommends this unit before controller wiring. The current check callback lacks admitted action context. Truthful non-simulated receipts, workspace ownership, outcome and cleanup policy, deadline drainage, recovery correlation and shared configuration identity need a separate design. Plugging Docker into `Options.check` alone would not satisfy those contracts.

The existing `FrozenBrowserRequest` binds frozen revision, case, action and epoch identity, role, fixed scenario and allowance. `FrozenBrowserReport` separates behavioral outcome, cleanup and evidence. Source integration changes neither shape. A report remains distinct from a controller check receipt.

## Verification

The parent ran these commands against the integrated tree before the source merge commit. Only documentation and evidence changed afterward.

```sh
npm run verify:all
node --check worker/frozen-browser/driver.mjs
node --check worker/frozen-browser/watchdog.mjs
EITRI_FROZEN_DOCKER_ACCEPTANCE=1 node --test test/integration/frozen-browser.test.ts
```

- [Integrated local verification](validator-integration-local.txt) passes all 311 Node tests and 30 Rust tests. Lint, formatting and TypeScript checks pass. No tests failed or skipped. Cargo reports existing future-compatibility warnings for `block` and `proc-macro-error2`.
- [Actual Docker verification](validator-integration-docker.txt) passes all 20 tests with no failures or skips. It covers frozen A after workspace B, protected classifications, sandbox and process evidence, screenshot-preparation overflow, popup errors, worker restrictions, running cancellation, crash recovery, absolute watchdog deadlines, reservations and unresolved-build blocking.
- [Source identity](validator-integration-source.txt) records matching accepted, staged and worktree Git blobs for all nine executable, declaration, test and worker files against `352bf1568b176d9afd4351aca5e2c9c8fc6731e4`. The imported module document matched `88f8909` before its current-status update.
- [Dependency identity](validator-integration-dependencies.txt) records unchanged workspace, artifact and domain modules, policy assets, package configuration and TypeScript configuration against the accepted revision. The source record also proves existing production entry points and earlier evidence were unchanged at review time. A [final comparison](validator-integration-final.txt) reconfirms source and earlier-evidence identity, preserves all 93 earlier decision rows as an exact byte prefix, and records both worker syntax checks.
- [Integration review](validator-integration-review.md) and [comment review](validator-integration-comments.md) pass. The comment review proposes no deletions and keeps one public API contract comment. It finds no scoped suppressions. Both reviewers use `openai-codex/gpt-6.1-sol`. The integration review explicitly relies on parent-produced Git records because its tools cannot inspect committed ranges.

The first local command reached the parent's 180-second tool timeout before the suite finished. The [interrupted log](validator-integration-local-interrupted.txt) is not a passing run. The complete adequate-timeout rerun is recorded separately. No source change or test relaxation followed the interruption. The committed complete local log omits one trailing blank line. The original output remains in `.audit/validator-integration-local.txt`.

Worker JavaScript remains outside the existing `lint:ts` path list. Formatting, explicit Node syntax checks, trusted-driver tests and actual Docker execution cover those files in this unit. No broader lint coverage is claimed.

## Retained artifacts and resources

The existing [record producer](../frozen-browser/record-validator-acceptance.mjs) was copied into private scratch so new outputs could not overwrite earlier acceptance evidence. It checked the explicit accepted revision against the merged checkout and exported the retained real stores read-only.

- [Artifact checks](validator-artifact-check.txt) verify literal A, PNG bytes and digest, 13 retained fixture directories and 39 settled runs.
- [Store summaries](validator-final-stores.json) preserve exactly one deliberate unknown-build case with incomplete cleanup. Unknown daemon completion remains unresolved and blocks further admission.
- [The saved observation](validator-final-observation.json) includes provenance and process evidence. The parent opened the [actual PNG](validator-final-A.png) and observed the Run button and literal A.
- [Resource snapshots](validator-final-resources.txt) record successful Docker commands with empty current container and derived-tag listings. This is not proof against late unresolved daemon effects or a claim of recovered disk space.
- [Environment snapshots](validator-environment.txt) bind Node 26.5.0, Docker 29.4.0 and the fixed Linux ARM64 base image to saved provenance. Commands target the existing `orbstack` context without changing it.

To regenerate records into scratch without replacing either committed evidence set, run the following from the repository root. The retained temporary fixtures named in the Docker log must still exist. Missing fixtures fail rather than recreate evidence. The command refreshes current environment and resource snapshots.

```sh
mkdir -p .audit/validator-integration-records
cp docs/evidence/frozen-browser/record-validator-acceptance.mjs .audit/validator-integration-records/record-validator-acceptance.mjs
node .audit/validator-integration-records/record-validator-acceptance.mjs . docs/evidence/validator-integration/validator-integration-docker.txt 352bf1568b176d9afd4351aca5e2c9c8fc6731e4
```

Raw review reports refer to the original `.audit` paths. Their captured files are retained beside this document under the same basenames. The original October 19 acceptance evidence is unchanged.

## Throughput and principles

The blocking checks were ancestry, exact source and dependency identity, the pinned engine and image, and fresh review before Docker effects. Independent read-only reviewers covered integration and comments. The parent alone owned main and Docker. Per-test temporary stores retained separate ownership. The smallest safe unit was the already accepted source, not a new execution adapter.

Laziness Protocol kept the accepted API and executable bytes unchanged. Model the Domain preserved the existing request, outcome, cleanup and evidence unions rather than conflating reports with check receipts. Sequence Work into Verifiable Units put source promotion before caller design. Prove It Works required fresh integrated suites, read-only store extraction and direct PNG inspection.

## Limits and next unit

The scoped result is VERIFIED. No controller wiring, original fixture change, project Node execution, credential lookup, service activation, application inference, GitHub write or deployment occurred. No containment setting changed. M2 and later human-presence gates remain open.

The watchdog trigger remains timing-coupled. Prior auxiliary-remover refusal and late-create branches still have source review rather than separate runtime proof. Build cache and synthetic fixture roots remain retained. Physical disk usage, resolver behavior, power-loss safety and same-UID adversarial races are not newly established.

The next proposed unit is a bounded controller action-context and evidence-admission design with synthetic reports, still without Docker dispatch. That recommendation comes from the boundary exploration, not a completed implementation.

The [final evidence and decision-trail audit](validator-integration-audit.md) passes with no blocking overclaim or missing verification. It independently compares Git bytes, opens all 13 retained catalogues read-only, checks exported summaries against stored rows and opens the PNG. The 39 settled records include 22 completed builds, 16 not-started builds and one unknown build. They are not 39 successful browser executions. Review used the configured GPT family. Cross-family review is not claimed.
