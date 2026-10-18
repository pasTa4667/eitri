# Chromium containment review

## Status

The standalone M2 feasibility probe is blocked. This is a failed gate, not successful browser validation. Generated execution, fixture editing, Sentry installation, subscription inference, and publication have not been enabled.

M0 is implemented and verified. The native GPUI build, input handlers, and real controller connection pass their tests. M1 still needs its visual/operator walkthrough and actual artifact screenshot surface; it is not marked fully accepted. The probe below uses only a trusted fixed script, not an agent-generated command or a repository mount.

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

Changing syscall admission is a security-policy change, not a passing test or an automatic fallback. Operator approval is requested before applying such a candidate. No `seccomp=unconfined`, privileged container, `SYS_ADMIN`, host IPC/network, global AppArmor toggle, or `--no-sandbox` workaround is authorized.

## Remaining work

After the gate is reviewed and a contained browser is positively verified: finish M1's artifact/resource surface and native visual acceptance; build M2's managed Git workspace, file broker, immutable revision-bound validation, trusted scenario manifest, and fixture changes. Preserve the fixture README, branch, uncommitted work, and environment file. M3–M6 retain all existing human setup and live-operation gates.
