#!/bin/bash
# Build, render and gate one img2threejs pass of an asset (everything before the AI review):
#   assets-src/img2threejs/_lib/run_pass.sh <asset-dir> <pass-id> [extra img2threejs-render.mjs args]
# generates src/<factory>.ts for the pass, renders the review views, marks build-current-pass,
# render-capture and review-contract-read, then runs pass_gates.sh (tier1, multi-angle, turntable,
# self-intersection, attachment, comparison sheet, pass check). Review with record_review.py.
set -e
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
ASSET=$(cd "$1" && pwd)
PASS=$2
shift 2
S="$ROOT/.agents/skills/img2threejs"
export PYTHONDONTWRITEBYTECODE=1
cd "$ASSET"
TS=$(ls src/*.ts | head -1)
python3 "$S/forge/stage3_build/generate_threejs_factory.py" object-sculpt-spec.json --out "$TS" --pass-id "$PASS" --force >/dev/null
cd "$ROOT"
timeout 300 node tools/img2threejs-render.mjs --asset="$ASSET" --pass="$PASS" "$@" | tail -1 | cut -c1-160
cd "$ASSET"
ST=.img2threejs/state.json
python3 "$S/forge/state.py" mark build-current-pass --state $ST --evidence "$TS" >/dev/null
python3 "$S/forge/state.py" mark render-capture --state $ST --evidence "renders/$PASS/fixed.png" --evidence "renders/$PASS/front.png" \
  --evidence "renders/$PASS/right.png" --evidence "renders/$PASS/rear.png" --evidence "renders/$PASS/left.png" >/dev/null
python3 "$S/forge/state.py" mark review-contract-read --state $ST --evidence "$S/grimoire/review/gates_reference.md" \
  --evidence "$S/grimoire/review/self_correction.md" >/dev/null
"$ROOT/assets-src/img2threejs/_lib/pass_gates.sh" "$ASSET" "$PASS"
