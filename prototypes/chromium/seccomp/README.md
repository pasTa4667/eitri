# Namespace diagnostic policy

The runner reads `docker-29.4.0.json` only after verifying SHA-256 `01536f1d1df938ae611eba20d6349e0de7a99b6ecdee1549427a0b01b8301e28`.

The file is the [vendored seccomp default](https://raw.githubusercontent.com/moby/moby/daa0cb7f23594cdbcce5002e370027d3fd36ffd7/vendor/github.com/moby/profiles/seccomp/default.json) for Docker Engine commit `daa0cb7f23594cdbcce5002e370027d3fd36ffd7`. The upstream license is in `LICENSE`. Matching the daemon's reported commit establishes source provenance, not an independent audit of its installed binary.

`policy.mjs` preserves the complete baseline and appends six ARM64-only equality rules. Five admit specific `clone` flags for USER, PID, and NET namespaces. One admits USER-only `unshare`. `setns`, `chroot`, mounts, other namespace flags, and the `clone3` ENOSYS fallback retain the baseline rules. The candidate does not add container capabilities. A separate operator-approved `--namespace-chroot-policy` mode appends exactly one additional ARM64 `chroot` allowance. Its kernel permission checks remain; seccomp cannot limit the pathname argument. No other syscall or resource relaxation follows automatically.

The flags are specific to the pinned browser. They are not a reusable security policy for arbitrary generated programs. User namespaces increase kernel attack exposure and grant capabilities inside the new namespace during setup. Initial container capability dropping does not eliminate that exposure.

## Run the diagnostic

Build the trusted image first.

```sh
docker --context orbstack build --platform linux/arm64 \
  -t eitri-chromium-probe:1.64.1-node26.5.0 prototypes/chromium
node --test test/containment-policy.test.mjs
node prototypes/chromium/run.mjs --pinned-policy
node prototypes/chromium/run.mjs --namespace-policy
node prototypes/chromium/run.mjs --namespace-chroot-policy
node prototypes/chromium/run.mjs --namespace-chroot-pids256-policy
```

The runs use the unchanged pinned policy, the six-rule candidate, and the separately approved seven-rule candidate at 128 and 256 tasks. All retain non-root, capability-drop, no-new-privileges, no-network, no-mount, read-only, private-IPC, two CPUs, 4 GiB memory, and the original scratch limits. Only the last opt-in mode raises the task ceiling. The runner checks the applied custom policy before starting its container. Policy files are controller inputs, not container mounts.

The fixed Python probe tests USER namespace operations and negative syscall controls before browser launch. Kernel permission checks and seccomp can both deny an operation. A negative control alone does not identify which mechanism denied it. The browser must still positively report its own namespace and seccomp-BPF sandbox and complete the page assertion.

Each report records the policy hash, applied restrictions, actual outcomes, and specific-container removal. The probe selects the bundled full Chromium headless channel so it can attempt the internal diagnostic page rather than relying on headless-shell support. Bounded process/cgroup snapshots and browser logs record failures. Neither a namespace success nor `Seccomp: 2` alone counts as browser support. Any failure stays blocked. There is no broader-policy fallback. The approved 256-task candidate now passes the trusted fixed-browser probe; the 128-task control still fails. This does not accept a generated-code worker or full M2. See [the current review](../../../docs/containment-review.md).
