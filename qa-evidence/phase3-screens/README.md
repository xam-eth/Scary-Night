# Evidence Fase 3 pecahan 2 — F2 seam screens: `ui/screens.js` → modul per-screen

Tanggal: 2026-10-21. Commit implementasi: `01c5b0e` (+fix `e70b374`).
Rantai: `bash tools/chain.sh phase3-screens` — **13/13 EXIT=0 dalam satu run
bersih** (run ke-2; run 1 menangkap regresi sendiri, lihat riwayat).

**Apa yang dipecah:** `src/ui/screens.js` (2.997 LOC, 22 fungsi layar + kit)
→ `src/ui/screens/`: `shared.js` (kit immediate-mode: type-fit, tombol,
brand plate, shade plate story, data tab field-card) + `menu` (attract/
title/menu/consent/privacy), `pause`, `options`, `meta` (upgrades/collection/
help), `story` (intro/narration), `end` (dawn/ending/death/victory + debrief
hunt), `shop` (UI saja — logika beli tetap `src/shop/iap.js`, constraint user),
`play` (overlay puncak/tutorial/field-card), `refuge` (papan informan).
`ui/screens.js` = shell re-export 18 baris dengan permukaan 21 nama yang sama
persis → **`game.js` nol perubahan**; edit satu layar tidak menyentuh file
layar lain (tujuan user: dev per module/frame/UI tanpa bentrok).

**Check lahir-modul:** harness "F2 seam screens" (shell ≤ 30 baris, 10 modul
ada, 21 draw function utuh) → harness 101 PASS / 0 FAIL. structaudit delta 0
(4 pelanggaran lama tetap: 3 hak composition root + shop→economy menunggu F3c).

## Hasil gate

| # | Gate | Hasil |
| --- | --- | --- |
| 1 | harness | EXIT=0 — 101 PASS / 0 FAIL (termasuk "F2 seam screens") |
| 2 | plotsqa | EXIT=0 — SUMMARY 37/37 PASS |
| 3 | devqa | EXIT=0 — SUMMARY 25/25 PASS |
| 4 | envqa | EXIT=0 — ENVQA PASS: all assertions passed, 0 page errors |
| 5 | intro | EXIT=0 — SUMMARY PASS (0 failed) |
| 6 | fxshots | EXIT=0 — SUMMARY 16/16 PASS |
| 7 | swtest | EXIT=0 — 0 FAIL |
| 8 | layoutqa | EXIT=0 — 0 FAIL |
| 9 | look | EXIT=0 — errors 0 |
| 10 | shots | EXIT=0 — pageErrors=0 |
| 11 | glbtest | EXIT=0 — all PASS |
| 12 | map | EXIT=0 — SUMMARY 230/230 |
| 13 | bundlecheck | EXIT=0 — 0 FAIL |

## Riwayat run (jujur)

- Run 1: envqa EXIT=1 — **regresi pecahan tertangkap gate**: `drawTitle`
  (menu.js) membaca `brandWordmark`, `let` internal shared.js yang tidak
  diekspor → ReferenceError di browser (`PAGEERROR brandWordmark is not
  defined`), aliran menu envqa macet dan probe ruangan membaca null.
  Diperbaiki di `e70b374` (export live binding + impor di menu.js); scan
  statis lintas-modul sesudahnya bersih (tidak ada internal lain yang bocor).
- Run 2 (evidence ini): 13/13 EXIT=0 tanpa rerun gate apa pun; envqa 0 page
  errors (check yang sama yang menangkap run 1).
