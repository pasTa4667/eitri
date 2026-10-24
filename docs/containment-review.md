# Chromium containment review

## Status

The standalone trusted Chromium feasibility probe passes with the explicitly approved seven-rule policy and 256-task ceiling. The browser reports namespace, PID, network, and seccomp-BPF protection and completes an actual page click/result assertion. The later managed worker, frozen application scenarios and offline controller integration are implemented; the [M2 evaluation](m2-acceptance.md) records their combined acceptance status. The experiments below retain their historical engine/image identities. Arbitrary generated commands, production dispatch and later human-presence gates remain disabled.

M0 is implemented and verified. The native GPUI build, input handlers, and real controller connection pass their tests. M1's scripted native input, transport, visual, and artifact checks are accepted with evidence in `docs/native-rendering.md`. This does not establish browser containment or live remediation readiness. The probe below uses only a trusted fixed script, not an agent-generated command or a repository mount.

## Reproduce

```sh
docker --context orbstack build --platform linux/arm64 \
  -t eitri-chromium-probe:1.64.1-node26.5.0 prototypes/chromium
node prototypes/chromium/run.mjs --namespace-chroot-pids256-policy
```

The default `npm run probe:chromium` retains the built-in policy and is not the supported opt-in experiment.

Both base images are pinned by ARM64 manifest digest in `prototypes/chromium/Dockerfile`. The image uses Node 26.5.0 and matching Playwright package/browser version 1.64.1. The pinned image's `pwuser` is UID 1001, not an assumed UID 1000; private scratch uses the actual UID.

`prototypes/chromium/run.mjs` creates one labeled container, inspects the applied settings before starting it, records a bounded report, and removes that specific container. Its trusted process has a fixed two-minute lifetime. No global Docker context, shell, toolchain, kernel setting, or security policy is changed. The locally built prototype image is retained for reproduction.

## Initial baseline result

`docs/evidence/chromium-containment.json` records:

- Linux ARM64 and Node 26.5.0 under non-root UID 1001.
- No host mounts, no Docker socket, and no access to the known non-secret host-home sentinel or controller source.
- External network connection denied.
- Read-only root enforced and private bounded scratch writable.
- Zero effective capabilities, `NoNewPrivs: 1`, and `Seccomp: 2`.
- Cgroup limits observed as 4 GiB memory, two CPUs, and 128 PIDs. IPC and 256 MiB shared memory remain private.
- `chromium.launch({ chromiumSandbox: true })` fails with **No usable sandbox!** before a page action or assertion occurs.
- The probe container was removed successfully.

No browser action, screenshot, or sandbox-positive result is claimed. The error mentions possible user-namespace/AppArmor restrictions; it does not establish whether Docker seccomp, the host kernel, AppArmor, or another restriction is the sole cause.

## Review recommendation

