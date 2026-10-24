#!/usr/bin/env python3
"""Compare the Tier-1 colour clusters of a render with the reference's and list the per-part
colour delta-E the gate will compute (diagnose_render.per_part_color_delta), so material tuning can
be aimed before a pass is built and recorded.

    python3 colour_check.py <asset-dir> <render.png>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

SKILL = Path(__file__).resolve().parents[3] / ".agents" / "skills" / "img2threejs"
for sub in ("forge/stage4_review", "forge/_shared", "forge/stage1_intake"):
    sys.path.insert(0, str(SKILL / sub))
import diagnose_render as d  # noqa: E402
from extract_part_color_recipe import lab_kmeans_palette, srgb_to_lab, lab_distance  # noqa: E402


def lab2hex(lab):
    L, a, b = lab
    fy = (L + 16) / 116; fx = fy + a / 500; fz = fy - b / 200
    finv = lambda t: t ** 3 if t ** 3 > 0.008856 else (t - 16 / 116) / 7.787
    X, Y, Z = 0.95047 * finv(fx), finv(fy), 1.08883 * finv(fz)
    rgb = (3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.2040 * Y + 1.0570 * Z)
    gam = lambda c: 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
    return "#%02x%02x%02x" % tuple(int(round(gam(max(0, min(1, c))) * 255)) for c in rgb)


def clusters(path: Path):
    w, h, px, _ = d.load_image(path)
    mask, _, _ = d.build_foreground_mask(w, h, px)
    fg = [srgb_to_lab((r, g, b)) for (r, g, b, _a), k in zip(px, mask) if k]
    return lab_kmeans_palette(fg, k=5)


def main() -> None:
    asset = Path(sys.argv[1])
    render = Path(sys.argv[2])
    spec = json.loads((asset / "object-sculpt-spec.json").read_text())
    rc = clusters(asset / "reference.png")
    nc = clusters(render)
    print("reference clusters:", [lab2hex(c["center"]) for c in rc])
    print("render clusters:   ", [lab2hex(c["center"]) for c in nc])
    seen = {}
    for comp in spec.get("componentTree", []):
        rec = comp.get("colorMaterialRecipe") or {}
        dom = rec.get("dominantAlbedo")
        if not isinstance(dom, str):
            continue
        r, g, b = (int(float(v)) for v in dom[dom.index("(") + 1: dom.index(")")].split(",")[:3])
        lab = srgb_to_lab((r, g, b))
        de = min(lab_distance(lab, c["center"]) for c in nc)
        de_ref = min(lab_distance(lab, c["center"]) for c in rc)
        key = comp.get("material")
        if key not in seen or de > seen[key][0]:
            seen[key] = (de, de_ref, "#%02x%02x%02x" % (r, g, b))
    for k, (de, de_ref, hx) in sorted(seen.items(), key=lambda kv: -kv[1][0]):
        print(f"  {k:10s} {hx}  render dE {de:5.1f}   (vs reference clusters {de_ref:5.1f})")


if __name__ == "__main__":
    main()
