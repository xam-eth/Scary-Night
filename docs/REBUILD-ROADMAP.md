# LAST NIGHT — Roadmap Rebuild 3D Penuh

**Status (2026-10-08):** target migrasi dunia permainan ke satu pipeline WebGL 3D untuk seluruh 11 ruangan telah dicapai. Fold/cutaway yang menyembunyikan dinding saat player bergerak sudah dihapus; QA Chromium memastikan 628 instance aktif dan 140 instance arsitektur tetap tampil dengan matriks tak berubah di enam anchor. UI kontrol kini memakai ikon vektor relevan (menu tetap menyertakan label), dan tujuh pintu memakai panel kayu pada `doorway.glb`—bukan grille `door_gate.glb`—dengan swing inward yang diease ke 90° saat buka/tutup. `envqa --mode=3d-smoke` kini juga memverifikasi aset, orientasi hinge, kedua transisi, tabrakan/LOS, dan refresh shadow-map pada awal/akhir swing; smoke test serta harness simulasi lulus. **Hardening/release QA masih terbuka:** sweep 17 stop/screenshot belum diulang, `layoutqa` belum diulang setelah perubahan visual, dan matriks combat/state penuh, performa perangkat nyata, serta WebGL context-loss belum diverifikasi.

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

Kesimpulan: penerimaan inti migrasi full-3D dunia permainan sudah lulus—seluruh denah aktif, objek gameplay berada di pipeline WebGL bersama, dan gameplay tidak memanggil renderer world Canvas 2D. Dinding/props/detail kini mempertahankan transform visual statik saat player bergerak dan seluruh quality tier menjaga world mesh tetap aktif. Ini bukan klaim bahwa seluruh produk siap rilis: combat/state yang belum masuk gate, inspeksi occlusion visual semua ruang, responsivitas, performa perangkat nyata, dan pemulihan WebGL masih merupakan pekerjaan QA lanjutan.

## Setup browser/QA yang sudah disiapkan

Chromium untuk QA berasal dari paket yang dipatok di `tools/package-lock.json`, bukan asumsi bahwa browser sistem tersedia:

```bash
npm pack @sparticuz/chromium@153.0.0 --pack-destination /tmp
npm ci --prefix tools
node tools/layoutqa.mjs
node tools/export-house.mjs
```

Paket `@sparticuz/chromium` membawa `bin/al2023.tar.br`; skrip QA/ekspor mengekstrak library tersebut ke `tools/.cache/al2023-lib` dan menjalankan Chromium lewat `puppeteer-core`. Cache serta `node_modules` diabaikan Git.

**Hasil QA yang benar-benar dijalankan (2026-10-06):** `node tools/layoutqa.mjs` menggunakan Chromium Sparticuz + `al2023.tar.br` dan berakhir dengan exit 0. Gate mencatat `renderer=webgl-3d`, kamera orthographic, 11 ruangan/26 portal, 251 floor meshes, 99 wall panels, 32 corners, 9 windows, props/detail terpetakan (`unmapped=[]`), dan 0 pemanggilan Canvas world selama gameplay. Gate interaksi browser mencakup gerak keyboard, pintu, pickup/collection, bolt/trail, particles/decals, musuh, swing, watcher/door cues; desktop boot 1280×720 dan browser errors lulus. Stage desktop tetap 405×720 dengan letterboxing, jadi ini bukan bukti polish desktop. Screenshot mobile/desktop/actor/VFX tersedia di `tools/shots/3d-migration-{mobile,desktop,enemies,vfx}.png` (beberapa berasal dari run berbeda).

Pemeriksaan regresi setelah perbaikan kode terakhir: `node tools/harness.mjs` lulus 18.277 frame/300 detik simulasi dengan outcome `DAWN` dan tanpa runtime errors; `node tools/glbtest.mjs` seluruh pemeriksaan Valen/enemy/kit/modular-room lulus; `node --check` lulus untuk 60 file JavaScript dan `git diff --check` lulus.

Audit layout terbaru mencatat **70 furnitur kit**: 0 dekat dinding (jarak ≤26 px) dan satu overlap staircase–stairRail sekitar 150×20 px. Keterjangkauan komponen ruang berada sekitar 77–95%. Pemeriksaan fit terpisah tidak menemukan prop melampaui collision box atau celah antara mesh dan box; detail penataan masih tindak lanjut. Belum ada screenshot terpisah untuk semua wing/menu.

