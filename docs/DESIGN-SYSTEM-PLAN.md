# Brainstorm & Design System Plan — DUSKHOLD Survival (landscape)

**Tanggal:** 2026-10-15 (Asia/Makassar)
**Status:** DRAFT untuk diskusi. **Belum ada perubahan kode game.** Ini sesuai permintaan user: brainstorming dan design system plan dulu, koding setelah disetujui.
**Keputusan yang sudah pasti:** game **landscape only**. `manifest.webmanifest` sudah `orientation: landscape`; layout portrait tidak lagi menjadi target desain.
**Hubungan dengan roadmap:**
- `docs/REBUILD-ROADMAP.md` tetap mencatat status implementasi & QA.
- Dokumen ini adalah arah desain untuk pass berikutnya.
- Aturan laporan di roadmap tetap berlaku.

---

## 0. Ringkasan

1. Masalah intinya bukan satu kartu atau satu tombol: **game belum bercerita.**
   - Pemain tidak melihat siapa dirinya, apa yang ia lindungi, dan kenapa api penting.
   - Sekarang semua itu disampaikan lewat teks (`PROTECT THE FIRE!`, `GUARD THE PERAPIAN`) dan angka Oil.
2. **Api saja tidak cukup sebagai alasan emosional.** Usulannya: pemain melindungi **orang-orang**, dan api adalah nyawa sekaligus perisai mereka.
   - Konsep yang direkomendasikan: **"Penjaga Api"**. Jaga api tetap menyala 3 malam; api juga menjadi suar bagi konvoi penyelamat yang datang di fajar ketiga.
   - Aturan game sekarang tidak perlu berubah. Yang berubah: framing, penempatan api, dan visual.
3. **Api menjadi jantung layar**: besar, di tengah rumah, dikelilingi orang.
   - Lima status api (kuat → melemah → diserang → sekarat → padam) terlihat pada api itu sendiri, pada cahaya, dan pada reaksi orang. HUD hanya pelengkap.
4. **Build/upgrade punya satu alur**: Pilih → Pratinjau → Bangun → Rayakan → Hasil terlihat malam ini → Kredit saat fajar.
   - "+" hijau diganti **tapak bangunan**.
   - Satu bentuk = satu arti; satu bangunan = satu tugas yang terlihat di dunia.
5. **Layout landscape dirancang ulang.**
   - Tanpa seleksi, layar siang tidak punya panel sama sekali.
   - Dengan seleksi, muncul **strip bawah ≤ 104 px (≤ 28% tinggi)** yang tidak menutupi objek terpilih.
   - Bandingkan dengan sekarang: kolom kiri selalu terbuka, ±45% lebar × ±66% tinggi layar.
6. **Tembakan harus terasa kuat.**
   - Target 1–2 hit per zombie swarm, ditambah lapisan *juice*: hit flash, knockback, angka besar, kill pop, muzzle flash, hit-stop pendek untuk event besar, dan bass.
   - Upgrade Hunter menambah efek yang **terlihat**: bolt tembus, tembakan ganda.

---

## 1. Diagnosis — kondisi sekarang

Bukti:
- `qa-evidence/survival-progression/land-day-panel.png`
- `qa-evidence/survival-towers/land-day-select.png`
- `qa-evidence/survival-towers/land-tower-day.png`
- `qa-evidence/survival-gap-pass/after-landscape-night-40s.png`
- kode saat ini: `src/game/survival.js`, `src/ui/survival.js`, `src/core/config.js`

| # | Keluhan user | Yang terlihat sekarang | Akar masalah |
|---|---|---|---|
| 1 | Siapa pemain, apa tujuannya, apa yang dilindungi — tidak terjawab | Malam dibuka langsung dengan gelombang dan banner. Survivor hanya pion biru kecil di pintu, dan Hunter figur generik. Tujuan 3 malam hanya terbaca dari teks `NIGHT 1`. | Tidak ada momen pembuka, tidak ada "wajah" yang dilindungi, tidak ada penanda tujuan akhir. |
| 2 | Api kurang *feel* | Perapian berupa prop 220×70 yang menempel di dinding atas library (±(1296, 36)), bukan di tengah rumah. Di siang hari apinya kecil di balik bubble `Lv1`. Di malam landscape, banner `PROTECT THE FIRE!` justru menutupi api. Batas cahaya hanya garis kuning tipis, dan nyawa api hanya angka Oil + bar kecil. | Api diperlakukan sebagai *meter resource*, bukan tempat atau karakter. |
| 3 | "+" hijau tidak dimengerti | Ada 5–6 bubble "+" yang identik, dengan bentuk dan warna yang sekeluarga dengan panah hijau upgrade. Chip-nya berbunyi `TAP + TO BUILD IN LIT ROOMS`, padahal "lit rooms" tidak terlihat di siang hari. | Penanda tidak memberi tahu *apa* yang bisa dibangun dan *kenapa di situ*. |
| 4 | Kartu landscape terlalu besar | `daySideColumn()` membuat kolom kiri selebar `min(380 px, 45% lebar)`, dan kolom ini **selalu terbuka** di siang hari (default: panel Perapian). Isinya 4 kartu ±85 px + header + baris `READY`/`NIGHT`, sehingga menutup ±45% lebar × ±66% tinggi layar 844×390. | Layout portrait dipindah ke samping, bukan dirancang untuk landscape. |
| 5 | Layout upgrade membingungkan | Build dan upgrade memakai panel yang sama. `READY` tampak seperti tombol padahal hanya status builder. `NIGHT 2` sama menonjolnya dengan aksi build. Bubble di tepi kanan menumpuk jadi pointer. Caption teks (`FIRE RADIUS`, `HEARTH BURN`, `BOLT DAMAGE`) bertentangan dengan aturan ikon-dulu. | Tidak ada hierarki antara aksi utama, info, dan status. |
| 6 | Fungsi build/upgrade tidak terasa | Satuan angka berbeda-beda tanpa penanda: `+6` oil (dipompa selama malam), `+7` wood (saat fajar), `+1` survivor (langsung), `16` damage. Dunia hampir tidak berubah setelah membangun, malam tidak menunjukkan bangunan mana yang bekerja, dan popup fajar tidak mengkredit bangunan. | Efek tidak divisualisasikan sebelum dibeli, saat dibangun, maupun sesudahnya. |
| 7 | Damage tembakan kurang kuat | Hunter 26/32/40 vs swarm 48/54/60 HP. Lv1 butuh 2/3/3 hit di gelap (Night 1/2/3); one-shot hanya terjadi di cahaya pada Lv2 Night 1 atau Lv3. Angka damage 16 px putih (20 px emas di cahaya). Tidak ada shake atau hit-stop saat hit/kill; kill hanya bersuara. | TTK tinggi + umpan balik tipis. |
| 8 | Dunia belum production | Koridor batu gelap dengan prop jarang. VFX api hanya point light + percikan saat diserang. Tidak ada kehidupan (orang, asap, abu). Malam berupa tint biru: terbaca, tapi tanpa kontras hangat/dingin. | Belum ada *art direction* dan *color script* yang mengikat. |

