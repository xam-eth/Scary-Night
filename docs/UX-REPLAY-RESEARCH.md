# Riset UX & Replay — "Apakah pemain mau main sekali lagi?"

**Status (2026-10-16, v2):** dokumen riset dan rekomendasi. **Belum ada kode untuk item §5.**
*Pembaruan status implementasi (2026-10-16): dari §5 kini terbangun R1, R2, R3, R4, R19 (pass "Momen akhir run") dan R18a (pass feedback). Pembaruan 2026-10-18 (BUILD 16): R5 terbangun, R6 terbangun sebagian (gerbang diserang ≤ 5 dtk tercapai; target pertama kapten ≤ 5 dtk belum). Pembaruan 2026-10-19: R8 terbangun sebagian (BUILD 17), R18 terbangun sebagian — opsi (a)+(b)+(c) (BUILD 18). P1 lainnya dan P2 belum. Rincian dan apa yang sudah di-assert ada di catatan status di bawah tabel P0. Semua verdict di dokumen ini tetap verdict desain + bot sampai ada playtest manusia.*
Bukti playtest bot ada di `qa-evidence/ux-replay/` (`uxprobe.txt` dan `uxprobe.json`), dan bisa diulang dengan
`node tools/survival-uxprobe.mjs`. Belum ada playtest manusia, jadi semua verdict di bawah adalah
penilaian desain + bot, **bukan** hasil uji pemain.

**v2** dikerjakan atas permintaan user "tidak ada coding, only research dan pelajari experience user". Isinya riset saja, tanpa perubahan kode game atau tools:

- §2.1–§2.2: apa yang dipuji di review **bintang 5** (dan keluhan kecil di game yang dipuji);
- §3.4: temuan UX tambahan dari bermain ulang;
- §3.5: persona gamer;
- §3.6: peta perjalanan pemain;
- §4.1: checklist UX positif;
- R17–R19;
- §6.1–§6.5: protokol playtest manusia dan pemantauan review.

**v3** dikerjakan untuk permintaan yang sama, dikirim ulang. Isinya tetap riset saja:

- §2.3: data pasar dan ulasan **pemain Indonesia** (Play Store versi ID, Jakpat, Adjust, IDC);
- §3.7: analisis loop 3 lapis (inti / sesi / meta) dan lensa motivasi SDT;
- R20;
- §6.6: uji HP kelas bawah dan diary 7 hari.

---

## 0. Ringkasan

**Verdict sebagai gamer:**

- **Sesi pertama kuat.**
  - Tujuannya jelas: HOLD THE KEEP, 3 malam, ada jalur bendera bala bantuan.
  - Satu run cuma ±5,3 menit.
  - Retry instan, tanpa iklan, energi, atau tugas harian.
  - Progres run tersimpan saat aplikasi ditutup.
- **Setelah kalah:** kemungkinan besar main lagi. Run pendek, sebab kalahnya terasa ("kurang bangun"), dan PLAY AGAIN langsung jalan.
- **Setelah menang:** hampir tidak ada alasan main lagi.
  - Tidak ada yang tersimpan: rekor, bintang, atau unlock.
  - Tidak ada yang baru: tingkat sulit atau variasi.
  - Run berikutnya identik: gerbang per gelombang tetap (`NIGHT_DOORS`), dan dompet hari ke-2 selalu 62–63 gold / 56 wood.
  - Panel kemenangan malah menampilkan jumlah kill **malam terakhir saja**. Di tangkapan layar terlihat "💀 2" setelah 3 malam (bug, §3.3).
    - *Status 2026-10-16: bug kodenya diperbaiki (panel memakai `runStats`, lihat §3.3).*
- **Di dalam malam ada "udara mati".**
  - Bot yang bertahan aktif hanya punya target 48–72 % dari durasi malam.
  - Malam 2–3 dibuka dengan ±14 detik tanpa musuh dalam jangkauan.
  - Ada sampai ±12 detik menunggu jam setelah kill terakhir.

**Lima tindakan teratas** (detail di §5):

1. Ringkasan run yang benar dan "membanggakan", plus bintang 1–3, plus rekor.
2. Panel kalah "nyaris": berapa detik lagi menuju fajar, plus satu tip penyebab.
3. Fajar lebih cepat saat malam sudah bersih, dengan bonus gold (pola "early call" Kingdom Rush).
4. Kontak pertama ≤ 5 detik, dan gerbang malam ditandai sejak awal.
5. Tingkat Siege I–V setelah menang pertama + urutan gerbang yang bervariasi per run.

Ini menjawab langsung keluhan nomor satu Duck Survival ("selalu sama").

**Tambahan v2 — lensa review positif & pengalaman pengguna:**

