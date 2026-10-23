# Frozen validator engine compatibility

## Completed slice

This closes the engine-pin conflict recorded in the [fixture-scenario checkpoint](../fixture-scenarios/verification.md#limits-and-local-trail). Fresh frozen-validator journals now use the same reviewed Docker 29.8.2 ARM64 seccomp baseline as the guarded fixture recipe. No engine installation, global Docker change, broader syscall grant, worker change, or production activation occurs.

The change is tested as uncommitted source on base `1f161d9`; [retained observations](observations.json) identify all five modified source/test files by SHA-256. That manifest also identifies the unchanged modern vendor profile and trusted worker scripts. Tests and implementation are committed together with this record.

## Contract

- Fresh journals pin engine 29.8.2, ARM64, commit `8af9fe3a36bab3e039862a2ab1cef1880c9b4d03` or its exact observed seven-character spelling. Other versions, architectures, partial prefixes, and mismatched full commits fail before build or container effects.
- The vendor baseline remains the existing file at `scripts/profile-reconciliation/seccomp/docker-29.8.2.json`, SHA-256 `536529b665dd0972c37bfb569f5d4ac8a53592e7b00752bc39ff063ca9864c74`. The shared generator adds exactly the existing seven ARM64 namespace/chroot rules. Resulting policy SHA-256 is `1ccf001ef888765cf5e09948c6060646e88391517f8261bbb2781096a5e1bfce`.
- AF_ALG and AF_VSOCK denial remain intact. UID/GID, dropped capabilities, sandbox checks, mounts, networking, resource limits, admission accounting, deadlines, and ownership-checked cleanup are unchanged.
- Existing journals select the legacy or modern profile by exact saved policy bytes. Their configuration digests must still match the full original asset/configuration fingerprint. No journal, acceptance, receipt, or accounting schema is migrated or silently rewritten to use a new policy.
- Legacy journals retain their original `47eeb7cb129217de287f9244d5f539bf24657c57b57f6d41cc2677103963b8f3` configuration digest. Legacy execution requires 29.4.0 ARM64 and its full reviewed commit or exact observed eight-character spelling. Historical parsing now uses the same exact identity check as dispatch rather than accepting arbitrary commit prefixes.
- Upgrading the host does not authorize new-policy execution in an old journal. Such work fails conservatively. Cached history can still reopen without execution, and owned cleanup keeps its existing semantics. Unknown policies or inconsistent metadata fail closed.

The modern vendor bytes and provenance were reviewed in the preceding fixture step; this change reuses them rather than downloading a new profile. Older standalone prototypes retain their original engine pins and are not upgraded by this slice.

## Verification

| Command/check | Result |
|---|---|
| `npm run verify:all` | 1,799 Node tests and 30 Rust tests pass; lint, formatting, type/syntax checks pass |
| Opt-in Docker suites below | 22 tests pass |
| Separate actual socket control using the shared generator | AF_INET succeeds; AF_ALG and AF_VSOCK return EPERM; owned container removed |

Passing full suites have no failures, cancellations, skips, or ignored Rust tests. Existing Rust dependency future-incompatibility notices remain. This TypeScript project has no separate emitted build script; its compilation gate is `npm run check` within verification. Rust Clippy/tests compile the native application targets.

The four new validator regressions cover modern fresh policy/provenance, exact engine rejection before side effects, full commit acceptance, and legacy configuration/history without replay. The policy regression compares every unchanged baseline rule and all seven additions and rejects mutated input bytes. Existing lifetime, acceptance, historical-reader, corruption, SIGKILL, and cleanup checks run in the full suite.

The opt-in acceptance command is:

```sh
EITRI_FROZEN_DOCKER_ACCEPTANCE=1 node --test --test-concurrency=1 \
  test/integration/frozen-browser.test.ts \
  test/integration/controller-consumed-report-handoff.test.ts
```

It uses the existing `orbstack` context and pinned local base image. Actual tests cover sandbox status and kernel process witnesses, denied host/socket access and egress, read-only source, A after B, candidate classifications, screenshot integrity, event completeness, cancellation, watchdog deadlines, crash/reopen without replay, unresolved build accounting, and controller/native report and PNG persistence with the faux provider.

Read-only post-run inspection finds 13 retained validator journals and 39 settled runs. Every saved provenance-bearing report identifies the modern engine and policy. One deliberate unknown-build case retains incomplete cleanup. The controller's two separate fixture roots and diagnostics are named in the raw Docker log. Current owner-filtered container/image listings are empty; the original base image remains. Retained roots and build cache are not reclaimed. Empty current listings do not disprove late effects of the deliberately unresolved daemon build.

## Corrections and review limits

The first test draft calls a nonexistent `run` method; it is corrected to the existing `validate` interface before the meaningful red run. The corrected red run exposes the old policy hash, old-engine admission, and modern-engine rejection. Green regressions then pass. A preliminary fingerprint probe fails on macOS's `/var` symlink spelling and succeeds after canonicalizing the temporary root. An early broad focused command reaches its 240-second harness timeout while still passing tests; it is incomplete, not a passing suite. The final full run has an adequate deadline and completes.

Direct source/security review checks exact pinning, policy preservation, legacy configuration identity, shared historical/dispatch checks, bounded file acquisition, and unchanged execution/cleanup restrictions. It catches an error-precedence regression: missing journal files must be rejected before reading the saved policy. The shape guards are moved ahead of profile selection; existing missing/unsafe-storage regressions pass. Two attempted scripted guard moves fail without changing files because a truncated read omitted the target. The final targeted edit succeeds.

Review is performed by the implementing assistant. No independent agent, second-model, or cross-family review is claimed. Legacy engine execution uses synthetic CLI transcripts, not a running 29.4.0 daemon. The new actual-Docker results establish the synthetic validator/controller contract on 29.8.2, not immutable full React application validation, a genuine model repair, or full M2 acceptance.

Local raw logs and instruments are under `.audit/validator-engine/`: `red.txt`, `red-corrected.txt`, `green.txt`, `guards.txt`, `focused.txt` (incomplete), `verify-all.txt`, `docker-acceptance.txt`, `socket-controls.txt`, `modern-sockets.json`, `check-modern-sockets.mjs`, and `record-evidence.mjs`. Log hashes and source hashes are retained in the observations. The local record producer needs retained temporary journals; their absence must not be treated as regenerated evidence.

The demonstration sibling, production main/HTTP/intake, dependencies, worker assets, Rust source, credentials, live services, inference, publication, and deployment are unchanged. Immutable full-application controller validation, the sibling's local baseline commit, full M2, and later human-presence gates remain open.