Penamaan juga belum konsisten: `PERAPIAN` dipakai di label/hint, sementara banner memakai `THE FIRE`. Pilihan satu nama masuk ke §13.

---

## 2. Pelajaran dari game building/defense sejenis

| Game | Yang mereka lakukan | Yang kita ambil |
|---|---|---|
| Duck Survival ("Build by Day, Defend by Night", referensi user) | Siang: upgrade base, rekrut, pasang menara. Malam: ±100 zombie + boss sampai fajar. Dari screenshot toko: malam terang dan saturasi tinggi; api unggun di tengah menerangi tanah oranye; pill resource di kanan atas; jam malam di tengah atas; angka damage besar; label bangunan dengan panah upgrade. | Malam terang, api di tengah, angka besar, HUD minimal. |
| Thronefall | Bangun/upgrade dengan mengisi lingkaran koin bertitik di atas bangunan: tahan untuk membayar koin satu per satu, lepas maka koin kembali. Model seperti mainan, palet terbatas per level dengan kontras tinggi, kamera isometrik tinggi ("diorama perang"). Istana di tengah harus dilindungi, dan rumah yang selamat membayar emas. Upgrade menara bercabang. | Tapak/plot yang jelas, gaya diorama mainan, palet terbatas, pusat yang dilindungi. |
| Kingdom Two Crowns | Pusat kota dimulai dari api unggun yang belum menyala, lalu di-upgrade menjadi keep. Titik bangun sudah ditentukan: jatuhkan koin, lalu pekerja membangun. Mahkota adalah nyawa; jika diambil musuh, run berakhir. | Api sebagai pusat yang tumbuh; titik bangun tetap; pekerja yang terlihat membangun. |
| Whiteout Survival | Furnace adalah jantung kota dan awalnya berupa api unggun besar. Furnace menjaga survivor tetap hangat; tanpanya mereka sakit atau mati. Upgrade menambah *heat range*, dan ada tampilan heat range untuk melihat bangunan yang kedinginan. | Ikatan api ↔ orang; upgrade = radius; overlay radius. |
| Frostpunk | Heat zone memancar melingkar dari generator, dan overlay temperatur memberi tint gradasi. Memilih generator menampilkan zonanya. Saat menaruh bangunan, outline-nya menyala bila masuk zona. | Wilayah cahaya sebagai gradasi lantai; pratinjau "masuk cahaya atau tidak" saat memilih tapak. |
| Clash of Clans | Tap bangunan memunculkan ikon kontekstual (Info, Upgrade, Finish Now), bukan panel besar. | Aksi kontekstual yang ringkas; panel hanya saat dibutuhkan. |

Pola umum game build mobile yang juga kita pakai:
- badge level di atas bangunan; panah upgrade hanya muncul jika upgrade terjangkau;
- perancah + bar waktu saat membangun;
- model "pop" + kilau saat bangunan selesai;
- ikon resource terbang ke counter HUD saat dikumpulkan;
- aksi utama di kanan bawah.

---

## 3. Tiga pertanyaan pemain — opsi konsep

Prinsip: aturan yang sudah ada **dipertahankan**:
- api padam = kalah; Hunter mati = kalah;
- survivor menjaga pintu;
- cahaya memperlambat dan melemahkan musuh;
- membangun hanya di ruangan terang;
- satu run = 3 malam.

Yang dicari adalah cerita yang membuat aturan itu terasa wajar dan terlihat.

### Opsi A — "Penjaga Api" (rekomendasi)

- **Siapa saya?** Penjaga Api: pemburu ber-crossbow yang membawa **lentera berisi bara dari perapian**.
  - Siluetnya hangat (syal/jubah oranye, lentera di pinggang), jadi secara visual ia "milik" api.
  - Lentera dan syal dibuat sebagai mesh terpisah yang ditempel ke tulang; byte GLB berlisensi tidak diubah.
- **Apa yang saya lindungi?** **Orang-orang**: keluarga penyintas (anak, orang tua) yang duduk merapat di sekeliling api.
  - Api adalah kehangatan dan perisai mereka. Selama api menyala, kegelapan tidak bisa menelan mereka.
  - Sebagian penyintas mengangkat crossbow dan menjaga pintu — itulah guard yang sudah ada.
- **Apa tujuan saya?** **Jaga api tetap menyala selama 3 malam.**
  - Api juga **suar**: di fajar ketiga, konvoi penyelamat datang mengikuti cahayanya.
  - Chip pembuka: `KEEP THE FIRE ALIVE FOR 3 NIGHTS`.
- **Kenapa cocok:** semua aturan sekarang langsung punya arti (lihat tabel di bawah). Scope-nya visual + framing, bukan sistem baru.

### Opsi B — "Pewaris Duskhold"

- Kamu pewaris rumah tua yang merebut kembali rumahnya dari kegelapan.
  - Yang dilindungi: keluarga + rumah.
  - Tujuan: memulihkan dan menerangi rumah, ruang demi ruang, sampai kutukan patah di malam ketiga.
- Kuat untuk *build fantasy* (ruangan rusak → pulih → terang). Lemah di urgensi, karena tidak ada penyelamat atau garis akhir yang konkret.

### Opsi C — "Segel Api"

- Api adalah segel kuno yang menahan sesuatu di bawah rumah.
  - Yang dilindungi: penjaga segel.
  - Tujuan: menuntaskan ritual di malam ketiga.
- Misterinya kuat, tetapi butuh lore/teks lebih banyak dan menjauh dari referensi "build by day, defend by night".

**Rekomendasi:** Opsi A, ditambah bahasa visual "pemulihan ruangan" dari Opsi B untuk build. Ruangan yang dibangun berubah dari gelap/berantakan menjadi terang/rapi.

### Aturan → cerita → visual (Opsi A)

