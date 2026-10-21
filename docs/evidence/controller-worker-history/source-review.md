# Independent source review

## Verdict

Pass. No correctness or chosen-contract blockers found against `9500610`, including untracked `test/controller-worker-consumed-history.test.ts`.

Artifact writing was blocked because the authoritative path is outside the working directory. This complete report is returned for runtime persistence at:

`/Users/felix.langbein/.pi/agent/sessions/--Users-felix.langbein-projects-eitri--/subagent-artifacts/outputs/f6804ac4-6b41-46e1-a5c4-87ec4f64e886/.audit/controller-report-source-review.md`

This is source assurance, not live containment proof. No tests ran. The writer owns runtime validation.

throughput checkpoint: n/a, read-only investigation

## Contract assurance

- `src/controller.ts:469-536` uses action-only inputs. It validates the source, copies the configured binding, and detaches retained intent before asynchronous work. Valid sources without intent return exactly `{ state: 'unrecorded' }` without acquisition. `source()` preserves missing-source and foreign-source validation.
- `src/controller.ts:489-535` holds one workspace queue callback through acquisition, selection, guard, and synchronous journal closure. Every registered consumption scope causes busy rejection, including lazy and revoked-but-draining scopes. Later scope opening uses the same queue and cannot overtake historical closure.
- `src/controller.ts:501-520` compares the complete request, recomputed observed and retained digests, stored digest, and configuration identity. Request mismatch precedes legacy classification. Different action tuples produce absence.
- `src/controller.ts:88-116,510-535` labels journal-derived observations and explicitly marks independent execution pins unavailable. The query does not invoke a converter, construct converter expectations, sample current allowance, or manufacture native receipts.
- `src/frozen-browser.ts:1920-1985` snapshots and validates reader inputs before awaiting. It performs one existing-only historical acquisition, selects the exact action tuple, guards every successful result including null, detaches the result, and closes before resolution.
- `src/frozen-browser.ts:2119-2249` uses a read-only connection. Deferred `BEGIN` follows trusted-schema configuration and precedes database validation reads. Metadata and records share that transaction through final guard and closure. Existing-only validation prevents fresh provisioning.
- `src/frozen-browser.ts:327-359,2230-2252` retains file identity, mode, regular-file, owner, policy, and rollback-sidecar guards. The historical path avoids writable reopening, recovery, save, and finalization. Closure and acquisition cleanup release process-local ownership in `finally`, including rejection paths.
- `src/controller.ts:2080-2118` keeps revoked scopes registered through drainage and tracks complete inspection promises with rejection handling. Close drains queued work and inspections before workspace/catalogue closure. Already admitted reads can finish. Later admission rejects. Query rejection alone does not fail controller close.
- `src/frozen-browser.ts:1868-1918` preserves shared exact-selector matching and rejection semantics. The extracted projection reconstructs selector values already checked equal. The required historical transaction is the only shared-loader behavior change.

## Tests

Read the changed reader/controller tests, association tests, and supporting association/cleanup fixtures.

The tests assert concrete result structures for baseline/browser intent, absence, legacy conflict, unconsumed acceptance, pending, recorded, and settled history. They cover diagnostic null evidence, incomplete cleanup, shortened historical execution timing, original intent after edits/retry/reopen, selected-record decoys, detached mutations, malformed attribution, storage errors, ownership contention, no-effect snapshots, scope lifetime stages, queued opening, close ordering, and failure release.

`test/frozen-browser-consumed-report.test.ts:657-899` checks write rejection, SQL statement order, transaction state during validation and closure, input capture, and final guards across semantic branches. Existing tests retain exact-selector mismatch and legacy rejection coverage.

No significant test gap blocks this source verdict.

## Optional improvement

**P3. Add controller-level queued-input capture coverage.**

`test/controller-worker-consumed-history.test.ts:591-690` gates acquisition and guard but does not directly protect the controller capture at `src/controller.ts:484-488`. The lower-level reader input-capture test cannot detect a future regression that moves controller `source()` loading into the queued callback.

Concrete test sequence:

1. Gate the first history read.
2. Enqueue a second read for the same action.
3. Replace the catalogue source with a different internally valid retained request.
4. Release the gate.
5. Assert that the second read uses its originally captured intent and correlation.
6. Restore the source row.

Current source is correct by inspection. This is optional regression coverage, not a demonstrated defect.

## Validation and hashes

`git diff --check 9500610` passed. All five hashes were recorded twice without changes.

```text
9bd7a301345f59302a996ea48c770393394d51b6f669bf5a09fb37e7035be962  src/controller.ts
2e27738f5ebf13d7dd48bec16d11cf4b7adf911005c4b00a51387af8543a282b  src/frozen-browser.ts
2760f9e0477c727ede0caa67f1475f7382a53cea07d5835288875c2b36dd1ff6  test/controller-worker-association.test.ts
1ea1dd174b7db6c62aad6abd9dd412b2ef3f74db587f1aed41c63fd83f45748b  test/frozen-browser-consumed-report.test.ts
38ba7d8ea772989b4ff08c3f5fee6b7b91a8d6c2b6bac37d95aff8a1897471da  test/controller-worker-consumed-history.test.ts
```

The writer also added `docs/controller-worker-history.md` and updated `docs/consumed-admission.md` during review. Both were read and agree with the implementation.

Residual risks remain the chosen contract's limits. Journal consistency does not establish independent execution attribution or containment. Process-local ownership does not establish cross-process exclusion or hostile same-UID protection. Startup remains recovery-capable.

Poteto-mode was read fully first. Prove It Works changed verification to actual source, fixtures, diff, and hashes rather than writer reports. Test Behavior, Not Implementation changed test review to inspect concrete expected observations and effects. Both principle leaf skills were read fully. No subagents spawned and no repository files changed. The separate comment audit was not repeated.