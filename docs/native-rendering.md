# Native text rendering investigation

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

Changing only the root font to Helvetica did not restore the labels in a throwaway worktree. That change is not a verified fix and is not integrated. A standalone CoreText probe produced nonzero alpha pixels for Helvetica, so a general CoreText failure is not established either. GPUI's shared glyph-paint path is under investigation.

The OCR check uses local macOS Vision. It does not upload screenshots. Matching required labels is a narrow regression check, not complete visual or accessibility acceptance. Accessibility authorization is still false; no permission was requested or changed.