| Aturan yang sudah ada | Arti dalam cerita | Cara terlihat |
|---|---|---|
| Api padam = kalah | Kegelapan menelan orang-orang | Cahaya menyusut menjadi bara, siluet orang hilang, gelap menyapu dari tepi layar |
| Hunter mati = kalah | Tidak ada lagi yang menjaga api | Lentera Hunter padam, kamera ditarik ke api |
| Oil | Bahan bakar api = waktu hidup orang-orang | Tong minyak di samping api; seorang survivor menuang minyak saat Oil masuk |
| Musuh di api menguras Oil | Mereka memakan api | Api membengkok/berpercik ke arah penyerang; orang-orang mundur ketakutan |
| Cahaya memperlambat & melemahkan musuh | Mereka terbakar di cahaya | Kaki musuh berasap/mendesis; angka damage berwarna emas |
| Membangun hanya di ruangan terang | Orang hanya berani bekerja di tempat yang dijangkau cahaya | Tapak di luar cahaya tampil abu-abu dengan ikon api + level yang dibutuhkan |
| Upgrade Perapian = radius lebih besar | Api lebih besar = rumah aman lebih luas, suar lebih terang | "WHOOMPH": cahaya menyapu ruangan baru, lentera koridor menyala satu per satu |
| Survivor / Shelter | Orang baru bergabung; sebagian menjadi guard | Orang baru berjalan masuk ke api, lalu (jika guard) ke pos pintu |
| Guard jatuh / hilang | Orang yang kamu jaga terluka atau hilang | Ring merah/hijau sudah ada; dibuat lebih personal: guard yang hilang = kursi kosong di api |
| 3 malam | Konvoi datang di fajar ketiga | Track `malam 1 — malam 2 — malam 3 — bendera` di layar siang; di fajar ketiga lampu konvoi terlihat di luar |

---

## 4. 60 detik pertama (storyboard, Opsi A)

| Waktu | Kamera | Yang dilihat | Yang dipelajari | UI |
|---|---|---|---|---|
| 0–3 dtk | Dekat api, senja | Api besar; 3–4 orang merapat; Hunter berdiri dan menyalakan lentera dari api | "Ini api. Mereka butuh api. Aku penjaganya." | Judul kecil `DUSKHOLD`, tanpa HUD |
| 3–6 dtk | Mundur, memperlihatkan rumah | Cahaya api menerangi beberapa ruangan; di luar ada kabut biru dan mata menyala di dekat pintu | "Cahaya = aman, gelap = bahaya" | Chip `KEEP THE FIRE ALIVE FOR 3 NIGHTS` |
| 6–9 dtk | Pan ke pintu pertama | Pintu bergetar, penanda pintu merah | "Dari sana mereka datang" | Timeline malam (bulan → matahari) muncul |
| 9 dtk → | Mengikuti Hunter | Kontrol diberikan | Gerak, tembak otomatis | Chip FTUE yang sudah ada (move, auto-shot, stay in light, Flare) |
| ±20 dtk | Kilas ke api | Zombie pertama menyentuh api: api membungkuk, orang menjerit, bar api berkedip | "Kalau mereka sampai ke api, kita kalah" | Banner pendek `THE FIRE!` yang tidak menutupi api |
| Fajar | Ke api | Orang-orang bersorak, cahaya emas | "Berhasil; tinggal 2 malam" | Track 3 malam maju satu langkah |

Intro 9 detik:
- hanya diputar sekali (disimpan seperti chip FTUE);
- tap di mana saja untuk melewati;
- tidak ada tombol tambahan.

---

## 5. Pilar desain

1. **Satu pandangan, satu cerita.** Setiap layar menjawab: apa yang terancam, di mana, dan apa yang bisa kulakukan.
2. **Api adalah jantung.** Api adalah objek paling terang dan paling dikenali. Status penting terlihat dulu di api dan orang-orangnya, baru di HUD.
3. **Tunjukkan → angka → teks.** Urutannya: dunia (model/VFX), lalu ikon + angka, dan teks 1–2 kata paling akhir.
4. **Setiap pembelian terlihat bekerja**:
   - sebelum dibeli: pratinjau;
   - saat dibangun: konstruksi;
   - sesudahnya: dunia berubah;
   - malam: aksi bangunan terlihat;
   - fajar: kredit.
5. **Kekuatan harus terasa.** Setiap tembakan berbobot, dan setiap upgrade menambah sesuatu yang terlihat, bukan hanya angka.
6. **Landscape-first, jempol-first.** Aksi yang sering dipakai ada di zona jempol bawah, info di atas, dan dunia di tengah tidak tertutup.

Hierarki info malam:
1. nyawa api;
2. HP Hunter;
3. waktu menuju fajar;
4. pintu yang terancam;
5. resource.

Hierarki info siang:
1. apa yang bisa dibangun/di-upgrade sekarang;
2. resource;
3. progres 3 malam;
4. mulai malam.

---

## 6. Api sebagai jantung

### 6.1 Penempatan (keputusan, lihat §13)

| Opsi | Deskripsi | Feel | Biaya/risiko |
|---|---|---|---|
| A. Tungku pusat di Main Hall (rekomendasi) | Tungku batu bundar berdiri bebas di tengah hall (880×620), dekat pintu depan. Orang-orang mengelilinginya, dan koridor "mengarah" ke api. | Paling kuat: terlihat dari banyak arah, dan kamera siang maupun malam secara natural berpusat di api. | Ruang terang/buildable, jalur musuh, pos guard, dan balance harus di-tune ulang. Hall tidak lagi menjadi slot bangunan; library menjadi slot. |
| B. Library jadi "Hearth Room" | Api pindah dari dinding ke lubang api terbuka di tengah library. | Kuat; pusat cahaya hanya bergeser ±260 px. | Pusat rumah tetap condong ke kanan; balance sedikit berubah. |
| C. Tetap di dinding, VFX diperkuat | Perapian dinding diperbesar, VFX ditambah, orang duduk di depannya. | Paling lemah: api tetap menempel di dinding dan mudah tertutup UI. | Paling murah, tanpa balance ulang. |

### 6.2 Anatomi visual api (lapisan)

1. **Inti api.** 2–3 lapis bentuk api stylized yang bergerak, bukan hanya point light. Tinggi api = kekuatan api.
2. **Bara & percikan.** Partikel terus naik, dengan burst saat Oil masuk atau api diserang.
3. **Asap tipis.** Beberapa wisp yang bergerak lambat dan makin gelap saat api sekarat.
4. **Pendar lantai.** Decal radial hangat di sekitar api (murah, tanpa shadow).
5. **Cahaya dinamis.** Satu light utama yang berkedip lembut + rim light hangat pada karakter di dekat api.
6. **Batas cahaya = wilayah.**
   - Garis tipis diganti **gradasi lantai hangat** + debu bara yang melayang di tepinya.
   - Area di luar sedikit lebih biru/desaturasi, tetapi tetap terang (sesuai aturan "malam = tint, bukan gelap").
   - Wilayah ini juga terlihat di siang hari, karena wilayah = tempat boleh membangun (pola overlay Frostpunk/Whiteout).
