# Profile-name fixture capture

`captureProfileNameFixture` lets an importing colleague capture the demonstration helper without executing it or changing the original checkout. The module is not wired into controller dispatch. It does not enable a browser scenario.

## Interface

```ts
import { captureProfileNameFixture } from '../src/fixture-profile-name.ts';

const capture = await captureProfileNameFixture(selectedCanonicalDirectory);
```

The argument is an explicit, canonical absolute directory path. The helper API reads only `src/lib/errors.js`. It does not enumerate directories, inspect Git, load packages, read `.env` or `dist`, or execute captured JavaScript.

`ProfileNameFixtureCaptureV1` contains:

- `version`, fixed at `1`.
- `scenarioId`, fixed at `profile-name-v1` as descriptive metadata only.
- `provenance.kind`, fixed at `uncommitted-copy`.
- `source.virtualPath`, fixed at `src/lib/errors.js`.
- `source.size`, `source.sha256`, and detached `source.bytes`.
- `captureDigest`, the canonical descriptor digest.

`uncommitted-copy` means the capture has no source-revision binding. It does not assert that Git classified the file as untracked or modified. The actual sibling checkout has no commits, so the capture does not invent a baseline SHA.

The returned Buffer belongs to the caller and remains mutable. Modifying it invalidates the recorded checksums. Capture does not establish JavaScript syntax, expected exports, behavioral correctness, baseline reproduction, or authentic provenance.

## Acquisition contract

The selected directory must be operator-controlled and quiescent. Directory ancestors and the fixed source route must contain no symlinks. The source must be a regular file with exactly one link. Normal checkout permissions are permitted.

The file limit is `workspaceLimits.fileBytes`, currently 1 MiB. A descriptor opened with `O_NOFOLLOW` and `O_NONBLOCK` supplies bounded positional reads. Short reads continue until the declared size is acquired. An extra-byte probe rejects growth. Bigint identity, mode, size, and nanosecond timestamp comparisons detect observed file mutation. Directory identity and canonical-path rechecks detect observed route replacement. The descriptor closes before successful return.

Portable Node path APIs do not provide containment against malicious same-UID namespace races. Rechecks do not make ancestor traversal atomic. The fixed allowlist prevents accidental repository-wide collection, but the helper itself could contain secrets. Callers must not publish captured bytes automatically.

## Digest

`source.sha256` hashes the exact raw bytes without decoding or normalization. `captureDigest` uses `domain.digest` over this descriptor:

```ts
{
	version: 1,
	scenarioId: 'profile-name-v1',
	provenance: { kind: 'uncommitted-copy' },
	source: {
		virtualPath: 'src/lib/errors.js',
		size: bytes.length,
		sha256: checksum(bytes),
	},
}
```

`domain.digest` hashes recursively key-sorted canonical JSON. Raw bytes are covered through their source checksum. Host paths, metadata, timestamps, Git state, and Buffer serialization are excluded. Equal bytes at different accepted roots have equal capture digests.

## Managed workspace transfer

`WorkspaceStore.provision` accepts an exact baseline-file shape. Project only its two fields rather than passing the capture's full source record:

```ts
const workspace = await store.provision({
	caseId,
	repositoryId,
	baseline: [{ virtualPath: capture.source.virtualPath, bytes: capture.source.bytes }],
});
```

The managed checkpoint supplies the future validation revision. Neither capture digest nor source checksum is a Git revision.

## Errors

Errors use `ControlError` codes without native filesystem paths or messages.

| Code | Meaning |
|---|---|
| `invalid-fixture-directory` | Invalid or noncanonical directory argument |
| `unsafe-fixture-directory` | A directory-route component is not a real directory |
| `unsafe-fixture-source` | Source or opened descriptor is nonregular or multiply linked |
| `fixture-size-limit` | Source exceeds the fixed byte bound |
| `fixture-source-changed` | Observed route, file, length, or metadata changed during acquisition |
| `fixture-source-unavailable` | Missing initial input or another acquisition I/O failure |

## Verification boundary

The [verification record](evidence/fixture-profile-name/verification.md) records actual helper capture, independent parent checks, GPT reviews, and exact source identities. The separate [protected browser probe](profile-name-probe.md) now consumes the captured helper through managed frozen revisions. The [approved reconciliation](evidence/profile-reconciliation/verification.md) passes isolated normal-path, regression, build, and browser checks. Controller React integration and M2 acceptance remain open.

