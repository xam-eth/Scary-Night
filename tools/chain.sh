#!/bin/bash
# QA chain — one log per gate. Arg 1: nama direktori evidence di qa-evidence/
# (default survival-build25). Dipakai juga untuk rantai pecahan Fase 3.
cd "$(dirname "$0")/.." || exit 1
EVID="${1:-survival-build25}"
OUT="qa-evidence/$EVID/logs"
mkdir -p "$OUT"
run() { echo "=== $1"; node "tools/$2" $3 > "$OUT/$1.log" 2>&1; echo "$1 EXIT=$?"; }
run harness harness.mjs
run plotsqa survival-plotsqa.mjs "--out=qa-evidence/$EVID"
run devqa survival-devqa.mjs
run envqa envqa.mjs
run intro survival-intro.mjs
run fxshots survival-fxshots.mjs "--out=qa-evidence/$EVID/fx"
run swtest swtest.mjs
run layoutqa layoutqa.mjs
run look survival-look.mjs "--out=qa-evidence/$EVID/look"
run shots survivalshots.mjs "--landscape --out=qa-evidence/$EVID/shots"
run glbtest glbtest.mjs
run map survival-map.mjs "--out=qa-evidence/$EVID/map/plan.png"
run bundlecheck bundlecheck.mjs
echo CHAIN-DONE
