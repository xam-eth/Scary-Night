#!/bin/bash
# BUILD 24 QA chain — one log per gate
cd "$(dirname "$0")/.." || exit 1
OUT=qa-evidence/survival-build24/logs
mkdir -p "$OUT"
run() { echo "=== $1"; node "tools/$2" $3 > "$OUT/$1.log" 2>&1; echo "$1 EXIT=$?"; }
run harness harness.mjs
run plotsqa survival-plotsqa.mjs "--out=qa-evidence/survival-build24"
run devqa survival-devqa.mjs
run envqa envqa.mjs
run intro survival-intro.mjs
run fxshots survival-fxshots.mjs "--out=qa-evidence/survival-build24/fx"
run swtest swtest.mjs
run layoutqa layoutqa.mjs
run look survival-look.mjs "--out=qa-evidence/survival-build24/look"
run shots survivalshots.mjs "--landscape --out=qa-evidence/survival-build24/shots"
run glbtest glbtest.mjs
run map survival-map.mjs "--out=qa-evidence/survival-build24/map/plan.png"
run bundlecheck bundlecheck.mjs
echo CHAIN-DONE