## Reconciliation input capture

`captureProfileNameReconciliationInput(selectedCanonicalDirectory)` captures the raw inputs needed for a later reconciliation decision. It uses the same private acquisition engine as the helper API. The helper API retains its singular source descriptor and digest.

`ProfileNameReconciliationInputV1` contains `version: 1`, `kind: 'profile-name-reconciliation-input'`, `provenance: { kind: 'uncommitted-copy' }`, `files`, and `captureDigest`. The `files` field is an exact tuple in this order:

1. `src/lib/errors.js`
2. `src/lib/errors.test.js`
3. `src/App.test.jsx`

Each record contains its validated `virtualPath`, byte `size`, raw-byte `sha256`, and detached mutable `bytes` Buffer. Each tuple position has its specific path type and remains compatible with `VirtualPath`. The three-file cardinality and 1 MiB per-file limit bound the captured payload to 3 MiB.

The bundle digest uses `domain.digest` over this descriptor:

```ts
{
	version: 1,
	kind: 'profile-name-reconciliation-input',
	provenance: { kind: 'uncommitted-copy' },
	files: files.map(({ virtualPath, size, sha256 }) => ({ virtualPath, size, sha256 })),
}
```

Canonical hashing preserves tuple order and sorts object keys. The descriptor excludes Buffer serialization, host paths, filesystem metadata, source revisions, and verdicts. Changing returned bytes does not update their recorded hashes or bundle digest.

All selected leaves pass preflight before acquisition begins. Every opened descriptor remains held until all selected reads and the final descriptor, leaf-path, and directory checks finish. Each descriptor receives one opening stat and one final stat. An observed change to an earlier input during a later read rejects the entire bundle without partial output.

Both APIs attempt closure of every opened descriptor. A close failure supersedes any acquisition failure and passes through the same error sanitization. If multiple closes fail, the first failure in opening order determines the error. Successful return requires every close to succeed. A genuine operating-system close failure does not prove descriptor release.

Initially missing inputs report `fixture-source-unavailable`. Disappearance after complete preflight reports `fixture-source-changed`. Unsafe opened descriptors report `unsafe-fixture-source` before metadata comparison. Other errors retain the codes in the table above.

The same operator-controlled, quiescent-directory requirement applies to this API. Sequential verification is not an atomic snapshot and cannot contain malicious same-UID namespace races. Capture does not execute or interpret source or tests, reconcile protected expectations, provide a compatibility verdict, or establish M2 acceptance.

## Operator-approved reconciliation

Display names trim whitespace, preserve case, and use `Anonymous` for missing, null or blank names. The demonstration baseline intentionally still dereferences missing/null user or profile. Its expression is `user.profile.name?.trim() || 'Anonymous'`. Normal helper tests cover formatting and name fallback. App and browser tests expect initial `Hello, ada` rendering. They do not prescribe a null-input exception or an error-boundary fallback as the desired contract.

The four approved edits are preserved in [`fixture.patch`](../scripts/profile-reconciliation/fixture.patch). They touch only `src/lib/errors.js`, `src/lib/errors.test.js`, `src/App.test.jsx`, and `e2e/errors.spec.js`. Unrelated helpers, tests, configuration and dependencies stay unchanged. Candidate-only assets add missing/null user/profile helper regressions and post-click React/browser `Hello, Anonymous` assertions. The scripted candidate adds optional access to user and profile only.

The reconciled helper is 534 bytes with SHA-256 `cd69431e5b7fda7ec116377d033d192a7b214a9c42a8101bd8c809c862af80f4`. Its capture digest is `709e1a12ba7bfd02a33adb2d12b9f13c2cf5c831b1c224943b10bee111b65fe0`. The serialized protected-definition digest is `35d237dc1f5f753c7a89772b9b258c48631e04d758a7632fee5d9724710aa412`. The managed browser checks verify these identities, the missing-profile TypeError, and the `/src/lib/errors.js:5:23` frame. Historical records remain unchanged.

### Reviewed operator rerun

The current [guarded scenario verification](evidence/fixture-scenarios/verification.md) supersedes the historical variant counts. This command now checks five variants and requires the exact reviewed Docker 29.8.2 engine, ARM64 architecture, and commit.

