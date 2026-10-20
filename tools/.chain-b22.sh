#!/bin/bash
cd /home/user/Scary-Night || exit 1
run() { name="$1"; shift; echo "=== $name ==="; "$@" > "/tmp/b22-$name.txt" 2>&1; echo "$name EXIT=$?"; }
run harness node tools/harness.mjs
run plotsqa node tools/survival-plotsqa.mjs --out=/tmp/plotsqa-b22
run devqa node tools/survival-devqa.mjs
run envqa node tools/envqa.mjs --mode=3d-smoke
run intro node tools/survival-intro.mjs
run fxshots node tools/survival-fxshots.mjs
run swtest node tools/swtest.mjs
run layoutqa node tools/layoutqa.mjs
run look node tools/survival-look.mjs
run shots node tools/survivalshots.mjs --landscape
run glbtest node tools/glbtest.mjs
run map node tools/survival-map.mjs
run bundlecheck node tools/bundlecheck.mjs
echo CHAIN_DONE