7. **Musuh di cahaya.** Asap/desis di kaki + percikan saat terkena. Ini menjelaskan "cahaya melemahkan" tanpa teks.

### 6.3 Lima status api (harus bisa dibedakan dalam 1 detik)

| Status | Pemicu (usulan) | Api | Cahaya | Orang-orang | Audio | HUD |
|---|---|---|---|---|---|---|
| Kuat | Oil cukup untuk sisa malam | Tinggi, kuning-oranye | Radius penuh | Santai, menghangatkan tangan | Kretek + dengung hangat | Bar api oranye |
| Melemah | Oil < 35% kebutuhan | Pendek, oranye-merah | Menyusut (sudah ada lewat `oilRadiusShrink`); kini dibuat terlihat | Merapat, menggigil | Kretek pelan | Bar berdenyut pelan |
| Diserang | Ada musuh yang memakan api | Membengkok ke arah penyerang, berpercik | Berkedip | Mundur, menjerit, menunjuk | Desis + jeritan | Vignette merah di tepi layar ke arah api + banner `THE FIRE!` |
| Sekarat | Oil < 10% | Hampir tinggal bara | Radius kecil | Saling memeluk | Detak jantung | Bar merah berkedip |
| Padam | Oil = 0 | Asap | Gelap menyapu dari tepi | Siluet hilang | Sunyi + angin | Layar kalah |

### 6.4 Level api = transformasi yang terlihat

- **Lv1 — tungku batu**, api sedang.
- **Lv2 — tungku besi**: cincin besi + 2 tiang lentera. Lentera di ruangan yang baru terjangkau menyala satu per satu (sapuan radius).
- **Lv3 — suar**: api tinggi, cerobong bercahaya, sorot cahaya menembus atap. Terlihat dari luar rumah = suar untuk konvoi.
- Setiap upgrade:
  - burst "WHOOMPH" dan sapuan cahaya 0.8 dtk;
  - orang-orang bersorak;
  - angka radius `980 → 1560` tampil di strip.

### 6.5 Budget performa (mobile, usulan)

- Partikel: inti/bara api ≤ 40 aktif, asap ≤ 6, debu bara di tepi cahaya ≤ 24.
- Light dinamis: satu untuk api (+ lentera Hunter bila dipakai); sisanya decal atau baked.
- Semua lapisan ikut tier kualitas yang sudah ada.

---

## 7. Build & upgrade yang terasa

### 7.1 Kosakata visual — satu bentuk, satu arti

| Bentuk | Arti | Dipakai untuk | Tidak boleh untuk |
|---|---|---|---|
| Tapak bangunan (garis putus-putus putih + tiang kecil berikon palu) | Tempat kosong yang bisa dibangun | Slot di ruangan terang | Upgrade |
| Palu | Membangun yang baru | Tombol `BUILD`, builder | Upgrade |
| Chevron emas ↑ | Naik level | Badge upgrade, tombol `UPGRADE` | Bangunan baru |
| Hijau | Untung / cukup / konfirmasi | Biaya terjangkau, hasil `+`, centang | Penanda slot |
| Merah | Bahaya / kurang / rusak | Biaya kurang, pintu jebol, musuh | Dekorasi |
| Tapak abu-abu + ikon api `Lv2` | Terkunci oleh kegelapan | Slot di luar cahaya | — |

### 7.2 Pengganti "+" hijau: tapak bangunan

- **Ruangan terang yang kosong:** di lantainya ada **tapak**, yaitu garis putus-putus seukuran bangunan + tiang kecil berikon palu.
  - Jika builder sibuk atau Oil/Wood kurang, tapak tetap terlihat tetapi tanpa kilau.
- **Ruangan gelap:** tapak abu-abu + ikon api `Lv2`. Ini mengajarkan bahwa upgrade api = ruang bangun baru.
- **Siang pertama:** satu tapak berdenyut + chip `BUILD HERE`, menggantikan `TAP + TO BUILD IN LIT ROOMS`.
- **Tap tapak** membuka pratinjau (§7.3).
- **Upgrade Perapian, Gate, dan Hunter** dibuka dengan men-tap objeknya di dunia: api, pintu depan, Hunter.
- Referensi:
  - titik bangun tetap + pekerja yang membangun (Kingdom Two Crowns);
  - penanda bertitik di atas bangunan untuk "bisa dibangun/di-upgrade" (Thronefall).

### 7.3 Satu alur untuk semua: Pilih → Pratinjau → Bangun → Rayakan → Malam → Fajar

1. **Pilih.** Tap tapak atau bangunan.
   - Kamera bergeser (300 ms) agar objek berada di tengah area dunia yang tidak tertutup.
   - Objek lain sedikit diredupkan.
2. **Pratinjau.** Strip bawah muncul (§8). Memilih satu opsi memunculkan **model hantu** di tapak, dan **efeknya digambar di dunia**:
   - menara: ring jangkauan;
   - api: radius baru;
   - sawmill: papan di pintu + bar HP pintu bertambah;
   - shelter: siluet orang baru di api;
   - pompa: jalur minyak dari pompa ke api.
3. **Bangun.** Tap `BUILD`.
   - Perancah muncul, dan builder (seorang survivor dengan palu) berjalan ke lokasi.
   - Ring progres tampil di atas lokasi, bukan di pill `READY`.
4. **Rayakan.** Saat bangunan selesai:
   - debu + kilau;
   - model "pop" (skala 0.85 → 1.08 → 1.0, 250 ms);
   - ikon efek terbang ke counter HUD-nya (contoh: `+1` orang terbang ke pill survivor);
   - lonceng kecil.
5. **Malam (payoff).** Saat bangunan bekerja, ikon kecil muncul di atasnya:
   - pompa: tetes minyak terbang ke api setiap kali Oil masuk;
   - menara: angka damage berwarna menara;
   - sawmill: papan terlihat di pintu + percikan saat menahan;
   - shelter: guard tambahan di pos.

   Dibatasi 1 ping per bangunan per 3 dtk, supaya tidak berantakan di tengah 90 zombie.
6. **Fajar (kredit).** Popup fajar punya baris per bangunan (ikon + angka): pompa `+6` oil, menara `14` kill, sawmill pintu `+10%`.

### 7.4 Satu tugas per bangunan

