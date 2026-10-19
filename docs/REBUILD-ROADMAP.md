# Status Rebuild 3D & Survival Milestone 1

**Pembaruan:** 2026-10-19 (Asia/Makassar), BUILD 19
**Status keseluruhan: MASIH TERBUKA — bukan klaim siap rilis.** Inti rebuild dunia 3D dan loop Survival Milestone 1 sudah terimplementasi. Pada 2026-10-12 arah UI/UX dan threat model dikoreksi mengikuti feedback user; pada 2026-10-15 dilakukan pass analisis gap & bug (lihat bagian "Gap & bug pass 2026-10-15"), lalu pass progres Hunter + level bangunan (lihat "Progres Hunter & level bangunan"), lalu pass menara crossbow (lihat "Menara crossbow"), lalu pass guard yang bisa jatuh (lihat "Guard bisa jatuh"; termasuk perbaikan bug gelombang yang muncul di dalam rumah), dan seluruh gate otomatis dijalankan ulang. Setelah itu user memutuskan **game landscape only** dan meminta brainstorming + design system plan sebelum koding lagi (lihat "Arah desain & orientasi" dan `docs/DESIGN-SYSTEM-PLAN.md`; belum ada perubahan kode game untuk arah ini). Revisi 1 desain (konsep api) ditolak user. Di revisi 2 user memilih konsep **K1 "Benteng Terakhir"**, pola build **jalan ke lingkaran + BUILD**, dan nada **dark stylized**, lalu menyetujui semua rekomendasi aturan dan meminta "pastikan dunianya 3D". K1 kini **terimplementasi sebagai vertical slice** (lihat "K1 Benteng Terakhir — implementasi"); acceptance manusia/perangkat untuk K1 belum ada. Atas feedback user berikutnya, Survival kini dimainkan di **dunia benteng (bailey)** baru, bukan di dalam ruangan mansion (lihat "Dunia benteng untuk Survival"). Setelah itu kedua bookend cerita K1 dibuat: **intro sinematik** di malam pertama dan **adegan bala bantuan tiba** di fajar ke-3 (lihat "Bookend K1"); pemahaman pemain atas keduanya belum diuji. Lalu dibuat **riset UX & replay** dari review pemain (Play Store, Steam, Reddit, dan platform review lain) plus playtest bot "sebagai gamer" (lihat "Riset UX & replay" dan `docs/UX-REPLAY-RESEARCH.md`). Riset itu lalu diperdalam atas permintaan user agar tidak ada coding: v2 menambah review bintang 5, persona, peta perjalanan, dan protokol playtest; v3 menambah pemain Indonesia, analisis loop 3 lapis, dan uji HP kelas bawah. Setelah itu, atas feedback user, dibuat pass perbaikan: benteng diperkecil dan aktor diperbesar, pasukan memakai GLB (KayKit Knight, CC0), efek tembakan/damage diperkuat, kerja bangunan dibuat terlihat, dan UI dirapikan (NIGHT dipisah dari BUILD, panel fajar/akhir menghitung kontribusi). Dari rekomendasi riset, yang terbangun baru R1 sebagian, R18a, dan R19 (lihat "Perbaikan dari feedback user"). Lalu pesan "next" berikutnya dikerjakan sebagai P0 riset **"Momen akhir run"**: bintang 1–3, rekor + NEW BEST!, panel kalah "Ns TO DAWN" + satu tip dari penyebab nyata, dan MVP bangunan (R1–R4, R19; lihat "Momen akhir run"). R5 dan R6 belum. Lalu user melapor "tidak ada perubahan" (2026-10-17): dibuat **pass visual besar** — build yang benar sampai ke layar (service worker hanya di host rilis, preview tanpa cache, stempel BUILD 8), bailey setengah ukuran dengan aktor ×1,6 dan kamera lebih dekat, seluruh horde monster GLB (vertex animation texture), knight dimuat saat boot dengan helm biru berjambul, efek tembakan/damage lebih besar, ballista yang membunuh dan menandai kill-nya, koin mine di HUD, dan penanda gerbang dengan jumlah musuh (lihat "Pass visual besar"). Lalu user meminta lima perbaikan lagi (2026-10-17, "ada beberapa masih perlu di fix"): kamera dijauhkan sedikit dan bisa digeser, plot bangunan ditata rapi, bangunan memakai aset gratis yang diunduh (bukan prototipe), kartu diperkecil, dan trailer pembuka dipertahankan. Kelimanya terimplementasi di **BUILD 9** (lihat "Pass perbaikan BUILD 9"). Lalu user meminta gambar karakter manusia yang cerah dengan senjata terpisah (folder `ASSET_CHARACTER`, gambar konsep AI atas permintaan user) dan aturan gerbang yang benar. Di **BUILD 10** gerbang tertutup menahan tembakan, gerbang hanya terbuka untuk kapten, dan untuk melawan, kapten keluar ke mulut gerbang atau ke luar benteng (lihat "Pass BUILD 10"). Lalu user melapor kapten berjalan sendiri keluar benteng dan bailey terlihat terlalu padat. Di **BUILD 11** kapten tidak lagi digerakkan apa pun selain stick, gerbang hanya terbuka untuk arah stick, setiap jenis bangunan punya warna sendiri, plot terkunci dan tiang hantu disembunyikan, dan props dikurangi (lihat "Pass BUILD 11"). Lalu user melapor ukuran world dan tata letak bangunan masih sama, dan meminta riset visual dan UI/UX game sejenis tanpa coding. Riset itu ada di `docs/VISUAL-LAYOUT-RESEARCH.md` (lihat "Riset visual & tata letak"). User lalu memilih **Opsi B**, meminta peta Rise of Kingdoms dicek dulu, dan meminta kamera yang bisa diperbesar, diperkecil, dan digeser. Ketiganya dikerjakan di **BUILD 12**: bailey ×1,6 dengan distrik per fungsi dan plaza Keep, plus kamera dinamis (lihat "Pass BUILD 12"). Lalu user menulis "lanjut": 7 senjata `ASSET_CHARACTER` yang tersisa dibuat (kini 18/18), dan empat usulan "murah tapi terlihat jelas" dari riset §7 dikerjakan di **BUILD 13**: kapten terang (V8), label hanya saat dekat (V4), angka damage kecil yang digabung (V9), dan gerbang malam ini terlihat di siang hari (V10) (lihat "Pass BUILD 13"). Lalu user menulis "next": di **BUILD 14** senjata pasukan bisa di-upgrade. Ada rak senjata baru di samping armory dengan 3 level crossbow guard, yang terlihat di tangan setiap guard dan di warna bautnya. Pass ini juga memperbaiki bug lama: crossbow guard tidak pernah terpasang di tangan (lihat "Pass BUILD 14"). Lalu user menulis "next" lagi: di **BUILD 15** pertarungan malam dibuat terlihat utuh (V6 + V7 riset). Kamera malam condong ke gerombolan, pohon di kill zone depan gerbang ditebang jadi tunggul, menara di sisi dekat kamera direndahkan, dan kapten tampil sebagai siluet biru saat tertutup (lihat "Pass BUILD 15"). Lalu user menulis "next" lagi: di **BUILD 16** tempo malam diperbaiki (R5 + R6 riset UX). Malam yang dibersihkan kini berakhir lebih cepat dengan bonus emas, sisa gerombolan yang tidak sedang bertarung lari ke hutan, dan setiap gelombang dipanggil dengan nama gerbangnya dan terompet. Pass ini juga memperbaiki panah tepi malam di HP landscape, yang kini berada di bingkai area main, bukan di dekat kepala kapten (lihat "Pass BUILD 16"). Lalu user menulis "SCRARY NIGHT DEV next . read code base dan beberapa doc": setelah membaca basis kode dan doc, item terbuka berikutnya dikerjakan — **R8**: ronde gerbang berseed per run (malam 2 punya 4 urutan, malam 3 punya 3, malam 1 tetap demi FTUE) dan chip TONIGHT yang mengumumkan urutan gerbang + isi malam di senja, dengan dua batas malam 3 yang lahir dari pengukuran balance (lihat "Pass BUILD 17"). Lalu pesan yang sama dikerjakan lagi: item terbuka berikutnya dari riset adalah sisa **R18** — NIGHT anti-salah-ketuk opsi (b)+(c): chip NIGHT kini harus **ditekan-tahan** dengan cincin yang mengisi, dan selama cincin mengisi chip menyebut emas yang belum terbelanjakan (lihat "Pass BUILD 18"). Pesan yang sama lalu dikerjakan lagi sebagai **R9**: jalur unlock yang terlihat di panel akhir — total bintang semua run membuka tangga warna tabard kapten, dan setiap panel akhir (menang atau kalah) menyebut warna berikutnya dan sisa bintang ke sana (lihat "Pass BUILD 19"). Setelah itu user meminta **bundle ke AAB/APK untuk listing Play Store**: kunci upload dibuat sekali, fingerprint SHA-256-nya masuk asset links dan twa-manifest, `bundlecheck` hijau penuh, pack listing (teks + screenshot 16:9 + feature graphic) dan workflow build di runner disiapkan — tetapi sandbox ini tidak punya JDK/Android SDK dan tidak bisa reach repo Google, jadi **binary AAB/APK-nya sendiri belum terbentuk**; caranya ada di "Pass packaging Play" dan `play-listing/LISTING.md`. Acceptance visual/manual di perangkat dan playtest manusia masih terbuka. Hasil tiap skrip hanya berlaku untuk cakupan yang benar-benar diuji.

## Pass packaging Play — kunci upload, fingerprint, listing (2026-10-19)

**Pesan user:** "sekarang lanjut bundle ke abb dan apk untuk list di playstore". Pass ini menyiapkan semua yang dibutuhkan Play Console selain binary-nya, dan menyebut tepat di mana binary itu harus dibentuk.

### Yang selesai di repo

**1. Kunci upload dibuat sekali (selamanya).** `android/duskhold-upload.jks` (PKCS12, RSA 2048, valid 10.000 hari, CN=DUSKHOLD/O=duskhold.zyvrolabs.com/C=ID) + passwordnya di `android/signing.local.json` — keduanya **di luar git** (`.gitignore`), dan di sandbox ini dipindah ke `/home/user/duskhold-keys/` supaya workspace repo bersih. **Backup keduanya di luar git adalah syarat mutlak**: kehilangan password = kehilangan kemampuan update aplikasi. Fingerprint SHA-256 cert-nya (`android/upload-fingerprint.txt`) kini masuk `android/twa-manifest.json` dan `.well-known/assetlinks.json`, jadi cek "fingerprint asli, bukan placeholder" lulus; `bundle.mjs prepare` tidak lagi menghapus fingerprint saat menulis ulang manifest.

**2. `node tools/bundle.mjs check` hijau penuh** (sebelumnya 2 FAIL placeholder fingerprint). Satu WARN tetap: **origin-trial token Digital Goods** harus ditempel pemilik di `index.html` setelah mendaftar origin trial di Console — tanpa itu shop tidak menerima uang lewat Play Billing. `bundlecheck` juga kini git-aware: kunci yang ada lokal tapi ignored = PASS, kunci yang TRACKED = FAIL.

**3. Konfigurasi dikunci sesuai keputusan lama:** `orientation` di `bundle.config.json` diperbaiki `portrait` → **landscape** (game landscape-only; manifest yang terkirim sudah landscape, jadi ini menutup regressi saat `prepare` dijalankan ulang). packageId `com.zyvrolabs.duskhold`, version 1.0.0/1, host `duskhold.zyvrolabs.com` tidak berubah.

**4. Pack listing** di `play-listing/`: `LISTING.md` (judul, short description 79 karakter, full description, kategori, isi data-safety, urutan rollout 7 langkah termasuk closed testing 12×14 hari dan verifikasi developer Indonesia 30 Sep 2026) + enam screenshot phone 16:9 1920×1080 dari mode baru `node tools/survival-look.mjs --store` (gate/day/build/fight/overview/closeup). Feature graphic dan icon sudah ada di `assets/brand/`.

**5. Rail build** `.github/workflows/play-bundle.yml`: runner ubuntu (punya jaringan ke repo Google) memasang JDK 17 + Bubblewrap, me-restore kunci dari secrets pemilik, scaffold proyek Gradle, menimpa twa-manifest dengan yang terkomit, lalu `bubblewrap build` → artifact `app-release-bundle.aab` + `app-release-signed.apk`. **Workflow ini belum pernah dijalankan dari sini** — secret-nya harus ditambah pemilik dulu.

### Yang TIDAK bisa selesai di sandbox ini (jujur)

Binary AAB/APK butuh JDK 17 + Android SDK + Gradle + artifact Maven dari `dl.google.com`/`maven.google.com`; sandbox hanya boleh bicara ke github/npm/pypi, dan tidak ada JDK terpasang. `node tools/bundle.mjs build` berhenti tepat di langkah keytool dengan pesan itu. Dua jalan keluar, keduanya terdokumentasi: jalankan `node tools/bundle.mjs build` di mesin ber-JDK 17 (kunci + repo ini saja yang dibutuhkan), atau trigger workflow `play-bundle.yml` setelah secrets diisi. Sampai salah satunya dijalankan, **belum ada AAB/APK yang terupload ke Play Console mana pun** — sesuai catatan config bahwa pemilik memang belum pernah upload.

### QA yang dijalankan (pass ini)

| Perintah | Hasil |
|---|---|
| `node tools/bundle.mjs check` | **all PASS** (fingerprint asli 1/1, asset links target benar, billing rail ada, tidak ada secret yang terdeploy; 1 WARN token origin trial) |
| `node tools/survival-look.mjs --store` | 6 screenshot 1920×1080, 0 error browser |
| `node tools/harness.mjs` | tidak berubah oleh pass ini (85/85 pada BUILD 19) — tidak ada kode game yang disentuh |

## Pass BUILD 19 — tangga unlock di panel akhir (R9) (2026-10-19)

**Pesan user:** "lanjutkan" — item terbuka berikutnya dari `docs/UX-REPLAY-RESEARCH.md` (§5, P1) adalah **R9**: "jalur unlock yang terlihat di panel akhir ('2★ more: STONE BALLISTA')… **bukan** kartu acak". Keluhan yang melatarinya: setelah menang, mayoritas pemain berhenti karena tidak ada alasan untuk main lagi (§3.4/U2). Ukuran berhasil riset: **setiap panel akhir menunjukkan unlock berikutnya**.

Stempel di layar kini **BUILD 19**, service worker `duskhold-v19`.

### Yang baru di game

**1. Tabungan bintang lintas run (`records.totalStars`).** Setiap run yang tertutup — menang **atau** kalah — menabung bintangnya ke total di `save.survival.records` (rekor lama yang belum punya field ini terbaca sebagai 0). Total itulah tangga R9: bukan undian, bukan pilihan acak, satu baris tetap yang selalu terbaca.

**2. Tangga "watch colour" (4 tier, 0/3/6/9★).** AZURE → IRON → CRIMSON → GOLD (`UNLOCK_TIERS` di `src/game/survival.js`). Tier yang tercapai mengecat ulang tabard kapten lewat uniform grade yang sudah ada di `valen3d.js` (`uCapRoyal` + bayangan navy/cahaya sky diurunkan dari satu hex), jadi warna yang dibeli bintang terlihat di dunia 3D setiap hari dan malam — GLB dan atlasnya tidak disentuh, dan keempat hex dipilih cukup terang agar syarat "kapten terang" (V8) tetap lulus.

**3. Baris tangga di setiap panel akhir.** Di antara baris rekor dan PLAY AGAIN, panel menang **dan** panel kalah memuat satu baris: `NEW: IRON WATCH — 1★ TO CRIMSON WATCH` pada run yang tepat menembus tier (dan hanya run itu), `CAPTAIN'S WATCH ★n — d★ TO X` selain itu, `ALL WATCH COLOURS EARNED — ★9` di puncak. Pagi sesudah tier tertembus, satu hint narator (sekali per save) menjelaskan artinya: "STARS EARN THE CAPTAIN NEW COLOURS".

### Hasil terukur

**Harness (node):** 3 cek B19 baru — tangga tetap/terurut/terang dan baris panel terbaca benar di 0★/tengah/puncak; run yang tertutup menabung bintang dan pengumuman tier hanya muncul di run yang menembusnya (run berikutnya sunyi); total bintang ikut tersimpan sehingga game baru di save yang sama berdiri di tier yang sama. Total **85/85**.

**Browser (`survival-fxshots`):** cek lama diperluas + 2 cek baru — panel kalah menyebut `3★ TO IRON WATCH` dari tabungan 0; bot builder memainkan tiga malam sungguhan sampai menang dengan tabungan 2★, sehingga menangnya menembus IRON: panel menang memuat `NEW: IRON WATCH — 1★ TO CRIMSON WATCH`, uniform tabard kapten terbaca `#9aa7b4` (bukan biru stok), dan pagi run berikutnya menawarkan hint `watch` sekali lalu menyimpannya. Frame bukti: `qa-evidence/survival-build19/b19-1-victory-ladder.png` (panel menang dengan baris tangga), `b19-2-loss-ladder.png` (panel kalah), `b19-3-iron-captain.png` (kapten berwarna iron di siang hari). Total **16/16**.

### QA yang dijalankan (BUILD 19)

| Perintah | Hasil |
|---|---|
| `node tools/harness.mjs` | **85/85 cek PASS** (+3 cek B19) |
| `node tools/survival-fxshots.mjs` | **16/16 PASS** (+2 cek B19, panel menang/kalah + warna kapten) |
| `node tools/survival-plotsqa.mjs` | **33/33 PASS** (tidak berubah; kapten tetap lulus cek terang V8 dengan tier stok) |
| `node tools/survival-devqa.mjs` | **25/25 PASS** |
| `node tools/envqa.mjs --mode=3d-smoke` | **PASS** |
| `node tools/survival-intro.mjs` | **PASS** |
| `node tools/swtest.mjs` | **PASS** (`duskhold-v19`) |
| `node tools/layoutqa.mjs` | **PASS** (panel akhir yang bertambah satu baris tetap muat 390 px) |
| `node tools/survival-look.mjs` | 12 shot, 0 error |
| `node tools/survivalshots.mjs --landscape` | 26 shot, 0 page error |
| `node tools/glbtest.mjs` | **PASS** |
| `node tools/survival-map.mjs` | **230/230 PASS** |
| `node tools/bundlecheck.mjs` | EXIT=1 — hanya sidik jari signing rilis (sama seperti BUILD 17–18) |

### Yang masih terbuka

Sama seperti BUILD 18: acceptance visual/manual di perangkat, playtest manusia, packaging Play. Dari riset: R6 sisa (target pertama kapten ≤ 5 dtk), R7, R10, R11, R17, R12–R16, dan sisa R8 (sifat horde pelari sungguhan) belum dikerjakan.

## Pass BUILD 18 — NIGHT ditekan-tahan + catatan emas belum terbelanjakan (2026-10-19)

**Pesan user:** "SCRARY NIGHT DEV next . read code base dan beberapa doc" — lanjutan. Setelah membaca basis kode dan doc lagi, item terbuka berikutnya yang saya pilih adalah sisa **R18** dari `docs/UX-REPLAY-RESEARCH.md` (§5, P1): opsi (a) sudah terbangun di pass feedback (NIGHT jadi chip top-left, jauh dari dock BUILD), tapi opsi (b) "HOLD TO START dengan cincin terisi" dan (c) "konfirmasi hanya bila gold masih cukup untuk build termurah" belum. Temuan playtest bot yang melatarinya (BUILD 12): *"tombol NIGHT ada tepat di samping BUILD… tidak bisa dibatalkan dan tidak minta konfirmasi walau gold masih cukup untuk membangun — ini risiko salah ketuk"*. Ukuran berhasil riset: **0 malam dimulai tak sengaja** (untuk sekarang di-assert oleh harness + browser; angka manusia menunggu playtest).

Stempel di layar kini **BUILD 18**, service worker `duskhold-v18`.

### Yang baru di game

**1. NIGHT ditekan-tahan, bukan diketuk (R18b).** Chip NIGHT kini meminta tekanan yang **tinggal 0,55 dtk** (`SURVIVAL_TUNING.nightHold`) sambil satu cincin terang mengisi dari kiri ke kanan; baru saat cincin tertutup malam dimulai (satu kali, dengan bunyi konfirmasi, dan tekanan dikonsumsi). Ketukan yang lepas lebih awal — atau meluncur keluar chip — **tidak memulai apa pun**: chip menjawab "HOLD TO START" di bawah dirinya selama 1,2 dtk, dan satu hint narator ("HOLD THE NIGHT CHIP TO START") ditawarkan sekali per save untuk yang belum pernah melihatnya. Keyboard menahan `confirm` dengan cara yang sama. Jalur tap lama (`uiTap`) melewatkan item yang punya hold, jadi tidak ada jalan pintas yang tersisa; kemajuan hold dihitung dalam **waktu simulasi** (`dt`), bukan waktu dinding, supaya probe/harness yang melangkah lebih cepat dari jam tetap mengukur perilaku yang sama.

**2. Emas yang belum terbelanjakan disebut saat cincin mengisi (R18c).** Konfirmasi yang diminta riset ("52 GOLD UNSPENT — START?") dipasang **tanpa dialog**: selama cincin mengisi, bila opsi siang termurah masih terbeli, chip menyebutnya di bawah dirinya ("60 GOLD UNSPENT", kuning emas) — tekanan itu sendiri adalah momen konfirmasi, dan pemain yang memang ingin menghabisinya dulu tinggal mengangkat jari. Hitungannya (`unspentNote`) mengambil opsi termurah yang masih terjangkau di antara semua yang siang tawarkan: upgrade keep/hunter, gerbang, bangunan, dan rak senjata.

**3. Cincin digambar dari keadaan game, bukan dari item lama.** Daftar hit UI dibangun ulang setiap frame gambar, sedangkan handler input menulis kemajuan ke item frame sebelumnya; tanpa jembatan itu cincin tidak pernah terlihat mengisi di layar sungguhan (harness tidak menggambar, jadi cek node lolos padahal browser tidak). `drawButton` kini menerima `holdT` dari keadaan hold game (`_uiHoldT`/`_kbdHoldT` + `_uiHoldLabel`) setiap frame.

### Hasil terukur

**Harness (node):** 3 cek B18 baru — (1) ketukan yang lepas di seperenam cincin tidak memulai malam dan mencatat miss + menawarkan hint; (2) cincin mengisi sebanding (0,545 pada 0,30 dtk) lalu malam mulai tepat satu kali dan tekanan dikonsumsi; (3) keyboard: confirm lepas lebih awal ditolak, confirm ditahan menutup cincin. Ketiganya PASS; total **82/82**.

**Browser (`survival-plotsqa` §10):** satu cek baru yang menekan chip dengan event mouse sungguhan di canvas — press 10 frame: cincin 0,303 dan catatan "60 GOLD UNSPENT" terbaca dari `_survivalLabels`; lepas: fase tetap day, miss + hint `holdnight`; tekan lagi sampai cincin tertutup: fase night, `uiDown` dikonsumsi. PASS; total **33/33**, 0 error browser. Frame buktinya: `qa-evidence/survival-build18/b18-1-hold-ring.png` (cincin setengah + catatan emas) dan `b18-2-tap-refused.png` ("HOLD TO START" + pita hint).

**Yang tidak berubah:** malam, rotasi gerbang, balance, dan tempo tidak disentuh pass ini (hold murni UI siang), jadi tabel BUILD 17 tetap berlaku; semua tool yang memulai malam melakukannya lewat API (`startNight()`/`beginNight()`), jadi tidak ada tool QA yang perlu diubah menjadi urutan hold.

### QA yang dijalankan (BUILD 18)

| Perintah | Hasil |
|---|---|
| `node tools/harness.mjs` | **82/82 cek PASS** (+3 cek B18, lihat di atas) |
| `node tools/survival-plotsqa.mjs` | **33/33 PASS** (+1 cek B18 di browser, lihat di atas) |
| `node tools/survival-devqa.mjs` | **25/25 PASS** |
| `node tools/envqa.mjs --mode=3d-smoke` | **PASS** |
| `node tools/survival-intro.mjs` | **PASS** (malam 1 + trailer tidak berubah) |
| `node tools/survival-fxshots.mjs` | **14/14 PASS** |
| `node tools/swtest.mjs` | **PASS** (`duskhold-v18`) |
| `node tools/layoutqa.mjs` | **PASS** |
| `node tools/survival-look.mjs` | 12 shot, 0 error |
| `node tools/survivalshots.mjs --landscape` | 26 shot, 0 page error |
| `node tools/glbtest.mjs` | **PASS** |
| `node tools/survival-map.mjs` | **230/230 PASS** |
| `node tools/bundlecheck.mjs` | EXIT=1 — hanya sidik jari signing rilis yang belum ada di sandbox (sama seperti BUILD 17) |

### Yang masih terbuka

Sama seperti BUILD 17: acceptance visual/manual di perangkat, playtest manusia (ukuran R18 "0 malam dimulai tak sengaja" baru di-assert mesin), dan packaging Play. Dari riset: R6 sisa (target pertama kapten ≤ 5 dtk), R7, R9–R17, R12, dan sisa R8 (sifat horde pelari sungguhan) belum dikerjakan.

## Pass BUILD 17 — ronde gerbang berseed + chip TONIGHT (2026-10-19)

**Pesan user:** "SCRARY NIGHT DEV next . read code base dan beberapa doc" — saya baca basis kode dan doc, lalu kerjakan item terbuka berikutnya. Yang saya pilih adalah **R8** dari `docs/UX-REPLAY-RESEARCH.md` (§5, P1): "variasi gerbang per run (seeded) + sifat horde per malam diumumkan di senja". Keluhan yang melatarinya adalah keluhan nomor satu di review Duck Survival: *"same round… rotate the direction"* — di kode BUILD 16 setiap run memang memainkan ronde yang sama persis. Ukuran berhasil riset: **≥ 3 urutan gerbang berbeda dalam 5 seed, dan FTUE tidak berubah**.

Stempel di layar kini **BUILD 17**, service worker `duskhold-v17`.

### Yang baru di game

**1. Ronde gerbang berseed (`NIGHT_ROTATIONS` + `runSeed`).** Malam 2 kini punya **4** urutan gerbang yang ditulis tangan dan malam 3 punya **3**; sebuah run memilih satu dari masing-masing lewat `runSeed`-nya (`nightDoors(day)`), jadi arah serangan berubah dari run ke run sementara bentuk malamnya tetap ditulis tangan:
- gelombang 3 (terbesar) tetap berakhir di gerbang utama, tempat Breaker datang dan tempat barricade yang dibayar kapten berdiri;
- postern hanya terbuka mulai malam 2; tidak ada gerbang yang kena dua gelombang semalam; dua pelari datang di dua gerbang berbeda;
- malam 3 tidak pernah membuka di gerbang tempat malam 2 membuka;
- **malam 1 tetap satu-satunya urutannya**: trailer pembuka menyerahkan kendali tepat di tanda gelombang pertama dan FTUE menuntun gerbang itu, jadi malam pertama run pertama identik dengan BUILD 16 (semua baris N1 di probe memang identik);
- `runSeed` ikut tersimpan di `save.survival`: reload di tengah run kembali ke ronde yang sama; run baru (PLAY AGAIN / sesi baru) memutar ronde. Probe bisa menempel satu seed lewat `?seed=` (semua tool QA kini berseed, jadi laporan bisa diulang).

**2. Chip TONIGHT (sifat horde diumumkan di senja).** Di pita atas layar siang, di antara PAUSE dan pill DAY, satu chip menyebut **urutan gerbang malam ini** ("WEST → NW POSTERN → SOUTH") plus isinya lewat ikon yang sudah dipakai di mana-mana (horde ×78, pelari ×2, breaker ×1). Teksnya punya tiga tingkat (panjang/pendek/tiny) agar muat di pita ≤ 48 px dari lebar 667 px ke atas; chip tidak digambar saat malam, saat kartu fajar terbuka, atau saat sinematik — HUD malam tetap milik BUILD 16. Badge gerbang siang (V10) kini ikut membawa **pip nomor gelombang** yang mencapai gerbang itu lebih dulu, jadi peta siang dan chip menyebut ronde yang sama.

**3. Dua batas malam 3 yang diukur, bukan ditebak.** Tabel ronde pertama saya membuat regresi: arms-builder (barracks + crossbow guard, tanpa ballista — pertahanan terlemah yang masih menang 5/5 di BUILD 16) turun ke **1/5**, semua kalah di malam 3 (Keep jatuh 55–60 dtk). `tools/survival-balance.mjs` mendapat dua flag ukur baru (`--rot=N2,N3` dan `--plan3=<gerbang>`) dan 20 kombinasi diukur 3 seed masing-masing (`qa-evidence/survival-build17/rotation-matrix.txt`). Dua batas jatuh dari tabel itu, dan keduanya kini tertulis di komentar `NIGHT_ROTATIONS`:
- **postern 110 HP tidak pernah menjadi gelombang 2** di malam 3. Sebagai gelombang 2 ia kalah 0/3 dua kali (30 tubuh menjebol postern saat pertahanan sudah terikat di gerbang gelombang 1 seberang bailey); sebagai gelombang 1 ia bertahan 3/3 (datang saat garnisun masih utuh). Malam 2 tetap boleh (24/27/27 terukur 3/3);
- **langkah antar gelombang 1→2 tidak lebih dari seperempat sirkuit tembok**: posternNW→eastGate dan posternSE→westGate (keduanya 135°) kalah 0/3 dan 1/3, sedangkan semua langkah 45°/90° bertahan 3/3;
- satu bentuk dibuang outright: empat gelombang 30 tubuh di empat gerbang besar tanpa postern — arms-builder hanya lolos bila malam 2 kebetulan menyiapkannya (1/5 di belakang varian 2, 3/5 di belakang varian 3).
Dengan tabel akhir, **12 pasangan (malam 2, malam 3) yang mungkin diukur satu per satu: arms-builder 3/3 dan builder 3/3 di keduabelasnya**.

**4. Perbaikan kecil yang ketemu saat menulis probe.** `game._survivalLabels` (catatan apa yang layer siang gambar, yang dibaca QA) tadinya tertinggal saat layer siang tidak digambar: probe bisa membaca chip TONIGHT hari kemarin mentre HUD malam tampil. Kini `drawSurvivalScreen` membersihkannya di setiap frame yang tidak menggambar layer siang (malam, cine, pause, panel akhir).

### Hasil terukur

**Balance (5 seed × 7 bot, malam 72 dtk)** — `qa-evidence/survival-build17/balance-5seed-72s.txt`:

| Bot | BUILD 16 | BUILD 17 |
|---|---|---|
| idle / active / keep-builder | 0/5, 0/5, 0/5 | 0/5, 0/5, 0/5 (tidak berubah) |
| builder | 5/5 ★ 3,3,3,3,3 | 5/5 ★ 1,3,3,3,3 |
| tower-builder / hunter-builder | 5/5 ★ 3,3,3,3,3 | 5/5 ★ 3,3,3,3,3 (tidak berubah) |
| arms-builder | 5/5 ★ 3,1,3,3,3 | 5/5 ★ 3,1,3,3,3 (profil BUILD 16 persis) |

