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
    {"id": "meso", "frequency": 8.0, "amplitude": 0.3, "stretch": [4.0, 0.3], "pattern": "striated",
     "role": "brushing streaks on the steel"},
    {"id": "micro", "frequency": 40.0, "amplitude": 0.06, "role": "highlight breakup under grazing light"},
]

MATERIALS = {
    "wood": Material("wood", "Bench wood", "#ad6a35", ["#8a5027", "#c88a52"], material_class="wood",
                     roughness=0.86, normal=0.35, amplitude=0.2, edge_wear=0.2, dirt=0.1, bands=GRAIN,
                     overrides=[dict(id="bench-grain", kind="groove", region="all bench boards, along their length",
                                     evidenceRefs=["full-object"], confidence=0.7, albedoShift="#7a441f",
                                     pattern="streaked along the board", amplitude=0.15),
                                dict(id="bench-edge-wear", kind="chip", region="top and leg edges", evidenceRefs=["full-object"],
                                     confidence=0.6, albedoShift="#d29a62", roughnessDelta=-0.06, edgeWear=0.25)],
                     notes="Warm orange-brown boards, lighter than the mine cart's wood."),
    "bark": Material("bark", "Log wood", "#9b5c2c", ["#7d4722", "#b4733c"], material_class="wood",
                     roughness=0.9, normal=0.45, amplitude=0.22, bands=GRAIN,
                     overrides=[dict(id="log-bark-streaks", kind="scratch", region="log side", evidenceRefs=["full-object"],
                                     confidence=0.6, albedoShift="#6f3d1b", pattern="long streaks")],
                     notes="The log's side: the same wood family, a little darker and rougher."),
    "end-grain": Material("end-grain", "Log end grain", "#efc49a", ["#dba97a", "#f8dcbc"], material_class="wood",
                          roughness=0.92, normal=0.25, amplitude=0.18, bands=RINGS,
                          overrides=[dict(id="log-end-rings", kind="decal", region="the log's cut face",
                                          evidenceRefs=["full-object"], confidence=0.7, pattern="growth rings")],
                          notes="Pale peach cut face with faint rings."),
    "steel": Material("steel", "Saw steel", "#b6bac0", ["#9a9fa6", "#d3d7db"], material_class="metal",
                      roughness=0.38, metalness=0.3, normal=0.12, amplitude=0.08, bands=BRUSHED,
                      overrides=[dict(id="blade-sheen", kind="gloss", region="blade faces", evidenceRefs=["full-object"],
                                      confidence=0.7, roughness=0.25, note="brushed sheen catching the key light")],
                      notes="Light silver-grey brushed blade."),
    "iron": Material("iron", "Arbor iron", "#3e4046", ["#2d2e33", "#585a61"], material_class="metal",
                     roughness=0.5, metalness=0.45, normal=0.12, amplitude=0.08,
                     overrides=[dict(id="arbor-edge", kind="bevel", region="hub rim", evidenceRefs=["full-object"],
                                     confidence=0.6, roughnessDelta=-0.15)],
                     notes="Dark iron hub and nut."),
    "slot": Material("slot", "Blade slot shadow", "#2c2622", ["#1e1a17", "#3a332d"], material_class="wood",
                     roughness=0.95, normal=0.1, amplitude=0.05,
                     overrides=[dict(id="slot-ao", kind="stain", region="the slot in the top", evidenceRefs=["full-object"],
                                     confidence=0.6, dirtAmount=0.6, cavityBias=1.0)],
                     notes="The dark gap the blade runs through."),
}
FLAT_SHADED: set[str] = set()
METAL_OVERRIDES = {"steel": {"metalness": 0.3, "roughness": 0.38}, "iron": {"metalness": 0.45, "roughness": 0.5}}
ROUGHNESS_OVERRIDES = {"wood": 0.88, "bark": 0.92, "end-grain": 0.93, "slot": 0.96}

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
LOG_Y = TOP_Y + 0.1
LOG_R = 0.1
LOG_Z = 0.12          # the log lies just in front of the blade plane (it hides the blade's right teeth in the reference)
LOG_X = (0.2, 0.7)


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
    b.box("root", "Top board 3", parent=None, center=(0.0, TOP_Y - TOP_T / 2, zs[2]), size=(TOP_LEN, TOP_T, PLANK_W),
          level="macro", role="body", material="wood", anim="root", importance=0.8, confidence=0.75,
          rationale="Top board: a thick rectangular board, box-shaped; the middle one is the bench's root.",
          features=[feature("top-seam-3", "seam", "dark gaps between the five top boards")],
          channels={"translate": True, "rotate": True, "scale": True, "bend": False, "twist": False, "detach": False,
                    "visibility": True, "materialState": True})
    for i, z in enumerate(zs):
        if i == 2:
            continue
        b.box(f"top-board-{i + 1}", f"Top board {i + 1}", parent="root", center=(0.01 * (i % 2), TOP_Y - TOP_T / 2, z),
              size=(TOP_LEN - 0.02 * (i % 2), TOP_T, PLANK_W), level="macro", role="panel", material="wood", importance=0.7,
              features=[feature(f"top-seam-{i + 1}", "seam", "6 mm dark gap to the next board")])
    # legs: three per side
    n = 1
    for x in LEG_X:
        for z in (LEG_Z, -LEG_Z):
            leg_top = TOP_Y - TOP_T + 0.01
            b.box(f"leg-{n}", f"Leg {n}", parent="root", center=(x, (TOP_Y - TOP_T) / 2, z),
                  size=(LEG, leg_top, LEG), level="macro", role="post", material="wood", importance=0.7,
                  edge=("chamfer", 0.012, 1),
                  attachment={"parentId": "root", "parentSocket": "root:underside",
                              "localStart": b.local("root", (x, 0.0, z)), "localEnd": b.local("root", (x, leg_top, z)),
                              "contactType": "butt", "embedDepth": 0.01, "gapTolerance": 0.003, "evidenceRefs": ["full-object"]},
                  rationale="Leg: a square timber post, box-shaped.",
                  features=[feature(f"leg-bevel-{n}", "bevel", "softened leg edges catch the key light")])
            n += 1
    # long stretchers on the outer faces of the legs (front and back), two per side
    k = 1
    for z, side in ((LEG_Z + LEG / 2 + 0.02, "front"), (-(LEG_Z + LEG / 2 + 0.02), "back")):
        for x0, x1 in ((LEG_X[0], LEG_X[1]), (LEG_X[1], LEG_X[2])):
            b.box(f"stretcher-{k}", f"Stretcher {side} {k}", parent="root", center=((x0 + x1) / 2, 0.19, z),
                  size=(abs(x1 - x0) + LEG, 0.075, 0.045), level="meso", role="beam", material="wood", importance=0.6,
                  rationale="Stretcher: a straight board bracing two legs, box-shaped.")
            k += 1
    # X braces between the end legs
    k = 1
    rise, run_z = 0.31, 2 * LEG_Z
    ang = math.atan2(rise, run_z)
    length = math.hypot(rise, run_z) + 0.05
    for x in (LEG_X[0], LEG_X[2]):
        for s in (1, -1):
            b.box(f"brace-{k}", f"Cross brace {k}", parent="root", center=(x + (0.075 if x < 0 else -0.075), 0.22, 0.0),
                  size=(0.035, 0.065, length), rot=(s * ang, 0.0, 0.0), level="meso", role="beam", material="wood",
                  importance=0.55, rationale="Cross brace: a flat diagonal board, box-shaped, one of an X between the end legs.")
            k += 1
    # the blade: a toothed steel disc through a slot in the top, spinning about Z
    b.add("saw-blade", "Saw blade", level="macro", role="blade", parent="root", primitive="extrude",
          world=(BLADE_C[0], BLADE_C[1], BLADE_C[2] - 0.011), material="steel",
          descriptor={"profile2D": {"points": blade_profile(), "depth": 0.022}},
          topology="assembled-solid", anim="spin", pivot_axis=(0, 0, 1), importance=1.0, confidence=0.8,
          channels={"translate": False, "rotate": True, "scale": False, "bend": False, "twist": False, "detach": False,
                    "visibility": True, "materialState": True},
          pivot_world=(BLADE_C[0], BLADE_C[1], BLADE_C[2] - 0.011),
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
    b.rod("log", "Log", parent="root", start=(LOG_X[0], LOG_Y, LOG_Z), end=(LOG_X[1], LOG_Y, LOG_Z), radius=LOG_R,
          level="macro", role="log", material="bark", contact="rests-on", embed=0.008, socket="root:top",
          importance=0.8, anim="feed", pivot_axis=(1, 0, 0),
          rationale="Log: a round length of trunk, a cylinder lying on the top.",
          features=[feature("log-streaks", "scratch", "long grain streaks along the log", effect="material")])
    b.rod("log-end", "Log cut face", parent="log", start=(LOG_X[1], LOG_Y, LOG_Z), end=(LOG_X[1] + 0.006, LOG_Y, LOG_Z), radius=LOG_R - 0.006,
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
        "Materials read as warm orange-brown wood, light steel and a pale cut face at ~100 px in game.",
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
        "aspectRatios": ["top length : height : width = 2.0 : 0.55 : 0.62", "blade diameter 0.76"],
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
        "saw-blade pivot (animationRole spin): rotate about local Z at the blade centre; the hub and nut ride on it",
        "log pivot (animationRole feed): translate along -X into the blade, then reset",
    ]
    ASSUMPTIONS = [
        "Single view: the hidden back legs, stretchers and brace mirror the visible ones (inferred).",
        "The blade sits on the bench's centre line (z = 0) and spins about Z; its arbor and drive are hidden under the top.",
        "Board seams are shown as 6 mm gaps; the reference's painted board grain is stylized.",
        "Stylized albedo: the illustration's gradients are lighting, not albedo.",
    ]


if __name__ == "__main__":
    run(HERE, Config)