| Bangunan | Satu tugas | Kapan bekerja | Terlihat di dunia | Pratinjau | Payoff malam | Kredit fajar |
|---|---|---|---|---|---|---|
| Oil pump | Memberi makan api | Selama malam (ikon bulan) | Pompa + tong, tuas bergerak | Jalur minyak ke api, `+6` | Tetes minyak terbang ke api | `+6` oil |
| Sawmill | Memperkuat pintu + memberi kayu | Fajar (ikon matahari) + pasif | Tumpukan papan; papan terpasang di setiap pintu luar | Bar HP semua pintu luar `+10%` | Papan menahan (percikan) | `+7` wood, pintu `+10%` |
| Shelter | Menambah orang | Langsung (ikon petir) | Kasur + orang baru | Siluet orang baru di api/pos | Guard ekstra di pintu | `+1` survivor |
| Tower | Menembak di satu pintu | Malam | Ballista menghadap pintunya | Ring jangkauan | Bolt + angka damage warna menara | `N` kill |
| Perapian | Wilayah terang | Selalu | Api bertransformasi (§6.4) | Radius baru tergambar | Cahaya lebih luas | — |
| Gate | Pintu depan lebih kuat | Malam | Pita besi di pintu depan | Bar HP gerbang `+220` | Percikan saat dipukul | Gerbang bertahan / jebol |
| Hunter | Kekuatan tembak | Malam | Crossbow lebih besar/bercahaya | Angka damage + efek baru | Efek baru terlihat (tembus/ganda) | — |

### 7.5 Satuan efek yang konsisten

- Setiap angka efek selalu ditemani ikon *kapan*:
  - **bulan** = selama malam;
  - **matahari** = saat fajar;
  - **petir** = langsung.
- Contoh: `[oil] +6 [bulan]`, `[wood] +7 [matahari]`, `[orang] +1 [petir]`.
- Angka pertama yang dilihat pemain selalu **perubahan** (`+6`, `16 → 22`), bukan total.

### 7.6 Upgrade: "sebelum → sesudah" yang ringkas

- Maksimal **2 stat** per upgrade. Setiap stat: ikon + nilai lama → nilai baru + bar pendek yang bagian tambahannya berwarna hijau.
- Pip level `●●○` di samping nama.
- Tombol `UPGRADE`: chevron emas + biaya di dalam tombol.
  - Jika resource kurang: biaya merah, tombol abu-abu.
  - Tombol abu-abu tetap bisa ditekan untuk melihat kekurangannya (ikon + angka, misalnya `need 4 oil`).
- Dunia ikut memperlihatkan perubahannya:
  - menara: ring 520 + ring baru 580 putus-putus;
  - api: radius baru.
- Chip `TAP A GREEN ARROW TO LEVEL UP` diganti ikon chevron emas yang konsisten.
- Pola ini mengikuti Clash of Clans: tap bangunan → ikon aksi kontekstual, bukan panel besar.

### 7.7 Builder

- Status builder pindah ke dunia.
  - Saat bebas: builder berdiri di dekat api.
  - Saat bekerja: builder berada di lokasi dengan ring progres.
- HUD hanya menampilkan chip kecil `[palu] 1` (builder bebas) di dekat resource.
- Pill `READY` dihapus.

### 7.8 Ketegangan dengan aturan "label = ikon"

- Aturan user sebelumnya: label UI = ikon + angka, bukan teks.
- Usulan:
  - **HUD tetap ikon-only.**
  - **Strip pratinjau** boleh menampilkan **nama 1–2 kata** (`OIL PUMP`), karena pemain baru butuh nama untuk memahami fungsi saat pertama kali.
  - Caption stat (`FIRE RADIUS`, `BOLT DAMAGE`) dihapus dan diganti ikon + pratinjau di dunia.
- Perlu persetujuan user (§13).

---

## 8. Sistem layout landscape

### 8.1 Target layar

- **Baseline desain:** 844 × 390.
- **Ukuran uji lain:** 667 × 375 (kecil), 932 × 430 (besar), 1024 × 768 (tablet 4:3).
- **Safe area:**
  - kiri/kanan = `max(16 px, inset notch)`;
  - bawah = `max(12 px, inset home indicator)`.
- **Grid & target sentuh:** grid 8 px; target sentuh **≥ 44 px** (iOS 44 pt / Android 48 dp); jarak antar-target ≥ 8 px.
- **Skala UI:** mengikuti tinggi layar (390 px = 1.0), dibatasi maks 1.3 di tablet.

### 8.2 Zona jempol

- **Kiri-bawah:** joystick (malam) / geser kamera (siang).
- **Kanan-bawah:** aksi utama — Flare (malam), `START NIGHT` (siang), `BUILD`/`UPGRADE` (saat pratinjau).
- **Atas:** info saja (resource, timeline, api); jarang di-tap.
- **Tengah:** dunia. Tidak boleh tertutup panel lebih dari 28% tinggi layar.

### 8.3 Wireframe — malam

```
+------------------------------------------------------------------------+
| [II] [HP ####-]      ( moon ====o==== sun  0:33 )    [oil 36][wood 44] |
|                      [ FIRE ########--  | ppl 4 ]                      |
|                                                                        |
| < pintu                  ( dunia: Hunter di tengah )                   |
|   dikepung                                                             |
|                                                                        |
| ( joystick )             [ chip FTUE 1 baris ]               ( FLARE ) |
+------------------------------------------------------------------------+
```

- **Bar api adalah bar terpenting**: di tengah atas, di bawah timeline. Ikon orang di sebelahnya = yang dilindungi.
- **Banner alarm** setinggi ≤ 40 px, muncul di bawah bar api. Kamera memastikan api di dunia tidak tertutup.
- **Penanda tepi** (pintu dikepung, guard jatuh, api diserang) berada di dalam safe area, maksimal 3 sekaligus.

### 8.4 Wireframe — siang, tanpa seleksi (tidak ada panel)

```
+------------------------------------------------------------------------+
| [II]   ( DAY 2 :  N1 [v] - N2 - N3 - bendera )         [oil 56 | -19]  |
|                                                        [wood 44][ppl 2]|
|    .- - - - .                                          [palu 1]        |
|    : tapak  :           ( API + orang-orang )                          |
|    '- - - - '                                     .- - - - .           |
|          [Tower Lv2 ^]                            : tapak  :           |
|                      ( tapak abu-abu: api Lv2 )   '- - - - '           |
| [chip: BUILD HERE]                                   ( START NIGHT 2 ) |
+------------------------------------------------------------------------+
```

- Kamera siang berpusat di api dan memperlihatkan ruangan-ruangan terang; geser untuk melihat sisanya.
- Hanya objek yang punya aksi yang memakai bubble. Panah upgrade hanya muncul jika terjangkau.