Satu-satunya pergeseran: builder seed 20261012 turun 3★ → 1★ (tetap menang). Seed itu memainkan varian malam 2 tanpa postern (northGate→westGate→southGate→eastGate), yang menyebar 24/27/27 ke tiga gerbang besar; rencana ballista bot yang tetap menutup lebih sedikit daripadanya (keepMin 44 % vs 91 %). Malam 1 identik baris-per-baris di semua 35 run.

**Ronde berputar** — `qa-evidence/survival-build17/rotation-5seed.txt`: 5 seed probe memainkan 3 urutan malam 2 dan 3 urutan malam 3 yang berbeda; 10 seed acak memberi 4 varian malam 2 dan 3 varian malam 3 (ukuran riset ≥ 3 terpenuhi). Seed probe yang dipin (`20261007`, default semua tool) memutar ulang kedua malam BUILD 16 persis, jadi semua ekspektasi lama yang menyebut gerbang tetap berlaku.

**Tempo** — `qa-evidence/survival-build17/tempo-5seed-72s.txt`: kerja BUILD 16 (R5 fajar cepat, R6 kontak pertama) bertahan di atas rotasi: ekor kosong malam 3 builder 2,0 dtk, malam 2+3 yang cleared 9/10 (seed yang memainkan malam tanpa postern berjalan sampai jam), kontak pertama malam 2–3 1,2–3,4 dtk. Target R6 "target pertama kapten ≤ 5 dtk" **masih belum tercapai** dan pass ini tidak mengklaimnya (first@ 10,0–14,7 dtk; yang dominan tetap jalan kaki Keep → gerbang).

### QA yang dijalankan (BUILD 17)

| Perintah | Hasil |
|---|---|
| `node tools/harness.mjs` | **79/79 cek PASS** (+3 cek B17: (1) tabel ronde — malam 1 tetap, bentuk tiap varian sah, 5 seed memberi ≥ 3 urutan berbeda per malam, replay benar; (2) malam benar-benar memainkan ronde yang diumumkan siang: gelombang 1–3, dua pelari, dan Breaker spawn di gerbang yang disebut chip/badge, dan kapten + Keep di-pin hidup agar yang diukur hanya *ke mana* malam mengirim tubuhnya; (3) seed ikut tersimpan: reload kembali ke ronde sama, run bebas berseed berbeda, seed pin replay sama) |
| `node tools/survival-plotsqa.mjs` | **32/32 PASS** (+2 cek B17 di browser: chip TONIGHT nyata tergambar di pita 48 px (sampel piksel wajah + baris teksnya), jelas dari PAUSE/pill/counter, badge membawa pip gelombang, dan hilang saat malam; tiga seed di layar hari-2 yang sama memberi **3 urutan TONIGHT berbeda**, masing-masing rencana yang malamnya mainkan) |
| `node tools/survival-devqa.mjs` | **25/25 PASS** |
| `node tools/envqa.mjs --mode=3d-smoke` | **PASS** |
| `node tools/survival-intro.mjs` | **PASS** (malam 1 tidak berubah) |
| `node tools/survival-fxshots.mjs` | **14/14 PASS** |
| `node tools/swtest.mjs` | **PASS** (`duskhold-v17`) |
| `node tools/layoutqa.mjs` | **PASS** (0 error browser) |
| `node tools/survival-look.mjs` | 12 shot, 0 error |
| `node tools/survivalshots.mjs --landscape` | 26 shot, 0 page error |
| `node tools/glbtest.mjs`, `survival-map.mjs` | **PASS**, **230/230** |
| `node tools/bundlecheck.mjs` | hanya 1 FAIL lama (fingerprint signing release, menunggu kunci upload) |
| `node tools/survival-uxprobe.mjs` (5 jenis pemain × 5 seed) | lihat "Tempo" dan `tempo-5seed-72s.txt` |
| `node tools/survival-balance.mjs --seeds=5 --duration=72` (7 bot) + `--rot` / `--plan3` | lihat "Balance" dan `rotation-matrix.txt` |

**Bukti** (`qa-evidence/survival-build17/`):

- `b17-1-tonight-chip.png`, `b17-2-tonight-chip-s20276850.png`, `b17-2-tonight-chip-s20261013.png`: layar hari 2 yang sama dengan tiga seed — chip menyebut tiga urutan berbeda dan badge mengikuti pip gelombangnya;
- `balance-5seed-72s.txt`: baris per-seed BUILD 17 vs BUILD 16 (worktree `e988ecb`);
- `rotation-5seed.txt`: ronde yang dimainkan tiap seed probe + tabel ronde yang ditulis;
- `rotation-matrix.txt`: 20 pengukuran `--plan3` / `--rot` yang melahirkan dua batas malam 3;
- `tempo-5seed-72s.txt`: uxprobe sebelum/sesudah.

### Belum / terbuka

- **R8 setengah jalan**: yang diumumkan baru *arah* dan *Breaker*. "RUNNERS TONIGHT" sebagai sifat horde (tipe tubuh pelari yang berbeda dan retune) masih belum — butuh tipe musuh baru, bukan teks.
- R6 "target pertama ≤ 5 dtk" (jalan kaki Keep → gerbang tetap 6–8 dtk); R18b/c (hold-to-start); R7 Siege; R12 toggle suara.
- Penilaian manusia di perangkat: apakah chip TONIGHT terbaca sekilas, apakah ronde yang berputar terasa adil (bukan acak), apakah pip gelombang membantu menyusun pertahanan.
- Playtest manusia dan packaging Play masih terbuka. Hasil tiap skrip hanya berlaku untuk cakupan yang benar-benar diuji.

## Pass BUILD 16 — tempo malam: fajar lebih cepat, gelombang dipanggil (2026-10-18)

**Pesan user:** "next" (setelah BUILD 15). Saya baca sebagai: kerjakan item terbuka berikutnya. Yang saya pilih adalah sisa P0 riset UX: **R5** (fajar lebih cepat) dan **R6** (kontak pertama ≤ 5 dtk). Keduanya terukur buruk di `survival-uxprobe` pada kode BUILD 15:
- malam 3 yang dimenangkan berakhir dengan **7,7–9,6 dtk menunggu jam** setelah kill terakhir (bot builder; bot tower 10,9–14,2 dtk);
- di malam 2–3 gerbang pertama baru diserang **4,4–5,1 dtk** setelah malam mulai, dan target pertama kapten bot builder baru muncul di 14,0–16,4 dtk.

V1 dan V3 dari riset visual (butuh pass aset) belum dikerjakan.

Stempel di layar kini **BUILD 16**, service worker `duskhold-v16`.

### Yang baru di game

**1. NIGHT CLEARED (R5).** Begitu semua spawn malam itu sudah keluar dan tidak ada musuh yang masih berdiri:
- banner emas **"NIGHT CLEARED!"** dengan sub "DAWN COMES EARLY · +N GOLD", plus bunyi lonceng fajar;
- pill malam berubah emas (matahari, "CLEARED / DAWN"), dan bar waktunya berlari ke ikon matahari;
- cahaya **menghangat selama 2 detik**: rig cahaya dan warna tanah di-blend dari malam ke siang, lalu fajar datang. Fajar terlihat datang, bukan dipotong;
- setiap detik penuh yang dihemat = **1 emas**. Bonus ini tampil sebagai baris sendiri di kartu fajar (koin dengan jam), dan judul kartu menjadi "NIGHT 2 CLEARED!" (bukan SURVIVED);
- mine dibayar sisa shift malam yang tidak sempat digali, jadi fajar cepat tidak pernah mengurangi pendapatan.

Reload di tengah 2 detik itu mempertahankan jam fajarnya. Malam yang "dibersihkan" dalam 2 detik terakhir tetap berakhir di jam biasa (sub "DAWN IS HERE", tanpa bonus).

**2. Gerombolan pecah (tambahan saya, di luar usulan riset).** Saat diukur, aturan R5 murni hampir tidak pernah terpicu. Yang menahan malam bukan papan yang kosong, tapi **1–3 pejalan lambat terakhir** (Breaker 48 px/dtk, Individual) yang memutari tembok menuju gerbang jauh, lebih dari 1.000 px dari pertarungan mana pun. Mereka baru sampai setelah fajar. Maka, begitu semua spawn sudah keluar dan sisa musuh **≤ 3**:
- yang **tidak sedang bertarung** berbalik dan lari ke hutan (120 px/dtk) dan hilang setelah 1,5 dtk. Ini **bukan kill**. "Sedang bertarung" berarti: di dalam tembok, di 200 px terakhir menuju gerbang, menyerang/mencakar, menyerang Keep, atau dalam jangkauan tembak kapten (540 px);
- yang **masih bertarung** ditandai: banner **"LAST N!"** (sub "CLEAR THEM FOR AN EARLY DAWN"), chip tengkorak merah di atasnya, atau panah merah di tepi layar bila di luar layar;
- setelah semuanya habis, banner NIGHT CLEARED berbunyi "THE REST FLED · +N GOLD".

**3. Gelombang dipanggil (R6).**
- Malam 2–3 melepas gelombang 1 di **1,5 %** malam (1,08 dtk; dulu 4 % = 2,88 dtk). Malam 1 tetap 4 %, karena trailer pembuka menyerahkan kendali tepat di tanda gelombang pertama, jadi di sana tidak ada detik kosong.
- Setiap gelombang memunculkan banner "WAVE 1/3" dengan **nama gerbang dan jumlahnya** ("WEST GATE ×24", "SE POSTERN ×30"). Breaker: "BREAKER!" + "SOUTH GATE".
- **Terompet horde** (suara prosedural baru, lebih rendah dan kasar dari terompet kapten) berbunyi untuk setiap gelombang dan Breaker, dari sisi layar tempat gerbangnya berada.
- Panah tepi ke gerbang gelombang sudah ada sejak pass visual (ikon horde + ×N).

**4. Bug lama yang ketemu: panah tepi malam di HP landscape duduk di atas kapten.** Kotak tempat panah tepi malam berjalan masih memakai margin portrait (128 px atas, 150 px bawah). Di layar 390 px, kotak itu tinggal pita 92 px di tengah layar, jadi panah ke gerbang di samping duduk dekat kepala kapten. Sekarang (`nightPointerBand`), di layar landscape panah berjalan di **bingkai area main**: 84 px di bawah tepi atas, 100 px di atas tepi bawah, 28 px dari sisi. Panah juga menghindari tombol zoom, FLARE, dan counter di tepi kanan. Ini berlaku untuk semua panah malam: gerbang, LAST N, Keep diserang, dan guard jatuh. Panah siang V10 sudah punya kotaknya sendiri.

### Hasil terukur

`survival-uxprobe`, 5 seed, malam 72 dtk. BUILD 15 diukur dengan probe yang sama di worktree `f9c1b1d`.

| Ukuran | BUILD 15 | BUILD 16 |
|---|---|---|
| Ekor kosong (kill terakhir → fajar), malam 3, bot builder | 7,7–9,6 dtk | **2,0 dtk** |
| Sama, bot tower | 10,9–14,2 dtk | **1,4–2,1 dtk** |
| Sama, malam 2, bot builder | 0,1–10,3 dtk | **2,0–2,1 dtk** |
| Malam 2 + 3 yang berakhir lebih cepat (NIGHT CLEARED), bot builder + tower | 0 dari 20 | **20 dari 20** |
| Fajar malam 3 (jam) | 72 dtk | builder 65,3–66,5 dtk; tower 59,1–62,2 dtk |
| Bonus emas fajar cepat | — | malam 2: 3–11; malam 3: 5–12 (malam 3: tidak terpakai, run selesai) |
| Gerbang pertama diserang ("kontak"), malam 2–3 | 4,4–5,1 dtk | **2,6–3,2 dtk** |
| Sama, malam 1 (tanpa trailer di probe; di browser trailer menyerahkan kendali di 2,88 dtk) | 4,9–5,4 dtk | sama (tidak diubah) |
| Target pertama kapten bot builder, malam 2 / malam 3 | 16,3–16,4 / 14,0–14,4 dtk | **14,3–14,7 / 12,3–12,5 dtk** |
| Target pertama pemain "rally" (langsung berjalan ke gerbang gelombang 1), malam 1 / 2 / 3 | 7,2–8,7 / 11,5 / 9,6 dtk | sama |
| Panah gerbang barat/utara di layar 844×390, kapten di Keep | dekat kepala kapten (pita y 138–230) | di bingkai atas area main (y 94), 163–171 px dari kapten |

`rally` adalah pemain baru khusus probe: bot builder di siang hari yang saat malam mulai langsung berjalan ke gerbang yang dipanggil, lalu memburu "LAST N" saat tidak ada pertarungan lain. Bot balance tidak memakainya.

**Target R6 belum tercapai sepenuhnya.** Ukuran berhasil di riset adalah "target pertama ≤ 5 dtk di semua malam". Yang tercapai adalah gerbang diserang ≤ 5 dtk. Target pertama kapten masih 9,6–14,7 dtk, karena yang dominan adalah jalan kaki dari Keep ke gerbang (6–8 dtk dengan lari 196 px/dtk), bukan gelombangnya.

### Balance (5 seed × 7 bot, malam 72 dtk)

- **Malam 1 identik dengan BUILD 15** di seluruh 35 run (baris N1 sama persis).
- Menang/kalah sama: idle, active, keep-builder 0/5; builder, tower-builder, hunter-builder 5/5 ★★★; arms-builder 5/5 dengan ★ 3,1,3,3,3 (BUILD 15: 3,1,3,1,1).
- Waktu kalah active dan keep-builder bergeser 1–6 dtk.

Catatan: versi pertama melepas gelombang 1 lebih cepat di **semua** malam. Di satu seed, Keep malam 1 lalu turun ke 20 % (★ turun ke 1 untuk tiga bot terkuat), karena gerbang utara dicakar ±2 dtk lebih lama sebelum bot sampai. Malam 1 sudah tidak punya detik kosong di browser (trailer), jadi perubahan itu dibatasi ke malam 2–3.

### QA yang dijalankan (BUILD 16)

| Perintah | Hasil |
|---|---|
| `node tools/harness.mjs` | **76/76 cek PASS** (+3 cek BUILD 16). (1) NIGHT CLEARED: banner + emas, fajar tepat 2 dtk kemudian, bonus = detik penuh yang dihemat (+19), bayaran sisa shift mine, cahaya 0 → 0,5 → 1 (exposure 1,08 → 1,13), reload mempertahankan jam fajar, tidak ada clear saat spawn masih tersisa atau papan disapu dengan tangan. (2) Gerombolan pecah: dua Individual jauh lari dan hilang tanpa kill, yang mencakar gerbang barat tetap ada dan dipanggil "LAST 1!", lalu malam cleared dengan "THE REST FLED". (3) R6: gelombang 1 malam 2–3 di 1,08 dtk, malam 1 di 2,88 dtk; panggilan "NORTH GATE ×21" / "WEST GATE ×24" / "SE POSTERN ×30"; terompet per gelombang dan per Breaker; gerbang dicakar di 2,8 dtk di malam 2–3 dengan kapten diam di Keep. Satu cek lama disesuaikan (guard jatuh yang ditinggal 20 dtk hilang): skenarionya menyapu gerombolan dari papan, yang kini memicu NIGHT CLEARED, jadi skenario itu kini menandai malamnya tanpa spawn |
| `node tools/survival-plotsqa.mjs` | **30/30 PASS** (+3 cek B16 di browser). (1) NIGHT CLEARED: pill emas, luminansi tanah 96 → 110 (saat clear) → 133 (+1 dtk) → 162 (fajar), kartu fajar "NIGHT 2 CLEARED!" dengan baris emas. (2) "WAVE 1/3 · WEST GATE ×24" dengan terompet. (3) "LAST 1!" dan panah tengkorak di bingkai atas area main (y 94), 168 px dari kapten |
| `node tools/survival-devqa.mjs` | **25/25 PASS** |
| `node tools/envqa.mjs --mode=3d-smoke` | **PASS**. Bukti FTUE `qa-evidence/survival-ftue-*` ikut diperbarui dengan stempel BUILD 16 |
| `node tools/survival-intro.mjs` | **PASS** (malam 1 tidak berubah: trailer menyerahkan kendali di tanda gelombang pertama) |
| `node tools/survival-fxshots.mjs` | **14/14 PASS** (menang 3 malam nyata di browser: kill 66 + 78 + 91) |
| `node tools/layoutqa.mjs` | Run pertama FAIL di cek gerak keyboard mode legacy: pemain bergerak maks 6,3 px dalam 1 dtk waktu nyata (batas 8 px). Ini cek waktu nyata di mode legacy, yang tidak disentuh BUILD 16. Run ulang sendirian **PASS** (19,9 px) |
| `node tools/glbtest.mjs`, `swtest.mjs`, `survival-map.mjs` | **PASS**, PASS (`duskhold-v16`), **230/230** |
| `node tools/survivalshots.mjs --landscape` | 26 shot, 0 page error |
| `node tools/survival-look.mjs` | 7 shot, 0 error |
| `node tools/bundlecheck.mjs` | hanya 1 FAIL lama (fingerprint signing release, menunggu kunci upload) |
| `node tools/survival-uxprobe.mjs` (5 jenis pemain × 5 seed) | lihat "Hasil terukur" dan `tempo-5seed-72s.txt` |
| `node tools/survival-balance.mjs --seeds=5 --duration=72` | lihat "Balance" |

Setelah rantai QA browser selesai, satu baris kode diubah: tambalan Keep di fajar kini tidak pernah negatif. Pemicunya: skenario uji menaruh Keep di 99.999 HP, dan kartu fajar menampilkan "+-34790". Di permainan nyata HP Keep tidak pernah di atas maksimum. Setelah perubahan itu, harness (76/76), §8 plotsqa sendirian di DPR 2 (3/3), uxprobe, dan balance dijalankan ulang. uxprobe dan balance identik dengan run sebelumnya.

**Bukti** (`qa-evidence/survival-build16/`):

- `night-cleared-sequence.png`: tiga frame dari malam 2 yang sama: NIGHT CLEARED + pill emas → 1 dtk kemudian, cahaya menghangat → kartu fajar "NIGHT 2 CLEARED!" dengan baris +19 emas;
- `compare-pointers.png`: BUILD 15 vs 16, skrip dan detik yang sama: dua gerombolan mencakar gerbang barat dan utara, kapten di Keep, layar 844×390;
- `wave-call.png`: "WAVE 1/3 · WEST GATE ×24" di malam 2;
- `last-one.png`: "LAST 1!" dan panah tengkorak merah ke gerombolan terakhir di gerbang barat;
- `tempo-5seed-72s.txt`: `survival-uxprobe` sebelum/sesudah;
- `balance-5seed-72s.txt`.

**Belum / terbuka:**
- R6 "target pertama ≤ 5 dtk" (lihat atas). Jalan kaki ke gerbang tetap 6–8 dtk.
- Penilaian manusia di HP:
  - apakah gerombolan yang lari terasa adil, bukan kemenangan gratis;
  - apakah terompet terdengar jelas tanpa mengganggu;
  - apakah fajar cepat terasa memuaskan;
  - apakah panah di bingkai atas masih terbaca sebagai "ke sana".
- Bonus emas malam 3 tidak terpakai (run selesai). Di malam 3 aturan ini hanya mempercepat kemenangan.
- Malam 1 jarang "cleared", karena pertarungannya masih berlangsung sampai jam habis. Ini sesuai desain.

## Pass BUILD 15 — pertarungan malam terlihat utuh (2026-10-18)

**Pesan user:** "next" (setelah BUILD 14). Saya baca sebagai: kerjakan item terbuka berikutnya. Yang saya pilih adalah **V6 + V7** dari riset visual §7. Keduanya belum dikerjakan, dan masalahnya terlihat jelas di shot malam BUILD 14:
- Saat kapten menahan gerbang utama (selatan) dari dalam, menara timur gerbang itu **menutupinya sepenuhnya**.
- Gerombolan di gerbang selatan tertutup pohon pinus di luar tembok, dan menempel di kiri bawah layar dekat stick.
- Gerombolan di gerbang utara berada di bawah HUD atas.

V1 dan V3 (butuh pass aset) belum dikerjakan. V2 dan V5 tetap tidak dikerjakan (keputusan sebelumnya).

Stempel di layar kini **BUILD 15**, service worker `duskhold-v15`.

### Yang baru di game

**1. Kamera malam condong ke pertarungan (V7).** Di BUILD 14 kamera malam selalu di atas kapten, sedikit condong ke utara. Sekarang, kalau ada gerombolan dalam 600 px dari kapten, pusat layar bergeser **0,7 dari jarak kapten ke pusat gerombolan** (maksimal 300 px). Gerombolan berada di tengah area main dan kapten di sebelahnya. Aturannya:
- musuh yang dekat lebih berat; Breaker ×2; musuh yang menyerang Keep ×1,5;
- satu musuh sendirian di tepi jangkauan hampir tidak menggeser layar (geseran penuh baru pada bobot gerombolan 3);
- geseran masuk dan keluar halus (2,4/detik), jadi gerombolan yang mati atau datang tidak membuat layar melompat;
- condong ke utara yang lama memberi jalan selama ada pertarungan;
- drag kamera dari pemain tetap menang, seperti sebelumnya;
- siang hari tidak ada geseran.

**2. Kill zone dan glacis (V7).** Benteng kini menjaga tanah di depannya tetap terbuka:
- tidak ada pohon berdiri dalam **380 px** dari titik kumpul di luar setiap gerbang;
- sisi selatan dan timur (sisi yang dekat kamera) punya **glacis 460 px** tanpa pohon.

19 dari 316 pohon ditebang dan tinggal **tunggul** (batang pendek dengan permukaan potong terang). Tunggul memakai jejak tabrakan batang yang sama, jadi tidak ada yang berubah di simulasi. Batu dan semak tetap, karena rendah.

**3. Menara di sisi dekat kamera jadi bastion pendek (V6).**
- Empat menara gerbang selatan dan timur kini naik **20 px** di atas tembok (dulu 88 px).
- Jembatan di atas kedua gerbang itu dihapus, karena berdiri di depan siapa pun yang menahan mulut gerbang.
- Menara sudut tenggara, objek paling bawah di layar, naik 44 px (dulu 108 px).
- Menara utara dan barat tetap tinggi sebagai aksen di tepi atas layar, sesuai riset.

Data tinggi ada di `fortress.js` (`TOWER_RISE`). Guard di pos gerbang ikut berdiri di atas bastion (~68 px lebih rendah dari menara utara), dan baut mereka dilepas dari ketinggian itu.

**4. Kapten terlihat menembus penghalang (tambahan, di luar usulan riset).** Di balik menara, pohon, bangunan, Keep, atau horde, kapten digambar sebagai **siluet biru tembus pandang**. Saat tidak tertutup, tubuhnya sendiri menimpa siluet itu. Cara kerjanya:
- setiap mesh skinned kapten punya kembaran dengan geometri dan skeleton yang sama, jadi siluet ikut setiap animasi;
- kembaran itu hanya digambar di tempat yang sudah tertutup sesuatu yang lebih dekat ke kamera (`GreaterDepth`);
- tembok tidak dipudarkan, dan GLB tidak diubah;
- hanya di Survival; mode legacy tidak berubah.

Ini menutup sisa kasus yang tidak bisa diselesaikan dengan merendahkan menara. Dengan menara utara dan barat yang tetap tinggi, kepala kapten masih tertutup di 4 dari 27 titik tempur di luar gerbang utara/barat (`survival-map`).

### Hasil terukur

| Ukuran | BUILD 14 | BUILD 15 |
|---|---|---|
| Kepala kapten tertutup menara/jembatan dari titik tempur gerbang selatan, timur, dan postern tenggara (27 titik: 80 px di dalam; 80 / 200 px di luar) | 4 titik | **0** |
| Menara/jembatan terbesar di layar 844×390, zoom malam 0,655, dari pandangan tempur gerbang | 5,0 % | 5,0 % (batas riset 10 %) |
| Jarak pohon berdiri terdekat dari titik kumpul di luar gerbang (S / W / NW / N / E / SE) | S 285 / W 277 / NW 382 / N 247 / E 222 / SE 259 px | **471 / 475 / 382 / 409 / 480 / 427 px** |
| Pohon berdiri di glacis selatan/timur (460 px) | 15 | **0** (19 tunggul) |
| Kapten menahan gerbang selatan dari dalam, gerombolan di luar: posisi y di layar 390 px, gerombolan / kapten (area main ≈ 85…285) | 298 / 219 (gerombolan di pita stick/FLARE) | **219 / 140** |
| Sama, di gerbang utara | 140 / 219 | **171 / 250** |

Dua baris terakhir dihitung dengan skenario yang sama di kode BUILD 14 (worktree `0b42bb3`) dan BUILD 15: layar 844×390, zoom malam 0,655, 3 detik setelah gerombolan berdiri di luar gerbang. Pita HUD atas sampai ~75 px; pita stick/FLARE/chip mulai ~290 px.

### Balance

**Identik dengan BUILD 14**: seluruh 35 run (7 bot × 5 seed) dan SUMMARY sama persis selain waktu proses. Ini sesuai desain: tunggul memakai jejak tabrakan batang yang sama, tinggi menara hanya visual, dan kamera tidak memengaruhi simulasi.

### QA yang dijalankan (BUILD 15)

| Perintah | Hasil |
|---|---|
| `node tools/harness.mjs` | **73/73 cek PASS** (+3 cek BUILD 15: kill zone dan glacis tanpa pohon berdiri, tunggul menjaga jejak tabrakan, rumah legacy tidak menebang apa pun; menara selatan/timur dan sudut tenggara rendah, pos guard dan baut dari bastion naik 20 px, dari menara utara 88; frame malam condong 0,7 ke gerombolan di gerbang selatan dan utara, gerombolan dan kapten di area main layar 844×390, siang tidak condong) |
| `node tools/survival-plotsqa.mjs` | **27/27 PASS** (+3 cek B15: siluet biru kapten di balik menara timur gerbang utara, 3.212 piksel, biru 216 vs merah 113; bastion + tanpa jembatan selatan/timur + 19 tunggul, guard di bastion 131,7 vs menara utara 199,7; frame condong saat menahan gerbang utama). Cek V8 (luminansi kapten) kini diukur dengan siluet dimatikan, karena yang diukur warna kapten sendiri. Run pertama 26/27: cek bastion gagal karena guard kedua belum selesai memanjat menara utara saat batas jam malam di skrip habis. Masalahnya di skenario uji, bukan di game. Cek itu kini menaruh guard langsung di posnya dan hanya mengukur tinggi 3D. Panjatnya sendiri sudah dicek harness #2 (guard memanjat dan menembak dari bastion). Run ulang 27/27 |
| `node tools/survival-map.mjs` | **230/230** (+4 cek: kepala kapten bebas masonry dari 27 titik tempur sisi selatan/timur; tidak ada menara/jembatan > 10 % layar, terburuk 5,0 %; ≥ 300 px lantai terbuka di depan setiap gerbang, pohon berdiri terdekat 382–480 px; glacis tanpa pohon berdiri) |
| `node tools/survival-devqa.mjs` | **25/25 PASS** |
| `node tools/survival-intro.mjs` | **PASS**. Run pertama FAIL: frame pertama trailer diambil saat dunia 3D belum siap. Malam (dan trailernya) ditahan sampai dunia 3D tergambar sekali (`survivalWorldReady`), jadi t tetap 0,08. Skrip kini menunggu dunia siap sebelum melangkah. Run ulang PASS (frame pertama t 0,7, caption PROTECT THE KEEP, zoom 1,53× play) |
| `node tools/envqa.mjs --mode=3d-smoke` | **PASS** (41). Bukti FTUE `qa-evidence/survival-ftue-*` ikut diperbarui dengan stempel BUILD 15 |
| `node tools/survival-fxshots.mjs` | **14/14 PASS** |
| `node tools/layoutqa.mjs`, `glbtest.mjs`, `swtest.mjs` | **PASS** (`swtest` dengan `duskhold-v15`) |
| `node tools/survivalshots.mjs --landscape` | 26 shot, 0 page error |
| `node tools/survival-look.mjs` | 0 error (`day0`, `day`, `build`, `gate`, `fight`, `overview`, `closeup`; dan `gate`, `south`, shot baru `killzone` untuk sebelum/sesudah) |
| `node tools/bundlecheck.mjs` | hanya 1 FAIL lama (fingerprint signing release, menunggu kunci upload) |
| `node tools/survival-balance.mjs --seeds=5 --duration=72` | **identik dengan BUILD 14** (35 run + SUMMARY) |

**Bukti** (`qa-evidence/survival-build15/`):

- `compare-south.png`: kapten menahan gerbang utama dari dalam, malam 1, skrip dan detik yang sama. BUILD 14: kapten tertutup menara (hanya cincin + bar HP), gerombolan di balik pinus di kiri bawah. BUILD 15: bastion pendek, kapten terlihat (badan bawah sebagai siluet), gerombolan di tengah layar, tunggul di depan;
- `compare-killzone.png`: kapten di kill zone luar gerbang utama: tiga pinus yang menutup gerombolan kini tunggul;
- `compare-gate.png`: kapten di mulut gerbang utara (menara utara tetap tinggi; frame condong ke gerombolan di luar);
- `captain-xray-off-on.png`: kapten di balik menara timur gerbang utara, frame yang sama, siluet mati / hidup (zoom 1,6);
- `south-gate-bastions.png`, `fight-frame.png`: dari `survival-plotsqa`;
- `map.png`: denah bailey (230/230 cek);
- `balance-5seed-72s.txt`.

**Belum / terbuka:**
- Penilaian manusia di HP:
  - apakah geseran kamera malam terasa membantu, bukan membingungkan (layar kini bergerak sendiri ke arah gerombolan);
  - apakah siluet biru terbaca sebagai kapten, bukan hantu (catatan V8);
  - apakah gerbang utama dengan bastion pendek masih terbaca sebagai gerbang utama.
- Menara gerbang utara dan barat tetap tinggi. Kapten yang berdiri tepat di depan menara sisi kamera tertutup di sana; siluet yang menunjukkan posisinya.
- Tembok 2 m tetap menutup badan bawah musuh yang menempel di tembok utara/barat (sejak BUILD 12, musuh terlihat dari dada ke atas). Pertarungan di kill zone luar gerbang menampilkan mereka utuh.
- Geseran kamera tidak mengubah zoom. Untuk pertarungan yang sangat menyebar, pemain tetap perlu pinch-out sendiri.

## Pass BUILD 14 — senjata pasukan bisa di-upgrade (2026-10-18)

