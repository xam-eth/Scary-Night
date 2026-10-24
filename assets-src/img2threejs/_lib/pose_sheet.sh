#!/bin/bash
# Interaction-pass evidence: rest vs posed renders (fixed and front views) as renders/<pass>/pose-check.jpg.
# Needs the pass rendered with --pose=<json> (tools/img2threejs-render.mjs).
#   assets-src/img2threejs/_lib/pose_sheet.sh <asset-dir> <pass-id> "<caption>"
set -e
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
R="$(cd "$1" && pwd)/renders/$2"
CAP=${3:-posed}
node -e "
const { loadImage, createCanvas } = require('$ROOT/tools/node_modules/@napi-rs/canvas');
const fs = require('fs');
(async () => {
  const items = [['fixed.png', 'rest (fixed)'], ['posed-fixed.png', process.argv[1] + ' (fixed)'], ['front.png', 'rest (front)'], ['posed-front.png', process.argv[1] + ' (front)']];
  const W = 560, H = 306;
  const c = createCanvas(W * 2, H * 2); const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W * 2, H * 2);
  for (let i = 0; i < items.length; i++) {
    const im = await loadImage(fs.readFileSync('$R/' + items[i][0]));
    const s = Math.min(W / im.width, H / im.height), w = im.width * s, h = im.height * s;
    g.drawImage(im, (i % 2) * W + (W - w) / 2, Math.floor(i / 2) * H + (H - h) / 2, w, h);
    g.fillStyle = '#000'; g.font = '16px sans-serif'; g.fillText(items[i][1], (i % 2) * W + 8, Math.floor(i / 2) * H + 20);
  }
  fs.writeFileSync('$R/pose-check.jpg', c.toBuffer('image/jpeg', 82));
})();
" "$CAP"
echo "$R/pose-check.jpg"