### 8.5 Wireframe — siang, tapak dipilih (strip pratinjau)

```
+------------------------------------------------------------------------+
| [II]   ( DAY 2 ... )                                  [oil 56][wood 44]|
|                                                                        |
|              ( kamera: tapak terpilih di tengah area atas )            |
|                 [ model hantu + efek tergambar di dunia ]              |
|                                                                        |
+------------------------------------------------------------------------+
| [PUMP][SAW][SHLT][TOWER] | OIL PUMP  o o o    | [ BUILD  oil 2 wd 10 ] |
| ikon 56 px + biaya       | [oil] +6 [moon]    |                   (X)  |
+------------------------------------------------------------------------+
```

- **Ukuran:** tinggi strip ≤ 104 px (27% dari 390).
- **Isi:**
  - kiri: tile pilihan 56–64 px + biaya;
  - tengah: info pilihan aktif (nama, pip, efek dengan ikon satuan);
  - kanan (zona jempol): tombol utama + tutup.
- **Kapan muncul:** hanya saat ada seleksi. Bandingkan dengan sekarang: kolom kiri selalu terbuka (±380 × ±257 px).

### 8.6 Wireframe — upgrade (strip yang sama, isi berbeda)

```
+------------------------------------------------------------------------+
| [TOWER]  * * o  | [bolt]  16 -> 22    ####++  | [ ^ UPGRADE          ] |
|                 | [range] 520 -> 580  ####+   | [   oil 6   wood 18  ] |
+------------------------------------------------------------------------+
```

### 8.7 Wireframe — fajar (kredit)

```
+--------------- DAWN : NIGHT 2 SURVIVED ---------------+
|  [skull] 78     [fire] held      [ppl] 3 (-0)         |
|  [pump] +6 oil  [tower] 14 kill  [saw] +7 wood        |
|  [reward] +16 oil  +16 wood                           |
|                     ( COLLECT )                       |
+-------------------------------------------------------+
```

### 8.8 Anggaran ukuran (aturan keras)

| Elemen | Batas |
|---|---|
| Bar atas (resource/timeline) | ≤ 48 px tinggi |
| Strip siang (build/upgrade) | ≤ 104 px tinggi (≤ 28%); hanya saat ada seleksi; tidak pernah menutupi objek terpilih |
| Banner | ≤ 40 px, maksimal 1 sekaligus |
| Chip FTUE | 1 baris, maksimal 1 sekaligus |
| Target sentuh | ≥ 44 px |
| Bubble di dunia | ≤ 40 px; hanya untuk objek yang punya aksi |
| Pointer tepi | Maksimal 3; hanya objek yang relevan (terancam / upgrade terjangkau) |

---

## 9. Design tokens & komponen

### 9.1 Warna semantik

| Token | Hex (usulan) | Arti |
|---|---|---|
| `fire` | `#FF9A2E` → `#FFCF4A` | Api, Oil, cahaya |
| `gain` | `#45D06A` | Untung, cukup, konfirmasi |
| `upgrade` | `#FFD24A` | Naik level (chevron) |
| `danger` | `#FF4D4D` | Bahaya, kurang, rusak |
| `people` | `#5AB8FF` | Survivor, guard, keluarga |
| `wood` | `#B07A45` | Kayu |
| `blueprint` | `#F2F7FF` garis putus-putus, isi 15% | Tapak bangunan |
| `night` | `#1C2448` | Tint malam, panel |
| `ink` | `#1B1530` | Outline |
| `panel` | `#141228` @ 88% | Latar panel/strip |

Aturan:
- Hijau tidak pernah berarti "slot kosong".
- Emas hanya untuk naik level.
- Biru hanya untuk orang.

### 9.2 Tipografi

- Satu font display yang tebal dan bulat (font UI yang sudah ada).
- Skala: 12 (meta) / 14 (label) / 18 (nilai) / 24 (judul strip) / 32 (banner) / 40 (angka besar fajar).
- Angka selalu lebih besar dari labelnya.

### 9.3 Ikon

- **Tetap:** oil, wood, survivor, hunter, crossbow, shield, moon, sun, skull, fire, medic, hammer.
- **Baru:** tapak, chevron upgrade, satuan waktu (bulan kecil / matahari kecil / petir), bendera konvoi, keluarga (2 figur), tapak terkunci-api.
- **Aturan:**
  - siluet terbaca di 24 px;
  - outline ink 2 px;
  - satu warna dominan sesuai token.

### 9.4 Komponen

| Komponen | Anatomi | State | Tempat |
|---|---|---|---|
| Pill resource | Ikon 28 + angka 18 (+ chip delta) | Normal / bertambah (denyut hijau) / kurang (getar merah) / dicadangkan (chip bulan) | HUD kanan atas |
| Bar api | Ikon api + bar + jumlah orang | Kuat / melemah / diserang / sekarat | HUD tengah atas (malam); badge level api (siang) |
| Timeline malam | Bulan → matahari + pip gelombang | — | Tengah atas |
| Track 3 malam | 3 pip + bendera | Selesai / sekarang / berikutnya | Tengah atas (siang) |
| Tapak | Outline putus-putus + tiang palu | Tersedia / tak terjangkau / terkunci gelap / terpilih | Dunia |
| Badge bangunan | Ikon + pip level + chevron (jika terjangkau) | Idle / bisa upgrade / sedang dibangun (ring) / max | Dunia (≤ 40 px) |
| Tile opsi | Ikon 48 + baris biaya | Terjangkau / kurang / terkunci / terpilih | Strip |
| Blok info | Nama 1–2 kata + pip + efek (ikon satuan) | Build / upgrade | Strip |
| Tombol utama | Ikon + kata kerja + biaya | Aktif / kurang / sibuk | Strip kanan, `START NIGHT` |
| Banner | Ikon + 1–2 kata, warna per jenis | Alarm / info / sukses | Tengah atas |
| Chip hint | Ikon + teks pendek | Tampil sekali | Bawah tengah |
| Floater | Ikon + angka | Damage / cahaya / kill / dapat / hilang | Dunia |
| Pointer tepi | Ikon + panah | Pintu / guard / api | Tepi dunia |
| Kartu fajar | Baris ikon + angka | — | Fajar |

### 9.5 Motion & suara

- **Motion:**
  - UI masuk/keluar 150–200 ms, ease-out;
  - pop 250 ms dengan overshoot;
  - floater 0.9 dtk;
  - kamera ke objek 300 ms.
- **Reduced motion:** shake & hit-stop mati, partikel dikurangi.
- **Suara semantik:**

