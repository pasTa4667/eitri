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

## Open verification

The artifact view uncovered an SSE reader failure, `timeout: receive response`, after a successful artifact request. Disconnect handling correctly removes its cached view, so a short-lived artifact fetch test alone does not establish a stable native viewer. A bounded stream-reader fix and longer-lived connection tests are in progress. No visual acceptance is claimed for that unresolved behavior.

The OCR check uses local macOS Vision. It does not upload screenshots. Matching required labels is a narrow regression check, not complete visual or accessibility acceptance. Accessibility authorization is still false; no permission was requested or changed.
