# Check dispatch key fix

Implemented exact-own-key validation in the existing private parser. Malformed callback objects can no longer admit behavioral evidence through comma-containing keys.

Changed files:
- `src/controller.ts`.
- `test/check-dispatch.test.ts`.

## Red and green commits

Red test commit is `3d09be691eb8e6328f522902afae8dac30a10dc9`.

Production remained unchanged from `2646b909185a1cbb705dbb50f4d043884a2c23a6`. Running `node --test test/check-dispatch.test.ts` reproduced the defect.

```text
✖ comma-joined envelope key with inherited type and check stops without evidence or speculative repair (33.092291ms)
✔ timed-out callback cannot change a completed result from a newer Retry epoch (579.21725ms)
ℹ tests 71
ℹ pass 70
ℹ fail 1
```

The malformed envelope produced `assessment-required`, entered `implementation`, and set `failedCandidate`. Expected behavior was `invalid-check-execution`, unchanged `triage`, and no failed candidate. No full-suite pass is claimed for this commit.

Green implementation commit is `4e9642b4a3ebaafad62d41b756ef7a583019d3a4`.

All four comma-serialized guards now compare actual own-key count and membership. The parser remains private with no signature changes. Authority, allowance and cancellation code is unchanged.

## Regression coverage

Added fourteen malformed-object cases covering comma-containing keys, inherited fields and symbol extras across envelopes, receipts and outputs.

Added a public Controller regression that:
1. Lets the old callback time out.
2. Explicitly issues Retry.
3. Records a genuine completed check and artifact under a newer epoch and distinct action.
4. Releases the old failed callback.
5. Confirms the newer case, checks, artifact metadata and artifact bytes remain unchanged.

No private-method casts were added.

## Validation

Command:

```sh
node --test test/check-dispatch.test.ts test/evidence.test.ts test/artifact-resources.test.ts test/recovery.test.ts test/http.test.ts
```

Final output:

```text
✔ comma-joined envelope key with inherited type and check stops without evidence or speculative repair (19.230042ms)
✔ timed-out callback cannot change a completed result from a newer Retry epoch (537.625709ms)
ℹ tests 97
ℹ pass 97
ℹ fail 0
```

Also passed:
- `npm run lint:ts`.
- `npm run format:check:ts`.
- `npm run check`.
- `git diff --check`.

Logs are in `/tmp/check-dispatch-key-fix-{red,green-focused,lint,format,typecheck}.log`.

## Final diff and review

```text
 src/controller.ts           |  16 ++-
 test/check-dispatch.test.ts | 246 ++++++++++++++++++++++++++++++++++++++++++++
 2 files changed, 257 insertions(+), 5 deletions(-)
```

Self-review found no blockers. No comments, suppressions, helper modules or public interfaces were added. The index is empty. Only pre-existing untracked `node_modules` remains.

Principles applied:
- **Model the Domain** preserved the selected execution union.
- **Boundary Discipline** kept validation inside the Controller parser.
- **Laziness Protocol** limited production changes to four guards.
- **Fix Root Causes** removed delimiter serialization throughout that parser.
- **Sequence Work into Verifiable Units** produced separate red and green commits.
- **Test Behavior, Not Implementation** selected public Controller assertions.
- **Prove It Works** required runtime tests and direct diff inspection.

## Residual gaps and next step

Parent review and integrated `verify:all` remain pending. Unchanged slow frozen-browser and Rust suites were not repeated, as instructed.

Both write tools blocked the authoritative output path outside this worktree. This response supplies the complete report for runtime persistence to `/Users/felix.langbein/.pi/agent/sessions/--Users-felix.langbein-projects-eitri--/subagent-artifacts/outputs/96b3e056-d72d-4e07-87c4-bb5ba61930d2/.audit/check-dispatch-key-fix.md`.

Recommended next step is independent review of both commits, followed by parent integrated verification.