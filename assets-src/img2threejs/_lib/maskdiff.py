#!/usr/bin/env python3
"""Overlay the Tier-1 foreground masks (img2threejs diagnose_render.load_mask, 224x224 grid) of a
reference and a render: grey = both, red = reference only, green = render only. Prints IoU, the
two mask boxes, and where the misses sit (by thirds), so a silhouette correction can be aimed.

    python3 maskdiff.py reference.png renders/<pass>/fixed.png out.png
"""
from __future__ import annotations

import sys
import zlib
import struct
from pathlib import Path

SKILL = Path(__file__).resolve().parents[3] / ".agents" / "skills" / "img2threejs"
for sub in ("forge/stage4_review", "forge/_shared", "forge/stage1_intake"):
    sys.path.insert(0, str(SKILL / sub))
import diagnose_render as d  # noqa: E402


def write_png(path: Path, w: int, h: int, rows: list[bytes]) -> None:
    raw = b"".join(b"\x00" + r for r in rows)
    def chunk(t: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + t + data + struct.pack(">I", zlib.crc32(t + data) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> None:
    ref, ren, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    n = d.MASK_GRID_SIZE
    a, _ = d.load_mask(ref)
    b, _ = d.load_mask(ren)
    scale = 3
    rows = []
    miss = {"refOnly": [[0] * 3 for _ in range(3)], "renderOnly": [[0] * 3 for _ in range(3)]}
    for y in range(n):
        row = bytearray()
        for x in range(n):
            i = y * n + x
            if a[i] and b[i]:
                c = (150, 150, 150)
            elif a[i]:
                c = (220, 40, 40)
                miss["refOnly"][y * 3 // n][x * 3 // n] += 1
            elif b[i]:
                c = (40, 190, 60)
                miss["renderOnly"][y * 3 // n][x * 3 // n] += 1
            else:
                c = (245, 245, 245)
            row += bytes(c) * scale
        for _ in range(scale):
            rows.append(bytes(row))
    write_png(out, n * scale, n * scale, rows)
    print({"iou": round(d.silhouette_iou(a, b), 4), "refBbox": d.bbox_of(a), "renderBbox": d.bbox_of(b),
           "refOnlyByThird": miss["refOnly"], "renderOnlyByThird": miss["renderOnly"]})


if __name__ == "__main__":
    main()
