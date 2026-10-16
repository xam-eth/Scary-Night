# Status Rebuild 3D & Survival Milestone 1

**Pembaruan:** 2026-10-16 (Asia/Makassar)
**Status keseluruhan: MASIH TERBUKA — bukan klaim siap rilis.** Inti rebuild dunia 3D dan loop Survival Milestone 1 sudah terimplementasi. Pada 2026-10-12 arah UI/UX dan threat model dikoreksi mengikuti feedback user; pada 2026-10-15 dilakukan pass analisis gap & bug (lihat bagian "Gap & bug pass 2026-10-15"), lalu pass progres Hunter + level bangunan (lihat "Progres Hunter & level bangunan"), lalu pass menara crossbow (lihat "Menara crossbow"), lalu pass guard yang bisa jatuh (lihat "Guard bisa jatuh"; termasuk perbaikan bug gelombang yang muncul di dalam rumah), dan seluruh gate otomatis dijalankan ulang. Setelah itu user memutuskan **game landscape only** dan meminta brainstorming + design system plan sebelum koding lagi (lihat "Arah desain & orientasi" dan `docs/DESIGN-SYSTEM-PLAN.md`; belum ada perubahan kode game untuk arah ini). Revisi 1 desain (konsep api) ditolak user. Di revisi 2 user memilih konsep **K1 "Benteng Terakhir"**, pola build **jalan ke lingkaran + BUILD**, dan nada **dark stylized**, lalu menyetujui semua rekomendasi aturan dan meminta "pastikan dunianya 3D". K1 kini **terimplementasi sebagai vertical slice** (lihat "K1 Benteng Terakhir — implementasi"); acceptance manusia/perangkat untuk K1 belum ada. Atas feedback user berikutnya, Survival kini dimainkan di **dunia benteng (bailey)** baru, bukan di dalam ruangan mansion (lihat "Dunia benteng untuk Survival"). Setelah itu kedua bookend cerita K1 dibuat: **intro sinematik** di malam pertama dan **adegan bala bantuan tiba** di fajar ke-3 (lihat "Bookend K1"); pemahaman pemain atas keduanya belum diuji. Lalu dibuat **riset UX & replay** dari review pemain (Play Store, Steam, Reddit, dan platform review lain) plus playtest bot "sebagai gamer" (lihat "Riset UX & replay" dan `docs/UX-REPLAY-RESEARCH.md`). Riset itu lalu diperdalam (v2: review bintang 5, persona, peta perjalanan, protokol playtest) atas permintaan user agar tidak ada coding. Belum ada perubahan kode game dari riset itu. Acceptance visual/manual di perangkat, playtest manusia, dan packaging Play masih terbuka. Hasil tiap skrip hanya berlaku untuk cakupan yang benar-benar diuji.

## Riset UX & replay — "mau main sekali lagi?" (2026-10-16)

**Konteks:** user meminta dua hal:
- riset review dan testimoni pemain (Play Store, forum, Steam, platform review lain) tentang UX yang mendapat review positif;
- memeriksa loop Survival "sebagai gamer": apakah pemain mau main sekali lagi.

**Hasil:** berupa dokumen, bukan kode game, di `docs/UX-REPLAY-RESEARCH.md`. Isinya:
- 12 pola UX dari review, masing-masing dengan kutipan + sumber;
- log satu run;
- scorecard 15 faktor replay;
- rekomendasi P0–P2 (R1–R19) dengan ukuran berhasil;
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

**Verdict (desain + bot, belum playtest manusia):**
- Sesi pertama kuat:
  - ±5,3 menit per run;
  - tujuan jelas, retry instan;
  - tanpa energi, iklan, atau chores;
  - run tersimpan saat aplikasi ditutup.
- Setelah kalah: kemungkinan main lagi.
- Setelah menang: hampir tidak ada alasan main lagi. Tidak ada rekor, bintang, unlock, atau tingkat sulit, dan run berikutnya identik (`NIGHT_DOORS` tetap, dompet hari sama di semua seed).
- Scorecard 16/30.

**Bug yang ditemukan (belum diperbaiki):** panel menang menampilkan `nightStats.kills`, yang di-reset di setiap `startNight()`. Akibatnya panel hanya menghitung kill malam 3 (`land-complete.png` menunjukkan "💀 2").

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
- Belum ada rekomendasi yang dibangun; menunggu pilihan user.
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

Ini screenshot checkpoint, bukan rekaman, dan bukan review di perangkat fisik.

## Acceptance yang masih terbuka