| Event | Suara |
|---|---|
| Bangun / selesai | Ketukan palu / lonceng kecil |
| Upgrade | "Whoomph" + nada naik |
| Resource masuk | Denting kayu/minyak |
| Pintu jebol | Dentuman |
| Api diserang / api lemah | Desis + jeritan / detak jantung |
| Fajar | Lonceng + musik lega |

---

## 10. Combat feel — "tembakan harus kuat"

### 10.1 TTK (jumlah hit per zombie swarm)

Sekarang (Hunter 26/32/40; swarm 48/54/60 HP; cahaya ×1.5):

| Hunter | Gelap N1/N2/N3 | Cahaya N1/N2/N3 |
|---|---|---|
| Lv1 | 2 / 3 / 3 | 2 / 2 / 2 |
| Lv2 | 2 / 2 / 2 | 1 / 2 / 2 |
| Lv3 | 2 / 2 / 2 | 1 / 1 / 1 |

Target usulan, arah **"horde power fantasy"** (sesuai referensi):

| Hunter | Gelap N1/N2/N3 | Cahaya N1/N2/N3 |
|---|---|---|
| Lv1 | 2 / 2 / 2 | 1 / 2 / 2 |
| Lv2 | 2 / 2 / 2 | 1 / 1 / 1 |
| Lv3 | 1 / 2 / 2 + efek Lv3 | 1 / 1 / 1 + efek Lv3 |

