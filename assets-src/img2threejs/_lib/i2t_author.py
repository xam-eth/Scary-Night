"""Shared assess / spec / lock steps for an asset's author.py (the mine cart keeps its own copy of
this logic, written first; the later props use this module).

An author.py defines a `Config` and calls `run(HERE, Config)`:
    python3 author.py assess   # fill assessment.json (pre-spec assessment + quality contract)
    python3 author.py spec     # fill object-sculpt-spec.json from the starter new_sculpt_spec.py wrote
    python3 author.py lock     # after apply_material_analysis.py: no reference textures, real-time scalars
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from i2t_spec import load_json, write_json

LIGHTING = [
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


def assess(here: Path, cfg: Any) -> None:
    path = here / "assessment.json"
    a = load_json(path)
    p = a["preSpecAssessment"]
    p["objectClass"] = cfg.OBJECT_CLASS
    p["complexity"] = cfg.COMPLEXITY
    p["specDepthDecision"] = cfg.SPEC_DEPTH
    # single-view unknowns are resolved by stated assumptions (spec.assumptions)
    p["unknownsToResolveBeforeImplementation"] = []
    p["detailInventory"] = cfg.detail_inventory()
    q = a["qualityContract"]
    q["qualityBar"] = cfg.COMPLEXITY["tier"]
    q["definitionOfDone"] = cfg.DEFINITION_OF_DONE
    q["minimumSpecDepth"] = cfg.MIN_SPEC_DEPTH
    base_groups = [g for g in q.get("featureGroups", []) if g.get("id") in (
        "overall-silhouette", "primary-structure", "attachment-joint-correctness", "surface-material-response", "reference-lookdev")]
    q["featureGroups"] = base_groups + cfg.FEATURE_GROUPS
    a["preSpecAssessment"] = p
    a["qualityContract"] = q
    write_json(path, a)
    print("assessment filled:", path)


def spec(here: Path, cfg: Any) -> None:
    path = here / "object-sculpt-spec.json"
    s = load_json(path)
    a = load_json(here / "assessment.json")
    b = cfg.build_components()
    s["preSpecAssessment"] = a["preSpecAssessment"]
    s["qualityContract"] = a["qualityContract"]
    s["suitability"] = "pass"
    s["scores"] = cfg.SCORES
    s["referenceCamera"] = cfg.REFERENCE_CAMERA
    s["coordinateFrame"] = cfg.COORDINATE_FRAME
    s["silhouette"] = cfg.SILHOUETTE
    s["viewEvidence"] = cfg.VIEW_EVIDENCE
    s["componentTree"] = b.components
    s["materials"] = [m.to_spec() for m in cfg.MATERIALS.values()]
    s["repetitionSystems"] = b.repetition
    s["featureReviewTargets"] = cfg.FEATURE_TARGETS
    macro = [c["id"] for c in b.components if c["level"] == "macro"]
    meso = [c["id"] for c in b.components if c["level"] == "meso"]
    for bp in s["buildPasses"]:
        if bp["id"] == "blockout":
            # silhouette-defining meso sub-assemblies (a bench's stretchers) may join the blockout by
            # explicit reference; the generator includes explicit refs at any level
            bp["componentRefs"] = macro + [c for c in getattr(cfg, "BLOCKOUT_EXTRA", []) if c not in macro]
        elif bp["id"] == "structural-pass":
            bp["componentRefs"] = macro + meso
        else:
            bp["componentRefs"] = ["root"]
    s["performanceBudget"] = cfg.PERFORMANCE
    s["lodPlan"] = [{"tier": "near", "distance": 0, "strategy": "full component tree (the game camera never gets closer)"},
                    {"tier": "far", "distance": 30, "strategy": "static parts merged per material at load; animated pivots kept"}]
    s["lightingFromPhoto"] = getattr(cfg, "LIGHTING", LIGHTING)
    look = s.get("lookDevTargets", {})
    look["qualityPriority"] = "real-time-stylized"
    look["note"] = ("Stylized KayKit-like game prop seen at ~100 px: flat readable albedo with subtle procedural "
                    "breakup; the 1024 px quality-first texture bar does not apply (textures are 256 px).")
    s["lookDevTargets"] = look
    s["animationAnchors"] = cfg.ANIMATION_ANCHORS
    s["assumptions"] = cfg.ASSUMPTIONS
    s["risks"] = []
    write_json(path, s)
    print("spec written:", path, len(b.components), "components,", len(b.repetition), "repetition systems")


def lock(here: Path, cfg: Any) -> None:
    path = here / "object-sculpt-spec.json"
    s = load_json(path)
    for m in s["materials"]:
        ref = m.get("referencePbr")
        if isinstance(ref, dict):
            ref["usable"] = False
            ref["shippingNote"] = ("Extracted from an AI concept image: kept as palette/roughness evidence only, never "
                                   "loaded as textures (DUSKHOLD rule: AI images are concepts only). The factory "
                                   "falls back to its procedural canvas maps.")
        if m["id"] in getattr(cfg, "FLAT_SHADED", set()):
            m["flatShading"] = True
        r = getattr(cfg, "ROUGHNESS_OVERRIDES", {}).get(m["id"])
        if r is not None:
            m["roughness"]["base"] = r
        o = getattr(cfg, "METAL_OVERRIDES", {}).get(m["id"])
        if o:
            m["metalness"] = {"base": o["metalness"], "variation": 0.05}
            m["roughness"]["base"] = o["roughness"]
            m["notes"] = m.get("notes", "") + (f" Real-time override of the registry prior: metalness {o['metalness']}, "
                                                f"roughness {o['roughness']} (the game renderer has no environment map).")
    write_json(path, s)
    print("materials locked (no reference textures, real-time scalars)")


def run(here: Path, cfg: Any) -> None:
    {"assess": assess, "spec": spec, "lock": lock}[sys.argv[1]](here, cfg)
