# Five-axis author review: bounded live native fixture read

Scope: [pi-native-read.md](../../pi-native-read.md). This is an author review, not an independent-agent or cross-model audit.

## Correctness

- The `read_fixture` tool is registered only when a trusted `Controller` caller supplies `readFixture`. Production main and the existing native probe do not register it. A test confirms the existing probe transcript excludes it.
- The tool runs through the existing admitted native `tool()` path. Allowance, deadline, action receipt, durable `eitri.action-result`, Pause/reopen/Continue and no-redispatch checks are reused, not duplicated. The harness now also asserts that the persisted result matches the exact captured tool result.
- Capture reuses the existing `captureProfileNameFixture` boundary for `src/lib/errors.js`. It rejects missing, symlinked, empty, oversized and invalid UTF-8 files. The result validator rejects forged digests, paths, extra fields, oversized content and lone surrogates. The live helper validates the tool result before profile entry. The second reply must equal the SHA-256 value.
- Capture failure, tool/argument/result mismatch and cancellation before the tool executes all fail closed. They leave failed native data in place, dispose helpers and leave the demonstration file unchanged.

## Readability

The change adds one mode flag to the existing live harness, child and launcher rather than copying them. The new module is 33 lines. Mode branches stay local to tool name, prompt, expected reply and finite verdict.

## Architecture

The optional `RuntimeHost.readFixture` follows the existing `probe` host seam. No schema, dependency, worker, workspace-broker or production configuration changes. Provenance is an uncommitted detached capture, not a frozen controller revision or check receipt.

## Security

- No model, CLI or case-supplied path is accepted, and the tool takes only `{}`. Source is sent as data, with an explicit untrusted-data instruction, and is never imported or executed. Only the 534-byte demonstration file is eligible for upload; the local capture verified that size and SHA-256 `cd69431e5b7fda7ec116377d033d192a7b214a9c42a8101bd8c809c862af80f4`.
- The credential boundary is unchanged: a clean environment, a dedicated profile, the sole-process lease, metadata-only checks and finite stdout/stderr. A launcher test confirms that no source text, path or private markers leak.
- The remaining limit is that same-UID hostile filesystem races are outside the existing capture guarantee.

## Performance

Changes are bounded: one file of at most 4 KiB, at most two requests, and existing 60/120/125-second lifetimes.

## Verification

- RED: the missing `prototypes/pi-native-read.mjs` module failed the suite (`.audit/native-read/red.*`).
- Focused: 71/71 tests pass across the native-read, live-native, events and controlled-turn suites.
- Full: `npm run verify:all` exits 0 with **2,304 Node and 30 Rust tests passing** and no failures, cancellations or skips (`.audit/native-read/verify-all.*`).

No Critical or Important finding remains within scope. **Suggestion:** a future general source tool should use the controller workspace's frozen-revision selection instead of this fixed capture.
