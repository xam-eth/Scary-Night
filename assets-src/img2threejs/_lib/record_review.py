#!/usr/bin/env python3
"""Record one img2threejs pass review from a JSON file and advance the checklist.

    python3 assets-src/img2threejs/_lib/record_review.py <asset-dir> renders/<pass>/review.json

The JSON holds what the AI-vision review of renders/<pass>/cmp.jpg (+ turntable.jpg) concluded:
  { "pass": "blockout", "fidelity": 0.55, "aiVisionScore": 0.72, "action": "continue",
    "layerScores": {...}, "featureReviews": [{"id", "score", "notes"}], "summary": "...",
    "matched": [...], "mismatches": [...], "specFixes": [...], "codeFixes": [...],
    "notes": "...", "cameraView": "..." }
It runs append_review.py (the skill's recorder) on object-sculpt-spec.json, marks
ai-review-recorded, syncs sculptPipeline (orchestrate_passes.py sync) and marks pipeline-sync, so
the review file in the repository is the exact input of the recorded review.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

SKILL = Path(__file__).resolve().parents[3] / ".agents" / "skills" / "img2threejs"


def run(args: list[str]) -> str:
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    res = subprocess.run(args, capture_output=True, text=True, env=env)
    if res.returncode != 0:
        sys.stderr.write(res.stdout[-2000:] + res.stderr[-2000:])
        raise SystemExit(f"failed: {' '.join(args[:3])} ... (exit {res.returncode})")
    return res.stdout


def main() -> None:
    asset = Path(sys.argv[1]).resolve()
    review_path = Path(sys.argv[2])
    os.chdir(asset)
    r = json.loads(review_path.read_text())
    p = r["pass"]
    rd = f"renders/{p}"
    fr = Path(rd) / "feature-reviews.json"
    fr.write_text(json.dumps(r["featureReviews"], indent=2) + "\n")
    args = [sys.executable, str(SKILL / "forge/stage4_review/append_review.py"), "object-sculpt-spec.json",
            "--pass-id", p, "--fidelity", str(r["fidelity"]), "--action", r["action"], "--summary", r["summary"],
            "--matched", "; ".join(r.get("matched", [])), "--mismatches", "; ".join(r.get("mismatches", [])),
            "--spec-fixes", "; ".join(r.get("specFixes", [])) or "none",
            "--code-fixes", "; ".join(r.get("codeFixes", [])) or "none",
            "--reference-screenshot", "reference.png", "--render-screenshot", f"{rd}/fixed.png",
            "--comparison-image", f"{rd}/cmp.jpg", "--ai-vision-score", str(r["aiVisionScore"]),
            "--layer-scores-json", json.dumps(r["layerScores"]), "--feature-reviews-json", str(fr),
            "--ai-vision-notes", r.get("notes", ""), "--camera-view", r.get("cameraView", "fixed"),
            "--in-place"]
    if p == "blockout" and Path(f"{rd}/fixed-clay.png").exists():
        args += ["--map-stripped-render", f"{rd}/fixed-clay.png"]
    if r.get("viewpoints"):
        args += ["--review-viewpoints-json", json.dumps(r["viewpoints"])]
    print(run(args).strip().splitlines()[-1] if True else "")
    state = ".img2threejs/state.json"
    run([sys.executable, str(SKILL / "forge/state.py"), "mark", "ai-review-recorded", "--state", state,
         "--evidence", f"{rd}/cmp.jpg", "--evidence", "object-sculpt-spec.json#reviewHistory", "--evidence", str(review_path)])
    run([sys.executable, str(SKILL / "forge/stage3_build/orchestrate_passes.py"), "sync", "object-sculpt-spec.json", "--in-place"])
    run([sys.executable, str(SKILL / "forge/state.py"), "mark", "pipeline-sync", "--state", state,
         "--evidence", "object-sculpt-spec.json#sculptPipeline"])
    print(run([sys.executable, str(SKILL / "forge/next.py"), "--state", state, "object-sculpt-spec.json"]).strip().splitlines()[0])


if __name__ == "__main__":
    main()