**Perbaikan dan QA `tools/envqa.mjs` (2026-10-07):** probe lama body/room kini mengukur scene/framebuffer WebGL; window diuji dari kedua sisi valid; assertion failure menghasilkan exit non-zero. `node tools/envqa.mjs --fast` sebelumnya lulus semua assertion utama (~11m14s) sebelum keputusan final untuk membuat world statik; angka siege/bake/fit dari run itu tetap berguna, tetapi hasil fold-nya bukan status terbaru. Crowd timing pada software renderer bukan benchmark perangkat nyata.

**Perbaikan terbaru: geometri statik selama gameplay (2026-10-07):** permintaan agar dinding dan elemen ruang tidak muncul-hilang karena langkah player kini diterapkan dengan menghapus total fold/cutaway yang terpicu gerakan. Matriks wall, floor, prop, dan detail tidak ditulis ulang saat player/kamera berpindah; mesh hanya memakai sakelar pada state gameplay eksplisit (misalnya panel jendela pecah), bukan posisi player. Semua quality tier sekarang menjaga room, props, dan fortress dressing aktif.

`node tools/envqa.mjs --mode=3d-smoke` setelah perubahan ini lulus exit 0 (~2m50s): keenam tipe musuh ter-render, framebuffer EnvKit terbukti pada 11/11 ruang, 9/9 jendela valid, 628 instance aktif termasuk 140 instance arsitektur, **0 instance aktif tersembunyi**, dan **0 matriks statik berubah** setelah player/kamera dipindah ke enam anchor; seluruh tier menjaga world mesh aktif, tanpa browser page errors. `node tools/harness.mjs` juga lulus 18.277 frame/300 detik simulasi hingga `DAWN`, tanpa runtime errors. **Sweep penuh 17 stop beserta screenshot dan QA perangkat nyata belum dilakukan.**

**Regresi 2026-10-08:** smoke 3D lulus lagi setelah cap GLB disetel ke 14 (maksimum combatant aktif); crowd reduced-AI tetap di simulasi, tanpa GLB/proxy. `glbtest` dan `harness --systems` seluruh assertion lulus. Probe melee harness kini memakai invers proyeksi isometrik penuh; tes dawn menunggu gelombang mencapai musuh, dan assertion rentang zoom portrait diselaraskan dengan kamera full-bleed yang memang dipakai. Klik Chromium terfokus menguji consent → Settings → Privacy → Back tanpa error. Inspeksi visual sementara pada menu desktop/mobile dan HUD mobile menemukan serta memperbaiki wordmark menu yang sebelumnya tergambar dua kali; gambar inspeksi tidak disimpan. Full clicktest tidak diulang setelah koreksi karena durasinya panjang; run sebelumnya hanya gagal pada ekspektasi lama yang mencari Privacy di menu utama. Smoke bot standar terbaru mencapai `DEATH` pada 282,1 detik simulasi (tanpa runtime error), jadi survival-balance hingga dawn belum dibuktikan oleh run ini.

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
- [x] Lantai, dinding, jendela, pintu, dan furniture/props berupa geometry 3D. Semua tujuh pintu kini mengambil panel kayu terpisah `wall_doorway_door` dari `doorway.glb`, dipasang pada hinge di tepi daun dan mengayun **90° ke arah interior** dengan easing 0,42 detik; Chromium menguji posisi tertutup, sudut tengah, endpoint buka/tutup, semua orientasi, tabrakan/LOS, cast shadow, dan refresh shadow-map pada awal/akhir swing. Variasi semua state jendela/barricade masih belum diuji satu per satu.
- [x] Props/furniture ditempatkan dari data runtime/kit. Pemeriksaan fit box tidak menemukan overhang/gap, namun audit layout menemukan **0/70** furnitur dalam jarak 26 px dari dinding dan satu overlap staircase–stairRail berukuran sekitar 150×20 px; tata ruang perlu dirapikan.
- [x] Cutaway berbasis langkah player dihapus. Wall/floor/prop/detail mempertahankan matriks dan skala penuh ketika player/kamera bergerak; QA Chromium membandingkan enam anchor dan mendapati 0 perubahan pada 140 instance arsitektur. Pintu/jendela/pickup tetap mengikuti state gameplay eksplisit; occlusion depth 3D normal tetap berlaku.
- [x] Ruang samping dan transisi ada di scene aktif dan terhitung dalam gate; screenshot semua wing per room dan navigasi end-to-end tetap belum ada.

**Gate saat ini:** geometri 11 ruang dan seluruh portal terbukti ada dalam scene; screenshot mobile/desktop membuktikan render WebGL. **Belum terbukti:** satu frame yang menampilkan seluruh mansion, atau traversal aktual menembus semua portal.