**Pesan user:** "next". Saya baca sebagai: kerjakan item terbuka berikutnya. Yang saya pilih adalah permintaan eksplisit dari pesan ketiga (2026-10-17) yang masih terbuka sejak BUILD 10: *"senjata pasukan bisa di-upgrade"* (acceptance #14), ditambah tiga catatan kecil BUILD 13. Alternatif yang belum dikerjakan: V2, V5, V1, V3, V6, dan V7 dari riset visual (butuh pass aset atau tata letak).

Stempel di layar kini **BUILD 14**, service worker `duskhold-v14`.

### Yang baru di game

**1. Rak senjata (arms rack).** Ini titik siang baru di distrik tenggara, satu baris dengan armory dan 270 px di sebelah timurnya. Posisinya adalah cerminan plot luar barak barat laut lewat Keep, jadi distrik tenggara kini punya dua stasiun seperti distrik lain punya plot berpasangan. Isinya: pad tanah, rak senjata, tong, ember baut KayKit, dan sebuah peti dengan **crossbow level saat ini yang berputar pelan di atasnya**. Peti diletakkan di timur laut tengah pad supaya kapten yang berdiri di rak tidak menutupinya.

**2. Kartu GUARD BOWS** (dock satu baris, seperti kartu lain):
- ikon crossbow, nama, dan pip level;
- damage per baut sekarang → berikutnya;
- "guard ×N", yaitu berapa guard yang memegang busur itu;
- tag `FASTER` (menuju Lv2) atau `PIERCE` (menuju Lv3);
- tombol UPGRADE dengan biaya.

Selama dikerjakan, tombolnya berganti menjadi `UPGRADING n%` dan busur di peti berputar cepat.

**3. Tiga level** (satu level untuk semua guard; bonus ×1,5 di wilayah panji tetap berlaku):

| Level | Biaya | Waktu | Damage per baut | Jeda tembak | Tembus | Yang terlihat |
|---|---|---|---|---|---|---|
| Lv1 | — | — | 10 | 1,6 dtk | — | crossbow satu tangan KayKit apa adanya (kayu + besi); baut biru muda |
| Lv2 | 12 emas + 10 kayu | 5 dtk | 14 | 1,4 dtk | — | crossbow yang sama, popor **biru kerajaan** dan besi terang, ×1,3; baut putih-biru yang lebih panjang |
| Lv3 | 18 emas + 14 kayu | 6 dtk | 18 | 1,25 dtk | 1 musuh | crossbow dua tangan KayKit sebagai **arbalest biru tua dengan fitting emas**, dipegang dua tangan (klip `2H_Ranged_*`), perisai disimpan; **baut emas** tebal |

Lv1 sama persis dengan guard sebelum BUILD 14.

**4. Saat upgrade selesai**, semua guard langsung memegang busur baru, siang maupun malam. Setiap guard mendapat kilatan dan cincin berwarna level, plus pop "Lv2"/"Lv3" dengan ikon crossbow di atas kepalanya. Banner "GUARD BOWS Lv2" muncul dan busur di peti ikut berganti.

**5. Dua stasiun di distrik tenggara.** Kartu armory kini bernama **CAPTAIN** (sebelumnya HUNTER), supaya dua stasiunnya jelas: CAPTAIN untuk kapten, GUARD BOWS untuk pasukan. Saat kapten dekat, keduanya menampilkan pill level (wajah kapten / ikon guard + Lv). Panah emas muncul saat upgrade-nya terjangkau, sama seperti di atas bangunan.

Warna busur Lv2/Lv3 dibuat dari **salinan** atlas `rogue_texture.png` di canvas saat runtime. Hanya swatch kayu dan besi yang dipakai crossbow yang diwarnai ulang, mengikuti gambar konsep `ASSET_CHARACTER/weapons/guard-crossbow-lv1..3`. Byte glTF/PNG KayKit tidak diubah (`assets/troops/kaykit/CREDITS.txt`).

### Bug lama yang ketemu: guard tidak pernah memegang crossbow

GLTFLoader menyanitasi nama node untuk binding animasi, sehingga `handslot.r` di GLB menjadi `handslotr` di scene. Kode lama mencari `handslot.r`, jadi crossbow **tidak pernah terpasang** dan guard menembak dengan tangan kosong sejak knight GLB dipakai. Diagnostics lama tidak memeriksa hal ini. Sekarang slot dicari dengan nama yang sudah disanitasi, dan diagnostics `guardBows` mencatat level busur di tangan setiap guard yang terlihat (dicek `survival-plotsqa`).

### Tiga catatan BUILD 13 yang diperbaiki

1. Penunjuk merah di tepi layar kini bergeser sepanjang tepinya, menjauh dari cincin stick (kiri bawah).
2. Penunjuk itu juga menjauh dari chip CAPTAIN (atas tengah).
3. Angka damage tidak lagi naik ke bawah kotak HUD atas (pause, pill NIGHT/DAY, counter, dan bar Keep). Langkah naik yang akan masuk ke HUD tidak dipakai, dan angka yang sedang naik berhenti tepat di bawah HUD.

Selain itu, ikon crossbow digambar tegak (busur di atas, popor ke bawah). Dalam posisi miring, ikon itu terbaca seperti beliung tambang.

### Balance

Enam bot lama hasilnya **sama persis dengan BUILD 13**: 30 baris run dan SUMMARY identik selain waktu proses. Ini karena Lv1 = GUARD lama dan jumlah angka acak per tembakan tidak berubah.

Bot baru `arms-builder` (barak → GUARD BOWS sampai Lv3 → Keep, tanpa tambang) **menang 5/5** dengan bintang 3, 1, 3, 1, 1. MVP-nya GUARDS dengan 54–62 kill. Jadi jalur ini bisa dipakai, tetapi tidak lebih kuat dari jalur kapten (hunter-builder 5/5 ★★★) atau jalur seimbang (builder 5/5 ★★★). Biaya dan kekuatan belum diuji pemain manusia.

### QA yang dijalankan (BUILD 14)

| Perintah | Hasil |
|---|---|
| `node tools/harness.mjs` | **70/70 cek PASS** (+4 cek BUILD 14: rak sebagai titik siang sendiri di distrik tenggara; biaya Lv2 12+10 / Lv3 18+14, satu job builder di rak, pop di tiap guard, Lv3 MAX; baut guard per level 10/1,6 dtk → 14/1,4 dtk → 18/1,25 dtk + tembus; level tersimpan, run baru mulai Lv1, save lama dimuat Lv1). Catatan: angka "67/67" di laporan BUILD 13 ikut menghitung satu baris log ekonomi yang memuat kata PASS. Jumlah cek sebenarnya waktu itu 66. |
| `node tools/survival-plotsqa.mjs` | **24/24 PASS** (+3 cek B14: kedua stasiun menampilkan level + panah, satu tombol `UPGRADE ARMS LV2` di dock, busur Lv1 di peti dan di tangan setiap guard; setelah dibeli muncul `UPGRADING ARMS`, lalu semua guard memegang busur Lv2 dengan pop + kilatan, dan Lv3 dipegang dua tangan; di malam hari guard Lv3 di menara menembak baut emas 18 yang tembus. Cek aset kini menghitung 17 pad = 15 plot + armory + rak). Run pertama 22/24: (1) cek malam B14 terlalu ketat, karena baut yang sudah menembus satu tubuh sisa tembusnya 0 — cek diperbaiki; (2) cek kamera "pinch dua jari di sisi stick" gagal sekali. Cek itu memakai jendela 320 ms waktu nyata, sedangkan frame headless bisa lebih lambat. Di reproduksi terpisah dan di run ulang cek itu PASS. |
| `node tools/survival-map.mjs` | **226/226** (+6 cek rak: bebas plot, tembok, dan props; cerminan plot luar barak NW; satu baris dengan armory dengan jarak rumput 134 px; distrik SE) |
| `node tools/survival-devqa.mjs` | **25/25 PASS** |
| `node tools/survival-intro.mjs` | **PASS** |
| `node tools/envqa.mjs --mode=3d-smoke` | **PASS** (41). Bukti FTUE `qa-evidence/survival-ftue-*` ikut diperbarui dengan stempel BUILD 14 |
| `node tools/survival-fxshots.mjs` | **14/14 PASS** |
| `node tools/layoutqa.mjs`, `glbtest.mjs`, `swtest.mjs` | **PASS** (`glbtest` +1 cek: glTF arbalest + klip 2H_Ranged Knight; `swtest` dengan `duskhold-v14`) |
| `node tools/survivalshots.mjs --landscape` | 26 shot, 0 page error |
| `node tools/survival-look.mjs` | 0 error (`day0`, `day`, `build`, `gate`, `fight`, `overview`, `closeup`) |
| `node tools/bundlecheck.mjs` | hanya 1 FAIL lama (fingerprint signing release, menunggu kunci upload) |
| `node tools/survival-balance.mjs --seeds=5 --duration=72` | enam bot lama **sama persis dengan BUILD 13**; `arms-builder` baru 5/5 menang (bintang 3, 1, 3, 1, 1; MVP GUARDS) |

**Bukti** (`qa-evidence/survival-build14/`):

- `guards-bows-lv1-lv2-lv3.png`: dua guard di Keep, frame yang sama, busur Lv1 / Lv2 / Lv3 (siang, zoom 1,6×);
- `night-bolts-lv1-lv2-lv3.png`: guard di menara gerbang selatan menembak di malam hari, warna baut per level, angka 10 / 14 / 18;
- `rack-lv1-lv2-lv3.png`: busur di peti rak senjata per level;
- `arms-card.png`: kapten di rak, kartu GUARD BOWS di dock (dari `survival-plotsqa`);
- `guards-lv3.png`, `night-gold-bolts.png`: dari `survival-plotsqa`;
- `day-stations.png`: kedua stasiun distrik tenggara dengan pill level + panah emas;
- `look-day.png`, `look-day0.png`, `look-fight.png`: shot standar `survival-look` (guard di Keep kini memegang crossbow);
- `map.png`: denah bailey dengan titik ARMS;
- `balance-5seed-72s.txt`.

**Belum / terbuka:**
- Penilaian manusia di HP: apakah busur guard terlihat di zoom normal. Di zoom 1,0 busur kecil; Lv3 emas yang paling terbaca, Lv2 baru jelas saat di-zoom. Juga belum dinilai: apakah rak senjata ditemukan tanpa penjelasan, dan apakah biaya serta rasa kekuatannya pas.
- Dalam pose Idle KayKit, busur dipegang rendah di samping kaki. Busur baru terlihat jelas saat guard membidik dan menembak di malam hari.
- Senjata kapten tetap menyatu dengan mesh Tripo-nya. Level kapten terlihat dari baut tembus (Lv2) dan kipas 3 baut (Lv3), bukan dari model busurnya.
- Konversi gambar `ASSET_CHARACTER` → GLB belum dikerjakan. Busur di game adalah mesh KayKit yang diwarnai ulang, bukan model dari gambar itu.

## Pass BUILD 13 — kapten terang, label dekat, angka damage, gerbang malam ini (2026-10-18)

**Pesan user:** "lanjut". Saya baca sebagai: lanjutkan pekerjaan yang tertunda. Keputusan BUILD 12 yang saya ambil sendiri (riset §11.4) tidak ditolak, jadi tetap dipakai.

Stempel di layar kini **BUILD 13**, service worker `duskhold-v13`.

Pekerjaan ini terdiri dari dua bagian:
1. **ASSET_CHARACTER:** 7 senjata yang tersisa sudah dibuat: kapak undead, palu Breaker, pedang Night Lord, crossbow kapten Lv2/Lv3, dan crossbow guard Lv2/Lv3. Folder kini lengkap **18/18** (6 karakter + 12 senjata), commit `e374747`. Semuanya tetap gambar konsep AI; belum ada GLB.
2. **BUILD 13:** empat usulan "murah tapi terlihat jelas" dari riset §7, yaitu V8, V4, V9, dan V10.

### V8 — kapten paling terang

Tekstur GLB kapten (Tripo) hampir hitam. Atlas warnanya (2048×2048) punya luminansi rata-rata 0,107 dan 81 % pikselnya di bawah 0,15 (skala 0–1). Atlas itu juga terdiri dari ribuan pulau UV kecil, jadi tidak bisa diwarnai per bagian.

Byte GLB tidak diubah. Sebagai gantinya, shader kapten memetakan terang-gelap teksturnya sendiri ke palet `ASSET_CHARACTER` opsi 1:

| Bagian | Warna |
|---|---|
| Tabard/mantel | navy → biru kerajaan `#216aad` → biru langit |
| Topi dan sepatu bot (dipilih dari tinggi badan di bind pose) | kulit cokelat `#68412d` |
| Bagian tekstur yang hangat | emas `#e6b459`; di wajah menjadi warna kulit |
| Rim light | biru-putih, lebih kuat di malam |

Tampilannya dipasang per fase lewat `CAPTAIN_LOOK` (siang/malam), hanya di mode Survival. Di mode lain, termasuk `?legacy=1`, tampilan ini mati.

**Hasil** (rata-rata luminansi piksel kapten saja, 0–255; frame dengan kapten dikurangi frame tanpa kapten; `survival-plotsqa`, 844×390, zoom 1,6×):

| Fase | Tekstur asli (BUILD 12) | BUILD 13 |
|---|---|---|
| Malam | 19,5 | 86,0 |
| Siang | 27,9 | 88,0 |

Versi pertama shader (semua biru terang, rim kuat) saya tolak sendiri setelah melihat screenshot-nya: kapten tampak seperti hantu/hologram biru. Versi yang dipakai menjaga bayangan tetap gelap dan memberi warna kulit cokelat pada topi dan sepatu bot.

File: `valen3d.js` (`setLook`, `lookState`), `world3d.js` (`CAPTAIN_LOOK`, `_syncLighting`, diagnostics `captainLook`).

### V4 — label hanya saat dekat

| Sebelum (BUILD 11–12) | Sekarang |
|---|---|
| 3 lingkaran kosong terdekat selalu menampilkan nama, sejauh apa pun | Nama **+ biaya** (merah kalau kurang) hanya untuk lingkaran ≤ 380 px dari kapten (± satu lingkaran). **Maksimal 2** sekaligus. Lingkaran lain hanya ikon di atas warnanya |
| Pill status (emas / kayu / prajurit / kill) di semua bangunan di layar | Hanya untuk bangunan ≤ 560 px dari kapten, atau bangunan tempat kapten berdiri |
| Label sama di semua zoom | Di zoom overview (≤ 0,62×) hanya ikon, tanpa nama dan pill |

Panah upgrade tetap tampil di semua bangunan yang bisa di-upgrade.

Tombol "lihat semua" dari riset tidak dibuat. Zoom overview (pinch keluar) sudah memperlihatkan semua titik sebagai ikon, dan pola FTUE yang dipilih user meminta tanpa tombol tambahan.

File: `ui/survival.js` (`PLOT_NAME_REACH`, `PLOT_NAMES_MAX`, `STATUS_REACH`, `OVERVIEW_ZOOM`, `drawPlotLabel`, `drawDayWorldLayer`).

### V9 — angka damage lebih kecil, di atas kepala, digabung

| | BUILD 12 | BUILD 13 |
|---|---|---|
| Ukuran kill / heavy / di wilayah panji / biasa | 40 / 32 / 28 / 23 px | **26 / 22 / 18 / 16 px** |
| Posisi | di dada | **di atas kepala** (tinggi dada ×1,55), ikut bergerak bersama tubuhnya |
| Pukulan beruntun | satu angka per pukulan | pukulan ke tubuh yang sama dalam **0,38 detik** dijumlah jadi satu angka. Angka itu membesar lagi sesaat ("pop") dan memakai grade terkuat (kill > heavy > biasa) |

Angka yang muncul di atas angka lain atau di atas bar HP kapten naik satu langkah (maksimal 3 langkah) dan tetap di langkah itu, jadi kerumunan di gerbang terbaca sebagai tumpukan pendek, bukan angka yang saling menimpa.

Efek hit (kilat, cincin, percikan) tidak diubah. Jumlah angka acak yang diambil per pukulan juga tetap sama, jadi run balance ber-seed identik dengan BUILD 12.

File: `game/survival.js` (`DMG_NUMBER`, `pushDamageNumber`, `_updateFx`), `ui/survival.js` (`drawFloaters`, `DMG_LANES`).

### V10 — gerbang malam ini terlihat di siang hari

`tonightPlan()` menghitung serangan malam berikutnya per gerbang. Rencananya sama dengan yang dipakai `updateWaves()`: gelombang swarm 1–3, 2 Individual, dan Breaker di gerbang utama (1 mulai malam 2, 2 di malam 3).

Di siang hari:
- gerbang yang ada di layar mendapat **badge merah** di atasnya: 🌙, ikon swarm ×N, ikon Individual, dan ikon Breaker;
- gerbang di luar layar ditunjuk dengan **penunjuk merah di tepi layar**, lengkap dengan jumlah totalnya;
- keduanya tidak tampil di bawah panel hadiah fajar.

Contoh malam 2:
- gerbang barat: 24;
- postern NW: 27;
- gerbang selatan: 27 + 1 Individual + 1 Breaker;
- gerbang utara: 1 Individual.

File: `game/survival.js` (`tonightPlan`), `ui/survival.js` (`drawTonightBadge`, `drawDayWorldLayer`).

### Yang tidak dikerjakan di pass ini

- **V2** (ballista tidak lagi merah): ballista tetap merah, sesuai keputusan BUILD 12 (riset §11.4).
- **V5** (diet HUD): HUD siang sudah ringkas sejak BUILD 9–12.
- **V1, V3, V6, V7**: butuh pass aset atau tata letak.
- **ASSET_CHARACTER:** konversi gambar → GLB, socket senjata di tangan, dan upgrade senjata pasukan di game.

### QA yang dijalankan (BUILD 13)

| Perintah | Hasil |
|---|---|
| `node tools/harness.mjs` | **67/67 PASS** (+2 cek baru: V10 ramalan siang = spawn malam 2 dan 3 per gerbang; V9 tiga pukulan dalam 0,4 detik = satu angka "30", mulai di atas kepala, ikut tubuhnya) |
| `node tools/survival-plotsqa.mjs` | **21/21 PASS** (+3 cek baru: V8 piksel kapten malam 86,0 vs tekstur asli 19,5 dan siang 88,0 vs 27,9; V4 tiga lingkaran dalam jangkauan → 2 nama, overview → 0 nama dan 0 pill; V10 keempat gerbang malam 2 ditandai, urutannya sama dengan rencana) |
| `node tools/survival-map.mjs` | **220/220** (tata letak tidak berubah) |
| `node tools/survival-devqa.mjs` | **25/25 PASS** |
| `node tools/survival-intro.mjs` | **PASS** |
| `node tools/envqa.mjs --mode=3d-smoke` | **PASS** (bukti FTUE `qa-evidence/survival-ftue-*` ikut diperbarui: kapten biru, stempel BUILD 13) |
| `node tools/survival-fxshots.mjs` | **14/14 PASS** |

Setelah angka damage dibuat bertumpuk (perubahan terakhir, hanya kode gambar), `devqa`, `envqa`, dan `fxshots` dijalankan lagi dan hasilnya tetap sama.
| `node tools/layoutqa.mjs`, `glbtest.mjs`, `swtest.mjs` | **PASS** (`swtest` dengan `duskhold-v13`) |
| `node tools/survivalshots.mjs --landscape` | 26 shot, 0 page error |
| `node tools/survival-look.mjs` | 0 error (`day0`, `day`, `build`, `gate`, `fight`, `overview`, `closeup`) |
| `node tools/bundlecheck.mjs` | hanya 1 FAIL lama (fingerprint signing release, menunggu kunci upload) |
| `node tools/survival-balance.mjs --seeds=5 --duration=72` | **sama persis dengan BUILD 12** di 30 baris run dan SUMMARY (selain waktu proses): idle 0/5, active 0/5, builder 5/5 ★★★, tower-builder 5/5 ★★★, hunter-builder 5/5 ★★★, keep-builder 0/5. Aturan main tidak berubah |

**Bukti** (`qa-evidence/survival-build13/`):
- `captain-compare.png`: kapten BUILD 12 vs BUILD 13, malam dan siang, frame yang sama;
- `compare-day0.png`, `compare-fight.png`, `compare-overview.png`: BUILD 12 vs BUILD 13 dari skrip `survival-look` di momen yang sama;
- `captain-day.png`, `names-near.png` (2 nama + 1 ikon di distrik tambang), `overview-tonight.png` (badge gerbang malam ini): dari `survival-plotsqa`;
- `day0.png`, `day.png`, `build.png`, `fight.png`, `overview.png`, `closeup.png`;
- `balance-5seed-72s.txt`.

**Belum / terbuka:**
- Penilaian manusia di HP atas keempat perubahan: apakah kapten terbaca tanpa terlihat seperti hantu atau hologram, apakah nama yang hanya muncul saat dekat masih cukup untuk mengenali bangunan, apakah angka yang lebih kecil masih terasa kuat, dan apakah pemain bisa menyebut gerbang malam ini sebelum menekan NIGHT (uji riset §8).
- Di layar landscape 844×390, penunjuk merah gerbang di tepi kiri bawah bisa berdekatan dengan cincin stick; di zoom overview penunjuk atas bisa menempel pada chip CAPTAIN. *(Diperbaiki di BUILD 14.)*
- Angka damage yang naik langkah bisa masuk ke bawah pill NIGHT saat gerbang ada di tepi atas layar. *(Diperbaiki di BUILD 14.)*
- Kapten masih model Tripo yang sama. Shader hanya mewarnai ulang teksturnya; detail seperti sabuk atau sarung tangan tidak bisa diberi warna sendiri.

## Pass BUILD 12 — tata letak Opsi B + kamera dinamis (2026-10-18)

**Pesan user:** "untuk opsi nya B tapi cek dulu peta ROK dan jarak kamera nya bisa di pebesar perkecil geser jadi camera dinamis".

Stempel di layar kini **BUILD 12**, service worker `duskhold-v12`.

### 0. Cek peta Rise of Kingdoms (sebelum koding)

Hasilnya ada di `docs/VISUAL-LAYOUT-RESEARCH.md` §11 (beserta sumbernya). Pola yang diambil:
- cincin terbuka di balik dinding;
- satu titik fokus di tengah, dengan plaza tempat semua jalan bertemu;
- distrik per fungsi;
- rumpun pohon di ruang negatif;
- bangunan penting tidak tertutup objek tinggi;
- tata letak dicek di beberapa level zoom.

Untuk kamera: zoom dua jari yang mulus, satu jari untuk menggeser, dan tombol −/+ di layar (permintaan pemain mouse RoK).

Yang tidak diambil:
- layer UI per level zoom;
- menu radial zoom;
- kota yang bebas disusun (di RoK susunan kota murni dekorasi; di game kita posisi = fungsi + jarak gerbang).

### 1. Tata letak Opsi B

| Perubahan | File |
|---|---|
| **Bailey ×1,6:** `FORT_SCALE` 0,5 → 0,8, jadi **2080×1520 px** (dulu 1300×950). Ukuran bangunan, aktor, dan zoom normal **tidak berubah**: dunianya yang membesar. Gerbang utara/selatan 773 px dari Keep, barat/timur 1053 px; postern NW/SE | `fortress.js` |
| **Plaza Keep** r235 (batu, kerb, cincin dalam). **Empat jalan** selebar 260 px (dulu 450/320) bertemu di plaza | `fortress.js` (`PLAZA_R`, `ROAD_HALF`), `world3d.js` |
| **15 plot yang sama, dikelompokkan per distrik:** NW barak ×3 (biru), NE tambang ×3 (kuning), SW sawmill ×3 (hijau), SE armory + sumur. Ballista ×6 di samping gerbangnya (N/S/W/E Lv1, postern NW/SE Lv2). Unlock tetap Lv1 9 / Lv2 13 / Lv3 15. Level unlock kini tertulis di tiap slot (`slot.level`) | `survival.js` (`SURVIVAL_SLOTS`, `PLOT`) |
| **Wilayah panji = radius dari Keep**, dipotong di dinding: Lv1 900 / Lv2 1100 / Lv3 1400 px. Lv3 menutup seluruh bailey. Di 3D tampil sebagai bidang biru tipis dengan garis tepi (menggantikan tint per ruangan) | `survival.js` (`BANNER`, `inTerritory`, `territoryPlots`), `world3d.js` (`_makeBannerWash`) |
| **Dekor distrik** (22 props KayKit CC0, digabung jadi **1 mesh**): boneka panah + rak senjata di barak, batu + gerobak di tambang, tumpukan kayu di sawmill, peti/tong/karung dekat sumur, 4 rumpun pohon di sudut, 3 pohon tunggal di sudut plaza. **7 model alam baru** (14 file .gltf/.bin) dari commit KayKit yang sama; hash blob dicek, sha256 di `CREDITS.txt`, byte tidak diubah | `fortress.js` (`furnish`), `buildings3d.js`, `world3d.js` (`mergeKitStatic`), `envkit.js`, `assets/buildings/kaykit-hex/` |
| **Ballista atap Keep** 440/500 → **600/700 px**, karena gerbang kini lebih jauh | `survival.js` (`KEEP.ballista`) |
| **Kapten mulai di jalan timur**, 240 px dari Keep. Jangkauan kartu Keep 200 → **250 px** (plaza + kerb), jadi kartu Keep tetap yang pertama muncul pagi hari | `survival.js` (`PLOT.home`, `CIRCLE.keepReach`), `fortress.js` |
| Kotak bayangan matahari mengikuti kamera dan membesar saat zoom jauh | `world3d.js` (`_syncLighting`) |

**Diukur (`tools/survival-map.mjs`, 220/220 cek):**
- celah rumput antar-pad ekonomi min **134 px** (dulu median 62 px antar-plot);
- plot ekonomi ke dinding min **192 px** (dulu 62);
- tiap distrik hanya satu jenis bangunan;
- panji tiap level mencapai semua plot levelnya;
- dekor tidak di jalan, plaza, atau garis tembak ballista mana pun.

Denah: `qa-evidence/survival-build12/plan.png`.

### 2. Kamera dinamis

| Perubahan | File |
|---|---|
| **Zoom 0,42–1,6×** dari frame normal (dulu 0,8–1,3). Paling jauh, **seluruh bailey (dinding ke dinding) muat** di HP landscape 844×390. Paling dekat, satu distrik | `survival.js` (`SURVIVAL_CAMERA`) |
| **Pinch dua jari di mana saja.** Juga kalau jari pertama mendarat di sisi stick: jari kedua dalam 320 ms dan sebelum stick bergeser 18 px mengubahnya jadi pinch. Zoom berpusat di titik tengah jari, dan titik tengah ikut menggeser peta. **Kapten tidak bergerak** | `input.js` (`_startPinch`, `PINCH_GRACE_*`) |
| **Tombol + / −** di tepi kanan layar, siang dan malam. Tombol meredup di ujung rentang. Satu tap = ×1,35, dengan transisi halus | `ui/survival.js` (`zoomButtonLayout`, `drawZoomButtons`), `ui/survivalIcons.js` |
| **Keyboard + / −** dan **roda mouse**. Roda zoom di titik kursor, sehingga tanah di bawah kursor tetap di tempatnya | `input.js` (`KEYMAP`), `survival.js` (`_zoomBy`) |
| **Geser:** drag sisi kanan. **Lemparan** meluncur lalu berhenti. Chip CAPTAIN atau tap di tanah mengembalikan kamera ke kapten; saat kapten berjalan kamera ikut kembali pelan | `survival.js` (`_steerCamera`) |
| Zoom pilihan pemain **disimpan** (`save.survival.camZoom`). Intro berakhir di zoom itu | `survival.js` |
| Chip hint sekali: "PINCH OR TAP + / - TO ZOOM" | `ui/survival.js` |

### QA yang dijalankan (BUILD 12)

| Perintah | Hasil |
|---|---|
| `node tools/harness.mjs` | **65/65 PASS** (titik uji panji, plot 9 → 13 → 15, skala, jangkauan ballista atap diperbarui) |
| `node tools/survival-map.mjs` | **220/220** (cek B baru: ukuran, distrik, celah, dinding, panji, dekor) |
| `node tools/survival-plotsqa.mjs` | **18/18 PASS**. Cek kamera baru: roda 0,42–1,6; zoom di titik kursor (geser 2,7 px); pinch di mana saja tanpa kapten bergerak; tombol dan keyboard +/−; lemparan; zoom terjauh memuat keempat sudut bailey |
| `node tools/survival-devqa.mjs` | **25/25 PASS** |
| `node tools/survival-intro.mjs` | **PASS** |
| `node tools/envqa.mjs --mode=3d-smoke` | **PASS** (panji 900 px, dekor 22 props dalam 1 mesh, HUD malam hanya PAUSE + tombol zoom, upgrade Keep membuka plot 9 → 13 dan panji 900 → 1100) |
| `node tools/survival-fxshots.mjs` | **14/14 PASS** |
| `node tools/layoutqa.mjs`, `glbtest.mjs`, `swtest.mjs` | **PASS** |
| `node tools/survivalshots.mjs --landscape` | 26 shot, 0 page error |
| `node tools/bundlecheck.mjs` | hanya 1 FAIL lama (fingerprint signing release, menunggu kunci upload) |
| `node tools/survival-balance.mjs --seeds=5 --duration=72` | idle 0/5, active 0/5, builder **5/5 ★★★**, tower-builder **5/5 ★★★**, hunter-builder **5/5 ★★★**, keep-builder 0/5 (BUILD 11: 1/5) |

**Balance:** bot yang membangun tetap ★★★ di kelima seed, sama dengan BUILD 11. keep-builder (hanya menaikkan Keep, strategi yang memang lemah) turun 1/5 → 0/5. Ketika kapten mulai di 190 px dari Keep, satu seed jatuh ke ★ di Malam 1; di 240 px kelimanya bertahan, jadi 240 yang dipakai. Lari kapten dan jangkauan menara **tidak** diubah.

**Bukti** (`qa-evidence/survival-build12/`):
- `compare-day0.png`, `compare-day.png`, `compare-build.png`: BUILD 11 vs BUILD 12, skrip `survival-look` dan momen yang sama;
- `overview.png`: zoom terjauh, seluruh bailey;
- `closeup.png`: zoom terdekat di distrik barak;
- `day0.png`, `day.png`, `build.png`, `fight.png`;
- `plan.png`: denah dari `survival-map`;
- `balance-5seed-72s.txt`.

**Belum / terbuka:**
- Apakah bailey ×1,6 terasa lapang tanpa terasa kosong, dan apakah distrik terbaca tanpa label, belum dinilai manusia di HP.
- Rasa pinch, tombol +/−, dan lemparan di layar sentuh nyata belum dinilai. QA memakai sentuhan emulasi di Chromium headless.
- Jalan ke gerbang ±60 % lebih jauh. Bot tetap menang, tetapi apakah terasa lambat bagi pemain belum diuji. Lari +15 % disiapkan sebagai opsi, tidak dipasang.
- Frame time zoom terjauh (seluruh bailey + hutan di layar) di HP kelas bawah belum diukur. Di Chromium headless (SwiftShader) 1 frame ±5–6 ms di kedua zoom.
- Keputusan §9 yang saya ambil sendiri (×1,6, ballista di halaman, tanpa rumah warga, panji radius, warna V2 tetap) menunggu konfirmasi user (riset §11.4).
- Kapten di game masih gelap (siluet hitam). Ini sudah begitu sejak BUILD 8 dan tidak diubah di pass ini (lihat acceptance 14). *(Diperbarui: dicerahkan di BUILD 13, V8.)*

## Riset visual & tata letak (2026-10-17) — riset saja, belum ada kode

**Pesan user:** "masih sama ukuran world nya, tata letak bangunan masih sama, coba kamu research dulu visual game building dan combat seperti ini jangan coding dulu, cari detail ui ux dan visual nya, bandingkan dengan game ini".

**Dokumen:** `docs/VISUAL-LAYOUT-RESEARCH.md`. Gambar pendukung:
- `docs/research/build11-annotated.jpg`: anotasi layar siang/malam kita;
- `docs/research/visual-layout-options.png`: denah sekarang dan opsi A/B/C pada skala dunia yang sama.

**Pembanding:** Thronefall, Duck Survival, Kingdom Rush, Kingdom Two Crowns, Bad North, Dawn Defender, plus pola dari Diplomacy is Not an Option dan Clash of Clans.

**Temuan utama, diukur dari kode BUILD 11:**
- Bailey dan plot tidak berubah dari BUILD 10, jadi layar user terlihat sama.
- Benteng = 0,8 layar: semua plot, menara, dan gerbang selalu terlihat sekaligus.
- Kapten 18 % tinggi layar dan Keep >50 % tinggi layar.
- Celah antar-plot median 0,46× lebar bangunan; plot hanya 62 px dari dinding.
- 0 % plot bertetangga dengan jenis yang sama (tanpa zonasi).
- Tempur terjadi di celah gerbang, di balik menara.
- Merah dipakai untuk ballista sekaligus untuk musuh.

**Usulan (belum dikerjakan):**
- **Opsi B (rekomendasi):** bailey ×1,6 (2080×1520) atau ×1,4, dengan 15 plot yang sama dikelompokkan per kuadran (barak NW, emas NE, kayu SW, armory + warga SE, ballista di gerbang).
- **Opsi A:** pola Thronefall, benteng inti + kota luar.
- **Opsi C:** ukuran tetap, isi dikurangi.
- **Paket visual/UI V1–V10.**

Keputusan user yang dibutuhkan ada di §9 dokumen itu. *(2026-10-18: user memilih Opsi B → "Pass BUILD 12".)*

## Pass BUILD 11 — kapten tidak jalan sendiri, bailey tidak padat, bangunan dikenali (2026-10-17)

**Pesan user (2026-10-17):**
1. "ada bug pada character berjalan sendiri keluar dari benteng tanpa ada musuh mentriger nya keluar dan keluarnya juga tembus benteng bukan lewat gerbang sedangkan musuh datang dari gerbang lain".
2. "struktur bangunan juga masih perlu di perbaiki karna yg ada sekarang lebar benteng dengan compenent di dalam terlihat sangat padat dan itu membuat mata pemain susah fokos dan tidak tau build yg mana".

Stempel di layar kini **BUILD 11**, service worker `duskhold-v11`.

### 1. Bug: kapten berjalan sendiri dan keluar benteng

**Penyebab yang ditemukan.** Tes headless dijalankan: satu malam penuh tanpa sentuhan sama sekali. Hasilnya, kapten tetap bergeser sendiri, (190, 0) → (171, 19). Ada tiga gaya yang menggerakkan kapten tanpa input:
- **Tendangan balik tembakan.** Sejak BUILD 8 ("tembakan harus terasa kuat") setiap tembakan otomatis memberi kapten kecepatan 40 px/dtk ke belakang. Tembakan otomatis datang tiap 0,46 dtk, jadi kapten meluncur menjauhi target.
- **Dorongan cakaran:** 150 px/dtk setiap kali kena.
- **Goyangan HP rendah:** mekanik vampir lama dari mode legacy.

Sejak BUILD 10 gerbang terbuka untuk kapten. Dorongan ke arah gerbang (yang kecepatannya lebih dari ambang "berjalan ke gerbang") ikut membuka gerbang, lalu kapten terseret keluar. Musuhnya ada di gerbang lain, yaitu gerbang yang sedang ia tembak. Postern di dinding barat/timur adalah gerbang kecil sehingga bisa terlihat seperti "tembus dinding".

Uji 660 percobaan jalan ke dinding dari setiap sisi tidak menemukan satu pun kebocoran: tabrakan dinding/menara sehat. Kapten hanya bisa lewat bukaan gerbang.

| Perbaikan | File |
|---|---|
| Tembakan kapten di Survival **tidak lagi mendorong badannya**. Kilatan moncong dan klip tembak 3D tetap ada | `game.js` (`playerAttackHit`) |
| Cakaran **tidak lagi mendorong** kapten di Survival. Flash dan animasi kena tetap ada. Goyangan HP rendah tidak berlaku di Survival. Mode legacy tidak berubah | `player.js` (`takeDamage`, gerak) |
| Gerbang terbuka **hanya untuk arah stick/tombol** pemain yang menuju gerbang, bukan untuk gerak badan. Gerbang yang tertutup kini menjadi **tembok juga bagi kapten** (`sortieT > 0` baru boleh lewat). "Di mulut gerbang" kini 24 px dari garis tembok, lebih sempit dari tempat gerbang tertutup menahannya (26 px), jadi hanya berjalan lewat gerbang yang sedang terbuka yang membawanya ke sana | `survival.js` (`updateSortieGates`, `SORTIE`), `mansion.js` (`resolve`) |
| Stick mouse dilepas kalau tombol mouse ternyata sudah terangkat di luar frame preview (mouseup tidak sampai) | `input.js` |

**Cek baru di harness:**
- Selama 6 dtk tembakan otomatis (13 tembakan) ditambah satu cakaran dan HP 12, kapten bergeser **0,00 px**.
- Kapten yang dilempar ke gerbang tertutup tanpa stick berhenti di depan gerbang. Dengan stick ke gerbang, gerbang membuka dan ia keluar.

### 2. Bailey padat dan bangunan tidak dikenali

| Perubahan | File |
|---|---|
| **Satu warna per bangunan**, dari pack yang sama (varian warna resmi KayKit, atlas sama): BARRACKS **biru**, GOLD MINE **kuning**, SAWMILL **hijau**, BALLISTA **merah**. Warna yang sama dipakai di atap model, lingkaran di tanah, label, bingkai pil status, dan ikon kartu dock. Model mine/lumbermill/tower biru diganti varian kuning/hijau/merah (6 file, hash blob dicek terhadap commit upstream yang sama; sha256 di `CREDITS.txt`) | `buildings3d.js` (`BUILDING_COLOR`), `assets/buildings/kaykit-hex/`, `world3d.js`, `ui/survival.js` |
| **Tiang hantu transparan di setiap plot dihapus.** Model tembus pandang kini hanya muncul di lingkaran tempat kapten berdiri (1, bukan 15) | `world3d.js` (`_syncSurvivalCircles`) |
| **Plot terkunci tidak tampil sama sekali**: tidak ada lingkaran, badge gembok, atau pad. Plot itu muncul saat panji keep sampai ke halamannya | `world3d.js`, `ui/survival.js` |
| **Label di atas pad** (bukan badge melayang tinggi): ikon dengan warna bangunannya, dan **nama** (BARRACKS / GOLD MINE / SAWMILL / BALLISTA / BARRICADE) pada 3 plot terdekat. Plot lain hanya ikon berwarna. Ketuk label = jalan ke sana | `ui/survival.js` (`drawPlotLabel`) |
| **Props dikurangi:** 16 barel/peti di sepanjang dinding dan meja pasar dihapus. Tinggal satu tumpukan di gerbang utama dan kembarannya di gerbang utara, plus sumur | `fortress.js` (`furnish`) |

**Balance setelah kedua perbaikan** (5 seed, malam 72 dtk; `qa-evidence/survival-build11/balance-5seed-72s.txt`):

| Bot | BUILD 11 | BUILD 10 |
|---|---|---|
| idle | 0/5 | 0/5 |
| active | 0/5 | 0/5 |
| builder | 5/5 ★★★ ×5 | 5/5, ★★★ ×4 |
| tower-builder | 5/5 ★★★ ×5 | 5/5 ★★★ ×5 |
| keep-builder | 1/5 | 0/5 |
| hunter-builder | 5/5 ★★★ ×5 | 5/5 ★★★ ×5 |

**QA BUILD 11:**

| Perintah | Hasil |
|---|---|
| `node tools/harness.mjs` | 65 PASS / 0 FAIL (+2 cek bug kapten) |
| `node tools/survival-devqa.mjs` | 25/25 (cek siang kini: tepat 1 hantu, di lingkaran kapten) |
| `node tools/survival-plotsqa.mjs` | 13/13 |
| `node tools/survival-intro.mjs` | PASS |
| `node tools/survival-map.mjs` | 178/178 |
| `node tools/survival-fxshots.mjs` | 14/14 |
| `node tools/envqa.mjs --mode=3d-smoke` | PASS |
| `node tools/survivalshots.mjs --landscape` | 26 shot, 0 page error |
| `node tools/layoutqa.mjs` | PASS (termasuk `?legacy=1`) |
| `node tools/glbtest.mjs` / `swtest.mjs` | PASS / PASS (`duskhold-v11`) |
| `node tools/bundlecheck.mjs` | 1 FAIL lama (fingerprint signing) |

**Bukti** (`qa-evidence/survival-build11/`): `compare-day0.png` (siang pertama, belum ada bangunan), `compare-day.png` (4 bangunan), dan `compare-build.png` (kapten di lingkaran ballista). Ketiganya BUILD 10 vs BUILD 11, skrip `survival-look` dan momen yang sama. Juga `day0.png`, `day.png`, `build.png`.

**Belum / terbuka:**
- Apakah bailey kini cukup lapang, dan apakah warna + label membuat pemain langsung tahu bangunan mana, belum dinilai manusia di HP.
- Ukuran bailey dan zoom kamera **tidak** diubah (keduanya sudah diatur di pass sebelumnya). Pinch zoom 0,8–1,3× tetap ada.
- Warna kuning tambang di model KayKit kecil (aksen); identitasnya terutama dari lingkaran, label, dan pil.
- Rekaman bug asli dari user tidak ada. Perbaikan didasarkan pada penyebab yang direproduksi (dorongan tanpa input + gerbang terbuka).

## Pass BUILD 10 — gerbang tertutup, kapten keluar benteng, ASSET_CHARACTER (2026-10-17)

**Pesan user (2026-10-17):**
1. Karakter utama terasa tidak sinkron: "game nya cerah tapi karakter nya gelap". Minta gambar karakter, pasukan, musuh, dan boss dalam satu folder **ASSET_CHARACTER**. Karakter harus **manusia, bukan chibi**, dan sesuai tema serta warna game.
2. **Senjata dibuat terpisah**, supaya bisa dianimasikan ke setiap karakter dan senjata pasukan bisa di-upgrade.
3. **Gerbang:** "gerbang selalu tertutup tapi tembakan tetap kena". Untuk menghadapi musuh, pemain harus keluar benteng.

Pilihan user lewat pertanyaan:
- Gambar kapten: opsi 1.
- Gerbang: **"Musuh tetap tertahan"**. Gerbang terbuka hanya untuk kapten dan pasukan; musuh harus menghancurkannya.
- Guard di malam hari: **"Jaga di atas menara gerbang"** (kiri dan kanan gerbang, menembak dari atas tembok).

### 1–2. ASSET_CHARACTER

Folder `ASSET_CHARACTER/` ada di root repo (commit `28569a0`). Isinya dijelaskan lengkap di `ASSET_CHARACTER/README.md`:
- 6 karakter dalam pose A, tangan kosong, menghadap depan: kapten, guard, ghoul, prajurit mayat, pendobrak, dan boss **Raja Malam**.
- 5 senjata terpisah: crossbow kapten Lv1, pedang kapten, crossbow guard Lv1, perisai guard, golok ghoul.
- Versi PNG transparan, lembar preview, palet warna, `prompts.json`, dan `SHA256SUMS.txt`.

Gambar ini **gambar AI**, dibuat atas permintaan eksplisit user. Statusnya konsep/referensi untuk alur gambar → model 3D (Tripo, seperti Hunter sekarang):
- **tidak** dimuat game;
- tidak masuk daftar SHELL service worker;
- tidak dicek bundlecheck.

Aturan provenance tetap berlaku untuk aset game. Aset berlisensi (KayKit, Quaternius) tidak disentuh.

**Belum:**
- 7 senjata masih menyusul karena batas 10 gambar per turn: kapak prajurit mayat, palu pendobrak, pedang besar Raja Malam, serta crossbow kapten dan guard Lv2/Lv3. Prompt-nya sudah ada di `prompts.json` dengan status `planned`.
- Konversi ke GLB dan pemasangan senjata ke tulang tangan (socket) belum dikerjakan. Kapten di game masih GLB Tripo lama yang gelap.

### 3. Aturan gerbang (BUILD 10)

Stempel di layar kini **BUILD 10**, service worker `duskhold-v10`.

| Aturan | Perubahan | File |
|---|---|---|
| Gerbang tertutup menahan tembakan | Celah tembak ("door slits") dihapus. Baut kapten dan guard di tanah berhenti di gerbang tertutup seperti di dinding: ada percikan dan suara benturan, gerbang tidak rusak. Line of sight `autoTarget` tidak lagi menembus pintu. Hint lama "GO TO THE GATE: SHOOT THROUGH IT" diganti **"WALK OUT A GATE TO FIGHT THEM"** | `enemies.js` (`Bolt.update`), `game.js` (`spawnBolt`), `mansion.js` (`blocksSight`), `survival.js` (`autoTarget`), `ui/survival.js` |
| Gerbang terbuka untuk kapten | Saat kapten berjalan masuk ke mulut gerbang, daun gerbang berayun terbuka ke dalam (0,35 dtk). Gerbang tetap terbuka selama kapten berdiri di bukaan, lalu menunggu 0,4 dtk dan menutup lagi (0,5 dtk). Kapten bisa berjalan menembus gerbang mana pun; musuh tetap tertahan sampai gerbang hancur. Selama gerbang terbuka, LOS dan baut lewat | `survival.js` (`updateSortieGates`, `SORTIE`), `mansion.js` (`resolve`), `envkit.js` (ayunan daun) |
| Di luar, musuh mengejar kapten | Kapten dianggap terbuka kalau ia di luar tembok atau berdiri di mulut gerbang. Saat itu badan swarm dan musuh individual dalam radius 155 px meninggalkan gerbang dan mengejarnya. Paling banyak 6 sekaligus; mereka menyerah kalau kapten menjauh lebih dari 225 px. Di mulut gerbang, cakaran menjangkau lewat bukaan. Breaker tetap fokus ke gerbang. Lari kapten (196 px/dtk) lebih cepat dari kejaran (77–90), jadi menembak sambil menjauh bisa dilakukan. Chip sekali: **"OUT HERE THEY COME FOR YOU"** | `survival.js` (`goForCaptain`, `claimCaptain`) |
| Istirahat di balik tembok | Kematian kapten berarti run kalah, jadi keluar benteng harus ada ongkosnya, tetapi juga ada pemulihan. Di dalam tembok, setelah 1,5 dtk tanpa cakaran, kapten pulih **12 HP/dtk** dengan "+" hijau di atasnya. Di luar tidak pulih | `survival.js` (`updateRest`) |
| Guard di atas menara gerbang | Pos malam guard kini di atas: dua puncak menara gerbang besar, atau panggung kayu di balik tembok di kiri-kanan postern. Guard berjalan ke kaki **tangga kayu** di sisi halaman, memanjat (0,7 dtk), lalu menembak dari atas tembok dengan jangkauan 460 px. Di atas sana **tidak ada cakaran yang sampai**. Saat fajar mereka turun | `fortress.js` (`wallPosts`), `survival.js` (`_doorPost`, `_climb`, `guardTarget`), `world3d.js` (tangga, panggung, tinggi guard) |
| Tembakan dari tempat tinggi melengkung lewat tembok | Ballista, ballista atap keep, dan guard di menara menembak **melewati** tembok. Baut terbang melengkung yang dihitung supaya melewati merlon atau menara, lalu turun ke musuh. Target ballista tidak lagi dibatasi garis lewat gerbang, cukup dalam jangkauan | `enemies.js` (flag `over`), `survival.js` (`towerTarget`), `world3d.js` (`_boltArc`) |

**Balance** (`survival-balance.mjs`, 5 seed, malam 72 dtk). Bot `active`/`builder` kini menahan gerbang dari mulutnya, lalu mundur untuk istirahat saat HP < 50 % (`tools/survival-bots.mjs`, `peekSpot`). Mereka keluar-masuk hanya lewat gerbang (`travel`).

| Bot | BUILD 10 | BUILD 9 |
|---|---|---|
| idle | 0/5 (kalah malam 1) | 0/5 |
| active | 0/5 | 0/5 |
| builder | 5/5, ★★★ ×4, ★ ×1 | 5/5 ★★★ |
| tower-builder | 5/5 ★★★ ×5 | 5/5, ★★★ ×4 |
| keep-builder | 0/5 | 0/5 |
| hunter-builder | 5/5 ★★★ ×5 | 5/5 ★★★ |

Kapten tidak pernah mati di 30 run itu. HP gerbang tidak diubah.

Catatan:
- Pada malam 60 dtk (setelan harness), builder BUILD 10 menang 3/5 dengan bintang 1/0/3/1/0. BUILD 9 di setelan yang sama: 3/5 dengan bintang 0/1/0/3/3. Malam pendek tetap lebih sulit, sama seperti sebelumnya.
- Log balance: `qa-evidence/survival-gate10/balance-5seed-72s.txt` dan `balance-5seed-60s-builder.txt`.
- Cek R1/R2 harness kini mensyaratkan ★ ≥ 1, bukan ≥ 2. Pembukuannya tetap dicek persis.
- Guard di menara tidak bisa tercakar, jadi ★★★ (tidak ada guard hilang) jadi lebih mudah.

**QA yang dijalankan di BUILD 10:**

| Perintah | Hasil |
|---|---|
| `node tools/harness.mjs` | 63 PASS / 0 FAIL. Cek baru: gerbang tertutup menahan tembakan; gerbang terbuka untuk kapten dan menahan musuh; musuh mengejar di luar (maks 6, Breaker tidak, menyerah); istirahat 12 HP/dtk hanya di dalam; guard memanjat, kebal di atas, menembak lewat tembok, turun saat fajar; ballista menembak lewat tembok tetapi tidak di luar jangkauan |
| `node tools/survival-devqa.mjs` | 25/25 PASS |
| `node tools/survival-plotsqa.mjs` | 13/13 PASS |
| `node tools/survival-intro.mjs` | PASS |
| `node tools/survival-map.mjs` | 178/178 (satu barel di dinding barat/timur digeser 23 px, menjauh dari tangga postern) |
| `node tools/survival-fxshots.mjs` | 14/14 PASS |
| `node tools/envqa.mjs --mode=3d-smoke` | ENVQA PASS (merlon utuh, panggung postern di balik tembok) |
| `node tools/survivalshots.mjs --landscape` | 26 shot (+ `night-out`), 0 page error |
| `node tools/layoutqa.mjs` | PASS (termasuk `?legacy=1`) |
| `node tools/glbtest.mjs` / `swtest.mjs` | PASS / PASS (`duskhold-v10`) |
| `node tools/bundlecheck.mjs` | 1 FAIL lama (fingerprint signing) |

**Bukti** (`qa-evidence/survival-gate10/`):
- `compare-gate.png`, `compare-fight.png`: BUILD 9 (kapten di balik gerbang tertutup tetap mengenai musuh) vs BUILD 10 (gerbang terbuka untuk kapten, musuh tertahan, guard di menara). Skrip `survival-look` yang sama, detik yang sama.
- `gate.png`, `fight.png`, `outside.png`, `posts.png`.
- `land-night-door.png`, `land-night-out.png` (dengan chip "OUT HERE THEY COME FOR YOU"), `land-tower-night.png`.

**Belum / terbuka:**
- Rasa ritme "masuk mulut gerbang → mundur istirahat" dan keluar benteng belum dinilai manusia, termasuk apakah 12 HP/dtk terlalu murah atau batas 6 pengejar terlalu berat.
- Guard di puncak menara gerbang utara bisa berada di tepi atas layar, sebagian tertutup panel jam, saat kapten berdiri dekat gerbang itu.
- Daun gerbang adalah daun pintu kit yang diregangkan (sama seperti sebelumnya). Belum ada gerbang besar khusus.
- Bot `active` (tanpa membangun) tetap kalah di malam 2, sama seperti BUILD 9.

## Pass perbaikan BUILD 9 — kamera, plot rapi, aset bangunan, kartu kecil, trailer (2026-10-17)

**Pesan user (2026-10-17):** "ada beberapa masih perlu di fix":
1. "camera terlalu dekat harus jauhkan sedikit jarak nya dan bisa di geser";
2. "letak build bangunan masih belum rapi";
3. "bangunan yg di build belum memakai asset visual yg layak dan tepat masih berupa prototype harus cari dan dowload asset dari platform penyedia asset free";
4. "card juga masih besar masih mamakan banyak tempat pada frame gameplay nya";
5. "tralier toturial yg sebelum nya di buat di Awal itu hilang, harusnya itu di pertahan kan".

**Implementasi** (di kode; belum acceptance). Stempel di pojok kiri bawah kini **BUILD 9** (`index.html`), service worker `duskhold-v9`:

| Poin | Perubahan | File |
|---|---|---|
| 1. Kamera terlalu dekat + bisa digeser | `FRAME_CLOSER` 1,3 → **1,1**: zoom malam landscape 0,775 → **0,655** (±18 % lebih banyak bailey tiap arah). **Kamera bisa digeser:** stick mengambang kini memakai **separuh kiri** layar; **drag di separuh kanan** menggeser pandangan 1:1 (tanah mengikuti jari, kapten tidak bergerak). **Dua jari** di separuh kanan (pinch) atau **roda mouse** mengatur zoom 0,8–1,3× dari frame, dan pilihannya disimpan (`save.survival.camZoom`). Pandangan kembali ke kapten saat ia berjalan, saat chip **CAPTAIN** (muncul di bawah pil fase bila pandangan digeser jauh) diketuk, atau saat tanah kosong diketuk. Batas: pusat pandangan tetap di atas bailey + 160 px. Sinematik tetap mengendalikan kamera sendiri (geseran di-reset). Chip FTUE baru "DRAG THE RIGHT SIDE TO LOOK AROUND" (sekali, di siang pertama setelah membangun) | `survival.js` (`SURVIVAL_CAMERA`, `_steerCamera`, `userZoom`, `recenterCamera`), `input.js`, `game.js`, `ui/survival.js`, `survivalIcons.js` (ikon `pan`) |
| 2. Plot belum rapi | Plot tidak lagi dicari saat runtime dari pecahan yard. Kini ada **denah tetap `PLOT`** (offset dari keep). Denahnya **simetris titik terhadap keep** seperti bentengnya sendiri (postern NW ↔ SE), plot berdiri di **kolom x = ±130 / ±165 / ±340 / ±480**, dan jalan gerbang utama dan utara diapit pasangan bangunan yang dicerminkan (sawmill ↔ ballista, tambang ↔ ballista). Semua jalan dari gerbang ke keep tetap terbuka. Barak halaman dalam dan armory mengapit jalan dari pintu keep ke gerbang utama; kapten mulai di jalan timur dekat keep. Semua bangunan menghadap selatan. **Props ditata ulang** (barel/peti dalam barisan di sepanjang dinding, simetris), tidak ada lagi yang berdiri di atas plot, jalan masuk gerbang, atau garis tembak ballista. Sumur kini model KayKit. `tools/survival-map.mjs` (baru) menggambar denah dari atas dan meng-assert **178 cek**: setiap plot bebas dari dinding / menara / props / keep / jalan masuk gerbang, jarak antar plot ≥ 30 px, setiap ballista melihat keluar gerbangnya, pasangan simetris, dan kolom. Denah lama gagal 16 dari 151 cek (`plan-before.png`), denah baru lolos semuanya (`plan-after.png`) | `survival.js` (`PLOT`, `buildingSpot`, `hunterHome`, `armorySpot`), `fortress.js` (`furnish`), `envkit.js`, `tools/survival-map.mjs` |
| 3. Aset bangunan masih prototipe | Semua bangunan kini **KayKit Medieval Hexagon Pack 1.0** (Kay Lousberg, **CC0**), diunduh dari repo resmi `github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0` (commit `84fa4e91`), warna tim biru yang cocok dengan livery keep. Mapping: BARRACKS = `building_barracks_blue`, SAWMILL = `building_lumbermill_blue` (node gergajinya berputar saat bekerja), GOLD MINE = `building_mine_blue` (+ gerobak `wheelbarrow` berisi emas yang bolak-balik di rel saat menggali), BALLISTA = `building_tower_base_blue` + `crossbow_2handed` (KayKit Adventurers, sudah dipakai untuk guard) di atas swivel yang membidik dan mundur saat menembak. Juga: **pad fondasi** (hex `building_dirt`, material tanah padat runtime) di bawah setiap plot; **tahap konstruksi** `building_stage_A/B/C` yang naik per sepertiga waktu bangun (upgrade juga); `building_scaffolding` di keep/gerbang saat dikerjakan; **level** terlihat dari bendera pack (Lv2 biru, Lv3 biru + kuning) dan stok (batu, kayu, barel, rak senjata, peti); **armory** = rak senjata + target + ember baut pack; sumur `building_well_blue`. Total ±1,2 MB glTF/bin + 1 atlas 16 KB, dimuat saat boot (boot menunggunya, maks 20 dtk). 44 file **disalin byte-for-byte**: hash blob git dicek terhadap tree upstream, sha256 dicatat di `assets/buildings/kaykit-hex/CREDITS.txt`, LICENSE pack ikut disalin. Model prosedural lama tetap ada sebagai fallback bila kit gagal dimuat | `buildings3d.js` (baru), `world3d.js`, `main.js`, `assets/buildings/kaykit-hex/` (baru), `assets/troops/kaykit/crossbow_2handed.*` |
| 4. Kartu masih besar | Kartu info (232 × 100) + tombol (210 × 56) di sudut jempol — tinggi gabungan **166 px dari layar 390 px** — kini **satu baris dock setinggi 50 px**: [ikon NAMA ●●○ / stat sekarang → berikutnya] + [tombol BUILD/UPGRADE dengan biaya]. Luasnya 16,5 rb px² (dulu ±35 rb). REPAIR keep duduk di baris yang sama. Tombol NIGHT 148 × 50 → **112 × 38**, tetap di kiri atas (R18a). Chip hint lebih pipih (40 → 34 px) | `ui/survival.js` (`drawDockInfo`, `dockLayout`, `drawDayScreen`) |
| 5. Trailer pembuka hilang | Penyebabnya: intro K1 hanya diputar **sekali per save** (`introSeen`), jadi setelah run pertama tidak pernah muncul lagi. Kini intro diputar **di awal setiap run**: save baru, RESTART (panel PAUSE), dan PLAY AGAIN. TAP TO SKIP tetap ada. Reload di tengah malam tidak memutarnya ulang. Framing intro disetel ulang untuk zoom baru: shot pertama dulu hanya menampilkan puncak keep yang terpotong letterbox; kini keep utuh dengan penduduk dan panjinya, lalu horde di gerbang, lalu kapten | `survival.js` (`_wantsIntro`, `_introKeys`), `tools/survival-intro.mjs` (baru) |

**Balance setelah denah baru** (`survival-balance.mjs`, 5 seed, malam 72 dtk; bukti `qa-evidence/survival-plots/balance-5seed.txt` + `.json`):

| Bot | Hasil | Bintang | Sebelum (build 8) |
|---|---|---|---|
| idle | 0/5 | — | 0/5 |
| active | 0/5 | — | 0/5 |
| builder | 5/5 | ★★★ ×5 (keep terendah 87–100 %) | 5/5 ★★★ |
| tower-builder | 5/5 | ★★★ ×4, ★★ ×1 (1 guard hilang) | 5/5 ★★★ |
| keep-builder | 0/5 | — | 0/5 |
| hunter-builder | 5/5 | ★★★ ×5 | 5/5 ★★★ |

Dua penyesuaian lahir dari pengukuran ini:
- **Ballista lebih dekat ke jalan gerbangnya.** Di denah pertama ballista berdiri 150 px dari jalan. Dari situ pandangannya lewat bukaan gerbang menyempit, dan tower-builder turun ke 4/5 menang dengan bintang [2,1,1,1,0]. Pada 115–130 px, tower-builder kembali 5/5.
- **Titik mulai kapten di jalan timur.** Titik mulai di depan pintu keep membuat bot builder harness hanya mempertahankan keep 43 % (★). Di jalan timur dekat keep (dekat titik lama) hasilnya 94 % (★★★).

**Gate otomatis** (implementasi, bukan acceptance), dijalankan serial pada kode akhir. PASS hanya berlaku untuk apa yang di-assert skripnya:

| Gate | Hasil | Catatan |
|---|---|---|
| `node tools/harness.mjs` | 58 baris PASS (jumlah sama dengan build 8), 0 FAIL, tanpa runtime error | Cek intro disesuaikan dengan sengaja: dulu "told once", kini "setiap run dibuka dengan intro (restart memutarnya ulang); sesi baru di tengah malam langsung lanjut". Cek arrival: PLAY AGAIN boleh membuka intro, tidak pernah arrival. Log `qa-evidence/survival-plots/harness-survival.txt` |
| `node tools/survival-devqa.mjs` | 25/25 PASS (23 + 2 baru) | Cek touch disesuaikan dengan sengaja: stick di separuh kiri, drag separuh kanan menggeser kamera (230 px) tanpa menggerakkan kapten. Baru: berjalan mengembalikan kamera ke kapten; RESTART membuka intro. Zoom malam 0,655 (portrait = landscape). `qa-evidence/survival-plots/devqa.json` |
| `node tools/survival-plotsqa.mjs` (baru) | 13/13 PASS, 0 page/console error | Kamera: zoom < 0,70; drag 406 px tanpa kapten bergerak; chip CAPTAIN muncul dan mengembalikan; roda 0,8–1,3 + tersimpan; pinch dua jari. Aset: kit siap (22 model), 7/7 bangunan model kit (0 prosedural), 15 plot + armory di atas pad, sumur, level berbendera. Konstruksi: stage A → B → C lalu bangunan muncul. Kartu: dock 50 px (dulu 166), luas 16,5 rb px²; NIGHT 112 × 38 di kiri atas; UPGRADE + REPAIR keep satu baris. Bukti `qa-evidence/survival-plots/*.png` + `plotsqa.json` |
| `node tools/survival-intro.mjs` (baru) | 4/4 PASS | Save baru membuka intro; frame pertama 1,53× play (keep utuh); RESTART dan PLAY AGAIN membuka intro lagi pada save yang sudah pernah melihatnya; reload tengah malam tidak. Frame `intro-1..5-*.png` + `intro.json` |
| `node tools/survival-map.mjs` (baru) | 178/178 cek denah | `plan-before.png` (denah build 8: 16 gagal dari 151) vs `plan-after.png` |
| `node tools/survival-fxshots.mjs` | 14/14 PASS | Cek build halaman kini membaca `index.html` (build "9") |
| `node tools/envqa.mjs --mode=3d-smoke` | ENVQA PASS (semua assertion) | 33 badan horde GLB, 0 primitif |
| `node tools/survivalshots.mjs --landscape` | 25 shot, 0 page error | `qa-evidence/survival-k1/land-*.png` diperbarui (50 %) |
| `node tools/layoutqa.mjs` | Semua gate PASS | Termasuk `?legacy=1` |
| `node tools/glbtest.mjs` | 128 PASS (123 + 5 cek kit bangunan) | 44 file kit cocok dengan sha256 di CREDITS dan tidak ada yang tak terdaftar; lisensi CC0 + commit sumber; setiap model yang dimuat punya mesh + buffer + atlas di sebelahnya; node gergaji lumbermill ada |
| `node tools/swtest.mjs` | 22 PASS | `duskhold-v9` |
| `node tools/bundlecheck.mjs` | 1 FAIL lama | Fingerprint signing masih placeholder (item rilis 7) |

**Bukti visual** (`qa-evidence/survival-plots/`):
- `compare-{day,build,wide,gate}.png`: sebelum (build 8, `c1c9545`) vs sesudah (build 9). Diambil dengan skrip yang sama (`tools/survival-look.mjs`) pada momen yang sama, 844 × 390.
- `plan-before.png` / `plan-after.png`: denah bailey dari atas.
- `cam-1..3`: kamera (frame malam, setelah digeser + chip CAPTAIN, zoom terjauh). `plots-1..2`: kota siang dan "jalan gerbang". `cards-1..2`: dock satu baris. `intro-1..5`: trailer pembuka.

**Belum / terbuka:**
- Rasa kamera geser/pinch di HP nyata belum dinilai. Pembagian kiri = stick, kanan = kamera adalah keputusan desain; pemain yang dulu menggeser stick dengan jempol kanan kini menggeser kamera.
- Bangunan tetap **tidak solid**: kapten dan horde bisa menembus model bangunan seperti sebelumnya. Denah baru menjauhkan plot dari jalur gerbang → keep supaya hal ini jarang terlihat.
- Keep, dinding, dan menara benteng masih prosedural (bukan bagian permintaan ini). Penduduk di atap keep masih figur kecil prosedural.
- Frame time dengan model kit (±1–4 rb segitiga per bangunan, 15 ghost transparan di siang hari) di HP kelas bawah belum diukur.
- Intro kini diputar setiap run (±7 dtk, bisa di-skip). Apakah ini mengganggu pemain yang mengulang, belum diuji manusia.

## Pass visual besar — jawaban atas "tidak ada perubahan" (2026-10-17)

**Pesan user (2026-10-17):** "tidak ada perubahan semua point dari intruksi saya ini belum ada yg di terapkan", lalu mengulang pesan lima poin (benteng terlalu luas sementara komponennya kecil; pasukan masih placeholder, bukan GLB; efek damage/tembakan kurang; bangunan yang dibangun tidak berfungsi; UI penting karena UX berhasil bila UI-nya tepat), ditutup dengan "apakah kamu tidak paham bahasa nya".

**Kenapa di layar user tidak terlihat perubahan.** Ini diagnosis dari kode. Belum dicek di perangkat user, jadi sebagian masih dugaan.
1. **Cache build lama.** Preview Arena memakai https, sehingga `index.html` mendaftarkan service worker. Service worker itu menyajikan modul `.js` cache-first (stale-while-revalidate): kunjungan pertama setelah update tetap menjalankan modul dari kunjungan sebelumnya. `python3 -m http.server` juga tidak mengirim `Cache-Control`, jadi browser boleh memakai cache heuristik. Kemungkinan besar, browser yang pernah membuka preview menampilkan build lama.
2. **Knight dimuat terlambat.** `Knight.glb` (3,6 MB) baru diunduh saat guard pertama digambar. Di koneksi lambat, guard tampil sebagai figur primitif sampai file selesai dimuat.
3. **Perubahan `2d87448` terlalu kecil di layar HP.**
   - Aktor setinggi ±54 px di layar 390 px (×1,25).
   - Hanya 14 badan horde yang GLB; sisa gelombang (sering separuhnya) masih figur primitif, jadi "pasukan placeholder" memang masih terlihat.
   - Horde di gerbang utara dan samping tertutup dinding 2,6 m, sehingga hanya angka damage yang terlihat.
   - Ballista jarang mendapat kill, dan kerja mine terjadi jauh dari Kapten.

**Implementasi** (di kode; belum acceptance):

| Poin | Perubahan | File |
|---|---|---|
| 0. Build yang benar sampai ke layar | **Service worker hanya di host rilis** (`duskhold.zyvrolabs.com`). Di host https lain (link preview), worker lama dan semua cache-nya dihapus, lalu halaman reload **sekali** sebelum game boot, jadi kode basi tidak sempat jalan. Di `sw.js`, kode (`.js/.css/.json`) kini network-first dengan cache sebagai cadangan offline; model, gambar, dan audio tetap cache-first; VERSION `duskhold-v8`. `tools/devserver.py` (baru) menyajikan repo dengan `Cache-Control: no-store` dan `Clear-Site-Data: "cache"` di setiap halaman; preview port 8000 kini memakai server ini. **Stempel build** "BUILD 8" tampil kecil di pojok kiri bawah HUD siang/malam dan di panel PAUSE, dibaca dari `window.DUSKHOLD_BUILD` di `index.html` | `index.html`, `sw.js`, `tools/devserver.py`, `src/ui/survival.js` |
| 1. Benteng terlalu luas, komponen kecil | `FORT_SCALE` 0,7 → **0,5**: halaman dalam 1820 × 1330 → 1300 × 950 px, keep r112 → r100. **Aktor ×1,25 → ×1,6** (`SURVIVAL_ACTOR_SCALE`, kini di `config.js`). **Kamera 1,3× lebih dekat** (`FRAME_CLOSER`): zoom malam 0,596 → 0,775, tinggi aktor di layar sideways ±54 → ±90 px. **Dinding tirai 2,0 m** (`FORT_WALL_METRES`; rumah tetap 2,6 m) supaya horde di balik dinding terlihat dari dada ke atas; menara +108 / +88 px di atas dinding dan jembatan gerbang di atas kusennya. Bangunan ×1,6 + 0,2 per level; keep setinggi 230 px. Lingkaran bangun r58 → r68; jarak barisan horde 44/36 → 54/44 px. Sawmill jalan gerbang dipindah ke barat jalan supaya tidak menempel ke ballista. **Jangkauan tembak otomatis Kapten 620 → 540 px**, mengikuti benteng yang mengecil: dari keep ia tidak lagi menjangkau semua gerbang, jadi menahan gerbang tetap berarti berjalan ke sana | `fortress.js`, `config.js`, `envkit.js`, `world3d.js`, `survival.js` |
| 2. Pasukan masih placeholder | **Seluruh horde kini monster GLB** (`src/game/crowd3d.js`, baru), digambar dengan *vertex animation texture*. Saat loading, klip asli (walk, attack, hit, death) tiap monster Quaternius diputar pada salinan rig, lalu posisi dan normal setiap vertex ditulis per frame ke tekstur half-float (20 fps, ±9 MB GPU untuk 3 jenis, bake 0,2–0,3 dtk di sandbox). Setiap jenis digambar dengan 1 InstancedMesh (3 draw call + bayangan untuk hingga 128 badan per jenis). Komposisi: demon 58 %, green spiky blob 26 %, ghost skull 16 %, tetap per badan. Badan yang mati memutar klip Death lalu tenggelam. Ada kilat putih saat kena dan rim light agar siluet terpisah di malam hari. Figur primitif tinggal fallback bila rig gagal dimuat; di semua QA jumlahnya 0. 14 rig skinned kini dipakai Individual/Breaker. **Knight dimuat saat boot** (`link rel=preload`, `Troop3D.init()`; boot menunggu knight dan 3 monster horde, paling lama 20 dtk). **Helm knight diwarnai biru kerajaan dengan jambul emas** (material runtime), karena helm baja polos dari kamera 35° terbaca sebagai "telur abu-abu". Byte GLB tidak diubah | `crowd3d.js` (baru), `world3d.js`, `main.js`, `index.html`, `troop3d.js` |
| 3. Efek tembakan/damage kurang | Bolt lebih besar (batang/streak/glow ±40 %), muzzle flash ikut skala aktor. Angka damage 19/24/26/32 → 23/28/32/40. Badan yang mati benar-benar roboh (klip Death). Kill melempar serpihan ichor dan meninggalkan noda di lantai (decal; upload dibatasi ≤ 4×/dtk). Kamera bergetar kecil saat Kapten membunuh. Flash, bintang, dan cincin yang sudah ada ikut membesar bersama skala aktor. Hit-stop per kill swarm sempat dicoba lalu dibuang: gerbang ramai jadi patah-patah dan malam memanjang (budget tick harness terlampaui). Hit-stop tetap ada untuk kill besar dan Flare | `survival.js`, `world3d.js` |
| 4. Bangunan tidak berfungsi | **Ballista:** bolt 16/22/30 → **24/32/42** (dua bolt menjatuhkan badan malam 1, menembus 1). Setiap kill memunculkan "+1 💀" di atas deck-nya, dan tiap ballista punya pil malam (💀 N kill malam ini), termasuk ballista atap keep. **Ballista atap keep:** jangkauan 360/400 → **440/500 px**, sehingga mencapai jalan gerbang (gerbang U/S ±430 px dari keep); dulu hanya halaman dalam. **Mine:** setiap koin juga muncul sebagai "+1" bergambar mine di samping counter emas HUD, dan counter-nya berpendar, di mana pun Kapten berdiri. Kerja mine jadi terlihat dari gerbang yang sedang ditahan | `survival.js`, `ui/survival.js`, `survivalIcons.js` |
| 5. UI | **Penanda gerbang:** gelombang yang sedang menuju gerbang tampil sebagai ikon horde + "×N" di atas gerbang itu (kuning). Gerbang yang dikepung menampilkan HP-nya. Gerbang di luar layar menjadi panah tepi dengan "×N" (bagian "gerbang ditandai" dari R6). Pop pemasukan di HUD dan stempel build (lihat atas) | `ui/survival.js` |

**Balance** (`survival-balance.mjs`, 5 seed, malam 72 dtk; pengukuran, bukan gate; bukti `qa-evidence/survival-visual/balance-5seed.txt` + `.json`):

| Bot | Hasil | Bintang | Keep terendah | Catatan |
|---|---|---|---|---|
| idle | 0/5 | — | — | keep jatuh malam 1 di 35,9–37,8 dtk (sebelumnya 34–37); tip "WALK TO THE GATE UNDER ATTACK" |
| active | 0/5 | — | — | kalah malam 2 di 51,9–53,4 dtk; tip "BUILD BY DAY: WALK INTO A CIRCLE" |
| builder | 5/5 | ★★★ ×5 | 87–100 % | MVP GUARDS 19–28 |
| tower-builder | 5/5 (dulu 4/5 ★) | ★★★ ×5 | 51–89 % (dulu 2–33 %) | kill ballista 30–40 per run (dulu 25–35) |
| keep-builder | 0/5 | — | — | kalah malam 3 di 48,8–52,1 dtk; ballista atap 15–22 kill, MVP KEEP BALLISTA di 3 dari 5 seed |
| hunter-builder | 5/5 | ★★★ ×5 | 100 % | |

Target desain tetap terpenuhi: tidak bermain atau tidak membangun berarti kalah, sedangkan membangun berarti menang. Ballista kini cukup kuat untuk strategi menara. Jangkauan Kapten dipilih dari tiga nilai: dengan 620, hasil bot sama, tetapi dari keep Kapten menjangkau barisan depan di gerbang U/S (±550 px) tanpa berjalan; dengan 470, bot builder versi harness hanya menang dengan keep terendah 32 % (★). Jadi dipilih 540, nilai tengahnya.

**Gate otomatis** (implementasi, bukan acceptance), dijalankan serial pada kode akhir. PASS hanya berlaku untuk apa yang di-assert skripnya:

| Gate | Hasil | Catatan |
|---|---|---|
| `node tools/harness.mjs` | 58 baris PASS (54 + 4 baru), 0 FAIL, exit 0, tanpa runtime error | Cek baru:<br>(1) skala: bailey 1300 × 950, keep r100, dinding 2 m, aktor ×1,6;<br>(2) jangkauan ballista atap ≥ jarak gerbang U/S (432 px) dan bolt ballista 24;<br>(3) kill ballista nyata → tally malam 1 + pop "+1 💀" tepat di menara;<br>(4) koin mine → pop HUD "+1" dari mine, dan malam baru me-reset semua tally.<br>Cek lama yang disesuaikan dengan sengaja: pierce (bolt 24 → 975/975/999), level ballista 32/42. Log: `qa-evidence/survival-visual/harness-survival.txt` |
| `node tools/survival-fxshots.mjs` | 14/14 PASS (11 + 3 baru), 0 page error, 0 console error | `fx-horde` (baru):<br>- 48 badan horde digambar sebagai GLB (demon 24 / blob 14 / ghost 10), 0 figur primitif;<br>- ballista selatan 4 kill = 4 pop "+1 💀";<br>- kedua guard memakai helm biru + jambul;<br>- halaman melapor build "8".<br>`fx-mine` kini juga meng-assert pop HUD. Bukti: `qa-evidence/survival-fixes/fx-*.png` + `fxshots.json` |
| `node tools/survival-devqa.mjs` | 23/23 PASS; 0 page error, 0 console error, 0 request gagal | Zoom malam portrait = landscape = 0,775. `qa-evidence/survival-k1/devqa.json` |
| `node tools/envqa.mjs --mode=3d-smoke` | 40/40 PASS, 0 page error | Run pertama FAIL 1: lantai jumlah slot merlon (≥ 80) disetel untuk dinding 0,7. Kini ≥ 60 (52/74 slot di 3614 px; rasio ≥ 2/3 tetap). Assertion horde ditambah: 33 badan digambar sebagai GLB, 0 figur primitif. Bukti FTUE `qa-evidence/survival-ftue-*.png` + `.json` diperbarui |
| `node tools/survivalshots.mjs --landscape` | 25 shot, 0 page error | `qa-evidence/survival-k1/land-*.png` (diperkecil 50 % dengan `tools/evidence-images.mjs half`) + `land-metrics.json` |
| `node tools/layoutqa.mjs` | Semua gate PASS | Termasuk mode mansion (`?legacy=1`) |
| `node tools/glbtest.mjs` | 123 PASS | Byte aset tidak berubah |
| `node tools/swtest.mjs` | 22 PASS (18 + 4 baru) | Modul game network-first: jawaban jaringan dipakai, modul yang berubah langsung dipakai, dan modul terakhir disajikan saat offline |
| `node tools/bundlecheck.mjs` | 1 FAIL lama | Fingerprint signing masih placeholder (item rilis 7; sudah gagal sebelum pass ini) |
| `node --check` | OK | Semua file JS yang berubah; `tools/devserver.py` dikompilasi `py_compile` |

**Bukti visual:**
- `qa-evidence/survival-visual/compare-{south,wide,fight,day}.png`: **sebelum (`0df19b6`) vs sesudah (build 8)**. Diambil dengan skrip yang sama (`tools/survival-look.mjs`) pada detik yang sama, 844 × 390. Keep di shot `south` sengaja dibuat 99999 HP agar malam tidak berakhir sebelum frame; ini artefak skrip.
- `qa-evidence/survival-fixes/fx-horde.png`: horde GLB di gerbang utama, ballista selatan, dan knight berhelm biru.
- `qa-evidence/survival-k1/land-*.png`: 25 shot landscape, termasuk intro (horde GLB di gerbang utara, terlihat di atas dinding rendah) dan kedatangan bala bantuan (knight berjambul).

**Belum / terbuka:**
- Penyebab "tidak ada perubahan" di perangkat user belum dipastikan. Stempel "BUILD 8" di pojok kiri bawah adalah cara user dan kita memastikan build yang tampil. Browser yang masih menyimpan worker lama menerima `index.html` baru (navigasi selalu network-first), menghapus worker dan cache-nya, lalu reload sekali.
- Performa di HP kelas bawah belum diukur (§6.6 riset): bake horde, tekstur ±9 MB, hingga ±90 badan dalam 3 draw instanced + pass bayangan, 2 knight + hingga 9 bala bantuan skinned.
- Penduduk di atap keep masih figur prosedural kecil (bukan GLB).
- Angka damage bisa menumpuk di gerbang yang ramai. Aksi di gerbang utara bisa jatuh di bawah pil malam (atas tengah) di layar sideways.
- Rasa efek, ukuran, dan keterbacaan UI belum dinilai manusia. Screenshot headless hanya satu frame.
- R5 dan sisa R6 (kontak pertama ≤ 5 dtk) belum dibangun.

## Momen akhir run — P0 riset UX: R1–R4 + R19 (2026-10-16)

**Pesan user:** "next" (kedua kalinya, tanpa instruksi baru), dikirim setelah pass "Perbaikan dari feedback user" di-push. **Tafsiran:** lanjut ke langkah berikutnya yang paling bernilai, yaitu P0 "Momen akhir run" di `docs/UX-REPLAY-RESEARCH.md` §5. Alasannya, verdict riset menyebut setelah menang hampir tidak ada alasan main lagi (tidak ada bintang, rekor, atau ringkasan yang membanggakan), sedangkan R1 dan R19 sudah setengah jalan. Kerumunan musuh GLB tidak dipilih karena terlalu berat untuk HP murah (§6.6 riset).

**Implementasi** (di kode; belum acceptance):

| ID | Perubahan | File |
|---|---|---|
| R1 ringkasan | Panel akhir punya 5 kotak: malam bertahan x/3, total kill run, keep (sisa HP % saat fajar ke-3 bila menang, level bila kalah), bangunan berdiri, dan durasi run (m:ss; malam + siang, tanpa pause dan sinematik). Baris kru (Kapten / guard / ballista) tetap ada. | `src/ui/survival.js` (`drawEndPanel`, `endLayout`), `src/game/survival.js` (`runStats.time`, `_finishRun`) |
| R2 bintang | Run menang dapat 1–3 bintang: ★ bertahan 3 malam, ★★ keep tidak pernah di bawah 50 % HP, ★★★ juga tanpa guard hilang. Kalah = 0. Bintang muncul satu per satu (jeda 0,28 dtk), slot kosong tetap terlihat, dan di bawahnya tertulis syarat bintang berikutnya ("NEXT STAR: KEEP ABOVE HALF HP" / "NEXT STAR: LOSE NO GUARDS") atau "FLAWLESS DEFENCE!". | `survival.js` (`RUN_STARS`, `survivalStars`, `runStats.keepMin` / `lost`), ikon `starEmpty` |
| R3 rekor | Rekor tersimpan di `save.survival.records` (runs, wins, bestStars, bestNights, bestKills, totalKills). Tag "NEW BEST!" muncul saat bintang atau malam terbaik terlampaui, tapi tidak di run pertama. Panel menang menulis "WINS x/y · TOTAL KILLS n". PLAY AGAIN tidak menghapus rekor, dan reload menampilkan panel yang sama (`runResult` ikut tersimpan). | `survival.js` (`records`, `runResult`, `_persist`, `_restore`) |
| R4 kalah nyaris | Panel kalah menulis "NIGHT n · Ns TO DAWN" ("SO CLOSE! Ns TO DAWN" bila ≤ 10 dtk), menampilkan track malam bulan → matahari dengan penanda keep di titik jatuhnya, dan **satu tip ≤ 8 kata dari penyebab nyata**. Urutan aturannya: Kapten gugur → "FALL BACK TO THE KEEP WHEN HURT"; malam 1 (belum ada siang untuk membangun) → "WALK TO THE GATE UNDER ATTACK" (bergerak < 400 px) / "TAP FLARE ON BIG GROUPS" / "FIGHT BESIDE YOUR GUARDS AT THE GATE"; tidak membangun apa pun → "BUILD BY DAY: WALK INTO A CIRCLE"; gerbang pertama yang jebol tanpa ballista → "BUILD A BALLISTA AT THE X GATE" (atau "RAISE THE KEEP TO GUARD THE X GATE" bila lingkarannya masih terkunci); keep tertinggal level → "UPGRADE THE KEEP BY DAY"; guard hilang → "HELP FALLEN GUARDS UP"; tanpa barracks → "BUILD BARRACKS FOR MORE GUARDS"; selain itu "UPGRADE YOUR BALLISTAS BY DAY". | `survival.js` (`_lossTip`, `_towerSlotFor`, `nightStats.breached` / `flares`) |
| R19 MVP | MVP = bagian garnisun yang dibangun pemain dengan kill terbanyak: satu ballista per lingkaran ("SOUTH BALLISTA"), ballista atap keep, atau guard. **Kapten tidak pernah jadi MVP:** di bot yang bertahan, Kapten (termasuk Flare) mengambil 78–97 % kill, jadi MVP berbasis kill murni hampir selalu "CAPTAIN" dan tidak membuat bangunan terasa. Kill ballista kini dicatat per lingkaran (`runStats.towers`). Grup MVP di baris kru diberi tag emas "MVP", dengan baris "MVP: GUARDS · 19 KILLS" di bawahnya. | `survival.js` (`survivalMvp`, `onEnemyKilled`), `ui/survival.js` |

**Lain-lain:**
- Judul panel saat Kapten gugur: "THE HUNTER FELL" → "THE CAPTAIN FELL", sesuai cerita K1 ("YOU ARE THE CAPTAIN"). Alasan internal `'Hunter lost'` tidak diubah.
- Ikon baru `starEmpty`; ikon `star` diberi kilau.
- `sw.js` VERSION `duskhold-v6` → `duskhold-v7`. Panel berubah dan aset di-cache lebih dulu (stale-while-revalidate), jadi tanpa bump, boot pertama setelah update masih memakai modul lama. `tools/swtest.mjs` meng-hardcode `duskhold-v5`, sehingga **gagal sejak pass sebelumnya** (bump ke v6 tanpa menjalankan swtest). Cek itu kini membaca VERSION dari `sw.js`.
- `tools/survival-balance.mjs`: kolom `END` (bintang, keep terendah, detik ke fajar, tip, MVP), ringkasan bintang dan tip per bot, dan opsi `--panels=dir` yang menggambar panel akhir 2D asli dari run 3 malam nyata ke PNG.
- `tools/survival-fxshots.mjs`: `fx-end` kini kekalahan malam 2 yang dimainkan (tanpa input); `fx-win` baru, di mana bot builder (`tools/survival-bots.mjs`) memainkan 3 malam penuh di halaman browser.
- `tools/survival-devqa.mjs`: cek baru bahwa rekor bertahan setelah reload.
- `tools/harness.mjs`: 6 cek baru (lihat tabel gate).
- **Simulasi tidak berubah.** Hasil balance identik baris per baris dengan `2d87448` (6 bot × seed 0–2; builder dan tower-builder seed 0–4). Pass ini hanya menambah pencatatan dan UI.

**Tidak dikerjakan di pass ini:**
- **R5** (fajar cepat saat malam bersih). Di bot, 2 musuh biasanya masih hidup saat fajar (spawn 68 / kill 66 di malam 1), jadi aturan "musuh hidup = 0" jarang terpicu tanpa mengubah tempo gelombang.
- **R6** (kontak pertama ≤ 5 dtk). Menyentuh FTUE dan tempo malam.
- Keduanya butuh pass tempo sendiri, diukur dengan `survival-uxprobe`.

**Balance (pengukuran ulang; tuning tidak diubah):** sampel 3 seed di pass sebelumnya (tower-builder 2/3) diulang dengan 10 seed. Hasilnya builder 10/10 dan tower-builder 8/10 (2 kalah di malam 3 pada 58–59 dtk). Probe riset di benteng skala 1 mencatat tower 4/5, jadi tidak ada bukti regresi akibat benteng ringkas. Bukti: `qa-evidence/survival-end/balance-10seed-tower.txt`.

**Bintang, tip, dan MVP per bot** (`survival-balance.mjs`, 5 seed, malam 72 dtk; pengukuran, bukan gate):

| Bot | Hasil | Bintang | Keep terendah | Tip saat kalah (malam, detik ke fajar) | MVP |
|---|---|---|---|---|---|
| builder | 5/5 menang | ★★★ ×5 | 88–100 % | — | GUARDS 10–16 |
| hunter-builder | 5/5 | ★★★ ×5 | 92–100 % | — | GUARDS 7–14 |
| tower-builder | 4/5 | ★ ×4 | 2–33 % | "BUILD A BALLISTA AT THE SE GATE" (N3, 14 dtk) | GUARDS 11–20; seed 4: SOUTH BALLISTA 14 |
| keep-builder | 0/5 | — | — | "BUILD A BALLISTA AT THE SE GATE" (N3, 21–23 dtk) | KEEP BALLISTA 10–13 / GUARDS 15–18 |
| active | 0/5 | — | — | "BUILD BY DAY: WALK INTO A CIRCLE" (N2, 18–20 dtk) | GUARDS 6–15 |
| idle | 0/5 | — | — | "WALK TO THE GATE UNDER ATTACK" (N1, 34–37 dtk) | GUARDS 3–4 |

Catatan: ballista jarang mendapat kill terakhir. Pada tower-builder, ballista mencatat 25–35 kill dari 104–119 tembakan per run, sehingga MVP bot umumnya GUARDS. Apakah ballista perlu terasa lebih kuat adalah keputusan balance dan belum diubah. *(Diperbarui 2026-10-17: bolt 24/32/42 dan pop "+1 💀" per kill; tower-builder 5/5 ★★★ dengan 30–40 kill ballista per run, lihat "Pass visual besar".)*

**Gate otomatis** (implementasi, bukan acceptance), dijalankan serial. PASS hanya berlaku untuk apa yang di-assert skripnya:

| Gate | Hasil | Catatan |
|---|---|---|
| `node tools/harness.mjs` | 54 baris PASS (48 lama + 6 baru), 0 FAIL, exit 0 | Cek baru: (1) R1/R2 dari run builder nyata: kill panel 225 = 54 + 78 + 93, keep terendah 63 % → ★★★; (2) aturan bintang 3/2/1/0; (3) R4 dari kekalahan idle nyata: malam 1, 24 dtk ke fajar, tip "WALK TO THE GATE UNDER ATTACK"; (4) 6 penyebab → 6 tip, semua ≤ 8 kata; (5) R3: NEW BEST false / true / true / false, reload menjaga panel + rekor, PLAY AGAIN menjaga rekor; (6) R19: bolt ballista nyata membunuh → tercatat di `south:tower`, MVP "SOUTH BALLISTA"; Kapten tidak pernah MVP. Log: `qa-evidence/survival-end/harness-survival.txt` |
| `node tools/survival-devqa.mjs` | 23/23 PASS (22 lama + 1 baru); 0 page error, 0 console error, 0 request gagal | Cek baru: `save.survival.records` sama persis sebelum dan sesudah reload (runs 1, bestNights 1, totalKills 7). Dijalankan dua kali: sekali sebelum tiga penyesuaian kecil di `drawEndPanel` (fade baris bintang, stempel NEW BEST!, tip yang menyusut di panel sempit), lalu sekali lagi di kode akhir; keduanya 23/23. `qa-evidence/survival-k1/devqa.json` (run akhir) |
| `node tools/survival-fxshots.mjs` | 11/11 PASS (10 lama, `end` diperketat, `win` baru); 0 page error, 0 console error | `fx-end`: malam 2 dimainkan tanpa input dan keep jatuh sendiri (`natural: true`) 34 dtk sebelum fajar. Kill run 25 = jumlah per sumber, tip "BUILD A BALLISTA AT THE WEST GATE" (gerbang pertama yang jebol malam itu), bukan NEW BEST (run pertama). `fx-win`: bot builder memainkan 16.250 frame (3 malam + 2 hari) di halaman. Kill 238 = 66 + 79 + 93, ★★★ (keep terendah 94 %, 0 guard hilang), MVP GUARDS 18, NEW BEST! (3 malam > 1), rekor runs 2 / wins 1 / bestStars 3. Bukti: `qa-evidence/survival-fixes/fx-*.png` (10 shot, 844 × 390, DPR 1) + `fxshots.json` |
| `node tools/survivalshots.mjs --landscape` | 25 shot, 0 page error | Semua `qa-evidence/survival-k1/land-*.png` (diperkecil 50 %) + `land-metrics.json` dirender ulang di kode akhir. Shot `complete` kini menunggu 1,5 dtk setelah panel terbuka (bintang sudah mendarat); angkanya tetap hasil skrip |
| `node tools/survival-balance.mjs --panels=…` | 30 run, 30 panel PNG | Panel dari run 3 malam nyata (UI 2D asli, font fallback node, tanpa dunia 3D di belakang). Dipilih 6: `qa-evidence/survival-end/end-*.png` |
| `node tools/swtest.mjs` | 18 PASS | Cek versi cache diperbaiki (lihat Lain-lain) |
| `node --check` | OK | Semua file JS yang berubah |

Tidak dijalankan ulang di pass ini: `envqa`, `layoutqa`, dan `glbtest`. Tidak ada perubahan pada dunia 3D, layout HUD malam/siang, atau aset; hasil terakhirnya ada di bagian "Perbaikan dari feedback user".

**Bukti visual:**
- `qa-evidence/survival-fixes/fx-win.png`: panel menang setelah 3 malam yang benar-benar dimainkan bot builder di browser (238 kill = 66 + 79 + 93, ★★★, keep 96 % saat fajar, MVP GUARDS 18, NEW BEST!, WINS 1/2). Ini pertama kalinya panel menang setelah 3 malam penuh tertangkap. Frame diambil 1,5 dtk setelah panel terbuka, jadi tag NEW BEST! masih di akhir animasi stempelnya (agak transparan).
- `qa-evidence/survival-fixes/fx-end.png`: kekalahan malam 2 tanpa input. Keep jatuh sendiri 34 dtk sebelum fajar, tip "BUILD A BALLISTA AT THE WEST GATE". Malam 1 di alur ini dipotong oleh fajar skrip, sehingga kill dan durasi hanya sebagian.
- `qa-evidence/survival-end/end-*.png`: panel dari run bot balance (builder ★★★; tower-builder ★ dengan MVP SOUTH BALLISTA; tower-builder kalah N3; keep-builder kalah N3 dengan MVP KEEP BALLISTA; active kalah N2; idle kalah N1).
- `qa-evidence/survival-k1/land-failed.png` / `land-complete.png`: dirender ulang dengan panel baru, tetapi keduanya tetap hasil skrip (kalah dipicu di malam 2; menang = lompat ke fajar ke-3).

**Belum / terbuka:**
- Belum ada playtest manusia untuk panel ini: apakah bintang terasa adil, tip dipahami dan membantu, dan "NEW BEST!" memancing main lagi (protokol §6.1 riset).
- Ambang bintang (50 % keep, tanpa guard hilang) baru diuji dengan bot. ★★ belum pernah muncul di run bot: bot menolong guard yang jatuh, dan builder dengan `--no-rescue` pun tidak kehilangan guard (3 seed).
- Tip dibaca dari aturan sederhana (urutan tetap); penyebab campuran hanya menghasilkan satu tip.
- Teks panel berbahasa Inggris (konvensi UI game); belum ada lokalisasi ID.
- R5, R6, P1 (R7–R11, R17, R18 b/c), dan P2 belum dibangun.

## Perbaikan dari feedback user: skala, pasukan GLB, efek tembakan, bangunan, UI (2026-10-16)

**Feedback user:** "masih banyak yg perlu di perbaiki dari game ini benteng awal terlalu besar luas sedangkan component game nya kecil dan disini pasukan nya masih place holder juga bukan glb visual yg benar, demege animasi shot juga kurang effect nya, bangunan yg di build juga tidak berfungsi berdasar riset kamu itu visual ui itu juga penting karna ux berhasil karna ui nya tepat".

**Implementasi** (yang ada di kode; belum acceptance):

| Keluhan | Perubahan | File |
|---|---|---|
| A. Benteng terlalu luas, komponen kecil | Bailey diperkecil ke skala 0,7 (`FORT_SCALE`): halaman dalam 2600 × 1900 → 1820 × 1330 px, menara sudut 130 px; dekorasi (`furnish()`) diatur ulang untuk benteng ringkas. Semua aktor Survival ×1,25 (`SURVIVAL_ACTOR_SCALE`): Kapten, musuh GLB, kerumunan instanced, guard. Kamera lebih dekat (`frameMul` malam 0,86 → 1,1, siang 0,8 → 1,02): zoom shot `night-door` 0,466 → 0,596 | `src/game/fortress.js`, `envkit.js`, `player.js`, `enemy3d.js`, `world3d.js`, `survival.js` |
| B. Pasukan masih placeholder | Guard di gerbang memakai **KayKit Knight (GLB, CC0)**, dengan crossbow satu tangan di `handslot.r` dan perisai bulat. Klip: Idle, Walking_A, Running_A, 1H_Ranged_Aiming/Shoot, Hit_A, Lie_Down/Lie_Idle/Lie_StandUp, Cheer. Guard jatuh memutar Lie_Down, lalu Lie_StandUp saat ditolong. Kolom bala bantuan memakai 8 knight GLB (pedang + perisai) + pembawa panji; versi instanced lama tetap jadi fallback bila GLB gagal dimuat. Jubah/tabard merah di atlas diganti biru kerajaan (hue 222) pada salinan canvas saat runtime, supaya pihak kita terbaca biru (horde = merah); byte GLB tidak diubah. Jarak barisan 62/60 → 84 px | `src/game/troop3d.js` (baru), `world3d.js`, `survival.js` (`_reliefColumn`), `assets/troops/kaykit/` |
| C. Efek tembakan/damage kurang | **Bolt:** kepala bercahaya (sprite additive) + streak kerucut additive di belakangnya (Kapten kuning, guard biru, ballista oranye dan lebih besar), menggantikan garis 1 px. **Muzzle flash** di setiap tembakan. **Hit:** flash + bintang 4 titik + cincin di lantai (warna menurut sumber) + percikan lebih banyak; kerumunan instanced berkedip terang saat kena. **Kill:** flash besar + cincin kejut + asap ungu yang naik. **Angka damage:** pop dengan overshoot, melayang ke samping, bayangan; hit berat (ballista/Flare) oranye dan lebih besar; pukulan pembunuh oranye-merah dengan goyangan. Antrean efek ber-timestamp, jadi frame setelah fast-forward QA hanya menampilkan efek yang masih berjalan | `world3d.js` (`_makeBoltMesh`, `_syncCombatFx`, `_playFx`), `survival.js` (`pushFx`, `enemyDamageTaken`, `onEnemyKilled`), `src/ui/survival.js` (`drawFloaters`) |
| D. Bangunan "tidak berfungsi" | Fungsinya sudah ada di simulasi, tetapi tidak terlihat. Sekarang: **Mine** — setiap 1 emas yang digali di malam hari, koin 3D melompat dari poros + pil "+1"; roda katrol berputar. **Sawmill** — saat COLLECT di fajar, batang kayu terlempar dari sawmill + pil "+7"; mata gergaji berputar. **Barracks** — prajurit baru keluar dari barak lalu berjalan ke posnya, dengan cincin biru + "+1"; tenda kini biru (dulu krem dan hilang di lantai batu pasir). **Ballista** — kill dihitung per menara. **Pil status siang** di atas tiap bangunan (ikon + angka): mine emas +N/malam, sawmill kayu +N/fajar, barracks prajurit N, ballista kill N (atau damage bila belum ada kill) | `survival.js` (`updateMines`, `_syncGuardRoster`, `ackRewards`), `world3d.js` (`_syncSurvivalWorkshop`), `ui/survival.js` (`buildingStatus`) |
| E. UI | **NIGHT dipindah** ke kiri atas di bawah PAUSE, jauh dari BUILD (R18a; dulu berjarak 10 px dari BUILD); tombol aksi kedua (REPAIR) mengisi kursi bawah. **Panel fajar:** baris sawmill, kill ballista, dan kill guard (R19). **Panel menang/kalah:** total kill 3 malam (**bug R1 diperbaiki**: dulu hanya kill malam terakhir), malam bertahan x/3, dan kill per Kapten/guard/ballista (`runStats`, tersimpan di `save.survival`). HP bar dan badge dinaikkan mengikuti badan ×1,25 | `ui/survival.js`, `survival.js` (`runStats`, `KILL_SOURCES`) |

**Lain-lain:** `sw.js` VERSION `duskhold-v5` → `duskhold-v6` (modul dan aset baru). `enemies.js`: bolt mencatat `_lastHitBy` (untuk atribusi kill). `tools/survival-devqa.mjs`: cek guard jatuh kini juga meng-assert state GLB (`down`/`lie` → bukan `down`/`lie` setelah ditolong); timeout reload diset eksplisit 120 dtk. `tools/envqa.mjs`: cek merlon tidak lagi memakai angka tetap, tetapi dihitung dari panjang dinding (lihat tabel gate). `tools/glbtest.mjs`: 5 cek untuk aset pasukan. `tools/survival-fxshots.mjs` (baru): bukti per keluhan A–E.

**Provenance aset:** KayKit Character Pack: Adventures 1.0 (Kay Lousberg), `github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0`, commit `672074b`, lisensi CC0 1.0 (`LICENSE.txt` ikut). Disalin byte-for-byte: `Knight.glb` (3.659.532 B), `crossbow_1handed.gltf/.bin`, `rogue_texture.png`. SHA-256 tiap file ada di `assets/troops/kaykit/CREDITS.txt`. Bukan gambar AI.

**Balance** (pengukuran, bukan gate; 3 seed, 72 dtk per malam; benteng ringkas):

| Bot | Benteng 0,7 + aktor ×1,25 | Benteng skala 1 (`5c86e2b`) |
|---|---|---|
| builder | 3/3 (keep N3 958–1192/1200) | 3/3 |
| tower-builder | 2/3 (1 seed kalah N3 di 58 dtk) | 3/3 |
| keep-builder | 0/3 (kalah N3 ±50 dtk) | 0/3 |
| active | 0/3 (kalah N2 54–55 dtk) | 0/3 |
| idle | 0/3 (keep jatuh N1 35,9–37,1 dtk) | 0/3 (±40 dtk) |

**Gate otomatis** (implementasi, bukan acceptance), dijalankan serial pada kode akhir pass ini. PASS hanya berlaku untuk apa yang di-assert skripnya:

| Gate | Hasil | Catatan |
|---|---|---|
| `node tools/harness.mjs` | 49 PASS, tanpa runtime error | |
| `node tools/survival-devqa.mjs` | 22/22 PASS; 0 page error, 0 console error, 0 request gagal | Termasuk guard GLB jatuh → `troop.state` `down` lalu berdiri setelah ditolong; ballista 13 tembakan / 7 kill; zoom malam 0,596 di portrait dan landscape. Run pertama pass ini gagal di `cine.reload` (timeout bawaan puppeteer 30 dtk saat mesin sibuk), lalu timeout dibuat eksplisit 120 dtk |
| `node tools/envqa.mjs --mode=3d-smoke` | 40/40 PASS, 0 page error | Run pertama FAIL 1 assertion: jumlah merlon 88, sedangkan ambang lama `> 100` disetel untuk dinding skala 1 (146 merlon di 8114 px). Assertion kini relatif ke panjang dinding: 88 dari 112 slot di 5414 px (wajib ≥ 2/3 slot; skala 1 = 146/170). Bukti FTUE `qa-evidence/survival-ftue-*.png` + `.json` ikut diperbarui |
| `node tools/layoutqa.mjs` | Semua gate PASS | Dunia 3D, dekor, kontrol, pintu, pickup/bolt/VFX, musuh + haunt, desktop boot, error browser. Mode mansion (`?legacy=1`) tetap lolos |
| `node tools/glbtest.mjs` | 123 PASS (118 lama + 5 baru) | Cek baru untuk aset pasukan: SHA-256 sama dengan `CREDITS.txt` dan tidak ada file tak terdaftar; lisensi CC0 + commit sumber; `Knight.glb` punya 10 klip yang dipakai, bagian loadout, dan `handslot.r`; crossbow lengkap dengan `.bin` dan atlasnya |
| `node tools/survival-fxshots.mjs` (baru) | 10/10 PASS, 0 page error, 0 console error | Bukti: `qa-evidence/survival-fixes/fx-*.png` (8 shot, 844 × 390, DPR 1) + `fxshots.json`. Cek: knight GLB berlivery biru, efek hit/kill/muzzle diputar, tiap kill punya sumber, koin mine + "+1", baris panel fajar, kayu sawmill + "+N", NIGHT jauh dari BUILD (jarak 688 px), prajurit barracks keluar lalu berjalan ke posnya, panel akhir menghitung seluruh run |
| `node tools/survivalshots.mjs --landscape` | 25 shot, 0 page error | `qa-evidence/survival-k1/land-*.png` (diperkecil 50 %) + `land-metrics.json`. Bar HP keep siang yang di-clamp di bawah pil DAY ditambahkan setelah run ini, jadi baru terlihat di `fx-day.png` |
| `node --check` | OK | Semua file JS yang berubah atau baru |

**Belum / terbuka:**
- Rasa efek, ukuran aktor, dan keterbacaan UI baru belum dinilai di HP nyata; screenshot headless hanya menangkap satu frame.
- Performa belum diukur di HP kelas bawah (§6.6 riset): `Knight.glb` 3,6 MB; tiap knight ±10 mesh skinned, hingga 8 guard + 9 bala bantuan.
- Musuh kecil (kerumunan instanced) masih figur prosedural, bukan GLB; hanya 14 rig GLB musuh. *(Diperbarui 2026-10-17: seluruh horde kini monster GLB lewat vertex animation texture, lihat "Pass visual besar".)*
- Ballista atap keep (jangkauan 360/400 px) hanya menjangkau halaman dalam, jadi jarang menembak bila gerbang belum jebol. Tidak diubah; perlu keputusan balance. *(Diperbarui 2026-10-17: 440/500 px di bailey setengah ukuran, mencapai jalan gerbang.)*
- Balance di benteng ringkas: bot tower-builder turun dari 3/3 ke 2/3 (lihat tabel). Belum disetel ulang. *(Diperbarui di pass "Momen akhir run": dengan 10 seed, tower-builder 8/10 dan builder 10/10; riset di skala 1 mencatat tower 4/5, jadi tidak ada bukti regresi.)*
- Panel menang di `land-complete.png` menampilkan total 2 kill (guard 2) karena skrip melompat langsung ke fajar ke-3. Angka itu artefak skrip, bukan hasil main 3 malam. Panel kalah (`land-failed.png`: 29 kill = Kapten 22, guard 6, ballista 1) dan `fx-end.png` (21 kill = Kapten 17, guard 4) memakai kill hasil simulasi, tetapi kekalahannya dipicu skrip. Panel menang setelah 3 malam penuh belum pernah ditangkap. *(Diperbarui: kini tertangkap di `fx-win.png`, pass "Momen akhir run".)*
- Draw call per knight belum digabung; dampaknya belum diukur.
- R2–R17 dan R20 belum dibangun. *(Diperbarui: R2, R3, R4 dibangun di pass "Momen akhir run".)*

## Riset UX & replay — "mau main sekali lagi?" (2026-10-16)

**Konteks:** user meminta dua hal:
- riset review dan testimoni pemain (Play Store, forum, Steam, platform review lain) tentang UX yang mendapat review positif;
- memeriksa loop Survival "sebagai gamer": apakah pemain mau main sekali lagi.

**Hasil:** berupa dokumen, bukan kode game, di `docs/UX-REPLAY-RESEARCH.md`. Isinya:
- 12 pola UX dari review, masing-masing dengan kutipan + sumber;
- log satu run;
- scorecard 15 faktor replay;
- rekomendasi P0–P2 (R1–R20) dengan ukuran berhasil;
- daftar sumber.

**v2 (2026-10-16), atas permintaan "tidak ada coding, only research dan pelajari experience user":** riset saja, tanpa perubahan kode game atau tools. Tambahannya:

- §2.1: 9 pola yang dipuji di review bintang 5. Sumbernya Kingdom Rush, BTD6, Vampire Survivors, Duck Survival App Store, Thronefall, dan Archero.
- Checklist UX positif **11/16**: kesan pertama kuat; yang kurang adalah pilihan kesulitan, "lihat pertahananmu bekerja", dan tantangan setelah menang.
- Persona gamer dan peta perjalanan pemain (emosi per momen).
- Temuan baru: tombol NIGHT (tidak bisa dibatalkan) berjarak 10 px dari BUILD, sehingga ada risiko salah ketuk.
- Rekomendasi baru:
  - R17: pilihan EASY/NORMAL;
  - R18: NIGHT anti-salah-ketuk;
  - R19: kontribusi bangunan di ringkasan.
- Protokol playtest manusia (§6.1–§6.4) dan cara memantau review setelah rilis (§6.5).

**v3 (2026-10-16), permintaan yang sama dikirim ulang:** tetap riset saja, tanpa perubahan kode game atau tools. Tambahannya:

- **§2.3 Pemain Indonesia.** Sumbernya ulasan Google Play versi ID (Kingdom Rush, BTD6), survei Jakpat 2023/2025, Adjust 2025, dan IDC.
  - Temuan: 82 % main untuk mengisi waktu luang dan 60 % untuk melepas stres; sesi rata-rata 44,31 mnt (terpanjang di dunia); 76 % HP berharga < US$200.
  - Implikasi:
    - ringan di HP murah dan offline adalah syarat UX;
    - EASY dan retry lebih penting;
    - sesi panjang = ruang banyak run, asalkan ada alasan main lagi.
- **§3.7 Loop 3 lapis.** Loop inti dan loop sesi ada; loop meta tidak ada. Lensa motivasi SDT: kompetensi ✅, otonomi ⚠️, keterhubungan ❌.
- **R20:** kartu hasil untuk dibagikan, tanpa server.
- **§6.6:** uji HP RAM 3 GB (panas, patah-patah, baterai, mode pesawat) dan diary 7 hari.

**Verdict (desain + bot, belum playtest manusia):**
- Sesi pertama kuat:
  - ±5,3 menit per run;
  - tujuan jelas, retry instan;
  - tanpa energi, iklan, atau chores;
  - run tersimpan saat aplikasi ditutup.
- Setelah kalah: kemungkinan main lagi.
- Setelah menang: hampir tidak ada alasan main lagi. Tidak ada rekor, bintang, unlock, atau tingkat sulit, dan run berikutnya identik (`NIGHT_DOORS` tetap, dompet hari sama di semua seed).
- Scorecard 16/30.

**Bug yang ditemukan:** panel menang menampilkan `nightStats.kills`, yang di-reset di setiap `startNight()`. Akibatnya panel hanya menghitung kill malam 3 (`land-complete.png` lama menunjukkan "💀 2"). **Diperbaiki** di pass "Perbaikan dari feedback user" (`runStats`).

**Alat ukur baru:** `tools/survival-uxprobe.mjs`. Ini alat ukur yang hanya mencetak hasil, bukan gate. Hasilnya untuk 4 persona × 5 seed:

| Ukuran | Hasil |
|---|---|
| Target pertama per malam | 9–14,7 dtk jam malam |
| Porsi malam dengan target | 48–72 % (bot yang bertahan) |
| Jeda kosong terlama | 9–15 dtk |
| Ekor kosong sebelum fajar | sampai ±12 dtk |
| Aksi terjangkau | 12 (hari 2) / 16 (hari 3) |
| Waktu hari versi manusia | ±50 / ±31 dtk |

Bukti ada di `qa-evidence/ux-replay/uxprobe.txt` dan `uxprobe.json`.

**Belum / terbuka:**
- Yang sudah dibangun (pass "Perbaikan dari feedback user"): R1 sebagian (total kill run + kill per sumber di panel akhir; rekor/bintang belum), R18a (NIGHT dipisah dari BUILD), R19 (kontribusi bangunan di panel fajar + pil status siang). Sisanya belum. *(Diperbarui: pass "Momen akhir run" melengkapi R1 dan membangun R2, R3, R4, dan MVP R19 di panel akhir. R5, R6, dan P1/P2 lainnya belum.)*
- Playtest manusia (PLAY AGAIN tanpa diminta, skor "mau main lagi?") belum dilakukan.

## Bookend K1: intro sinematik + bala bantuan tiba (2026-10-16)

**Konteks:** user menulis "next" tanpa rincian. Dari rencana §12 fase 2 dan daftar "Belum ada" K1, dua hal ini paling dekat dengan tes 3 pertanyaan (kamu siapa / melindungi apa / tujuannya apa):
- **intro sinematik K1** (§4) — sebelumnya hanya banner pembuka;
- **bala bantuan tiba di fajar ke-3** — sebelumnya langsung panel menang.

**Implementasi** (yang ada di kode):

| Area | Isi | File |
|---|---|---|
| Intro (7,2 dtk) | Dimainkan di dalam run: dunia 3D tetap digambar, sedangkan jam malam, horde, dan cooldown Flare menunggu. HUD dan stick disembunyikan. Malam dibuka saat gelombang 1 sudah berkumpul di luar gerbangnya: jam melompat ke tanda gelombang pertama (4% malam) dan menggantikan detik-detik kosong. **Shot 1** puncak menara (warga + bendera) → **shot 2** horde di luar gerbang utara, gerbang di tengah frame, kamera mendorong pelan → **shot 3** Kapten (chevron kuning + ring hijau), terompet berbunyi di 5,2 dtk → frame main. Serah terima ditandai banner `HOLD THE KEEP` | `src/game/survival.js` (`CINE`, `_startIntro`, `_introKeys`, `updateCine`, `endCine`) |
| Caption | Satu caption per shot: chip ikon + judul di atas bar bawah, baris kecil di dalam letterbox. `PROTECT THE KEEP` / `ITS PEOPLE SHELTER INSIDE`; `THE HORDE COMES AT NIGHT` / `THEY BREAK IN THROUGH THE GATES`; `YOU ARE THE CAPTAIN` / `HOLD 3 NIGHTS. REINFORCEMENTS ARE COMING` + trek 3 bulan → panji. Teks UI tetap bahasa Inggris | `src/ui/survival.js` (`drawCine`) |
| Sekali per save | `save.survival.introSeen` diset saat intro mulai, jadi tab yang ditutup di tengah intro tidak mengulangnya. Reload tengah malam, PLAY AGAIN, dan sesi baru langsung main | `survival.js` |
| Skip | Tap di mana saja sesudah 0,35 dtk. Satu-satunya item UI adalah `survival:SKIP` seluas layar; Enter/Space juga bisa. Skip memotong ke frame akhir. Pause/tab tersembunyi di tengah sinematik kembali ke sinematik | `ui/survival.js`, `game.js` (`resumeSurvival` → `panelFor()`) |
| Bala bantuan (7,0 dtk) | Fajar ke-3 berjalan begini: gerbang utama terbuka. Pembawa panji + 8 prajurit tombak (4 baris × 2) berbaris dari luar gerbang (210 px/dtk) ke dua barisan di depan menara. Hunter menoleh ke mereka, warga di atas menara bersorak (lompat, dua tangan naik), fanfare berbunyi. Kamera bergerak dari gerbang + jalan luar, masuk, lalu ke menara + barisan. Caption warna fajar `REINFORCEMENTS ARRIVED!` / `THE KEEP HELD FOR 3 NIGHTS`. Sesudahnya panel menang yang sudah ada (`PLAY AGAIN`). Reload setelah menang: kolom berdiri di barisannya di bawah panel, tanpa replay. PLAY AGAIN membersihkan kolom dan menutup gerbang | `survival.js` (`_reliefColumn`, `updateRelief`, `_startArrival`) |
| Model 3D | Prajurit: tunik biru dengan garis tabard putih, sabuk, helm baja kerucut berpinggiran, perisai bulat biru dengan pinggir + boss emas, tombak. Bagian prosedural digabung menjadi satu geometri ber-vertex-color: 1 InstancedMesh badan, 1 InstancedMesh kaki (melangkah), dan bayangan blob instanced. Pembawa panji 1 mesh + bendera swallowtail biru/emas yang berkibar. ±6 draw call, hanya ada di fase menang | `src/game/world3d.js` (`mergeColoredParts`, `_makeRelief`, `_syncRelief`) |
| Audio | 2 suara WebAudio prosedural baru (tanpa sampel): `horn` (sawtooth 110/165 Hz + sub 55 Hz, lowpass yang membuka) dan `fanfare` (G3–C4–E4 pendek + G4 panjang, dengan oktaf atas) | `src/core/audio.js` |
| Kamera | `renderer.setZoomAbsolute()` untuk close-up di luar batas zoom main (0,5–1,5×). Frame setiap shot diangkat setengah tinggi chip caption agar subjek tidak tertutup | `src/core/render.js`, `survival.js` (`_cineLift`) |
| Toggle | Route asli memutar sinematik; `?cine=0` mematikan keduanya. Harness, bot, dan balance (Node) tidak memintanya. Tool QA yang men-skrip malam dari detik pertama memuat `/?cine=0` (devqa, survivalshots, envqa, layoutqa desktop) | `src/main.js`, `tools/*.mjs` |

**Perbaikan yang ditemukan sambil jalan:**
1. Fase `complete` (fajar kemenangan) dulu dirender dengan rig malam, karena hanya `day` yang dianggap siang; `land-complete.png` lama gelap (luma 105,5). Kini memakai `daylight()`: luma 117,9 dan kolom bala bantuan terlihat di belakang panel.
2. Kadens update shadow map World3D memakai `game.time`, yang mulai ulang setiap malam dan siang. Akibatnya setelah ganti fase shadow map membeku sampai waktu fase baru menyusul waktu fase lama, misalnya sampai ±72 dtk pertama siang. Kini jam yang mundur langsung memicu refresh, lalu kadens berjalan seperti biasa; ini juga berlaku di route legacy. Percobaan pertama memakai jam `game.now` justru membuat cek envqa "door shadow maps refresh at swing start/end" gagal (refresh tambahan di tengah ayunan pintu), jadi diganti dengan cara ini.
3. Muzzle flash tembakan terakhir malam tidak lagi terbawa ke fajar atau membeku selama sinematik.

**Gate otomatis** (implementasi, bukan acceptance), dijalankan serial:
- `node tools/harness.mjs` — bagian survival 49 PASS / 0 FAIL, termasuk 5 cek sinematik, "no runtime errors" → `qa-evidence/survival-k1/harness-survival.txt`.
- `node tools/survival-devqa.mjs` (browser, landscape + portrait) — **22/22 PASS**, termasuk 4 cek sinematik di halaman kedua dengan sinematik menyala → `qa-evidence/survival-k1/devqa.json`.
- `node tools/survivalshots.mjs --landscape --tag=land` — 25 shot, 0 page error. Termasuk 5 shot baru `land-intro-keep/horde/captain` dan `land-arrival-gate/lines`. `land-night-40s` kini menahan keep agar shot tetap malam: keep yang dibiarkan idle jatuh di 38,5–40,5 dtk tergantung RNG browser → `qa-evidence/survival-k1/land-*.png` (50 %) + `land-metrics.json`.
- `node tools/envqa.mjs --mode=3d-smoke` — **PASS**. Cek "door shadow maps refresh at swing start/end": buka 1/1/2, tutup 3/3/4.
- `node tools/layoutqa.mjs` — PASS (semua bagian, termasuk browser errors).
- `node tools/glbtest.mjs` — PASS.
- `node --check` — 72 file JS/MJS OK.

**Belum / terbuka:**
- Tes 3 pertanyaan dengan pemain baru (≥ 4/5) belum dilakukan. Belum dinilai juga apakah 7,2 dtk terlalu panjang atau pendek, dan apakah caption terbaca di HP.
- Terompet/fanfare belum didengar di perangkat. Headless tidak memutar audio; yang dicek hanya bahwa tidak ada error.
- Bala bantuan hanya adegan penutup: mereka tidak ikut bertarung. Kekalahan tetap langsung ke panel kalah, tanpa adegan.
- Variasi pitch audio umum dan art pass production masih terbuka.

## Dunia benteng untuk Survival — revisi dunia K1 (2026-10-16)

**Feedback user:** "terasa aneh barack dll ada di dalam ruangan harusnya dunia nya di sesuaikan bukan menggunakan dunia yg cerita sudah beda".

**Keputusan:** Survival mendapat level sendiri, yaitu **benteng (bailey)** terbuka sesuai gambar konsep K1 (`docs/concepts/k1-benteng-terakhir.jpg`).
- Mansion tetap dipakai route `?legacy=1`.
- Nada tetap dark stylized.
- Semua objek dunia tetap mesh 3D: prosedural, atau kit berlisensi yang sama. Byte aset tidak diubah.
- Tidak menyentuh IAP, `src/shop`, atau server.

**Implementasi** (yang ada di kode):

| Area | Isi | File |
|---|---|---|
| Level | `Fortress extends Mansion`: bailey 2600×1900 px (±50×37 m) dengan 9 zona yang menutup halaman persis, tanpa tembok di antaranya (`findRoom()` menyebut zona). Zonanya: inner ward, 4 jalan batu berbentuk salib, dan 4 halaman rumput. Tembok hanya di keliling luar, dipotong gerbang. 12 menara (4 sudut 150 px, 8 gerbang 84 px) adalah solid collision. Perabot halaman berskala nyata: tong, tumpukan peti, sumur, meja pasar. Hutan luar memakai `makeExterior()` yang sama. Batas dunia = bailey + 760 px untuk gerombolan | `src/game/fortress.js` (baru) |
| Gerbang | 6 gerbang bekerja sebagai pintu (HP, celah tembak, breach, papan, barikade): MAIN GATE di selatan 260 HP (menghadap kamera; alias `frontDoor`), NORTH/EAST/WEST GATE 200, postern NW/SE 110 | `fortress.js` |
| Pemilihan dunia | `game.js` membuat `Fortress` untuk mode survival dan `Mansion` untuk legacy. Titik mulai di sisi timur menara | `src/game/game.js` |
| Aturan K1 | Menara Utama di tengah inner ward (`keepSpot`). Wilayah panji tumbuh per zona: Lv1 5 (inner ward + 4 jalan), Lv2 7 (+ halaman postern), Lv3 9 (+ 2 sudut terakhir). 15 lingkaran bertipe: 1 ekonomi per zona (posisi `at` di luar badan jalan, jadi jalan ke menara tetap terbuka) + 1 ballista di dalam setiap gerbang. Gelombang per malam: N1 utara → timur → selatan (gerbang utama baru di gelombang 3), N2 barat → postern NW → selatan, N3 postern SE → utara → selatan. Breaker tetap menyerang gerbang utama dulu | `src/game/survival.js` |
| Save | Bangunan dengan id lingkaran rumah (mis. `basement`, `hall:tower`) dipindah ke lingkaran kosong bertipe sama di bailey (dalam panji dulu), levelnya dipertahankan | `survival.js` |
| Lantai | EnvKit: zona `grass` tidak diberi ubin sehingga tanah halaman terlihat. Tepi jalan tetap diubin penuh, dan ambang gerbang di halaman rumput tetap batu | `src/game/envkit.js` |
| Dunia 3D | Parapet + 146 merlon (instanced) di tembok. Menara sudut bundar bergerigi dengan bendera biru berkibar. Menara gerbang dengan jembatan bergerigi di atas gerbang dan panji biru/emas. Tanah halaman sedikit berbeda dari lantai hutan, dengan warna siang/malam. ±250 bagian statis digabung per material, jadi seluruh benteng hanya 13 mesh | `src/game/world3d.js` |
| Teks | `BLUE GROUND: YOU HIT HARDER`, `SOLDIERS GUARD THE GATES`, `GO TO THE GATE: SHOOT THROUGH IT`. Kartu menara menghitung jumlah zona dari `TERRITORY` | `src/ui/survival.js` |
| QA tools | harness, devqa, survivalshots, dan balance memakai id gerbang/zona benteng (`southGate`, `northGate`, `posternNW`, `south:tower`, `north`/`west`/`ward` …) | `tools/*.mjs` |

**Balance bot** (3 seed, 72 dtk per malam), dibandingkan dengan dunia mansion:

| Bot | Benteng | Mansion (`2b14636`) |
|---|---|---|
| builder | 3/3 menang (menara 1200/1200 di Malam 2) | 3/3 |
| hunter-builder | 3/3 | 3/3 |
| tower-builder | 3/3 | 0/3 |
| keep-builder | 0/3 | 1/3 |
| idle / flare / passive-builder | 0/3 (menara jatuh di Malam 1, ±40 dtk) | 0/3 (±51 dtk) |
| active (menembak tanpa membangun) | 0/3 (kalah Malam 2) | 0/3 (kalah Malam 3) |

Ballista di gerbang lebih efektif di halaman terbuka. Idle kalah lebih cepat karena jalan dari gerbang ke menara lurus. Semua ini **perlu playtest manusia**.

**Gate otomatis** (implementasi, bukan acceptance): semua dijalankan ulang setelah perubahan dunia, serial (2 core).
- `node tools/harness.mjs`: **44 PASS, 0 FAIL**. Bagian survival 43 cek, antara lain: gelombang 66/78/90; panji ×1,5; breach → flow field → menara di benteng (8,3 dtk dari gerbang utama); semua badan gelombang mulai di luar tembok untuk 6 gerbang; loop 3 hari dengan panji 5 → 7 → 9 zona; migrasi save rumah per tipe; lingkaran ballista di dalam gerbang utama; idle kalah / builder menang. Bot run legacy: no runtime errors.
- `survival-devqa.mjs`: **18/18 PASS** (0 page error, 0 console error, 0 request gagal).
- `envqa.mjs --mode=3d-smoke`: **PASS**.
  - Luma playfield Malam 1 98,9/255 dengan 4,2% hampir hitam (dunia mansion: 72).
  - Benteng terlihat: 12 menara, 146 merlon, 13 mesh.
  - Upgrade menara lewat UI memperlebar panji 5 → 7 zona.
- `layoutqa.mjs`: **9/9 PASS**. Desktop boot route default sekarang memeriksa `world=bailey, zones=9/9`; cek rumah legacy tidak berubah.
- `glbtest.mjs`: **PASS**.
- `survivalshots.mjs --landscape --tag=land`: **20 shot, 0 page error**, disimpan di `qa-evidence/survival-k1/` (50%). Shot `guard-*` diambil ulang setelah offset skenario dibuat relatif terhadap arah dalam gerbang (sebelumnya offset untuk pintu kapel menaruh guard di tembok gerbang utara).
- Probe geometri Node: keenam gerbang terhubung dalam → menara dan luar → keliling tembok; 0 perabot menembus tembok/menara.
- `node --check`: 71 file PASS. `npm audit --prefix tools`: 0 kerentanan.
- `node tools/bundle.mjs check`: **FAIL 1** (token origin trial Digital Goods di `index.html`; hanya pemilik akun yang bisa mengisi). Tidak berubah.

Ekspektasi tes yang diubah karena dunianya berubah (bukan dilonggarkan):
- id pintu/ruangan → gerbang/zona benteng;
- jumlah gerbang 7 → 6;
- panji akhir 11 → 9;
- desktop boot 11 ruangan → 9 zona benteng;
- tes flow field ke menara meniadakan guard. Guard kini berjaga tepat di jalur selatan dan memang dicakar lebih dulu.

Tes envqa malah diperketat: sekarang ikut memeriksa jumlah menara, merlon, dan mesh benteng.

**Belum / terbuka:**
- Playtest manusia di dunia benteng: keterbacaan gerbang yang diserang dari luar layar, jarak jalan siang, dan apakah idle 40 dtk cukup untuk FTUE.
- Perf di perangkat: mesh benteng sudah digabung, tetapi belum diukur di HP.
- Konten benteng tambahan (mis. lingkaran build di atas tembok, parit) belum ada.

## K1 "Benteng Terakhir" — implementasi vertical slice (2026-10-16)

> **Catatan revisi dunia (2026-10-16):** slice ini dibuat di dunia mansion. Posisi menara (Main Hall), wilayah per ruangan (5/8/11), 16 lingkaran per ruangan, dan pintu Night 1 (chapel/cellar/front) di bawah ini sudah **diganti** oleh bagian "Dunia benteng untuk Survival" di atas. Aturan K1 lainnya tetap.

**Permintaan user:** "ya saya setuju dan pastikan dunia nya 3d".
- Ke-8 rekomendasi di `docs/DESIGN-SYSTEM-PLAN.md` §13 disetujui.
- Semua objek baru (Menara Utama, lingkaran bangun, bangunan hantu, wilayah panji, rak senjata, perancah, tukang, barikade) adalah **mesh 3D** di pipeline WebGL yang sama (`src/game/world3d.js`, Three.js). Canvas tetap hanya untuk HUD.
- Pipeline WebGL dan byte aset berlisensi tidak diubah (semua mesh baru prosedural). Tidak menyentuh IAP, `src/shop`, atau server. Route `?legacy=1` tetap.

**Implementasi** (yang ada di kode):

| Area | Isi | File |
|---|---|---|
| Jantung base | **Menara Utama** (Keep) di tengah Main Hall (440, 310), r 112, collision 3 kotak; HP 600 / 900 / 1200 per level. Kalah bila HP 0 (`THE KEEP FELL`) atau Kapten tumbang. 5 status `safe / threat / attacked / critical / fallen` (`keepState()`) | `src/game/survival.js` |
| Musuh | Flow field multi-target (cincin 16 titik di dinding menara); musuh yang sampai mencakar menara (`KEEP.damage` swarm 12 / individual 36 / breaker 72 per 1,5 dtk). Breaker: pintu → menara | `survival.js` |
| Wilayah panji | Menggantikan cahaya: ruangan per level menara (Lv1 5, Lv2 8, Lv3 11 ruangan). Di dalamnya musuh menerima damage ×1,5. **Tidak ada** perlambatan, pelemahan cakaran, atau potongan damage pintu lagi | `survival.js`, `enemies.js`, `config.js` |
| Ekonomi | Oil → **emas** (tidak terbakar). Tambang menggali emas selama malam (+6/10/14). Sawmill: kayu saat fajar + papan pintu. Barak: +1/2/3 prajurit. Fajar menambal 35% HP menara yang hilang; sisanya **REPAIR** (6 kayu → +150 HP) | `survival.js`, `config.js` |
| Build P1 | 16 **lingkaran bertipe** (1 lingkaran bangunan per ruangan + 1 lingkaran ballista di ruangan berpintu luar), plus titik menara, rak senjata (upgrade Hunter), dan barikade pintu depan. Siang: Hunter berjalan dengan stick (×1,35) atau tap chip → berjalan sendiri. Tombol kontekstual BUILD / UPGRADE / REPAIR / MAX + kartu mini 2 stat di zona jempol kanan; NIGHT di sebelahnya. Kolom kiri, bubble "+", dan pill READY dihapus | `survival.js`, `src/ui/survival.js`, `game.js`, `input.js` |
| Dunia 3D | Menara prosedural: 3 level (hoarding kayu → lonceng + panji besar → 2 panji + ballista atap yang menembak dari Lv2), 3 warga yang bereaksi per status, retakan, panji robek, guncangan saat dipukul, memudar saat Hunter di belakangnya. Tint lantai biru untuk wilayah panji. Lingkaran putus-putus + bangunan hantu biru (abu-abu bila terkunci). Model tambang emas dan barak baru. Perancah + tukang berpalu. Pop 0.85 → 1.08 → 1.0 saat bangunan jadi. Cincin jangkauan ballista saat berdiri di lingkarannya | `world3d.js` |
| HUD | Malam: bar Menara Utama (landscape: di samping pause; portrait: di bawah pill), alarm merah di kaki menara / pointer tepi, banner di bawah pada layar pendek. Siang: track 3 malam + panji bala bantuan, chip bangunan di atas lingkaran, pointer ke lingkaran terdekat, cincin progres di atas perancah. Kartu fajar: emas/kayu/tambang/kerusakan menara/tambalan + "REINFORCEMENTS IN N". Layar akhir: `REINFORCEMENTS ARRIVED!` / `THE KEEP FELL`. Ikon baru: gold, keep, mine, barracks, banner, instant | `src/ui/survival.js`, `survivalIcons.js` |
| Tembakan | Damage Hunter 32 / 40 / 48. Lv2: bolt tembus 1 tubuh. Lv3: kipas 3 bolt. Angka damage 18 / 24 (wilayah) / 30 (kill) dengan pop. Knockback 120 (kill 260). Partikel kill. Muzzle flash + hentakan mundur. Hit-stop 50–60 ms untuk kill besar dan Flare. Shake bertingkat (beruntun 0,05 · besar 0,16 · breach 0,22 · Flare 0,42) | `survival.js`, `game.js` |
| Pembuka & FTUE | Banner Malam 1 `HOLD THE KEEP / REINFORCEMENTS IN 3 NIGHTS`. Chip: move, auto, banner ("BLUE GROUND: YOU HIT HARDER"), keep, flare, build ("WALK INTO A CIRCLE TO BUILD"), level, guard, door, rescue. Chip direset tiap ganti fase dan teksnya mengecil agar muat | `survival.js`, `src/ui/survival.js` |
| Save | `save.survival` memakai `gold`, `keepLevel`, `keepHp`, id lingkaran. Save pra-K1 dimigrasi (oil → emas, perapianLevel → keepLevel, extractor → mine, shelter → barracks, menara bebas → lingkaran `<room>:tower`; bangunan yang tak punya lingkaran bertipe sama dibuang) | `survival.js`, `util.js` |

**Tuning yang berubah dari usulan dokumen** (diukur dengan bot, perlu playtest manusia):
- Damage cakaran ke menara diturunkan 25% (16/45/90 → 12/36/72) agar rencana menara-saja/Hunter-saja bisa menahan Night 3.
- Urutan pintu Night 1 kini `chapel → cellar → front`. Alasannya: pintu depan langsung membuka ke hall menara, sehingga pemain diam kehilangan menara di detik 27; kini detik ~51, dan 30 detik FTUE pertama tetap utuh.
- Lantai cahaya malam survival 0,8 → 0,9 (pool perapian hilang).
- Hunter pulang ke sisi timur menara setiap fajar.

**QA yang benar-benar dijalankan (implementasi, bukan acceptance):**

| Perintah | Hasil |
|---|---|
| `node tools/harness.mjs` | **44 PASS**, exit 0. Battery survival ditulis ulang untuk K1: wilayah panji ×1,5 tanpa slow, pintu tanpa diskon, breach → menara → kalah, migrasi save, lingkaran bertipe, level menara/bangunan/Hunter, ballista, guard, loop 3 hari |
| `node tools/survival-devqa.mjs` | **18/18 PASS**. +2 cek K1: menara 3D di tengah Main Hall (solid, panji, 3 warga); P1: stick menggerakkan Hunter di siang hari, satu tombol BUILD di lingkaran, tap sungguhan memulai tukang |
| `node tools/envqa.mjs --mode=3d-smoke` | **PASS**. Luma malam 72/255 (11,2% hampir hitam; sebelumnya 79,6 dengan api). Upgrade menara lewat tombol UI menaikkan level 3D dan tint wilayah 5 → 8 |
| `node tools/layoutqa.mjs` · `node tools/glbtest.mjs` | **PASS** (9 gate) · **PASS** |
| `node --check` (72 file) · `npm audit --prefix tools` | **PASS** · **0** kerentanan |
| `node tools/bundle.mjs check` | **FAIL 1**: token origin trial Digital Goods (kredensial user; tidak berubah) |
| `node tools/survivalshots.mjs --landscape --tag=land` | 20 shot, 0 page error |

Balance bot (3 seed × 8 bot, 72 dtk/malam):

| Bot | Menang |
|---|---|
| idle | 0/3 (N1, menara runtuh ±51 dtk) |
| flare | 0/3 |
| passive-builder | 0/3 |
| active | 0/3 (kalah N3, Hunter tumbang) |
| builder | **3/3** (menara Lv3 ±840–880/1200 di akhir N3) |
| hunter-builder | **3/3** |
| keep-builder | 1/3 |
| tower-builder | 0/3 (menara Lv2 runtuh di N3) |

Rencana spesialis lebih lemah dibanding aturan api lama (dulu semua builder 3/3). Ballista menjaga pintu, bukan menara.

**Bukti:** `qa-evidence/survival-k1/`.
- Landscape 844×390, diperkecil 50%: `land-*.png`, termasuk `land-day-keep.png` (tombol UPGRADE/REPAIR menara), `land-day-circle.png` (lingkaran ballista + cincin jangkauan + hantu), `land-day-build.png` (perancah + progres), `land-prog-keep.png` (menara Lv3), `land-prog-hunter.png` (rak senjata), `land-night2-flare.png` (menara diserang), `land-complete.png`, `land-failed.png`.
- Data: `land-metrics.json`, `harness-survival.txt`, `balance.txt`, `devqa.json`.
- FTUE portrait diperbarui: `qa-evidence/survival-ftue-*.png`.

**Belum ada / masih terbuka:**
- ~~intro sinematik (kamera di puncak menara)~~ — **kini ada** (lihat "Bookend K1"); belum diuji pemain;
- ~~adegan bala bantuan tiba di fajar ke-3~~ — **kini ada** (lihat "Bookend K1"); bala bantuan belum ikut bertarung;
- audio: terompet + fanfare prosedural kini ada; variasi pitch umum dan audio lain belum;
- art pass production (material, prop, kehidupan);
- playtest manusia: pemahaman "siapa/melindungi apa/tujuan", rasa tembakan, rasa wilayah panji, keterbacaan lingkaran;
- performa perangkat (menara + lingkaran + crowd);
- rencana menara-saja/ballista-saja yang kalah di N3 (keputusan balance butuh playtest).

## Arah desain & orientasi (2026-10-16)

**Keputusan user:** game **landscape only**. `manifest.webmanifest` sudah `orientation: landscape`; layout portrait tidak lagi menjadi target desain. Catatan "keputusan orientasi masih menunggu user" di bagian-bagian di bawah adalah catatan historis pass sebelumnya.

**Feedback user setelah pass guard** (desain dinilai cukup bagus, tetapi):
- kartu landscape terlalu besar;
- damage tembakan belum terasa kuat;
- layout upgrade membingungkan;
- fungsi build/upgrade belum terasa;
- penanda "+" hijau tidak dimengerti;
- UI belum pas;
- dunia dan visual api belum production.

Game juga harus menjawab dan memvisualisasikan **siapa pemain, apa tujuannya, dan apa yang dilindungi** — "api" saja belum dapat feel-nya.

**Instruksi user:** jangan koding dulu; brainstorming dan design system plan lebih dulu.

**Revisi 1 (konsep api) — ditolak.**
- Yang ditolak: konsep "Penjaga Api", opsi penempatan api, dan tiga pola build (strip bawah / ring menu / tahan untuk bayar).
- Alasan user: tidak ada feel dengan api "dan apa pun yang berhubungan dengan itu"; minta cerita lain dan referensi build lain.
- Api tidak dipakai lagi sebagai pusat cerita.

**Status (revisi 2):** `docs/DESIGN-SYSTEM-PLAN.md` (DRAFT) berisi:
- 6 konsep tanpa api, masing-masing dengan **jantung base** (objek yang dilindungi): K1 Benteng Terakhir (rekomendasi), K2 Kabur dari Duskhold, K3 Ruang Aman, K4 Telur Penjaga, K5 Vampir, K6 Harta;
- 4 gambar konsep buatan AI di `docs/concepts/` (moodboard, **bukan aset game**);
  *(2026-10-17: atas permintaan eksplisit user, gambar konsep AI karakter dan senjata kini juga ada di `ASSET_CHARACTER/`. Statusnya tetap referensi untuk pemodelan, bukan aset game; lihat "Pass BUILD 10".)*
- referensi baru: Duck Survival, Dead Ahead, Survival Machine, Dome Keeper, Plants vs. Zombies, Kingdom Rush, City Defense Z, arcade idle, Wasteland Life;
- 7 pola interaksi build; rekomendasi: jalan ke lingkaran + `BUILD` (Duck Survival) + ikon upgrade kontekstual;
- konsekuensi aturan bila api dihapus: kalah = jantung hancur, aturan cahaya perlu keputusan ulang, wilayah bangun, resource pengganti Oil;
- bagian yang tetap: diagnosis, alur build/upgrade, layout landscape, tokens, combat feel, art direction, rencana bertahap;
- revisi 1 diarsipkan di Lampiran A.

**Keputusan user (2026-10-16):**
- konsep **K1 "Benteng Terakhir"**: Kapten Duskhold melindungi **Menara Utama** + warga, dan bertahan 3 malam sampai bala bantuan datang;
- pola build **P1**: jalan ke lingkaran + `BUILD`, ala Duck Survival;
- nada visual **dark stylized seperti sekarang**.

**Spesifikasi awal K1** ada di §3.4, dengan mockup `docs/concepts/k1-mockup-dark-day.jpg` (AI, bukan aset game):
- Menara Utama di tengah Main Hall (hub denah);
- level & status menara;
- track bala bantuan;
- pemetaan aturan Oil/cahaya → emas/wilayah panji;
- lingkaran bertipe per ruangan;
- alur P1 rinci.

Aturan pengganti dan 8 keputusan lanjutan (§13) masih **usulan** dan perlu dikonfirmasi user sebelum koding.

**Implementasi:** belum ada — tidak ada file kode game yang diubah di langkah ini. **Acceptance:** tidak ada yang diklaim.

## Guard bisa jatuh — risiko di pintu (2026-10-15)

Permintaan: *next* ketiga → **guard yang bisa terluka** (opsi pertama dari laporan menara: survivor bisa jatuh, jadi ada risiko di pintu). Tetap icon-first, tanpa tombol baru, tanpa kartu "pilih 1 dari 3". Keputusan orientasi masih menunggu user; `manifest.webmanifest` tidak diubah.

**Aturan** (`src/game/survival.js`: `GUARD`, `SurvivalGuard`, `guardInReach`, `guardToHunt`, `hurtGuard`, `_downGuard`, `_updateRescue`, `_loseGuard`). Aturannya sengaja sama dengan aturan Hunter yang sudah ada:

| | Guard | (Hunter, pembanding) |
|---|---|---|
| HP | 40 | 100–140 |
| Siapa yang mencakar | body yang sudah masuk rumah / lewat pintu yang jebol, dalam jarak cakar (radius + 12 px) | sama |
| Di cahaya Perapian | cakaran ×0.5, hanya guard yang menghalangi jalan | sama |
| Di gelap | body dalam **110 px** mendatangi guard (maks **3** per guard, sisanya terus ke api) | 170 px |
| I-frame setelah cakaran | 0.5 dtk | 0.75 dtk |
| HP ≤ 35% | mundur ke pos dekat api | — |
| HP 0 | rebah di tempat, berhenti menembak, diabaikan musuh | kalah |

- **Menolong:** Hunter berdiri ≤ 70 px dari guard yang jatuh selama **1.5 dtk** → bangun dengan 20 HP (50%). Menjauh sebelum selesai = progres turun 2× lebih cepat. Tidak ada tombol; cukup berdiri di dekatnya.
- **Waktu:** guard yang jatuh dan **ditinggal sendirian 20 dtk hilang** — survivor −1 untuk sisa run (yang hilang tidak kembali; build/level Shelter berikutnya tetap menambah sesuai kapasitas tambahannya). Jam berhenti selama Hunter menolong. Guard yang masih jatuh saat fajar bangun lagi; fajar dan senja menyembuhkan semua guard.
- **Save:** malam hari `save.survival.guards` menyimpan HP, status jatuh, posisi, progres tolong, dan waktu sendirian; reload tengah malam mengembalikan guard yang jatuh di tempatnya. Guard yang hilang langsung disimpan (survivor berkurang) supaya tidak bisa dibatalkan dengan reload.
- **Kenapa aturannya begini (diukur, bukan ditebak):** versi pertama (hilang bila masih jatuh saat fajar, tanpa i-frame, tanpa buruan) diuji dengan bot dan ternyata tidak adil: kerumunan 8 body mendaratkan 8 cakaran dalam satu frame (guard 40 → 0 seketika) dan guard yang jatuh 2 dtk sebelum fajar langsung hilang — setiap bot engaged kehilangan tepat 1 guard di akhir Night 1 tanpa kesempatan menolong. Dengan i-frame saja guard justru tidak pernah jatuh: pos pintu berada ±80 px dari jalur aliran musuh, di luar jarak cakar. Aturan buruan-di-gelap meniru aturan Hunter dan mengikat keselamatan guard ke cahaya: **pintu terang relatif aman, pintu gelap berbahaya** — alasan tambahan untuk menaikkan level Perapian.

**3D:** pion guard yang jatuh rebah telentang di atas ring merah (ring + x-ray merah, berdenyut); setelah ditolong berdiri lagi di ring biru. Material bersama `_guardMats` tidak diubah (material merah terpisah, ditukar per mesh).

**UI (ikon + angka):**
- Bar HP kecil di atas guard yang terluka (biru > 50%, kuning, merah ≤ 35%; putih sesaat saat kena).
- Guard jatuh → badge P3K (ikon baru `medic`) di atas pin yang menunjuk ke pionnya, dengan ring **merah yang menyusut** (sisa waktu; berkedip putih saat < 30%) atau ring **hijau yang terisi** (pertolongan Hunter). Di luar layar → penanda tepi P3K merah.
- HUD: counter guard menjadi `berdiri/total` merah berkedip selama ada yang jatuh (mis. `1/3`).
- Banner `GUARD DOWN!` (merah) dan `GUARD LOST` (merah tua): satu per jenis (dua guard jatuh bersamaan = satu banner), langsung antre paling depan, tidak memotong banner `BREACH!`/api.
- Floater hati hijau `+20` saat guard bangun. Hint sekali: `STAND BY A FALLEN GUARD TO HELP`.
- Popup fajar: baris guard `-N` merah bila ada yang hilang.

**Bug yang ditemukan dan diperbaiki di pass ini:**
- **Gelombang muncul di dalam rumah.** Formasi 7 kolom `spawnSwarm` jatuh sebagian di dalam ruangan: kolom pinggir crowd frontDoor muncul **di dalam basement** dan crowd diningDoor **di dalam gallery** (body juga muncul di atas prop). Body itu langsung berstatus di dalam rumah, melewati pintu dan berjalan ke api — tertangkap karena guard di belakang pintu utuh ikut tercakar. `_outsideSpot` kini memindahkan slot yang jatuh di dalam ruangan / di atas prop ke slot kosong terdekat lebih jauh di luar (posisi slot lain tidak berubah; urutan RNG sama). Harness: 219 body dari 7 pintu + Breaker + Individual, 0 di dalam rumah. Efeknya pada balance dicatat di bawah.
- **Metrik `br` di `survival-balance.mjs`** mencetak jumlah pintu jebol *setelah* perbaikan fajar, jadi setiap malam yang dimenangkan terbaca `br0`. Kini = jumlah pintu luar terbanyak yang jebol bersamaan selama malam itu. Bot engaged ternyata mengalami 2–5 breach per malam (bukan 0).
- **Cek pooling devqa** bergantung pada body yang muncul di basement (Hunter di dekat api menembak 0 kali dalam 20 dtk pertama setelah perbaikan). Skenario kini menaruh Hunter di belakang frontDoor; cek pooling tetap sama (> 20 tembakan, objek bolt < setengahnya).

**Balance (pengukuran, bukan gate; `--seeds=3 --duration=72`; bukti `qa-evidence/survival-guards/balance*.txt`):**

| Bot | Baseline `8c0d58a` | Hanya perbaikan spawn (`--no-guard-damage`) | Final: guard bisa jatuh + bot menolong | Final, bot tidak menolong (`--no-rescue`) |
|---|---|---|---|---|
| idle | 0/3 (N1) | 0/3 (N1) | 0/3 (N1) · jatuh 6, hilang 2 | sama |
| passive-builder | 0/3 (N1) | 0/3 (N1) | 0/3 (N1) · jatuh 6, hilang 2 | sama |
| flare | 0/3 (N2) | 0/3 (N2) | 0/3 (**N1**) · jatuh 6, hilang 6 | sama |
| active (tanpa build) | 0/3 (N3) | 0/3 (N3) | 0/3 (N3) · jatuh 8, **ditolong 3**, hilang 3 | jatuh 6, hilang 6 |
| builder | 3/3 | 3/3 | 3/3 · jatuh 0 | sama |
| fire-builder | 3/3 | 3/3 | 3/3 · jatuh 1, hilang 0 | sama |
| hunter-builder | **1/3** | **3/3** | 3/3 · jatuh 1, hilang 0 | sama |
| tower-builder | 3/3 | 3/3 | 3/3 · jatuh 2, ditolong 1, hilang 0 | jatuh 2, hilang 0 |

- Risiko guard muncul terutama untuk permainan pasif/tanpa build (guard jatuh dan hilang); bot builder jarang kehilangan guard (0–2 jatuh per 3 run, 0 hilang) — dugaan: Perapian Lv2/Lv3 menerangi lebih banyak pintu dan api terjaga; belum diukur per pintu. Menolong mengubah hasil untuk bot `active` (3 hilang vs 6).
- **Perbaikan spawn membuat game lebih mudah untuk builder:** Night 3 builder dulu 7–8 musuh mencapai api, kini 0–1; `hunter-builder` naik dari 1/3 ke 3/3. Kesimpulan pass progres sebelumnya ("Hunter Lv3 + Perapian Lv2 kalah karena api padam") ternyata sebagian disebabkan bug spawn ini dan **tidak berlaku lagi** di bot. Kesulitan untuk pemain yang membangun makin rendah → acceptance #4 makin mendesak (perlu playtest manusia sebelum mengubah biaya/ancaman).

**Belum dikerjakan:** cutaway/x-ray model penuh, pass balance setelah playtest manusia, animasi khusus guard jatuh (kini rotasi pose, bukan klip animasi).

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

**Belum dikerjakan (saat itu):** guard yang bisa terluka (dikerjakan di pass berikutnya — lihat "Guard bisa jatuh"), cutaway/x-ray model penuh, pass balance (biaya/ancaman) setelah playtest manusia.

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
- **Defense:** gelombang Swarm 21/21/24, 24/27/27, 30/30/30 (aktual = diminta; 66/78/90 per malam), HP Swarm 48→54→60, Breaker 0/1/2, dua Individual per malam. Hunter punya auto-shot (menembus celah pintu tertutup) dan skill Flare dengan radius/damage/stagger/cooldown. Survivor = guard pintu (lihat pass 2026-10-15); guard punya 40 HP, bisa jatuh, ditolong Hunter, atau hilang bila ditinggal 20 dtk (lihat "Guard bisa jatuh"). Menara crossbow menjaga pintu luar ruangannya sendiri (lihat "Menara crossbow"). Gelombang selalu muncul di luar dinding (`_outsideSpot`).
- **HUD:** lihat "UI icon-first" di atas. Coach/narrative legacy disembunyikan.

## QA yang benar-benar dijalankan (2026-10-15)

| Perintah | Hasil | Batas hasil |
|---|---|---|
| `node tools/harness.mjs` | **PASS**, exit 0. **Pass guard (44 baris PASS, exit 0, kode final; `qa-evidence/survival-guards/harness-survival.txt`):** 8 cek baru — cakaran di gelap penuh (40 → 29, cakaran 11), di cahaya ×0.5 (40 → 34.5), 8 cakaran dalam satu frame mendarat sekali (i-frame 0.5 dtk); di gelap 3 dari 5 body mendatangi guard (22 damage dalam 2.5 dtk), di cahaya 0 dari 3; HP 0 → rebah, 0 tembakan selama jatuh, body berjalan melewatinya (279 px), HUD 1/2, banner; Hunter di samping 0.8 dtk → menjauh → progres 0.00 → kembali → bangun setelah 1.50 dtk dengan 20 HP; guard ≤ 35% mundur ke pos api, yang sehat tetap di frontDoor, **0 cakaran lewat pintu utuh** selama 14 dtk kepungan (pintu menerima 129 damage); reload tengah malam menjaga guard jatuh di (−1009, 300) dengan progres 0.4 dtk dan waktu sendirian 6.5 dtk, guard lain 23 HP; ditinggal 20 dtk → hilang (survivor 2 → 1 seketika, banner `GUARD LOST`), guard yang masih jatuh saat fajar bangun dengan 40 HP, reward `lost 1`; **219 body dari 7 pintu + Breaker + Individual, 0 di dalam rumah / di atas prop** (regresi bug spawn). Balance harness: idle kini gagal **Night 1** (dulu Night 2 — guard idle jatuh di pintu gelap), builder tetap menang Night 3 (Flare ×5, Lv3, Oil 39.8). Sebelumnya: Gelombang 66/78/90 (tanpa clamp), HP 48→54→60, Breaker 0/1/2. Cahaya: damage 15.0 vs 10.0, jalan breached 60.1 vs 90.9 px/dtk, cakaran lit ×0.5 (melemah, tidak diblokir). Pintu tertutup memblok di 5 titik; damage pintu lit 10 vs dark 20; breach → Perapian dalam 17.6 dtk, mencakar 3 Oil → `failed (THE FIRE WENT OUT)`; Breaker frontDoor → cellarDoor → perapian; gerak 4 arah; auto-shot (LOS stub & nyata); Flare 500→442. **Baru (regresi pass ini):** gelombang 3 (30 body) di postern: 30 menekan, pintu 72 HP jebol < 10 dtk, rank depan index 0; rank maju setelah barisan depan mati (83 → 78 px dari pintu); Hunter menembak lewat celah pintu tertutup (LOS biasa terblok; body 400 → 244 HP; pintu tetap tertutup); 2 guard berjaga di frontDoor, 18 tembakan, 3 kill dengan tembakan Hunter dimatikan; bolt guard tidak melukai Hunter (100 → 100); pause membekukan cooldown Flare (10 → 10, lalu 9.00 setelah 1 dtk) dan jam; tidak ada pause di panel akhir/popup reward, ada di siang; radius siang setelah fajar 980/980; reload menjaga `_inHouse` dan membangun ulang guard. Save/reload Day 2 tetap PASS. **Pass progres (29 baris PASS):** ekonomi kini survivor 3 *saat* Shelter selesai, pump Lv1 memompa 6.00 Oil semalam (dompet −2.40 setelah api membakar 8.40), fajar +14 Oil / +21 Wood (dulu +20 Oil karena extractor membayar saat fajar); level bangunan lewat satu builder (biaya Lv2 4/12, Lv3 6/16; build/Hunter/upgrade lain ditolak selama job berjalan; Lv3 = cap); pump Lv3 memompa 14.00 Oil semalam dan tidak ada pembelian di malam hari; Shelter Lv1/2/3 = survivor 2 → 3 → 4 → 5 dan 5 guard; papan Sawmill Lv1/Lv2 = HP maks pintu luar 130 → 143 → 156 (dst., penuh di siang hari); Hunter Lv2 = bolt 32 lewat `playerAttackHit`, HP 120/120 setelah latihan; save/reload menjaga level bangunan + Hunter, save lama → Lv1, reload tengah malam menjaga HP 60/120. **Balance harness:** idle gagal Night 2 (api padam); builder aktif menang Night 3 (Flare ×5, Lv3; sebelumnya ×6 — Shelter Day 3 kini langsung menambah guard). **Pass menara (36 baris PASS, exit 0; `qa-evidence/survival-towers/harness-survival.txt`):** menara dibangun lewat satu builder di hall (bayar 4/16) dan berdiri di (212, 483), 187 px dari frontDoor (conservatory tanpa pintu luar: dekat tengah ruangan); siang 0 tembakan, malam menembak lewat celah pintu tertutup dengan tembakan Hunter dan guard dimatikan (2 tembakan, body 999 → 967 = 2×16, bolt pierce 1 / jatuh di 640); satu bolt menembus 2 body sebaris (983/983) dan tidak mengenai body ke-3 (999); body dalam jangkauan di balik dinding (ruang makan, tanpa LOS) tidak ditembak (3 → 3 tembakan); Lv2 22/580, Lv3 30/640 (biaya 6/18, 8/22), bolt Lv3 mendarat 30; save/reload menjaga menara Lv3 di titik yang sama; **regresi baru:** bolt Hunter dan guard tetap range 0 / pierce 0. | Bot deterministik, bukan pemain manusia. Durasi malam uji 60 dtk. Bagian bot legacy di harness kini berakhir `death` karena urutan ID/RNG global ikut bergeser oleh probe Survival baru; dengan battery Survival dilewati, output bot legacy **identik byte-per-byte** dengan commit `b648f64` (dawn 300 dtk) — logika legacy tidak berubah. |
| `node tools/survival-balance.mjs --seeds=3 --duration=72 --bots=…,hunter-builder,tower-builder [--economy] [--no-rescue] [--no-guard-damage]` | Pengukuran, bukan gate. **Pass guard** (kode final; `qa-evidence/survival-guards/balance.txt`, `balance-no-rescue.txt`, `balance-old-guard-rule.txt`, `balance-baseline-8c0d58a.txt`; tabel lengkap di bagian "Guard bisa jatuh"): builder / fire-builder / tower-builder 3/3, **hunter-builder 3/3** (baseline 1/3 — efek perbaikan spawn, terbukti dengan `--no-guard-damage`), idle / passive / active 0/3, flare 0/3 (kini gagal Night 1); guard jatuh terutama di bot pasif (idle 6 jatuh / 2 hilang, flare 6 / 6), bot builder 0–2 jatuh dan 0 hilang per 3 run; bot `active` yang menolong kehilangan 3 guard vs 6 tanpa menolong. Metrik `br` diperbaiki: bot engaged mengalami 2–5 breach per malam (dulu tercetak 0). **Pass menara** (`qa-evidence/survival-towers/balance.txt`): `tower-builder` baru **3/3** (3 menara Lv1 + Perapian Lv3; menara menembak 59–60× di Night 2, 77–94× di Night 3; Night 3 puncak 61 musuh hidup, 0 mencapai api, HP 100/100); bot lain identik dengan baseline `4423076` (dicek dengan worktree baseline untuk `hunter-builder`). Pass progres (`qa-evidence/survival-progression/balance.txt`): idle 0/3 (gagal Night 1 ±64 dtk); passive-builder 0/3 (Night 1); flare-only 0/3 (gagal Night 2); active tanpa build 0/3 (gagal Night 3 ±62 dtk); **fire-builder (hanya Perapian) 3/3**; builder 3/3 dengan rencana baru (Day 2: Perapian Lv2, pump, gate, Sawmill; Day 3: Perapian Lv3, pump Lv2, Shelter; Hunter Lv2 tertolak cadangan Oil 32 → 18 < 19); Night 3: 7–8 musuh mencapai api, Oil tercakar 0, HP 100/100. **hunter-builder baru 1/3:** Hunter Lv3 + Perapian Lv2 → api padam di 70.9–71.2 dtk dari 72 (Oil masuk malam = 19, cakaran 10); seed yang tidak mampu Hunter Lv3 membeli Perapian Lv3 dan menang. Artinya investasi tempur saja tidak menyelamatkan api. Gap-pass sebelumnya: semua hasil menang/kalah sama untuk bot lama. | Bot sempurna/deterministik; seed hanya mengubah jitter spawn. Builder memeluk api masih tanpa kehilangan HP — perlu playtest manusia. |
| `node tools/survival-devqa.mjs` | **16/16 PASS** (pass guard, kode final, `qa-evidence/survival-guards/devqa.json`): cek baru — pion guard yang jatuh rebah (rotasi −1.571 rad) di ring merah `ff4a3d` + x-ray merah, HUD `1/2`; Hunter di sampingnya → bangun dengan 20 HP, pion tegak lagi di ring biru `5ab8ff`. Cek pooling kini menaruh Hunter di belakang frontDoor (49 tembakan → 3 objek bolt): setelah perbaikan spawn, Hunter di posisi lama menembak 0 kali dalam 20 dtk pertama (12 tembakan guard saja) dan cek lama gagal — angka > 20 dulu tercapai karena body muncul di basement. Satu run ulang sempat gagal di langkah reload (navigation timeout 30 dtk, flaky); run berikutnya 16/16. Sebelumnya **15/15 PASS** (pass menara, kode final, `qa-evidence/survival-towers/devqa.json`): 13 cek lama tetap PASS, plus **2 cek menara baru** — model menara di titiknya (212, 483) dan ring jangkauan merah r 520 saat dipilih di siang hari; malam dengan 21 body di frontDoor: 13 tembakan menara dalam 15 dtk, ballista menghadap bidikannya (selisih 0 rad), 1 objek bolt menara di scene (pool), ring tersembunyi di malam hari. Run pass progres: **13/13 PASS** (301 dtk, `qa-evidence/survival-progression/devqa.json`): jam malam menunggu rumah 3D (0.08 dtk saat dunia tampil); stick mulai di kiri (94 px) dan kanan (72 px), pita HUD diabaikan; satu tombol Flare (r 40, hit 44), tap di tepi gambar menembak; pause 2 dtk → cooldown tetap 10; tab tersembunyi → pause; context loss → malam beku (0 dtk), restore lanjut; 2 pion guard 3D = 2 survivor; 20 dtk malam dengan render tiap 0.25 dtk: 24 tembakan → 4 objek bolt di scene (pool dipakai ulang); panel akhir tanpa pause; zoom malam portrait 0.466 = landscape 0.466; reload tengah malam 23.08 → 23.16 dtk, musuh 35 → 35; 0 page error / console error / request gagal. | Chromium headless + software WebGL dengan touch emulasi, bukan perangkat fisik. Satu run ±6 menit. |
| `node tools/envqa.mjs --mode=3d-smoke` | **PASS**, exit 0, 40 assertion, page errors 0. **Pass guard (kode final):** Swarm 0/21/40 pada 0.2/15/30 dtk (dulu 0/21/36; dugaan: body yang dulu muncul di basement dan ditembak di dalam kini masih antre di luar pintu — tidak diverifikasi terpisah), 14 GLB + 26 silhouette, hanya `PAUSE`, luma Night 1 **79.6/255, 7.4% near-black**, radius 980 → 1560; capture `qa-evidence/survival-ftue-*.png` ikut diperbarui. Sebelumnya (diulang di kode final pass menara: Swarm 0/21/36 pada 0.2/15/30 dtk, 14 GLB + 22 silhouette, hanya `PAUSE`, luma Night 1 79.3/255 dengan 7.8% near-black, radius 980 → 1560; capture `qa-evidence/survival-ftue-*.png` ikut diperbarui). Run pass progres (274 dtk): FTUE: Swarm 0/21/35 pada 0.2/15/30 dtk, 14 GLB + 21 silhouette, tap target malam hanya `PAUSE`; luma playfield Night 1 **77.1/255, 10.2% near-black** dengan tier kualitas di-pin (run tanpa pin di mesin yang sama: 63.1/11.5% — selisihnya resolusi shadow dari ladder adaptif, bukan perubahan scene); radius 980 → 1560 lewat tombol `UPGRADE`. | Chromium headless/software WebGL. |
| `node tools/survivalshots.mjs --tag=gdp` dan `--tag=gdl --landscape` (pass guard) | 21 shot per orientasi (18 lama + 3 guard), 0 page error, kualitas di-pin ke 3. Portrait: malam 76.1/77.7/81.0 (near-black 7.4/9.3/8.2%), `day-panel` 124.5, `night-door` 69.9; landscape: malam 73.1/72.2/70.4. Guard (Night 1, frontDoor dibuat jebol lewat cakaran nyata): `guard-down` 64.6 portrait / 68.1 landscape — satu guard jatuh dengan Hunter di sampingnya (ring hijau 0.92/1.5 dtk), satu jatuh sendirian (ring merah, sisa 10.8 dtk), satu terluka 16/40 (bar kuning), HUD `1/3`; `guard-lost` — yang pertama bangun (`+20`), yang sendirian habis waktunya: banner `GUARD LOST`, survivor 2; `guard-reward` 116.6 / 114.7 — popup fajar dengan baris guard `-1` merah. Pada `guard-lost` antrean banner dikosongkan agar banner terlihat (staging capture). Bukti `qa-evidence/survival-guards/`. | Screenshot headless, bukan review perangkat. Scene guard di-stage (posisi/HP diatur skrip), bukan dari permainan bebas. |
| `node tools/survivalshots.mjs --tag=tow1` dan `--tag=tow1l --landscape`; `--towers-only --tag=tow2` / `tow2l` | Pass menara: 18 shot per orientasi (16 lama + 2 menara), 0 page error, kualitas di-pin ke 3. Portrait: malam 73.9/78.1/81.6 (near-black 9.6/9.2/7.9%), `day-panel` 124.5; landscape: malam 73.2/72.4/68.5. Menara lewat UI nyata (slot hall → kartu `TOWER` → selesai → bubble): `tower-day` 117.7 portrait / 110.1 landscape, ring terlihat, `UPGRADE tower LV2`; `tower-night` (Night 2, Lv2 lewat tombol UI, 21 dtk): 3 tembakan menara, bolt sedang terbang ke Breaker di frontDoor, luma 62.5–66.2 (near-black ±16%, setara `night-door`). Dua shot menara diulang dengan `--towers-only` setelah posisi parkir Hunter diubah (hanya tooling; kode game sama). Bukti `qa-evidence/survival-towers/`. | Screenshot headless, bukan review perangkat. |
| `node tools/survivalshots.mjs --tag=prog4` dan `--tag=prog4-land --landscape` | 16 shot per orientasi (10 lama + 6 progres), 0 page error, tier kualitas di-pin ke 3 (tercatat per shot). Portrait: malam 74.7–79.5 (near-black 9–10%) pada 0/20/40 dtk, `day-panel` 123.3, `prog-hunter` 127.1, `prog-levels` 117.2, `prog-night` 81.1. Landscape: malam 68.7–73.1, siang 105–143. State progres: reward Day 3 `pumped 6`, upgrade pump berjalan 3.5/6 dtk tanpa panah di bubble-nya, Hunter Lv2 120/120 di malam, pump Lv3 + Sawmill Lv2 + panji. Bukti `qa-evidence/survival-progression/`. | Luma pass ini (di-pin) tidak sebanding langsung dengan angka gap-pass yang tidak di-pin. Screenshot headless, bukan review perangkat. |
| `node tools/layoutqa.mjs` | **PASS**, exit 0 (diulang di kode final pass guard; 0 browser error, tidak ada prop di dalam dinding). | Overlap staircase–stairRail ±150×20 px masih tercatat (audit, bukan gate). |
| `node tools/glbtest.mjs` | **PASS**, exit 0 (diulang di kode final pass guard). | Validasi asset/kode statis. |
| `node --check` seluruh `src/**/*.js` & `tools/*.mjs`; `git diff --check` | **PASS** (70 file, pass guard). | Sintaks/diff saja. |
| `npm audit --prefix tools` | **PASS**, 0 vulnerability (diulang di pass guard). | — |
| `node tools/bundle.mjs check` | **FAIL** (tidak berubah, diulang di pass guard): fingerprint SHA-256 Digital Asset Links masih placeholder; WARN token origin-trial Digital Goods. | Butuh kredensial/konfigurasi release; IAP di luar scope. `manifest.webmanifest` masih `orientation: landscape`; UI Survival dirancang portrait-first dan sejak pass progres punya layout siang landscape (kolom kiri) — orientasi rilis tetap perlu keputusan produk. |

**Build:** repo tidak memiliki `package.json` root atau script `npm run build`. Dependensi QA dipasang dengan `npm ci --prefix tools`; pemeriksaan bundle di atas bukan build Android/AAB yang sukses. Jangan menyebut paket release selesai.

## Bukti visual

- `qa-evidence/survival-ftue-00s.png`, `-15s.png`, `-30s.png`, `survival-ftue-first-30s.json` (envqa; viewport 390×844 @2x; diperbarui 2026-10-15 pada pass progres, kualitas di-pin).
- `qa-evidence/survival-gap-pass/` (2026-10-15, diperkecil 50%): `before-night-20s.png` vs `after-night-20s.png` (kamera lebih lebar, api unggun + bar bahan bakar, satu tombol Flare, counter guard, karpet terang), `after-night-door.png` (bertahan di pintu: ring Hunter/guard menembus dinding, crowd di luar pintu), `before-day-panel.png` (2 slot) vs `after-day-panel.png` (4 slot, survivor terlihat di dekat api, chip FTUE di atas sheet), `after-day-select.png` (kartu Shelter = +1 guard), `after-night2.png` (Night 2: Flare cooldown 14, bar bahan bakar api, penanda pintu yang dikepung), `before-landscape-night.png` vs `after-landscape-night-40s.png` / `after-landscape-night-door.png`, metrik `after-metrics.json` / `after-landscape-metrics.json`, `devqa.json`, `balance-before.txt` / `balance-after.txt`.
- `qa-evidence/survival-progression/` (pass progres 2026-10-15, diperkecil 50%, kualitas di-pin): `day-panel.png` (bubble Hunter di samping Perapian, pointer tepi tidak bertumpuk), `prog-reward.png` (baris pompa `+6` di popup fajar), `prog-built.png` (sheet pump `Lv1 → Lv2`, `+6 → +10`), `prog-upgrading.png` (ring progres, panah disembunyikan, NIGHT terkunci), `prog-hunter.png` (sheet Hunter `26 → 32`, `100 → 120`), `prog-levels.png` (pump Lv3 MAX `+14`, panji emas, Shelter terlihat di bawah bubble), `prog-night.png` (Hunter Lv2 120/120 di malam). Landscape: `before-land-day-panel.png` (kode lama: bubble bertumpuk di balik chip hint) vs `land-day-panel.png`, `land-day-select.png` (kartu build di kolom kiri), `land-prog-hunter.png`, `land-prog-levels.png`. Data: `metrics.json`, `land-metrics.json`, `balance.txt` (dengan jejak `--economy`), `harness-survival.txt`, `devqa.json`.
- `qa-evidence/survival-towers/` (pass menara 2026-10-15, diperkecil 50%, kualitas di-pin): `day-select.png` (4 kartu build: pump/sawmill/shelter/**tower**), `tower-day.png` (sheet menara `16 → 22`, `520 → 580`, ring jangkauan merah), `tower-night.png` (Night 2: menara Lv2 berpanji biru menembak ke frontDoor), `prog-levels.png` (pump Lv3 kini di lantai kosong di samping meja makan — bandingkan `survival-progression/prog-levels.png` yang berdiri di atas meja), landscape `land-day-select.png`, `land-tower-day.png` (ring terlihat penuh), `land-tower-night.png`. Data: `metrics.json` / `land-metrics.json` (run penuh 18 shot), `towers-metrics.json` / `land-towers-metrics.json` (run `--towers-only`), `balance.txt`, `harness-survival.txt`, `devqa.json`.
- `qa-evidence/survival-guards/` (pass guard 2026-10-15, diperkecil 50%, kualitas di-pin): `guard-down.png` (guard jatuh + Hunter menolong = ring hijau, guard jatuh sendirian = ring merah, guard terluka = bar kuning, HUD `1/3`), `guard-lost.png` (banner `GUARD LOST`, `+20` untuk yang ditolong), `guard-reward.png` (baris guard `-1` di popup fajar), `night-door.png` (bertahan di pintu, tidak berubah), landscape `land-guard-down.png` / `land-guard-lost.png` / `land-guard-reward.png`. Data: `metrics.json` / `land-metrics.json` (21 shot per orientasi), `harness-survival.txt`, `devqa.json`, `balance.txt` (final), `balance-no-rescue.txt`, `balance-old-guard-rule.txt` (`--no-guard-damage`: hanya perbaikan spawn), `balance-baseline-8c0d58a.txt` (kode sebelum pass ini, tool baru), `balance-first-rule.txt` (versi pertama aturan, sebelum i-frame/waktu 20 dtk/buruan; metrik `br` lama), `spawn-audit.txt` (slot formasi yang jatuh di dalam ruangan sebelum vs sesudah perbaikan).
- `qa-evidence/survival-rebuild/` — before/after koreksi 2026-10-12 (gelap → terang, UI teks → ikon).
- `qa-evidence/survival-fixes/` (pass feedback 2026-10-16, 844 × 390, DPR 1, `tools/survival-fxshots.mjs`):
  - `fx-gate.png`, `fx-gate-b.png`: knight GLB berlivery biru di gerbang utara, bolt bercahaya, flash hit, angka damage.
  - `fx-mine.png`: koin "+1" dari mine.
  - `fx-dawn.png`: panel fajar dengan baris sawmill dan kill guard.
  - `fx-sawmill.png`: kayu "+7" dari sawmill saat COLLECT.
  - `fx-day.png`: NIGHT di kiri atas, pil status di samping panah upgrade, bar HP keep di bawah pil DAY.
  - `fx-barracks.png`: tenda biru, cincin rally, "+1" prajurit.
  - `fx-end.png`: panel akhir dengan kill per sumber.
- `qa-evidence/survival-k1/land-*.png` dan `survival-ftue-*.png` diperbarui di pass yang sama (benteng ringkas, aktor ×1,25, knight GLB).

Ini screenshot checkpoint, bukan rekaman, dan bukan review di perangkat fisik.

## Acceptance yang masih terbuka

1. **FTUE/readability:** dunia kini terang dan terbaca di screenshot headless (luma diassert di envqa), UI berbasis ikon, chip hint kontekstual ada. Sejak 2026-10-16 save baru dibuka dengan intro sinematik K1 (menara → horde di gerbang → Kapten + trek 3 malam; diassert devqa/harness, lihat "Bookend K1"). Belum: review di perangkat nyata, uji pemahaman pemain baru (tes 3 pertanyaan), rekaman 30 detik.
2. **Combat Survival manual:** bot menggerakkan stick virtual dan Flare melalui Input; devqa kini mengetes stick mengambang, hit tombol Flare, dan pause lewat touch emulasi. Walkthrough manusia (gerak, bertahan di pintu, Flare, mempertahankan Perapian, **menolong guard yang jatuh**) belum dilakukan; apakah badge/ring waktu guard terbaca saat ramai belum dinilai pemain.
3. **Light weakness → wilayah panji (K1, 2026-10-16):** aturan cahaya diganti user (konsep api ditolak). Kini musuh di ruangan wilayah panji menerima damage ×1,5, tanpa perlambatan, tanpa pelemahan cakaran, dan pintu tanpa diskon (diassert harness). Rasa/feel dan keterbacaan tint biru di perangkat belum dinilai.
4. **Balance/progression:** *(K1 2026-10-16: builder 3/3, hunter-builder 3/3, keep-builder 1/3, tower-builder 0/3, idle/flare/active/passive 0/3 — lihat bagian K1; catatan di bawah ini dari aturan api lama)* target bot terpenuhi (idle/flare/active-tanpa-build kalah; upgrade Perapian saja sudah cukup menang 3/3; builder 3/3). **Pass guard:** perbaikan bug spawn (body muncul di basement/gallery) membuat permainan builder *lebih mudah* — Night 3 builder kini 0–1 musuh mencapai api (dulu 7–8) dan `hunter-builder` naik dari 1/3 ke 3/3, sehingga kesimpulan trade-off Hunter Lv3 di bawah sebagian berasal dari bug itu. Guard yang bisa jatuh menambah risiko terutama untuk permainan pasif; bot builder hampir tidak pernah kehilangan guard. Kesulitan untuk pemain yang membangun masih rendah dan kini makin jelas perlu playtest manusia sebelum mengubah biaya/ancaman. Progres kini ada (level bangunan Lv1–3 + jalur Hunter Lv1–3, diassert harness) dan bot `hunter-builder` menunjukkan trade-off nyata (Hunter Lv3 dengan Perapian Lv2 kalah 2/3 karena api padam di detik ±71). Menara (pass menara) menambah strategi menang ketiga: `tower-builder` 3/3 dengan Night 3 paling bersih (puncak 61 musuh, 0 mencapai api) — kuat, tetapi tidak mengubah peta menang/kalah. Masih terbuka: bot builder yang memeluk api tetap tidak kehilangan HP (100/100) dan tidak tercakar di Night 3; cadangan Oil 19 membuat pilihan Day 3 sangat ketat (Perapian Lv3 18 + Hunter Lv2 14 = 32 kurang 1 Oil) — biaya sengaja tidak diubah tanpa playtest manusia; rasa progres (apakah upgrade terasa) belum dinilai di perangkat.
5. **Visual pass:** sweep 17 stop per ruang/wing, state low-health/blackout, dan overlap staircase–stairRail belum selesai. Pohon siang tampak agak pucat (palet dinaikkan untuk readability) — kandidat polish.
6. **Perangkat/performa:** hidden-tab pause, context-loss freeze/restore, reload tengah malam, dan framing landscape kini diassert di Chromium headless (devqa). Belum: frame time 66–90 musuh + guard/bolt di perangkat low-end, DPR nyata. **Orientasi diputuskan user (2026-10-16): landscape only.** Layout siang landscape kini tanpa kolom kiri (K1, P1: tombol kontekstual di zona jempol). Frame time menara + lingkaran + crowd di perangkat belum diukur.
7. **Release bundle:** fingerprint signing SHA-256, token origin-trial, validasi Bubblewrap/AAB, uji TWA/Play tetap menunggu konfigurasi release. IAP tidak diubah.
8. **Replay / "mau main lagi?" (2026-10-16):** riset review + playtest bot ada di `docs/UX-REPLAY-RESEARCH.md`. Scorecard 16/30: kuat di sesi pendek, retry, dan tanpa energi/iklan; lemah di alasan untuk kembali setelah menang. Bug panel menang (kill hanya malam 3) sudah diperbaiki di pass feedback 2026-10-16 (`runStats`); rasa panelnya belum diuji pemain. Riset v2 menambah lensa review bintang 5 (checklist 11/16), persona, peta perjalanan, dan protokol playtest. Riset v3 menambah data dan ulasan pemain Indonesia, analisis loop 3 lapis + SDT, serta uji HP kelas bawah. Belum: R5–R17 (kecuali R18a) dan R20; R1–R4 dan R19 terbangun di pass "Momen akhir run" (lihat item 10). Juga belum: playtest manusia sesuai protokol §6.1–§6.4 (PLAY AGAIN tanpa diminta, skor 1–5, salah ketuk NIGHT), uji HP RAM 3 GB dan diary 7 hari (§6.6).
9. **Pass feedback 2026-10-16 (skala, pasukan GLB, efek, bangunan, UI):** terimplementasi dan lolos gate otomatis (lihat bagian paling atas). Belum: penilaian manusia apakah benteng sudah terasa pas dengan ukuran aktor, apakah efek tembakan/damage sudah "terasa", dan apakah kerja tiap bangunan terbaca tanpa dijelaskan. Juga belum: frame time di HP kelas bawah dengan knight GLB, dan penyetelan ulang balance di benteng ringkas (tower-builder 2/3). *(Diperbarui: dengan 10 seed, tower-builder 8/10; tidak ada bukti regresi, lihat "Momen akhir run".)*
10. **Momen akhir run 2026-10-16 (R1–R4, R19):** bintang 1–3, rekor + NEW BEST!, panel kalah "Ns TO DAWN" + satu tip dari penyebab nyata, dan MVP bangunan terimplementasi dan lolos gate otomatis (lihat bagian paling atas). Bot memenuhi ukuran berhasil riset: builder ★★★, tower-builder yang menang tipis ★, dan tip sesuai penyebab untuk idle / active / tower-builder. Belum: penilaian manusia apakah bintang terasa adil, tip dipahami dan membantu, dan NEW BEST! memancing PLAY AGAIN tanpa diminta (protokol §6.1 riset). Ambang ★★ belum pernah muncul di run bot.
11. **Pass visual besar 2026-10-17 ("tidak ada perubahan"):** terimplementasi dan lolos gate otomatis (lihat "Pass visual besar"). Belum: konfirmasi dari user bahwa layar menampilkan "BUILD 8" dan kelima poin kini terlihat, penilaian rasa (ukuran benteng vs aktor, horde GLB, efek, kerja bangunan, penanda gerbang), dan frame time horde instanced + knight di HP kelas bawah.
12. **Pass perbaikan BUILD 9 2026-10-17 (kamera, plot rapi, aset bangunan, kartu, trailer):** terimplementasi dan lolos gate otomatis (lihat "Pass perbaikan BUILD 9"). Belum: konfirmasi dari user bahwa layar menampilkan "BUILD 9"; penilaian di HP nyata atas jarak kamera dan rasa geser/pinch, kerapian denah, kecocokan aset KayKit dengan gaya benteng, ukuran dock, dan apakah intro tiap run mengganggu; frame time model kit di HP kelas bawah.
13. **Pass BUILD 10 2026-10-17 (aturan gerbang):** gerbang tertutup menahan tembakan, gerbang terbuka hanya untuk kapten, musuh mengejar di luar, istirahat di balik tembok, guard di menara gerbang, dan tembakan melengkung lewat tembok. Semuanya terimplementasi dan lolos gate otomatis (lihat "Pass BUILD 10"). Belum: konfirmasi user bahwa layar menampilkan "BUILD 10"; rasa keluar benteng dan ritme gerbang/istirahat di HP nyata; keterbacaan guard di puncak menara.
14. **ASSET_CHARACTER 2026-10-17/18:** 18 dari 18 gambar konsep sudah dibuat (6 karakter + 12 senjata; 7 senjata terakhir di commit `e374747`). Kapten gelap di game kini dicerahkan lewat shader dengan palet opsi 1 (BUILD 13, V8). Modelnya tidak diganti. Sejak BUILD 14 socket senjata di tangan guard berfungsi dan upgrade senjata pasukan ada di game (rak senjata, GUARD BOWS Lv1–3, mengikuti gambar `guard-crossbow-lv1..3` dengan mesh KayKit yang diwarnai ulang). Masih terbuka: konversi gambar → GLB dan penilaian manusia atas kecocokan gambar dengan gaya game.
15. **Pass BUILD 11 2026-10-17 (bug kapten + bailey padat):** dorongan tanpa input dihapus, gerbang hanya terbuka untuk arah stick, warna per bangunan, plot terkunci dan tiang hantu disembunyikan, label nama di pad, props dikurangi. Semuanya lolos gate otomatis (lihat "Pass BUILD 11"). Belum: konfirmasi user bahwa bug tidak muncul lagi di perangkatnya dan layar menampilkan "BUILD 11"; penilaian manusia atas kepadatan dan keterbacaan bangunan.
16. **Pass BUILD 12 2026-10-18 (Opsi B + kamera dinamis):** bailey ×1,6 dengan distrik per fungsi, plaza Keep, wilayah panji berupa radius, dekor distrik, dan kamera zoom 0,42–1,6× (pinch di mana saja, tombol +/−, roda, keyboard, geser + lemparan). Semuanya lolos gate otomatis (lihat "Pass BUILD 12"). Belum: konfirmasi user bahwa layar menampilkan "BUILD 12"; penilaian manusia atas kelapangan, keterbacaan distrik, jarak jalan, dan rasa kamera di HP nyata; frame time zoom terjauh di HP kelas bawah; konfirmasi keputusan §9 yang diambil sendiri.
17. **Pass BUILD 13 2026-10-18 (V8, V4, V9, V10):** kapten terang, label hanya saat dekat, angka damage kecil yang digabung, dan gerbang malam ini terlihat di siang hari. Semuanya lolos gate otomatis (lihat "Pass BUILD 13"). Belum: konfirmasi user bahwa layar menampilkan "BUILD 13"; penilaian manusia apakah kapten kini terbaca tanpa terlihat seperti hantu atau hologram, apakah label dekat cukup untuk mengenali bangunan, apakah angka kecil masih terasa kuat, dan apakah pemain bisa menyebut gerbang malam ini sebelum menekan NIGHT (uji riset §8).
18. **Pass BUILD 14 2026-10-18 (senjata pasukan bisa di-upgrade):** rak senjata, kartu GUARD BOWS, tiga level busur guard yang terlihat di tangan setiap guard dan di warna baut, perbaikan socket tangan, serta tiga catatan BUILD 13. Semuanya lolos gate otomatis (lihat "Pass BUILD 14"). Belum: konfirmasi user bahwa layar menampilkan "BUILD 14"; penilaian manusia apakah busur terbaca di zoom normal, apakah rak ditemukan tanpa penjelasan, dan apakah biaya/kekuatan terasa pas.
19. **Pass BUILD 15 2026-10-18 (V6 + V7: pertarungan malam terlihat utuh):** kamera malam condong ke gerombolan, kill zone + glacis (19 pohon jadi tunggul), menara sisi selatan/timur jadi bastion pendek, dan siluet biru kapten saat tertutup. Semuanya lolos gate otomatis; balance identik dengan BUILD 14 (lihat "Pass BUILD 15"). Belum: konfirmasi user bahwa layar menampilkan "BUILD 15"; penilaian manusia apakah geseran kamera membantu dan tidak membingungkan, apakah siluet terbaca sebagai kapten, apakah gerbang utama yang lebih pendek masih terbaca sebagai gerbang utama, dan uji fokus malam riset §8 (musuh, kapten, dan gerbang yang diserang langsung terlihat di screenshot malam).
20. **Pass BUILD 16 2026-10-18 (R5 + R6: tempo malam):** NIGHT CLEARED dengan fajar 2 dtk kemudian (cahaya menghangat), bonus 1 emas per detik yang dihemat, bayaran sisa shift mine; gerombolan pecah (sisa ≤ 3 yang tidak bertarung lari, yang bertarung ditandai LAST N!); gelombang malam 2–3 dilepas di 1,5 %, setiap gelombang/Breaker dipanggil dengan nama gerbang dan terompet horde; panah tepi malam di HP landscape di bingkai area main. Semuanya lolos gate otomatis; malam 1 di balance identik dengan BUILD 15 (lihat "Pass BUILD 16"). Belum: konfirmasi user bahwa layar menampilkan "BUILD 16"; target R6 "target pertama kapten ≤ 5 dtk" (jalan kaki ke gerbang tetap 6–8 dtk); penilaian manusia apakah gerombolan yang lari terasa adil, apakah terompet terdengar jelas, dan apakah fajar cepat terasa memuaskan.

## Aturan laporan

- Laporkan implementasi dan acceptance terpisah. PASS di atas hanya PASS untuk assertion perintah terkait.
- Jangan menyebut rebuild/M1 “selesai” atau “siap rilis” sampai acceptance terbuka diverifikasi dan packaging punya bukti sendiri.
- Pertahankan `?legacy=1` sebagai akses QA/komparasi. Hapus legacy route atau sistem lama hanya dengan keputusan scope eksplisit.
- Pertahankan pipeline WebGL mansion/lampu serta provenance asset; jangan re-export atau mengubah byte sumber berlisensi tanpa izin.
- **Commit + push setiap task (aturan user, 2026-10-17):** setiap task fix atau perubahan wajib di-commit dan di-push ke branch kerja `arena/4e10f2ff-scary-night` di akhir task, supaya tersimpan. Push diverifikasi: `git ls-remote origin arena/4e10f2ff-scary-night` harus sama dengan `git rev-parse HEAD`. Hash commit disebut di laporan.
- **Sinkron dengan remote sebelum commit:** kalau sandbox di-restore, HEAD lokal bisa mundur ke commit lama (mis. `ca205b0`) sementara file kerja tetap, sehingga semua file tampak "belum di-commit". Sinkronkan dulu dengan `git fetch origin arena/4e10f2ff-scary-night:refs/remotes/origin/arena/4e10f2ff-scary-night`, lalu `git reset origin/arena/4e10f2ff-scary-night` (mixed, **bukan** `--hard`). Setelah itu baru commit perubahan yang benar-benar baru. Jangan force-push.
