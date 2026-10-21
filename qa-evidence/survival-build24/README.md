# qa-evidence/survival-build24 — karakter baru dari pack GLB user

Jawaban atas koreksi user 2026-10-21: *"pasukan masih sama hanya baju dan topi
saja yg berbeda ini kamu clone glb character yg ada bukan membuat versi yg
baru"*. BUILD 24 membuang pendekatan clone+gear (BUILD 23) dan membangun
pasukan, kapten, serta (terjadwal BUILD 25) musuh dari pack GLB yang
di-commit user sendiri di branch ini (`154d27f`):

- `egyptian_people.glb` — 5 karakter bertekstur tanpa rig (Commander, Slave,
  Warrior, Resident, King) → diberi skeleton buatan + auto-skinning + klip
  prosedural yang dibake menjadi AnimationClip asli (`src/game/pack3d.js`).
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

Diisi setelah rantai selesai; lihat `logs/*.log` dan tabel di
`docs/REBUILD-ROADMAP.md` bagian "Pass BUILD 24".
