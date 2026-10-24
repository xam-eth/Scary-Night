# Image analysis — mine cart (img2threejs `grimoire/intake/image_analysis.md`)

Reference: `../reference.png` (1408×768, AI-generated concept for DUSKHOLD, see `../../MANIFEST.json`).

## Layer 1 — Identification & classification
- Work type: mine cart (ore tub / hopper wagon) on a short rail section.
- Broad classification: wheeled container, hard-surface prop.
- primaryDomain: `object`. Confidence 0.95.

## Layer 2 — Overall form & silhouette
- Bounding volume: a cuboid tub (open top) that tapers outward toward the top (inverted frustum), resting on a low wheel chassis; below it a flat rail section (two rails on three sleepers) on an irregular gravel patch.
- Symmetry: bilateral about the long (travel) axis; the push handle breaks front/back symmetry (it sits at the rear end).
- Proportions (tub top length = 1.0): tub top width ≈ 0.70, tub height ≈ 0.42 without ore, ore heap rises ≈ 0.22 above the rim; wheel diameter ≈ 0.27; rail section length ≈ 1.35, gauge ≈ 0.62.
- Shape language: geometric, chunky, slightly bevelled edges.

## Layer 3 — Macro → meso → micro
- Macro: `tub` (4 plank walls + floor), `ore-heap`, `chassis` (2 axles + 4 wheels), `push-handle`, `rail-section` (2 rails + 3 sleepers + gravel bed).
- Meso: wall planks (3 horizontal planks per long side, 3 per end), 4 vertical corner posts, 4 top corner brackets (iron, L-shaped caps), 4 bottom corner brackets, wheel = plank disc + iron rim + hub cap, handle = 2 bent uprights + a horizontal grip with round end caps, rail = I-section bar + rail plates on sleepers.
- Micro: round rivet heads on the brackets (2–3 per face), axle nuts on the hub caps, plank seams and wood-grain gouges, ore nuggets as faceted lumps (≈ 25 visible).

## Layer 4 — Spatial relationships
- `<ore-heap, sits-inside, tub>` overlap: nuggets embed below the rim and mound above it.
- `<corner-post, attached-to, tub walls>` butt joint at each vertical edge; `<top-bracket, caps, corner-post + rim>` overlap.
- `<tub floor, rests-on, axles>`; `<wheel, socket, axle end>` (wheels outside the tub's lower width, under the tub's footprint edge).
- `<wheel rim, rests-on, rail top>` contact line: wheel bottoms touch the rail heads.
- `<rail, attached-to, sleepers>` via rail plates; `<sleepers, embedded-in, gravel bed>` slightly.
- `<push-handle uprights, attached-to, tub rear wall>` via two iron straps at mid-height and the bottom bracket.

## Layer 5 — Materials & surface (PBR)
- Wood (tub, posts, wheels, sleepers): dielectric, metalness 0, roughness ≈ 0.8, albedo warm mid brown, darker on sleepers; relief: shallow grain gouges.
- Iron (brackets, rims, rails, handle, rivets, hub caps): metalness ≈ 0.6 in look but stylized; roughness ≈ 0.55; albedo dark neutral grey.
- Gold ore: stylized; metalness ≈ 0.5, roughness ≈ 0.4; albedo saturated yellow with lighter facets.
- Gravel bed: dielectric, roughness 1, albedo grey-brown with lighter pebbles.
- Inference: the soft gradients are lighting baked into the illustration; albedo is taken flatter.

## Layer 6 — Color & finish
- Wood: hue orange-brown, mid value, medium saturation; finish matte; plank edges slightly lighter (edge highlight, inferred lighting).
- Iron: neutral grey, low value; satin.
- Ore: yellow (hue ≈ 45°), high value, high saturation; facet tops lighter.
- Gravel: desaturated grey-brown, mid-low value.

## Layer 7 — Identity-defining features
- Outward-tapered open tub with three visible horizontal planks per side.
- Iron L-brackets with rivets at all 8 tub corners.
- Heaped gold ore above the rim (the read of "gold mine" at game scale).
- Plank-disc wheels with iron rims and hub caps, resting on the rails.
- Rear push handle: two bent iron uprights + horizontal grip with end caps.
- Two-rail track on three sleepers (the read of "mine" vs a plain crate).

## Layer 8 — Uncertainty & single-image limits
- Hidden: the right long side and the rear end (assumed mirror / same plank layout), the tub floor and axles (hidden by the wheels and body; inferred as two straight axles), the far wheels (partly visible, assumed identical).
- Uncertain: exact rail profile (read as a simple I-bar), number of rivets per bracket face (2–3).
- The illustration's gravel patch is a scene base, not part of the cart; kept as an optional thin base so the prop sits on the bailey ground.
- Game-scale note: the prop is seen at ~60–120 px on screen from a high three-quarter camera; micro details (rivets, grain) will be stylized, not modelled one-to-one.
