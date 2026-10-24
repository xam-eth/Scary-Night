#!/usr/bin/env python3
"""Author the img2threejs assessment + ObjectSculptSpec for the DUSKHOLD sawmill saw bench.

    python3 author.py assess | spec | lock      (see ../_lib/i2t_author.py)

Read off reference.png with a 100 px grid (analysis/proportions.md): table top length = 2.0 object
units, Y up, +Z = the long face toward the reference camera, the log on the +X side of the blade.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "_lib"))
from i2t_spec import Material, SpecBuilder, feature  # noqa: E402
from i2t_author import run  # noqa: E402

NAME = "Saw bench"

GRAIN = [
    {"id": "macro", "frequency": 2.0, "amplitude": 0.25, "role": "broad tone breakup across a plank"},
    {"id": "meso", "frequency": 6.0, "amplitude": 0.45, "stretch": [0.35, 4.0], "pattern": "grain",
     "role": "long grain streaks along the board"},
    {"id": "micro", "frequency": 28.0, "amplitude": 0.08, "role": "highlight breakup under grazing light"},
]
RINGS = [
    {"id": "macro", "frequency": 2.0, "amplitude": 0.3, "role": "heartwood to sapwood tone"},
    {"id": "meso", "frequency": 9.0, "amplitude": 0.4, "pattern": "ridge", "role": "growth rings on the cut face"},
    {"id": "micro", "frequency": 36.0, "amplitude": 0.08, "role": "saw marks under grazing light"},
]
BRUSHED = [
    {"id": "macro", "frequency": 2.0, "amplitude": 0.2, "role": "broad tone breakup across the disc"},
    {"id": "meso", "frequency": 8.0, "amplitude": 0.18, "stretch": [4.0, 0.3], "pattern": "striated",
     "role": "soft brushing streaks on the steel"},
    {"id": "micro", "frequency": 40.0, "amplitude": 0.06, "role": "highlight breakup under grazing light"},
]

# grain bands per UV orientation: box faces run u along a board's length; extruded boards, posts
# (legs) and the log's cylinder run v along it, so their streak stretch is swapped
GRAIN_V = [dict(band, stretch=[band["stretch"][1], band["stretch"][0]]) if "stretch" in band else band for band in GRAIN]

# colours from the material evidence (material-analysis.json palettes) and region means of the
# reference: the concept's wood is a muted grey-brown (#95623a front faces, #b8896a lit top, #8a6a50
# legs), the blade a mid steel grey (#717177-#97979a), the hub a dark warm grey (#454044-#5f5959),
# the cut face a pale peach (#e5c4a1)
MATERIALS = {
    "wood-long": Material("wood-long", "Bench wood (long grain on v)", "#a26f47", ["#84583a", "#bb8c63"],
                          material_class="wood", roughness=0.86, normal=0.35, amplitude=0.16, edge_wear=0.2, dirt=0.1,
                          bands=GRAIN_V,
                          overrides=[dict(id="bench-grain", kind="groove", region="every bench member, along its length",
                                          evidenceRefs=["full-object"], confidence=0.7, albedoShift="#7a4f30",
                                          pattern="streaked along the board", amplitude=0.12),
                                     dict(id="bench-edge-wear", kind="chip", region="top and leg edges",
                                          evidenceRefs=["full-object"], confidence=0.6, albedoShift="#c99a70",
                                          roughnessDelta=-0.06, edgeWear=0.25)],
                          notes="Muted warm-brown bench wood for every member (top boards, legs, stretchers, braces): "
                                "all are extruded prisms whose side-wall UVs run v along the grain."),
    "bark": Material("bark", "Log wood", "#8c6548", ["#6e4c33", "#a27858"], material_class="wood",
                     roughness=0.9, normal=0.45, amplitude=0.18, bands=GRAIN_V,
                     overrides=[dict(id="log-bark-streaks", kind="scratch", region="log side", evidenceRefs=["full-object"],
                                     confidence=0.6, albedoShift="#6f4a2e", pattern="long streaks along the log")],
                     notes="The log's side: a lighter, greyer brown than the bench, streaks along its length."),
    "end-grain": Material("end-grain", "Log end grain", "#e2be98", ["#d6b08a", "#e7c8a7"], material_class="wood",
                          roughness=0.92, normal=0.25, amplitude=0.14, bands=RINGS,
                          overrides=[dict(id="log-end-rings", kind="decal", region="the log's cut face",
                                          evidenceRefs=["full-object"], confidence=0.7, pattern="growth rings")],
                          notes="Pale peach cut face with faint rings."),
    "steel": Material("steel", "Saw steel", "#807f84", ["#6a696e", "#9a999d"], material_class="metal",
                      roughness=0.4, metalness=0.25, normal=0.12, amplitude=0.1, bands=BRUSHED,
                      overrides=[dict(id="blade-sheen", kind="gloss", region="blade faces", evidenceRefs=["full-object"],
                                      confidence=0.7, roughness=0.28, note="brushed sheen catching the key light")],
                      notes="Mid steel-grey brushed blade."),
    "iron": Material("iron", "Arbor iron", "#4d4749", ["#3a3537", "#625b5c"], material_class="metal",
                     roughness=0.45, metalness=0.25, normal=0.12, amplitude=0.08,
                     overrides=[dict(id="arbor-edge", kind="bevel", region="hub rim", evidenceRefs=["full-object"],
                                     confidence=0.6, roughnessDelta=-0.15)],
                     notes="Dark warm-grey iron hub and nut."),
    "slot": Material("slot", "Blade slot shadow", "#2c2622", ["#1e1a17", "#3a332d"], material_class="wood",
                     roughness=0.95, normal=0.1, amplitude=0.05,
                     overrides=[dict(id="slot-ao", kind="stain", region="the slot in the top", evidenceRefs=["full-object"],
                                     confidence=0.6, dirtAmount=0.6, cavityBias=1.0)],
                     notes="The dark gap the blade runs through."),
}
FLAT_SHADED: set[str] = set()
METAL_OVERRIDES = {"steel": {"metalness": 0.25, "roughness": 0.32}, "iron": {"metalness": 0.25, "roughness": 0.45}}
ROUGHNESS_OVERRIDES = {"wood-long": 0.88, "bark": 0.92, "end-grain": 0.93, "slot": 0.96}

# ---- geometry -----------------------------------------------------------------------------------
TOP_Y = 0.57          # table top surface
TOP_T = 0.18          # top thickness (the boards run the full thickness; their ends show at x = +-1)
TOP_LEN = 2.0
PLANK_W = 0.118
LEG_X = (-0.85, 0.0, 0.85)
LEG_Z = 0.23
LEG = 0.13
BLADE_C = (0.0, TOP_Y + 0.01, 0.0)
R_TIP, R_ROOT = 0.37, 0.31
TEETH = 20
LOG_R = 0.085
LOG_Y = TOP_Y + LOG_R
# the log lies on the top in front of the blade plane, turned ~20 deg toward the viewer so its pale
# cut face looks at the camera as in the reference (its far end clears the blade: z - r > 0.011)
LOG_YAW = math.radians(22.0)
LOG_A = (0.37, 0.1)                       # (x, z) of the end near the blade
LOG_LEN = 0.47
LOG_B = (LOG_A[0] + LOG_LEN * math.cos(LOG_YAW), LOG_A[1] + LOG_LEN * math.sin(LOG_YAW))
# the log's axis in the root's frame (the root board is turned +90 deg about Y: world x -> local z, world z -> local -x)
LOG_AXIS_ROOT = (round(-math.sin(LOG_YAW), 4), 0, round(math.cos(LOG_YAW), 4))


BOARD_CHAMFER = 0.014


def board_profile(w: float, t: float, c: float) -> list[list[float]]:
    """Cross-section of a top board (x = across the board, y = up), corners chamfered by c."""
    hw, ht = w / 2, t / 2
    pts = [(-hw + c, -ht), (hw - c, -ht), (hw, -ht + c), (hw, ht - c), (hw - c, ht), (-hw + c, ht), (-hw, ht - c), (-hw, -ht + c)]
    return [[round(x, 4), round(y, 4)] for x, y in pts]


def blade_profile() -> list[list[float]]:
    pts = []
    step = 2 * math.pi / TEETH
    for i in range(TEETH):
        a = i * step
        pts.append([round(R_ROOT * math.cos(a), 4), round(R_ROOT * math.sin(a), 4)])
        pts.append([round(R_TIP * math.cos(a + 0.62 * step), 4), round(R_TIP * math.sin(a + 0.62 * step), 4)])
        pts.append([round((R_ROOT + 0.012) * math.cos(a + 0.8 * step), 4), round((R_ROOT + 0.012) * math.sin(a + 0.8 * step), 4)])
    return pts


def build_components() -> SpecBuilder:
    b = SpecBuilder("saw-bench", MATERIALS)
    zs = [(i - 2) * (PLANK_W + 0.006) for i in range(5)]
    # root: the middle top board (the bench's motion node); the other boards hang off it
    # the five top boards are extruded from a chamfered cross-section along X (the box primitive has
    # no edge geometry): the 14 mm chamfers and a +-4 mm height stagger make the planks and their
    # seams read like the reference's softened boards. Extrude runs along local +Z, so each board is
    # turned +90 deg about Y (local Z -> world +X) and starts at its left end.
    def board(cid: str, name: str, parent: str | None, i: int, **kw):
        dy = 0.0 if i == 2 else (0.004 if i % 2 else -0.003)
        x0 = -TOP_LEN / 2 + 0.01 * (i % 2)
        length = TOP_LEN - 0.02 * (i % 2)
        return b.add(cid, name, parent=parent, primitive="extrude", world=(x0, TOP_Y - TOP_T / 2 + dy, zs[i]),
                     rot=(0.0, math.pi / 2, 0.0), scale=None, material="wood-long", topology="assembled-solid",
                     descriptor={"profile2D": {"points": board_profile(PLANK_W, TOP_T, BOARD_CHAMFER), "depth": length}},
                     **kw)
    board("root", "Top board 3", None, 2, level="macro", role="body", anim="root", importance=0.8, confidence=0.75,
          rationale="Top board: a thick plank with chamfered long edges, extruded from its cross-section; the middle "
                    "one is the bench's root.",
          features=[feature("top-seam-3", "seam", "dark gaps between the five top boards")],
          channels={"translate": True, "rotate": True, "scale": True, "bend": False, "twist": False, "detach": False,
                    "visibility": True, "materialState": True})
    for i in range(5):
        if i == 2:
            continue
        board(f"top-board-{i + 1}", f"Top board {i + 1}", "root", i, level="macro", role="panel", importance=0.7,
              rationale="Top board: a thick plank with chamfered long edges, extruded from its cross-section.",
              features=[feature(f"top-seam-{i + 1}", "seam", "6 mm dark gap to the next board")])
    # legs: three per side
    n = 1
    for x in LEG_X:
        for z in (LEG_Z, -LEG_Z):
            leg_top = TOP_Y - TOP_T + 0.01
            # optimization pass: frame members are chamfered prisms (an extruded 8-point section, 28
            # triangles) instead of subdivided boxes (192): softer edges like the reference's timbers
            # at a seventh of the triangles. A post extrudes up: local Z -> world +Y (rot -90 deg about X).
            b.add(f"leg-{n}", f"Leg {n}", parent="root", primitive="extrude", world=(x, 0.0, z), rot=(-math.pi / 2, 0.0, 0.0),
                  scale=None, material="wood-long", topology="assembled-solid", level="macro", role="post", importance=0.7,
                  descriptor={"profile2D": {"points": board_profile(LEG, LEG, 0.016), "depth": leg_top}},
                  edge=("chamfer", 0.016, 1),
                  attachment={"parentId": "root", "parentSocket": "root:underside",
                              "localStart": b.local("root", (x, 0.0, z)), "localEnd": b.local("root", (x, leg_top, z)),
                              "contactType": "butt", "embedDepth": 0.01, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]},
                  rationale="Leg: a square timber post with chamfered edges, extruded from its section.",
                  features=[feature(f"leg-bevel-{n}", "bevel", "softened leg edges catch the key light")])
            n += 1
    # long stretchers on the outer faces of the legs (front and back), two per side; prisms along X
    k = 1
    for z, side in ((LEG_Z + LEG / 2 + 0.02, "front"), (-(LEG_Z + LEG / 2 + 0.02), "back")):
        for x0, x1 in ((LEG_X[0], LEG_X[1]), (LEG_X[1], LEG_X[2])):
            length = abs(x1 - x0) + LEG
            b.add(f"stretcher-{k}", f"Stretcher {side} {k}", parent="root", primitive="extrude",
                  world=((x0 + x1) / 2 - length / 2, 0.19, z), rot=(0.0, math.pi / 2, 0.0), scale=None,
                  material="wood-long", topology="assembled-solid", level="meso", role="beam", importance=0.6,
                  descriptor={"profile2D": {"points": board_profile(0.045, 0.075, 0.01), "depth": length}},
                  rationale="Stretcher: a straight board bracing two legs, a chamfered prism along X.")
            k += 1
    # X braces between the end legs: prisms along their own (tilted) length
    k = 1
    rise, run_z = 0.31, 2 * LEG_Z
    ang = math.atan2(rise, run_z)
    length = math.hypot(rise, run_z) + 0.05
    for x in (LEG_X[0], LEG_X[2]):
        for s_ in (1, -1):
            cx, cy, cz = x + (0.075 if x < 0 else -0.075), 0.22, 0.0
            d = (0.0, -math.sin(s_ * ang), math.cos(s_ * ang))          # local Z after the tilt about X
            b.add(f"brace-{k}", f"Cross brace {k}", parent="root", primitive="extrude",
                  world=(cx - d[0] * length / 2, cy - d[1] * length / 2, cz - d[2] * length / 2), rot=(s_ * ang, 0.0, 0.0),
                  scale=None, material="wood-long", topology="assembled-solid", level="meso", role="beam", importance=0.55,
                  descriptor={"profile2D": {"points": board_profile(0.035, 0.065, 0.008), "depth": length}},
                  rationale="Cross brace: a flat diagonal board, a chamfered prism, one of an X between the end legs.")
            k += 1
    # the blade: a toothed steel disc through a slot in the top, spinning about Z
    b.add("saw-blade", "Saw blade", level="macro", role="blade", parent="root", primitive="extrude",
          world=(BLADE_C[0], BLADE_C[1], BLADE_C[2] - 0.011), material="steel",
          descriptor={"profile2D": {"points": blade_profile(), "depth": 0.022}},
          topology="assembled-solid", anim="spin", pivot_axis=(0, 0, 1), importance=1.0, confidence=0.8,
          channels={"translate": False, "rotate": True, "scale": False, "bend": False, "twist": False, "detach": False,
                    "visibility": True, "materialState": True},
          pivot_world=(BLADE_C[0], BLADE_C[1], BLADE_C[2] - 0.011),
          sockets=[{"id": "arbor-axis", "localPosition": [0, 0, 0.011], "axis": [0, 0, 1],
                    "use": "spin the blade (hub and nut ride on it) about this axis: slow by day, fast at night in the game"},
                   {"id": "sawdust-fx", "localPosition": [0.36, 0.0, 0.011],
                    "use": "where the blade's rim leaves the top on the log side: the game spawns sawdust here"}],
          rationale="Saw blade: a genuinely flat rigid steel plate (2.2 cm thick) whose rim is 20 hooked teeth; "
                    "extruded from its measured toothed outline, so it is a flat part by design, not a curved form.",
          features=[feature("saw-teeth", "ridge", "20 hooked triangular teeth around the rim")])
    b.rod("hub", "Arbor hub", parent="saw-blade", start=(BLADE_C[0], BLADE_C[1], -0.05), end=(BLADE_C[0], BLADE_C[1], 0.05),
          radius=0.08, level="meso", role="hub", material="iron", contact="socket", embed=0.02, socket="saw-blade:centre",
          importance=0.6, rationale="Arbor hub: a short round iron boss through the blade centre, a cylinder.")
    b.rod("arbor-nut", "Arbor nut", parent="saw-blade", start=(BLADE_C[0], BLADE_C[1], 0.05), end=(BLADE_C[0], BLADE_C[1], 0.072),
          radius=0.03, level="micro", role="cap", material="iron", contact="threaded", embed=0.004, socket="hub:end",
          importance=0.3, rationale="Arbor nut: a small round nut on the hub, a cylinder.",
          features=[feature("arbor-nut-head", "fastener", "the arbor nut at the blade centre")])
    b.box("slot", "Blade slot", parent="root", center=(BLADE_C[0], TOP_Y + 0.002, 0.0), size=(0.82, 0.006, 0.036),
          level="micro", role="slot", material="slot", importance=0.3,
          rationale="Blade slot: the dark gap in the top the blade runs through, a thin flat box on the surface.",
          features=[feature("blade-slot", "seam", "dark slit along the blade line in the top")])
    # the log being cut, lying along X on the +X side of the blade
    b.rod("log", "Log", parent="root", start=(LOG_A[0], LOG_Y, LOG_A[1]), end=(LOG_B[0], LOG_Y, LOG_B[1]), radius=LOG_R,
          level="macro", role="log", material="bark", contact="rests-on", embed=0.008, socket="root:top",
          importance=0.8, anim="feed", pivot_axis=LOG_AXIS_ROOT,
          sockets=[{"id": "feed-axis", "localPosition": [0, 0, 0], "axis": list(LOG_AXIS_ROOT),
                    "use": "translate the log pivot along this axis (the root frame: the log's own 22 deg direction) to "
                           "feed it toward the blade (negative) or reload it (positive)"}],
          rationale="Log: a round length of trunk, a cylinder lying on the top.",
          features=[feature("log-streaks", "scratch", "long grain streaks along the log", effect="material")])
    b.rod("log-end", "Log cut face", parent="log", start=(LOG_B[0], LOG_Y, LOG_B[1]),
          end=(LOG_B[0] + 0.006 * math.cos(LOG_YAW), LOG_Y, LOG_B[1] + 0.006 * math.sin(LOG_YAW)), radius=LOG_R - 0.006,
          level="micro", role="cap", material="end-grain", contact="flush", embed=0.002, socket="log:end",
          importance=0.4, rationale="Log cut face: the pale sawn end, a thin disc.",
          features=[feature("log-end-rings", "decal", "pale cut face with growth rings", effect="material")])
    return b


def detail_inventory() -> dict:
    z = "detail-inventory/zone-{}.png"
    return {
        "scanMethod": "grid-3x3",
        "targetMinDetails": 6,
        "note": "Zones from build_detail_inventory.py (di.json); every detail maps to a component.localFeatures or "
                "material.localOverrides entry of object-sculpt-spec.json.",
        "details": [
            {"id": "d-saw-teeth", "kind": "ridge", "description": "20 hooked teeth around the blade rim",
             "region": {"x": 0.34, "y": 0.12, "width": 0.27, "height": 0.33, "units": "normalized"}, "scale": "meso",
             "affects": "geometry", "mapsTo": {"type": "component.localFeatures", "ref": "saw-teeth"}, "evidenceRef": z.format("r0c1"), "confidence": 0.85},
            {"id": "d-blade-sheen", "kind": "gloss", "description": "brushed steel sheen across the blade faces",
             "region": {"x": 0.38, "y": 0.18, "width": 0.2, "height": 0.25, "units": "normalized"}, "scale": "micro",
             "affects": "material", "mapsTo": {"type": "material.localOverrides", "ref": "blade-sheen"}, "evidenceRef": z.format("r0c1"), "confidence": 0.7},
            {"id": "d-arbor", "kind": "fastener", "description": "dark iron arbor hub and nut at the blade centre",
             "region": {"x": 0.43, "y": 0.33, "width": 0.07, "height": 0.09, "units": "normalized"}, "scale": "micro",
             "affects": "geometry", "mapsTo": {"type": "component.localFeatures", "ref": "arbor-nut-head"}, "evidenceRef": z.format("r1c1"), "confidence": 0.8},
            {"id": "d-top-seams", "kind": "seam", "description": "five boards in the top, their seams showing on the end face",
             "region": {"x": 0.78, "y": 0.4, "width": 0.11, "height": 0.2, "units": "normalized"}, "scale": "meso",
             "affects": "geometry", "mapsTo": {"type": "component.localFeatures", "ref": "top-seam-2"}, "evidenceRef": z.format("r1c2"), "confidence": 0.75},
            {"id": "d-end-grain", "kind": "decal", "description": "pale cut face of the log with faint rings",
             "region": {"x": 0.68, "y": 0.28, "width": 0.07, "height": 0.14, "units": "normalized"}, "scale": "micro",
             "affects": "material", "mapsTo": {"type": "component.localFeatures", "ref": "log-end-rings"}, "evidenceRef": z.format("r1c2"), "confidence": 0.8},
            {"id": "d-wood-grain", "kind": "groove", "description": "long grain streaks along every board and leg",
             "region": {"x": 0.11, "y": 0.39, "width": 0.78, "height": 0.2, "units": "normalized"}, "scale": "micro",
             "affects": "material", "mapsTo": {"type": "material.localOverrides", "ref": "bench-grain"}, "evidenceRef": z.format("r1c0"), "confidence": 0.65},
            {"id": "d-leg-bevel", "kind": "bevel", "description": "softened edges on the legs and the top",
             "region": {"x": 0.15, "y": 0.5, "width": 0.07, "height": 0.27, "units": "normalized"}, "scale": "micro",
             "affects": "geometry", "mapsTo": {"type": "component.localFeatures", "ref": "leg-bevel-1"}, "evidenceRef": z.format("r2c0"), "confidence": 0.6},
            {"id": "d-slot", "kind": "seam", "description": "dark slit in the top where the blade passes",
             "region": {"x": 0.35, "y": 0.38, "width": 0.25, "height": 0.04, "units": "normalized"}, "scale": "micro",
             "affects": "geometry", "mapsTo": {"type": "component.localFeatures", "ref": "blade-slot"}, "evidenceRef": z.format("r1c1"), "confidence": 0.6},
            {"id": "d-bark", "kind": "scratch", "description": "darker streaks along the log",
             "region": {"x": 0.57, "y": 0.26, "width": 0.17, "height": 0.15, "units": "normalized"}, "scale": "micro",
             "affects": "material", "mapsTo": {"type": "material.localOverrides", "ref": "log-bark-streaks"}, "evidenceRef": z.format("r0c2"), "confidence": 0.6},
        ],
    }


class Config:
    NAME = NAME
    MATERIALS = MATERIALS
    FLAT_SHADED = FLAT_SHADED
    METAL_OVERRIDES = METAL_OVERRIDES
    # the reference's lighting as the gate view reproduces it (render-options.json): a product-style
    # studio light, the floor's contact shadow thrown slightly behind the bench
    LIGHTING = [
        {"role": "key light", "direction": "high, slightly in front and to the camera's right", "color": "#fff4e6",
         "softness": "soft studio", "notes": "harness light mode 'studio' for the fixed (gate) view"},
        {"role": "fill light", "direction": "front right, from the camera side", "color": "#dfe6ff", "intensity": "medium",
         "notes": "lights the log's cut face as in the reference"},
        {"role": "environment light", "type": "hemisphere", "sky": "#f2f4ff", "ground": "#4a4036", "intensity": "low",
         "notes": "low ambience so the space under the top falls into the reference's deep occlusion; no environment map "
                  "(the game has none)"},
        {"role": "shadow", "softness": "soft PCF self-shadowing; contact shadow on the floor",
         "notes": "the reference's floor shadow is part of its foreground mask, so gate renders carry a matching contact "
                  "shadow: an ambient-occlusion decal (opacity 0.36, falloff 1.2, blur 0.04) offset 15% of the footprint "
                  "toward the back, no light involved (render-options.json)"},
        {"role": "background", "color": "#cbcbcb", "notes": "flat light grey studio floor with the contact shadow"},
        {"role": "exposure and tone mapping", "exposure": 1.45, "toneMapping": "ACES Filmic, sRGB output",
         "notes": "the concept is lit brighter than the game's default; the game keeps its own lights and exposure"},
    ]
    ROUGHNESS_OVERRIDES = ROUGHNESS_OVERRIDES
    build_components = staticmethod(build_components)
    detail_inventory = staticmethod(detail_inventory)
    # the stretchers and cross braces are meso sub-assemblies but carry the silhouette under the top
    BLOCKOUT_EXTRA = [f"stretcher-{i}" for i in range(1, 5)] + [f"brace-{i}" for i in range(1, 5)]
    OBJECT_CLASS = {
        "primaryType": "sawmill saw bench (circular saw table with a log)",
        "primaryDomain": "object",
        "formLanguage": ["hard-surface", "mechanical"],
        "structureKind": ["compound object", "repeated modules", "articulated assembly"],
        "motionPotential": ["articulated"],
        "materialFamilies": ["wood", "metal"],
        "notes": "A long low trestle table of thick boards on six legs with stretchers and end cross braces; a large "
                 "toothed steel blade stands through a slot in the top; a log lies on the top against the blade.",
    }
    COMPLEXITY = {
        "tier": "moderate",
        "scores": {"silhouetteComplexity": 2, "componentCount": 2, "hierarchyDepth": 1, "repetitionDensity": 1,
                   "materialLayerCount": 2, "localDetailDensity": 1, "occlusionRisk": 1, "actionReadinessNeed": 2},
        "estimatedCounts": {"macroComponents": 13, "mesoComponents": 9, "microFeatureGroups": 3, "materialLayers": 6,
                            "repetitionSystems": 0},
        "reasoning": ["A table, a blade and a log: a dozen visible parts with a shallow hierarchy.",
                      "The blade's 20 teeth are one extruded outline, not repeated parts.",
                      "The blade must spin and the log can slide into it (action readiness)."],
    }
    SPEC_DEPTH = {
        "requiredDepth": "moderate", "minimumComponentLevels": ["macro", "meso", "micro"],
        "needsRepetitionSystems": False, "needsMaterialLocalOverrides": True, "needsMultipleReviewViews": True,
        "needsActionReadyHierarchy": True,
        "rationale": "The blade spins about its arbor and the log feeds along X in the game.",
    }
    DEFINITION_OF_DONE = [
        "From the reference camera the render reads as the same saw bench: long low thick-board table on six legs with "
        "stretchers and end cross braces, a big toothed steel blade through the top, a log against the blade.",
        "From the orbits the blade stays a thin round disc with teeth, the legs and braces stay separate parts.",
        "Materials read as muted warm-brown wood, a mid steel-grey blade, a dark iron hub and a pale cut face at ~100 px in game.",
        "Hierarchy exposes the blade's spin pivot and the log's feed pivot.",
    ]
    MIN_SPEC_DEPTH = {"macroComponents": 8, "mesoComponents": 6, "microFeatureGroups": 3, "materialLayers": 4,
                      "repetitionSystems": 0, "reviewViewpoints": 4}
    FEATURE_GROUPS = [
        {"id": "blade-read", "name": "Toothed blade", "required": True,
         "qualityCriteria": ["A large round steel disc with ~20 hooked teeth, its lower part through the top.",
                             "Dark iron hub at its centre."],
         "evidenceRefs": ["full-object"], "failureModes": ["blade reads as a plain disc", "blade floats above the top"]},
        {"id": "table-structure", "name": "Trestle table", "required": True,
         "qualityCriteria": ["Thick five-board top, six square legs, two stretchers per side, an X brace at each end."],
         "evidenceRefs": ["full-object"], "failureModes": ["top merged into one slab without board seams", "legs missing"]},
        {"id": "log-read", "name": "Log against the blade", "required": True,
         "qualityCriteria": ["A round log on the top along the bench, touching the blade, pale cut face outward."],
         "evidenceRefs": ["full-object"], "failureModes": ["log missing or floating", "no cut face"]},
    ]
    SCORES = {"object_isolation": 3, "silhouette_readability": 3, "depth_inference": 2, "primitive_decomposition": 3,
              "material_procedurality": 2, "occlusion_risk": 1, "interaction_fit": 3}
    REFERENCE_CAMERA = {
        "solved": True, "fovDegrees": 24.0, "aspect": 1408 / 768,
        "orientation": {"yaw": 31.0, "pitch": -6.0, "roll": 0.0},
        "azimuthDeg": 31.0, "elevationDeg": 6.0, "positionHint": [2.5, 0.55, 4.1],
        "solveMethod": "silhouette camera fit (renders/camera-fit/camera-fit.json): clay renders of the blockout, with the "
                       "reference's floor shadow reproduced by a contact shadow (render-options.json, settings from "
                       "renders/camera-fit/shadow-sweep.json), vs the reference foreground mask on the Tier-1 224 grid; 667 "
                       "candidates over four lenses; best IoU 0.901 at az 31, el 6, fov 24",
        "note": "Estimated from the image: three-quarter from the front-right (the long face toward the viewer, the "
                "right end face showing), ~14 degrees above; refined by the silhouette camera fit.",
    }
    COORDINATE_FRAME = {"front": "+Z, the long face toward the reference camera", "up": "+Y",
                        "right": "+X, the log's side of the blade", "scaleReference": "table top length = 2.0 object units"}
    SILHOUETTE = {
        "boundingShape": "long low table with a big disc standing up through its middle and a log on its right half",
        "aspectRatios": ["top length : height : width = 2.0 : 0.57 : 0.62", "blade diameter 0.74"],
        "symmetry": "near bilateral about the long axis; blade and log break the end-to-end symmetry",
        "dominantCurves": ["blade rim with teeth", "log cylinder"],
        "negativeSpaces": ["under the top between the legs (the blade's lower part shows there)", "X braces at the ends"],
        "landmarks": ["blade hub", "log cut face", "top corners", "leg feet"],
    }
    VIEW_EVIDENCE = [{"id": "full-object", "view": "primary",
                      "imageRegion": {"x": 0.11, "y": 0.12, "width": 0.78, "height": 0.82, "units": "normalized"},
                      "observations": ["five-board top on six legs", "stretchers and end X braces", "toothed blade with hub",
                                       "log with a pale cut face"], "confidence": 0.85}]
    FEATURE_TARGETS = [
        {"id": "overall-silhouette", "name": "Overall silhouette and proportion system", "tier": "critical",
         "passIds": ["blockout"], "minimumScore": 0.75, "mustPass": True,
         "componentRefs": ["root", "saw-blade", "log", "leg-1"], "evidenceRefs": ["full-object"]},
        {"id": "table-structure", "name": "Board top, legs, stretchers and braces", "tier": "critical",
         "passIds": ["structural-pass", "form-refinement"], "minimumScore": 0.75, "mustPass": True,
         "componentRefs": ["root", "top-board-1", "leg-1", "stretcher-1", "brace-1"], "evidenceRefs": ["full-object"]},
        {"id": "blade-read", "name": "Toothed blade with hub", "tier": "critical",
         "passIds": ["structural-pass", "form-refinement", "material-pass"], "minimumScore": 0.75, "mustPass": True,
         "componentRefs": ["saw-blade", "hub"], "evidenceRefs": ["full-object"]},
        {"id": "log-read", "name": "Log with cut face", "tier": "important",
         "passIds": ["form-refinement", "material-pass"], "minimumScore": 0.65, "mustPass": False,
         "componentRefs": ["log", "log-end"], "evidenceRefs": ["full-object"]},
        {"id": "reference-material-system", "name": "Wood, steel and end-grain palette and response", "tier": "critical",
         "passIds": ["material-pass", "surface-pass", "lighting-pass"], "minimumScore": 0.72, "mustPass": True,
         "componentRefs": ["root", "saw-blade", "log-end"], "evidenceRefs": ["full-object"]},
    ]
    # 8000 selects the skill's "standard" tessellation tier (16-sided attachment cylinders): the bench
    # is ~1k triangles of boxes, so the few round parts (log, hub, nut) can afford to read round
    PERFORMANCE = {"qualityPriority": "real-time game prop", "targetTriangles": 8000, "maxDrawCalls": 8,
                   "textureSize": 256, "fpsTarget": 60,
                   "optimizationPolicy": "Boxes and one extruded blade; the game builds the prop once, merges static "
                                         "parts per material and keeps the blade (spin) and the log (feed) live."}
    ANIMATION_ANCHORS = [
        "root (middle top board) carries whole-prop placement",
        "saw-blade pivot (animationRole spin, socket arbor-axis): rotate about local Z at the blade centre; the hub and "
        "nut ride on it; socket sawdust-fx marks where the rim leaves the top on the log side",
        "log pivot (animationRole feed, socket feed-axis): translate along the log's own axis (root frame "
        "[-0.3746, 0, 0.9272]) toward the blade, then reset",
    ]
    ASSUMPTIONS = [
        "Single view: the hidden back legs, stretchers and brace mirror the visible ones (inferred).",
        "The blade sits on the bench's centre line (z = 0) and spins about Z; its arbor and drive are hidden under the top.",
        "Board seams are shown as 6 mm gaps; the reference's painted board grain is stylized.",
        "Stylized albedo: the illustration's gradients are lighting, not albedo.",
    ]


if __name__ == "__main__":
    run(HERE, Config)
