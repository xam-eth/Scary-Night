# QA Evidence — Fase 3 pecahan 4 (F2 seam b): `sim/buildings.js`

**Branch:** `arena/d4f2fdce-scary-night` · **Commit split:** `58e55e9` · **Tanggal:** 2026-10-22
**Target:** seam (b) `src/game/sim/survival.js` — plots/bangunan + antrian builder.
Seluruh tabel beku ekonomi bailey (KEEP, BANNER, SURVIVAL_SLOTS, PLOT layout B,
SLOT_BY_ID/survivalSlot/TYPE_MIGRATE/CIRCLE, SURVIVAL_BUILDINGS/_LEVELS,
DOOR_BONUS_CAP, TOWER, SURVIVAL_HUNTER, SURVIVAL_ARMS) + 16 fungsi matematika
murni pindah ke `src/game/sim/buildings.js` (361 LOC, 32 ekspor) mengikuti
preseden `sim/waves.js`. 17 metode `SurvivalMode` jadi delegasi satu baris;
`sim/survival.js` 4.828 → 4.540 LOC dan **re-export 14 nama publik yang sama** —
tidak ada importir yang pindah (game.js, ui/survival/*, tools/survival-map.mjs,
harness). Setengah antrian yang stateful (builderJob, purse, audio, _persist)
tetap di kelas.

## Hasil rantai penuh (`bash tools/chain.sh phase3-sim-buildings`) — SATU run bersih

| # | Gate | Hasil | Log |
| --- | --- | --- | --- |
| 1 | harness | EXIT=0 — **103 PASS / 0 FAIL** (termasuk check baru "F2 seam (b)": permukaan 14/14, delegasi = sumber murni, invariant tabel) | `logs/harness.log` |
| 2 | plotsqa | EXIT=0 — **37/37 PASS** (run-1 rantai langsung bersih; flake pinch PINCH_GRACE_MS di run fragmen 3 tidak muncul) | `logs/plotsqa.log` |
| 3 | devqa | EXIT=0 — 25/25 PASS | `logs/devqa.log` |
| 4 | envqa | EXIT=0 — "ENVQA PASS: all assertions passed", 0 PAGEERROR | `logs/envqa.log` |
| 5 | intro | EXIT=0 — SUMMARY PASS (0 failed) | `logs/intro.log` |
| 6 | fxshots | EXIT=0 — 16/16 PASS | `logs/fxshots.log` |
| 7 | swtest | EXIT=0 — 0 FAIL | `logs/swtest.log` |
| 8 | layoutqa | EXIT=0 — BROWSER ERRORS: PASS | `logs/layoutqa.log` |
| 9 | look | EXIT=0 — errors 0 | `logs/look.log` |
| 10 | shots | EXIT=0 — pageErrors=0 | `logs/shots.log` |
| 11 | glbtest | EXIT=0 — "GLB registry + environment kit + garrison troops + bailey buildings: all PASS" (0 FAIL) | `logs/glbtest.log` |
| 12 | map | EXIT=0 — SUMMARY 230/230 layout checks pass (+ `map/plan.png`) | `logs/map.log` |
| 13 | bundlecheck | EXIT=0 — 0 FAIL (catatan tetap: token origin Digital Goods diisi pemilik saat rilis) | `logs/bundlecheck.log` |

**CHAIN-DONE EXIT=0.** Tidak ada proses yatim sesudahnya.

## Verifikasi pra-rantai

- `node --check` kedua file: OK; impor headless `buildings.js` + `survival.js`: OK.
- Check harness baru "F2 seam (b)" mengunci kontrak: re-export 14 nama publik;
  20+ pasangan delegasi-kelas vs fungsi-murni dibaca dari sumber yang sama
  (bannerReach/territoryPlots/lockedSlots/slotUnlockLevel/buildingLevel/
  buildingStats/upgradeCost/goldPerNight/doorHpBonus/hunterStats/hunterUpgradeCost/
  armsStats/armsUpgradeCost/keepUpgradeCost/keepRepairCost/affordReason/canAfford);
  invariant tabel: 9/13/15 plot per level keep, banner 900/1100/1400, cap
  doorBonus 0.6, biaya null di level max, affordReason 'none'/'wood'/'gold'/null.
- `tools/survival-map.mjs` standalone (importir PLOT/SURVIVAL_SLOTS/CIRCLE/
  BANNER/KEEP/SURVIVAL_BUILDING_LEVELS/TOWER): 230/230.
- `tools/survival-balance.mjs` headless: EXIT=0, builder 3/3 WIN stars 3.
- structaudit: delta 0 — 4 pelanggaran lapis lama tetap (menunggu F3c),
  `sim/buildings.js` tidak yatim.
- Splitter sekali-pakai (`tools/split-sim-buildings.mjs`) dihapus setelah
  dipakai; tidak ada alat scratch yang tersisa di tree.
