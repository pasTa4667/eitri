# Frozen browser validator

This module is unwired. It produces observations for an importing colleague, not a `Check` receipt, controller permission, repair-counter update, or M2 completion. No production entry point imports it.

## Interface

`FrozenBrowserValidator.open({ workspace, directory })` borrows an existing `WorkspaceStore` and owns only a separate, private validation directory. The directory must exist with mode `0700`. A nonempty directory needs the original inode-bound owner marker, SQLite catalogue, and policy file. The class never closes the workspace or removes its exports.

`frozenBrowserRequest(unknown)` parses exact host-owned data. A request contains a recorded frozen revision, matching case identity, UUID action identity, nonnegative control epoch, `synthetic-click-v1`, baseline or candidate role, and an integer allowance of 1 through 60000 milliseconds. The epoch is correlation data. It does not grant controller authority. Callers cannot supply commands, paths, images, navigation origins, expectations, scenario code, or execution configuration.

`validate(request, signal)` admits one distinct active request with no waiting queue. Exact active duplicates share execution. Any attached cancellation signal cancels that execution. A case/action/epoch identity cannot be reused with different request data. Settled repeats return detached copies of the saved report without execution. A settled repeat does not renew an allowance or repair cleanup.

`close()` refuses admission, cancels active work, drains finalization, and closes only validation storage. Callers need not await a validation promise for its finalization to run. Cleanup removes the actual owned container with `container rm --force`, not merely the attached Docker client.

## Outcome and cleanup

The protected scenario loads `src/index.html`, requires exactly one `#run` button and one initially empty `#result`, clicks the button, and reads the literal output. Startup and action must succeed without page or console errors before an observation can reproduce the target failure.

| Role | Literal A | Literal B | Literal C or startup/action failure |
| --- | --- | --- | --- |
| Baseline | baseline-reproduced | baseline-not-reproduced | unrelated-failure |
| Candidate | candidate-failed | candidate-passed | unrelated-failure |

Infrastructure failures, cancellation, and uncertainty are separate outcomes. They do not authorize speculative source repairs. Cleanup is independently `not-needed`, `owned-removed`, or `incomplete`. Every cleanup variant reports retained cache. Successful behavior with incomplete cleanup is not complete resource reclamation.

The host verifies complete records and classifies observations. Raw Docker configuration is hashed; reports expose only the verified contract and never host physical paths. Context-wide console and uncaught page errors are collected before snapshot navigation, including popups. Every page has crash monitoring. Console messages are bounded data, including strings that resemble protocol records. Overflow remains fatal through browser and server shutdown. The driver checks the sticky failure after both have closed, before serializing observations. The driver emits exactly an observations record, one PNG record, and an end record. Records bind a nonce and request digest. The host rejects duplicate, missing, noncanonical, mismatched, trailing, oversized, malformed, or incomplete output. PNG bytes pass the existing byte/MIME/CRC/decompression validator. Evidence includes host request/configuration hashes, transfer manifest, trusted asset hashes, immutable image and container IDs, inspected applied settings, namespace witnesses, deadlines, exits, and artifact hashes.

## Durable ownership and crash boundaries

SQLite uses DELETE journaling and FULL synchronous commits. Established accounting cannot be recreated after corruption or missing rows. Ownership checks reject linked files, replaced identities, foreign files, and unowned directories without adoption or chmod. Native SQLite may roll back a validated hot journal before catalogue validation. The precondition is one trusted owner with no malicious same-UID writer. Process-crash checks do not establish a hardware power-loss guarantee.

Admission durably records names, labels, request/configuration digests, an absolute deadline, and a nonrefundable reservation before effects. Acquired immutable IDs are saved before container start. Interrupted pending intents reopen as uncertain and never replay. Complete behavioral outcome and evidence are committed before disposable cleanup and acknowledgment. A crash after that commit preserves the observed outcome and independently reconciles cleanup. Missing or corrupt committed evidence fails closed. Cancellation before terminal commitment prevents success. Cancellation after commitment cannot erase an observation.

Cleanup inspects recorded resources, checks original labels and acquired IDs, and confirms removal through a successful bounded listing. A daemon error is not absence. A name or ownership mismatch remains incomplete. Unrelated resources, evidence, and original exports are never deletion targets. An unrelated container referencing the derived image can prevent image removal without changing the committed behavior. An unresolved container-creation response stays cleanup-incomplete when the recorded name is absent, because a late daemon effect has not been excluded.

