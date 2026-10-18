# Native rendering verification

Screen capture is now authorized for the Cursor process hosting this agent. `CGPreflightScreenCaptureAccess()` returns `true`, and capture of the owned operator window succeeds. The earlier capture failure is no longer the blocker.

## Reproduced defect

The native operator at `567a48a` draws panels and control geometry but no client-area text. Its native Cocoa titlebar remains visible. The [captured baseline](evidence/native-visual/text-before.png) contains synthetic data only.

Run the local Vision OCR check.

```sh
swift prototypes/native-visual/verify.swift \
  docs/evidence/native-visual/text-before.png \
  'Check now' 'Choose an investigation'
```

The command exits 1. Both required client labels are absent. [The recorded result](evidence/native-visual/text-before.json) retains the actual recognized titlebar text. Requiring only `Eitri` on the same image exits 0, which checks the observation method.

## Root cause and fix

Changing only the root font to Helvetica did not restore the labels in a throwaway worktree. A standalone CoreText probe produced nonzero alpha pixels, so the fault was not a general CoreText failure.

Bounded GPUI instrumentation found every Latin glyph had ID 1, a fixed advance, and zero raster bounds. Those values match GPUI's `NoopTextSystem`. Published GPUI 0.2.2 selects that implementation on macOS unless the `font-kit` feature is enabled. The normal dependency disabled default features without enabling `font-kit`. The test-support dependency enables it indirectly, which masked the production configuration error.

Commit `313792f` enables only `font-kit` on the normal pinned dependency. No GPUI upgrade, vendored patch, font substitution, logger, or diagnostic probe is part of the fix. The feature-only candidate restored visible text. The [normal production forge capture](evidence/native-visual/forge-overview.png) also passes the original required-label check, as recorded in [the result](evidence/native-visual/text-after.json).

## Constrained window checks

The forge layout exposed a second defect at 900 by 600 logical pixels. Fixed-height detail children pushed Save behind the footer and collapsed history. The [before capture](evidence/native-visual/constrained-before.png) records it.

Commit `94ee0ca` adds an outer detail scroller and a usable minimum history viewport. Event tests then exposed wheel propagation from history and the editor into that outer scroller. Commits `f47a762` and `7072ada` record the failing tests and contain wheel events at their existing inner boundaries. The outer margin remains scrollable.

The [scrolled native capture](evidence/native-visual/constrained-after.png) shows the full Save button, focus border, caret, and multiline Unicode text. This selected state was initialized by a local fixture using the production renderer. It is not a claim of OS-level mouse automation. The fixture calls `window.refresh()` after changing scroll handles, matching GPUI's normal wheel path; omitting that refresh produced stale prototype painting, not an application defect.

[Integrated verification](evidence/native-visual/forge-tests.txt) passes 42 Node tests and 16 Rust tests. The layout tests check actual bounds and hit testing at 900 by 600, 700 by 480, and 1200 by 820. They also check both wheel directions away from outer scroll limits.

## Stable artifact viewer

The native artifact view uncovered `timeout: receive response` after successful artifact requests. Under the original ureq 3.1.2 configuration, its response-header deadline also constrained body reads. The disconnect handler then correctly removed the cached view.

Commits `541fa99` and `6e6397a` record the failing regression and fix. The private [SSE reader](../operator/src/sse.rs) connects only to the fixed controller loopback endpoint. It sends HTTP/1.0 to obtain unencoded stream framing. It rejects incompatible framing, enforces one absolute three-second header deadline, bounds headers and payloads, and enforces a fresh absolute fifteen-second deadline per complete body line. Heartbeats can continue indefinitely without removing those bounds. Bounded HTTP commands and resource downloads still use ureq. A stalled read can delay cancellation by up to fifteen seconds.

[Integrated checks](evidence/native-visual/forge-sse-tests.txt) pass 42 Node tests and 30 Rust tests. They include heartbeat survival beyond both production deadlines, stalled and trickling peers, framing rejection, size boundaries, cancellation, stale frames, and retained artifact state.

The [text artifact capture](evidence/native-visual/artifact-text.png) was taken after an additional twenty-second wait and contains the stored literal text. Its [OCR result](evidence/native-visual/artifact-text.json) passes. The checker normalizes Vision's line grouping into whitespace before comparing literal labels. The original missing-text baseline still fails, and an empty required label is rejected.

The [PNG capture](evidence/native-visual/artifact-image.png) shows the synthetic one-pixel red image through the native texture path. It is not a browser screenshot. Fixture-driven deselection then [removed the viewer](evidence/native-visual/artifact-cleared.png). Weak-reference observations show that both raw and rendered image handles were released, as recorded in [the release log](evidence/native-visual/image-handle-release.txt). This does not measure physical GPU memory reclamation.

[Verification scope](evidence/native-visual/viewer-verification.json) records the fixture revision, production revision, and stopped owned processes. The fixture and production builds use separate target directories to avoid sharing the executable output path. OS-level input automation was not used. Native input and wheel dispatch have separate event tests.

The OCR check uses local macOS Vision. It does not upload screenshots. Matching required labels is a narrow regression check, not complete visual or accessibility acceptance. Accessibility authorization is still false; no permission was requested or changed.
