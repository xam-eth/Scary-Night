# Status Rebuild 3D & Survival Milestone 1

**Pembaruan:** 2026-10-15 (Asia/Kuching)
**Status keseluruhan: MASIH TERBUKA — bukan klaim siap rilis.** Inti rebuild dunia 3D dan loop Survival Milestone 1 sudah terimplementasi. Pada 2026-10-12 arah UI/UX dan threat model dikoreksi mengikuti feedback user; pada 2026-10-15 dilakukan pass analisis gap & bug (lihat bagian "Gap & bug pass 2026-10-15"), lalu pass progres Hunter + level bangunan (lihat "Progres Hunter & level bangunan"), lalu pass menara crossbow (lihat "Menara crossbow"), dan seluruh gate otomatis dijalankan ulang. Acceptance visual/manual di perangkat, playtest manusia, dan packaging Play masih terbuka. Hasil tiap skrip hanya berlaku untuk cakupan yang benar-benar diuji.

## Menara crossbow — bangunan yang bertarung (2026-10-15)

Permintaan: *next* kedua → **menara** (opsi pertama dari laporan sebelumnya). Tetap icon-first, dibayar Oil/Wood lewat **builder queue yang sama**, tidak bisa dibeli di malam hari, tidak ada kartu "pilih 1 dari 3". Keputusan orientasi masih menunggu user; `manifest.webmanifest` tidak diubah.

**Model** (`src/game/survival.js`: `SURVIVAL_BUILDINGS.tower`, `SURVIVAL_BUILDING_LEVELS.tower`, `TOWER`; biaya = Oil/Wood/detik):

| Level | Biaya | Bolt | Jangkauan |
|---|---|---|---|
| Lv1 (bangun) | 4/16/8 | 16 | 520 |
| Lv2 | 6/18/7 | 22 | 580 |
| Lv3 | 8/22/8 | 30 | 640 |

- **Posisi adalah pilihannya.** Menara dibangun di ruangan terang seperti bangunan lain, tetapi berdiri ±150 px di dalam **pintu luar ruangan itu** (64 px menyamping ke arah tengah ruangan), di lantai kosong yang punya garis tembak bebas lewat celah pintu; ruangan tanpa pintu luar (hanya jendela) → dekat tengah ruangan. Ruangan dengan dua pintu menjaga pintu yang lebih ramai (front > cellar > chapel > dining > palisade > kitchen > postern). Contoh: hall (212, 483) 187 px dari frontDoor, basement (536, 1189) → cellarDoor, chapel (1045, 1214) → chapelDoor, gatehouse (−456, 929) → palisade, dining (−727, 182) → diningDoor. Beda dengan guard, menara tidak pindah ke pintu yang sedang ditekan.
- **Malam saja.** Tiap 1.1 dtk memilih target dalam jangkauan dengan skor yang sama dengan guard (terdekat, dengan prioritas untuk yang mencakar api, Breaker, dan yang sudah masuk rumah), membidik dengan lead, dan menembakkan bolt berat (900 px/dtk) lewat celah pintu tertutup. Bolt menembus **1 body tambahan** dan jatuh 120 px melewati jangkauan. Tidak pernah menembak lewat dinding atau furnitur (garis bolt = LOS + cek tabrakan tiap 10 px, karena bolt bertabrakan dengan semua furnitur sedangkan LOS mengabaikan kursi/meja kecil). Siang hari hanya berjaga (0 tembakan). Kill menara dihitung untuk reward kill seperti kill lain; `nightStats.towerShots` dicatat.
- **3D:** menara kayu dengan dek dan ballista yang berputar ke arah bidikan (12 rad/dtk) dan tersentak mundur saat menembak; bolt oranye meluncur dari dek lalu turun ke tinggi body di titik bidik; skala per level sama seperti bangunan lain, panji di dek (Lv2 biru, Lv3 emas). Saat menara dipilih di siang hari: **ring jangkauan merah** (isi tipis + tepi tebal berdenyut) seluas jangkauan level saat ini.
- **UI (ikon + angka):** kartu build ke-4 `TOWER` (ikon menara, crossbow `16`, biaya `4` / `16`) — kartu kini 4 sejajar (82 px portrait, 85 px di kolom kiri landscape; ikon 36). Bubble menara dengan badge `Lv` + panah hijau, di atas modelnya. Sheet `Lv1 → Lv2`: crossbow `16 → 22` BOLT DAMAGE, target `520 → 580` RANGE, biaya, `UPGRADE` / `MAX`. Kamera siang membingkai menaranya, bukan tengah ruangan.
- **Kontrak label QA (baru):** `survival:BUILD tower`, `survival:UPGRADE tower LV<n>`.
- **Save:** memakai `save.survival.buildings` (`'tower'`) dan `buildingLevels` yang sudah ada; tipe bangunan yang tidak dikenal dibuang saat restore; menara dibangun ulang dari save (reload siang maupun tengah malam).

**Ikut diperbaiki di pass ini:**
- Model bangunan ekonomi (pump/sawmill/shelter) kini berdiri di **lantai kosong**, tidak lagi di atas meja (dicari melingkar dari titik ideal; dining bergeser 112 px, conservatory 64 px) — menutup kandidat polish dari pass progres. Bubble siang mengikuti posisi model.
- **Bug yang tertangkap saat QA pass ini (sebelum commit):** versi awal membaca `spec.range` untuk batas terbang bolt menara, padahal spec tembakan Hunter adalah objek senjatanya (`range` 460) → bolt Hunter ikut jatuh di 460 px dan bot `hunter-builder` berubah dari 1/3 menjadi 3/3. Kunci menara kini terpisah (`boltRange` / `boltPierce`), harness punya regresi (bolt Hunter dan guard tetap tanpa batas jangkauan dan tanpa pierce), dan hasil balance bot lama kembali identik dengan baseline `4423076`.
- Ring jangkauan versi awal (tepi 2.5%, isi 12%) hampir tidak terlihat di atas karpet merah di screenshot → tepi 4.8%, isi 20%, denyut 0.78–0.98.

