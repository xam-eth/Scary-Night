# LAST NIGHT — Roadmap Rebuild 3D Penuh

**Status (2026-10-06):** fondasi gameplay 3D terpadu sudah diimplementasikan dan lolos gate browser awal pada seluruh 11 ruang. Ini **belum dinyatakan selesai**: beberapa efek visual legacy/cutscene belum dipindahkan atau diverifikasi end-to-end, dan pengujian performa/WebGL context-loss belum dilakukan.

## Arah yang dikunci

Bangun ulang presentasi dunia agar mansion, seluruh ruang, furnitur, pintu/jendela, Hunter, musuh, dan objek gameplay tampil sebagai **geometri 3D di satu scene dan satu kamera 3D**. Tampilan isometrik harus berasal dari kamera ortografis 3D—bukan transformasi gambar Canvas 2D dan bukan beberapa canvas 3D transparan yang ditempel di atas dunia 2D.

Canvas 2D boleh tetap dipakai untuk HUD, menu, caption, dan layar hasil. Canvas 2D **tidak boleh** menggambar lantai, dinding, ruangan, furnitur, karakter, musuh, serangan, atau dunia permainan sebagai fallback pada hasil akhir.

Pertahankan sim, aturan bertahan sampai fajar, AI, navigasi, tabrakan, ekonomi, dan kontrol yang ada selama migrasi presentasi, kecuali ada bug yang perlu diperbaiki agar koordinat 3D selaras. Perubahan dokumen desain lama tidak membatalkan permintaan ini: arah sebelumnya yang menerima migrasi 2.5D bertahap digantikan oleh target full 3D ini.

## Audit kondisi repo — fakta saat ini

- Denah runtime di `src/game/mansion.js` mencakup **11 ruangan**, 26 portal, furnitur, collision, serta nav grid; seluruh ruang kini dimuat ke scene WebGL aktif.
- `src/game/world3d.js` menjadi adapter render gameplay: koordinat sim `(x, y)` → 3D `(x, tinggi, z=y)`, room-kit dan aktor memakai kamera ortografis yang sama. Lantai, dinding, sudut, jendela, furniture/props, Hunter, musuh, pickup, bolt, decals, partikel, cue rumah/haunt, dan arc serangan memiliki representasi Three.js.
- `src/game/game.js` memanggil `World3D.render()` sebagai jalur world gameplay; UI/HUD tetap Canvas. Metode `Game.renderWorld()` yang dahulu menggambar world di Canvas sudah dihapus; primitive draw legacy pada actor/mansion modules belum seluruhnya dihapus, namun bukan jalur gameplay. QA memantau floor/props/furniture dan memastikan jumlah pemanggilan aktif **0**. Jalur error WebGL tidak menggambar fallback world 2D.
- `src/game/envkit.js` menyusun geometri mansion ke scene Three.js aktif dan mempertahankan UI/render lain untuk screen yang berbeda. `src/game/enemy3d.js` menempatkan rig GLB di scene saat `full3D`; jalur render-ke-canvas lama masih tersedia untuk pemakaian non-gameplay.
- Browser gate terakhir membuktikan 11 ruang, 26 portal, 251 lantai, 99 panel dinding, 32 sudut, 9 jendela; proyeksi kamera cocok sampai galat maksimum **0,0000 px** pada probe QA. Browser dijalankan lewat Chromium Sparticuz + library Linux paket.
- `assets/env-kit/` memuat 21 GLB; data ekspor runtime yang tersimpan memuat 488 placements dari 16 jenis kit yang terpakai. Ini angka asset/layout, bukan bukti visual per ruang.

Kesimpulan: migrasi 3D aktif sudah jauh melampaui audit awal dan mencakup seluruh denah dalam satu scene gameplay, tetapi roadmap tetap terbuka sampai combat/end-to-end, efek yang tersisa, responsivitas, performa, serta kegagalan konteks WebGL diperiksa.

## Setup browser/QA yang sudah disiapkan

Chromium untuk QA berasal dari paket yang dipatok di `tools/package-lock.json`, bukan asumsi bahwa browser sistem tersedia:

