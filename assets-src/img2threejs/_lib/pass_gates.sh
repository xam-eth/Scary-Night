#!/bin/bash
# Run the img2threejs per-pass deterministic gates on the review renders of one build pass and
# mark the matching checklist steps. Usage (from the repo root or anywhere):
#   assets-src/img2threejs/_lib/pass_gates.sh <asset-dir> <pass-id>
# Needs renders/<pass>/ from tools/img2threejs-render.mjs. Writes the gate outputs next to the
# renders and prints a one-line summary per gate. The AI-vision review (append_review.py) and the
# pipeline sync stay separate: they need the comparison sheet to be looked at first.
set -u
ASSET=$(cd "$1" && pwd)
PASS=$2
SKILL=$(cd "$(dirname "$0")/../../../.agents/skills/img2threejs" && pwd)
R="renders/$PASS"
export PYTHONDONTWRITEBYTECODE=1
cd "$ASSET"
STATE=.img2threejs/state.json
mark() { python3 "$SKILL/forge/state.py" mark "$@" --state "$STATE" >/dev/null || echo "  (state mark failed: $1)"; }

extra=()
[ "$PASS" = "blockout" ] && extra=(--map-stripped-render "$R/fixed-clay.png")
python3 "$SKILL/forge/stage4_review/diagnose_render.py" --reference reference.png --render "$R/fixed.png" \
  --spec object-sculpt-spec.json --pass-id "$PASS" --in-place "${extra[@]}" --json > "$R/tier1.json" 2>/dev/null
t1=$?
python3 - "$R/tier1.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); c = d["checks"]
print(f"tier1: passed={d['passed']} IoU={c['silhouetteIoU']} aspect={c['aspectRatioDelta']} scale={c['scaleDelta']} "
      f"colourMaxDeltaE={c.get('colorDelta', {}).get('maxDeltaE')} failures={d['failures']}")
PY
[ $t1 -eq 0 ] && mark tier1-diagnostics --evidence "$R/tier1.json" --evidence "$R/fixed.png"

python3 "$SKILL/forge/stage4_review/diagnose_render_multi_angle.py" --reference "$R/fixed.png" --orbit "$R/right.png" \
  --orbit "$R/rear.png" --orbit "$R/top.png" --json > "$R/multi-angle.json" 2>/dev/null
ma=$?
python3 -c "import json;d=json.load(open('$R/multi-angle.json'));print('multi-angle:', {k:d[k] for k in d if k in ('passed','verdict','degenerate','failures','degenerateViews')})"
python3 "$SKILL/forge/stage4_review/turntable_gate.py" --capture "0=$R/front.png" --capture "90=$R/right.png" \
  --capture "180=$R/rear.png" --capture "270=$R/left.png" --json > "$R/turntable.json" 2>/dev/null
tt=$?
python3 -c "import json;d=json.load(open('$R/turntable.json'));print('turntable:', {k:d[k] for k in d if k in ('passed','verdict','failures','missingAzimuths')})"
python3 "$SKILL/forge/stage4_review/self_intersection.py" "$R/meshes.json" --json > "$R/self-intersection.json" 2>/dev/null
si=$?
python3 -c "
import json;d=json.load(open('$R/self-intersection.json'))
bad=[m['name'] for m in d.get('meshes',[]) if m.get('error') or m.get('selfIntersecting') or m.get('verdict')=='fail']
print('self-intersection:', {k:d[k] for k in d if k in ('passed','verdict','sampledVertexCount','failures')}, 'flagged', bad[:8])"
python3 "$SKILL/forge/stage4_review/attachment_anchor.py" object-sculpt-spec.json --measured "$R/nodes.json" --json > "$R/attachment.json" 2>/dev/null
aa=$?
python3 -c "import json;d=json.load(open('$R/attachment.json'));print('attachment:', {k:d[k] for k in d if k in ('passed','verdict','attachmentCount','violations','unmeasuredAttachments')})"
if [ $ma -eq 0 ]; then mark multi-angle-review --evidence "$R/multi-angle.json" --evidence "$R/turntable.json" --evidence "$R/self-intersection.json" --evidence "$R/attachment.json"; fi
python3 "$SKILL/forge/stage4_review/make_comparison_sheet.py" --reference reference.png --render "$R/fixed.png" --out "$R/cmp.png" --json >/dev/null 2>&1
# a compact copy of the sheet for the repository (the PNG is ~1.3 MB per pass); reviews cite cmp.jpg
node -e "
const { loadImage, createCanvas } = require('$(cd "$SKILL/../../../tools" && pwd)/node_modules/@napi-rs/canvas');
(async () => { const im = await loadImage(require('fs').readFileSync('$R/cmp.png')); const w = Math.min(1200, im.width), h = Math.round(im.height * w / im.width);
  const c = createCanvas(w, h); c.getContext('2d').drawImage(im, 0, 0, w, h); require('fs').writeFileSync('$R/cmp.jpg', c.toBuffer('image/jpeg', 82)); })();
"
# a turntable contact sheet for the reviewer (front, right, rear, left, top)
node -e "
const { loadImage, createCanvas } = require('$(cd "$SKILL/../../../tools" && pwd)/node_modules/@napi-rs/canvas');
(async () => { const names = ['front','right','rear','left','top']; const ims = await Promise.all(names.map((n) => loadImage(require('fs').readFileSync('$R/' + n + '.png'))));
  const c = createCanvas(5 * 300, 300); const g = c.getContext('2d'); ims.forEach((im, i) => g.drawImage(im, i * 300, 0, 300, 300));
  g.fillStyle = '#000'; g.font = '16px sans-serif'; names.forEach((n, i) => g.fillText(n, i * 300 + 8, 20));
  require('fs').writeFileSync('$R/turntable.jpg', c.toBuffer('image/jpeg', 82)); })();
"
python3 "$SKILL/forge/stage3_build/orchestrate_passes.py" check object-sculpt-spec.json --pass-id "$PASS" > "$R/pass-check.txt" 2>&1
pc=$?
echo "pass-gate-check exit=$pc: $(tail -3 "$R/pass-check.txt" | tr '\n' ' ' | cut -c1-400)"
[ $pc -eq 0 ] && mark pass-gate-check --evidence "$R/pass-check.txt"
echo "exit codes: tier1=$t1 multi=$ma turntable=$tt self=$si attach=$aa check=$pc"
python3 "$SKILL/forge/next.py" --state "$STATE" object-sculpt-spec.json 2>&1 | head -2