Do not execute fixture code on the host. Review the fixed recipe and assets under `scripts/profile-reconciliation` before Docker execution. Retain an operator-controlled, canonical, quiescent pre-edit snapshot matching all 16 entries in `inputs.json`. The recipe rejects other bytes, links, existing output directories and overlapping source/output paths. It applies the patch only inside disposable copies after checking every preimage. It never writes to the supplied snapshot or original sibling. After original integration, use the retained pre-edit snapshot for reruns.

```sh
node scripts/profile-reconciliation/verify.mjs \
  /absolute/path/to/approved-before-snapshot \
  /absolute/path/to/new-reconciliation-evidence
```

The recipe requires the reviewed local ARM64 Chromium base `sha256:57911b2d47725e1d19e25203b82d7c90a3160da1815f78a9c66b42a89dd1ddff` and the existing `orbstack` context. Only dependency preparation has registry access. It receives just the pinned manifests and runs `npm ci --ignore-scripts --no-audit --no-fund`. No fixture source or credentials enter that step.

Five variants run actual Vitest, Vite build, and Playwright suites in separate non-root containers. Their IDs are `baseline`, `baseline-with-regressions`, `scripted-candidate`, `cart-baseline-with-regressions`, and `cart-scripted-candidate`. The containers use the reviewed namespace/chroot seccomp policy, network none, read-only root, no mounts, cap-drop ALL, no-new-privileges, two CPUs, 4 GiB memory/swap ceiling, 256 PIDs, private IPC, 256 MiB shared memory and 256 MiB private tmpfs. The verification-only Playwright overlay replaces the inherited development server with one strict loopback Vite preview server, without reuse. Browser startup requires a successful fresh build and a bounded output manifest outside disposable `dist`. Fresh browser contexts block service workers and request Chromium sandboxing. The recipe rejects launch logs containing `--no-sandbox` but does not independently inspect sandbox internals. Writable dependency-cache entries live only in scratch. Explicit validation mode does not initialize Sentry. The empty DSN and env-free allowlist remain additional safeguards.

`report.json` records input, asset and variant hashes, image identities, applied containment, command exits/logs, unit/browser assertions and owned-resource cleanup. Each variant's `builtBundle` record binds actual navigation HTML and compiled JavaScript/style response sizes and SHA-256 hashes to fresh output. The provenance spec must pass in every variant. Output limits are 128 files, 8 MiB per file and 32 MiB total. Browser observation allows 128 responses, 8 MiB per body and 32 MiB total within 20 seconds. The proof file is limited to 64 KiB. Baseline requires 30 unit and 8 browser passes. The profile candidate requires 35 unit and 9 browser passes. The cart candidate requires 32 unit and 9 browser passes. Exact complete titles, unskipped results and zero retries are required. Profile red proof requires exactly four helper fallback failures, one React greeting failure, and one browser greeting failure. Cart red proof requires exactly one helper failure, one React total failure, and one browser total failure. All normal tests and builds must pass. Resource shortage, dependency incompatibility, unexpected failure or cleanup failure blocks acceptance. Only uniquely owned containers/image tags are removed. Scratch is deleted; the evidence report and `ownership.json` remain. Docker build cache is retained without a global prune. An interrupted host process may require operator cleanup using those recorded owner labels and names, never a broad prune.

The separate managed helper probe still requires Docker 29.4.0 through `src/frozen-browser.ts`. It rejects this host's installed 29.8.2 engine. A separately verified validator compatibility migration is required before the following commands can run here. Do not bypass that gate. These commands execute root integration tests and launch their managed Docker validator, so they are also runtime gates, not implementation-session checks.

```sh
EITRI_FROZEN_DOCKER_ACCEPTANCE=1 \
EITRI_PROFILE_NAME_FIXTURE_DIRECTORY=/absolute/path/to/reviewed-fixture \
node --test test/integration/profile-name-probe.test.ts \
  test/integration/controller-profile-name-handoff.test.ts
```

The [reconciliation record](evidence/profile-reconciliation/verification.md) retains historical development-server results and independent managed helper checks. The later [built-bundle verification](evidence/built-bundle/verification.md) records passing preview-backed variants, actual response hashes, isolated negative controls and cleanup. These scripted results do not establish genuine model repair, controller React integration, production activation or full M2 acceptance.