```bash
npm pack @sparticuz/chromium@153.0.0 --pack-destination /tmp
npm ci --prefix tools
node tools/layoutqa.mjs
node tools/export-house.mjs
```

Paket `@sparticuz/chromium` membawa `bin/al2023.tar.br`; skrip QA/ekspor mengekstrak library tersebut ke `tools/.cache/al2023-lib` dan menjalankan Chromium lewat `puppeteer-core`. Cache serta `node_modules` diabaikan Git.

**Yang benar-benar dijalankan pada tahap implementasi:** `node tools/layoutqa.mjs` menggunakan Chromium Sparticuz + `al2023.tar.br`. Run terakhir lulus full-3D, gerak keyboard, interaksi pintu, pickup/bolt/VFX, koleksi pickup, enemy/haunt, desktop boot 1280×720, dan browser-error gate. Stage game pada viewport desktop tetap 405×720 dengan letterboxing; QA ini membuktikan boot/render, bukan polish layout desktop. Screenshot mobile portrait, desktop, serta actor/VFX ada di `tools/shots/3d-migration-{mobile,desktop,enemies,vfx}.png` (beberapa adalah bukti run yang berbeda). Audit furniture menemukan 0/62 furniture menempel dinding dan satu overlap tangga–stairRail; itu tindak lanjut layout terpisah. Belum ada screenshot terpisah untuk semua wing/menu.

Ekspor runtime terakhir: **11 ruangan, 26 portal, 16 akses masuk eksterior, 59 segmen dinding, 488 placements, 16 jenis kit yang terpakai**. Angka ekspor adalah data denah/kit saat ini, bukan acceptance test renderer 3D.

## Roadmap implementasi

### 0. Baseline dan batas migrasi — audit selesai; baseline pra-migrasi terlewat

- [x] Hapus dokumen Markdown lama sesuai permintaan; dokumen ini menjadi roadmap tunggal.
- [x] Jalankan Chromium dari paket Sparticuz beserta library pack Linux.
- [x] Jalankan QA layout lama dan regenerasi ekspor denah.
- [x] Catat kondisi hybrid sebelum memulai perubahan renderer.
- [ ] Screenshot baseline pra-migrasi untuk menu/wing/combat tidak diambil sebelum implementasi; hal itu tidak bisa direkonstruksi. Bukti state saat ini tersedia di `tools/shots/`.

### 1. Fondasi satu scene 3D — tercapai untuk jalur gameplay, masih ada cleanup

- [x] `World3D` mengirim state sim setiap frame ke scene WebGL mansion dengan kamera ortografis aktif.
- [x] Adapter koordinat `(x, y)` → `(x, tinggi, z=y)` dipakai oleh geometry, actor, pickup, bolt, decal, dan VFX.
- [~] Camera-follow/zoom/resize dan proyeksi orthographic selaras (galat probe **0,0000 px**); input memakai adapter proyeksi layar-ke-world, belum raycast ke lantai.
- [x] Canvas gameplay hanya overlay UI/HUD pada jalur normal; `Game.renderWorld()` dihapus dan gate monkeypatch melaporkan 0 pemanggilan `drawFloor`, `drawProps`, atau `drawFurniture` selama gameplay. Primitive draw legacy pada module mansion/actor masih perlu diaudit sebelum semua kode Canvas world dibersihkan.
- [~] Actor GLB dan world memakai satu scene/kamera aktif. Renderer/canvas lama masih dipakai pada layar non-gameplay dan jalur fallback actor, jadi lifecycle/resource cleanup global belum selesai.

**Gate yang sudah dibuktikan:** kamera ortografis tunggal untuk objek world gameplay; lima probe proyeksi 3D ↔ renderer 2D cocok sampai 0,0000 px. **Belum diuji:** raycast-to-floor/mouse aim dan context-loss.

### 2. Mansion 3D lengkap — blockout semua 11 ruang tercapai; polish terbuka

