#!/usr/bin/env python3
"""Mean colour of each material-regions.json box in the reference and in a fixed-view render (the
fixed view is framed to the reference's gate box, so the boxes land on the same parts), with the
delta-E between them: shows which albedos render too light/dark before a material pass is recorded.

    python3 region_compare.py <asset-dir> <render.png>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

SKILL = Path(__file__).resolve().parents[3] / ".agents" / "skills" / "img2threejs"
for sub in ("forge/stage4_review", "forge/_shared", "forge/stage1_intake"):
    sys.path.insert(0, str(SKILL / sub))
import diagnose_render as d  # noqa: E402
from extract_part_color_recipe import srgb_to_lab, lab_distance  # noqa: E402


def mean(px, w, box, sw, sh, W, H):
    # box is in reference pixels; scale to this image
    x0, y0 = int(box["x"] * W / sw), int(box["y"] * H / sh)
    x1, y1 = int((box["x"] + box["width"]) * W / sw), int((box["y"] + box["height"]) * H / sh)
    rs = gs = bs = n = 0
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b, _ = px[y * w + x]; rs += r; gs += g; bs += b; n += 1
    return (rs // n, gs // n, bs // n)


def main() -> None:
    asset = Path(sys.argv[1]); render = Path(sys.argv[2])
    regions = json.loads((asset / "material-regions.json").read_text())["regions"]
    rw, rh, rpx, _ = d.load_image(asset / "reference.png")
    nw, nh, npx, _ = d.load_image(render)
    for reg in regions:
        a = mean(rpx, rw, reg["bbox"], rw, rh, rw, rh)
        b = mean(npx, nw, reg["bbox"], rw, rh, nw, nh)
        de = lab_distance(srgb_to_lab(a), srgb_to_lab(b))
        la, lb = srgb_to_lab(a)[0], srgb_to_lab(b)[0]
        print(f"  {reg['regionId']:16s} ref #{a[0]:02x}{a[1]:02x}{a[2]:02x}  render #{b[0]:02x}{b[1]:02x}{b[2]:02x}  dE {de:5.1f}  dL {lb - la:+5.1f}")


if __name__ == "__main__":
    main()
