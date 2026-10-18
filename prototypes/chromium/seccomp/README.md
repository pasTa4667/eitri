# Namespace diagnostic policy

The runner reads `docker-29.4.0.json` only after verifying SHA-256 `01536f1d1df938ae611eba20d6349e0de7a99b6ecdee1549427a0b01b8301e28`.

The file is the [vendored seccomp default](https://raw.githubusercontent.com/moby/moby/daa0cb7f23594cdbcce5002e370027d3fd36ffd7/vendor/github.com/moby/profiles/seccomp/default.json) for Docker Engine commit `daa0cb7f23594cdbcce5002e370027d3fd36ffd7`. The upstream license is in `LICENSE`. Matching the daemon's reported commit establishes source provenance, not an independent audit of its installed binary.

`policy.mjs` preserves the complete baseline and appends six ARM64-only equality rules. Five admit specific `clone` flags for USER, PID, and NET namespaces. One admits USER-only `unshare`. `setns`, `chroot`, mounts, other namespace flags, and the `clone3` ENOSYS fallback retain the baseline rules. The candidate does not add container capabilities.

The flags are specific to the pinned browser. They are not a reusable security policy for arbitrary generated programs. User namespaces increase kernel attack exposure and grant capabilities inside the new namespace during setup. Initial container capability dropping does not eliminate that exposure.

## Run the diagnostic

Build the trusted image first.

```sh
docker --context orbstack build --platform linux/arm64 \
  -t eitri-chromium-probe:1.64.1-node26.5.0 prototypes/chromium
node --test test/containment-policy.test.mjs
node prototypes/chromium/run.mjs --pinned-policy
node prototypes/chromium/run.mjs --namespace-policy
```

The first run uses the unchanged pinned policy. The second uses the six-rule candidate. Both retain the original non-root, capability-drop, no-new-privileges, no-network, no-mount, read-only, private-IPC, and resource limits. The runner checks the applied custom policy before starting its container. Policy files are controller inputs, not container mounts.

The fixed Python probe tests USER namespace operations and negative syscall controls before browser launch. Kernel permission checks and seccomp can both deny an operation. A negative control alone does not identify which mechanism denied it. The browser must still positively report its own namespace and seccomp-BPF sandbox and complete the page assertion.

Each report records the policy hash, applied restrictions, actual outcomes, and specific-container removal. Neither a namespace success nor `Seccomp: 2` alone counts as browser support. Any failure stays blocked. There is no broader-policy fallback.
