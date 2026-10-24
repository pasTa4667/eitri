# Installed local fixture baseline

## Completed slice

This completes the local baseline-checkpoint item of M2, starting from controller commit `f77ff76`. The reviewed four-scenario overlay is installed into `../eitri-test-web-app` and committed locally as **`103db4755657e9a1595120164242a7b9323defcd`**, tree `42a6a5bad3278f8677c092cee5b32011b424f77e`. Its original branch remains `master`. No push, branch rename, monitored-build activation, or service restart occurs.

The initial commit contains exactly 30 paths: the 28 reviewed scenario inputs, the original README, and the strengthened `.gitignore`. The existing package manifests/lockfile, normal-path tests, reconciled profile helper, and 14 non-overlaid inputs are unchanged. Only the original App and instrumentation files are overlaid; 12 new scenario files are added. Both intended defects remain present. Candidate fixes/regressions exist only in disposable validation variants.

The README checksum is unchanged. The existing `.env` is never read, copied, or staged; its inode, mode, size and modification time remain unchanged. `.env` and `.env.*` now join generated/dependency output in `.gitignore`. Explicit staging and a complete index-set assertion exclude every other path. Final sibling Git status is clean, with environment/output paths ignored.

[Observations](observations.json) retain exact source identities, the local commit/tree, preservation checks, input digests, actual response-byte proof, outcomes and cleanup. The manifest agrees exactly with the prior committed scenario observations. After the local commit, every allowlisted Git blob is independently compared with the runtime's captured input descriptor.

## Installed verification mode

```sh
node scripts/profile-reconciliation/verify.mjs \
  /absolute/canonical/path/to/eitri-test-web-app \
  /absolute/canonical/path/to/new-evidence --installed
```

The flag selects the fixed 28-file installed manifest. The original 16-preimage mode remains available for retained pre-reconciliation snapshots. Installed mode captures actual installed bytes without applying patches or substituting overlays, then joins the existing contained five-variant recipe. It does not inspect Git, acquire ambient files, execute project code on the host, or accept arbitrary candidate trees. Its report retains `operator-approved-uncommitted-copy` acquisition provenance and explicitly identifies `installed-scenarios-v1`; the later blob comparison does not retroactively change that provenance.

The existing exact modern-engine policy, dependency-only registry preparation, no-network/non-root application execution, source-copy allowlist, browser sandbox launch requirements, resource ceilings, fresh build/preview checks, fixed literal assertions and ownership-checked cleanup remain unchanged.

## Actual contained results

| Variant | Unit pass/fail | Browser pass/fail |
|---|---|---|
| Installed baseline | 30 / 0 | 8 / 0 |
| Profile regressions on baseline | 30 / 5 | 8 / 1 |
| Profile-only scripted candidate | 35 / 0 | 9 / 0 |
| Cart regressions on baseline | 30 / 2 | 8 / 1 |
| Cart-only scripted candidate | 32 / 0 | 9 / 0 |

All five builds pass. Each variant records compiled-response provenance and stops preview. Only designated target assertions fail in red variants; normal paths and expected/transient controls stay green. Paired regression bytes and unaffected helpers remain identical. There are no retries or skipped assertions. This is actual Chromium execution of synthetic local inputs with reporting disabled, not hosted Sentry compatibility or an AI-generated repair.

The recipe removes all five owned containers, both generated images, its temporary base alias, and scratch. Independent owner-filtered listings find no remaining owned containers/images. The original base and Docker build cache remain. Evidence outside scratch is retained; no global prune runs.

## Tests, compilation and review

- RED: the new portable installed-mode test fails against the old verifier's CLI guard. A separate actual sibling pre-install check fails on the missing scenario input before Docker effects or evidence-directory creation.
- GREEN: the installed-mode materialization checks pass. Final portable coverage includes missing inputs, symlinks, hardlinks, changed size, same-size checksum substitution, unexpected CLI mode, ambient `.env` exclusion, no patch subprocesses, and real-manifest drift against the prior reviewed baseline.
- `npm run verify:all` passes **1,800 Node tests and 30 Rust tests**, plus lint, formatting and compilation checks. It starts before the final review-only test additions and negative-control expansion. The production verifier is unchanged afterwards.
- Post-review `node --test test/profile-reconciliation*.test.mjs` passes **20 tests**, including all final new tests/controls. This is separate final-source verification, not a claim that a single full run contained all 1,802 final Node tests.
- Final `npm run lint:ts`, `npm run format:check:ts`, and `npm run check` pass after the test edits. There is no separate emitted TypeScript build; `check` is its compilation gate. Rust targets compile in the full verification. Existing Rust dependency future-incompatibility notices remain.

Passing suites have no failures, cancellations, skips or ignored Rust tests. A first evidence-extraction attempt tries to parse a truncated tool response and fails without changing files; the corrected bounded summary uses the complete local report. That is not a runtime or test failure.

The requested [five-axis review](review.md) identifies and addresses environment-file staging, descriptor-drift/same-size test gaps and stale engine instructions. Review is by the implementing assistant; no independent-agent or second-model review is claimed. Final source hashes are retained in observations.

Local raw evidence is under `.audit/fixture-baseline/`: `before.json`, `preservation.json`, `red.txt`, `pre-install-red.txt`, `green.txt`, `review-green.txt`, `verify-all.txt`, `verify-all.exit`, `final-check.txt`, and `runtime/report.json`. The committed portable tests and recipe are rerunnable without these local logs.

## Remaining boundaries

This is a source baseline checkpoint and offline verification recipe, not an activated deployment. The synthetic reporting label is still not a full Git release; known-revision monitored-build activation stays gated. The directory must remain operator-owned and quiescent during acquisition; no hostile same-UID race guarantee is claimed. The recipe does not perform immutable full-application validation through the controller or complete M2. Those remain the next integration boundary, alongside later explicit credential, inference, publication and deployment gates. No credentials, live APIs, application inference, global Docker settings, dependency upgrades, controller production dispatch, containment rules, or Rust source are changed.
