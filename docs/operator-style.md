# Operator visual direction

The operator uses basalt surfaces, copper accents, and a small geometric anvil. [Eitri and Brokkr's smithing story](https://en.wikipedia.org/wiki/Eitri) supplies the craft reference. The Met's [Viking round box brooch](https://www.metmuseum.org/art/collection/search/466247), documented through its [collection record](https://collectionapi.metmuseum.org/public/collection/v1/objects/466247), supplies a copper-alloy reference. The palette is a design interpretation, not a claim of historical reconstruction.

## Chosen design

| Direction | Benefit | Cost | Decision |
| --- | --- | --- | --- |
| Basalt and copper workshop | Keeps navigation, evidence, and controls distinct. Fits the native renderer. | Dark reading states need contrast checks. | Base. |
| Parchment and ink notebook | Gives long investigations an editorial layout. | Requires a larger change to the existing presentation. | Keep its ruled evidence ledger, not a second theme. |

`operator/src/theme.rs` owns one immutable token record and semantic status colors. `main.rs` and the note editor share those tokens. Helvetica Neue carries interface text. Menlo distinguishes immutable revision and artifact metadata. Neither requires a downloaded font.

Copper marks identity, selection, focus, and the save action. It does not mean validation passed. Session state and check outcome have separate color mappings. Terminal and unknown sessions remain neutral. Text labels carry the meaning independently of color.

The native titlebar, existing control names, draft feedback, simulation warnings, provenance, and unavailable states remain intact. There are no runic control labels, animated sparks, wallpaper assets, component libraries, or new theme dependencies.

## Verification

The [overview](evidence/native-visual/forge-overview.png) is an actual normal-production window capture. The [constrained selected state](evidence/native-visual/constrained-after.png) uses a synthetic local fixture and the production renderer. It shows the focused editor and reachable Save action after scrolling.

Theme tests check text contrast against the used surfaces. Native layout and event tests check constrained geometry and nested wheel ownership. [Rendering verification](native-rendering.md) distinguishes those checks from the still-open stable artifact viewer and full live integration gates.