Killing a build client does not prove daemon-build cancellation. A lost build response leaves its build state unknown and blocks all further admission, including after reopen. This implementation has no automatic build-status recovery or quota-reset operation. Even a missing image is not completion evidence. Names, labels, and reservations remain recorded for parent diagnosis. The module deliberately does not infer completion from a later tag alone.

## Fixed execution contract

The worker image has COPY instructions only and no RUN instruction. Context bytes come from `WorkspaceStore.readFrozen` and checked-in trusted assets. Source modules, package scripts, dependency installation, build systems, tests, and configurations never run in Node. The trusted driver serves allowlisted static HTML, JavaScript, CSS, and image assets. Project JavaScript runs only in sandboxed Chromium at the private static origin. Service workers and other navigation origins are blocked. Static responses set `Content-Security-Policy: worker-src 'none'` to prohibit dedicated and shared workers for this fixed synthetic scenario. Worker denial console errors prevent eligible success, and an unexpected dedicated-worker event is a sticky driver failure. This is a scenario feature restriction, not a sandbox relaxation or a claim of general project compatibility.

The Dockerfile copies only the fixed trusted assets `driver.mjs`, `watchdog.mjs`, and `scenario.json` into `/opt/eitri/frozen-browser/` with root ownership and read-only mode `0555`. This mode keeps the asset directory traversable without write permission. The fixed Node entrypoint executes only the trusted JavaScript at absolute paths. Snapshot directories remain `0555`, and snapshot files remain `0444`. The build-context tar retains its existing directory mode `0555` and file mode `0444`, including trusted asset files. The COPY instruction applies `0555` only to the trusted assets in the image. It does not enable source execution in Node.

The local base tag is `eitri-chromium-probe:1.64.1-node26.5.0`. Its required immutable ID is `sha256:57911b2d47725e1d19e25203b82d7c90a3160da1815f78a9c66b42a89dd1ddff`. The host checks Linux/ARM64, absent ONBUILD hooks, the base before and after the build, and the exact base layer prefix in the derived image. There is no registry, base, platform, or tag fallback. The CLI selects the existing `orbstack` context without modifying it.

The approved policy digest is `c85c2b40abc8ca15cace108b94f91e337b73313c8288b03c41d1ca51fe239bd7`. It reuses the existing seven-rule ARM64 policy generator and pinned Moby baseline for engine 29.4.0, commit prefix `daa0cb7f`. The applied container contract requires UID/GID 1001, cap-drop ALL with no additions, no-new-privileges, two CPUs, memory and swap ceiling 4 GiB, PIDs 256, no network, no host mounts, read-only root, private IPC, 256 MiB shared memory, 256 MiB private tmpfs, zero core limit, and no restart. Image, entrypoint, command, and environment bindings are inspected before start. Environment comparisons reject duplicate keys and compare exact bindings without depending on order.

Chromium uses the full bundled channel with sandbox enabled and a debugging pipe, not a listening debugging port. Required sandbox rows are exact. The driver inventories every numeric top-level `/proc` entry, including unlabeled helpers and zombies. It never reads command lines or executables. Browser-scoped CDP supplies only positive browser and renderer labels, joined to kernel PID and start-tick identities. The browser must be a live, initial-namespace child of the driver. A label alone grants no capability exception.

Every captured process requires UID1001, NNP1, seccomp2, canonical namespace and PID identities, bounded maps, and complete acyclic parentage to PID1. Initial-namespace effective, permitted, and bounding masks must all be zero. Every nested process requires exact single-entry `1001 1001 1` UID/GID maps and nested NSpid. Its bounding mask may be zero or exactly `000001ffffffffff`, independently of effective and permitted capabilities. Those two masks must both be zero unless the process is a live direct parent of a positively labeled live renderer in the same nested user namespace, with ancestry to the labeled browser. Only that renderer-parent relationship permits exact `0000000000200000` in both masks. This evidence rule does not change Docker grants, seccomp, launch flags, or quotas.

Collection accepts two matching whole-container scans and matching CDP labels within at most three attempts. Each process also has matching identity and parentage checks around security reads. Live scheduler changes such as R to S do not invalidate a scan; live-to-zombie transitions do. Disappearance invalidates the attempt, and inaccessible required fields fail closed, including for zombies. The census is bounded to 256 records and the existing protocol byte limits. It observes a collection window, not every process over the container lifetime or every thread.

