# Image analysis — saw bench (img2threejs `grimoire/intake/image_analysis.md`)

Reference: `../reference.png` (1408×768, AI-generated concept for DUSKHOLD, see `../../MANIFEST.json`).

## Layer 1 — Identification & classification
- Work type: sawmill saw bench (circular saw table) with a log on it. Broad class: workshop furnishing / mechanical tool. primaryDomain `object`, confidence 0.95.

## Layer 2 — Overall form & silhouette
- A long low cuboid table (length 2.0 : height 0.55 : width 0.62) with a large disc (diameter ≈ 0.69) standing upright through its middle, and a cylinder (the log, Ø 0.18, 0.5 long) lying on the right half of the top. Near-bilateral about the long axis; geometric, chunky, softened edges.

## Layer 3 — Macro → meso → micro
- Macro: five thick top boards, six square legs, the saw blade, the log.
- Meso: four long stretchers (two per side), four cross-brace boards (an X at each end), the arbor hub.
- Micro: arbor nut, the slot in the top, the log's cut face, board seams, softened edges.

## Layer 4 — Spatial relationships
- `<legs, support, top boards>` butt; `<stretchers, attached-to, legs' outer faces>` overlap; `<braces, span, end legs>` embed.
- `<blade, passes-through, top (slot)>`: centre ≈ 0.03 above the top surface, lower part visible below the top between the legs.
- `<hub, socket, blade centre>`; `<log, rests-on, top>` and touches the blade's teeth on its +X side.

## Layer 5 — Materials & surface (PBR)
- Bench wood: dielectric, roughness ≈ 0.85, warm orange-brown, long grain streaks.
- Blade: steel, brushed, roughness ≈ 0.35, light silver-grey. Hub/nut: dark iron, satin.
- Log: same wood family, darker side; cut face pale peach with faint rings.

## Layer 6 — Color & finish
- Wood orange-brown mid value (lighter on edges: lighting). Steel neutral light grey, satin metallic. End grain pale peach, matte.

## Layer 7 — Identity-defining features
- The big toothed disc with hooked teeth standing through the top (the "sawmill" read at game scale).
- Thick five-board top with board ends on the right end face.
- Six legs with stretchers and an X brace at each end.
- The log against the blade with a pale cut face.

## Layer 8 — Uncertainty & single-image limits
- Hidden: the back legs, stretchers and back brace (mirrored), the arbor/drive under the top (not modelled), the blade's back face (assumed flat).
- Uncertain: exact tooth count (≈ 20), the blade's exact Z position in the top (assumed the centre line).
