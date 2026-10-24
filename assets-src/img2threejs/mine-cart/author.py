#!/usr/bin/env python3
"""Author the img2threejs assessment + ObjectSculptSpec for the DUSKHOLD mine cart.

    python3 author.py assess   # fill assessment.json (pre-spec assessment + quality contract)
    python3 author.py spec     # fill object-sculpt-spec.json from the starter new_sculpt_spec.py wrote

Every number below is read off reference.png (see analysis/image-analysis.md): tub top length
= 1.0 object unit, Y up, +Z = the long side facing the reference camera, the handle at +X.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "_lib"))
from i2t_spec import Material, SpecBuilder, feature, load_json, override, write_json  # noqa: E402

NAME = "Mine cart"

# ---- materials (albedo = de-shaded mid tones of the reference regions) -----------------------
# surface-pass review: grain as stretched, ridged noise (the generator reads `stretch` and turns a band
# described as grain into ridges), pebbles as a fine high-contrast band on the gravel
WOOD_GRAIN = [
    {"id": "macro", "frequency": 2.0, "amplitude": 0.25, "role": "broad tone breakup across a plank"},
    {"id": "meso", "frequency": 6.0, "amplitude": 0.45, "stretch": [0.35, 4.0], "pattern": "grain",
     "role": "long grain streaks along the plank"},
    {"id": "micro", "frequency": 28.0, "amplitude": 0.08, "role": "highlight breakup under grazing light"},
]
PEBBLES = [
    {"id": "macro", "frequency": 2.0, "amplitude": 0.2, "role": "damp and dry patches of the bed"},
    {"id": "meso", "frequency": 22.0, "amplitude": 0.55, "role": "pebbles and grit"},
    {"id": "micro", "frequency": 56.0, "amplitude": 0.12, "role": "grain of the grit under grazing light"},
]

MATERIALS = {
    "wood": Material("wood", "Cart wood planks", "#a0632f", ["#7f4a22", "#c07f45"], material_class="wood",
                     roughness=0.82, normal=0.35, amplitude=0.2, edge_wear=0.2, dirt=0.15, bands=WOOD_GRAIN,
                     overrides=[
                         dict(id="wood-grain-streaks", kind="groove", region="all plank faces, along the plank length",
                              evidenceRefs=["full-object"], confidence=0.7, roughnessDelta=0.05,
                              albedoShift="#6d3b1c", pattern="streaked along local X", amplitude=0.12),
                         dict(id="plank-edge-wear", kind="chip", region="plank and post edges", evidenceRefs=["full-object"],
                              confidence=0.65, albedoShift="#c08450", roughnessDelta=-0.08, edgeWear=0.25),
                     ],
                     notes="Warm mid-brown planks; the reference's painted grain gouges become a low-amplitude streak "
                           "override and light edge wear."),
    "wood-dark": Material("wood-dark", "Sleeper wood", "#6e4628", ["#57371f", "#8c5a33"], material_class="wood",
                          roughness=0.88, normal=0.4, amplitude=0.2, dirt=0.25, bands=WOOD_GRAIN,
                          overrides=[dict(id="sleeper-dirt", kind="stain", region="sleeper ends and sides",
                                          evidenceRefs=["full-object"], confidence=0.6, dirtAmount=0.3, cavityBias=0.6)],
                          notes="Darker, dirtier wood of the rail sleepers."),
    "iron": Material("iron", "Forged iron", "#50525a", ["#3b3c42", "#6b6e76"], material_class="metal",
                     roughness=0.55, metalness=0.6, normal=0.15, amplitude=0.08, edge_wear=0.15,
                     overrides=[dict(id="iron-edge-highlight", kind="bevel", region="bracket and rim edges",
                                     evidenceRefs=["full-object"], confidence=0.6, roughnessDelta=-0.15)],
                     notes="Dark neutral grey, satin; brackets, rims, rails, rivets, handle straps."),
    "ore": Material("ore", "Gold ore", "#f4c63a", ["#e0a42c", "#ffe57a"], material_class="metal",
                    roughness=0.38, metalness=0.55, normal=0.2, amplitude=0.1, clearcoat=0.3,
                    overrides=[dict(id="ore-facet-gloss", kind="gloss", region="upward-facing nugget facets",
                                    evidenceRefs=["full-object"], confidence=0.7, roughness=0.18,
                                    note="hotspots toward the upper-left key light")],
                    notes="Saturated yellow gold, lighter on the upward facets."),
    "gravel": Material("gravel", "Gravel bed", "#5f5244", ["#3f352b", "#9a8f7d"], material_class="stone",
                       roughness=0.98, normal=0.55, amplitude=0.4, dirt=0.2, bands=PEBBLES,
                       overrides=[dict(id="pebble-mottle", kind="stain", region="whole bed top", evidenceRefs=["full-object"],
                                       confidence=0.6, dirtAmount=0.2, pattern="speckled pebbles")],
                       notes="Irregular grey-brown gravel patch the track lies on."),
}

# ---- tub geometry (measured on reference.png with a 100 px grid; see analysis/proportions.md) ------
# The camera looks at the front-right corner of the tub (the long side on the left, the handle end on
# the right). Measured: tub height = 0.55 x top length, bottom length 0.9 x top, the tub floor at the
# wheel tops, wheel radius 0.165, rails 1.36 long, heap peak ~0.25 above the rim, iron corner caps
# ~0.16 wide.
TUB_BASE = 0.47           # tub floor (wheel tops)
TUB_H = 0.55              # wall height
HALF_LEN_BOT, HALF_LEN_TOP = 0.45, 0.53   # outer half length along X (end walls lean out; form review: wider top flare)
HALF_WID_BOT, HALF_WID_TOP = 0.28, 0.35   # outer half width along Z (long walls lean out)
PLANK_T = 0.04
TILT_Z = math.atan((HALF_WID_TOP - HALF_WID_BOT) / TUB_H)   # long walls
TILT_X = math.atan((HALF_LEN_TOP - HALF_LEN_BOT) / TUB_H)   # end walls
WHEEL_R = 0.165
WHEEL_T = 0.07
RAIL_TOP = 0.16
WHEEL_Y = RAIL_TOP + WHEEL_R
RAIL_Z = 0.335
AXLES = (("front", -0.30), ("rear", 0.22))   # the reference's rear axle sits forward of the end wall


def half_len(y: float) -> float:
    return HALF_LEN_BOT + (y - TUB_BASE) * (HALF_LEN_TOP - HALF_LEN_BOT) / TUB_H


def half_wid(y: float) -> float:
    return HALF_WID_BOT + (y - TUB_BASE) * (HALF_WID_TOP - HALF_WID_BOT) / TUB_H


def build_components() -> SpecBuilder:
    b = SpecBuilder("mine-cart", MATERIALS)

    # root: the gravel patch (the model's ground contact and root motion node)
    b.box("root", "Gravel bed", parent=None, center=(0.0, 0.0, 0.0), size=(1.46, 0.04, 0.98), level="macro",
          role="body", material="gravel", anim="root", importance=0.6, confidence=0.7,
          rationale="Gravel bed: a flat slab-like patch with countable faces; the reference shows it as an irregular "
                    "base, kept as a thin box so the prop sits on the bailey ground.",
          features=[feature("gravel-pebbles", "stain", "speckled pebbles on the bed top", effect="material")],
          channels={"translate": True, "rotate": True, "scale": True, "bend": False, "twist": False, "detach": False,
                    "visibility": True, "materialState": True})

    # track: 3 sleepers, 2 rails, 6 tie plates
    sleeper_x = (-0.54, 0.0, 0.54)   # form review: the track is wider than first read (aspect delta)
    for i, x in enumerate(sleeper_x):
        b.box(f"sleeper-{i}", f"Sleeper {i + 1}", parent="root", center=(x, 0.055, 0.0), size=(0.18, 0.07, 1.16),
              level="macro", role="panel", material="wood-dark", importance=0.55,
              features=[feature(f"sleeper-{i}-ends", "chip", "rounded worn sleeper ends", effect="material")])
    for side, z in (("near", RAIL_Z), ("far", -RAIL_Z)):
        b.box(f"rail-{side}", f"Rail ({side})", parent="root", center=(0.0, RAIL_TOP - 0.035, z), size=(1.44, 0.07, 0.06),
              level="macro", role="panel", material="iron", importance=0.7,
              features=[feature(f"rail-{side}-head", "ridge", "rail head catches a highlight along its top edge")])
        for i, x in enumerate(sleeper_x):
            b.box(f"tie-plate-{side}-{i}", f"Tie plate {side} {i + 1}", parent="root", center=(x, 0.094, z),
                  size=(0.13, 0.012, 0.14), level="micro", role="plate", material="iron", importance=0.25,
                  features=[feature(f"tie-plate-{side}-{i}-spikes", "fastener", "plate pinned to the sleeper")])

    # chassis frame + axles + wheels (+ rim, hub cap, axle nut per wheel)
    b.box("chassis-frame", "Chassis frame", parent="root", center=(0.0, TUB_BASE - 0.06, 0.0), size=(0.84, 0.12, 0.5),
          level="macro", role="frame", material="wood-dark", importance=0.5,
          rationale="Chassis frame: a flat rigid beam frame under the tub, box-shaped; the axles run through it.")
    for name, x in AXLES:
        b.rod(f"axle-{name}", f"Axle ({name})", parent="chassis-frame", start=(x, WHEEL_Y, -0.39),
              end=(x, WHEEL_Y, 0.39), radius=0.026, level="meso", role="connector", material="iron",
              contact="socket", embed=0.014, socket="chassis-frame:axle-boxes", importance=0.35,
              rationale="Axle: a straight round bar, a genuine cylinder between its two bearing points.")
    for key, axle, sign in (("fn", "front", 1.0), ("rn", "rear", 1.0), ("ff", "front", -1.0), ("rf", "rear", -1.0)):
        x = dict(AXLES)[axle]
        z_in, z_out = sign * (RAIL_Z - WHEEL_T / 2), sign * (RAIL_Z + WHEEL_T / 2)
        zc = sign * RAIL_Z
        half_t = WHEEL_T / 2
        # a lathe disc revolves about its local Y; the pivot turns +90 deg about X so that axis is the
        # axle (world Z) and the game spins the wheel about the pivot's local Y
        b.add(f"wheel-{key}", f"Wheel {key}", level="macro", role="wheel", parent="chassis-frame", primitive="lathe",
              world=(x, WHEEL_Y, zc), rot=(math.pi / 2, 0.0, 0.0), scale=(1.0, 1.0, 1.0), material="wood",
              descriptor={"latheProfile": {"points": [[0.0, -half_t], [WHEEL_R, -half_t], [WHEEL_R, half_t], [0.0, half_t]],
                                           "segments": 20}},
              attachment={"parentId": "chassis-frame", "parentSocket": f"axle-{axle}:end",
                          "localStart": b.local("chassis-frame", (x, WHEEL_Y, z_in)),
                          "localEnd": b.local("chassis-frame", (x, WHEEL_Y, z_out)),
                          "contactType": "socket", "embedDepth": 0.01, "gapTolerance": 0.004, "evidenceRefs": ["full-object"]},
              anim="wheel", pivot_axis=(0, 1, 0), collider="cylinder", importance=0.8, topology="assembled-solid",
              rationale="Wheel: a plank disc, revolved (lathe, 20 segments) so it stays round at the low tessellation "
                        "tier; spun about the axle.",
              features=[feature(f"wheel-{key}-planks", "seam", "the disc reads as vertical planks", effect="material")])
        b.add(f"wheel-rim-{key}", f"Wheel rim {key}", level="meso", role="rim", parent=f"wheel-{key}", primitive="torus",
              world=(x, WHEEL_Y, zc), rot=(0.0, 0.0, 0.0), scale=(0.37, 0.37, 0.5), material="iron",
              descriptor={"torusTubeRatio": 0.16}, importance=0.5,
              rationale="Wheel rim: an iron tyre ring around the disc edge, a torus.",
              features=[feature(f"rim-ridge-{key}", "ridge", "iron tyre stands proud of the plank disc")])
        b.rod(f"hub-cap-{key}", f"Hub cap {key}", parent=f"wheel-{key}", start=(x, WHEEL_Y, z_out),
              end=(x, WHEEL_Y, z_out + sign * 0.03), radius=0.055, level="meso", role="cap", material="iron",
              contact="flush", embed=0.004, socket=f"wheel-{key}:face", importance=0.35,
              rationale="Hub cap: a short iron disc on the wheel face.")
        b.rod(f"axle-nut-{key}", f"Axle nut {key}", parent=f"wheel-{key}", start=(x, WHEEL_Y, z_out + sign * 0.03),
              end=(x, WHEEL_Y, z_out + sign * 0.055), radius=0.026, level="micro", role="cap", material="iron",
              contact="threaded", embed=0.003, socket=f"hub-cap-{key}:center", importance=0.25,
              rationale="Axle nut: a small round nut, a short cylinder.",
              features=[feature(f"hex-nut-{key}", "fastener", "axle nut on the hub cap")])

    # tub: tapered core (extruded side profile) + 12 planks + 4 corner posts + 8 brackets
    core_world = (0.0, TUB_BASE, -(HALF_WID_BOT - 0.02))
    b.add("tub-core", "Tub body", level="macro", role="body", parent="chassis-frame", primitive="extrude",
          world=core_world, scale=(1.0, 1.0, 1.0), material="wood",
          descriptor={"profile2D": {"points": [[-HALF_LEN_BOT + 0.02, 0.0], [HALF_LEN_BOT - 0.02, 0.0],
                                               [HALF_LEN_TOP - 0.02, TUB_H], [-HALF_LEN_TOP + 0.02, TUB_H]],
                                    "depth": 2 * (HALF_WID_BOT - 0.02)}},
          topology="continuous-sculpt", importance=1.0, confidence=0.8,
          rationale="Tub body: one continuous tapered volume (an inverted frustum); extruded from its measured side "
                    "profile so the end walls lean out as in the reference, never a plain box.",
          features=[feature("tub-taper", "contour", "end walls lean outward ~5 degrees, long walls ~7 degrees")])

    plank_h = (TUB_H - 0.02) / 3 - 0.01
    for k in range(3):
        y = TUB_BASE + 0.01 + plank_h / 2 + k * (plank_h + 0.01)
        # long walls (planks along X)
        for side, s in (("near", 1.0), ("far", -1.0)):
            zc = s * (half_wid(y) - PLANK_T / 2)
            length = 2 * half_len(y) - 0.1
            b.box(f"plank-{side}-{k}", f"Plank {side} {k + 1}", parent="tub-core", center=(0.0, y, zc),
                  size=(length, plank_h, PLANK_T), rot=(s * TILT_Z, 0.0, 0.0), level="meso", role="plank",
                  material="wood", importance=0.6,
                  features=[feature(f"plank-seam-{side}-{k}", "seam", "10 mm dark gap to the next plank")])
        # end walls (planks along Z)
        for side, s in (("rear", 1.0), ("front", -1.0)):
            xc = s * (half_len(y) - PLANK_T / 2)
            length = 2 * half_wid(y) - 0.1
            b.box(f"plank-{side}-{k}", f"Plank {side} {k + 1}", parent="tub-core", center=(xc, y, 0.0),
                  size=(PLANK_T, plank_h, length), rot=(0.0, 0.0, -s * TILT_X), level="meso", role="plank",
                  material="wood", importance=0.5,
                  features=[feature(f"plank-seam-{side}-{k}", "seam", "10 mm dark gap to the next plank")])

    yc = TUB_BASE + TUB_H / 2
    for key, sx, sz in (("nl", -1, 1), ("nr", 1, 1), ("fl", -1, -1), ("fr", 1, -1)):
        rot = (sz * TILT_Z, 0.0, -sx * TILT_X)
        b.box(f"post-{key}", f"Corner post {key}", parent="tub-core",
              center=(sx * (half_len(yc) - 0.04), yc, sz * (half_wid(yc) - 0.04)), size=(0.1, TUB_H + 0.02, 0.1),
              rot=rot, level="macro", role="post", material="wood", importance=0.6,
              rationale="Corner post: a square timber, box-shaped, leaning with both wall tapers.")
        for tier, y, h in (("top", TUB_BASE + TUB_H - 0.055, 0.13), ("bot", TUB_BASE + 0.06, 0.12)):
            bid = f"bracket-{tier}-{key}"
            w = 0.165 if tier == "top" else 0.15
            b.box(bid, f"Bracket {tier} {key}", parent="tub-core",
                  center=(sx * (half_len(y) - w / 2 + 0.02), y, sz * (half_wid(y) - w / 2 + 0.02)), size=(w, h, w),
                  rot=rot, level="macro", role="bracket", material="iron", importance=0.6,
                  edge=("chamfer", 0.01, 1),
                  features=[feature(f"{bid}-chamfer", "bevel", "chamfered iron corner-cap edges catch the key light"),
                            feature(f"{bid}-rivets", "fastener", "round rivet heads, one per face centre")])
            b.repeat(f"rivets-{tier}-{key}", parent=bid, count=4, primitive="sphere", instance_scale=(0.034, 0.034, 0.034),
                     axis=(0, 1, 0), radius=w + 0.012, material="iron", purpose="rivet heads on the bracket faces",
                     detail=f"{bid}-rivets")

    # push handle: two bent iron straps on the rear end wall + a wooden grip with iron end caps
    grip_y = TUB_BASE + TUB_H - 0.22   # blockout review: 0.05 lower ...
    grip_x = 0.65                     # ... and 0.03 closer to the end wall
    for side, zc in (("near", 0.19), ("far", -0.19)):
        # structural review: the stepped extrude read as blocks; the reference has round bent bars,
        # so each strap is a bar up the end wall, a knee, and a bar out to the grip
        y_foot, y_knee = TUB_BASE + 0.05, grip_y - 0.02
        x_foot, x_knee = half_len(y_foot) + 0.045, half_len(y_knee) + 0.05
        b.rod(f"handle-strap-{side}", f"Handle strap ({side})", parent="tub-core", start=(x_foot, y_foot, zc),
              end=(x_knee, y_knee, zc), radius=0.024, level="macro", role="handle", material="iron",
              contact="bolted", embed=0.01, socket="tub-core:rear-wall", importance=0.6,
              rationale="Handle strap: a straight round iron bar up the end wall, a cylinder between its bolted foot "
                        "and its knee.",
              features=[feature(f"handle-strap-{side}-bolt", "fastener", "strap bolted to the end wall")])
        b.rod(f"handle-arm-{side}", f"Handle arm ({side})", parent="tub-core", start=(x_knee, y_knee, zc),
              end=(grip_x, grip_y, zc), radius=0.024, level="meso", role="handle", material="iron",
              contact="welded", embed=0.012, socket=f"handle-strap-{side}:knee", importance=0.45,
              rationale="Handle arm: the strap's short outward bar from the knee to the grip, a cylinder.")
        b.add(f"handle-knee-{side}", f"Handle knee ({side})", level="micro", role="handle", parent="tub-core",
              primitive="sphere", world=(x_knee, y_knee, zc), scale=(0.054, 0.054, 0.054), material="iron",
              attachment={"parentId": "tub-core", "parentSocket": f"handle-strap-{side}:knee",
                          "localStart": b.local("tub-core", (x_knee, y_knee - 0.01, zc)),
                          "localEnd": b.local("tub-core", (x_knee, y_knee + 0.01, zc)),
                          "contactType": "welded", "embedDepth": 0.02, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]},
              importance=0.3, rationale="Handle knee: the rounded bend between the two bars, a sphere.")
        b.box(f"handle-foot-{side}", f"Handle foot plate ({side})", parent="tub-core",
              center=(half_len(y_foot) + 0.012, y_foot, zc), size=(0.03, 0.1, 0.075), rot=(0.0, 0.0, -TILT_X),
              level="micro", role="handle", material="iron", importance=0.3,
              attachment={"parentId": "tub-core", "parentSocket": "tub-core:rear-wall",
                          "localStart": b.local("tub-core", (half_len(y_foot), y_foot, zc)),
                          "localEnd": b.local("tub-core", (half_len(y_foot) + 0.03, y_foot, zc)),
                          "contactType": "bolted", "embedDepth": 0.006, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]},
              rationale="Handle foot plate: a flat iron plate bolting the strap to the end wall, a box.")
    b.rod("grip", "Push grip", parent="tub-core", start=(grip_x, grip_y, -0.26), end=(grip_x, grip_y, 0.26),
          radius=0.035, level="macro", role="grip", material="wood", contact="socket", embed=0.01,
          socket="handle-strap-near:hook", importance=0.6,
          rationale="Push grip: a round wooden bar, a cylinder held by both straps.")
    for side, z0, z1 in (("near", 0.26, 0.3), ("far", -0.26, -0.3)):
        b.rod(f"grip-cap-{side}", f"Grip end cap ({side})", parent="grip", start=(grip_x, grip_y, z0),
              end=(grip_x, grip_y, z1), radius=0.05, level="micro", role="cap", material="iron", contact="flush",
              embed=0.004, socket="grip:end", importance=0.3,
              rationale="Grip end cap: a short round iron cap, a cylinder.")

    # ore heap: a domed mass above the rim + chunky faceted nuggets on its surface
    rim_y = TUB_BASE + TUB_H
    heap_c = (0.0, rim_y - 0.02, 0.0)
    ax, ay, az = 0.47, 0.18, 0.33
    b.add("ore-heap", "Ore heap", level="macro", role="fill", parent="tub-core", primitive="sphere",
          world=heap_c, scale=(2 * ax, 2 * ay, 2 * az), material="ore", topology="continuous-sculpt",
          importance=0.9, confidence=0.75,
          rationale="Ore heap: one smooth domed mass of ore filling the tub, an ellipsoid; the nuggets on it carry the "
                    "faceted read.",
          features=[feature("ore-dome", "contour", "heap rises ~0.25 above the rim, highest near the centre")])
    rings = [(0.0, 1, 0.0, 0.21), (0.36, 6, 15.0, 0.19), (0.66, 9, 5.0, 0.16), (0.92, 12, 12.0, 0.13)]
    n = 0
    for r, count, start, base_size in rings:
        for i in range(count):
            ang = math.radians(start + i * 360.0 / count)
            x, z = ax * r * math.cos(ang), az * r * math.sin(ang)
            # form review: the reference pile slopes down toward the rear (+X) end
            surf = heap_c[1] + ay * math.sqrt(max(0.0, 1.0 - r * r)) - 0.07 * max(0.0, x / ax)
            size = base_size * (1.0 + 0.18 * math.sin(7 * ang + r * 3))
            # form review 2: decimated spheres read as crumpled foil; a few-sided revolved bipyramid,
            # turned and squashed, reads as the reference's chunky faceted nugget
            sides = 5 + (n % 3)
            b.add(f"nugget-{n:02d}", f"Ore nugget {n + 1}", level="micro", role="nugget", parent="ore-heap",
                  primitive="lathe", world=(x, surf + size * 0.02, z),
                  rot=(0.5 * math.sin(3 * ang + r), ang * 1.7, 0.45 * math.cos(5 * ang + r)),
                  scale=(size * 1.2, size * 0.95, size * 1.05), material="ore", topology="assembled-solid",
                  descriptor={"latheProfile": {"points": [[0.0, -0.42], [0.36, -0.22], [0.5, 0.04], [0.38, 0.3],
                                                          [0.12, 0.46], [0.0, 0.48]], "segments": sides}},
                  importance=0.35, confidence=0.6,
                  rationale=f"Ore nugget: a chunky faceted lump: a {sides}-sided revolved bipyramid, turned and squashed "
                            "irregularly, so each reads as an angular polyhedron like the reference's nuggets.",
                  features=[feature(f"nugget-{n:02d}-facets", "gloss", "lighter upward facets", effect="material")])
            n += 1
    return b


def detail_inventory() -> dict:
    zone = "detail-inventory/zone-{}.png"
    return {
        "scanMethod": "grid-3x3",
        "targetMinDetails": 6,
        "note": "Zones from build_detail_inventory.py (di.json); every detail maps to a component.localFeatures or "
                "material.localOverrides entry of object-sculpt-spec.json.",
        "details": [
            {"id": "d-rivets", "kind": "fastener", "description": "round rivet heads on every iron corner bracket",
             "region": {"x": 0.26, "y": 0.22, "width": 0.5, "height": 0.42, "units": "normalized"}, "scale": "micro",
             "affects": "geometry", "mapsTo": {"type": "component.localFeatures", "ref": "bracket-top-nl-rivets"},
             "evidenceRef": zone.format("r0c1"), "confidence": 0.8},
            {"id": "d-plank-seams", "kind": "seam", "description": "dark gaps between the three horizontal planks of each wall",
             "region": {"x": 0.3, "y": 0.25, "width": 0.4, "height": 0.4, "units": "normalized"}, "scale": "meso",
             "affects": "geometry", "mapsTo": {"type": "component.localFeatures", "ref": "plank-seam-near-0"},
             "evidenceRef": zone.format("r1c1"), "confidence": 0.85},
            {"id": "d-bracket-bevel", "kind": "bevel", "description": "chamfered edges of the iron L-brackets catch the key light",
             "region": {"x": 0.27, "y": 0.23, "width": 0.46, "height": 0.4, "units": "normalized"}, "scale": "micro",
             "affects": "geometry", "mapsTo": {"type": "component.localFeatures", "ref": "bracket-top-nl-chamfer"},
             "evidenceRef": zone.format("r0c2"), "confidence": 0.7},
            {"id": "d-ore-gloss", "kind": "gloss", "description": "light, low-roughness upward facets on the gold nuggets",
             "region": {"x": 0.34, "y": 0.1, "width": 0.32, "height": 0.2, "units": "normalized"}, "scale": "micro",
             "affects": "material", "mapsTo": {"type": "material.localOverrides", "ref": "ore-facet-gloss"},
             "evidenceRef": zone.format("r0c1"), "confidence": 0.75},
            {"id": "d-wood-grain", "kind": "groove", "description": "streaky darker grain gouges along the planks",
             "region": {"x": 0.3, "y": 0.28, "width": 0.4, "height": 0.35, "units": "normalized"}, "scale": "micro",
             "affects": "material", "mapsTo": {"type": "material.localOverrides", "ref": "wood-grain-streaks"},
             "evidenceRef": zone.format("r1c1"), "confidence": 0.65},
            {"id": "d-wheel-rim", "kind": "ridge", "description": "iron tyre ring standing proud of each plank wheel",
             "region": {"x": 0.3, "y": 0.56, "width": 0.25, "height": 0.25, "units": "normalized"}, "scale": "meso",
             "affects": "geometry", "mapsTo": {"type": "component.localFeatures", "ref": "rim-ridge-fn"},
             "evidenceRef": zone.format("r2c1"), "confidence": 0.85},
            {"id": "d-axle-nut", "kind": "fastener", "description": "a hub cap and axle nut on every wheel face",
             "region": {"x": 0.33, "y": 0.64, "width": 0.18, "height": 0.12, "units": "normalized"}, "scale": "micro",
             "affects": "geometry", "mapsTo": {"type": "component.localFeatures", "ref": "hex-nut-fn"},
             "evidenceRef": zone.format("r2c1"), "confidence": 0.8},
            {"id": "d-edge-wear", "kind": "chip", "description": "lighter worn edges on planks and posts",
             "region": {"x": 0.28, "y": 0.25, "width": 0.45, "height": 0.4, "units": "normalized"}, "scale": "micro",
             "affects": "material", "mapsTo": {"type": "material.localOverrides", "ref": "plank-edge-wear"},
             "evidenceRef": zone.format("r1c0"), "confidence": 0.6},
            {"id": "d-tie-plates", "kind": "fastener", "description": "iron tie plates pin the rails to the sleepers",
             "region": {"x": 0.25, "y": 0.72, "width": 0.5, "height": 0.2, "units": "normalized"}, "scale": "micro",
             "affects": "geometry", "mapsTo": {"type": "component.localFeatures", "ref": "tie-plate-near-1-spikes"},
             "evidenceRef": zone.format("r2c1"), "confidence": 0.7},
            {"id": "d-gravel", "kind": "stain", "description": "speckled pebble mottle on the gravel bed",
             "region": {"x": 0.22, "y": 0.75, "width": 0.56, "height": 0.2, "units": "normalized"}, "scale": "micro",
             "affects": "material", "mapsTo": {"type": "material.localOverrides", "ref": "pebble-mottle"},
             "evidenceRef": zone.format("r2c0"), "confidence": 0.6},
        ],
    }


def assess() -> None:
    path = HERE / "assessment.json"
    a = load_json(path)
    p = a["preSpecAssessment"]
    p["objectClass"] = {
        "primaryType": "mine cart (ore tub on a short rail section)",
        "primaryDomain": "object",
        "formLanguage": ["hard-surface", "mechanical"],
        "structureKind": ["compound object", "repeated modules", "articulated assembly"],
        "motionPotential": ["whole-object transform", "articulated"],
        "materialFamilies": ["wood", "metal", "stone"],
        "notes": "Wheeled open tub of planks with iron hardware, heaped with gold ore, standing on two rails over three "
                 "sleepers on a gravel patch. Stylized low-poly target to match the DUSKHOLD KayKit world.",
    }
    p["complexity"] = {
        "tier": "moderate",
        "scores": {"silhouetteComplexity": 2, "componentCount": 2, "hierarchyDepth": 2, "repetitionDensity": 2,
                   "materialLayerCount": 2, "localDetailDensity": 1, "occlusionRisk": 1, "actionReadinessNeed": 2},
        "estimatedCounts": {"macroComponents": 9, "mesoComponents": 30, "microFeatureGroups": 6, "materialLayers": 5,
                            "repetitionSystems": 8},
        "reasoning": [
            "Several distinct parts (tub, ore heap, four wheels, handle, two rails, sleepers) with a shallow hierarchy.",
            "Repeated planks, brackets, rivets and nuggets, but no dense microstructure.",
            "Four materials plus the gravel bed; local detail is mostly edge wear and grain.",
            "Wheels must spin and the cart must be able to roll along the rails (action readiness).",
        ],
    }
    p["specDepthDecision"] = {
        "requiredDepth": "moderate",
        "minimumComponentLevels": ["macro", "meso", "micro"],
        "needsRepetitionSystems": True,
        "needsMaterialLocalOverrides": True,
        "needsMultipleReviewViews": True,
        "needsActionReadyHierarchy": True,
        "rationale": "Planks, brackets and nuggets repeat; wheel pivots and a root motion node are needed for the "
                     "in-game rolling animation.",
    }
    # The three single-view unknowns are resolved by stated assumptions (see spec.assumptions):
    # hidden right side / rear mirrored, two straight axles on a flat chassis, one rivet per face.
    p["unknownsToResolveBeforeImplementation"] = []
    p["detailInventory"] = detail_inventory()
    q = a["qualityContract"]
    q["qualityBar"] = "moderate"
    q["definitionOfDone"] = [
        "From the reference camera the render reads as the same cart: outward-tapered plank tub, heaped gold ore above "
        "the rim, four iron-rimmed plank wheels resting on two rails over three sleepers, rear push handle.",
        "From the side and rear orbits the tub stays a hollow-looking tapered box (no flat card), wheels stay round.",
        "Materials read as warm wood, dark iron and saturated gold at a ~100 px in-game size.",
        "Hierarchy exposes spinning wheel pivots and a root node so the game can roll the cart along its rails.",
    ]
    q["minimumSpecDepth"] = {"macroComponents": 6, "mesoComponents": 12, "microFeatureGroups": 4, "materialLayers": 4,
                             "repetitionSystems": 4, "reviewViewpoints": 4}
    q["featureGroups"] = q.get("featureGroups", []) + [
        {"id": "tub-taper-and-planks", "name": "Tapered plank tub", "required": True,
         "qualityCriteria": ["End walls lean out ~10 degrees and long walls ~8.5 degrees.",
                             "Three horizontal planks per wall separated by dark seams; four corner posts."],
         "evidenceRefs": ["full-object"], "failureModes": ["tub reads as a plain straight box", "planks merged into one slab"]},
        {"id": "wheel-rail-contact", "name": "Wheels on rails", "required": True,
         "qualityCriteria": ["Four plank wheels with iron rims rest exactly on two rails over three sleepers."],
         "evidenceRefs": ["full-object"], "failureModes": ["wheels float above or sink into the rails", "wheels not round"]},
        {"id": "iron-hardware", "name": "Iron hardware", "required": True,
         "qualityCriteria": ["Eight corner brackets with rivets, rims, hub caps and nuts, two bent handle straps with a grip."],
         "evidenceRefs": ["full-object"], "failureModes": ["hardware missing or the same colour as the wood"]},
        {"id": "ore-heap-read", "name": "Heaped gold ore", "required": True,
         "qualityCriteria": ["Saturated yellow ore mounds above the rim with chunky faceted nuggets."],
         "evidenceRefs": ["full-object"], "failureModes": ["ore flat at rim height", "ore not reading as gold"]},
    ]
    a["preSpecAssessment"] = p
    a["qualityContract"] = q
    write_json(path, a)
    print("assessment filled:", path)


def spec() -> None:
    path = HERE / "object-sculpt-spec.json"
    s = load_json(path)
    a = load_json(HERE / "assessment.json")
    b = build_components()
    s["preSpecAssessment"] = a["preSpecAssessment"]
    s["qualityContract"] = a["qualityContract"]
    s["suitability"] = "pass"
    s["scores"] = {"object_isolation": 3, "silhouette_readability": 3, "depth_inference": 2, "primitive_decomposition": 3,
                   "material_procedurality": 2, "occlusion_risk": 1, "interaction_fit": 3}
    s["referenceCamera"] = {
        "solved": True, "fovDegrees": 18.0, "aspect": 1408 / 768,
        "orientation": {"yaw": 37.0, "pitch": -6.0, "roll": 0.0},
        "azimuthDeg": 37.0, "elevationDeg": 6.0, "positionHint": [2.9, 0.5, 3.8],
        "solveMethod": "silhouette camera fit (renders/camera-fit/camera-fit.json): clay renders vs the reference "
                       "foreground mask on the Tier-1 224 grid, 326 candidates; refit after the form review: best IoU "
                       "0.877 at az 37, el 6, fov 18 (a long lens: the reference reads as a product shot). The first "
                       "fit (macro build) gave az 27, el 7, fov 14.",
        "note": "Estimated from the image: three-quarter from the front-RIGHT (the long side faces the viewer, the "
                "handle end face shows on the right, the rim's top edge falls toward the right), ~27 degrees above; the review harness "
                "frames the model to the reference's foreground box. Not solved for projection (no projection used).",
    }
    s["coordinateFrame"] = {"front": "+Z, the long side facing the reference camera", "up": "+Y",
                            "rear": "+X, the push-handle end", "scaleReference": "tub top length = 1.0 object unit"}
    s["silhouette"] = {
        "boundingShape": "wide low trapezoid: open tapered tub over four wheels, heaped ore dome on top, rails below",
        "aspectRatios": ["overall length : height ~ 1.5 : 0.9", "tub top length : width : height = 1.0 : 0.7 : 0.4"],
        "symmetry": "bilateral about the long (X) axis; the handle breaks front/rear symmetry",
        "dominantCurves": ["ore heap dome", "round wheels", "handle strap bend"],
        "negativeSpaces": ["gaps between the wheels under the tub", "space between the handle grip and the end wall",
                           "gravel showing between the sleepers"],
        "landmarks": ["tub rim corners with iron caps", "wheel hubs", "grip end caps", "rail ends"],
    }
    s["viewEvidence"] = [{"id": "full-object", "view": "primary",
                          "imageRegion": {"x": 0.22, "y": 0.1, "width": 0.56, "height": 0.86, "units": "normalized"},
                          "observations": ["tapered plank tub with iron corner caps", "gold ore heap", "four rimmed wheels",
                                           "rear push handle", "two rails on three sleepers on gravel"],
                          "confidence": 0.85}]
    s["componentTree"] = b.components
    s["materials"] = [m.to_spec() for m in MATERIALS.values()]
    s["repetitionSystems"] = b.repetition
    s["featureReviewTargets"] = [
        {"id": "overall-silhouette", "name": "Overall silhouette and proportion system", "tier": "critical",
         "passIds": ["blockout"], "minimumScore": 0.75, "mustPass": True,
         "componentRefs": ["tub-core", "ore-heap", "wheel-fn", "rail-near", "grip"], "evidenceRefs": ["full-object"]},
        {"id": "tub-taper-and-planks", "name": "Tapered plank tub with corner posts", "tier": "critical",
         "passIds": ["structural-pass", "form-refinement"], "minimumScore": 0.75, "mustPass": True,
         "componentRefs": ["tub-core", "plank-near-0", "post-nl"], "evidenceRefs": ["full-object"]},
        {"id": "wheel-rail-contact", "name": "Rimmed wheels resting on the rails", "tier": "critical",
         "passIds": ["structural-pass", "form-refinement"], "minimumScore": 0.75, "mustPass": True,
         "componentRefs": ["wheel-fn", "wheel-rim-fn", "rail-near", "sleeper-1"], "evidenceRefs": ["full-object"]},
        {"id": "iron-hardware", "name": "Brackets, rivets, rims and handle", "tier": "important",
         "passIds": ["form-refinement", "material-pass"], "minimumScore": 0.65, "mustPass": False,
         "componentRefs": ["bracket-top-nl", "handle-strap-near", "grip"], "evidenceRefs": ["full-object"]},
        {"id": "ore-heap-read", "name": "Heaped faceted gold ore", "tier": "critical",
         "passIds": ["form-refinement", "material-pass"], "minimumScore": 0.75, "mustPass": True,
         "componentRefs": ["ore-heap", "nugget-00"], "evidenceRefs": ["full-object"]},
        {"id": "reference-material-system", "name": "Wood, iron, gold and gravel palette and response", "tier": "critical",
         "passIds": ["material-pass", "surface-pass", "lighting-pass"], "minimumScore": 0.72, "mustPass": True,
         "componentRefs": ["tub-core", "rail-near", "ore-heap", "root"], "evidenceRefs": ["full-object"]},
    ]
    macro = [c["id"] for c in b.components if c["level"] == "macro"]
    meso = [c["id"] for c in b.components if c["level"] == "meso"]
    for bp in s["buildPasses"]:
        if bp["id"] == "blockout":
            bp["componentRefs"] = macro
        elif bp["id"] == "structural-pass":
            bp["componentRefs"] = macro + meso
        else:
            bp["componentRefs"] = ["root"]
    s["performanceBudget"] = {"qualityPriority": "real-time game prop", "targetTriangles": 6000, "maxDrawCalls": 12,
                              "textureSize": 256, "fpsTarget": 60,
                              "optimizationPolicy": "Reach accepted fidelity, then merge static parts per material at "
                                                    "load in the game (wheels stay separate to spin)."}
    s["lodPlan"] = [{"tier": "near", "distance": 0, "strategy": "full component tree (game camera never gets closer)"},
                    {"tier": "far", "distance": 30, "strategy": "static parts merged per material; wheels kept"}]
    s["lightingFromPhoto"] = [
        {"role": "key light", "direction": "upper left, slightly in front", "color": "#fff4e6", "softness": "soft studio"},
        {"role": "fill light", "direction": "right", "color": "#dfe6ff", "intensity": "low"},
        {"role": "environment light", "type": "hemisphere", "sky": "#f2f4ff", "ground": "#4a4036",
         "notes": "soft studio ambience; the game renderer has no environment map, so neither do the review renders"},
        {"role": "shadow", "softness": "soft PCF, contact shadow faint (kept off the plate in gate renders so the "
                                      "silhouette mask measures the object, not its shadow)"},
        {"role": "background", "color": "#c9c9c9", "notes": "flat light grey, faint contact shadow"},
        {"role": "exposure and tone mapping", "exposure": 1.0, "toneMapping": "ACES Filmic, sRGB output",
         "notes": "review renders and the game both use ACES-style tone mapping at exposure ~1"},
    ]
    look = s.get("lookDevTargets", {})
    look["qualityPriority"] = "real-time-stylized"
    look["note"] = ("Stylized KayKit-like game prop seen at ~100 px: flat readable albedo with subtle procedural "
                    "breakup; the 1024 px quality-first texture bar does not apply (textures are 256 px).")
    s["lookDevTargets"] = look
    s["animationAnchors"] = [
        "root (gravel bed) carries whole-prop placement",
        "wheel-fn/rn/ff/rf pivots spin about local Z (the axle) while the cart rolls",
        "the cart above the rails can translate along X on the rails (game-side: the tub group rolls, track stays)",
    ]
    s["assumptions"] = p_assumptions()
    s["risks"] = []
    write_json(path, s)
    print("spec written:", path, len(b.components), "components,", len(b.repetition), "repetition systems")


def p_assumptions() -> list[str]:
    return ["Single view: the hidden right long side and the rear end mirror the visible ones (inferred, low confidence).",
            "Tub floor and axles are hidden: two straight axles on a flat chassis frame (inferred).",
            "One rivet per bracket face (the count is not legible at this resolution).",
            "Rails modelled as plain bars (no I-profile) at the game's viewing distance.",
            "Stylized albedo: the illustration's painted grain and gradients are not reproduced one-to-one."]


# Real-time overrides applied AFTER apply_material_analysis.py wired the registry priors in:
# the game renderer (src/game/envkit.js) has no environment map, so a metalness-1 prior (steel,
# gold) renders near-black there; and the reference is an AI concept image, so its extracted
# crop maps must never ship as textures (project rule: AI images are concepts only).
# material-pass review: wood/gravel at the registry's 0.72 roughness flashed white at grazing angles;
# gold at metalness 0.45 shaded orange in its shadows (colour gate delta-E 20.0) -> 0.25
METAL_OVERRIDES = {"iron": {"metalness": 0.45, "roughness": 0.5}, "ore": {"metalness": 0.25, "roughness": 0.34}}
ROUGHNESS_OVERRIDES = {"wood": 0.88, "wood-dark": 0.92, "gravel": 0.96}


def lock() -> None:
    path = HERE / "object-sculpt-spec.json"
    s = load_json(path)
    for m in s["materials"]:
        ref = m.get("referencePbr")
        if isinstance(ref, dict):
            ref["usable"] = False
            ref["shippingNote"] = ("Extracted from an AI concept image: kept as palette/roughness evidence only, never "
                                   "loaded as textures (DUSKHOLD rule: AI images are concepts only). The factory "
                                   "falls back to its procedural canvas maps.")
        if m["id"] in ROUGHNESS_OVERRIDES:
            m["roughness"]["base"] = ROUGHNESS_OVERRIDES[m["id"]]
        o = METAL_OVERRIDES.get(m["id"])
        if o:
            m["metalness"] = {"base": o["metalness"], "variation": 0.05}
            m["roughness"]["base"] = o["roughness"]
            m.setdefault("notes", "")
            m["notes"] += (f" Real-time override of the registry prior (metalness 1.0): metalness {o['metalness']}, "
                           f"roughness {o['roughness']}, because the game renderer has no environment map.")
    write_json(path, s)
    print("materials locked (no reference textures, real-time metal scalars)")


if __name__ == "__main__":
    {"assess": assess, "spec": spec, "lock": lock}[sys.argv[1]]()