[Playwright's Docker guidance](https://playwright.dev/docs/docker) documents a non-root browser and a seccomp adjustment allowing `clone`, `setns`, and `unshare` for user namespaces. It also recommends host IPC and mentions `SYS_ADMIN` troubleshooting. Those latter options conflict with this pilot and must not be used. Its generic profile must not be copied blindly over the newer installed Docker baseline.

Before another browser attempt, review a narrowly scoped candidate policy derived from the installed Docker profile. Test it only with the same non-root, no-new-privileges, capability-drop, no-network, private-IPC, read-only, resource-bounded contract and no repository mounts. Keep `chromiumSandbox: true`. Treat another failure as failure.

Changing syscall admission is a security-policy change, not a passing test or an automatic fallback. The continuation instruction was interpreted as approval for the narrow namespace diagnostic below. Any further admission remains separately reviewed and gated. No `seccomp=unconfined`, privileged container, `SYS_ADMIN`, host IPC/network, global AppArmor toggle, or `--no-sandbox` workaround is authorized.

## Earlier six-rule namespace diagnostic

The pinned baseline is the vendored profile from Docker Engine commit `daa0cb7f23594cdbcce5002e370027d3fd36ffd7`. Its SHA-256 is `01536f1d1df938ae611eba20d6349e0de7a99b6ecdee1549427a0b01b8301e28`. The installed daemon reports Engine 29.4.0, ARM64, and commit `daa0cb7f`. Matching reported source provenance is not an independent audit of the installed binary.

`prototypes/chromium/policy.mjs` appends only six ARM64 equality rules to that unchanged baseline. Five admit exact `clone` flags involving USER, PID, and NET namespaces. One admits USER-only `unshare`. The structural test proves that no other baseline rule changed. `setns`, `chroot`, mounts, and the `clone3` ENOSYS fallback remain unchanged. The runner verifies the applied custom JSON before starting a container and retains every other restriction.

An independent source review found no security blocker to this diagnostic. It identified a cloned-child exit-status check, which was added before the final paired runs. Both runs use the same rebuilt image, `sha256:587e1d93485ee9e32dce53c271dd9b0fe54a1651c6313ebeb9ea6f05b4451911`.

- `docs/evidence/chromium-containment-pinned.json` records USER namespace operations denied under the unchanged pinned policy and the earlier `No usable sandbox!` browser failure.
- `docs/evidence/chromium-containment-namespaces-before-chroot.json` preserves the earlier six-rule report, with all five positive USER namespace controls succeeding. Negative controls still return EPERM for mounts, `setns`, and tested MOUNT, IPC, UTS, and CGROUP namespace requests. `clone3` still returns ENOSYS.
- The candidate browser launch reaches a new failure, `Check failed: sys_chroot("/proc/self/fdinfo/") == 0`. No browser page action or assertion succeeds.
- Both runs observe the original no-network, no-host-mount, non-root, no-new-privileges, read-only, dropped-capability, private-IPC, and resource limits. Both owned containers were removed.

The pinned [Chromium credentials implementation](https://raw.githubusercontent.com/chromium/chromium/156.0.8078.4/sandbox/linux/services/credentials.cc) calls `chroot` as part of dropping filesystem access in its namespace sandbox. Docker's baseline admits `chroot` only when the original container capability set includes `CAP_SYS_CHROOT`; that rule is inactive under `--cap-drop ALL`. The source and new error are consistent with that denial. No syscall trace was collected, so the precise errno at this call is not claimed.

A separate experiment could admit `chroot` while still dropping every container capability. The kernel would still require the appropriate namespace-local capability. Seccomp cannot restrict its pathname argument to `/proc/self/fdinfo/`. That is an additional syscall-admission change. The operator has now explicitly approved this single trusted experiment with all other restrictions unchanged. The operator also invited discussion of further easing if evidence warrants it; no additional relaxation is approved by that invitation. The candidate must receive source review before use. There is no automatic retry with a broader policy.

The [diagnostic instructions](../prototypes/chromium/seccomp/README.md) document reproduction and limits.

## Earlier approved chroot experiment

Commit `8cba063` adds the opt-in `--namespace-chroot-policy` candidate. A fresh same-family source review found no actionable issues for this trusted diagnostic. Structural tests prove its only delta from the six-rule namespace policy is one ARM64 `chroot` allowance. Defaults and all other container restrictions remain unchanged.

Paired runs on image `sha256:db7b7c641e9a4b575d1304b092809474beb374aa096995f851c7887c227ef22e` are preserved as `chromium-containment-namespaces-headless-shell.json` and `chromium-containment-namespaces-chroot-headless-shell.json` under `docs/evidence/`. Both pass the USER namespace and negative controls. The six-rule run still fails at `sys_chroot`. The seven-rule run launches and creates a page, but the headless-shell browser rejects navigation to `chrome://sandbox`. No sandbox-page check, page-action assertion, or supported result is claimed.

`docs/evidence/chromium-chroot-headless-shell-comparison.json` records the parent comparison. The image and other applied restrictions match; only the reviewed rule differs. Both owned containers were removed. No extra restriction was eased.

[Playwright's headless-mode documentation](https://playwright.dev/docs/browsers#chromium-new-headless-mode) distinguishes its default headless shell from the bundled full Chromium selected by `channel: 'chromium'`. A full-browser paired check on image `sha256:ed883b28c9952305d935555b9c6e4d9fa6a3d7ba8764e562dae53d41ca4b102a` retains `chromiumSandbox: true` and every existing assertion. Its reports are preserved as `chromium-containment-namespaces-full-initial.json` and `chromium-containment-namespaces-chroot-full-initial.json`. The six-rule mode still fails at `chroot`; the seven-rule mode launches Chromium 156.0.8078.4, but diagnostic navigation aborts with `ERR_ABORTED`. The cause is not established. Both containers were removed. The following diagnostic run collects browser logs and per-stage cgroup/process counters. No further resource or policy relaxation has been applied.

## Earlier resource diagnosis and approval

Diagnostic commit `d4f7938` adds bounded counters and browser logs without changing the seven-rule policy or container restrictions. Its image is `sha256:46d73461ffd52db2357cdf0bd6b17d22b68460d080d53b4345c0d136e6b04924`. The latest `docs/evidence/chromium-containment-namespaces-chroot.json` records:

- The same non-root, capability-drop, no-new-privileges, no-network, no-mount, read-only, private-IPC, CPU, memory, scratch, and 128-task limits.
- USER namespace positives and negative syscall controls still passing.
- `pids.current` sampled at 11 before launch, 95 after launch, and 125 after failure. These are samples, not peak measurements.
- `pids.events` changing from `max 0` to `max 2`. Linux counts threads as tasks against this limit, not just process leaders.
- Browser stderr reporting `pthread_create: Resource temporarily unavailable (11)` and `browser.newPage` failing with a crashed target.
- No memory OOM event in the captured counters. The owned container was removed.

`docs/evidence/chromium-chroot-resource-diagnosis.json` records the parent assertions. Thread-quota denial is directly observed in this run. It does not prove the sole cause of the earlier navigation failures.

Propose one trusted experiment raising only the task ceiling from 128 to 256. Keep the two-CPU and 4 GiB memory limits, sandbox checks, seven-rule seccomp policy, and every other restriction unchanged. This doubles the bounded task capacity and increases resource-abuse headroom, but adds no syscall admission or privilege. The operator has now explicitly approved this one experiment with every other restriction unchanged. No unlimited PID setting or automatic resource escalation is authorized.

Parent `npm run verify:all` passes 89 Node and 30 Rust tests. At that checkpoint, those checks did not replace the failed runtime gate. The candidate source review is preserved in `docs/evidence/chromium-chroot-review.md` and uses the configured model family, not cross-family assurance.

## Initial 256-task result before parser correction

Commit `e86e52a` adds opt-in `--namespace-chroot-pids256-policy`. Parent paired runs use image `sha256:9672e4d80f3609f77d6942f9df501d12aca812088a34e748b48000ca377b7c5e` and the identical seven-rule policy. The only applied contract difference is 128 versus 256 tasks. Both containers were removed. Reports are preserved as `chromium-containment-pids128-before-parser.json` and `chromium-containment-pids256-before-parser.json`; `chromium-pids-comparison-before-parser.json` records the parent comparison.

The 128-task control crashes while creating a page and records task denials. The 256-task candidate samples 137 tasks after page creation and 147 after the later assertion failure, with `pids.events` remaining `max 0`. Its actual sandbox page says `Layer 1 Sandbox` is `Namespace`, PID and network namespaces are `Yes`, seccomp-BPF is `Yes`, and the browser is adequately sandboxed. The old checker incorrectly expects `Namespace Sandbox Yes`. Correct the pinned-format parser, require the explicit PID/network/BPF rows, and retain malformed/negative rejection tests. Run the ordinary action document separately from the privileged diagnostic document. At that checkpoint, no full supported result or action success was claimed.

### Suggested untried container recipe

The following recipe was suggested as another way to try Chromium. It has **not** been tried as written. It changes resource settings (200 tasks and one CPU versus the audited 128/256-task and two-CPU runs), and its seccomp path is a placeholder. Do not run it verbatim or treat its settings as approved. If considered, first compare it with the existing trusted runner and reviewed profile, preserve the already-verified sandbox/containment assertions, and get explicit approval for the changed limits. The recipe's missing memory limit and omitted private-IPC/network/mount details must not be interpreted as permission to relax those controls.

```sh
docker run -it \\
  --init \\
  --read-only \\
  --pids-limit=200 \\
  --cpus=1 \\
  --cap-drop=ALL \\
  --security-opt seccomp=<path-to-seccomp>/chrome.json \\
  --security-opt no-new-privileges
```

## Verified trusted-browser result

Commit `c314b4d` corrects the obsolete label parser. It requires exact, unambiguous positive rows for the namespace layer, PID namespaces, network namespaces, and Chromium seccomp-BPF. Negative, missing, duplicate, conflicting, summary-only, and outer-seccomp-only inputs fail. A fresh same-family source review found no acceptance gaming or policy weakening. The action runs on an ordinary data URL after the internal diagnostic checks.

Parent paired runs use image `sha256:57911b2d47725e1d19e25203b82d7c90a3160da1815f78a9c66b42a89dd1ddff` and the same seven-rule policy hash `c85c2b40abc8ca15cace108b94f91e337b73313c8288b03c41d1ca51fe239bd7`. The 128-task control remains blocked. The 256-task candidate positively verifies the sandbox, retains all negative syscall controls, observes non-root browser processes with no-new-privileges and seccomp, and clicks the button to produce literal `verified`. Read-only root, unavailable host paths/socket, and denied egress checks pass. Both owned containers were removed.

`docs/evidence/chromium-contained-browser-verification.json` records the parent assertions. Current raw reports are `chromium-containment-namespaces-chroot.json` and `chromium-containment-namespaces-chroot-pids256.json`. Parent `npm run verify:all` passes 114 Node and 30 Rust tests in `chromium-supported-tests.txt`. No new privilege, syscall, network, mount, CPU, or memory relaxation was needed beyond the two explicitly approved changes. Initial container capabilities remain dropped; namespace-local setup capabilities remain part of the disclosed kernel attack surface.

## Remaining work

The [M2 evaluation](m2-acceptance.md) supersedes this probe's earlier integration to-do list. Managed frozen validation and the installed fixture checkpoint have separate evidence; they do not enable production controller dispatch. Preserve the fixture README, branch, operator work and environment file. Do not execute project code on the host or expose unreviewed editing/execution tools. M3–M6 retain their human setup and live-operation gates.
