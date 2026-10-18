# Frozen browser snapshot delivery prototype

The prototype decision is settled. Controlled image COPY delivers frozen A to a non-root sandboxed browser after the workspace advances to B, without host mounts or project Node execution. This is a throwaway instrument, not a shipping validation interface or M2 acceptance.

## Delivery choice

A read-only bind was rejected for this experiment. Host exports use mode-0400 files and mode-0500 directories under host UID 501, while the container runs as UID 1001. A bind would also change the current no-host-mount contract.

The chosen candidate builds a derived image from the already-verified local Chromium image. A fresh context contains only the fixed Dockerfile, trusted static driver, and three declared synthetic files. The Dockerfile copies bytes and contains no RUN, project Dockerfile, dependency installation, or project configuration execution. Chromium alone executes the synthetic page's JavaScript.

The instrument checks the approved seven-rule policy and complete container contract before start. Host assertions compare literal A, transfer hashes, unchanged original export bytes/modes, and workspace B. Cleanup is limited to recorded UUID-labelled resources and the instrument's private temporary root. Build-cache reclamation is not claimed.

## First experiment

The reviewed instrument is integrated as `2532270`. The first parent run tried the immutable local image ID in FROM. BuildKit treated that text as a registry reference and failed metadata resolution before a container or derived image was created. No tag retry or fallback ran.

The [bounded report](evidence/frozen-browser-copy-local-id-blocked.json) records frozen A, workspace B, unchanged original export contents and modes, a closed store, and removed scratch. The configured registry-mirror hostname is masked; the original report remains local under `.audit/`. No global registry setting or authentication state was changed.

This result does not test COPY permissions or browser delivery. The separate fixed-local-tag correction is integrated as `5265951`. Its parent run built the image and verified the unchanged expected base ID and exact base-layer prefix. It then stopped before container start because Docker returned the same environment bindings in a different array order. The [bounded report](evidence/frozen-browser-copy-env-order-blocked.json) records that preflight failure and removal of the owned container, derived image, and scratch. Export A and workspace B remain preserved. Commit `88e30af` corrects comparison to exact unique bindings without treating array order as semantic. Duplicate, missing, extra, or changed keys/values still fail. A canonical image name in BuildKit output is not, by itself, proof of a network request. Offline behavior is not guaranteed by pull=false or network=none, which does not govern base-image metadata resolution.

## COPY and namespace observation

The next parent run verified the complete applied contract and started the trusted driver. The three frozen files were readable by UID 1001 with mode-0444 files and mode-0555 directories, matching frozen A hashes. Root and snapshot writes were rejected; host paths, Docker socket, and the project Node canary were absent; egress was denied. Chromium reported the required sandbox rows.

The [bounded report](evidence/frozen-browser-copy-capability-blocked.json) then fails an all-process zero-capability assertion on mask `0000000000200000` (`CAP_SYS_ADMIN`). The initial driver and recorded earlier browser processes had zero effective capabilities. The failing process was not appended before the assertion, so its role and namespace were not captured. No browser action result is claimed. Owned container, image, and scratch were removed, and A/B preservation passed.

The [pinned Chromium implementation](https://raw.githubusercontent.com/chromium/chromium/156.0.8078.4/sandbox/policy/linux/sandbox_linux.cc) explicitly retains `CAP_SYS_ADMIN` in a zygote after entering a new user namespace so children can receive PID namespaces. Linux [user namespace semantics](https://man7.org/linux/man-pages/man7/user_namespaces.7.html) distinguish those capabilities from parent-namespace authority. The subsequent diagnostic run in `frozen-browser-copy-namespace-witness.json` identifies the actual process as a zygote. Its user-namespace identity differs from the initial driver's, its UID/GID maps contain only `1001 1001 1`, its PID namespace is nested, and its effective/permitted masks contain exactly `CAP_SYS_ADMIN`. Processes in the initial namespace remain at zero effective capabilities. `frozen-browser-copy-capability-scope.json` records the parent assertions. The narrowly witnessed namespace-qualified check is integrated as `6c4f3a3` for both driver and host after fresh security review. No Docker capability or other restriction has been added or relaxed.

## Observed result and recommendation

The parent run on `6c4f3a3` reports literal browser output A after the working source has become B. The static HTTP response bytes and transfer hashes match frozen A. Original export bytes and modes were unchanged before owned test-scratch cleanup. Copied files are owned by UID1001 and readable without making the original export writable. Root and snapshot writes return EROFS. Host sentinel/controller paths, Docker socket, and the source-Node canary remain absent; egress is denied.

The approved seven-rule policy, 256-task limit, two CPUs, 4 GiB memory/swap ceiling, no-new-privileges, capability-drop, read-only root, private IPC/scratch, and no-host-mount contract remain unchanged. Namespace-local zygote authority is checked separately from initial-namespace zero capabilities. Both driver and host verify the raw witnesses rather than accepting a reported pass boolean.

The [raw report](evidence/frozen-browser-copy-observed-a.json) and [parent assertions](evidence/frozen-browser-copy-verification.json) record the observation. The owned container, derived image, and temporary scratch are removed; the base image remains unchanged. Docker build-cache bytes are not claimed reclaimed, and offline image building is not guaranteed. Parent `npm run verify:all` passes 114 Node and 30 Rust tests in [the recorded output](evidence/frozen-browser-copy-tests.txt). Fresh [source](evidence/frozen-browser-copy-source-review.md) and [capability-scope](evidence/frozen-browser-copy-capability-review.md) reviews found no actionable findings for this experiment. Both used the configured model family, not cross-family assurance.

Recommend controlled COPY rather than a host bind for the next browser-only validation module. It solves the observed UID/mode delivery problem while preserving the no-host-mount contract. Its trade-offs are image-construction overhead and retained daemon build cache. A real module must hide snapshot custody, image preparation, provenance, bounded protocol, cancellation, crash uncertainty, and owned cleanup behind a small interface. Interface alternatives are being compared before implementation; this prototype is not promoted as that interface.

## Scope limits

The three scripts under `prototypes/frozen-browser-copy/` deliberately use the workspace library's physical export layout for their own synthetic store. That coupling must not become a shipping API. There is no production run ledger, crash reconciliation protocol, arbitrary command interface, or controller/native/HTTP integration.

A browser-only frozen-export validator may follow after the empirical delivery question is settled. Project Node/build execution requires a separate isolation design because a same-UID project child can interfere with an in-container trusted driver. All later credential, sign-in, publication, and live-remediation gates remain unchanged.