- **Contoh hitungan:** damage Hunter 32/40/48 dengan HP swarm tetap sudah memenuhi tabel target.
- **Alternatif:** turunkan HP swarm sambil menambah jumlah/kecepatan spawn ("HP musuh lebih rendah, musuh lebih banyak").
- **Kapan diputuskan:** di balance pass.
- **Risiko:** bot builder sudah menang mudah (roadmap, acceptance #4).
  - Penguatan tembakan **harus** diimbangi tekanan (jumlah, Breaker, waktu) dalam balance pass yang sama.
  - Tetap dalam batas performa: cap 30 per gelombang, crowd di-instance.

### 10.2 Lapisan juice (urutan prioritas, nilai awal)

| # | Efek | Nilai awal | Kapan |
|---|---|---|---|
| 1 | Hit flash putih | 60 ms | Setiap hit |
| 2 | Knockback + flinch | 14–24 px swarm, 6 px Breaker | Setiap hit Hunter |
| 3 | Angka damage berbobot | 18 px putih / 24 px emas (cahaya) / 30 px saat kill; pop 1.4 → 1.0 | Setiap hit |
| 4 | Kill pop | Tubuh terlempar dan pecah jadi abu/bara; abu di lantai memudar dalam 6–8 dtk | Setiap kill |
| 5 | Muzzle flash + recoil Hunter | 50 ms, mundur 3–4 px | Setiap tembakan |
| 6 | Tracer bolt | Jejak terang 80–120 ms; bolt lebih besar | Setiap tembakan |
| 7 | Hit-stop | 40–60 ms | Kill Breaker/Individual dan Flare (bukan swarm biasa) |
| 8 | Screen shake | 0 untuk hit biasa; 2–3 px untuk kill beruntun; 6–8 px untuk Flare; 4 px untuk pintu jebol | Event besar saja |
| 9 | Audio berlapis | "Thunk" + bass, pitch acak ±8%, tick untuk kill beruntun | Setiap hit/kill |
| 10 | Haptic (jika tersedia) | 10–20 ms | Kill besar, Flare |

Yang **sudah ada**:
- floater 16/20 px;
- flinch/stagger singkat;
- shake saat Hunter terluka dan saat api diserang;
- suara kill.

Yang **belum ada**:
- hit-stop;
- kill pop;
- muzzle flash/recoil;
- tracer;
- shake yang diskalakan per event.

### 10.3 Upgrade yang terlihat

Ditentukan oleh desain, bukan kartu pilihan pemain (aturan "tanpa pilih 1 dari 3" tetap berlaku).

- **Hunter Lv2:** **bolt tembus** — menembus 1 tubuh, dan jejaknya terlihat melewati 2 zombie.
- **Hunter Lv3:** **3 bolt kipas** *atau* **bolt api** (ledakan kecil). Pilih salah satu (§13).
- **Tower Lv2/Lv3:** ballista lebih besar, bolt menyala.
- **Flare:** ledakan cahaya besar + shake + hit-stop; semua musuh dalam radius terlempar.

### 10.4 Batas

- **Juice tidak boleh menyembunyikan ancaman:**
  - partikel dibatasi;
  - shake tidak dipakai untuk hit biasa;
  - ada opsi reduced motion.
- **Crowd tetap ringan:** silhouette crowd yang sudah di-instance tidak diganti.

---

## 11. Dunia — art direction menuju production

### 11.1 Arah gaya: "cozy-horror diorama"

- Model low-poly seperti mainan, dengan palet terbatas dan kontras tinggi per adegan (pendekatan Thronefall).
- Api sebagai jantung rumah yang menjaga orang tetap hidup (Whiteout Survival).
- Malam yang terang dan bersaturasi tinggi, dengan api oranye di tengah (Duck Survival).
- Aturan lama tetap berlaku: ruangan terang dan terbaca; malam ditunjukkan dengan tint, bukan kegelapan.

### 11.2 Color script per fase

| Fase | Suasana | Warna dominan | Kontras |
|---|---|---|---|
| Siang | Aman, sibuk | Netral hangat, krem, hijau rumput | Tinggi, bayangan lembut |
| Senja (transisi 2–3 dtk) | Tegang | Oranye → ungu | Bayangan memanjang |
| Malam | Bahaya tapi terbaca | Tint biru-ungu + kolam oranye api | Hangat vs dingin |
| Fajar | Lega | Emas | Burst cahaya |

### 11.3 Identitas ruangan & "pemulihan"

- Setiap ruangan punya fungsi, 2–3 hero prop, dan warna lantai sendiri (hall marmer, library kayu, dan seterusnya).
- Ruangan di luar cahaya tampak berdebu/terbengkalai, tetapi tetap terbaca.
- Ruangan yang dibangun "pulih": lentera menyala, prop rapi, panji berwarna bangunan.

### 11.4 Kehidupan & ambience

- Orang di api dengan idle loop: menghangatkan tangan, memeluk anak, menuang minyak.
- Builder berjalan ke lokasi bangun.
- Debu/abu melayang di dalam cahaya.
- Di luar: kabut + mata menyala; gagak di siang hari.

### 11.5 Siluet karakter (terbaca pada tinggi ±24 px)

| Karakter | Siluet | Warna |
|---|---|---|
| Hunter | Topi lebar, crossbow, lentera, syal | Oranye + gelap |
| Guard | Topi kecil/helm, crossbow kecil | Biru |
| Keluarga | Lebih kecil, berselimut | Biru muda/krem |
| Swarm | Bungkuk, mata merah | Hijau-abu |
| Breaker | Besar, bahu lebar | Abu + merah |
| Individual | Tinggi, kurus | Ungu |

### 11.6 Daftar produksi

- **Model:**
  - tungku 3 level;
  - keluarga: 2–3 varian + idle. Untuk vertical slice, pion guard bisa dipakai ulang dengan pose duduk/warna lain;
  - builder; tapak + perancah;
  - ballista, pompa, sawmill, shelter (masing-masing 3 level);
  - papan pintu; lentera.
- **VFX:** api (inti/bara/asap), sapuan radius, build pop, hit/kill, tracer, muzzle, abu.
- **Audio:** lihat daftar di §9.5.
- **Aturan aset (dari roadmap):**
  - aset baru dicatat provenance-nya;
  - byte aset berlisensi yang sudah ada tidak diubah;
  - pipeline WebGL tetap.

---

## 12. Rencana bertahap + acceptance

| Fase | Isi | Kode game? | Acceptance (terukur) |
|---|---|---|---|
| 0. Keputusan | Jawaban atas §13 | Tidak | Keputusan tercatat di dokumen ini |
| 1. Artefak desain | Mockup visual landscape (malam, siang, pratinjau, upgrade, fajar); sheet ikon baru; storyboard 60 dtk; sheet 5 status api | Tidak | User menyetujui mockup |
| 2. Vertical slice | Api baru + orang + 5 status; tapak + alur build end-to-end untuk satu bangunan (tower); strip landscape; juice tembakan; intro 9 dtk | Ya, setelah disetujui | Tes 3 pertanyaan ≥ 4/5; tes tapak ≥ 4/5; harness/devqa/layoutqa hijau; strip ≤ 104 px di 844×390 dan tidak menutupi objek terpilih |
| 3. Roll-out | Semua bangunan & upgrade di alur baru; kredit fajar; level api; TTK + balance pass | Ya | Bot + playtest manusia; target menang/kalah ditetapkan saat balance; 0 regresi QA |
| 4. Produksi | Art pass dunia, audio, performa perangkat | Ya | Target 60 fps / minimum 30 fps di perangkat mid-range; review visual di perangkat |

Definisi tes:
- **Tes 3 pertanyaan:** setelah 60 dtk pertama, pemain baru ditanya "kamu siapa / melindungi apa / tujuannya apa". Lulus bila ≥ 4 dari 5 pemain menjawab benar tanpa dibantu.
- **Tes tapak:** tunjukkan layar siang. Pemain menunjuk di mana ia bisa membangun dan menebak fungsi satu bangunan dari strip. Lulus bila ≥ 4/5.
- **Tes tembakan:** pemain menilai "tembakan terasa kuat" pada skala 1–5. Target rata-rata ≥ 4.

Status acceptance yang dicatat roadmap tetap berlaku. Dokumen ini tidak mengklaim apa pun sudah selesai.

---

## 13. Keputusan yang dibutuhkan

1. **Fantasi & tujuan:**
   - A Penjaga Api (rekomendasi);
   - B Pewaris Duskhold;
   - C Segel Api;
   - campuran A+B.
2. **Wajah yang dilindungi:**
   - kelompok keluarga di api (rekomendasi);
   - satu karakter bernama + kelompok;
   - api saja.
3. **Penempatan api:**
   - tungku pusat di Main Hall (rekomendasi);
   - library dijadikan Hearth Room;
   - tetap di dinding + VFX diperkuat.
4. **Interaksi build:**
   - strip bawah + pratinjau di dunia (rekomendasi);
   - ring menu di sekitar tapak;
   - jalan ke tapak lalu tahan untuk membayar (gaya Thronefall).
5. **Lanjutan (setelah 1–4):**
   - Bolehkah nama 1–2 kata di strip pratinjau?
   - Nama api di UI: `PERAPIAN` atau `THE FIRE`/`HEARTH`?
   - Hunter Lv3: 3 bolt kipas atau bolt api?
   - Intro 9 dtk: sekali saja atau setiap run baru?

---

## Referensi (riset 2026-10-15)

- **Duck Survival** — Google Play `com.mrtgd2us.google`: deskripsi "Build by Day, Defend by Night" + screenshot toko.
- **Thronefall:**
  - review The Geekly Grind: lingkaran koin bertitik di atas bangunan;
  - Namu Wiki `en.namu.wiki/w/Thronefall`: tahan untuk membayar, lepas = refund;
  - review PS3Blog 25-10-2024: gaya mainan, palet terbatas, istana yang dilindungi;
  - panduan Steam `steamcommunity.com/sharedfiles/filedetails/?id=3016836199`: bangunan ekonomi vs pertahanan, cabang upgrade menara.
- **Whiteout Survival** — `whiteoutsurvival.wiki/buildings/furnace` + panduan BlueStacks/U7BUY: furnace = jantung kota, survivor tetap hangat, upgrade = heat range.
- **Kingdom Two Crowns** — panduan CellularNews, review GideonsGaming: api unggun → keep, titik bangun tetap, pekerja membangun, mahkota = nyawa.
- **Frostpunk:**
  - `steamcommunity.com/app/323190/discussions/0/1696045708663012909/`: heat zone, overlay temperatur;
  - `steamcommunity.com/app/323190/discussions/0/5691968038964681698/`: outline saat menaruh bangunan di dalam zona;
  - `frostpunk.fandom.com/wiki/Steam_Hub`.
- **Clash of Clans** — `clashofclans.fandom.com/wiki/Laboratory`: ikon kontekstual Info/Upgrade/Finish.
- **Game feel:**
  - Jan Willem Nijman (Vlambeer), "The Art of Screenshake": HP musuh lebih rendah & musuh lebih banyak, peluru lebih besar, muzzle flash, efek impact, knockback, permanence, screen shake, sleep/hit-stop, gun kick, bass;
  - artikel egmatic: hit-stop 40–80 ms, shake sesuai skala event, menghormati reduced motion.
- **UI mobile:**
  - game-ace.com: target sentuh 44 pt (iOS) / 48 dp (Android) dengan jarak 8 pt; aksi utama di busur jempol bawah; anchor ke safe area; orientasi dikunci di GDD;
  - parachutedesign.ca: di landscape, zona nyaman bergeser ke tepi dekat jempol.