- [x] Seluruh denah `Mansion`/`assets/house.json` dibangun sekaligus. Gate mengukur 11 ruang, 26 portal, 251 floor tiles, 99 panel dinding, 32 sudut, dan 9 jendela dalam scene aktif.
- [~] Lantai, dinding, jendela, pintu, dan furniture/props berupa geometry 3D. QA membuka `diningDoor` dan melihat pivot mesh bergerak ke sudut **-1,25 rad**; semua variasi jendela/barricade belum diuji satu per satu.
- [x] Props/furniture ditempatkan dari data runtime/kit. Pemeriksaan fit box tidak menemukan overhang/gap, namun audit layout menemukan **0/62** furniture dalam jarak 26 px dari dinding dan satu overlap staircase–stairRail; tata ruang perlu dirapikan.
- [ ] Cutaway/fade dinding dan readability occlusion di seluruh ruang belum dibangun/divalidasi lengkap.
- [x] Ruang samping dan transisi ada di scene aktif dan terhitung dalam gate; screenshot semua wing per room dan navigasi end-to-end tetap belum ada.

**Gate saat ini:** geometri 11 ruang dan seluruh portal terbukti ada dalam scene; screenshot mobile/desktop membuktikan render WebGL. **Belum terbukti:** satu frame yang menampilkan seluruh mansion, atau traversal aktual menembus semua portal.

### 3. Actor, combat, dan interaksi di world yang sama — render dasar tercapai; playtest combat terbuka

- [x] Hunter rigged dan keenam tipe musuh (`crawler`, `zombie`, `hunter`, `werewolf`, `ghoul`, `stalker`) hadir di scene. Gate terakhir menguji 8 rig GLB aktif dari budget 8 plus 5 proxy actor 3D untuk actor tambahan.
- [x] Actor share kamera/depth scene; jalur gameplay memakai skinned model atau proxy geometry 3D, bukan billboard Canvas.
- [~] Gerak keyboard, visual arc claw, bolt mesh, pickup, pengumpulan pickup, dan interaksi pintu lulus assertion. Damage/hitbox, empat arah aim, sword/crossbow fire, knockback, death, serta sinkronisasi animasi-hit belum diuji end-to-end.
- [~] State pintu/interaksi dan cue rumah/haunt tampil sebagai mesh 3D; semua jenis jendela/barricade dan seluruh props interaktif belum diverifikasi.

**Gate saat ini:** render actor, gerakan, swing visual, bolt/pickup, dan satu pintu dibuktikan di Chromium. **Belum lulus:** playtest attack → hit → death dengan verifikasi offset hitbox/mesh dan seluruh arah aim.

### 4. Lighting, horror readability, dan VFX 3D — jalur inti ada; tuning belum selesai

- [~] Ambient/key/rim light, point lights berbasis sim, shadow, flicker/exposure, dan event lightning ada di WebGL scene. Fog, semua mode bloodmoon/blackout, serta tuning tiap wing belum lolos matriks QA.
- [x] Decal texture di floor, pickup, bolt/trail, particles, claw arc/muzzle flash, room marks, watcher, draft, cat, dan door cues mempunyai representasi 3D. QA Chromium memeriksa decal texture 2048×1255, particles aktif, pickup/bolt mesh, dan haunt objects.
- [~] Aktor/props berbagi depth scene dan cahaya; inspeksi visual occlusion pada setiap kombinasi foreground/background belum lengkap.
- [ ] Belum ada tuning/evidence terpisah untuk readability saat low-health, bloodmoon, blackout, dan kerumunan maksimum.

**Gate saat ini:** asset VFX utama muncul sebagai objek WebGL dan browser tidak melaporkan error. **Belum lulus:** darkness/readability/occlusion matrix dan verifikasi cutscene.

### 5. Integrasi gameplay, UI, dan performa perangkat — integrasi dasar lulus; cakupan runtime terbuka

- [~] HUD/touch controls tampil di atas WebGL dan sim tetap menerima gerak, pintu, pickup. Pause, death/restart, dawn, save/load, audio, serta satu run penuh belum diregresikan.
- [~] Chromium lulus boot pada mobile portrait 390×844 dan desktop viewport 1280×720. Desktop stage tetap 405×720 letterboxed; landscape layout, orientation-change, DPR selain 1, tab hidden, serta WebGL context loss belum diuji.
- [ ] CPU/GPU frame time, draw calls, triangle/instance count, memory budget, dan waktu siap semua room/actor belum diukur.
- [ ] Belum ada optimization/performance pass akhir untuk device low-end.

