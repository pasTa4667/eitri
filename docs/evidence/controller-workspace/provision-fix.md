Implemented exact initial-source verification before normal provisioning or ambiguous adoption becomes ready. Existing ready B is not compared against baseline A.

Changed files:
- `src/controller.ts`.
- `test/controller-workspace.test.ts`.

**Commits.**
- Red `556039f6b28cce999f885b7fe5544bc6dc1276d6`.
- Green `1b73c768ea92e647fb3f38fe3f6cc62a842c2c88`.

**Evidence.**

Red reproduced the defect, not a setup failure:

```text
actual: { callbacks: 1, observed: [ 'literal C\n' ], binding: 'ready', native: 'ready' }
expected: { callbacks: 0, observed: [], binding: 'uncertain', native: 'ready' }
```

All three regressions failed red and passed green. They cover changed bytes, an extra path and a missing path. They also verify denied Retry and preserved foreign storage.

The parent reproduction passed against green:

```json
{
  "callbacks": 0,
  "observed": "",
  "status": "needs-attention",
  "reason": "workspace-initial-source-mismatch",
  "native": "ready",
  "binding": "uncertain"
}
```

**Validation.**

Commands ran from `/Users/felix.langbein/projects/eitri-controller-workspace`.

- `node --test --test-name-pattern='SIGKILL provisioning intent rejects pristine foreign' test/controller-workspace.test.ts`. Expected 3 failures red, 3 passes green.
- `node /Users/felix.langbein/projects/eitri/.audit/reproduce-foreign-provision.mjs /Users/felix.langbein/projects/eitri-controller-workspace`. Passed.
- `node --test test/controller-workspace.test.ts`. All 38 passed.
- `./node_modules/.bin/oxlint --deny-warnings src/controller.ts test/controller-workspace.test.ts`. Passed.
- `./node_modules/.bin/oxfmt --check src/controller.ts test/controller-workspace.test.ts`. Passed.
- `./node_modules/.bin/tsc --noEmit`. Passed.
- `git diff --check 4c6bafec4638d77962bb0169d5f7954fc688ef65..HEAD`. Passed.
- `git diff --cached --name-only`. Empty.

Logs are under the worktree’s `.audit/` directory:
- `provision-fix-red.log`.
- `provision-fix-green-regression.log`.
- `provision-fix-parent-repro.log`.
- `provision-fix-workspace-tests.log`.
- `provision-fix-static.log`.
- `provision-fix-final-state.log`.

**Implementation choices.**

The configuration fingerprint now has one private implementation, reused for complete frozen initial files through existing WorkspaceStore `freeze` and `readFrozen`. No new API, manifest algorithm, table or authority was added. Initial freezes create no ActionSource evidence.

Positive exact-A crash adoption and A/B history passed. New and modified crash finalizers await killed children. Existing gate-release-before-close cleanup remains intact.

Read the required skill and leaves in full. **Fix Root Causes** required content identity rather than additional ID checks. **Test Behavior, Not Implementation** required public crashes and literal-byte assertions. **Laziness Protocol** kept the existing store APIs and one fingerprint. **Model the Domain** preserved the selected discriminated shapes and two tables.

**Open risks/questions.**

Independent review and parent `verify:all` remain pending. Initial verification uses existing bounded freeze storage. The pre-existing untracked `node_modules` symlink was untouched and never staged.

Writing the requested external `provision-fix.md` path was blocked by the tool boundary. This response is the complete report for persistence there.

Recommended next step is independent review, then parent integration verification.