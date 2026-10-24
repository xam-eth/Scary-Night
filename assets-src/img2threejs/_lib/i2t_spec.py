"""Helpers to author img2threejs ObjectSculptSpec files for DUSKHOLD props.

The img2threejs pipeline (.agents/skills/img2threejs) wants one JSON spec per object with
every component fully described (topology class, attachment contract, action profile,
colour recipe, ...). Writing ~60 components by hand is error-prone, so each asset keeps an
`author.py` that describes its parts in world coordinates and calls these helpers; the
spec it writes is still the single source of truth the generator reads, and the script is
the readable record of every reconstruction decision.

Coordinates: metres-like object units, Y up, +Z = the side facing the reference camera,
the model standing on y = 0.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

SKILL = Path(__file__).resolve().parents[3] / ".agents" / "skills" / "img2threejs"


def rgba(hex_color: str, alpha: float = 1.0) -> str:
    value = hex_color.lstrip("#")
    r, g, b = int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)
    return f"rgba({r}, {g}, {b}, {alpha})"


class Material:
    """One PBR material of the prop (stylized: low-amplitude procedural variation)."""

    def __init__(self, mid: str, name: str, base: str, secondary: list[str], *, material_class: str,
                 roughness: float, metalness: float = 0.0, rough_var: float = 0.12, normal: float = 0.2,
                 amplitude: float = 0.1, pattern: str = "mottled", resolution: int = 256,
                 repeat: tuple[float, float] = (2.0, 2.0), edge_wear: float = 0.0, dirt: float = 0.0,
                 overrides: list[dict[str, Any]] | None = None, notes: str = "", evidence: str = "full-object",
                 clearcoat: float | None = None):
        self.id = mid
        self.name = name
        self.base = base
        self.secondary = secondary
        self.material_class = material_class
        self.roughness = roughness
        self.metalness = metalness
        self.rough_var = rough_var
        self.normal = normal
        self.amplitude = amplitude
        self.pattern = pattern
        self.resolution = resolution
        self.repeat = repeat
        self.edge_wear = edge_wear
        self.dirt = dirt
        self.overrides = overrides or []
        self.notes = notes
        self.evidence = evidence
        self.clearcoat = clearcoat

    def recipe(self, confidence: float = 0.8) -> dict[str, Any]:
        second = self.secondary[0] if self.secondary else self.base
        return {
            "dominantAlbedo": rgba(self.base),
            "secondaryAlbedo": rgba(second),
            "materialClass": self.material_class,
            "materialClassConfidence": confidence,
            "colorGradient": {
                "type": "linear",
                "axis": "y",
                "stops": [
                    {"position": 0.0, "color": rgba(second)},
                    {"position": 1.0, "color": rgba(self.base)},
                ],
            },
            "evidenceRefs": [self.evidence],
        }

    def to_spec(self) -> dict[str, Any]:
        palette = [self.base, *self.secondary]
        spec: dict[str, Any] = {
            "id": self.id,
            "name": self.name,
            "type": "standard",
            "shaderModel": "MeshStandardMaterial / PBR approximation (stylized, low-amplitude variation)",
            "baseColor": self.base,
            "color": self.base,
            "albedo": {
                "dominant": self.base,
                "secondary": self.secondary,
                "samplingNotes": "Sampled from the de-shaded mid tones of the reference region; highlights and core shadows "
                                 "of the illustration are lighting, not albedo.",
            },
            "colorVariation": {"palette": palette, "pattern": self.pattern, "amplitude": self.amplitude, "heightCorrelation": 0.3},
            "textureResolution": self.resolution,
            "textureProjection": {
                "mode": "uv",
                "repeat": list(self.repeat),
                "anisotropy": 4,
                "texelDensityIntent": "Stable object-scale detail sized for a ~100 px on-screen game prop.",
            },
            "surfaceFrequencyBands": [
                {"id": "macro", "frequency": 2.0, "amplitude": round(self.amplitude * 2.5, 3), "role": "broad tone breakup across a part"},
                {"id": "meso", "frequency": 10.0, "amplitude": round(self.amplitude * 1.4, 3), "role": "grain, facets, hammer marks"},
                {"id": "micro", "frequency": 40.0, "amplitude": round(self.amplitude * 0.5, 3), "role": "highlight breakup under grazing light"},
            ],
            "roughness": {
                "base": self.roughness,
                "variation": self.rough_var,
                "map": "independent-procedural-field",
                "localResponse": "slightly rougher in cavities, smoother on worn edges",
            },
            "metalness": {"base": self.metalness, "variation": 0.05 if self.metalness > 0 else 0.0},
            "normal": {"pattern": "derived-from-independent-height-field", "strength": self.normal, "scale": 18.0, "space": "tangent"},
            "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0},
            "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": False},
            "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.3,
                                 "notes": "Darken plank seams, bracket edges and the contact with the parts below."},
            "wear": {"edgeWear": self.edge_wear, "scratches": [], "chips": []},
            "dirt": {"amount": self.dirt, "cavityBias": 0.6 if self.dirt else 0.0, "color": "#3a2c1e"},
            "localOverrides": self.overrides,
            "shaderNotes": [
                "Stylized game prop: keep albedo flat-ish and readable at ~100 px; the procedural maps add only subtle breakup.",
                "Albedo, roughness, height/normal and AO are generated independently; albedo is never reused as another channel.",
            ],
            "notes": self.notes,
            "evidenceRefs": [self.evidence],
        }
        if self.clearcoat is not None:
            spec["clearcoat"] = self.clearcoat
            spec["clearcoatRoughness"] = 0.25
        return spec


# ---- small rotation helpers (three.js Euler order 'XYZ': R = Rx * Ry * Rz) ----------------------
def _mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def _mat_t(a):
    return [[a[j][i] for j in range(3)] for i in range(3)]


def _mat_vec(a, v):
    return [sum(a[i][k] * v[k] for k in range(3)) for i in range(3)]


def mat_from_euler(e):
    x, y, z = e
    cx, sx, cy, sy, cz, sz = math.cos(x), math.sin(x), math.cos(y), math.sin(y), math.cos(z), math.sin(z)
    rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]
    ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]
    rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]
    return _mat_mul(_mat_mul(rx, ry), rz)


def euler_from_mat(m):
    m13 = max(-1.0, min(1.0, m[0][2]))
    y = math.asin(m13)
    if abs(m13) < 0.9999999:
        x = math.atan2(-m[1][2], m[2][2])
        z = math.atan2(-m[0][1], m[0][0])
    else:
        x = math.atan2(m[2][1], m[1][1])
        z = 0.0
    return (x, y, z)


IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]


class SpecBuilder:
    """Collects components and repetition systems. Parts are placed in WORLD coordinates (position
    and Euler rotation); each component's world pivot transform is tracked so the local transform
    the generator wants (relative to the parent pivot, which may itself be rotated) is derived here:
    local position = Rp^T (world - parent), local rotation = Rp^T * Rworld."""

    def __init__(self, target_id: str, materials: dict[str, Material]):
        self.target_id = target_id
        self.materials = materials
        self.components: list[dict[str, Any]] = []
        self.pivots: dict[str, tuple[float, float, float]] = {}
        self.rotations: dict[str, list[list[float]]] = {}
        self.repetition: list[dict[str, Any]] = []

    # ---- placement ------------------------------------------------------------------------
    def local(self, parent: str | None, world: tuple[float, float, float]) -> list[float]:
        if parent is None:
            return [round(v, 4) for v in world]
        p = self.pivots[parent]
        d = [world[i] - p[i] for i in range(3)]
        r = self.rotations.get(parent, IDENTITY)
        return [round(v, 4) for v in _mat_vec(_mat_t(r), d)]

    def local_rotation(self, parent: str | None, world_rot: tuple[float, float, float]) -> tuple[float, float, float]:
        rw = mat_from_euler(world_rot)
        if parent is None:
            return tuple(world_rot)
        rp = self.rotations.get(parent, IDENTITY)
        return euler_from_mat(_mat_mul(_mat_t(rp), rw))

    # ---- components -----------------------------------------------------------------------
    def add(self, cid: str, name: str, *, level: str, role: str, parent: str | None, primitive: str,
            world: tuple[float, float, float] = (0.0, 0.0, 0.0), rot: tuple[float, float, float] = (0.0, 0.0, 0.0),
            scale: tuple[float, float, float] | None = (1.0, 1.0, 1.0), material: str,
            topology: str = "assembled-solid", rationale: str = "", descriptor: dict[str, Any] | None = None,
            attachment: dict[str, Any] | None = None, anim: str = "static", pivot_axis=(0, 1, 0),
            collider: str = "box", features: list[dict[str, Any]] | None = None, importance: float = 0.5,
            confidence: float = 0.75, evidence: str = "full-object", edge: tuple[str, float, int] = ("chamfer", 0.01, 1),
            sockets: list[dict[str, Any]] | None = None, fracture: str | None = None, channels: dict[str, bool] | None = None,
            surface_notes: str = "", pivot_world: tuple[float, float, float] | None = None) -> dict[str, Any]:
        mat = self.materials[material]
        position = self.local(parent, world)
        world_rot = tuple(rot)
        rot = self.local_rotation(parent, world_rot)
        geometry = {
            "topologyIntent": "low-poly stylized game prop, bevel-ready edges",
            "edgeTreatment": {"type": edge[0], "bevelRadius": edge[1], "segments": edge[2]},
            "deformationStack": [],
            "uvStrategy": "generated procedural coordinates",
            "normalStrategy": "vertex normals from generated geometry",
        }
        if descriptor:
            geometry.update(descriptor)
        transform: dict[str, Any] = {"position": position, "rotation": [round(v, 5) for v in rot]}
        if scale is not None:
            transform["scale"] = [round(v, 4) for v in scale]
        dims = scale if scale is not None else (1.0, 1.0, 1.0)
        comp: dict[str, Any] = {
            "id": cid,
            "name": name,
            "level": level,
            "role": role,
            "importance": importance,
            "confidence": confidence,
            "primitive": primitive,
            "topologyClass": topology,
            "topologyRationale": rationale or f"{name}: discrete rigid part with countable flat or simply curved faces.",
            "geometryDescriptor": geometry,
            "parent": parent,
            "attachment": attachment,
            "dimensions": {"width": round(dims[0], 4), "height": round(dims[1], 4), "depth": round(dims[2], 4),
                           "units": "object", "confidence": confidence},
            "transform": transform,
            "actionProfile": {
                "animationRole": anim,
                "pivot": {"mode": "joint" if anim not in ("static", "root") else "center",
                          "localPosition": [0, 0, 0], "axis": list(pivot_axis), "confidence": confidence},
                "transformChannels": channels or {"translate": anim == "root", "rotate": anim not in ("static",),
                                                  "scale": anim == "root", "bend": False, "twist": False,
                                                  "detach": False, "visibility": True, "materialState": True},
                "sockets": sockets or [],
                "collider": {"type": collider, "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": False,
                             "notes": "Proxy sized to the part's own bounds."},
                "constraints": [],
                "destruction": {"breakable": False, "fractureGroup": fracture or cid, "seamRefs": [],
                                "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": material},
            },
            "material": material,
            "materialLayers": [material],
            "colorMaterialRecipe": mat.recipe(confidence=min(0.95, confidence + 0.1)),
            "deformations": [],
            "joints": [],
            "seams": [],
            "localFeatures": features or [],
            "surfaceDetail": {
                "macroRoughness": mat.roughness,
                "microRoughness": round(mat.roughness * 0.2, 3),
                "bumpAmplitude": round(mat.normal * 0.05, 4),
                "normalPattern": mat.pattern,
                "displacementPattern": "",
                "occlusionPattern": "cavity darkening at seams and contacts",
                "edgeWearPattern": "lighter worn edges" if mat.edge_wear else "",
                "notes": surface_notes,
            },
            "evidenceRefs": [evidence],
            "details": [f["id"] for f in (features or []) if isinstance(f, dict) and "id" in f],
        }
        self.components.append(comp)
        self.pivots[cid] = tuple(pivot_world) if pivot_world is not None else tuple(world)
        self.rotations[cid] = mat_from_euler(world_rot)
        return comp

    def box(self, cid: str, name: str, *, parent: str | None, center, size, level="meso", role="panel",
            material: str, rot=(0.0, 0.0, 0.0), **kw) -> dict[str, Any]:
        return self.add(cid, name, level=level, role=role, parent=parent, primitive="box", world=center,
                        rot=rot, scale=size, material=material, **kw)

    def rod(self, cid: str, name: str, *, parent: str, start, end, radius: float, end_radius: float | None = None,
            level="meso", role="connector", material: str, contact="socket", embed=0.01, socket=None,
            primitive="cylinder", **kw) -> dict[str, Any]:
        """An attachment-primitive part: the generator builds it as a cylinder from start to end
        (both in the PARENT pivot's space; given here in world coordinates)."""
        ls = self.local(parent, start)
        le = self.local(parent, end)
        attachment = {
            "parentId": parent,
            "parentSocket": socket or f"{parent}:surface",
            "localStart": ls,
            "localEnd": le,
            "baseRadius": radius,
            "endRadius": end_radius if end_radius is not None else radius,
            "contactType": contact,
            "embedDepth": embed,
            "gapTolerance": 0.004,
            "evidenceRefs": ["full-object"],
        }
        # the endpoint cylinder is built in the parent's frame, so the rod's own pivot must not rotate
        # relative to its parent: its world rotation is the parent's
        parent_rot = euler_from_mat(self.rotations.get(parent, IDENTITY))
        return self.add(cid, name, level=level, role=role, parent=parent, primitive=primitive, world=start,
                        rot=parent_rot, scale=None, material=material, attachment=attachment, collider="capsule", **kw)

    def repeat(self, rid: str, *, parent: str, count: int, primitive: str, instance_scale, axis, radius: float,
               material: str, level: str = "micro", start_deg: float = 0.0, purpose: str = "",
               detail: str | None = None) -> dict[str, Any]:
        system = {
            "id": rid,
            "level": level,
            "parent": parent,
            "count": count,
            "primitive": primitive,
            "material": material,
            "instanceScale": list(instance_scale),
            "placement": {"mode": "radial", "axis": list(axis), "radius": radius, "startAngleDeg": start_deg},
            "distribution": "radial ring around the parent pivot",
            "purpose": purpose,
            "evidenceRefs": ["full-object"],
        }
        if detail:
            system["detailRef"] = detail
        self.repetition.append(system)
        return system


def feature(fid: str, kind: str, description: str, *, effect: str = "geometry", evidence: str = "full-object",
            confidence: float = 0.75, **extra: Any) -> dict[str, Any]:
    out = {"id": fid, "kind": kind, "description": description, "effect": effect, "evidenceRefs": [evidence],
           "confidence": confidence}
    out.update(extra)
    return out


def override(oid: str, kind: str, region: str, *, evidence: str = "full-object", confidence: float = 0.7, **extra: Any) -> dict[str, Any]:
    out = {"id": oid, "kind": kind, "region": region, "evidenceRefs": [evidence], "confidence": confidence}
    out.update(extra)
    return out


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def deg(v: float) -> float:
    return math.radians(v)
