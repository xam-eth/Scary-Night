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

Diisi setelah rantai selesai; lihat `logs/*.log`. Run pra-chain (verifikasi
saat implementasi): harness 99 PASS / 0 FAIL / EXIT=0, glbtest 134 PASS /
0 FAIL, devqa 25/25 PASS dengan 0 page error.