1. **FTUE/readability:** dunia kini terang dan terbaca di screenshot headless (luma diassert di envqa), UI berbasis ikon, chip hint kontekstual ada. Sejak 2026-10-16 save baru dibuka dengan intro sinematik K1 (menara → horde di gerbang → Kapten + trek 3 malam; diassert devqa/harness, lihat "Bookend K1"). Belum: review di perangkat nyata, uji pemahaman pemain baru (tes 3 pertanyaan), rekaman 30 detik.
2. **Combat Survival manual:** bot menggerakkan stick virtual dan Flare melalui Input; devqa kini mengetes stick mengambang, hit tombol Flare, dan pause lewat touch emulasi. Walkthrough manusia (gerak, bertahan di pintu, Flare, mempertahankan Perapian, **menolong guard yang jatuh**) belum dilakukan; apakah badge/ring waktu guard terbaca saat ramai belum dinilai pemain.
3. **Light weakness → wilayah panji (K1, 2026-10-16):** aturan cahaya diganti user (konsep api ditolak). Kini musuh di ruangan wilayah panji menerima damage ×1,5, tanpa perlambatan, tanpa pelemahan cakaran, dan pintu tanpa diskon (diassert harness). Rasa/feel dan keterbacaan tint biru di perangkat belum dinilai.
4. **Balance/progression:** *(K1 2026-10-16: builder 3/3, hunter-builder 3/3, keep-builder 1/3, tower-builder 0/3, idle/flare/active/passive 0/3 — lihat bagian K1; catatan di bawah ini dari aturan api lama)* target bot terpenuhi (idle/flare/active-tanpa-build kalah; upgrade Perapian saja sudah cukup menang 3/3; builder 3/3). **Pass guard:** perbaikan bug spawn (body muncul di basement/gallery) membuat permainan builder *lebih mudah* — Night 3 builder kini 0–1 musuh mencapai api (dulu 7–8) dan `hunter-builder` naik dari 1/3 ke 3/3, sehingga kesimpulan trade-off Hunter Lv3 di bawah sebagian berasal dari bug itu. Guard yang bisa jatuh menambah risiko terutama untuk permainan pasif; bot builder hampir tidak pernah kehilangan guard. Kesulitan untuk pemain yang membangun masih rendah dan kini makin jelas perlu playtest manusia sebelum mengubah biaya/ancaman. Progres kini ada (level bangunan Lv1–3 + jalur Hunter Lv1–3, diassert harness) dan bot `hunter-builder` menunjukkan trade-off nyata (Hunter Lv3 dengan Perapian Lv2 kalah 2/3 karena api padam di detik ±71). Menara (pass menara) menambah strategi menang ketiga: `tower-builder` 3/3 dengan Night 3 paling bersih (puncak 61 musuh, 0 mencapai api) — kuat, tetapi tidak mengubah peta menang/kalah. Masih terbuka: bot builder yang memeluk api tetap tidak kehilangan HP (100/100) dan tidak tercakar di Night 3; cadangan Oil 19 membuat pilihan Day 3 sangat ketat (Perapian Lv3 18 + Hunter Lv2 14 = 32 kurang 1 Oil) — biaya sengaja tidak diubah tanpa playtest manusia; rasa progres (apakah upgrade terasa) belum dinilai di perangkat.
5. **Visual pass:** sweep 17 stop per ruang/wing, state low-health/blackout, dan overlap staircase–stairRail belum selesai. Pohon siang tampak agak pucat (palet dinaikkan untuk readability) — kandidat polish.
6. **Perangkat/performa:** hidden-tab pause, context-loss freeze/restore, reload tengah malam, dan framing landscape kini diassert di Chromium headless (devqa). Belum: frame time 66–90 musuh + guard/bolt di perangkat low-end, DPR nyata. **Orientasi diputuskan user (2026-10-16): landscape only.** Layout siang landscape kini tanpa kolom kiri (K1, P1: tombol kontekstual di zona jempol). Frame time menara + lingkaran + crowd di perangkat belum diukur.
7. **Release bundle:** fingerprint signing SHA-256, token origin-trial, validasi Bubblewrap/AAB, uji TWA/Play tetap menunggu konfigurasi release. IAP tidak diubah.
8. **Replay / "mau main lagi?" (2026-10-16):** riset review + playtest bot ada di `docs/UX-REPLAY-RESEARCH.md`. Scorecard 16/30: kuat di sesi pendek, retry, dan tanpa energi/iklan; lemah di alasan untuk kembali setelah menang. Bug panel menang (kill hanya malam 3) belum diperbaiki. Riset v2 menambah lensa review bintang 5 (checklist 11/16), persona, peta perjalanan, dan protokol playtest. Belum: rekomendasi R1–R19 (menunggu pilihan user), playtest manusia sesuai protokol §6.1–§6.4 (PLAY AGAIN tanpa diminta, skor 1–5, salah ketuk NIGHT).

## Aturan laporan

- Laporkan implementasi dan acceptance terpisah. PASS di atas hanya PASS untuk assertion perintah terkait.
- Jangan menyebut rebuild/M1 “selesai” atau “siap rilis” sampai acceptance terbuka diverifikasi dan packaging punya bukti sendiri.
- Pertahankan `?legacy=1` sebagai akses QA/komparasi. Hapus legacy route atau sistem lama hanya dengan keputusan scope eksplisit.
- Pertahankan pipeline WebGL mansion/lampu serta provenance asset; jangan re-export atau mengubah byte sumber berlisensi tanpa izin.
