# qa-evidence/survival-build24 — karakter baru dari pack GLB user

Jawaban atas koreksi user 2026-10-21: *"pasukan masih sama hanya baju dan topi
saja yg berbeda ini kamu clone glb character yg ada bukan membuat versi yg
baru"*. BUILD 24 membuang pendekatan clone+gear (BUILD 23) dan membangun
pasukan, kapten, serta (terjadwal BUILD 25) musuh dari pack GLB yang
di-commit user sendiri di branch ini (`154d27f`):

- `egyptian_people.glb` — 5 karakter bertekstur tanpa rig (Commander, Slave,
  Warrior, Resident, King) → diberi skeleton buatan + auto-skinning + klip
  prosedural yang dibake menjadi AnimationClip asli (`src/game/render3d/pack3d.js`).
- `polyart_zombies_with_animations_free_pack.glb` — 10 zombie ber-rig + klip
  walk 7,37 s → sumber musuh BUILD 25 (sudah dikontrak di `glbtest`).

## Peran

| Peran | Karakter pack | Catatan |
| --- | --- | --- |
| Kapten | Commander | valen3d; tekstur pack dipertahankan (recolour off, rim/lift V8 on) |
| Pemanah garrison | King | lengan netral; crossbow di `R_Hand` |
| Guard melee | Warrior | khopesh + perisai bawaan sculpt; crossbow di `L_Hand` |
| Pengangkut | Resident | animasi walk prosedural |

## Isi folder

- `sheet-front.png`, `sheet-three.png`, `sheet-back.png` — lineup kapten +
  pemanah + melee + pengangkut (probe `tools/.probe-pack24.mjs`).
- `solo-captain.png` (Commander mid-cheer), `solo-guard.png` (King mid-shot
  dengan crossbow), `solo-melee.png` (Warrior), `solo-bearer.png` (Resident
  mid-walk), `bind-front.png` / `bind-side.png` — bind sheet lima role yang
  dipakai mengukur posisi tangan per sculpt.
- `b24-1-pack-garrison.png` — frame plotsqa §15: guard pack hidup di gerbang
  survival dengan crossbow terpasang.
- `logs/` — log tiap gate rantai QA BUILD 24 + `plotsqa.json`.
- `fx/`, `look/` — output fxshots dan look pass.

## Hasil gate

Rantai penuh `tools/chain.sh` dijalankan pada state commit `ef707ba`
(restrukturisasi Fase 2) + `b481537` (perbaikan tools di bawah). Hasil
final setiap gate — semua EXIT=0:

| Gate | Hasil (dari log) | EXIT |
| --- | --- | --- |
| harness | 96 PASS / 0 FAIL | 0 |
| plotsqa | SUMMARY 37/37 PASS, errors 0 | 0 |
| devqa | SUMMARY 25/25 PASS | 0 |
| envqa | ENVQA PASS: all assertions passed, 0 page error | 0 |
| intro | SUMMARY PASS (0 failed) | 0 |
| fxshots | SUMMARY 16/16 PASS | 0 |
| swtest | service worker: all PASS | 0 |
| layoutqa | semua seksi PASS + BROWSER ERRORS: PASS | 0 |
| look | errors 0 | 0 |
| shots | pageErrors=0 (landscape) | 0 |
| glbtest | all PASS, 0 FAIL | 0 |
| map | SUMMARY 230/230 layout checks pass | 0 |
| bundlecheck | bundle check: all PASS | 0 |

### Koreksi riwayat (menggantikan klaim commit `3443228`)

Commit `3443228` mengklaim "semua gate EXIT=0" padahal rantai **masih
berjalan** saat itu — klaim tersebut prematur dan tidak akurat. Fakta
yang sebenarnya dari run rantai penuh pertama:

- `shots` dan `map` gagal MODULE_NOT_FOUND: `chain.sh` memanggil
  `tools/shots.mjs` / `tools/map.mjs` yang tidak pernah ada (nama asli
  gate: `survivalshots.mjs` / `survival-map.mjs`).
- `plotsqa` FAIL 2/37: check V8 masih mengontrak kapten pra-BUILD 24
  (recolour on, `look===1`, >=3x tekstur Tripo telanjang) padahal BUILD
  24 sengaja mempertahankan tekstur pack Commander (`uCapLook=0`, hanya
  rim+lift); check B24 menuntut nama `person-rig-Warrior` di model guard
  hidup padahal `troop3d.make()` menamai ulang root clone jadi
  `troop-3d-<kind>`.
- 10 gate lain EXIT=0 pada run pertama itu.

Ketiganya diperbaiki di `b481537` (tools-only: nama file di `chain.sh`
+ dua kontrak check disesuaikan dengan desain BUILD 24 yang benar-benar
dikirim — bukan mengubah game agar cocok dengan check lama), lalu
`map`, `shots`, dan `plotsqa` di-rerun sampai hijau; log rerun ada di
folder ini (`logs/map.log`, `logs/shots.log`, `logs/plotsqa.log`,
`plotsqa.json`, `map/plan.png`, `shots/*.png`). Tidak ada file src game
yang berubah antara run pertama dan rerun.

Lihat juga tabel di `docs/REBUILD-ROADMAP.md` bagian "Pass BUILD 24".
