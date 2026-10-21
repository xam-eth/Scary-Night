# qa-evidence/survival-build25 — musuh dari pack zombie user

Jawaban atas bagian "juga enimies nya" dari commit pack user (`154d27f`):
horde malam Survival kini memakai `polyart_zombies_with_animations_free_pack.glb`
yang user commit sendiri — tiga variant (shambler/lurcher/wretch) dengan
klip attack/die sintetis, atlas painted pack terbawa sampai ke bake VAT,
rim crimson faksi tetap. Roster legacy mansion tidak berubah; alias
zombie→shambler / crawler→lurcher / ghoul→wretch hanya di lapis render
(`SURVIVAL_HORDE_ALIAS`), key/stat/gelombang sim tidak disentuh.

Detail desain & wiring: `docs/REBUILD-ROADMAP.md` bagian "Pass BUILD 25".

## Isi folder

- `logs/` — log tiap gate `tools/chain.sh` (BUILD 25).
- `plotsqa.json` — hasil check plotsqa (termasuk §13 B21/B25: atlas
  horde terbawa di bake, glowMax 0, rim 0.78/0.2/0.16).
- `b21-1-garrison-horde.png` — frame garrison pack + horde zombie pack.
- `b24-1-pack-garrison.png` — frame guard Warrior pack di gerbang.
- frame plotsqa lain (b13–b22, cam, cards, plots) — regenerasi run ini.
- `fx/`, `look/`, `shots/`, `map/` — output gate fxshots, look,
  survivalshots (landscape) dan survival-map.

## Hasil gate

Rantai penuh `tools/chain.sh` pada state commit `376117d` — **13/13 gate
EXIT=0**:

| Gate | Hasil (dari log) | EXIT |
| --- | --- | --- |
| harness | 98 PASS / 0 FAIL (termasuk 2 check B25 baru) | 0 |
| plotsqa | SUMMARY 37/37 PASS, errors 0 (termasuk B21/B25) | 0 |
| devqa | SUMMARY 25/25 PASS | 0 |
| envqa | ENVQA PASS: all assertions passed, 0 page error | 0 |
| intro | SUMMARY PASS (0 failed) | 0 |
| fxshots | SUMMARY 16/16 PASS | 0 |
| swtest | service worker: all PASS | 0 |
| layoutqa | semua seksi PASS + BROWSER ERRORS: PASS | 0 |
| look | errors 0 | 0 |
| shots | pageErrors=0 (landscape) | 0 |
| glbtest | all PASS, 134 check / 0 FAIL | 0 |
| map | SUMMARY 230/230 layout checks pass | 0 |
| bundlecheck | bundle check: all PASS | 0 |

Data bake horde pack dari plotsqa §13 (B21/B25): shambler 4104 verteks,
lurcher 3570, wretch 4420 (beanie ikut ter-bake — bukti pengelompokan per
skeleton benar); ketiganya `mapped: true` (atlas `peopleColors` terbawa),
warna vertex putih (1,1,1), `glowMax: 0` (tanpa bagian mata palsu), rim
faksi crimson 0.78/0.2/0.16; baut ground 80px (dada).

### Riwayat run (jujur)

1. **Run 1** (sebelum commit `bd2fc45` di-push, tree yang sama): 11/13
   hijau; dua merah — (a) `envqa` FAIL pada assertion basi
   `readyTypes === 6` padahal roster kini 9 type (6 mansion + 3 pack) dan
   semua aktor mansion tetap rigged 6/6 → diperbaiki di `376117d`
   (tools-only, `>= 6`); (b) `fxshots` check "win" FAIL dengan stars 0 —
   flake seed/timing yang sudah dikenal (sim BUILD 25 tidak berubah; rerun
   hijau, lihat run 2).
2. **Sandbox rollback** setelah run 1 menghapus log/PNG run 1 (belum
   ter-commit). Tree dipulihkan via `git fetch` + `reset --mixed` ke
   `376117d` + `npm ci`; sisa file era lama yang bangkit (zip pra-Fase 1,
   src/game flat pra-Fase 2, tools arsip) dibersihkan — semuanya sudah
   terdokumentasi di `docs/audit/REMOVALS.md`.
3. **Run 2 (evidence di folder ini)**: rantai penuh diulang pada tree
   hasil pemulihan — 13/13 EXIT=0, termasuk envqa dengan assertion baru
   dan fxshots "win" yang hijau kembali (mengonfirmasi flake).

Lihat juga `docs/REBUILD-ROADMAP.md` bagian "Pass BUILD 25".
