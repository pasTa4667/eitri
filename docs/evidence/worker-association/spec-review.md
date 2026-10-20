## Review

PASS. No issues found.

- Correct. Configuration is copied and validated before the first await. Journal identity expectations come from caller configuration, remain pinned in catalogue metadata, and are checked before case recovery and on every inspection. See `src/controller.ts:154-193,246-251,321-355`.
- Correct. Intent uses the selected frozen tuple and final allowance. Its synchronous persistence follows the final authority check and precedes callback entry without an intervening await. See `src/controller.ts:1205-1242`.
- Correct. Strict parsing checks intent against retained action, source, role and allowance. Settlement and both interruption constructors preserve it. Historical lookup does not require current execution authority. See `src/controller.ts:503-579,703-737,1309-1332`.
- Correct. Correlation requires the exact case/action/epoch key, complete request equality, request digests and pinned configuration. Another action or epoch cannot substitute. Results are detached. See `src/controller.ts:357-390`.
- Correct. Inspection uses literal journal-only mode, closes ownership in `finally`, serializes with workspace operations and drains before controller storage closes. See `src/controller.ts:321-338,392-397,1772-1789`.

### Tests assessed literally

The added suite asserts original allowance `58766`, exact baseline/candidate requests, same-key conflicts, unrelated-key absence, detached results, immutable configuration, identity rejection, failure closure and accepted-inspection drainage. Genuine SIGKILL tests check both sides of intent persistence, preserved history and zero callback replay. See `test/controller-worker-association.test.ts:26-551`.

The remaining tests exercise malformed options, retained-intent corruption, detached settled cleanup and journal failure before case recovery. See `test/controller-worker-association.test.ts:554-699`. Synthetic fixture guards prohibit validator execution and observe attempted Docker invocation. See `test/controller-worker-association-fixture.ts:188-233`.

### Limits and method

Journal opening can recover SQLite and convert pending runs to uncertainty before controller identity comparison. That is explicitly accepted by the cross-judge and documented in `docs/worker-association.md:40-46`, not a new read-only guarantee. Historical journal dependence and same-UID filesystem trust also remain documented limits.

I read the complete parent-supplied exact-range patch, all changed source/tests, the synthesis, complete cross-judge, association documentation and prior work-log checkpoint. No shell or execution tool was available, so I ran no tests or probes. The reported parent verification was not treated as correctness proof.

Prove It Works shaped direct source verification rather than reliance on the green suite. Test Behavior, Not Implementation shaped inspection of literal outputs and crash assertions.

- Fixed. None. Review-only.
- Merge verdict. **OK**.