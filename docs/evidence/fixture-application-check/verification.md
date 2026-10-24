# Verification: protected managed application checks

This slice starts at `0d923fb` and completes the next checked M2 application-validation task. The [contract](../../fixture-application-check.md), [five-axis author review](review.md) and [compact observations](observations.json) describe its scope. Full M2 acceptance is not claimed.

## Final source and results

The observations contain the exact changed implementation/test file descriptors. Their ordered JSON manifest SHA-256 is `d31e1d94134b127ae2782214d58a9202414429cee44dc45ccbce6486ed139bd0`.

- `npm run verify:all`: exit **0**, **1,837 Node tests** and **30 Rust tests** pass, with no failures, cancellations, skips or ignored tests. TypeScript checks, TypeScript/Rust lint, formatting and native test compilation pass. Existing Rust dependency future-incompatibility notices remain unchanged.
- Actual Docker controller integration: exit **0**, **2 tests** pass without retries/skips. Each test performs one baseline and one candidate execution, using real managed Git, catalogue/native SQLite, Docker, unit/build/browser tooling and artifacts. A local logging preload records real client outputs; it does not replace the Docker client or its outcomes.

| Target | Baseline unit observations | Candidate unit observations | Browser observations per revision |
|---|---|---|---|
| Profile | 30 pass, exactly 5 designated failures | 35 pass | 8 normal/control/provenance pass; the target alone fails on baseline and passes on candidate |
| Cart | 30 pass, exactly 2 designated failures | 32 pass | 8 normal/control/provenance pass; the target alone fails on baseline and passes on candidate |

All four production builds pass. Each browser run has nine exact assertions and compiled-response SHA-256 proof against freshly built output; preview teardown passes. These intentionally red baseline results establish reproduction, not a green baseline test suite. No control failure is admitted as a target reproduction.

Both cases retain two revision-bound **real** baseline/browser receipts and PNGs across controller close/reopen, with no model/check replay. Their separate managed edit checkpoints remain **simulated**. Each session intentionally parks in implementation with `assessment-required`; no publication or later phase requirement is bypassed. The original 28-input capture digest remains `d4248bff339806048ec9958ad0a43a4a55719f0a4e357d9ec4d496f14cf02718` afterward. The sibling's Git status remains clean at local commit `103db4755657e9a1595120164242a7b9323defcd` on unchanged `master`.

All four consumed runs report owned-resource removal. Direct owner-filtered Docker container/image listings are empty afterward. The separately prepared pinned dependency image and daemon build cache remain intentionally retained. No global prune occurs. PNGs show the normal compiled application view; target-specific outcomes are recorded assertions, not inferred from those images. The final normal-view PNG was also inspected directly.

## Failures, corrections and review

The initial missing-module test is RED. New input/result-corruption tests cover both targets, every installed descriptor, missing/extra/duplicate paths, combined patches, changed commands, incomplete/skipped/retried assertions, witness errors and damaged built-response proof. Invalid frozen inputs fail before Docker calls. Offline selector tests cover persisted routing and scenario-switch rejection on reopen.

Actual early runs expose a missing browser asset location in the minimal environment; the fixed `/ms-playwright` path resolves that without downloads or broader inheritance. An initially incorrect test throws while constructing a restored faux provider; it now forbids actual response/check replay instead of forbidding harmless provider construction. Neither failed invocation counts as validation evidence.

Repeated runtime checks also expose orphaned browser descendants accumulating under the existing 256-task ceiling. One later fresh-context control crashes; some larger failure reports exceed the finite subprocess buffer. Those invocations fail closed and are retained separately, rather than retried within a case or presented as reproductions. A small trusted subreaper now reaps adopted descendants without increasing resources, adding capabilities/seccomp rules, changing global Docker configuration or installing a package. The main harness exit is preserved. Three new tests cover success, failure and denied setup. The final four runs pass and each later outer census contains 15 processes with one outer-browser zombie; an earlier profile baseline has 26 processes with 12 zombies. This comparison is not a peak-task measurement.

The requested five-axis self-review finds and fixes pre-read PNG bounds/link checks, command-identity validation, missing browser-environment configuration, process-tree reaping and inaccurate documentation. It also simplifies trusted-asset assembly. There are no outstanding Critical or Important source findings. The review is not independent-agent or cross-model assurance.

Local full logs and exit files are `.audit/application-check-verify-all-final.*` and `.audit/application-check-docker-final.*`. Earlier attempts, including the pre-subreaper full 1,834-test pass and failed Docker invocations, remain separately retained. The final full-source run above includes the supervisor and all final code/tests; there is no mixed-source verification claim.

## Remaining gates

The policy admits only exact reviewed baseline and one-target scripted patch bytes, not arbitrary generated Node code or combined fixes. Protected harness tests are configuration-bound additions, not falsely attributed to application Git revisions. Bundled unit/build/browser observations do not fabricate separate native unit/regression/build receipts. The outer Chromium census is not a census of every earlier application-browser process. Worker/harness changes require fresh matching journals rather than silently migrating older configurations.

Full M2 evaluation, broader application execution, production dispatch and later human-presence gates remain open. No credential read, live Sentry/GitHub call, application inference, publication, deployment, branch rename, toolchain upgrade or demonstration-checkout change occurs in this slice.
