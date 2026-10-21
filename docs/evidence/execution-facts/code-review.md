# Execution-facts correctness review

## Review

**PASS. No source correctness blocker found.**

No issues found.

Reviewed the supplied source and test patches against base `11b11ec909988c5aa6ef49d9daa48344af554d16`, the selected design verdict, and all four current source/test files. This review was read-only. No children were spawned.

### Correct

- **Authority remains separate from observation.** Strict source parsing validates facts before projection. The authority comparison excludes only `workerExecutionFacts` and preserves the original captured baseline. See `src/controller.ts:747–824`, `1523–1528`, and `2226–2245`. Mutation coverage is in `test/controller-worker-execution-facts.test.ts:437–513`.

- **Identity validation matches the selected contract.** Live validation checks complete requests, recomputed digests, acceptance identity, owner/configuration binding, recorded/settled state, canonical selectors, and safe actual timing endpoints. See `src/controller.ts:2247–2367`. The scope privately retains acceptance data and passes detached copies to consumption and retention at `src/worker-execution-scope.ts:74–95`.

- **Append semantics are transactional and append-once.** The writer re-reads source and persisted binding, checks the captured anchor, accepts exact duplicates without updating, and rejects conflicts or missing sources. It does not recreate rows. See `src/controller.ts:507–535`. Tests exercise malformed candidates, missing rows, binding changes, exact-repeat no-write behavior, and conflicting facts at `test/controller-worker-execution-facts.test.ts:266–374`.

- **Capture precedes delivery authorization.** The cached consumption promise retains facts synchronously after successful worker return. Each consumer then performs its final authority check. Retention can therefore survive revocation without restoring execution authority. See `src/worker-execution-scope.ts:79–104` and `test/controller-worker-execution-facts.test.ts:584–656`.

- **Both source reconstructions preserve facts.** Recovery and interrupted completion explicitly retain the field. Settlement preserves it through spreading. See `src/controller.ts:959–967` and `1718–1728`.

- **Retention failures remain observable through drainage.** Scope closure waits for operations, closes the journal, and reports remembered retention failure. Controller failure memory survives removal of completed drains. See `src/worker-execution-scope.ts:116–135` and `src/controller.ts:2184–2222`. Tests cover failure before close, during close, and after callback abandonment at `test/controller-worker-execution-facts.test.ts:515–582`.

- **Reads remain detached and history does not backfill facts.** Dedicated inspection reads controller storage only. Historical inspection validates source facts before journal selection and returns separately labelled provenance. See `src/controller.ts:537–558`, `575–631`, and `test/controller-worker-execution-facts.test.ts:37–113,218–262`.

- **Coverage remains deliberately partial.** Capture requires successful `journal.consume` return. The worker still checks authority before returning at `src/frozen-browser.ts:2621–2631`. Worker rejection or process death before controller commit can leave facts unavailable. No new recovery replay or history-based reconstruction was introduced.

- **Production and native admission gates remain unchanged.** Production startup still configures no offline worker integration at `src/main.ts:18–33`. Native check recording still requires completed callback output and action validation at `src/native.ts:323–325,492–578`. Retained facts do not convert outcomes or create checks/artifacts.

### Validation and test assessment

Validation is adequate for the internal successful worker-result boundary. Unused outcome/resource fields are not independently revalidated, but they neither enter retained facts nor authorize native admission. I found no demonstrated harmful acceptance requiring broader validation.

Private-method invocation and SQLite mutation in the append tests exercise internal invariants. They are not evidence of a public arbitrary-result submission API. Public callback tests separately cover persistence before delivery, detached values, joined consumption, reopening, and late-return rejection.

### Fixed

None. Review-only assignment.

## Exact reviewed snapshot

SHA-256 values and byte counts were independently computed by the parent using `shasum` and `wc`. The parent reported all four manifest checks as matching.

| File | Bytes | SHA-256 |
|---|---:|---|
| `src/controller.ts` | 92240 | `99c61e46de995e95297af9a64ace7a8c781fdc8cb57e72e804dc0ca8f03c5db2` |
| `src/worker-execution-scope.ts` | 4123 | `7c02e6cc8aded930a7f02ee914dc43439a43c72fe23303310fa26c7d67039919` |
| `test/controller-worker-execution-facts.test.ts` | 27289 | `12714f558df163191c78f41d83f945ee6fe8a5cbfe6e38cd75ef5c92e0efe97c` |
| `test/worker-execution-scope.test.ts` | 5283 | `599002596853ac5d5e929932c76409d56eff962a3a3ab144bab85a5bace1e156` |

## Verification and limitations

- Read both requested patches and the complete hash manifest.
- Read the parent-produced focused test log, `.audit/execution-facts-parent-focused.txt`. It records **23 passed, zero failed/cancelled/skipped**.
- This reviewer had no execution or hashing tool. Hash verification and test execution are parent-supplied, not independently executed here.
- The supplied full-verification log was incomplete when inspected. Final `npm run verify:all` success remains for the writer/parent to confirm.
- Committed Git ranges were not independently inspected. The supplied patches and identified four-file snapshot are the review target. Later documentation or source changes are outside this verdict.

## Principles applied

Read `poteto-mode/SKILL.md` in full, including Principles, before repository review.

- **Boundary Discipline** kept validation assessment focused on retained identity and the internal worker-result boundary.
- **Test Behavior, Not Implementation** separated public behavior coverage from private append-invariant tests.
- **Prove It Works** required explicit attribution of hash/test evidence and left unfinished full verification unclaimed.

## Merge verdict

**OK with notes.** No correctness blocker in the reviewed snapshot. Confirm completed full verification before merge.