# Evidence Fase 3 pecahan 1 — F2 seam (a): `sim/survival.js` → `sim/waves.js`

Tanggal: 2026-10-21. Commit implementasi: `2ee111e`. Rantai: `bash tools/chain.sh
phase3-f2a-waves` (chain.sh kini menerima argumen nama direktori evidence).

**Apa yang dipecah:** jadwal malam Survival pindah utuh ke modul murni baru
`src/game/sim/waves.js` (145 LOC) — tabel `WAVE_TIMES`/`WAVE_TIMES_LATER`/
`BREAKER_TIMES`/`INDIVIDUAL_TIMES`/`WAVE_COUNTS`/`SWARM_CAP`, rotasi gerbang
authored `NIGHT_ROTATIONS` (R8), `mixSeed`, plus helper murni `waveCountsFor`/
`waveTimesFor`/`breakersFor`/`nightDoorsFor`. `sim/survival.js` 4.926 → 4.828
LOC; `waveCounts()`/`waveTimes()`/`nightDoors()` jadi delegasi tipis,
`tonightCall`/`tonightPlan` pakai `breakersFor`. Perilaku tidak berubah:
seed run yang sama tetap memberi putaran gerbang yang sama; spawn/event/horn
tetap di kelas. Tidak ada file dihapus/dipindah lain; tools `harness.mjs` dan
`survival-balance.mjs` membaca jadwal dari modul baru.

**Check lahir-modul (aturan gerbang Fase 3):** check harness baru
`F2 seam (a)` — delegasi kelas = helper murni (counts/times/doors N2–N3),
`nightDoorsFor` deterministik per seed, dan invariant authored setiap rotasi
(tidak ada gerbang dua kali semalam, gelombang 3 selalu di gerbang utama
`southGate`, postern Night 3 tidak pernah jadi sasaran gelombang 2).
Harness: **100 PASS / 0 FAIL** (sebelumnya 99; `b17Pass` count 3 → 4).

**structaudit delta 0:** tetap 4 pelanggaran lama (3 hak composition root
`game.js→ui/*` + 1 `shop/iap→sim/economy` yang menunggu F3c); tidak ada
pelanggaran baru; fan-in `core/util.js` 23 → 24 (waves.js impor `clamp`).

## Hasil gate

| # | Gate | Log | Hasil |
| --- | --- | --- | --- |
| 1 | harness | logs/harness.log | EXIT=0 — 100 PASS / 0 FAIL (termasuk check baru "F2 seam (a)") |
| 2 | plotsqa | logs/plotsqa.log | EXIT=0 — SUMMARY 37/37 PASS, 0 FAIL (V10 plan = jadwal waves.js) |
| 3 | devqa | logs/devqa.log | EXIT=0 — SUMMARY 25/25 PASS |
| 4 | envqa | logs/envqa.log | EXIT=0 — "ENVQA PASS: all assertions passed", 0 page errors |
| 5 | intro | logs/intro.log | EXIT=0 — SUMMARY PASS (0 failed); trailer pembuka utuh |
| 6 | fxshots | logs/fxshots.log | EXIT=0 — SUMMARY 16/16 PASS; health 0 page/console errors |
| 7 | swtest | logs/swtest.log | EXIT=0 — 0 FAIL (VERSION ↔ stamp BUILD 25 sinkron) |
| 8 | layoutqa | logs/layoutqa.log | EXIT=0 — 0 FAIL |
| 9 | look | logs/look.log | EXIT=0 (rerun) — errors 0; horde shambler 4104 / lurcher 3570 / wretch 4420 verts, clips walk/attack/die, fx impact 25 / kill 9 / muzzle 11 |
| 10 | shots | logs/shots.log | EXIT=0 — pageErrors=0, all PASS (--landscape) |
| 11 | glbtest | logs/glbtest.log | EXIT=0 — all PASS / 0 FAIL (136 baris PASS) |
| 12 | map | logs/map.log | EXIT=0 — SUMMARY 230/230 layout checks pass |
| 13 | bundlecheck | logs/bundlecheck.log | EXIT=0 — 0 FAIL |

Frame bukti: PNG plotsqa (b13–b24, cam, cards, plots) di akar direktori ini,
`fx/` (fxshots), `look/` (survival-look), `shots/` (+metrics.json),
`map/plan.png`, `plotsqa.json`.

## Riwayat run (jujur)

- Run 1 (chain penuh, 2026-10-21): 12/13 EXIT=0. **look EXIT=1** — bukan
  regresi kode: "Failed to launch the browser process: Code: null"
  (peluncuran browser gagal karena tekanan resource sandbox saat rantai
  berjalan; kelas flake environmental yang sama seperti fxshots "win" di
  run-1 BUILD 25).
- Rerun gate look saja sesudah rantai: **EXIT=0, errors 0** — log di
  `logs/look.log` adalah hasil rerun hijau itu; semua log gate lain adalah
  hasil run rantai penuh.

**Status:** pecahan 1 Fase 3 selesai dan hijau. Berikutnya: seam (b)
survival.js (plot/bangunan & antrian builder), F3c (inversi shop→sim via
event, perilaku shop tidak disentuh), F6 (package.json root tipis).