### 6. QA penerimaan full 3D — gate awal lulus, checklist final masih terbuka

`tools/layoutqa.mjs` kini menguji scene/runtime dengan Chromium Sparticuz + library pack pada mobile portrait 390×844 dan browser desktop 1280×720.

Checklist sebelum menyatakan migrasi selesai:

- [x] QA menemukan geometri 11 ruang/26 portal pada scene WebGL ortografis bersama; tidak ada paint Canvas 2D aktif untuk floor/props/furniture.
- [x] Probe QA melaporkan 0 pemanggilan `drawFloor`/`drawProps`/`drawFurniture` selama gameplay.
- [~] Hunter, rig seluruh tipe musuh yang diuji, pickup, bolt, pintu, dan claw arc mempunyai objek 3D; audit semua jalur Canvas world/cutscene dan seluruh variasi actor belum tuntas.
- [ ] Traversal seluruh room/portal, nav/collision, hitbox, mouse/touch aim, dan semua door/window state belum diuji end-to-end.
- [~] Browser console/page-error gate lulus pada run terakhir di dua ukuran viewport; semua flicker/z-fighting dan seluruh asset fail tidak dijamin oleh gate ini.
- [ ] Run penuh movement → combat → low-health → pause → death/restart → dawn belum dilakukan.
- [x] Screenshot QA saat ini disimpan di `tools/shots/3d-migration-*.png`; gate menulis ukuran viewport/log ke stdout. Dokumentasikan bukti final dan tindak lanjut sebelum checklist ditutup.

## Berkas utama dan cleanup tersisa

- `src/main.js` — bootstrap UI dan lifecycle input; HUD tetap overlay Canvas.
- `src/game/game.js` — jalur aktif mengirim state ke `World3D`; metode `renderWorld()` Canvas lama sudah dihapus. Primitive draw dormant pada module mansion/actor masih perlu audit/cleanup.
- `src/core/render.js` — proyeksi/camera adapter dan utilitas UI masih dipakai; audit serta hapus jalur gambar world yang tidak lagi aktif pada fase cleanup.
- `src/game/mansion.js` — sumber denah, physics/collision, props dan nav; data sim dipertahankan.
- `src/game/envkit.js`, `src/game/world3d.js` — scene geometry, camera/render path, actor objects, VFX, lighting; kebutuhan cutaway, performance, resource disposal, dan context-loss masih terbuka.
- `src/game/valen3d.js`, `src/game/enemy3d.js`, `src/game/player.js`, `src/game/enemies.js`, `src/game/weapons.js` — GLB/animation dan koordinasi gameplay; verifikasi hit/death serta asset lifecycle masih terbuka.
- `tools/layoutqa.mjs`, `tools/export-house.mjs` — QA scene/layout/viewport dan ekspor data; perlu memperluas traversal, combat, lifecycle, serta per-state screenshots.

## Risiko dan aturan kerja

1. **Jangan berhenti di satu ruangan.** Tahap blockout harus mencakup semua 11 ruangan; polish dapat bertahap, tetapi ruangan lain tidak boleh sekadar Canvas atau placeholder 2D pada hasil akhir.
2. **Jangan menyamakan isometrik dengan 3D.** Transformasi affine di Canvas tetap render 2D.
3. **Jangan mengklaim selesai dari jumlah GLB/mesh saja.** Bukti final adalah scene WebGL terpadu, screenshot, dan playtest yang lolos.
4. **Pertahankan gameplay sim yang ada.** Migrasi pertama berfokus pada presentasi dan adapter koordinat; perubahan mekanik perlu tes regresi terpisah.
5. **Jaga provenance asset.** Kit KayKit Dungeon Remastered 1.0 oleh Kay Lousberg berlisensi CC0 1.0; atribusi diapresiasi, tidak diwajibkan. Hunter GLB dan model lain tetap milik pemilik asetnya; jangan re-export atau mengubah byte sumber tanpa izin.
6. **No false-green reporting.** Laporkan per fase: implementasi yang benar-benar masuk, perintah yang benar-benar dijalankan, hasil, dan blocker yang masih ada.
