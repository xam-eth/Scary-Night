# ARSITEKTUR DUSKHOLD / SCARY NIGHT — peta modul & aturan main

**Status:** Fase 1–2 SELESAI (2026-10-21): modul sudah pindah folder, `hud.js` di `src/ui/`, save storage di `core/save.js` dengan migrasi disuntik composition root, chain satu pintu `tools/chain.sh`. Lihat
`docs/RESTRUCTURE-AUDIT.md` untuk data & fase). Angka import/LOC dari
`tools/structaudit.mjs` → `docs/audit/struct-audit.json`.

## 1. Lapis & aturan dependensi

| Lapis | Isi | Boleh impor | Dilarang impor |
| --- | --- | --- | --- |
| `src/core/` | engine-agnostic: config, util, input, audio, render helpers, save | sesama core | game, ui, shop, vendor-three |
| `src/game/render3d/` | semua modul three.js: world3d, buildings3d, enemy3d, troop3d, valen3d, pack3d, zombipack3d, crowd3d, envkit, lightbake | core, vendor | sim, ui, shop |
| `src/game/sim/` | simulasi & aturan: survival, economy, enemies, fortress, objectives, weapons, hunt, house, mansion, exterior, haunts | core | render3d (lewat kontrak data), ui, shop |
| `src/game/meta/` | sutradara sesi: director, coach, narrative, climax, informant | core, sim (read-only) | render3d, ui |
| `src/game/game.js` | **composition root** — merakit semua lapis | semua lapis (hak root) | — |
| `src/ui/` | DOM/HUD/screens: components, icons, screens, storycards, survival, survivalIcons, hud | core, game (kontrak baca) | shop langsung (lewat game) |
| `src/shop/` | monetisasi: iap, ads — **perilaku tidak boleh diubah** (constraint user) | core | sim/render langsung (Fase 3: event) |
| `src/vendor/` | three.js + loader, byte-for-byte | — | — |

Pelanggaran terukur sebelum perapian: 6 (structaudit). Sesudah Fase 2 sisa 0
+ 2 yang didokumentasikan sebagai hak composition root (`game.js→ui/*`).

## 2. Kontrak antar-modul yang sudah terbukti dipakai (fan-in)

- `core/util.js` (24 importir) & `core/config.js` (16) — satu-satunya tempat
  tuning numbers & helper murni; modul baru WAJIB lewat sini, tidak boleh
  menebar konstanta.
- `game/economy.js` (8) — pemilik save `save.survival` + migrasi (migrasi
  pindah ke `core/save.js` di Fase 2, economy tetap pemilik aturan).
- `game/valen3d.js` (8) — pemilik kapten + shader grade (`buildUniformGrade`);
  pack3d memasok rig kapten (BUILD 24).
- `game/enemy3d.js` (6) — pemilik rig horde + `cloneRig`; `game/weapons.js`
  (6) — pemilik bolt/ballista.
- `ui/screens.js` + `ui/screens/*.js` (Fase 3, pecahan F2 kedua) — shell
  re-export tipis (18 baris) di atas sepuluh modul per-screen (`shared` =
  kit immediate-mode: type-fit, tombol, brand plate, plate shade, data tab
  field-card; `menu`, `pause`, `options`, `meta`, `story`, `end`, `shop`,
  `play`, `refuge`). `game.js` tetap `import * as UI` dari shell — permukaan
  21 nama tidak berubah; edit satu layar tidak menyentuh file layar lain.
- `game/sim/waves.js` (Fase 3, pecahan F2 pertama) — pemilik jadwal malam
  Survival: tabel waktu gelombang/Breaker/runner, ukuran swarm, `SWARM_CAP`,
  rotasi gerbang authored (`NIGHT_ROTATIONS`), `mixSeed`, dan helper murni
  `waveCountsFor`/`waveTimesFor`/`breakersFor`/`nightDoorsFor`. Kelas
  `Survival` (`sim/survival.js`) membaca jadwal hanya lewat sini; spawn,
  event, horn, dan state tetap di kelas. Dipin check harness "F2 seam (a)".
- Kontrak lintas-modul yang dijaga QA: nama tulang `R_Hand`/`Head`/`Hip`
  (mount crossbow), cacheKey shader `duskhold-*-look-v2`, clip names
  walk/run/shot/claw/sword, `TROOP_ASSETS.soldier === VALEN_MODEL_URL`.

## 3. Konvensi nama (F8)

- Suffix `3d` = modul render three.js (world3d, troop3d, pack3d…).
- Tanpa suffix = logika/simulasi (survival, economy, enemies…).
- `src/ui/survival.js` vs `src/game/survival.js`: UI-panel vs simulasi —
  prefix lapis sudah membedakannya; jangan digabung.
- File tools: `survival-<gate>.mjs` untuk gate QA survival, `<nama>.mjs`
  untuk gate umum; chain satu pintu `tools/chain.sh` (renama dari
  `chain.sh`, selesai Fase 2).

## 4. Seam pecah file raksasa (F2, dieksekusi Fase 3, satu pecahan = satu chain)

| File | LOC | Seam kandidat |
| --- | --- | --- |
| game/survival.js | 4.828 | (a) **selesai → `sim/waves.js`** (Fase 3, pecahan 1); (b) plot/bangunan & antrian builder; (c) rantai sasaran + reward (B22); (d) fase siang/malam & zoom kamera |
| game/world3d.js | 4.319 | (a) perakitan scene & light; (b) guard survival & mount troop; (c) kamera/drag/pinch; (d) bake/quality |
| game/game.js | 3.034 | composition root tetap tipis: loop, mode, wiring; aturan mansion pindah ke sim/ |
| ui/screens.js | 18 (shell) | **selesai → `ui/screens/*.js`** (Fase 3, pecahan 2): 10 modul per-screen + shared kit; shell = re-export saja |
| ui/survival.js | 2.389 | HUD survival vs panel bangun vs chain-objective widget |
| game/envkit.js | 2.104 | kit props per bioma |
| game/enemies.js | 1.814 | AI pathing vs stat/wave definitions |

## 5. Menambah modul baru (checklist owner)

1. Tentukan lapis (§1) — satu folder = satu axis (riset: jangan campur axis).
2. Export API sempit; state bersama lewat `core/config.js`/event, bukan
   referensi silang (Game Programming Patterns: decoupling = bisa dipahami
   terpisah).
3. Tambahkan check ke `tools/harness.mjs` (kontrak nama/URL) atau gate terkait.
4. Jalankan `tools/chain.sh` + `tools/structaudit.mjs` (delta pelanggaran = 0).
5. Doc satu paragraf di §2 dokumen ini + baris di `tools/README.md`.

## 6. Checklist handoff / jual (Fase 4)

- [ ] `CREDITS.md` gabungan: pack aset + lisensi (KayKit CC0, egyptian pack,
      zombie pack, three.js) — sumber per-pack sudah di `assets/*/LICENSE*`
      dan diverifikasi `glbtest`.
- [ ] `docs/provenance/` lengkap (HUNTER_GLB.txt sudah; SHA zip bekas sumber
      aset tercatat di `docs/audit/REMOVALS.md`).
- [ ] README onboarding: satu perintah setup (`npm ci` di tools/), satu
      perintah QA (`tools/chain.sh`), satu perintah serve.
- [ ] Tag rilis ber-stamp BUILD + `sw.js` VERSION sinkun (konvensi berjalan).
- [ ] Rantai QA hijau sebagai acceptance otomatis yang bisa dijalankan owner
      baru tanpa pengetahuan tribal.
