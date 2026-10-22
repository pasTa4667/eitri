# Profile-name fixture capture

`captureProfileNameFixture` lets an importing colleague capture the demonstration helper without executing it or changing the original checkout. The module is not wired into controller dispatch. It does not enable a browser scenario.

## Interface

```ts
import { captureProfileNameFixture } from '../src/fixture-profile-name.ts';

const capture = await captureProfileNameFixture(selectedCanonicalDirectory);
```

The argument is an explicit, canonical absolute directory path. The module reads only `src/lib/errors.js`. It does not enumerate directories, inspect Git, load packages, read `.env` or `dist`, or execute captured JavaScript.

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

The [verification record](evidence/fixture-profile-name/verification.md) records actual helper capture, independent parent checks, GPT reviews, and exact source identities. Browser probing, React build integration, fixture-contract reconciliation, and M2 acceptance remain separate work.
