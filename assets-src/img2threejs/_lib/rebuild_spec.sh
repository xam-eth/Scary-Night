#!/bin/bash
# Rebuild an asset's object-sculpt-spec.json from its author.py (the spec's source), re-run the
# material wiring when material-analysis.json exists, lock the materials, and strict-validate.
# Keeps reviewHistory / visualEvidence / sculptPipeline / tier1Results already recorded.
#   assets-src/img2threejs/_lib/rebuild_spec.sh <asset-dir>
set -e
S=$(cd "$(dirname "$0")/../../../.agents/skills/img2threejs" && pwd)
cd "$1"
export PYTHONDONTWRITEBYTECODE=1
python3 - <<'PY'
import json, pathlib
p = pathlib.Path('object-sculpt-spec.json')
keep = {}
if p.exists():
    s = json.loads(p.read_text())
    for k in ('reviewHistory', 'visualEvidence', 'sculptPipeline', 'tier1Results', 'tier1Result', 'passGateResults'):
        if k in s: keep[k] = s[k]
pathlib.Path('.img2threejs').mkdir(exist_ok=True)
pathlib.Path('.img2threejs/keep.json').write_text(json.dumps(keep))
PY
python3 author.py assess >/dev/null
python3 "$S/forge/stage2_spec/new_sculpt_spec.py" "$(python3 -c 'import author; print(author.NAME)')" --image reference.png --assessment assessment.json --domain generic --out object-sculpt-spec.json --force >/dev/null
python3 author.py spec
if [ -f material-analysis.json ]; then
  python3 "$S/forge/stage2_spec/apply_material_analysis.py" object-sculpt-spec.json material-analysis.json --in-place >/dev/null
fi
python3 author.py lock
python3 - <<'PY'
import json, pathlib
p = pathlib.Path('object-sculpt-spec.json'); s = json.loads(p.read_text())
keep = json.loads(pathlib.Path('.img2threejs/keep.json').read_text())
s.update(keep)
p.write_text(json.dumps(s, indent=2, ensure_ascii=False) + '\n')
PY
python3 "$S/forge/stage2_spec/validate_sculpt_spec.py" object-sculpt-spec.json --strict-quality
