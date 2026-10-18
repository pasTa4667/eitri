# Chromium containment review

## Status

The standalone M2 feasibility probe remains blocked after a reviewed namespace-policy experiment. USER namespace controls now pass, but Chromium stops at `sys_chroot("/proc/self/fdinfo/")`. This is a failed gate, not successful browser validation. Generated execution, fixture editing, Sentry installation, subscription inference, and publication have not been enabled.

M0 is implemented and verified. The native GPUI build, input handlers, and real controller connection pass their tests. M1's artifact resources and native cards are implemented and tested. Its visual/operator walkthrough remains unverified, so it is not fully accepted. The probe below uses only a trusted fixed script, not an agent-generated command or a repository mount.

## Reproduce

```sh
docker --context orbstack build --platform linux/arm64 \
  -t eitri-chromium-probe:1.64.1-node26.5.0 prototypes/chromium
npm run probe:chromium
```

Both base images are pinned by ARM64 manifest digest in `prototypes/chromium/Dockerfile`. The image uses Node 26.5.0 and matching Playwright package/browser version 1.64.1. The pinned image's `pwuser` is UID 1001, not an assumed UID 1000; private scratch uses the actual UID.

`prototypes/chromium/run.mjs` creates one labeled container, inspects the applied settings before starting it, records a bounded report, and removes that specific container. Its trusted process has a fixed two-minute lifetime. No global Docker context, shell, toolchain, kernel setting, or security policy is changed. The locally built prototype image is retained for reproduction.

## Observed result

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

## Namespace diagnostic result

The pinned baseline is the vendored profile from Docker Engine commit `daa0cb7f23594cdbcce5002e370027d3fd36ffd7`. Its SHA-256 is `01536f1d1df938ae611eba20d6349e0de7a99b6ecdee1549427a0b01b8301e28`. The installed daemon reports Engine 29.4.0, ARM64, and commit `daa0cb7f`. Matching reported source provenance is not an independent audit of the installed binary.

`prototypes/chromium/policy.mjs` appends only six ARM64 equality rules to that unchanged baseline. Five admit exact `clone` flags involving USER, PID, and NET namespaces. One admits USER-only `unshare`. The structural test proves that no other baseline rule changed. `setns`, `chroot`, mounts, and the `clone3` ENOSYS fallback remain unchanged. The runner verifies the applied custom JSON before starting a container and retains every other restriction.

An independent source review found no security blocker to this diagnostic. It identified a cloned-child exit-status check, which was added before the final paired runs. Both runs use the same rebuilt image, `sha256:587e1d93485ee9e32dce53c271dd9b0fe54a1651c6313ebeb9ea6f05b4451911`.

- `docs/evidence/chromium-containment-pinned.json` records USER namespace operations denied under the unchanged pinned policy and the earlier `No usable sandbox!` browser failure.
- `docs/evidence/chromium-containment-namespaces.json` records all five positive USER namespace controls succeeding. Negative controls still return EPERM for mounts, `setns`, and tested MOUNT, IPC, UTS, and CGROUP namespace requests. `clone3` still returns ENOSYS.
- The candidate browser launch reaches a new failure, `Check failed: sys_chroot("/proc/self/fdinfo/") == 0`. No browser page action or assertion succeeds.
- Both runs observe the original no-network, no-host-mount, non-root, no-new-privileges, read-only, dropped-capability, private-IPC, and resource limits. Both owned containers were removed.

The pinned [Chromium credentials implementation](https://raw.githubusercontent.com/chromium/chromium/156.0.8078.4/sandbox/linux/services/credentials.cc) calls `chroot` as part of dropping filesystem access in its namespace sandbox. Docker's baseline admits `chroot` only when the original container capability set includes `CAP_SYS_CHROOT`; that rule is inactive under `--cap-drop ALL`. The source and new error are consistent with that denial. No syscall trace was collected, so the precise errno at this call is not claimed.

A separate experiment could admit `chroot` while still dropping every container capability. The kernel would still require the appropriate namespace-local capability. Seccomp cannot restrict its pathname argument to `/proc/self/fdinfo/`. That is an additional syscall-admission change and has not been applied. Operator approval is requested before testing it. There is no automatic retry with a broader policy.

The [diagnostic instructions](../prototypes/chromium/seccomp/README.md) document reproduction and limits.

## Remaining work

After the gate is reviewed and a contained browser is positively verified: finish M1's artifact/resource surface and native visual acceptance; build M2's managed Git workspace, file broker, immutable revision-bound validation, trusted scenario manifest, and fixture changes. Preserve the fixture README, branch, uncommitted work, and environment file. M3–M6 retain all existing human setup and live-operation gates.
