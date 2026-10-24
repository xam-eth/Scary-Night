#!/bin/bash
# Compose the lighting-check sheet of one pass (surface / lighting pass evidence): the fixed view under
# the gate light, under the reference-matched light, under a grazing key, and the grazing close-up of
# the part named with --focus (closeup-grazing.png), labelled, as renders/<pass>/lighting-checks.jpg.
#   assets-src/img2threejs/_lib/lighting_sheet.sh <asset-dir> <pass-id>
set -e
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
R="$(cd "$1" && pwd)/renders/$2"
node -e "
const { loadImage, createCanvas } = require('$ROOT/tools/node_modules/@napi-rs/canvas');
const fs = require('fs');
(async () => {
  const items = [['fixed.png', 'fixed (gate light)'], ['fixed-reference.png', 'reference-matched light'], ['fixed-grazing.png', 'grazing key'], ['closeup-grazing.png', 'close-up, grazing']]
    .filter(([f]) => fs.existsSync('$R/' + f));
  const W = 560, H = 306;
  const c = createCanvas(W * 2, H * 2); const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W * 2, H * 2);
  for (let i = 0; i < items.length; i++) {
    const im = await loadImage(fs.readFileSync('$R/' + items[i][0]));
    const s = Math.min(W / im.width, H / im.height), w = im.width * s, h = im.height * s;
    const x = (i % 2) * W + (W - w) / 2, y = Math.floor(i / 2) * H + (H - h) / 2;
    g.drawImage(im, x, y, w, h);
    g.fillStyle = '#000'; g.font = '16px sans-serif'; g.fillText(items[i][1], (i % 2) * W + 8, Math.floor(i / 2) * H + 20);
  }
  fs.writeFileSync('$R/lighting-checks.jpg', c.toBuffer('image/jpeg', 82));
})();
"
echo "$R/lighting-checks.jpg"