### 3. Actor, combat, dan interaksi di world yang sama — render dasar tercapai; playtest combat terbuka

- [x] Hunter rigged dan keenam tipe musuh (`crawler`, `zombie`, `hunter`, `werewolf`, `ghoul`, `stalker`) hadir di scene. Roster memakai lima rig monster berbeda dari Ultimate Monsters CC0 plus rig Werewolf lokal; tiap tipe memetakan idle/locomotion/attack/death ke klip sumbernya, dan lima rig pack juga memetakan hurt-react ke `hurtFlash`/`staggerT` tanpa mengubah simulasi. QA Chromium menguji keenam rig skinned di scene bersama; anggaran 14 rig mencakup seluruh batas combatant hidup. Crowd siege reduced-AI tetap di simulasi dan tidak mendapat GLB atau proxy visual. Musuh aktif yang belum siap/terpilih tidak digambar sebagai proxy generik.
- [x] Actor share kamera/depth scene; musuh gameplay hanya memakai skinned GLB dan tidak jatuh kembali ke proxy geometry atau billboard Canvas.
- [~] Gerak keyboard, visual arc claw, bolt mesh, pickup, pengumpulan pickup, dan interaksi pintu lulus assertion. Smoke test kini memverifikasi `hurtFlash`/`staggerT` memilih klip hit sumber; damage/hitbox, empat arah aim, sword/crossbow fire, knockback, death, serta sinkronisasi hit gameplay tetap belum diuji end-to-end.
- [~] State pintu/interaksi dan cue rumah/haunt tampil sebagai mesh 3D; semua jenis jendela/barricade dan seluruh props interaktif belum diverifikasi.

**Gate saat ini:** render actor, gerakan, swing visual, bolt/pickup, dan satu pintu dibuktikan di Chromium. **Belum lulus:** playtest attack → hit → death dengan verifikasi offset hitbox/mesh dan seluruh arah aim.

### 4. Lighting, horror readability, dan VFX 3D — jalur inti ada; tuning belum selesai

- [~] Ambient/key/rim light, point lights berbasis sim, shadow, flicker/exposure, dan event lightning ada di WebGL scene. Fog, semua mode bloodmoon/blackout, serta tuning tiap wing belum lolos matriks QA.
- [x] Decal texture di floor, pickup, bolt/trail, particles, claw arc/muzzle flash, room marks, watcher, draft, cat, dan door cues mempunyai representasi 3D. QA Chromium memeriksa decal texture 2048×1255, particles aktif, pickup/bolt mesh, dan haunt objects.
- [~] Aktor/props berbagi depth scene dan cahaya; inspeksi visual occlusion pada setiap kombinasi foreground/background belum lengkap.
- [ ] Belum ada tuning/evidence terpisah untuk readability saat low-health, bloodmoon, blackout, dan kerumunan maksimum.

**Gate saat ini:** asset VFX utama muncul sebagai objek WebGL dan browser tidak melaporkan error. **Belum lulus:** darkness/readability/occlusion matrix dan verifikasi cutscene.

### 5. Integrasi gameplay, UI, dan performa perangkat — integrasi dasar lulus; cakupan runtime terbuka

- [x] HUD/touch controls tampil di atas WebGL; tombol gameplay memakai ikon vektor untuk gerak, serang/senjata, dash, interaksi kontekstual, perbaikan, dan barricade. Menu memakai ikon semantik dengan label tetap terbaca. Gerak, pintu, pickup diuji; pause, death/restart, dawn, save/load, audio, serta satu run penuh belum diregresikan.
- [~] Chromium lulus boot pada mobile portrait 390×844 dan desktop viewport 1280×720. Desktop stage tetap 405×720 letterboxed; landscape layout, orientation-change, DPR selain 1, tab hidden, serta WebGL context loss belum diuji.
- [ ] CPU/GPU frame time, draw calls, triangle/instance count, memory budget, dan waktu siap semua room/actor belum diukur.
- [ ] Belum ada optimization/performance pass akhir untuk device low-end.

### 6. QA penerimaan full 3D — gate render lulus; release QA masih terbuka

`tools/layoutqa.mjs` menguji scene/runtime dengan Chromium Sparticuz + library pack pada mobile portrait 390×844 dan desktop 1280×720; run terakhir sebelum perubahan static-visibility exit 0. Setelah penghapusan cutaway, gate yang diulang adalah `envqa --mode=3d-smoke` dan harness simulasi; `layoutqa` belum diulang.

Checklist penerimaan render full-3D:

- [x] Gate browser menemukan geometri seluruh 11 ruang/26 portal pada scene WebGL ortografis bersama; props/detail terpetakan, `unmapped=[]`.
- [x] Gate mencatat 0 pemanggilan Canvas world untuk floor/props/furniture selama gameplay; Canvas UI/HUD tetap diizinkan.
- [x] Gerak, pintu, pickup/collection, bolt/VFX, particles/decals, musuh, swing, watcher dan door cues lulus probe browser yang ada.
- [~] Screenshot membuktikan stage WebGL di mobile/desktop; desktop letterboxing, semua wing, variasi cutscene dan seluruh jalur Canvas legacy belum diaudit visual.
- [x] `envqa --mode=3d-smoke` lulus body, framebuffer 11 room, geometri statik lintas enam anchor, 9 window, quality-tier visibility, tujuh pintu (aset/orientasi/swing, collision/LOS, shadow pass), dan browser errors; seluruh 628 instance aktif terlihat dan 0 matriks berubah karena gerak player/kamera.
- [~] Sweep 17 stop/screenshot belum diulang setelah mode visual statik diterapkan; crowd timing headless tetap diagnostik, bukan bukti performa perangkat.
- [ ] Traversal aktual semua room/portal, nav/collision, hitbox, mouse/touch aim, dan semua door/window state belum diuji end-to-end.
- [ ] Run penuh movement → combat → low-health → pause → death/restart → dawn belum dilakukan.
- [ ] Performa perangkat target, penggunaan memory/GPU, orientasi landscape, context-loss/restoration, sisa z-fighting, dan matriks darkness/readability belum lulus QA; uji enam anchor browser belum menggantikan inspeksi visual semua room/perangkat.
- [x] Screenshot QA saat ini disimpan di `tools/shots/3d-migration-*.png`; screenshot audit tambahan berada di direktori yang di-ignore `tools/shots-browser/qa/`.

## Berkas utama dan cleanup tersisa

- `src/main.js` — bootstrap UI dan lifecycle input; HUD tetap overlay Canvas.
- `src/game/game.js` — jalur aktif mengirim state ke `World3D`; metode `renderWorld()` Canvas lama sudah dihapus. Primitive draw dormant pada module mansion/actor masih perlu audit/cleanup.
- `src/core/render.js` — proyeksi/camera adapter dan utilitas UI masih dipakai; audit serta hapus jalur gambar world yang tidak lagi aktif pada fase cleanup.
- `src/ui/icons.js`, `src/game/hud.js`, `src/ui/screens.js` — ikon Canvas semantik bersama untuk kontrol sentuh dan navigasi, dengan ukuran/hitbox/input tetap dipertahankan.
- `src/game/mansion.js` — sumber denah, physics/collision, props dan nav; data sim dipertahankan.
- `src/game/envkit.js`, `src/game/world3d.js` — scene geometry, camera/render path, actor objects, VFX, lighting; performance, inspeksi occlusion, resource disposal, dan context-loss masih terbuka.
- `src/game/valen3d.js`, `src/game/enemy3d.js`, `src/game/player.js`, `src/game/enemies.js`, `src/game/weapons.js` — GLB/animation dan koordinasi gameplay; verifikasi hit/death serta asset lifecycle masih terbuka.
- `tools/layoutqa.mjs`, `tools/export-house.mjs` — QA scene/layout/viewport dan ekspor data; perlu memperluas traversal, combat, lifecycle, serta per-state screenshots.

## Risiko dan aturan kerja

1. **Jangan berhenti di satu ruangan.** Tahap blockout harus mencakup semua 11 ruangan; polish dapat bertahap, tetapi ruangan lain tidak boleh sekadar Canvas atau placeholder 2D pada hasil akhir.
2. **Jangan menyamakan isometrik dengan 3D.** Transformasi affine di Canvas tetap render 2D.
3. **Jangan mengklaim selesai dari jumlah GLB/mesh saja.** Bukti final adalah scene WebGL terpadu, screenshot, dan playtest yang lolos.
4. **Pertahankan gameplay sim yang ada.** Migrasi pertama berfokus pada presentasi dan adapter koordinat; perubahan mekanik perlu tes regresi terpisah.
5. **Jaga provenance asset.** Kit KayKit Dungeon Remastered 1.0 oleh Kay Lousberg berlisensi CC0 1.0; atribusi diapresiasi, tidak diwajibkan. Hunter GLB dan model lain tetap milik pemilik asetnya; jangan re-export atau mengubah byte sumber tanpa izin.
6. **No false-green reporting.** Laporkan per fase: implementasi yang benar-benar masuk, perintah yang benar-benar dijalankan, hasil, dan blocker yang masih ada.