**Balance (pengukuran, bukan gate; `--seeds=3 --duration=72`):** bot baru `tower-builder` (rencana: Perapian Lv2 → 1 pump di ruangan tanpa pintu → menara di tiap ruangan terang yang punya pintu luar → Perapian Lv3 → menara Lv2 bila terjangkau) **menang 3/3** dengan 3 menara Lv1 (hall, basement, chapel) + Perapian Lv3. Menara menembak 59–60× di Night 2 dan 77–94× di Night 3; Night 3 paling bersih dari semua bot: puncak 61 musuh hidup (builder 81–83), 0 musuh mencapai api (builder 7–8), Oil tercakar 0, HP 100/100. Bot lain tidak berubah: idle/passive/flare/active 0/3, builder 3/3, fire-builder 3/3, hunter-builder 1/3. Artinya menara adalah strategi yang valid dan cukup kuat, tetapi tidak mengubah peta menang/kalah; kesulitan untuk pemain yang membangun masih rendah (lihat acceptance #4).

**Belum dikerjakan:** guard yang bisa terluka, cutaway/x-ray model penuh, pass balance (biaya/ancaman) setelah playtest manusia.

## Progres Hunter & level bangunan (2026-10-15)

Permintaan: *next* — langkah pertama yang ditawarkan di laporan sebelumnya. Progres dibuat deterministik dan icon-first: dibayar Oil/Wood lewat **satu builder queue** yang sama dengan bangunan, tidak ada kartu "pilih 1 dari 3", tidak bisa membeli di malam hari. Keputusan orientasi (manifest landscape vs UI portrait-first) **masih menunggu user** dan `manifest.webmanifest` tidak diubah.

**Model** (`src/game/survival.js`: `SURVIVAL_BUILDING_LEVELS`, `SURVIVAL_HUNTER`; biaya = Oil/Wood/detik):

| Jalur | Lv1 (bangun) | Lv2 | Lv3 | Efek |
|---|---|---|---|---|
| Oil Pump (extractor) | 2/10/7 — pompa 6 | 4/12/6 — 10 | 6/16/7 — 14 | Oil dipompa ke stok **sepanjang malam** (bahan bakar api + dompet), bukan saat fajar |
| Sawmill | 2/10/7 — 7 Wood, +10% | 4/12/6 — 11, +20% | 6/16/7 — 15, +30% | Wood tiap fajar + papan: HP maks semua pintu luar naik (dijumlah, cap +60%) |
| Shelter | 4/14/9 — 1 | 6/16/8 — 2 | 8/20/9 — 3 | Survivor pindah masuk **saat bangunan selesai** = guard pintu malam itu juga |
| Hunter | bolt 26, HP 100 | 14/8/5 — 32, 120 | 20/12/6 — 40, 140 | Damage bolt crossbow dan HP maks; HP penuh saat latihan selesai |

Alasan: produksi yang hanya dibayar saat fajar tidak balik modal dalam run 3 malam (bot builder lama: Sawmill Day 2 neto −2 Oil −3 Wood, Extractor hanya menukar 10 Wood → 4 Oil, semua yang dibeli Day 3 terbuang). Kini setiap level terasa di malam berikutnya. Hunter menjadi sink Oil (Oil surplus), level bangunan menjadi sink Wood (Wood bottleneck). Cadangan Oil malam (19) tetap berlaku untuk setiap pembelian; Perapian (12/8/5, 18/12/6) dan gate (4/16/9, +220 HP) tidak berubah. Cek damage: Swarm 48/54/60 HP, ×1.5 di cahaya → Hunter Lv2 one-shot Swarm Night 1 di cahaya, Lv3 one-shot semua Swarm di cahaya.

**UI (ikon + angka):**
- Bubble **Hunter** (topi lebar + mantel kulit, beda dari survivor biru) dengan badge `Lv` dan panah hijau bila terjangkau. Sheet: crossbow `26 → 32` BOLT DAMAGE, hati `100 → 120` HEALTH, biaya, tombol `UPGRADE` / `MAX`.
- Bubble **bangunan**: badge `Lv1–3`, panah hijau bila level berikutnya terjangkau, ring progres hijau saat di-upgrade (panah disembunyikan selama itu). Sheet `Lv1 → Lv2`: pump `+6 → +10` EVERY NIGHT; sawmill `+7 → +11` EVERY DAWN dan papan `+10% → +20%` DOOR HP; shelter guard `+1 → +2`; `Lv3 MAX`. Kartu build membaca angka Lv1 dari tabel level.
- Popup fajar: baris pompa (ikon extractor, `+6`). Malam: chip level emas di samping HP bar Hunter. Pill builder menampilkan ikon Hunter saat dia berlatih.
- Bubble tidak lagi bertumpuk: pointer di tepi layar disebar rata sepanjang tepi (tepi yang penuh berzig-zag ke dalam); bubble Hunter bergeser dari bubble Perapian. Bubble bangunan dinaikkan agar model (dan panjinya) terlihat di bawahnya.
- Chip FTUE baru (sekali tampil): `TAP A GREEN ARROW TO LEVEL UP`.
- 3D: bangunan ×1.3 di Lv1, +0.18 per level; panji di sisi kanan model (Lv2 biru, Lv3 emas dua bendera).
- **Layar siang landscape (ditemukan saat QA pass ini):** pada ponsel miring (tinggi < 560 px) sheet bawah menyisakan dunia ±20 px; semua bubble berubah jadi pointer tepi dan (sebelum pass ini) bertumpuk di balik chip hint. Kini sheet + baris READY/NIGHT menjadi kolom kiri (lebar ≤ 380 px, kartu build ukuran portrait), dunia dan bubble di kanan, kamera siang membingkai target di tengah area dunia, dan pointer tepi kanan mulai di bawah pill resource. Portrait tidak berubah selain jarak sudut pointer (40 px). `manifest.webmanifest` tetap tidak diubah — keputusan orientasi masih milik user.

**Kontrak label QA (baru):** `survival:select:hunter`, `survival:UPGRADE HUNTER LV<n>`, `survival:UPGRADE <type> LV<n>` (type = `extractor`/`sawmill`/`shelter`), `survival:UPGRADE MAX` di level maksimum.

**Save:** `save.survival.buildingLevels` (per ruangan) dan `hunterLevel`, juga di snapshot malam. Save lama tanpa field ini dimuat sebagai Lv1. **Bug di versi awal implementasi (tertangkap test harness baru sebelum commit):** reload tengah malam dengan Hunter Lv2/3 meng-clamp HP tersimpan ke bar Lv1, sehingga Hunter kehilangan HP → `_restore` kini memasang `bloodMax` level Hunter sebelum membaca HP, dan perubahan bar mempertahankan HP absolut (test: reload tengah malam tetap 60/120).

**Tooling:** `survivalshots` dan capture FTUE `envqa` mem-pin tier kualitas teratas (ladder kualitas adaptif menurunkan resolusi shadow berdasarkan frame time wall-clock software WebGL — run tanpa pin memberi luma siang 108 vs 124 dan luma FTUE 63.1 vs 77.4 untuk frame yang sama, tergantung beban mesin); `survivalshots` menambah 6 capture progres (`prog-*`); `survival-balance` punya `--economy` (jejak tiap keputusan siang dengan dompet sebelum/sesudah) dan bot `hunter-builder`; bot `builder` kini memakai level (upgrade pump, Hunter bila terjangkau) dan tidak membangun Sawmill di hari terakhir.

**Belum dikerjakan (saat pass ini):** menara (bangunan yang bertarung), guard yang bisa terluka, cutaway/x-ray model penuh, penempatan model bangunan yang menghindari furnitur (pump Lv3 di ruang makan berdiri di atas meja — kandidat polish). *Menara dan penempatan model sudah dikerjakan di pass menara (bagian di atas).*

## Gap & bug pass 2026-10-15

Permintaan: *lanjutkan build, analisis gap dan bug.* Temuan berasal dari pembacaan kode, bot balance, probe browser (Chromium headless, 390×844 @2x, touch) dan screenshot. Semua di bawah sudah diperbaiki di kode; bukti ada di tabel QA.

**Bug gameplay yang ditemukan dan diperbaiki** (`src/game/survival.js`):
- **Gelombang 3 (dan sebagian gelombang 2) tidak pernah menyerang.** Index rank swarm dihitung global (`i + wave × total`), sehingga gelombang berikutnya mendapat posisi 300–450 px di depan pintu; body yang mengikuti flow field pintu lalu berputar di titik goal field dan tidak pernah sampai ke posisinya (`march` selamanya, 0 damage). Contoh terukur: 30 body di postern Night 3 berkumpul 114 px dari pintu, pintu 72 HP utuh sepanjang malam. Sekarang: rank dihitung per pintu (antre di belakang crowd yang ada), flow field hanya dipakai saat masih jauh (>200 px), sisanya jalan lurus ke posisi; hanya rank dalam 250 px yang mencakar pintu.
- **Rank tidak maju saat barisan depan mati** → kini `reslotCrowds()` mengisi slot depan dengan body terdekat di belakangnya (tiap 0.6 dtk). Formasi Survival diisi dari tengah ke luar dan selebar ±satu pintu, sehingga body yang mencakar memang terlihat dari celah pintu.
- **Siang memakai radius api sisa malam** (`oilBurned` tidak direset saat fajar): sheet menampilkan 980 tapi ruang yang bisa dibangun dihitung dari radius ±677 (hanya 2 slot). Fajar kini mengisi api penuh → 4 slot di Lv1, sesuai angka di sheet.
- **Flash pintu tidak pernah memudar di Survival** (loop legacy yang memudarkannya tidak berjalan) dan `restart()` tidak meresetnya → penanda "pintu diserang" basi tampil sepanjang malam / terbawa ke run baru.
- Rotasi pintu membuat malam makin *jauh* dari api (Night 3 = palisade/kitchen/postern, 2075–2509 px), sehingga gelombang terbesar tidak pernah sampai sebelum fajar. Kini rencana pintu per malam: N1 front/chapel/cellar, N2 cellar/dining/palisade, N3 chapel/palisade/front (+2 Breaker di front).
- Save malam tidak menyimpan `_inHouse`, `feedCd`, `staggerT`, `targetKind` → body yang sudah masuk berbalik ke pintunya setelah reload.

**Bug UI/perangkat yang ditemukan dan diperbaiki:**
- Pause tidak membekukan cooldown Flare, banner, dan angka damage (probe: 10 → 8 dtk selama pause 2 dtk).
- Area tap pause tak terlihat dan Esc aktif di panel akhir (kalah/menang) dan di popup reward fajar → kini `Game.survivalCanPause()` (malam, atau siang tanpa reward); tombol pause tidak digambar di bawah popup reward.
- Hit radius tombol Flare di HP 22 px padahal digambar 27.5 px (tap di tepi meleset). Survival kini punya layout sendiri (`Input.layoutSurvival`): satu tombol Flare besar (r 40 portrait / 36 landscape, hit = r + 4).
- Tombol serang merah redundan (auto-shot) → disembunyikan di Survival; tombol F keyboard tetap.
- Joystick hanya bisa dimulai di 50% kiri layar → stick mengambang di mana saja di bawah pita HUD atas (Survival saja; legacy tetap zona kiri).
- Simulasi berjalan saat dunia tidak tampil: saat boot malam berjalan sebelum rumah 3D muncul, dan saat WebGL context hilang malam maju 2 dtk di balik layar loading tanpa bisa di-pause. Kini malam dibekukan sampai `World3D.render` berhasil (node harness tidak terpengaruh).
- `uiIndex` keyboard di-clamp ke 99, bukan jumlah tombol.
- Chip FTUE siang menutupi bubble world → kini tepat di atas sheet. Banner di layar pendek (landscape) tidak lagi bertumpuk dengan chip FTUE.
- Mesh bolt 3D dibuat baru per tembakan dan hanya disembunyikan (scene graph tumbuh sepanjang sesi) → kini dipool per jenis.
- Karpet crimson/purple terbaca sebagai lubang gelap → Survival memakai `rose`/`violet` yang terang (legacy tidak berubah).

**Gap yang ditutup:**
- **Survivor kini punya peran (garnisun).** Siang: survivor berdiri sebagai pion 3D di sekitar Perapian (jumlah di HUD = orang yang terlihat). Malam: tiap survivor berjalan ke pintu dengan tekanan terbesar (maks 2 per pintu, sisanya menjaga api) dan menembak lewat celah pintu (10 dmg / 1.6 dtk, ×1.5 di cahaya). Guard tidak bisa diserang (kalah tetap = api padam / Hunter mati). Shelter = +1 guard (kartu Shelter menampilkan ikon guard). Counter malam Wood (tidak berguna di malam hari) diganti ikon guard.
- **Hunter bisa bertahan di pintu.** Pintu tertutup punya celah tembak: auto-target memakai LOS `throughDoors`, bolt Hunter dan guard menembus pintu tertutup (tidak merusaknya); jendela dan dinding tetap memblok; bolt kawan tidak mengenai Hunter. Aim-assist tidak lagi membelokkan tembakan ke musuh di balik dinding. Hint FTUE baru: guard & "GO TO THE DOOR".
- **Kamera:** framing berdasarkan sisi pendek layar; zoom malam 0.54 → 0.466 di portrait dan 0.72 → 0.466 di landscape (sebelumnya landscape lebih sempit dari portrait), siang ±0.40; kamera condong ke target yang sedang ditembak.
- **Perapian sebagai jangkar visual:** api unggun 3D (kayu, batu, tiga lapis api additive yang berkedip dan membesar per Lv), kolam cahaya panas di lantai, dan **bar bahan bakar di atas Perapian** (Oil = nyawa api).
- **Hunter tidak pernah dalam bahaya** (semua bot HP 100 di setiap malam karena musuh tidak bisa menyerang di cahaya) → cahaya kini *melemahkan* cakaran (×0.5), tidak memblokir. Ring Hunter (hijau) dan guard (biru) terlihat menembus dinding agar posisi tetap terbaca di pintu sisi selatan.

**Tuning yang berubah** (`src/core/config.js`, `src/game/survival.js`): radius Perapian 980/1760/2500 → **980/1560/2000** (Lv3 tidak lagi menerangi seluruh rumah); `lightMoveMul` 0.7 → **0.8**; `lightDamageTakenMul` 1.75 → **1.5**; `litAttackMul` **0.5** (baru); hearth burn Lv2/Lv3 14/28 → **8/14 dps** tanpa knock-back; swarm di dalam rumah 84 → **92 px/dtk** (+8%/malam); reward kill Oil/Wood kills/4, kills/3 → **kills/6, kills/4**.

**Gap yang masih terbuka (belum dikerjakan di pass ini):** progres Hunter (upgrade senjata/HP) dan level bangunan (Extractor/Sawmill/Shelter Lv2+) — *keduanya dikerjakan di pass berikutnya, lihat "Progres Hunter & level bangunan"*; bangunan yang bertarung (menara), guard yang bisa terluka/mati, dan cutaway/x-ray model penuh untuk unit di balik dinding selatan (saat ini hanya ring yang menembus dinding).

## Koreksi arah 2026-10-12 (feedback user)

Feedback: *UI/UX referensi tidak diterapkan; di referensi semua label berupa ikon dan feel loop-nya jelas; ruangan terlalu gelap sehingga tidak jelas ini game apa, dan gelap tidak cocok untuk kamera ini.* Keputusan yang dikonfirmasi user:

- **Referensi = gaya "Build by Day, Defend by Night"** (Duck Survival): siang membangun/upgrade base, malam bertahan dari gelombang zombie. UI terang, ikon besar, **label = ikon + angka** (bukan label teks), loop siang → malam → reward harus terasa jelas.
- **Tidak ada kartu skill roguelike "pilih 1 dari 3"**; fokus pada loop build/defend.
- **Ruangan harus terang dan terbaca.** Malam ditandai dengan tint dingin, bukan kegelapan.
- Threat: musuh mencari jalan dan **hanya melambat** di cahaya (tidak membeku); musuh yang mencapai Perapian **mencakar Oil**; kalah bila Hunter mati **atau api padam**. Gelombang ×3 (21/21/24 → 24/27/27 → 30/30/30). FTUE = chip hint kontekstual ringan, sekali tampil.

## Ringkasan keputusan dan batas scope

- Route default adalah **Survival**, langsung ke Night 1. Mode cerita/hunt lama tetap dapat diakses melalui `?legacy=1` atau `?mode=legacy`; jangan hapus tanpa keputusan eksplisit.
- Dunia tetap mansion 3D dengan satu scene WebGL dan kamera ortografis. Canvas digunakan untuk HUD/UI, bukan untuk menggambar ulang lantai, dinding, furnitur, atau aktor dunia.
- Survival memiliki save namespace sendiri (`save.survival`). Sistem hunt/narrative lama tetap ada untuk route legacy, bukan acceptance Survival M1.
- IAP/Play Billing di luar scope dan tidak diubah. Placeholder Digital Asset Links dan origin-trial token tetap menjadi blocker packaging yang memerlukan input release.
- Dokumen desain Markdown lama telah dikeluarkan dari worktree sesuai permintaan; file ini adalah roadmap rebuild yang dipelihara. Beberapa komentar di `src/shop/`, `server/`, dan bagian IAP di `src/ui/screens.js` masih menyebut dokumen lama karena subsistem itu sengaja tidak disentuh.

## Hasil audit repo dan cleanup

### Yang sudah dibersihkan

- Import mati di source app dan QA yang diperiksa: **0 temuan import tidak terpakai** pada pemindaian ESLint ad hoc terakhir.
- Dependensi dev yang tidak dipakai oleh skrip repo, `playwright` dan `fbx2gltf`, dihapus dari `tools/package.json` serta lockfile. Skrip QA memakai `puppeteer-core`; konversi asset lama tidak menjadi bagian runtime.
- `src/core/assets.js` yang tidak memiliki pemanggil di runtime/tools telah dihapus; assertion di `tools/glbtest.mjs` disesuaikan.
- Jalur render Canvas mansion yang sudah ditinggalkan oleh WebGL dihapus dari `src/game/mansion.js`: bake/floor/wall/furniture/entrance/lightmap painters beserta helper gambar yang hanya dipakai jalur itu. Pemanggilan `this.bake()` dan pembuatan canvas lantai juga dihapus. Data layout, collision, navigation, furniture, dan sumber cahaya yang dipakai scene 3D tetap ada.
- Painter Canvas `drawRoomMarks` dihapus; data `ROOM_MARKS` tetap digunakan oleh renderer 3D. `tools/layoutqa.mjs` dan `tools/glbtest.mjs` kini mengunci bahwa metode Mansion Canvas tersebut tidak kembali.
- Suffix kode rusak yang membuat Chromium gagal mem-parse `src/game/game.js` dan `src/ui/screens.js` ditemukan oleh browser QA lalu dibersihkan. Node syntax check dan browser QA setelah perbaikan lulus.
- Pemeriksaan graph import statis/dinamis: **38/38 modul JavaScript non-vendor di `src/` terjangkau dari `src/main.js`**. Ini bukan audit seluruh export atau seluruh script tools.

### Batas lint

Tidak ada konfigurasi lint proyek/root `package.json`. Scan ad hoc `no-unused-vars` terakhir melaporkan 138 nama lokal/parameter/variabel yang perlu audit terpisah; sebagian adalah parameter API/handler dan tidak otomatis merupakan kode mati. **Jangan** menafsirkan hasil ini sebagai full-lint pass. Yang terkonfirmasi dari scan tersebut: unused-import = 0.

## Implementasi koreksi 2026-10-12

**Pencahayaan / readability** (`src/game/world3d.js`, `src/game/lightbake.js`, `src/game/envkit.js`):
- Rig cahaya khusus Survival (exposure/hemi/key/rim) dan profil bake `SURVIVAL_BAKE`: lantai minimum 0.8 dengan tint dingin di malam hari, 1.0 hangat di siang hari; key cache bake memuat fase. Route legacy tetap memakai rig/bake lama.
- Halaman rumput (yard), kolam cahaya Perapian (additive), ring radius emas yang lebih terang, ring hijau di bawah Hunter, palet hutan dinaikkan (mahkota pohon sebelumnya nyaris hitam), karpet library `dark` → `crimson` (sebelumnya terbaca sebagai lubang hitam).
- Kamera siang zoom-out 0.8 dan membingkai target build yang dipilih di atas bottom sheet (`Renderer.setZoomMul`).

**UI icon-first** (`src/ui/survivalIcons.js` baru, `src/ui/survival.js` ditulis ulang):
- Set ±40 ikon kartun digambar dengan path canvas (tanpa asset baru; byte asset berlisensi tidak disentuh): oil, wood, survivor, api, bulan/matahari, tengkorak, palu, gate, oil pump, sawmill, shelter, Perapian, breaker, pintu/pintu jebol, flare, dll.
- **Night HUD:** pill bulan (NIGHT n + timer) dengan timeline gelombang (pip swarm/breaker → matahari = fajar); counter Oil/Wood/musuh; badge Perapian (Lv + ring kekuatan api, berkedip merah saat dicakar); HP bar Hunter dan musuh di world; angka damage melayang (kuning = bonus cahaya); banner `NIGHT n`, `WAVE n/3`, `BREAKER!`, `BREACH!`, `PROTECT THE FIRE!`, `FIRE LOW!`; penanda tepi layar untuk pintu yang diserang/jebol dan Perapian yang dicakar.
- **Siang:** pill matahari `DAY n`; counter + tag cadangan Oil malam ini; bubble di world (Perapian Lv + panah upgrade, gate, slot `+` di ruang terang, bangunan, job dengan ring progres); bottom sheet berisi kartu ikon (output/dawn + biaya, merah bila kurang, oranye bila memakan cadangan); pill builder (palu + progres); tombol besar `NIGHT n`.
- **Popup fajar:** "NIGHT n SURVIVED!" dengan kill, +Oil, +Wood, survivor, Oil yang dicakar → `COLLECT`.
- Panel pause/gagal/menang berbasis ikon; kontrol sentuh Survival (joystick, tombol Flare oranye dengan cooldown radial, tombol tembak).
- **FTUE:** 6 chip hint sekali tampil (move, auto-shot, firelight, guard Perapian, Flare, build), auto-hide, disimpan di `save.survival.hints`. Tidak ada tombol tambahan. Night HUD tetap hanya mendaftarkan `PAUSE` sebagai target tap.

**Threat / gameplay** (`src/game/survival.js`, `src/game/mansion.js`, `src/core/config.js`):
- **Bug collision pintu diperbaiki:** `Mansion.resolve` memperlakukan x/y pintu sebagai pojok, padahal pintu diauthor dari titik tengah, sehingga setengah kiri/atas pintu tertutup bisa dilewati.
- Nav refresh lokal saat pintu jebol (`refreshNavAround`, `navVersion`); **flow field BFS** (Perapian, Hunter, jalur tiap pintu) menggantikan steering lurus; status "di dalam rumah" stabil di ambang pintu interior.
- Cahaya hanya memperlambat (`lightMoveMul` 0.46 → 0.7); freeze "stagger" karena cahaya dihapus. Siege di cahaya = 50% (sebelumnya dibatalkan total).
- Musuh di Perapian mencakar Oil tiap 1.5 dtk (swarm −1, individual −3, breaker −6). **Oil 0 di malam hari = kalah ("THE FIRE WENT OUT").** Perapian Lv2/Lv3 membakar musuh di dekatnya (14/28 dps).
- Gelombang 66/78/90 per malam (clamp 20 dihapus, cap 30/gelombang); pacing 4%/30%/56% malam; Breaker 20%/50%; Breaker pindah ke pintu utuh berikutnya lalu ke Perapian; gelombang berotasi pintu per malam; pintu diperbaiki saat fajar.
- Belanja siang tidak boleh memakai cadangan Oil malam (burn + 8); reward Oil malam 14/16/18.

## Implementasi Survival M1 yang ada

- **Loop:** tiga malam dengan fase day/night, reward malam, builder queue, save/checkpoint `day`/`phase`, serta keadaan akhir complete/failed.
- **Ekonomi/building:** Oil dan Wood; Oil Pump (extractor), Sawmill, Shelter, Menara crossbow Lv1–3, gate, upgrade Perapian sampai Lv3, dan jalur Hunter Lv1–3. Queue hanya mengerjakan satu job pada satu waktu (bangun, upgrade, atau latihan Hunter). Pump mengisi Oil selama malam, Sawmill membayar Wood saat fajar + HP pintu, Shelter langsung menambah survivor/guard; reward malam + kill menambah resource.
- **Perapian/cahaya:** radius dasar bertingkat di tuning (Lv1 980, Lv2 1560, Lv3 2000 world px; menyusut sampai −34% saat Oil terbakar malam itu, penuh lagi saat fajar). Di cahaya Perapian, musuh melambat (`lightMoveMul = 0.8`), lebih mudah dilukai (`lightDamageTakenMul = 1.5`), cakarannya melemah (`litAttackMul = 0.5`, tidak diblokir), dan damage ke pintu menjadi 50%.
- **Defense:** gelombang Swarm 21/21/24, 24/27/27, 30/30/30 (aktual = diminta; 66/78/90 per malam), HP Swarm 48→54→60, Breaker 0/1/2, dua Individual per malam. Hunter punya auto-shot (menembus celah pintu tertutup) dan skill Flare dengan radius/damage/stagger/cooldown. Survivor = guard pintu (lihat pass 2026-10-15). Menara crossbow menjaga pintu luar ruangannya sendiri (lihat "Menara crossbow").
- **HUD:** lihat "UI icon-first" di atas. Coach/narrative legacy disembunyikan.

## QA yang benar-benar dijalankan (2026-10-15)

| Perintah | Hasil | Batas hasil |
|---|---|---|
| `node tools/harness.mjs` | **PASS**, exit 0. Gelombang 66/78/90 (tanpa clamp), HP 48→54→60, Breaker 0/1/2. Cahaya: damage 15.0 vs 10.0, jalan breached 60.1 vs 90.9 px/dtk, cakaran lit ×0.5 (melemah, tidak diblokir). Pintu tertutup memblok di 5 titik; damage pintu lit 10 vs dark 20; breach → Perapian dalam 17.6 dtk, mencakar 3 Oil → `failed (THE FIRE WENT OUT)`; Breaker frontDoor → cellarDoor → perapian; gerak 4 arah; auto-shot (LOS stub & nyata); Flare 500→442. **Baru (regresi pass ini):** gelombang 3 (30 body) di postern: 30 menekan, pintu 72 HP jebol < 10 dtk, rank depan index 0; rank maju setelah barisan depan mati (83 → 78 px dari pintu); Hunter menembak lewat celah pintu tertutup (LOS biasa terblok; body 400 → 244 HP; pintu tetap tertutup); 2 guard berjaga di frontDoor, 18 tembakan, 3 kill dengan tembakan Hunter dimatikan; bolt guard tidak melukai Hunter (100 → 100); pause membekukan cooldown Flare (10 → 10, lalu 9.00 setelah 1 dtk) dan jam; tidak ada pause di panel akhir/popup reward, ada di siang; radius siang setelah fajar 980/980; reload menjaga `_inHouse` dan membangun ulang guard. Save/reload Day 2 tetap PASS. **Pass progres (29 baris PASS):** ekonomi kini survivor 3 *saat* Shelter selesai, pump Lv1 memompa 6.00 Oil semalam (dompet −2.40 setelah api membakar 8.40), fajar +14 Oil / +21 Wood (dulu +20 Oil karena extractor membayar saat fajar); level bangunan lewat satu builder (biaya Lv2 4/12, Lv3 6/16; build/Hunter/upgrade lain ditolak selama job berjalan; Lv3 = cap); pump Lv3 memompa 14.00 Oil semalam dan tidak ada pembelian di malam hari; Shelter Lv1/2/3 = survivor 2 → 3 → 4 → 5 dan 5 guard; papan Sawmill Lv1/Lv2 = HP maks pintu luar 130 → 143 → 156 (dst., penuh di siang hari); Hunter Lv2 = bolt 32 lewat `playerAttackHit`, HP 120/120 setelah latihan; save/reload menjaga level bangunan + Hunter, save lama → Lv1, reload tengah malam menjaga HP 60/120. **Balance harness:** idle gagal Night 2 (api padam); builder aktif menang Night 3 (Flare ×5, Lv3; sebelumnya ×6 — Shelter Day 3 kini langsung menambah guard). **Pass menara (36 baris PASS, exit 0; `qa-evidence/survival-towers/harness-survival.txt`):** menara dibangun lewat satu builder di hall (bayar 4/16) dan berdiri di (212, 483), 187 px dari frontDoor (conservatory tanpa pintu luar: dekat tengah ruangan); siang 0 tembakan, malam menembak lewat celah pintu tertutup dengan tembakan Hunter dan guard dimatikan (2 tembakan, body 999 → 967 = 2×16, bolt pierce 1 / jatuh di 640); satu bolt menembus 2 body sebaris (983/983) dan tidak mengenai body ke-3 (999); body dalam jangkauan di balik dinding (ruang makan, tanpa LOS) tidak ditembak (3 → 3 tembakan); Lv2 22/580, Lv3 30/640 (biaya 6/18, 8/22), bolt Lv3 mendarat 30; save/reload menjaga menara Lv3 di titik yang sama; **regresi baru:** bolt Hunter dan guard tetap range 0 / pierce 0. | Bot deterministik, bukan pemain manusia. Durasi malam uji 60 dtk. Bagian bot legacy di harness kini berakhir `death` karena urutan ID/RNG global ikut bergeser oleh probe Survival baru; dengan battery Survival dilewati, output bot legacy **identik byte-per-byte** dengan commit `b648f64` (dawn 300 dtk) — logika legacy tidak berubah. |
| `node tools/survival-balance.mjs --seeds=3 --duration=72 --bots=…,hunter-builder,tower-builder [--economy]` | Pengukuran, bukan gate. **Pass menara** (`qa-evidence/survival-towers/balance.txt`): `tower-builder` baru **3/3** (3 menara Lv1 + Perapian Lv3; menara menembak 59–60× di Night 2, 77–94× di Night 3; Night 3 puncak 61 musuh hidup, 0 mencapai api, HP 100/100); bot lain identik dengan baseline `4423076` (dicek dengan worktree baseline untuk `hunter-builder`). Pass progres (`qa-evidence/survival-progression/balance.txt`): idle 0/3 (gagal Night 1 ±64 dtk); passive-builder 0/3 (Night 1); flare-only 0/3 (gagal Night 2); active tanpa build 0/3 (gagal Night 3 ±62 dtk); **fire-builder (hanya Perapian) 3/3**; builder 3/3 dengan rencana baru (Day 2: Perapian Lv2, pump, gate, Sawmill; Day 3: Perapian Lv3, pump Lv2, Shelter; Hunter Lv2 tertolak cadangan Oil 32 → 18 < 19); Night 3: 7–8 musuh mencapai api, Oil tercakar 0, HP 100/100. **hunter-builder baru 1/3:** Hunter Lv3 + Perapian Lv2 → api padam di 70.9–71.2 dtk dari 72 (Oil masuk malam = 19, cakaran 10); seed yang tidak mampu Hunter Lv3 membeli Perapian Lv3 dan menang. Artinya investasi tempur saja tidak menyelamatkan api. Gap-pass sebelumnya: semua hasil menang/kalah sama untuk bot lama. | Bot sempurna/deterministik; seed hanya mengubah jitter spawn. Builder memeluk api masih tanpa kehilangan HP — perlu playtest manusia. |
| `node tools/survival-devqa.mjs` | **15/15 PASS** (pass menara, kode final, `qa-evidence/survival-towers/devqa.json`): 13 cek lama tetap PASS, plus **2 cek menara baru** — model menara di titiknya (212, 483) dan ring jangkauan merah r 520 saat dipilih di siang hari; malam dengan 21 body di frontDoor: 13 tembakan menara dalam 15 dtk, ballista menghadap bidikannya (selisih 0 rad), 1 objek bolt menara di scene (pool), ring tersembunyi di malam hari. Run pass progres: **13/13 PASS** (301 dtk, `qa-evidence/survival-progression/devqa.json`): jam malam menunggu rumah 3D (0.08 dtk saat dunia tampil); stick mulai di kiri (94 px) dan kanan (72 px), pita HUD diabaikan; satu tombol Flare (r 40, hit 44), tap di tepi gambar menembak; pause 2 dtk → cooldown tetap 10; tab tersembunyi → pause; context loss → malam beku (0 dtk), restore lanjut; 2 pion guard 3D = 2 survivor; 20 dtk malam dengan render tiap 0.25 dtk: 24 tembakan → 4 objek bolt di scene (pool dipakai ulang); panel akhir tanpa pause; zoom malam portrait 0.466 = landscape 0.466; reload tengah malam 23.08 → 23.16 dtk, musuh 35 → 35; 0 page error / console error / request gagal. | Chromium headless + software WebGL dengan touch emulasi, bukan perangkat fisik. Satu run ±6 menit. |
| `node tools/envqa.mjs --mode=3d-smoke` | **PASS**, exit 0, 40 assertion, page errors 0 (diulang di kode final pass menara: Swarm 0/21/36 pada 0.2/15/30 dtk, 14 GLB + 22 silhouette, hanya `PAUSE`, luma Night 1 79.3/255 dengan 7.8% near-black, radius 980 → 1560; capture `qa-evidence/survival-ftue-*.png` ikut diperbarui). Run pass progres (274 dtk): FTUE: Swarm 0/21/35 pada 0.2/15/30 dtk, 14 GLB + 21 silhouette, tap target malam hanya `PAUSE`; luma playfield Night 1 **77.1/255, 10.2% near-black** dengan tier kualitas di-pin (run tanpa pin di mesin yang sama: 63.1/11.5% — selisihnya resolusi shadow dari ladder adaptif, bukan perubahan scene); radius 980 → 1560 lewat tombol `UPGRADE`. | Chromium headless/software WebGL. |
| `node tools/survivalshots.mjs --tag=tow1` dan `--tag=tow1l --landscape`; `--towers-only --tag=tow2` / `tow2l` | Pass menara: 18 shot per orientasi (16 lama + 2 menara), 0 page error, kualitas di-pin ke 3. Portrait: malam 73.9/78.1/81.6 (near-black 9.6/9.2/7.9%), `day-panel` 124.5; landscape: malam 73.2/72.4/68.5. Menara lewat UI nyata (slot hall → kartu `TOWER` → selesai → bubble): `tower-day` 117.7 portrait / 110.1 landscape, ring terlihat, `UPGRADE tower LV2`; `tower-night` (Night 2, Lv2 lewat tombol UI, 21 dtk): 3 tembakan menara, bolt sedang terbang ke Breaker di frontDoor, luma 62.5–66.2 (near-black ±16%, setara `night-door`). Dua shot menara diulang dengan `--towers-only` setelah posisi parkir Hunter diubah (hanya tooling; kode game sama). Bukti `qa-evidence/survival-towers/`. | Screenshot headless, bukan review perangkat. |
| `node tools/survivalshots.mjs --tag=prog4` dan `--tag=prog4-land --landscape` | 16 shot per orientasi (10 lama + 6 progres), 0 page error, tier kualitas di-pin ke 3 (tercatat per shot). Portrait: malam 74.7–79.5 (near-black 9–10%) pada 0/20/40 dtk, `day-panel` 123.3, `prog-hunter` 127.1, `prog-levels` 117.2, `prog-night` 81.1. Landscape: malam 68.7–73.1, siang 105–143. State progres: reward Day 3 `pumped 6`, upgrade pump berjalan 3.5/6 dtk tanpa panah di bubble-nya, Hunter Lv2 120/120 di malam, pump Lv3 + Sawmill Lv2 + panji. Bukti `qa-evidence/survival-progression/`. | Luma pass ini (di-pin) tidak sebanding langsung dengan angka gap-pass yang tidak di-pin. Screenshot headless, bukan review perangkat. |
| `node tools/layoutqa.mjs` | **PASS**, exit 0 (diulang di kode final pass menara). | Overlap staircase–stairRail ±150×20 px masih tercatat (audit, bukan gate). |
| `node tools/glbtest.mjs` | **PASS**, exit 0 (diulang di kode final pass menara). | Validasi asset/kode statis. |
| `node --check` seluruh `src/**/*.js` & `tools/*.mjs`; `git diff --check` | **PASS** (70 file, pass menara). | Sintaks/diff saja. |
| `npm audit --prefix tools` | **PASS**, 0 vulnerability (diulang di pass menara). | — |
| `node tools/bundle.mjs check` | **FAIL** (tidak berubah): fingerprint SHA-256 Digital Asset Links masih placeholder; WARN token origin-trial Digital Goods. | Butuh kredensial/konfigurasi release; IAP di luar scope. `manifest.webmanifest` masih `orientation: landscape`; UI Survival dirancang portrait-first dan sejak pass progres punya layout siang landscape (kolom kiri) — orientasi rilis tetap perlu keputusan produk. |

**Build:** repo tidak memiliki `package.json` root atau script `npm run build`. Dependensi QA dipasang dengan `npm ci --prefix tools`; pemeriksaan bundle di atas bukan build Android/AAB yang sukses. Jangan menyebut paket release selesai.

## Bukti visual

- `qa-evidence/survival-ftue-00s.png`, `-15s.png`, `-30s.png`, `survival-ftue-first-30s.json` (envqa; viewport 390×844 @2x; diperbarui 2026-10-15 pada pass progres, kualitas di-pin).
- `qa-evidence/survival-gap-pass/` (2026-10-15, diperkecil 50%): `before-night-20s.png` vs `after-night-20s.png` (kamera lebih lebar, api unggun + bar bahan bakar, satu tombol Flare, counter guard, karpet terang), `after-night-door.png` (bertahan di pintu: ring Hunter/guard menembus dinding, crowd di luar pintu), `before-day-panel.png` (2 slot) vs `after-day-panel.png` (4 slot, survivor terlihat di dekat api, chip FTUE di atas sheet), `after-day-select.png` (kartu Shelter = +1 guard), `after-night2.png` (Night 2: Flare cooldown 14, bar bahan bakar api, penanda pintu yang dikepung), `before-landscape-night.png` vs `after-landscape-night-40s.png` / `after-landscape-night-door.png`, metrik `after-metrics.json` / `after-landscape-metrics.json`, `devqa.json`, `balance-before.txt` / `balance-after.txt`.
- `qa-evidence/survival-progression/` (pass progres 2026-10-15, diperkecil 50%, kualitas di-pin): `day-panel.png` (bubble Hunter di samping Perapian, pointer tepi tidak bertumpuk), `prog-reward.png` (baris pompa `+6` di popup fajar), `prog-built.png` (sheet pump `Lv1 → Lv2`, `+6 → +10`), `prog-upgrading.png` (ring progres, panah disembunyikan, NIGHT terkunci), `prog-hunter.png` (sheet Hunter `26 → 32`, `100 → 120`), `prog-levels.png` (pump Lv3 MAX `+14`, panji emas, Shelter terlihat di bawah bubble), `prog-night.png` (Hunter Lv2 120/120 di malam). Landscape: `before-land-day-panel.png` (kode lama: bubble bertumpuk di balik chip hint) vs `land-day-panel.png`, `land-day-select.png` (kartu build di kolom kiri), `land-prog-hunter.png`, `land-prog-levels.png`. Data: `metrics.json`, `land-metrics.json`, `balance.txt` (dengan jejak `--economy`), `harness-survival.txt`, `devqa.json`.
- `qa-evidence/survival-towers/` (pass menara 2026-10-15, diperkecil 50%, kualitas di-pin): `day-select.png` (4 kartu build: pump/sawmill/shelter/**tower**), `tower-day.png` (sheet menara `16 → 22`, `520 → 580`, ring jangkauan merah), `tower-night.png` (Night 2: menara Lv2 berpanji biru menembak ke frontDoor), `prog-levels.png` (pump Lv3 kini di lantai kosong di samping meja makan — bandingkan `survival-progression/prog-levels.png` yang berdiri di atas meja), landscape `land-day-select.png`, `land-tower-day.png` (ring terlihat penuh), `land-tower-night.png`. Data: `metrics.json` / `land-metrics.json` (run penuh 18 shot), `towers-metrics.json` / `land-towers-metrics.json` (run `--towers-only`), `balance.txt`, `harness-survival.txt`, `devqa.json`.
- `qa-evidence/survival-rebuild/` — before/after koreksi 2026-10-12 (gelap → terang, UI teks → ikon).

Ini screenshot checkpoint, bukan rekaman, dan bukan review di perangkat fisik.

## Acceptance yang masih terbuka

1. **FTUE/readability:** dunia kini terang dan terbaca di screenshot headless (luma diassert di envqa), UI berbasis ikon, chip hint kontekstual ada. Belum: review di perangkat nyata, uji pemahaman pemain baru, rekaman 30 detik.
2. **Combat Survival manual:** bot menggerakkan stick virtual dan Flare melalui Input; devqa kini mengetes stick mengambang, hit tombol Flare, dan pause lewat touch emulasi. Walkthrough manusia (gerak, bertahan di pintu, Flare, mempertahankan Perapian) belum dilakukan.
3. **Light weakness:** damage musuh ×1.5, perlambatan ×0.8 (tanpa freeze), cakaran lit ×0.5 (tidak lagi diblokir) dan damage pintu lit 50% diassert. Rasa/feel di perangkat belum dinilai.
4. **Balance/progression:** target bot terpenuhi (idle/flare/active-tanpa-build kalah; upgrade Perapian saja sudah cukup menang 3/3; builder 3/3). Progres kini ada (level bangunan Lv1–3 + jalur Hunter Lv1–3, diassert harness) dan bot `hunter-builder` menunjukkan trade-off nyata (Hunter Lv3 dengan Perapian Lv2 kalah 2/3 karena api padam di detik ±71). Menara (pass menara) menambah strategi menang ketiga: `tower-builder` 3/3 dengan Night 3 paling bersih (puncak 61 musuh, 0 mencapai api) — kuat, tetapi tidak mengubah peta menang/kalah. Masih terbuka: bot builder yang memeluk api tetap tidak kehilangan HP (100/100) dan tidak tercakar di Night 3; cadangan Oil 19 membuat pilihan Day 3 sangat ketat (Perapian Lv3 18 + Hunter Lv2 14 = 32 kurang 1 Oil) — biaya sengaja tidak diubah tanpa playtest manusia; rasa progres (apakah upgrade terasa) belum dinilai di perangkat.
5. **Visual pass:** sweep 17 stop per ruang/wing, state low-health/blackout, dan overlap staircase–stairRail belum selesai. Pohon siang tampak agak pucat (palet dinaikkan untuk readability) — kandidat polish.
6. **Perangkat/performa:** hidden-tab pause, context-loss freeze/restore, reload tengah malam, dan framing landscape kini diassert di Chromium headless (devqa). Belum: frame time 66–90 musuh + guard/bolt di perangkat low-end, DPR nyata, keputusan orientasi (manifest masih landscape; UI Survival kini punya layout siang portrait dan landscape, tetapi orientasi utama untuk rilis belum diputuskan user).
7. **Release bundle:** fingerprint signing SHA-256, token origin-trial, validasi Bubblewrap/AAB, uji TWA/Play tetap menunggu konfigurasi release. IAP tidak diubah.

## Aturan laporan

- Laporkan implementasi dan acceptance terpisah. PASS di atas hanya PASS untuk assertion perintah terkait.
- Jangan menyebut rebuild/M1 “selesai” atau “siap rilis” sampai acceptance terbuka diverifikasi dan packaging punya bukti sendiri.
- Pertahankan `?legacy=1` sebagai akses QA/komparasi. Hapus legacy route atau sistem lama hanya dengan keputusan scope eksplisit.
- Pertahankan pipeline WebGL mansion/lampu serta provenance asset; jangan re-export atau mengubah byte sumber berlisensi tanpa izin.