- **Yang membuat orang memberi bintang 5.** Sumbernya:
  - Kingdom Rush (Play 4,7★);
  - BTD6 (Play 4,8★);
  - Vampire Survivors (Play 4,4★, Editors' Choice);
  - Duck Survival (App Store 4,9★);
  - Thronefall (Steam 95 %);
  - Archero.

  Dari sumber-sumber itu ada 9 pola yang paling sering dipuji (§2.1).
- **DUSKHOLD sudah memenuhi 5 pola itu:**
  - adil, tanpa iklan atau energi;
  - buka langsung main, tanpa login;
  - kontrol sederhana;
  - belajar sambil main (chip FTUE ≤ 8 kata);
  - visual bersih.
- **Yang belum:**
  - pilihan tingkat kesulitan;
  - momen "lihat pertahananmu bekerja" di ringkasan;
  - tantangan berikutnya setelah menang.

  Checklist UX positif: **11/16** (§4.1). Artinya kesan pertama kuat; kelemahannya sama dengan scorecard replay.
- **Temuan baru saat bermain:** tombol NIGHT ada tepat di samping BUILD, berjarak 10 px. NIGHT tidak bisa dibatalkan dan tidak minta konfirmasi walau gold masih cukup untuk membangun. Ini risiko salah ketuk (§3.4, R18).
- **Persona** (§3.5):
  - Pemain kasual dan penggemar aksi kemungkinan main lagi setelah kalah.
  - Penggemar strategi dan kolektor kemungkinan berhenti setelah menang sekali.
- **Peta perjalanan** (§3.6):
  - Puncak emosi: intro, akhir malam 1, dan bala bantuan tiba.
  - Lembah: pembuka malam 2–3, menunggu builder, panel menang yang datar, dan run kedua yang identik.

**Tambahan v3 — pemain Indonesia & analisis loop:**

- **Pemain Indonesia** (§2.3):
  - 82 % main untuk mengisi waktu luang dan 60 % untuk melepas stres (Jakpat 2025).
  - Sesi rata-rata 44 menit, terpanjang di dunia (Adjust 2025).
  - 76 % HP di pasar berharga < US$200 (IDC).
  - Ulasan Kingdom Rush versi Indonesia: "Grafiknya gak gitu bagus. Tapi gameplay-nya seru banget!! … game offline yg gak berat di hp".
  - Implikasinya:
    - ringan di HP murah dan bisa offline adalah **syarat UX**, bukan polish;
    - EASY dan retry lebih penting di pasar ini;
    - sesi yang panjang memberi ruang untuk banyak run, asalkan ada alasan main lagi.
- **Loop 3 lapis** (§3.7):
  - loop inti ✅;
  - loop sesi ✅, dengan lubang;
  - loop meta ❌. Inilah sebabnya pemain berhenti setelah menang.
  - Lensa motivasi SDT: kompetensi ✅, otonomi ⚠️, keterhubungan ❌.
- **Baru:**
  - R20: kartu hasil untuk dibagikan, tanpa server;
  - §6.6: uji HP RAM 3 GB dan diary 7 hari.

---

## 1. Metode

**Sumber review:**
- Google Play: Duck Survival, Survivor.io.
- Steam: Thronefall, Kingdom Two Crowns, Dome Keeper.
- Reddit: r/VampireSurvivors, r/gamedev, r/Survivorio, r/MobileGaming, r/domekeeper, r/patientgamers, r/iosgaming.
- HowLongToBeat, Metacritic, App Store (Brotato), Uptodown, AppGamer.
- v2, khusus review positif:
  - Google Play: Kingdom Rush, Bloons TD 6, Vampire Survivors;
  - App Store: Duck Survival, Vampire Survivors;
  - TouchArcade;
  - Reddit: r/VampireSurvivors, r/ShouldIbuythisgame, r/gaming, r/AndroidGaming;
  - Steam Discussions (Thronefall);
  - review Archero (GuruGamer, Androidsis) dan Thronefall (StackUp, Medium).
- v2, pedoman UX:
  - NN/g (aksi berisiko di samping aksi biasa);
  - pedoman tutorial/FTUE (Udonis, Playio);
  - diskusi kontrol sentuh (Unity forum, r/gamedev).
- v3, pemain Indonesia:
  - Google Play versi Indonesia (`hl=id&gl=ID`): Kingdom Rush, BTD6, Duck Survival;
  - survei Jakpat 2023 dan 2025;
  - Adjust *Gaming App Insights 2025*;
  - data pasar HP dari IDC;
  - media teknologi dan game Indonesia (IDN Times, MyRepublic, Uzone, Gameyplay).
  - TapTap juga dicek, tapi Duck Survival belum punya cukup ulasan di sana.
- v3, kerangka:
  - core loop vs meta loop (Tono, Mystic Media, FoxData, r/gamedesign);
  - Self-Determination Theory (Ryan, Rigby & Przybylski, 2006).

**Data pembanding:**
- Studi akademik atas 10,9 juta review Steam (Lin dkk., EMSE 2018).
- Benchmark GameAnalytics 2025.
- Survei iklan AppHarbr.

**Playtest "sebagai gamer":**
1. Bot nyata dari `tools/survival-bots.mjs` memainkan run penuh lewat `tools/survival-uxprobe.mjs`, dengan 5 seed (3 seed probe balance + 2 tetangga) dan 4 persona:
   - builder (pemain terampil);
   - tower (fokus ballista);
   - active (bertahan tapi tidak membangun);
   - idle.
2. Probe mengukur hal yang *dirasakan* pemain: kapan target pertama muncul, porsi malam yang ada targetnya, jeda kosong terlama, ekor kosong sebelum fajar, jumlah pilihan per hari, dan estimasi waktu hari versi manusia.
3. Tangkapan layar browser landscape (`qa-evidence/survival-k1/land-*.png`) dan review kode loop: `src/game/survival.js` dan `src/ui/survival.js`.

**Batasan:**
- Review yang paling "helpful" di toko cenderung negatif.
- Rating agregat (Duck Survival 4,6★) menunjukkan mayoritas pemain tetap menikmati loop intinya.
- Bot ≠ manusia. Bot membeli di tempat (jarak jalan dihitung terpisah) dan sudah tahu urutan build yang baik.
- v2 sengaja mengambil review **positif** untuk mengimbangi bias review negatif itu.
  - Review positif juga bias, karena ditulis penggemar.
  - Jadi review positif dipakai untuk menjawab "apa yang disukai", bukan "apa yang kurang".

---

## 2. Apa kata pemain — pola UX yang dipuji vs dikeluhkan

| # | Pola | Bukti dari pemain / data | Status DUSKHOLD |
|---|---|---|---|
| U1 | **Run pendek, "satu run lagi"** | Vampire Survivors: "short sweet time limit… anyone can pick up" (r/VampireSurvivors). Brotato: "Runs are short and sweet", "just one more run" (HLTB). Thronefall: "perfect for quick sessions", per peta 15–45 mnt. Dome Keeper: "20–30 minutes per run felt right" (HLTB), tapi ada juga "the runs lasted way too long" (r/domekeeper). Mobile: sesi median 5–6 mnt, 25 % teratas 8–9 mnt (GameAnalytics 2025). | ✅ ±5,3 mnt per run (bot builder: intro 7 s + 3×72 s + hari 50 s & 31 s + kedatangan 7 s) |
| U2 | **Selalu ada yang dibuka** | VS: "always things to unlock", "every run lets me check one more box" (r/VampireSurvivors). Brotato (App Store): unlock karakter "helps me feel like I'm actually progressing & not just stuck in this repetitive loop". Dome Keeper: unlock dome/gadget setelah run sukses (Metacritic). | ❌ tidak ada unlock / meta |
| U3 | **Tantangan setelah menang** | Kingdom Rush: 3★ bila tanpa nyawa hilang, lalu Heroic/Iron Challenge membuka bintang tambahan → "high replay value" (AppGamer, fandom). Brotato: Danger 0–5. Thronefall: mutator + misi per peta, "levelling up unlocks further challenges" (TheSixthAxis). VS: hyper mode setelah menamatkan peta (r/gamedev). Dome Keeper: Prestige = mode skor. | ❌ setelah menang, run identik |
| U4 | **Variasi antar run** | Duck Survival, review Play paling helpful: "feels like I'm just playing the same round or map over and over, but they just rotate the direction… just the same same every time". Dome Keeper: "runs do feel sorta samey". Thronefall dipuji karena perk/senjata membuat "every run feel fresh". | ❌ gerbang per gelombang tetap, peta sama, dompet hari sama |
| U5 | **Pilihan build yang bermakna** | Thronefall: tempat bangunan sudah ditentukan, tapi "striking a perfect balance between buildings that add short-term survivability and those that add to our long-term strategy" (minireview). Brotato: toko "honestly Brotato's strength". | ⚠️ 12 pilihan terjangkau di hari 2, 16 di hari 3, tapi hanya 2 hari (±8 pembelian per run) |
| U6 | **Juice: feedback visual & audio** | VS: "Bright lights, flashy colors, and big numbers", "MAKE FUN NOISE WHEN GO UP" (r/VampireSurvivors). Analisis r/gamedev: "great direct visual and auditory feedback… constant stream of dopamine". | ⚠️ tembakan, angka, banner, horn/fanfare ada; tapi layar malam sering sepi musuh (§3.2) |
| U7 | **Adil: tanpa P2W, energi, atau iklan paksa** | Survivor.io: "having limited energy just makes people stop playing" (justuseapp), "Energy system. Just lame. Why stop me from playing if I have the time" (r/Survivorio). Duck Survival: "deliberately designed for you to lose… paying to win" (Play), "Without paying, there's no point" (r/MobileGaming). Data: 58 % pemain langsung keluar karena iklan mengganggu, 84 % uninstall setelah berulang (AppHarbr via PocketGamer.biz). Pujian: Kingdom Rush/BTD6 "IAP… not even remotely necessary" (r/iosgaming); Thronefall "without any P2W nonsense" (minireview). | ✅ survival tanpa energi/iklan; IAP tidak disentuh — **pertahankan** |
| U8 | **Tanpa tugas harian & red dot** | Duck Survival: "every day, I need to spend 20 minutes … on 500 red dots to collect all the 'freebies'" → uninstall (Play). Survivor.io: "please put a collect all button" (Kimola), "too much going on… several daily things" (r/Survivorio). | ✅ satu COLLECT di fajar — **jangan** tambah red dot saat menambah meta |
| U9 | **Kalah yang mendidik + retry cepat** | "Player death must feel educational… If players can't clearly understand what went wrong, they won't queue up another run" (Entalto). r/gamedev: layar mati yang baik retry instan dan "brag about what you did accomplish"; Isaac "summarizing your run, what killed you". | ⚠️ retry instan ✅; panel hanya malam/kill/Lv keep, tanpa "kenapa" atau "seberapa dekat" |
| U10 | **Progres tersimpan saat keluar** | Duck Survival (Uptodown): "When you exit the app, everything resets. Please fix it." | ✅ `save.survival` melanjutkan run |
| U11 | **Kontrol tempo** | Kingdom Rush: memanggil gelombang lebih awal memberi gold sebanyak detik yang tersisa + cooldown spell (Game Developer). Kingdom Two Crowns dikeluhkan "too much waiting" (HLTB), "spend the majority of your time just waiting" (Metacritic). | ❌ malam hanya selesai oleh jam; ekor kosong sampai ±12 s |
| U12 | **Jelaskan aturan** | Kingdom Two Crowns: "Wish they would actually explain what things do" (HLTB, via hl2b). PvZ dipuji karena tiap level memperkenalkan satu hal baru (r/patientgamers, noobfeed). | ✅ chip FTUE kontekstual; ⚠️ malam 2–3 tidak memperkenalkan hal baru secara eksplisit |

**Satu temuan umum:** dari 10,9 juta review Steam, **57 % review negatif menyebut desain game** dan hanya 17 % menyebut bug. Kesimpulannya, "players value a well-designed gameplay over software quality" (Lin dkk., 2018).

Jadi kekhawatiran replay di atas adalah masalah desain, bukan polish.

### 2.1 Yang membuat reviewer memberi bintang 5

Sampel: review positif di halaman toko dan forum. Game-game ini ratingnya tinggi dan unduhannya besar:

- Kingdom Rush: 4,7★ / 847K review;
- BTD6: 4,8★ / 342K;
- Vampire Survivors: 4,4★ / 81,6K, Editors' Choice;
- Duck Survival App Store: 4,9★ / 4,7K;
- Thronefall: Steam 95 %.

| # | Pola yang dipuji | Kutipan review positif | Status DUSKHOLD |
|---|---|---|---|
| P1 | **Gratis & jujur, tanpa jebakan** | Kingdom Rush (Play): "high-quality content that is BOTH free and exceptionally well-made - and with zero bait-and-switch… upgrades available for either cash OR a small bit of our time… 100% fair". Vampire Survivors (Play): "No forced ads, no micro transactions"; iklan hanya muncul "if you want a free revive or more gold at the end of a run". App Store VS: "makes ads optional and rewarding". BTD6 (Play): "you don't have to pay to win!" | ✅ survival tanpa iklan, energi, atau P2W. IAP di luar scope dan tidak disentuh |
| P2 | **Buka langsung main, bisa offline** | r/VampireSurvivors: "No internet access(!) or account login required; you just open the game and play." Kingdom Rush memasang "★ PLAY OFFLINE!" di halaman tokonya. Sebaliknya di r/gaming: game single-player yang wajib online → "instant uninstall". Pedoman FTUE 2026: masuk gameplay inti ≤ 60 s, momen "aha" ≤ 90 s, tunda akun dan izin (Playio). | ✅ loading veil langsung masuk malam 1 (`main.js` memanggil `beginNight()` otomatis), tanpa menu atau login. Target pertama ±13 s setelah intro mulai. ⚠️ Offline: service worker (`sw.js`) men-cache aset setelah load pertama, tapi belum diuji di perangkat |
| P3 | **Kontrol sederhana, bisa satu tangan** | Archero: "You can literally do it with one hand tied behind your back" (GuruGamer); "Simple controls ideal for playing with one hand" (Androidsis). VS: "I can play mobile while feeding my 2 month old son" (r/VampireSurvivors). Thronefall: "pretty fun to play on steam deck too due to simple controls" (r/ShouldIbuythisgame). Keluhan umum: jempol menutupi aksi (VS: "awkward to control"); joystick tetap terasa kurang pas, dan joystick mengambang lebih disukai (Unity forum, r/gamedev). | ✅ stik mengambang + tembak otomatis + tap-to-walk. Malam bisa dimainkan dengan jempol kiri saja (FLARE opsional). Landscape menaruh jempol di sisi layar, jauh dari aksi. ⚠️ Belum diuji di ponsel kecil |
| P4 | **Belajar sambil main, sedikit teks** | Kingdom Rush: kampanye "introduces towers over time to help you learn" (Play). 80–90 % pemain tidak membaca teks tutorial; George Fan (PvZ): tidak lebih dari delapan kata di layar (Udonis). | ✅ 10 chip FTUE, 3–8 kata + ikon. Tiap chip tampil sekali dan hilang saat aksinya dilakukan. Yang terpanjang: "STAND BY A BUILDING TO LEVEL IT UP" (8 kata). ⚠️ Malam 2–3 tidak memperkenalkan hal baru |
| P5 | **Visual bersih, mudah dibaca** | Thronefall: "Units and structures are easily distinguishable… the minimalist visuals reduce cognitive load"; "That looks so simple and friendly" (Medium). Permintaan pemain di Steam Thronefall: tempat bangun diberi ikon bangunannya, supaya tidak perlu "move from spot to spot to look it up". | ✅ dunia terang; malam ditandai tint, bukan gelap. Lingkaran bangun sudah berikon tipe, terlihat dari jauh (`land-day-circle.png`: ikon gergaji dan tenda). Ada preview jangkauan ballista |
| P6 | **Melihat pertahanan bekerja** | BTD6: "My favorite part is to set up a powerful team and just enjoy watching them pop Bloons… The popping Bloons are satisfying to hear" (Play). Thronefall: "I build one structure and win a wave, then I want to build many structures" (StackUp). | ⚠️ ballista dan guard bertarung otomatis, tapi tidak ada momen yang menunjukkan *apa* hasil kerja bangunanmu (R19) |
| P7 | **Pilihan tingkat kesulitan** | BTD6: "if you aren't good at tower defense games, there's an easy difficulty (in addition to medium and hard)"; "many modes… so that both casual and serious players… can always enjoy the game" (Play). | ❌ hanya satu tingkat (R17, R7) |
| P8 | **Selalu ada tantangan berikutnya** | BTD6: "It doesn't ever get boring because there is so many things challenges" (Play). Duck Survival (App Store): "has side games so even if you get stuck, there is something you can do"; "the levels are actually levels and not just given". | ❌ setelah menang tidak ada (R2, R7, R11) |
| P9 | **Developer mendengar** | Duck Survival (App Store): "the devs are actually replying and taking feedback. First time in a while I actually play a game like this and don't delete it 3 days later." | — urusan pasca rilis: balas review, changelog (§6.5) |

### 2.2 Keluhan kecil di game yang dipuji (pelajaran murah)

- **Mekanik tap cepat merusak ritme.** Kingdom Rush: "the tap like crazy to unfreeze the towers mechanic. It feels jarringly out of place in what is otherwise a reasonably paced strategic game." Jangan menambah mekanik "spam tap" di malam.
- **Teks kecil dan run kepanjangan di ponsel.** TouchArcade tentang VS: "some of the text and UI can be a bit tiny on an iPhone, and… runs last a bit too long compared to what I typically want from a mobile game, sometimes stretching 20 minutes or more." Run DUSKHOLD ±5,3 mnt ✅. Ukuran teks perlu dicek di ponsel kecil.
- **Pemain ingin melihat angka.**
  - App Store VS: "we can't see the stat page when paused".
  - BTD6 (r/patientgamers): "it hides information like damage at RoF info which is annoying".
  - DUSKHOLD: kartu bangunan sudah menampilkan damage dan jangkauan ✅, tapi PAUSE belum punya statistik.
- **Tombol yang muncul di zona jempol tertekan tak sengaja.** Duck Survival (App Store): tombol reset muncul tepat di area jempol, sehingga "I almost always am hitting reset when I don't want to" (lihat §3.4 no. 1).
- **Monetisasi yang disukai** (catatan untuk masa depan, di luar scope sekarang):
  - Bila kelak ada iklan, yang dipuji adalah pola VS: opt-in di akhir run, untuk revive atau bonus gold. "There are no pop-ups. An advert will appear after runs… They can be ignored" (dev VS di r/VampireSurvivors).

### 2.3 Pemain Indonesia: data & ulasan berbahasa Indonesia (v3)

**Data pasar** (pembanding, bukan janji):

| Data | Angka | Arti untuk DUSKHOLD |
|---|---|---|
| Alasan main: Jakpat, *Indonesian Gaming Behavior 2025* (survei 3–4 Sep 2025) | 82 % main untuk mengisi waktu luang; 60 % untuk menghilangkan stres | Run ±5 mnt cocok. Kalah yang terasa menghukum bertentangan dengan "lepas stres" → R14, R17 |
| Profil gamer mobile: Jakpat 2023 (1.191 responden) | 55 % gamer mobile adalah gamer kasual (≤ 2 jam per sesi); 68 % gamer kasual adalah perempuan | Mayoritas pemain kasual. Jangan merancang hanya untuk "gamer inti" |
| Panjang sesi: Adjust, *Gaming App Insights 2025* | Indonesia **44,31 mnt** rata-rata per sesi pada 2024, terpanjang di dunia (global 30,75) | Ada waktu untuk beberapa run per sesi, asalkan ada alasan main lagi (§3.7). GameAnalytics (§6) memakai median 5–6 mnt; metodenya beda, jadi angkanya tidak bisa dibandingkan langsung |
| Kelas HP: IDC | HP < US$200 = 76 % pasar (Q1 2023); segmen < US$100 jadi motor pertumbuhan (Q4 2024) | Performa di HP murah adalah syarat UX |
| HP RAM 3 GB (Gameyplay) | Android + aplikasi latar sudah memakai sekitar 1,8–2,2 GB | Sisa RAM untuk game WebGL 3D tipis → uji di perangkat (§6.6) |

**Yang ditulis pemain Indonesia** (Google Play, versi ID):

- **Kingdom Rush** (toko ID: 4,8★ / 853 rb ulasan):
  - "Grafiknya gak gitu bagus. Tapi gameplay-nya seru banget!! … Pokoknya kalau mau cari game offline yg gak berat di hp dan buat ngisi waktu luang, Recommended"
  - "kalo udah paham tower dan musuhnya, main tanpa item dari shop juga bisa 3 bintang di kesulitan paling tinggipun" (221 orang menilai berguna)
  - "hadiah/gemsnya juga gampang untuk didapatkan"
- **BTD6** (toko ID: 4,8★ / 342 rb ulasan):
  - "sangat bagus karena dapat dimainkan secara offline … dapat dimainkan secara tenang maupun kompetitif … pembuat game ini juga perhatian pada penggunanya"
  - "map nya ada banyak banget … boss challenge, bahkan ada mode multiplayer juga"
- **Media Indonesia** berulang kali menulis kriteria yang sama:
  - offline adalah "andalan ketika kuota habis atau jaringan lagi gak stabil", dan ukurannya kecil (IDN Times);
  - "hemat kuota, bebas lag, dan lebih fokus tanpa iklan pop-up" (MyRepublic);
  - "Masalah HP panas saat bermain game merupakan keluhan sejuta umat" (Uzone).

**Yang ditonjolkan halaman toko versi Indonesia:**

- **Kingdom Rush:** "MAIN OFFLINE DI MANA SAJA!", ensiklopedia musuh dan pahlawan, "60+ PENCAPAIAN DALAM GAME".
- **Duck Survival:**
  - "Hadiah Login … 777 Undian Gratis". Ini pola login + undian, anti-pola untuk kita.
  - "Setiap malam Anda bertahan hidup akan memicu evolusi markas Anda". Markas berubah secara terlihat.
  - Developer-nya membalas review dengan alasan memilih format vertikal: "easy to handle all activities with one hand".

**Implikasi** (riset, belum dikerjakan):

1. **"Gak berat di HP" mengalahkan grafis.** Ulasan KR versi ID paling jelas: grafis dimaafkan bila gameplay seru dan ringan. Uji HP kelas bawah (§6.6) jadi prioritas acceptance UX.
2. **Offline & hemat kuota.**
   - Service worker sudah men-cache aset ✅.
   - Ukuran unduhan pertama perlu diukur.
   - Saat rilis, tulis "main offline" di halaman toko seperti KR.
3. **Lepas stres.** EASY (R17) dan retry malam 3 (R14) lebih penting di pasar ini.
4. **Sesi panjang.** Sesi 44 mnt cukup untuk 6–8 run. Tanpa alasan main lagi, sesi berhenti setelah 1–2 run. Fitur meta (R3, R7, R8) bernilai lebih besar di Indonesia.
5. **"3 bintang tanpa beli item"** adalah bentuk adil yang paling dihargai → R2 + R7, tanpa jalur bayar.
6. **Markas yang berevolusi.**
   - DUSKHOLD sudah punya ini *di dalam run*: bangunan membesar per level (`world3d.js`: skala 1,3 + 0,18 per level) dan keep menunjukkan levelnya.
   - Tapi semuanya hilang saat run berakhir. Lihat R9.
7. **Landscape vs satu tangan.**
   - Duck Survival menjual format portrait satu tangan.
   - Landscape adalah keputusan proyek dan **tidak** dibuka ulang. Mitigasinya sudah ada: malam cukup dimainkan dengan jempol kiri.
   - Amati di playtest apakah fase hari (tombol di kanan) terasa repot.
8. **Bahasa UI.** UI berbahasa Inggris adalah keputusan proyek. Uji 3 pertanyaan di playtest Indonesia akan menunjukkan apakah kata kunci (KEEP, GATE, BALLISTA) dipahami pemain kasual.

---

## 3. Playtest sebagai gamer

### 3.1 Log satu run (pemain terampil, bot builder, malam 72 s)

| Waktu | Apa yang terjadi | Rasa sebagai gamer |
|---|---|---|
| 0:00 | Intro 7,2 s: keep & penduduk → horde di gerbang → "YOU ARE THE CAPTAIN" (bisa di-skip) | ✅ peran, tujuan, dan objek yang dilindungi langsung jelas |
| 0:07 | Banner HOLD THE KEEP, malam 1 mulai | ✅ jelas. Di layar belum ada musuh; horde di gerbang utara, di luar frame |
| ±0:13 | Target pertama (jam malam ±9 s, intro sudah memajukan jam ke 2,9 s) | ⚠️ ±6 s pertama hanya berjalan |
| 0:13–1:16 | Kill naik dalam ledakan (6 s terakhir malam 1: sampai 22 kill) | ✅ puncak terasa; ⚠️ 30–46 % malam 1 tanpa target |
| ±1:16 | Fajar → kartu hadiah → COLLECT | ✅ satu ketukan |
| hari 2 | Dompet 62g/56w, **12** aksi terjangkau. Bot membeli keep → mine → barricade → sawmill → keep. Waktu manusia ±50 s (jalan 23 s; kerja builder 5–9 s per item, total 34 s, satu antrean) | ✅ pilihan cukup; ⚠️ banyak menunggu builder |
| malam 2 | Target pertama baru di **±14 s**; kill terakhir di ±62 s → **±10 s** menunggu jam | ❌ pembuka dan penutup kosong |
| hari 3 | **16** aksi terjangkau; 3 pembelian, ±31 s | ✅ |
| malam 3 | Target pertama ±15 s, target 48–52 % malam | ⚠️ malam terakhir harusnya paling padat |
| ±5:09 | Bala bantuan masuk (7 s), lalu panel REINFORCEMENTS ARRIVED! | ✅ momen menang kuat |
| ±5:16 | Panel: 🌙 3 · 💀 **(kill malam 3 saja)** · Lv3 · [PLAY AGAIN] → run identik | ❌ tidak ada rekor, bintang, unlock, atau "berikutnya" |

### 3.2 Angka probe (5 seed; `qa-evidence/ux-replay/uxprobe.txt`)

| Persona | Hasil | Target pertama (jam malam) | Porsi malam ada target | Jeda kosong terlama | Ekor kosong sebelum fajar |
|---|---|---|---|---|---|
| builder | **5/5 menang**, keep min 91–100 % | 9–14,7 s | 48–70 % | 9,2–14,7 s | 0,1–10,2 s |
| tower | 4/5 menang; 1 kalah **malam 3 di 63,5 s** (keep 1 %, seed 20261014) | 9–14,8 s | 51–70 % | 9,2–14,7 s | 0,1–11,7 s |
| active (tidak membangun) | 0/5, kalah malam 2 di 55–55,7 s | 9–14,1 s | 54–72 % | 9,2–14,1 s | — |
| idle | 0/5, kalah malam 1 di 38,6–40,4 s | 29,8–31,9 s | 11–12 % | 30–32 s | — |

**Bacaan gamer:**

- **Kurva sulit sehat:**
  - idle kalah di malam 1;
  - "hanya menembak" kalah di malam 2, sehingga game memaksa membangun;
  - builder menang;
  - tower nyaris kalah di malam 3.
- **Kalah "nyaris" itu bahan bakar replay**, tapi saat ini tidak ditampilkan. Panel tidak menyebut bahwa keep runtuh 8,5 detik sebelum fajar.
- **Ritme malam bolong:**
  - 28–52 % detik malam tanpa target;
  - malam 2–3 dibuka ±14 s kosong (±20 % malam);
  - malam 2 berakhir dengan ±10 s menunggu.
- **Variasi nol:**
  - dompet hari dan urutan gerbang identik di semua seed;
  - yang acak hanya jitter kecil (posisi dalam formasi, jeda tembak guard/menara).

### 3.3 Temuan konkret di kode/layar

1. **Bug ringkasan kemenangan.**
   - `drawEndPanel` menampilkan `mode.nightStats.kills`.
   - `startNight()` me-reset `nightStats` setiap malam, jadi panel menang hanya menghitung kill malam 3.
   - Di `land-complete.png` terlihat "💀 2".
   - *Status 2026-10-16:* bug kode diperbaiki. Panel akhir kini memakai `runStats` (total 3 malam + kill per sumber, tersimpan di `save.survival`). Koreksi atas bukti: angka "2" di `land-complete.png` juga artefak skrip. `survivalshots` men-set `nightsCompleted = 2; day = 3` lalu memanggil `completeNight()` tanpa memainkan malam 1–2, jadi screenshot itu tetap menunjukkan 2 setelah perbaikan. Bukti panel dengan kill hasil simulasi ada di `qa-evidence/survival-fixes/fx-end.png`.
   - *Status (pass "Momen akhir run"):* panel menang setelah 3 malam yang benar-benar dimainkan kini tertangkap di `qa-evidence/survival-fixes/fx-win.png` (bot builder di browser, 238 kill, ★★★, NEW BEST!).
2. **Panel akhir** (`src/ui/survival.js` `drawEndPanel`):
   - hanya 3 sel (malam, kill, Lv keep) + PLAY AGAIN;
   - tidak ada "terbaik", bintang, durasi, penduduk selamat, atau tip.
3. **Malam hanya selesai oleh jam:** `elapsed >= nightDuration`. Spawn terakhir terjadi di 70 % malam (`INDIVIDUAL_TIMES`).
4. **Data tetap:**
   - `NIGHT_DOORS` (gerbang per gelombang) dan `WAVE_COUNTS` sama setiap run;
   - hadiah malam dan biaya deterministik.
5. **Builder hanya satu antrean:** `startNight()` dan build berikutnya ditolak saat `builderJob` berjalan (5–9 s per item).
6. **PAUSE** hanya berisi RESUME / RESTART. Tidak ada pengaturan suara/musik.
7. **Sudah baik, pertahankan:**
   - retry instan;
   - intro sekali per save dan bisa di-skip;
   - tap-to-walk ke lingkaran;
   - satu tombol COLLECT;
   - tanpa energi/iklan di survival.

### 3.4 Temuan UX tambahan (main ulang dengan lensa review positif)

1. **Tombol NIGHT menempel di samping BUILD.**
   - **Posisi:** di landscape, NIGHT (ungu, 148×50) dan tombol aksi BUILD/UPGRADE (hijau, 210×56) berdampingan di pojok kanan bawah. Jaraknya tepat 10 px (`src/ui/survival.js`: `nightX = btnX - 10 - nightW`; lihat `land-day-circle.png`). Aksi kedua (mis. REPAIR) ada tepat di atas NIGHT.
   - **Risiko:** sekali ketuk NIGHT langsung memulai malam. Tidak ada konfirmasi, tidak bisa dibatalkan, juga saat gold masih cukup untuk membangun.
   - **Yang sudah baik:**
     - NIGHT nonaktif selama builder bekerja;
     - warna dan ikon kedua tombol berbeda (ungu/bulan vs hijau/palu). Ini "sinyal redundan" yang disarankan NN/g.
   - **Yang belum:** jarak, dan jalan untuk membatalkan.
   - **Dasar riset:**
     - NN/g: "Avoid placing highly consequential actions … directly next to options that are benign";
     - Duck Survival (App Store): tombol di zona jempol terus tertekan tak sengaja.
   - Jarak 10 px memenuhi spasi minimum ±8 dp, jadi ini **risiko yang perlu diamati di playtest**, bukan bug pasti. → R18
2. **Nol ketukan menuju game** ✅. Veil hilang → `beginNight()` dipanggil otomatis. Ini cocok dengan P2.
   - Konsekuensinya: kelak pilihan kesulitan (R17) jangan menambah ketukan di run pertama.
   - Misalnya, pilihan itu baru muncul setelah menang pertama atau setelah kalah.
3. **Teks FTUE sudah pendek** ✅. Kesepuluh chip berisi 3–8 kata, sesuai batas PvZ (§2.1 P4).
4. **Info:**
   - Kartu bangunan menampilkan damage dan jangkauan ✅.
   - PAUSE tidak punya statistik run maupun pengaturan (R12).
5. **Audio:** belum ada toggle. Cek di perangkat apakah musik latar pemain (Spotify/YouTube Music) berhenti saat game berbunyi.
6. **Berat unduhan pertama:**
   - Di disk: `assets/` 8,2 MB + `src/` 2,3 MB. Ini batas atas, karena tidak semua dimuat.
   - Veil punya progress bar ✅.
   - Waktu load pertama perlu diukur di 4G Indonesia.
7. **Kill dihitung di satu tempat tanpa sumbernya** (`survival.js`: `nightStats.kills++`). Untuk ringkasan "bangunan mana yang bekerja" (R19), kill perlu dicatat per sumber. Ini catatan kelayakan, belum dikerjakan. *(Status 2026-10-16: sudah dikerjakan. `killSource()` mencatat kill per Kapten / guard / ballista / keep / Flare; hasilnya dipakai panel fajar (R19) dan panel akhir.)*

### 3.5 Persona gamer: apakah mereka main lagi?

Dugaan berbasis review dan probe, bukan hasil wawancara. Diverifikasi dengan protokol §6.1.

| Persona | Mencari (dari review) | Yang kena di DUSKHOLD | Pemicu berhenti | Main lagi? | Yang menaikkan |
|---|---|---|---|---|---|
| **Kasual mobile**: main ±5 mnt di sela aktivitas, sering tanpa suara, kadang satu tangan (VS, Archero) | run pendek, tanpa iklan/login, kontrol simpel | intro 7 s, tembak otomatis, run ±5 mnt, nol ketukan | menunggu: pembuka malam kosong ±14 s, ekor ±10 s, antre builder | setelah kalah **tinggi**; setelah menang **sedang** ("sudah tamat") | R5, R6, R13, R1 |
| **Penggemar strategi/TD** (Kingdom Rush, BTD6, Thronefall) | pilihan bermakna, bintang, tingkat sulit, tantangan, angka jelas | lingkaran berikon, preview jangkauan, barricade, guard, Lv keep | hanya 2 hari membangun (±8 pembelian); tidak ada bintang atau tingkat setelah menang | setelah menang **rendah** | R2, R7, R8, R11, R17 |
| **Penggemar aksi/horde** (VS, Survivor.io) | layar penuh musuh, angka besar, power naik | tembakan, FLARE, Lv kapten, puncak gelombang | 28–52 % detik malam tanpa target | **sedang** | R6, R10, R15 |
| **Kolektor/completionist** | rekor, unlock, bintang, 100 % | belum ada | tidak ada yang dikumpulkan | setelah menang **rendah** | R3, R9, R2 |
| **Pemula/non-gamer** | mudah dipahami, pemaaf | tujuan jelas, chip singkat | kalah di malam 2 tanpa tahu sebabnya (persona active kalah di ±55 s) | **sedang → rendah** setelah 2× kalah | R4, R14, R17 |

**Bacaan:**

- Loop sekarang paling cocok untuk pemain kasual yang **kalah**.
- Persona strategi dan kolektor tidak punya alasan untuk run berikutnya setelah menang. Padahal justru persona inilah yang di review Kingdom Rush dan BTD6 paling memuji bintang dan tantangan.
- Di pasar Indonesia, persona kasual adalah mayoritas: 55 % gamer mobile, dan 68 % di antaranya perempuan (Jakpat 2023, §2.3). Sesinya juga panjang, jadi bila ada alasan, satu sesi bisa berisi banyak run.

### 3.6 Peta perjalanan pemain (sesi pertama → hari berikutnya)

| # | Momen | Emosi (dugaan) | Bukti | Friksi / risiko | Peluang |
|---|---|---|---|---|---|
| 1 | Halaman toko → install | penasaran | screenshot/video toko | gameplay tidak sesuai janji iklan → keluar (Playio) | tampilkan gameplay asli: malam + bangun |
| 2 | Buka aplikasi, loading | netral | veil + progress bar, tanpa login | load pertama di jaringan lambat | ukur di 4G |
| 3 | Intro 7,2 s | ▲ tertarik | peran, tujuan, dan objek terlihat | — | — |
| 4 | Malam 1 | ● jalan dulu ±6 s, lalu ▲ | target di ±9 s jam malam; ledakan kill di akhir | 30–46 % malam tanpa target | R6, R10 |
| 5 | Fajar 1 + COLLECT | ▲ puas | satu ketukan | — | — |
| 6 | Hari 2 | ● fokus, lalu menunggu | 12 pilihan; ±50 s; kerja builder total 34 s dalam satu antrean | menunggu; salah ketuk NIGHT | R13, R18 |
| 7 | Malam 2 | ▼ sepi, lalu ▲ breaker | pembuka kosong ±14 s; ekor ±10 s | "kenapa sepi?"; menunggu jam | R5, R6 |
| 8 | Hari 3 | ● | 16 pilihan, ±31 s | — | — |
| 9 | Malam 3 | ▲ tegang bila keep tipis | target 48–52 %; bot tower nyaris kalah | malam terakhir kurang padat | R10 |
| 10a | Menang: bala bantuan | ▲▲ puncak | sinematik 7 s + fanfare | — | — |
| 10b | Panel menang | ▼ datar | "💀 2", tanpa rekor/bintang | bug kill; tidak ada "berikutnya" | R1–R3, R9, R19 |
| 10c | Kalah | ▼ kecewa → ingin membalas | PLAY AGAIN instan | tidak tahu sebab dan seberapa dekat | R4, R14 |
| 11 | Run kedua | ● déjà vu | run identik | "sama saja" (keluhan no. 1 Duck Survival) | R7, R8 |
| 12 | Hari berikutnya | ? | tidak ada alasan baru untuk membuka | tidak ada tujuan tersimpan | R3, R7, R9, tanpa red dot atau tugas harian |

**Kurva emosi:**

▲ intro → ● jalan → ▲ akhir malam 1 → ▲ fajar → ● hari 2 (menunggu) → ▼ pembuka malam 2 → ▲ breaker → ● hari 3 → ▲ malam 3 → ▲▲ bala bantuan → ▼ panel datar → ● run kedua identik

Puncak terbesar (bala bantuan) langsung disusul lembah (panel). Momen paling emosional di run berakhir tanpa "hadiah" dan tanpa "berikutnya". Karena itu R1–R3 dan R19 diletakkan di P0.

### 3.7 Analisis loop 3 lapis (v3)

| Lapisan | Durasi | Loop DUSKHOLD | Hadiah | Status |
|---|---|---|---|---|
| **Inti** (detik) | 5–15 s | gerak → tembak otomatis → kill → angka damage; FLARE saat musuh menumpuk | ledakan kill, guncangan layar, angka | ✅ kuat saat gelombang datang; ⚠️ 28–52 % detik malam tanpa target |
| **Sesi** (menit) | ±5,3 mnt | malam → fajar (COLLECT) → bangun/upgrade (bangunan membesar) → malam berikutnya → bala bantuan | gold/wood, bangunan tumbuh, sinematik akhir | ✅ jelas; ⚠️ menunggu builder; ❌ berakhir tanpa hadiah |
| **Meta** (hari) | — | tidak ada | — | ❌ |

**Rujukan:**

- Loop VS: "Survive → Unlock → Retry stronger" (Tono). Loop meta adalah yang mengikat tujuan jangka panjang ke loop inti.
- "Without an effective Retention game… the Core Loop will seem insignificant and fade out" (Mystic Media).
- Tentang Tetris: "every time you start up a new run, it's a whole new set of problems to solve" (r/gamedesign). Variasi sistemik bisa menggantikan konten.

**Bacaan:**

- **Setelah kalah,** yang mendorong main lagi adalah loop sesi: run pendek dan rasa ingin membalas.
- **Setelah menang,** loop sesi sudah tuntas dan tidak ada loop meta, jadi pemain berhenti.
- Dua penyebab uninstall terbesar adalah **bosan** dan **frustrasi** (Mystic Media). Di DUSKHOLD:
  - bosan = udara mati di malam dan run yang identik;
  - frustrasi = salah ketuk NIGHT, dan kalah tanpa tahu sebabnya.

**Lensa motivasi: Self-Determination Theory.** Empat studi Ryan, Rigby & Przybylski (2006) menemukan bahwa kebutuhan akan **kompetensi**, **otonomi**, dan **keterhubungan** masing-masing memprediksi kesenangan dan main lagi di masa depan.

| Kebutuhan | DUSKHOLD sekarang | Yang menaikkan |
|---|---|---|
| Kompetensi | ✅ feedback tembakan jelas; kurva sulit sehat (idle kalah malam 1, active kalah malam 2, builder menang). ⚠️ Penguasaan tidak tercatat | R1–R4 |
| Otonomi | ⚠️ 12–16 pilihan per hari, tapi hanya 2 hari; tidak ada pilihan sebelum run | R7, R11, R17 |
| Keterhubungan | ❌ tidak ada berbagi atau perbandingan | R20 (tanpa server) |

---

## 4. Scorecard faktor replay

Skala: 2 = kuat, 1 = sebagian, 0 = tidak ada.

| Faktor (riset) | Skor | Alasan singkat |
|---|---|---|
| Panjang sesi cocok mobile (U1) | 2 | ±5,3 mnt per run |
| Tujuan jelas (U12) | 2 | intro + banner + jalur bendera |
| Retry cepat (U9) | 2 | PLAY AGAIN langsung ke malam 1 |
| Adil: tanpa energi/iklan/P2W (U7) | 2 | survival bersih |
| Tanpa tugas harian (U8) | 2 | satu COLLECT |
| Tersimpan saat keluar (U10) | 2 | `save.survival` |
| Pilihan build bermakna (U5) | 1 | pilihan banyak, hari sedikit |
| Juice (U6) | 1 | feedback kuat, layar malam sering sepi |
| Kepadatan malam | 1 | target 48–72 %, pembuka & ekor kosong |
| Kalah yang mendidik (U9) | 1 | tanpa "kenapa" / "seberapa dekat" |
| Momen akhir run | 0 | ringkasan salah, tanpa rekor |
| Tujuan setelah menang (U3) | 0 | tidak ada |
| Variasi antar run (U4) | 0 | identik |
| Progres meta / unlock (U2) | 0 | tidak ada |
| Kontrol tempo (U11) | 0 | tidak ada |

**Total 16/30.** Fondasinya kuat: enam faktor bernilai 2, termasuk area yang paling sering dikritik di game mobile sejenis (energi, iklan, P2W, chores), dan di sini semuanya bersih. Kekurangannya ada di **alasan untuk kembali**: U2, U3, U4, momen akhir run, dan tempo.

*Status (pass "Momen akhir run", 2026-10-16): scorecard ini **tidak di-skor ulang**, karena skor faktor yang disentuh perlu playtest manusia. Faktor yang disentuh: "Momen akhir run" (ringkasan kini benar, ada bintang dan rekor), "Kalah yang mendidik" (kini ada "seberapa dekat" + satu tip), dan sebagian "Tujuan setelah menang" (★★★ dan NEW BEST! sebagai target). Faktor variasi, progres meta, dan kontrol tempo tetap 0.*

### 4.1 Checklist UX positif (lensa bintang 5, §2.1)

Skala sama: 2 = kuat, 1 = sebagian, 0 = tidak ada. P9 (developer mendengar) tidak dinilai karena urusan pasca rilis.

| Pola | Skor | Alasan singkat |
|---|---|---|
| P1 Gratis & jujur | 2 | survival tanpa iklan, energi, atau P2W |
| P2 Buka langsung main | 2 | nol ketukan, tanpa login. Offline belum diuji di perangkat |
| P3 Kontrol sederhana | 2 | stik mengambang + tembak otomatis. Belum diuji di ponsel kecil |
| P4 Belajar sambil main | 2 | chip 3–8 kata, sekali tampil |
| P5 Visual bersih | 2 | dunia terang, lingkaran berikon |
| P6 Melihat pertahanan bekerja | 1 | bertarung otomatis, tapi tanpa momen pengakuan |
| P7 Pilihan kesulitan | 0 | satu tingkat |
| P8 Tantangan berikutnya | 0 | tidak ada setelah menang |

**Total 11/16.**

- Pola yang membuat orang memberi bintang 5 di **hari pertama** sudah ada.
- Pola untuk **minggu pertama** (P6–P8) belum, dan ini sama dengan kekurangan di scorecard replay.
- Kedua lensa sampai di kesimpulan yang sama.

---

## 5. Rekomendasi

Semua rekomendasi menghormati keputusan sebelumnya:

- **tanpa kartu skill acak "pilih 1 dari 3"**;
- tanpa tema api;
- tone dark stylized;
- landscape;
- dunia 3D;
- IAP, `src/shop`, dan server tidak disentuh;
- simpanan di `save.survival`.

### P0 — "Momen akhir run" (kecil, dampak terbesar)

| ID | Apa | Kenapa (riset) | Ukuran berhasil |
|---|---|---|---|
| R1 | **Ringkasan run yang benar & membanggakan.** Total kill 3 malam (perbaiki bug), penduduk selamat, HP keep tersisa, bangunan didirikan, durasi run. | U9: "brag about what you did accomplish"; bug merusak momen menang | Panel menang = jumlah kill seluruh malam (assert harness) |
| R2 | **Bintang 1–3 per run** dari kondisi keep (mis. ★ bertahan 3 malam, ★★ keep tak pernah < 50 %, ★★★ + tak ada guard hilang). Ambang di-tune dengan bot. | U3: bintang Kingdom Rush berdasar nyawa tersisa → "high replay value" | Bot builder (keep min 91–100 %) ★★–★★★; bot tower yang menang tipis (keep min 9–45 %) ★ |
| R3 | **Rekor tersimpan** di `save.survival.records`: bintang terbaik, malam terbanyak, total menang, total kill. Tampilkan "NEW BEST!" di panel. | U2: rasa maju antar run | Rekor bertahan setelah reload (devqa) |
| R4 | **Panel kalah "nyaris".** "THE KEEP FELL — 8s TO DAWN", progress malam, dan **satu tip dari penyebab nyata** (mis. "North gate had no ballista", "Keep was Lv1 on Night 2", "Guards fell — build barracks"). PLAY AGAIN tetap instan. | U9: kalah harus mendidik; near-miss memancing coba lagi | Tip sesuai penyebab di 3 skenario bot (idle / active / tower) |
| R5 | **Fajar lebih cepat.** Bila semua spawn malam sudah keluar dan musuh hidup = 0 → "NIGHT CLEARED", fajar dalam 2 s, bonus gold = detik yang dihemat (versi aman dari early call Kingdom Rush). | U11; ekor kosong ±10–12 s | Ekor kosong ≤ 3 s di probe |
| R6 | **Kontak pertama ≤ 5 s + gerbang ditandai.** Saat START NIGHT: horn + panah tepi ke gerbang gelombang 1, dan gelombang 1 mencapai gerbangnya dalam ±4–5 s. | U1/U6: "time to fun"; pembuka malam 2–3 kosong ±14 s | Target pertama ≤ 5 s di semua malam (probe) |
| R19 | **Kontribusi bangunan di ringkasan** (v2). Contoh: "MVP: NORTH BALLISTA · 31 KILLS", "GUARDS HELD THE EAST GATE", "BARRICADE TOOK 400 HITS". Perlu pencatatan kill per sumber (§3.4 no. 7). | P6: BTD6 "enjoy watching them pop", Thronefall "I build one structure and win a wave…". Juga menjawab tuntutan desain sebelumnya agar build/upgrade "terasa" | Ringkasan menyebut bangunan dengan kontribusi terbesar (assert harness) |

**Status implementasi P0 (2026-10-16, pass "Momen akhir run"; implementasi, belum acceptance manusia):**

| ID | Status | Yang di-assert / diukur |
|---|---|---|
| R1 | Terbangun. Panel akhir: malam x/3, total kill run, keep (sisa HP % saat fajar ke-3 / level bila kalah), bangunan berdiri, durasi run, baris kru. "Penduduk selamat" tidak ditampilkan sebagai angka (di K1 penduduk selalu di dalam keep). | Harness: kill panel = jumlah kill 3 malam bot builder (54 + 78 + 93 = 225). fxshots: menang 3 malam nyata di browser (66 + 79 + 93 = 238) |
| R2 | Terbangun dengan ambang usulan: ★ bertahan 3 malam, ★★ keep tidak pernah < 50 % HP, ★★★ + tidak ada guard hilang. | Bot 5 seed: builder ★★★ ×5 (keep terendah 88–100 %), tower-builder ★ ×4 (menang tipis, keep terendah 2–33 %). Sesuai ukuran berhasil. Harness meng-assert aturannya |
| R3 | Terbangun: `save.survival.records` (runs, wins, bestStars, bestNights, bestKills, totalKills) + tag "NEW BEST!" (tidak muncul di run pertama). | devqa: rekor sama sebelum/sesudah reload. Harness: NEW BEST hanya saat rekor pecah, reload mempertahankan panel + rekor, PLAY AGAIN mempertahankan rekor |
| R4 | Terbangun: "NIGHT n · Ns TO DAWN" (≤ 10 dtk: "SO CLOSE!"), track malam, satu tip ≤ 8 kata dari penyebab nyata. | Bot: idle → "WALK TO THE GATE UNDER ATTACK", active → "BUILD BY DAY: WALK INTO A CIRCLE", tower-builder → "BUILD A BALLISTA AT THE SE GATE". Sesuai 3 skenario ukuran berhasil. Harness meng-assert 6 penyebab. Apakah tip membantu manusia belum diuji |
| R5 | **Terbangun (BUILD 16, 2026-10-18).** "NIGHT CLEARED!" begitu semua spawn keluar dan tidak ada musuh berdiri; fajar 2 dtk kemudian (cahaya menghangat), 1 emas per detik penuh yang dihemat (baris sendiri di kartu fajar), mine dibayar sisa shift. **Tambahan di luar usulan:** yang menahan malam ternyata 1–3 pejalan lambat terakhir yang memutari tembok ke gerbang jauh; begitu semua spawn keluar dan sisa ≤ 3, yang tidak sedang bertarung lari ke hutan (bukan kill), yang masih bertarung ditandai "LAST N!" | `survival-uxprobe` (5 seed): ekor kosong malam 3 bot builder 7,7–9,6 → **2,0 dtk**, bot tower 10,9–14,2 → **1,4–2,1 dtk**; malam 2+3 yang cleared 0/20 → 20/20. Harness: aturan, bonus, bayaran mine, reload, tanpa clear saat spawn tersisa; gerombolan pecah. `survival-plotsqa` §8: banner, pill emas, tanah makin terang (luminansi 96 → 110 → 133 → 162), kartu fajar |
| R6 | **Sebagian (2026-10-17, BUILD 16).** Penanda gerbang terbangun di pass visual (ikon horde + "×N", atau panah tepi). BUILD 16: malam 2–3 melepas gelombang 1 di 1,5 % malam (malam 1 tetap 4 %, trailer menyerahkan kendali di sana); setiap gelombang dan Breaker dipanggil dengan nama gerbang + jumlah dan terompet horde dari sisi gerbangnya; panah tepi malam di HP landscape kini di bingkai area main (sebelumnya pita 92 px di tengah layar, dekat kepala kapten). **Belum:** target pertama kapten ≤ 5 dtk; jalan kaki Keep → gerbang (6–8 dtk) yang dominan | `survival-uxprobe`: gerbang pertama diserang malam 2–3 4,4–5,1 → **2,6–3,2 dtk**; target pertama bot builder malam 2/3 16,3–16,4 / 14,0–14,4 → 14,3–14,7 / 12,3–12,5 dtk; pemain `rally` (langsung ke gerbang yang dipanggil) 7,2–8,7 / 11,5 / 9,6 dtk. Harness: waktu gelombang 1, panggilan gerbang, terompet, Breaker. `survival-plotsqa` §8: banner "WAVE 1/3 · WEST GATE ×24", panah di bingkai |
| R19 | Terbangun: MVP = ballista per lingkaran, ballista atap keep, atau guard, dengan kill terbanyak. **Penyimpangan dari contoh:** Kapten tidak pernah jadi MVP. Di bot yang bertahan (builder, hunter-builder, tower-builder, keep-builder, active), Kapten termasuk Flare mengambil 78–97 % kill, jadi MVP berbasis kill murni hampir selalu "CAPTAIN" dan tidak membuat bangunan terasa. | Harness: kill bolt ballista nyata tercatat di lingkarannya (MVP "SOUTH BALLISTA"), contoh "NORTH BALLISTA 31" mengalahkan guard 12 / Kapten 180. Catatan: di run bot, ballista jarang mendapat kill terakhir (tower-builder: 25–35 kill ballista per run dari 104–119 tembakan), sehingga MVP bot umumnya GUARDS (satu seed: SOUTH BALLISTA 14) |

### P1 — "Alasan untuk kembali"

| ID | Apa | Kenapa (riset) | Ukuran berhasil |
|---|---|---|---|
| R7 | **Tingkat Siege I–V**, terbuka berurutan setelah menang. Tiap tingkat mengubah aturan secara **terlihat**: lebih banyak breaker, pelari cepat, gold awal lebih sedikit, dua gerbang serentak. | U3: Brotato Danger 0–5, Kingdom Rush Heroic/Iron, VS hyper mode | Bot builder menang Siege I, kalah di Siege V |
| R8 | **Sebagian terbangun (BUILD 17, 2026-10-19).** Variasi gerbang per run: malam 2 punya 4 urutan gerbang tulisan tangan, malam 3 punya 3, dipilih dari `runSeed` yang tersimpan di save (reload = ronde sama, run baru = ronde baru); malam 1 tetap satu urutan demi FTUE/trailer. Sifat horde di senja: chip TONIGHT di pita atas menyebut urutan gerbang + isi malam (ikon horde/pelari/breaker), dan badge gerbang V10 membawa pip nomor gelombang. **Belum:** "RUNNERS TONIGHT" sebagai sifat horde sungguhan (tipe tubuh pelari + retune), dan pengumuman sifat per malam selain arah + Breaker. Dua batas malam 3 lahir dari pengukuran balance: postern 110 HP tidak pernah jadi gelombang 2, dan langkah gelombang 1→2 ≤ seperempat sirkuit tembok (`rotation-matrix.txt`) | U4: keluhan nomor satu Duck Survival "same round… rotate the direction" | **Terpenuhi:** 5 seed probe memainkan 3 urutan malam 2 + 3 urutan malam 3 berbeda (10 seed acak: 4 + 3); harness meng-assert malam memainkan ronde yang diumumkan; plotsqa §9: 3 seed di satu layar hari-2 memberi 3 chip TONIGHT berbeda. FTUE tidak berubah: semua baris N1 probe identik dengan BUILD 16, `survival-intro` PASS |
| R9 | **Jalur unlock yang terlihat di panel akhir** ("2★ more: STONE BALLISTA"). Bintang/tingkat membuka varian bangunan, senjata kapten, atau warna panji. **Bukan** kartu acak. | U2 + transparansi: "players should clearly understand what they're working toward" (Entalto) | Setiap panel akhir menunjukkan unlock berikutnya |
| R10 | **Pacing malam lebih padat**: selipkan gerombolan kecil di antara 3 gelombang besar. | U6: target 48–72 % | Target ≥ 75 % untuk bot builder |
| R11 | **Commander's Orders** (opsional): mutator yang dipilih *sebelum* run (pola Thronefall) untuk ★ tambahan, mis. "NO BARRICADE", "HALF GOLD", "BLOOD MOON +30 %". Dipilih sadar, bukan acak. | U3: mutator Thronefall menambah skor/replay | Dipakai ≥ 1× oleh penguji yang sudah menang |
| R17 | **Pilihan EASY / NORMAL** (v2), dengan Siege I–V (R7) untuk yang sudah menang. Contoh EASY: keep +50 % HP, breaker lebih lambat (di-tune dengan bot). Run pertama tetap nol ketukan: pilihan **ditawarkan, tidak dipaksakan**, setelah kalah 2× atau dari PAUSE. | P7: BTD6 dipuji karena ada easy/medium/hard; persona pemula (§3.5) | Persona active (tanpa membangun) mencapai malam 3 di EASY; NORMAL tidak berubah |
| R18 | **Sebagian terbangun (BUILD 18, 2026-10-19): opsi (a)+(b)+(c).** (a) sudah dari pass feedback: NIGHT jadi chip top-left, jauh dari dock BUILD. (b) kini chip NIGHT harus **ditekan-tahan 0,55 dtk** (`SURVIVAL_TUNING.nightHold`) dengan cincin terang yang mengisi; ketukan yang lepas lebih awal tidak memulai apa pun dan chip menjawab "HOLD TO START" + hint sekali per save (`holdnight`); keyboard menahan `confirm` dengan cara yang sama. (c) selama cincin mengisi, chip menyebut **emas yang belum terbelanjakan** bila opsi siang termurah masih terbeli ("52 GOLD UNSPENT", dari `unspentNote`) — konfirmasi tanpa modal dialog. **Belum teruji di playtest manusia; 0 malam tak sengaja baru di-assert oleh harness (3 cek) + plotsqa §10 (browser sungguhan).** Pilihan asli, dari yang paling ringan: (a) jauhkan NIGHT dari BUILD; (b) "HOLD TO START" 0,5 s dengan cincin terisi; (c) konfirmasi singkat **hanya** bila gold masih cukup untuk build termurah ("52 GOLD UNSPENT — START?"). | NN/g: aksi berisiko jangan di samping aksi biasa; Duck Survival (App Store): tombol di zona jempol tertekan tak sengaja | 0 malam dimulai tak sengaja di playtest. Naik ke P0 bila playtest mencatat ≥ 1 salah ketuk |

### P2 — QoL

| ID | Apa | Kenapa |
|---|---|---|
| R12 | Toggle suara / musik / getar di PAUSE | QoL dasar mobile; banyak yang main tanpa suara; cek juga musik latar pemain (§3.4 no. 5) |
| R13 | Antre build (tap lingkaran berikutnya saat builder bekerja) atau waktu build 3–4 s | kerja builder ±34 s di hari 2 dengan satu antrean; K2C dikeluhkan "too much waiting" |
| R14 | "TRY NIGHT 3 AGAIN" (checkpoint dawn terakhir, bintang maksimal −1) | kalah di malam 3 = mengulang ±3,5–4 mnt yang identik |
| R15 | Kamera malam sedikit melebar saat horde berkumpul di gerbang (cek perf) | U6: tontonan horde |
| R16 | Batal build terakhir hari itu (refund penuh) | K2C: "you cannot go back on any mistakes when building" |
| R20 | **Kartu hasil untuk dibagikan** (v3): gambar berisi malam, kill, bintang, dan MVP, dikirim lewat menu share ponsel (WhatsApp/IG). Tanpa server, tanpa akun, tanpa leaderboard online | SDT: keterhubungan (§3.7). MOBA genre teratas di Indonesia (43 %, Jakpat 2025) karena memadukan kerja sama dan persaingan. Thronefall dipuji karena "friendly leaderboard" (MGT); pemain Duck Survival minta bisa "party up with friends" (App Store) |

### Anti-pola yang harus dihindari (dari review)

- **Energi / batas main:** "Why stop me from playing if I have the time".
- **Iklan paksa dan tombol X palsu:** 58 % langsung keluar.
- **Red dot / login chores:** "500 red dots".
- **Tembok P2W dan lonjakan kesulitan** yang memaksa membayar.
- **Kartu skill acak** (keluhan "frustratingly random" di Survivor.io, dan sudah ditolak di proyek ini).
- **Grind meta sebelum bisa menang:** Brotato dipuji karena "no initial grinding… before you are able to win".
- **Mekanik "spam tap"** yang merusak ritme strategi (Kingdom Rush: "jarringly out of place", v2).
- **Teks/UI terlalu kecil** di ponsel (TouchArcade tentang VS, v2).
- **Tombol yang muncul mendadak di zona jempol** (Duck Survival App Store, v2).
- **Pilihan yang menambah ketukan sebelum run pertama:** menu, login, atau izin sebelum gameplay (Playio, v2).

---

## 6. Metrik & cara uji

**Otomatis** (probe/harness; bisa jadi gate setelah dibangun):

| Metrik | Sekarang | Target |
|---|---|---|
| Target pertama per malam | 9–14,7 s | ≤ 5 s |
| Porsi malam ada target (builder) | 48–70 % | ≥ 75 % |
| Ekor kosong sebelum fajar (builder) | sampai 10,2 s | ≤ 3 s |
| Panjang run (builder) | ±5,3 mnt | 5–7 mnt (tetap) |
| Panel menang = total kill 3 malam | ❌ | ✅ |

**Playtest manusia (5 orang, landscape, perangkat nyata):**

- Catat apakah pemain menekan **PLAY AGAIN tanpa diminta** dalam 10 s, setelah menang dan setelah kalah.
- Tanyakan "Mau main lagi? (1–5)" dan "Apa yang ingin kamu coba di run berikutnya?"
- Ulang uji 3 pertanyaan: peran, tujuan, objek yang dilindungi (≥ 4/5).

**Nanti, bila ada analitik** (belum ada di proyek): benchmark GameAnalytics 2025.

- D1 25 % teratas: 26,5–27,7 %.
- Sesi 25 % teratas: 8–9 mnt.

Angka ini hanya pembanding, bukan janji.

### 6.1 Protokol playtest manusia (v2; riset, tanpa kode)

- **Peserta:** 6–8 orang, campuran persona §3.5:
  - 2 kasual;
  - 2 penggemar strategi/TD;
  - 2 penggemar aksi;
  - 1–2 pemula/non-gamer.
- **Perangkat:**
  - Android landscape: satu ponsel kecil (≤ 6") dan satu besar;
  - separuh sesi dengan suara, separuh tanpa suara.
- **Save bersih:** hapus data situs/aplikasi, supaya intro dan chip FTUE muncul seperti untuk pemain baru.
- **Instruksi tunggal:** "Mainkan sesukamu sambil ceritakan apa yang kamu pikirkan." Jangan membantu kecuali pemain macet > 60 s, dan catat setiap bantuan.
- **Rekam layar**, catat timestamp, dan biarkan pemain bermain sampai berhenti sendiri (maks. 20 mnt).

### 6.2 Lembar observasi

| Momen | Yang dicatat |
|---|---|
| 0–10 s | Tahu harus ke mana? Komentar pertama? |
| Target pertama | Detik ke berapa; reaksi |
| Chip FTUE | Dibaca? Diikuti? |
| Hari 2 | Menemukan lingkaran sendiri? Berapa lama? Bingung gold vs wood? |
| Tombol NIGHT | Ditekan sengaja atau tak sengaja? Berapa gold tersisa? |
| Pembuka malam 2 | Ada komentar "sepi" atau "nunggu"? |
| Akhir run | Reaksi 5 s pertama; panel dibaca? |
| PLAY AGAIN | Ditekan tanpa diminta dalam 10 s? |
| Run kedua | Apa yang diubah pemain? Kapan berhenti, dan kenapa? |

### 6.3 Wawancara singkat (≤ 5 mnt)

1. Di game ini kamu siapa, tujuanmu apa, dan apa yang kamu lindungi? (uji 3 pertanyaan)
2. Mau main lagi? Skala 1–5. Kenapa?
3. Kapan paling seru? Kapan paling bosan?
4. Apa yang ingin kamu coba di run berikutnya?
5. Kalau ini di Play Store, kamu kasih berapa bintang, dan apa yang akan kamu tulis? Ulasan imajiner ini menangkap bahasa pemain sendiri.
6. Besok kamu akan membukanya lagi? Tanyakan lagi lewat chat keesokan harinya: benar dibuka atau tidak (pengganti D1 sebelum ada analitik).

### 6.4 Kriteria keputusan (usulan)

| Hasil playtest | Keputusan |
|---|---|
| < 4/5 lolos uji 3 pertanyaan | perbaiki intro/caption dulu, sebelum fitur replay |
| PLAY AGAIN tanpa diminta setelah kalah < 60 % | R4 (panel nyaris) + R14 naik prioritas |
| Setelah menang, mayoritas berhenti | konfirmasi P0 (R1–R3, R19), lalu R7/R8 |
| ≥ 1 salah ketuk NIGHT | R18 naik ke P0 |
| ≥ 2 orang menyebut "sepi" / "nunggu" | R5, R6, R10 diprioritaskan |
| Rata-rata "mau main lagi" ≥ 4 dan ≥ 50 % membuka lagi besoknya | loop inti cukup; fokus ke variasi dan tantangan |

### 6.5 Memantau review setelah rilis (tanpa kode)

- Tandai setiap review baru dengan kode pola di dokumen ini: U1–U12 untuk keluhan dan pujian umum, P1–P9 untuk pujian bintang 5.
- Hitung 3 keluhan teratas tiap minggu.
- Balas review, terutama yang menyebut bug atau kebingungan. Duck Survival dipuji karena "devs are actually replying" (P9).
- Bandingkan bahasa ulasan imajiner dari playtest (§6.3 no. 5) dengan ulasan nyata. Bila kata-katanya sama, temuan playtest kemungkinan besar mewakili pemain sungguhan.

### 6.6 Uji HP kelas bawah & diary 7 hari (v3)

- **HP kelas bawah** (§2.3):
  - Perangkat: satu HP RAM 3 GB kelas < Rp2 juta, lewat Chrome/TWA, kecerahan 50 %.
  - Main 15 menit, ±3 run.
  - Catat:
    - apakah gerakan terasa patah;
    - suhu (dingin / hangat / panas);
    - baterai turun berapa %;
    - waktu load pertama di 4G;
    - besar data yang terunduh;
    - apakah game bisa dibuka lagi dalam mode pesawat.
- **Diary 7 hari** (pola FoxData: sesi pertama, hari 3, hari 7):
  - 3–5 penguji memasang game dan bebas memainkannya.
  - Di hari 1, 3, dan 7, catat: dibuka tanpa diingatkan atau tidak? Berapa run? Kenapa berhenti?
- **Keputusan** (usulan):

  | Hasil | Keputusan |
  |---|---|
  | HP 3 GB terasa panas atau patah dalam 15 menit | performa jadi P0, sebelum fitur replay |
  | Di hari 3 tidak ada penguji yang membuka game sendiri | loop meta (R3, R7, R9) jadi P0 |

---

## 7. Sumber

**Duck Survival:**
- Google Play: rating 4,6★ / 69,3K review; review paling helpful soal repetitif, red dot, P2W — https://play.google.com/store/apps/details?id=com.mrtgd2us.google&hl=en_US
- r/MobileGaming — https://www.reddit.com/r/MobileGaming/comments/1tt2lsh/what_do_you_think_of_this_game_duck_survival/
- Uptodown — https://duck-survival.en.uptodown.com/android
- BlueStacks guide — https://www.bluestacks.com/blog/game-guides/duck-survival/dks-beginners-guide-en.html

**Thronefall:**
- Steam (95 % dari 11.124) — https://store.steampowered.com/app/2239150/Thronefall/
- Review — https://gamenews.fyi/thronefall-review/
- TheSixthAxis — https://www.thesixthaxis.com/2023/08/03/thronefall-review/
- minireview — https://minireview.io/rts/thronefall
- MGT — https://moviesgamesandtech.com/2023/08/02/review-thronefall/

**Vampire Survivors:**
- r/VampireSurvivors — https://www.reddit.com/r/VampireSurvivors/comments/1khkit6/what_makes_vampire_survivors_so_addictive_for_you/
- Analisis r/gamedev — https://www.reddit.com/r/gamedev/comments/sitab0/ive_created_an_analysis_of_the_game_design_of/

**Survivor.io:**
- Google Play — https://play.google.com/store/apps/details/Survivor.io?id=com.dxx.firenow&hl=en
- Kimola — https://kimola.com/reports/comprehensive-survivor-io-feedback-strategic-analysis-report-google-play-en-us-142073
- r/Survivorio — https://www.reddit.com/r/Survivorio/comments/xuhitl/after_about_a_month_im_uninstalling_and_heres_why/
- justuseapp — https://justuseapp.com/en/app/1528941310/survivor-io/reviews

**Kingdom Two Crowns:**
- Steam — https://steamcommunity.com/app/701160/reviews/
- HLTB — https://howlongtobeat.com/game/63099/reviews/latest/1 (mirror hl2b: https://hl2b.com/game/63099/reviews/latest/1)
- Metacritic — https://www.metacritic.com/game/kingdom-two-crowns/

**Dome Keeper:**
- r/domekeeper — https://www.reddit.com/r/domekeeper/comments/15k1hzx/is_the_game_realy_that_boring_as_people_say/
- Metacritic — https://www.metacritic.com/game/dome-keeper/user-reviews/
- HLTB — https://howlongtobeat.com/game/109776/reviews/latest/1

**Brotato:**
- HLTB — https://howlongtobeat.com/game/114144/reviews/score/1
- r/patientgamers — https://www.reddit.com/r/patientgamers/comments/1imhza0/brotato_the_good_the_bad_the_ugly/
- Higher Plain Games — https://higherplaingames.com/switch/brotato-review/
- App Store — https://apps.apple.com/us/app/brotato/id6445884925

**Kingdom Rush:**
- AppGamer — https://www.appgamer.com/kingdom-rush/reviews/
- Fandom — https://kingdomrushtd.fandom.com/wiki/Kingdom_Rush
- Game Developer (early call) — https://www.gamedeveloper.com/design/kingdom-rush---the-wonderful-campaign-level-design
- r/iosgaming — https://www.reddit.com/r/iosgaming/comments/i06224/best_tower_defence_game_without_in_app_purchases/

**Plants vs. Zombies:**
- r/patientgamers — https://www.reddit.com/r/patientgamers/comments/1dkkt0h/to_me_plants_vs_zombies_1_has_the_best_difficulty/
- noobfeed — https://www.noobfeed.com/reviews/plants-vs-zombies

**Studi & data:**
- Lin, Bezemer, Zou, Hassan — *An Empirical Study of Game Reviews on the Steam Platform* (EMSE 2018) — https://sail.cs.queensu.ca/data/pdfs/EMSE2018_AnEmpiricalStudyOfGameReviewsOnTheSteamPlatform.pdf
- GameAnalytics 2025 (ringkasan) — https://gamedevreports.substack.com/p/gameanalytics-mobile-gaming-benchmarks
- AppHarbr via PocketGamer.biz — https://www.pocketgamer.biz/bad-ads-are-killing-the-mobile-gaming-experience-heres-how-we-fix-it/

**Review positif & pedoman UX (v2):**
- Kingdom Rush, Google Play (4,7★ / 847K; "zero bait-and-switch", "PLAY OFFLINE", keluhan "tap like crazy") — https://play.google.com/store/apps/details?id=com.ironhidegames.android.kingdomrush&hl=en_SG
- Bloons TD 6, Google Play (4,8★; "watching them pop", easy difficulty, "you don't have to pay to win") — https://play.google.com/store/apps/details?id=com.ninjakiwi.bloonstd6&hl=en_US
- BTD6, r/patientgamers ("easy to get into but hard to master"; info tersembunyi) — https://www.reddit.com/r/patientgamers/comments/jau2it/bloons_td_6_is_the_pinnacle_of_tower_defense/
- Vampire Survivors, Google Play (4,4★ / 81,6K, Editors' Choice; "No forced ads") — https://play.google.com/store/apps/details?id=com.poncle.vampiresurvivors&hl=en_US
- Vampire Survivors, App Store ("makes ads optional and rewarding"; stat page saat pause) — https://apps.apple.com/us/app/vampire-survivors/id6444525702?see-all=reviews
- Vampire Survivors, r/VampireSurvivors (rilis mobile: offline, tanpa login, iklan setelah run) — https://www.reddit.com/r/VampireSurvivors/comments/zghl3k/vampire_survivors_out_now_on_ios_and_android_for/
- Vampire Survivors, r/VampireSurvivors ("while feeding my 2 month old son") — https://www.reddit.com/r/VampireSurvivors/comments/10mlzp0/is_the_mobile_version_worth_it/
- TouchArcade, Game of the Week VS (teks kecil, run kepanjangan) — https://toucharcade.com/2022/12/09/toucharcade-game-of-the-week-vampire-survivors/
- Duck Survival, App Store (4,9★ / 4,7K; "side games", "devs are actually replying", tombol reset) — https://apps.apple.com/us/app/duck-survival/id6761410877
- Thronefall, r/ShouldIbuythisgame ("simple controls") — https://www.reddit.com/r/ShouldIbuythisgame/comments/1ipx5i0/thronefalldo_you_suggest_this_game/
- Thronefall, Medium (minimalisme, keterbacaan) — https://donatvatoci1.medium.com/thronefall-a-take-on-minimalism-trimming-the-fat-from-strategy-b76b2413a10c
- Thronefall, StackUp ("I build one structure and win a wave") — https://www.stackup.org/post/review-thronefall
- Thronefall, Steam Discussions (ikon di tempat bangun, overview) — https://steamcommunity.com/app/2239150/discussions/0/4034724996299636024/
- Archero, GuruGamer ("one hand tied behind your back") — https://gurugamer.com/reviews/archero-review-a-simple-but-great-dungeon-crawler-3565
- Archero, Androidsis ("ideal for playing with one hand") — https://en.androidsis.com/archero-is-an-intense-casual-in-which-you-only-have-one-life-to-succeed/
- r/gaming (wajib online → "instant uninstall") — https://www.reddit.com/r/gaming/comments/1c39qt9/i_hate_games_forcing_an_online_connection/
- r/AndroidGaming (game offline yang ternyata minta login) — https://www.reddit.com/r/AndroidGaming/comments/16bo2ve/offline_games_to_play_where_i_have_no_internet_at/
- Udonis, tutorial mobile (80–90 % tidak membaca teks; ≤ 8 kata) — https://www.blog.udonis.co/mobile-marketing/mobile-games/mobile-game-tutorial
- Playio, onboarding & D1 (gameplay ≤ 60 s, "aha" ≤ 90 s) — https://blog.playio.co/mobile-game-onboarding-retention
- NN/g, *Dangerous UX: Consequential Options Close to Benign Options* — https://www.nngroup.com/articles/proximity-consequential-options/
- Unity Discussions (joystick virtual vs mengambang) — https://forum.unity.com/threads/opinions-wanted-why-are-joystick-controls-so-terrible-on-mobile.431413/
- r/gamedev (jenis joystick di layar) — https://www.reddit.com/r/gamedev/comments/1gmlemv/mobile_whats_the_best_type_of_virtual_onscreen/

**Pemain Indonesia (v3):**
- Kingdom Rush, Google Play versi Indonesia (4,8★ / 853 rb; ulasan "gak berat di hp", "3 bintang di kesulitan paling tinggi") — https://play.google.com/store/apps/details?id=com.ironhidegames.android.kingdomrush&hl=id&gl=ID
- Bloons TD 6, Google Play versi Indonesia (4,8★ / 342 rb; "offline", "tenang maupun kompetitif") — https://play.google.com/store/apps/details?id=com.ninjakiwi.bloonstd6&hl=id&gl=ID
- Duck Survival, Google Play versi Indonesia (deskripsi: hadiah login, markas berevolusi) — https://play.google.com/store/apps/details?id=com.mrtgd2us.google&hl=id&gl=ID
- Duck Survival, Google Play (balasan developer: vertikal satu tangan) — https://play.google.com/store/apps/details?id=com.mrtgd2us.google&hl=en
- Duck Survival di TapTap (ulasan belum cukup untuk ringkasan) — https://www.taptap.io/app/34004203/review
- Jakpat, *Indonesian Gaming Behavior 2025*, via Selular.id (82 % / 60 %) — https://selular.id/2025/11/survei-ungkap-82-publik-ri-main-game-untuk-isi-waktu-luang-2025/
- Jakpat 2025 via GoodStats (1.203 responden, 3–4 Sep 2025) — https://goodstats.id/publication/indonesian-gaming-behavior-2025-mgMC3
- Jakpat 2025, genre (MOBA 43 %) — https://ipad-os.net/genre-game-yang-paling-banyak-diminati-para-gamer-indonesia/
- Jakpat 2023 via ESQNews (55 % gamer mobile kasual; 68 % gamer kasual perempuan) — https://www.esqnews.id/berita/93-responden-milenial-dan-gen-z-merupakan-mobile-gamer-tengok-hasil-survei-jakpat
- Adjust *Gaming App Insights 2025* via adobo Magazine (Indonesia 44,31 mnt per sesi) — https://www.adobomagazine.com/insight/adjust-report-apac-powers-global-gaming-app-growth-amid-shifting-trends/
- Adjust 2025 via BYYD (global 30,75 mnt; per genre) — https://www.byyd.me/en/blog/2025/04/mobile-gaming-market-key-insights/
- IDC via Heaptalk (HP < US$200 = 76 %, Q1 2023) — https://heaptalk.com/news/idc-report-indonesias-smartphone-market-plummets-in-q1-2023/
- IDC via TelecomLead (Q4 2024, segmen < US$100) — https://telecomlead.com/broadband/idc-views-on-smartphone-buying-trends-indonesia-119965
- Gameyplay (RAM 3 GB) — https://www.gameyplay.com/2026/10/penyebab-game-patah-patah-di-hp-ram-3gb.html
- Uzone (HP panas) — https://uzone.id/hanya-5-menit-begini-cara-ampuh-mengatasi-hp-panas-saat-main-game
- IDN Times (game ringan offline) — https://www.idntimes.com/tech/games/game-ringan-untuk-hp-kentang-go25q3-00-7vt1s-nk7sc6
- MyRepublic (hemat kuota, tanpa iklan pop-up) — https://www.myrepublic.co.id/blog/10-game-aksi-offline-terbaik-untuk-android-di-2025-bisa-main-tanpa-kuota

**Loop & motivasi (v3):**
- Tono Game Consultants (core vs meta loop) — https://tonogameconsultants.com/gameloop/
- Mystic Media (retention game; bosan & frustrasi) — https://blog.mysticmediasoft.com/tag/core-loop/
- r/gamedesign (core loop vs meta loop; Tetris) — https://www.reddit.com/r/gamedesign/comments/1uuoynt/i_have_a_fun_core_mechanic_but_i_do_not_know_how/
- FoxData (main di sesi pertama, hari 3, hari 7) — https://foxdata.com/en/blogs/how-to-analyze-competitor-mobile-games-core-loops-meta-revenue/
- Ryan, Rigby & Przybylski (2006), *The Motivational Pull of Video Games: A Self-Determination Theory Approach*, Motivation and Emotion 30(4), doi:10.1007/s11031-006-9051-8 — https://articles.researchsolutions.com/the-motivational-pull-of-video-games-a-self-determination-theory-approach/doi/10.1007/s11031-006-9051-8

**Desain layar kalah & roguelite:**
- r/gamedev — https://www.reddit.com/r/gamedev/comments/1is8ag2/were_working_on_our_death_screen_and_really/
- Entalto Studios — https://entaltostudios.com/5-essential-tips-to-make-your-roguelite-game-work/
- r/gamedev (energi & iklan) — https://www.reddit.com/r/gamedev/comments/1kdbuje/point_of_energy_that_is_often_seen_in_mobile_games/
