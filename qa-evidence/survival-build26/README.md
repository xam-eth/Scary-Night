# Evidence BUILD 26 — rig zombie pack berdiri tegak & menghadap benar

Tanggal: 2026-10-21. Commit implementasi: `7f56bff` (+`57fe337` katalog tools).
Rantai: `bash tools/chain.sh survival-build26` — **13/13 EXIT=0 dalam satu run
bersih** (run ke-3; run 1 & 2 mati oleh restart sandbox / proses yatim, lihat
"Riwayat run").

**Bug (laporan user):** "zoombie rig jalan nya posisi slah dan 100% salah arah
… terlihat jalan baring". Frame BUILD 25 menunjukkan horde terbaring telentang
+ skala meledak.

**Akar (terukur):** node `rig_CharRoot*` pack membawa konversi sumbu FBX->glTF
(quaternion -90 derajat X) + offset line-up; `zombipack3d._split` me-reparent
mesh + joint root keluar dari bawahnya ke group identitas sehingga konversi
hilang. Walk clip in-place (root-motion 0); arah depan diukur dari geometri
rest (bungkuk + uluran lengan ke +Z) = konvensi yaw enemy3d.

**Fix:** `_split` menyimpan `lostOrientation` dan memakainya di root tiap
varian (rotasi saja). Render-only; sim/save/server tidak berubah.

## Hasil gate

| # | Gate | Hasil |
| --- | --- | --- |
| 1 | harness | EXIT=0 — 100 PASS / 0 FAIL |
| 2 | plotsqa | EXIT=0 — SUMMARY 37/37 PASS |
| 3 | devqa | EXIT=0 — SUMMARY 25/25 PASS |
| 4 | envqa | EXIT=0 — ENVQA PASS: all assertions passed |
| 5 | intro | EXIT=0 — SUMMARY PASS (0 failed) |
| 6 | fxshots | EXIT=0 — SUMMARY 16/16 PASS |
| 7 | swtest | EXIT=0 — 0 FAIL (stamp 26 ↔ duskhold-v26) |
| 8 | layoutqa | EXIT=0 — 0 FAIL |
| 9 | look | EXIT=0 — errors 0 |
| 10 | shots | EXIT=0 — pageErrors=0 |
| 11 | glbtest | EXIT=0 — all PASS (termasuk check baru B26: konversi sumbu tetap, bone box tertinggi Y, bungkuk +Z) |
| 12 | map | EXIT=0 — SUMMARY 230/230 |
| 13 | bundlecheck | EXIT=0 — 0 FAIL |

**Frame kunci:** `b26-1-horde-walk-front.png` & `b26-2-horde-walk-profile.png`
(probe render terkontrol `tools/probe-horde-view.mjs`: tiga varian horde
berjalan — tegak, langkah benar, bungkuk & lengan ke +Z); frame malam di
`look/`, `fx/`, `shots/` menunjukkan horde tidak lagi rebah.

## Riwayat run (jujur)

- Run 1 (turn BUILD 26): mati antar-turn saat plotsqa (restart sandbox).
- Run 2: rantai rerun bersaing dengan proses yatim run 1 yang ternyata masih
  hidup (dua chain menulis log yang sama; devqa kena watchdog "hard time
  limit" karena kontensi CPU). Proses yatim di-kill; run 2 dihentikan demi
  evidence bersih.
- Run 3 (evidence ini): satu chain tunggal, 13/13 EXIT=0 tanpa rerun gate
  apa pun.