The separate immutable PID1 watchdog checks the absolute deadline before launching the driver. It enforces the remaining time independently of the driver event loop and host process. Preparation and execution share the original allowance. Cleanup gets one additional attempt of at most 10 seconds of CLI time. An orphaned daemon build has no claimed watchdog bound.

## Limits and retained cache

Source bounds remain 1 MiB per file, 1024 files, and 32 MiB total under the existing canonical path policy. Complete tar context, including trusted files, directory entries, PAX headers, and padding, cannot exceed 40 MiB. Each admitted attempt reserves 40 MiB. There are at most 16 lifetime admissions and 640 MiB of supplied-input reservations. Failures, cancellation, cleanup, and reopen never refund them.

These bounds limit contributed inputs and derivation attempts. They do not bound physical daemon disk allocation, compression, metadata, resolver traffic, or other workloads. Image removal does not establish recovered disk space. Build cache is retained and never globally pruned. `--pull=false` and `--network=none` do not establish an offline resolver guarantee. Explicit network/authentication diagnostics fail the build, but absence of those diagnostics is not network proof.

Control records are limited to 256 KiB, complete framed stdout to 6 MiB, stderr to 64 KiB, one PNG to 4 MiB, and retained evidence to 8 MiB per run. Base64 and archive overhead count. Valid source or artifacts that cannot fit the bounded protocol are rejected rather than silently truncated or accepted as partial success.

## Verification status

Fast tests use real temporary Git and SQLite plus a private executable transcript and real host SIGKILL fault cases. The test PATH contains only that executable. It has no fallback to the actual Docker CLI. These tests establish lifecycle/protocol behavior, not containment. The COPY-context guard checks the literal Dockerfile and extracted tar modes. It does not prove actual Docker image permissions or that Node can load the watchdog.

A private VM fixture also executes the checked-in trusted driver with mocked filesystem, HTTP, and Playwright dependencies. It never evaluates snapshot JavaScript in Node. It exercises actual driver event collection, whole-container scans, CDP joins, disappearance retries, PID reuse, unreadable witnesses, stable zombies, worker-policy response headers, and byte/count overflow during screenshot, census, browser close, and server close. Mocked worker denial events verify collection, not browser CSP enforcement. The no-fault control still emits complete B observations. These checks do not establish real Playwright event ordering or worker restrictions.

The default `npm test` glob excludes `test/integration/`. After independent source/security review, the parent can explicitly run:

```sh
EITRI_FROZEN_DOCKER_ACCEPTANCE=1 node --test test/integration/frozen-browser.test.ts
```

Calling that suite without the opt-in fails rather than skips. The suite uses the same class interface and synthetic fixtures. It covers A after B, role distinctions, PNG/provenance integrity, console forgery and overflow, source-Node canaries, inspected restrictions and raw namespace witnesses, cancellation of actual execution, host SIGKILL at intent/effect/result/acknowledgment boundaries, PID1 deadline enforcement, label-checked cleanup with unrelated containers, failed cleanup after committed behavior, persistent reservations, and unknown-build blocking. The interrupted-build case deliberately retains its validation directory and possible derived image because daemon completion is unresolved. Its printed ownership directory needs parent diagnosis, not global pruning.

The event-completeness regressions add popup console errors, uncaught errors, overflow, and dedicated/shared-worker attempts before candidate B. A deterministic late-overflow fixture observes the shared DOM for Playwright's screenshot caret-hiding style, then logs overflow from that MutationObserver. Its benign control must both pass B and retain `screenshot-preparation-observed`. A missing marker fails compatibility rather than passing or skipping the regression. The trigger exists only in synthetic snapshot bytes. Compatibility with the pinned Playwright screenshot path remains unverified until the parent runs the actual-Docker suite.

Actual-Docker acceptance remains a separate parent-run gate. Fast tests do not establish runtime compatibility, applied daemon defaults, process-census race handling under load, watcher timing, image derivation, build interruption behavior, resolver activity, retained cache growth, or physical disk use. Historical test counts are not evidence for this revision.

Model the Domain separated outcome, cleanup, intent, result, and resource states. Type System Discipline put semantic identity parsing at admission. Boundary Discipline kept protocol and CLI parsing outside classification. Make Operations Idempotent kept settled repeats and recovery from rerunning effects. Sequence Work into Verifiable Units separated fast lifecycle checks from gated runtime acceptance. Test Behavior, Not Implementation made class-interface reports and durable effects the assertions. Laziness Protocol excluded controller wiring, run handles, observers, and generalized command/scenario languages.
