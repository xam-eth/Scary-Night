#!/usr/bin/env python3
"""
Transparent cut-outs of the ASSET_CHARACTER sheets (characters and weapons
generated on a plain white background), for 2D rigs, UI mock-ups and as a
clean input for image-to-3D tools.

The background is found by colour distance from the border's median colour
and flood-filled from the image border, so a white feather or a silver
highlight INSIDE the silhouette is never removed. Edge pixels get a soft
alpha ramp and are un-mixed from the background colour (no white fringe).
Weapons may also have closed background holes (inside a crossbow's string,
the hanging hole of a cleaver): with --holes, enclosed regions that are
almost exactly the background colour and at least --hole-area px are cut too.

The source images are never modified; output goes to --out, trimmed to the
silhouette plus --margin px.

Needs Pillow, NumPy and SciPy (not part of the game):
  python3 -m venv /tmp/venv-img && /tmp/venv-img/bin/pip install pillow numpy scipy
  /tmp/venv-img/bin/python tools/asset-cutout.py ASSET_CHARACTER/characters/*.png --out ASSET_CHARACTER/cutout/characters
  /tmp/venv-img/bin/python tools/asset-cutout.py ASSET_CHARACTER/weapons/*.png --out ASSET_CHARACTER/cutout/weapons --holes
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage


def cutout(path, hi, lo, holes, hole_thr, hole_area, margin, band=3):
    rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    h, w, _ = rgb.shape
    border = np.concatenate([rgb[:3].reshape(-1, 3), rgb[-3:].reshape(-1, 3),
                             rgb[:, :3].reshape(-1, 3), rgb[:, -3:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    d = np.sqrt(((rgb - bg) ** 2).sum(axis=2))

    # background = near-bg pixels connected to the border
    near = d < hi
    labels, n = ndimage.label(near)
    edge_labels = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    edge_labels = edge_labels[edge_labels > 0]
    back = np.isin(labels, edge_labels)

    hole_count = 0
    if holes:
        strict = d < hole_thr
        hl, hn = ndimage.label(strict & ~back)
        if hn:
            sizes = ndimage.sum(np.ones_like(d), hl, index=np.arange(1, hn + 1))
            keep = [i + 1 for i, s in enumerate(sizes) if s >= hole_area]
            if keep:
                hole = np.isin(hl, keep)
                # grow the hole over its own anti-aliased rim (still near-bg)
                hole = ndimage.binary_dilation(hole, iterations=3) & near
                back |= hole
                hole_count = len(keep)

    alpha = np.ones((h, w), np.float32)
    ramp = np.clip((d - lo) / max(1e-3, hi - lo), 0.0, 1.0)
    # The soft ramp is only for the rim: background pixels within `band` px
    # of the silhouette. Everything further out is fully clear, so a faint
    # vignette in the generated background never becomes a see-through haze.
    gap = ndimage.distance_transform_edt(back)
    rim = back & (gap <= band)
    alpha[back] = 0.0
    alpha[rim] = ramp[rim]

    # un-mix the background from the soft rim: C = (I - (1 - a) * B) / a
    a3 = alpha[..., None]
    soft = (alpha > 0.0) & (alpha < 1.0)
    out_rgb = rgb.copy()
    safe = np.maximum(a3, 1e-3)
    unmixed = np.clip((rgb - (1.0 - a3) * bg) / safe, 0, 255)
    out_rgb[soft] = unmixed[soft]

    rgba = np.dstack([out_rgb, alpha * 255.0]).round().astype(np.uint8)
    ys, xs = np.nonzero(alpha > 0.5)
    if len(xs) == 0:
        raise RuntimeError(f'{path}: nothing left after the cut')
    x0, x1 = max(0, xs.min() - margin), min(w, xs.max() + 1 + margin)
    y0, y1 = max(0, ys.min() - margin), min(h, ys.max() + 1 + margin)
    crop = rgba[y0:y1, x0:x1]
    stats = {
        'source': path, 'size': [w, h], 'background': [int(round(v)) for v in bg],
        'crop': [int(x0), int(y0), int(x1 - x0), int(y1 - y0)],
        'opaque_share': round(float((alpha > 0.5).mean()), 4), 'holes_cut': hole_count,
    }
    return Image.fromarray(crop, 'RGBA'), stats


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('images', nargs='+')
    ap.add_argument('--out', required=True)
    ap.add_argument('--hi', type=float, default=20.0, help='colour distance below which a border-connected pixel is background')
    ap.add_argument('--lo', type=float, default=6.0, help='colour distance at which the edge ramp starts')
    ap.add_argument('--holes', action='store_true', help='also cut enclosed background holes')
    ap.add_argument('--hole-thr', type=float, default=7.0)
    ap.add_argument('--hole-area', type=int, default=180)
    ap.add_argument('--margin', type=int, default=24)
    ap.add_argument('--json', default=None, help='write per-file stats here')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    report = []
    for path in args.images:
        img, stats = cutout(path, args.hi, args.lo, args.holes, args.hole_thr, args.hole_area, args.margin)
        name = os.path.splitext(os.path.basename(path))[0] + '.png'
        dest = os.path.join(args.out, name)
        img.save(dest, optimize=True)
        stats['output'] = dest
        stats['bytes'] = os.path.getsize(dest)
        report.append(stats)
        print(f"{path} -> {dest} {img.size[0]}x{img.size[1]} opaque {stats['opaque_share']:.3f} holes {stats['holes_cut']}")
    if args.json:
        with open(args.json, 'w') as fh:
            json.dump(report, fh, indent=2)
    return 0


if __name__ == '__main__':
    sys.exit(main())
