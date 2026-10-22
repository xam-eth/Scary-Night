# QA Evidence — Fase 3 pecahan 3: `ui/survival.js` → 8 modul per-concern

**Branch:** `arena/d4f2fdce-scary-night` · **Commit split:** `475e10b` · **Tanggal:** 2026-10-22
**Target:** `src/ui/survival.js` (2.389 LOC) → shell + komposer 59 baris di atas
`src/ui/survival/{shared,hints,chain,night,day,controls,end,cine}.js`.
Permukaan publik 8 nama (`offerSurvivalHint, updateSurvivalHints, nightPointerBand,
tonightChipBox, zoomButtonLayout, drawSurvivalControls, drawSurvivalScreen, COLORS`)
tidak berubah; `game.js`, `main.js`, `tools/survival-balance.mjs` tidak disentuh.

## Hasil rantai penuh (`bash tools/chain.sh phase3-survival-ui`)

| # | Gate | Hasil | Log |
| --- | --- | --- | --- |
| 1 | harness | EXIT=0 — **102 PASS / 0 FAIL** (termasuk check baru "F3 seam survival-ui": shell ≤ 90 baris, 8/8 modul, permukaan 8/8, leak lintas-modul 0) | `logs/harness.log` |
| 2 | plotsqa | run-1 rantai: EXIT=1 (36/37, satu FAIL timing — lihat di bawah). **Rerun standalone: EXIT=0, 37/37 PASS** | `logs/plotsqa.log` (rerun), `logs/plotsqa-run1.log` (run rantai) |
| 3 | devqa | EXIT=0 — 25/25 PASS | `logs/devqa.log` |
| 4 | envqa | EXIT=0 — "ENVQA PASS: all assertions passed", **0 PAGEERROR** (backstop regresi ReferenceError kelas brandWordmark) | `logs/envqa.log` |
| 5 | intro | EXIT=0 — SUMMARY PASS (0 failed) | `logs/intro.log` |
| 6 | fxshots | EXIT=0 — 16/16 PASS | `logs/fxshots.log` |
| 7 | swtest | EXIT=0 — 0 FAIL | `logs/swtest.log` |
| 8 | layoutqa | EXIT=0 — BROWSER ERRORS: PASS | `logs/layoutqa.log` |
| 9 | look | EXIT=0 — errors 0 | `logs/look.log` |
| 10 | shots | EXIT=0 — pageErrors=0 | `logs/shots.log` |
| 11 | glbtest | EXIT=0 — "GLB registry + environment kit + garrison troops + bailey buildings: all PASS" | `logs/glbtest.log` |
| 12 | map | EXIT=0 — SUMMARY 230/230 layout checks pass (+ `map/plan.png`) | `logs/map.log` |
| 13 | bundlecheck | EXIT=0 — 0 FAIL (catatan tetap: token origin Digital Goods diisi pemilik saat rilis) | `logs/bundlecheck.log` |

**CHAIN-DONE EXIT=0.** Tidak ada proses yatim sesudahnya.

## Riwayat jujur run

1. **Run rantai (satu-satunya run rantai):** 12/13 gate EXIT=0. `plotsqa` EXIT=1
   karena satu check: "camera: two fingers anywhere pinch … captain stays put"
   (`split: z0=1,z1=1,moved=16.3` / `left: z0=1,z1=1,moved=15.6`, stick=false).
   Semua check kamera lain (wheel zoom, pinch kanan-half, zoom-about-cursor,
   tombol +/−, flick glide, bailey fit) PASS di run yang sama.
2. **Diagnosis (tanpa ubah kode):** logika pinch ada di `src/core/input.js`
   (tidak tersentuh split) dengan `PINCH_GRACE_MS = 320` **waktu riil**
   (`performance.now`). Check men-step 1 frame di antara dua `touchstart`; di
   bawah beban rantai, frame berat bisa melewati jendela 320 ms sehingga jari
   kedua tidak diakui sebagai pinch → jari pertama jadi pan/tap (kapten geser
   ~16 px, zoom tak berubah). Cocok persis dengan angka FAIL.
3. **Rerun standalone (tanpa beban rantai):** EXIT=0, **37/37 PASS**; check yang
   sama PASS dengan nilai ideal: `split z 1→0.42 (zoom out)`, `left z 1→1.6
   (zoom in)`, `moved 0`, `stick false`. Log run-1 rantai disimpan utuh sebagai
   `logs/plotsqa-run1.log`; `logs/plotsqa.log` = rerun yang PASS.

Kesimpulan: flake timing lingkungan, bukan regresi pecahan 3. Tidak ada kode
src/tools yang berubah antara run rantai dan rerun.

## Verifikasi tambahan pra-rantai

- `node --check` semua modul + shell: OK.
- Import headless shell: ekspor persis 8 nama asli.
- Scan statis lintas-modul (didefinisikan di modul lain ∧ dipakai ∧ tidak
  diimpor): **0** — pola yang sama dengan yang menangkap regresi `brandWordmark`
  di pecahan 2; kini juga menjadi bagian check harness "F3 seam survival-ui".
- `tools/survival-balance.mjs` (importir headless `drawSurvivalScreen`):
  EXIT=0, builder 3/3 WIN stars 3.
- structaudit: delta 0 — 4 pelanggaran lapis lama tetap (menunggu F3c),
  `ui/survival.js` keluar dari daftar file terbesar (`docs/audit/struct-audit.json`
  ter-regenerasi).
- Splitter sekali-pakai (`tools/split-survival-ui.mjs`) dan skrip analisis
  (`tools/analysis-survival-ui.mjs`) dihapus setelah dipakai — tidak ada alat
  scratch yang tersisa di tree.
