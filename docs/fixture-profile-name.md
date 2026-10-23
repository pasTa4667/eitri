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

The [verification record](evidence/fixture-profile-name/verification.md) records actual helper capture, independent parent checks, GPT reviews, and exact source identities. The separate [protected browser probe](profile-name-probe.md) now consumes the captured helper through managed frozen revisions. React build integration, fixture-contract reconciliation, and M2 acceptance remain open.

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
