#!/bin/bash
# Rebuild object-sculpt-spec.json from author.py (the spec's source) and re-run the material wiring.
# Keeps reviewHistory/visualEvidence/tier1 results already recorded in the spec.
set -e
cd "$(dirname "$0")"
export PYTHONDONTWRITEBYTECODE=1
S=../../../.agents/skills/img2threejs
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
python3 $S/forge/stage2_spec/new_sculpt_spec.py "$(python3 -c 'import author; print(author.NAME)')" --image reference.png --assessment assessment.json --domain generic --out object-sculpt-spec.json --force >/dev/null
python3 author.py spec
python3 $S/forge/stage2_spec/apply_material_analysis.py object-sculpt-spec.json material-analysis.json --in-place >/dev/null
python3 author.py lock
python3 - <<'PY'
import json, pathlib
p = pathlib.Path('object-sculpt-spec.json'); s = json.loads(p.read_text())
keep = json.loads(pathlib.Path('.img2threejs/keep.json').read_text())
s.update(keep)
p.write_text(json.dumps(s, indent=2, ensure_ascii=False) + '\n')
PY
python3 $S/forge/stage2_spec/validate_sculpt_spec.py object-sculpt-spec.json --strict-quality
