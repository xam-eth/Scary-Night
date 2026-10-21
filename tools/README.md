# Katalog tools

Satu pintu QA: `bash tools/chain.sh` (Fase 2 direname `tools/chain.sh`)
— menjalankan gate berurutan, log per gate ke
`qa-evidence/survival-buildNN/logs/`.

## Gate QA (dipakai chain — jangan dihapus)

| Tool | Mengukur |
| --- | --- |
| harness.mjs | simulasi headless 3 malam + 100 check kontrak (balance, save, gelombang, B13–B25, F2-seam `sim/waves.js`) |
| survival-plotsqa.mjs | 37 check in-browser (kamera, HUD, chain B22, garrison B24) + shot evidence |
| survival-devqa.mjs | gate dev-server & boot |
| envqa.mjs | lingkungan/preview (host, cache, orientation) |
| survival-intro.mjs | trailer pembuka tetap utuh & skippable |
| survival-fxshots.mjs | shot efek/V8/V9 + assert fx (barracks, dawn, day, win-sim) |
| swtest.mjs | service worker: VERSION, precache, no-store dev |
| layoutqa.mjs | tata letak landscape phone (hit-area, thumb corner) |
| survival-look.mjs | 12 shot look-pass (siang/malam, zoom) |
| shots.mjs | page-error sweep lintas screen |
| glbtest.mjs | integritas GLB/aset (byte, lisensi, klip, tulang, pack user) |
| probe-horde-view.mjs | render terkontrol rig horde pack (tampak depan + profil, pose walk) untuk verifikasi pose/arah sesudah perubahan rig; argumen 1 = direktori output |
| map.mjs | peta bailey 230 check |
| bundlecheck.mjs | budget bundle & daftar aset rilis |
| structaudit.mjs | audit struktur: graph import, orphan, pelanggaran lapis, matriks tools, referensi aset (pass perapian 2026-10-21) |
| playpack.sh | kemasan listing Play (kunci, fingerprint, screenshot) |

## Pendukung (dipakai manual, terbukti di docs/chain)

devserver (python http.server via gate), evidence-images.mjs, nav.mjs,
geo.mjs, audit-play* (riset), survival-balance.mjs, survival-bots.mjs.

## archive/

Tools satu-pakai yang outputnya sudah menjadi evidence committed
(refs = 0 di structaudit 2026-10-21): asset-sheet, audit-play×3, brandassets,
clicktest, export-house, frameqa, frameview, makeicons, qa-char, qa-final,
qa-pitch, shot-char, shotbrowser, probe-pack24. Disimpan agar evidence lama
tetap reproducibel; boleh dihapus kapan pun setelah evidence-nya dianggap
final oleh owner.
