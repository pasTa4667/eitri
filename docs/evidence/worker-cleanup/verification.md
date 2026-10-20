# Consumed-run cleanup verification

## Accepted scope

Source `3a7e666d8c6ae102fe7619b77b216fcd407c57be` adds the [targeted cleanup command](../../worker-cleanup.md). Local main fast-forwards from `8bcbe025a2707a8d97ae2774ac955805e2756fa0` after fresh GPT source review and completed writer verification. Parent full verification then runs on integrated main.

Only `src/frozen-browser.ts` and four new cleanup test files change. Production main, controller, native storage, HTTP, workspace implementation, worker assets, containment, Rust, and dependencies remain unchanged.

This unit completes an offline library prerequisite. It does not establish actual Docker daemon cleanup, native real-check admission, actual fixture validation, or M2 acceptance.

## Design and recovery

Read-only grounding identifies the gap between consumed-run history and ownership-checked historical cleanup. Two independent GPT sketches compare a held cleanup-only handle with a static targeted command. The [design review](design-review.md) selects the static command because opening the held handle would normalize unrelated pending records before selector validation. The [selected contract](design.md) preserves strict targeting and private lifetime ownership.

The first implementation owner validates journal-loader extraction before adding the command. Its managed worktree has an initial complete full-suite run with 853 Node and 30 Rust tests before two final legacy tests. That historical result is visible in the retained child transcript, not retained as a standalone log. It is not final-source proof.

The harness stops that owner after 30 minutes during its final rerun. It retains a five-file patch but removes the temporary worktree and ignored logs. The parent restores that patch in persistent `../eitri-worker-cleanup-next`. A fresh GPT owner inspects the inherited diff, completes full verification, and commits identical source bytes. No interrupted command is counted as a pass.

The original parent baseline also exceeds its 300-second limit. [The partial baseline output](baseline-interrupted.txt) is retained as incomplete evidence, not a baseline pass.

## Checks

The parent executes the focused command against the restored implementation.

```sh
node --test test/frozen-browser-cleanup-reconciliation.test.ts test/frozen-browser-cleanup-crash.test.ts
```

[Parent focused output](parent-focused.txt) records 43 passes and zero failures, cancellations, or skips. The checks include actual child-process SIGKILL at execution, result recording, selected normalization, acquired-ID persistence, removal, and both sides of settlement COMMIT.

Both the completion owner and parent run the full gate.

```sh
npm run verify:all
```

[Writer full output](writer-full.txt) and [parent integrated full output](parent-full.txt) each record 855 Node and 30 Rust passes. Both commands finish successfully. The parent Node summary has zero failures, cancellations, or skips. Rust reports zero failures or ignored tests. Existing Rust dependency future-incompatibility notices remain in the logs.

Tests exercise actual temporary SQLite journals and subprocess interruption. External execution and cleanup use a PATH-isolated scripted Docker replacement. Some adversarial cases alter saved synthetic journal records or intercept private boundaries to inject failures. These checks do not establish behavior against a real daemon.

Coverage includes strict selector and identity rejection, immediate input mutation, unrelated logical-row preservation, no workspace access, unchanged accounting and admission timing, passive restricted modes, exhausted execution quota, historical no-op retries, incomplete ownership, failed persistence, ownership retention through private close, and legacy journals.

## Review and identity

The fresh [GPT correctness review](source-review.md) finds no issues. Its reviewer can inspect source and saved output but has no test execution or hash tool. The review explicitly leaves completed full verification, final committed HEAD, and post-review hashes for the parent.

The independent [GPT comment audit](comment-review.md) finds no issues, suppressions, or required deletions. The public API contract comment remains.

[The captured review manifest](review-identity.txt) and [integrated source manifest](source-identity.txt) contain the same five SHA-256 values. The former names files in the implementation worktree. The latter names integrated repository paths. The parent computes and compares both manifests, compares the reviewed source patch against the committed source patch, and confirms an empty executable working-tree diff after full verification.

These commands reproduce the source checks from the repository root.

```sh
git diff --name-only 8bcbe02 3a7e666
shasum -a 256 src/frozen-browser.ts test/frozen-browser-cleanup*.ts
git diff --exit-code 3a7e666 -- src test worker operator package.json package-lock.json
git diff --exit-code 8bcbe02 3a7e666 -- src/main.ts src/controller.ts src/native.ts src/http.ts src/workspace.ts worker operator package.json package-lock.json
```

The fresh [GPT evidence audit](evidence-audit.md) passes with no flags or corrections. It checks raw logs and parent transcript tool results without claiming independent test execution or hash computation.

All design, implementation, source review, comment review, and evidence review roles use `openai-codex/gpt-6.1-sol`. No Claude review runs. Fresh contexts provide independent review, not cross-family assurance.

## Limits

The command returns historical cleanup metadata without evidence export or execution authority. Unknown builds and unresolved acquisition remain incomplete. Directory ownership is process-local and assumes one trusted surviving owner. Successful settlement and private closure do not prove daemon quiescence, exclude late effects, or reclaim retained cache.

No monitored fixture change, credential lookup, service activation, live application inference, publication, deployment, or containment change occurs. Production remains unwired. Native real-check admission, trusted consumed-report retrieval, real fixture validation, and later human-presence gates remain open. No remote is configured. Delivery remains local.
