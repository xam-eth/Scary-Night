# Catatan penghapusan & pemindahan (pass perapian 2026-10-21)

Semua keputusan di tabel ini diambil dari data `tools/structaudit.mjs`
(output mentah: `docs/audit/struct-audit.json`) — bukan asumsi. Baris
"refs" = jumlah penyebutan di package.json tools, docs/*.md, chain script,
workflow CI, dan script tools lain.

## Binary besar yang dikeluarkan dari repo (101,7 MB)

Ekstraknya sudah vendored byte-for-byte di `assets/` atau root, jadi zipnya
duplikat murni; SHA dicatat di sini supaya provenance tidak hilang.

| File | Size | SHA-256 (12) | Pengganti yang dipakai kode |
| --- | --- | --- | --- |
| Godot_v4.6.2-stable_linux.x86_64.zip | 71.803.755 B | 30e6b6d141f0 | tidak ada — eksperimen Godot tidak pernah jadi proyek (tiada `project.godot`, tiada referensi di src/docs/CI) |
| web_nothreads_debug.zip | 10.115.810 B | 52b655f2d8ab | tidak ada — template export web Godot, sama: tak terpakai |
| web_nothreads_release.zip | 9.573.396 B | 7d91986ea27d | tidak ada — sama |
| Ultimate Monsters Bundle-glb.zip | 5.305.396 B | 634a64b3642f | `assets/monsters/ultimate/*.glb` (vendored; `glbtest` memverifikasi byte + lisensi) |
| werewolf+3d+model.zip | 4.850.664 B | 801ad29c720a | `werewolf-3d-model.glb` di root (`enemy3d.js` WOLF_BODY) |

## File yang dipindah (isi tetap, path berubah)

| Dari | Ke | Alasan |
| --- | --- | --- |
| `HUNTER_GLB.txt` | `docs/provenance/HUNTER_GLB.txt` | catatan provenance aset, bukan artefak runtime |
| 15 tools satu-pakai (asset-sheet, audit-play×3, brandassets, clicktest, export-house, frameqa, frameview, makeicons, qa-char, qa-final, qa-pitch, shot-char, shotbrowser) | `tools/archive/` | refs = 0 di semua korpus; outputnya sudah jadi evidence committed. Disimpan (bukan dihapus) agar evidence tetap reproducibel |
| `tools/.probe-pack24.mjs` | `tools/archive/probe-pack24.mjs` | probe satu-pakai BUILD 24; sheet-nya sudah di `qa-evidence/survival-build24/` |

## File yang dihapus setelah dipakai sekali

| File | Alasan | Reproducibilitas |
| --- | --- | --- |
| `tools/.refactor-move.mjs` | skrip satu-pakai pemindahan Fase 2 (26 move/45 sentuh); tak sengaja ikut ter-commit di `ef707ba`. Semua pemindahannya sudah selesai, terverifikasi hijau (harness/glbtest/structaudit) dan tercermin di tree | byte aslinya tetap ada di riwayat git (`ef707ba:tools/.refactor-move.mjs`) |
| `tools/.rerun-red.sh` | runner satu-pakai rerun gate merah (map/shots/plotsqa) 2026-10-21; tidak pernah di-track git | perintah rerun tercatat di `qa-evidence/survival-build24/README.md` |

## Yang TIDAK disentuh (masih terpakai, terbukti)

- Seluruh `assets/*` (8 dir, 126 file: 100 % tereferensi kode/sw/index).
- Tools inti QA: harness, survival-plotsqa, survival-devqa, envqa,
  survival-intro, survival-fxshots, swtest, layoutqa, survival-look, shots,
  glbtest, map, bundlecheck, playpack.sh, .chain-b24.sh (dipakai chain/docs).
- GLB root: `egyptian_people.glb`, `polyart_zombies_with_animations_free_pack.glb`
  (pack user, dikontrak pack3d/glbtest), `hunter_run_walk_claw_sword_shot.glb`
  (masih diverifikasi glbtest sebagai provenance), `werewolf-3d-model.glb`,
  `zombie+3d+model.glb` (enemy3d).
- `src/vendor/three/three.core.min.js` (kelihatan "yatim" hanya karena import
  minified memakai tanda kutip ganda; audit sudah diperbaiki dan kini bersih).
