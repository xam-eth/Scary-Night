# Riset UX & Replay — "Apakah pemain mau main sekali lagi?"

**Status (2026-10-16):** dokumen riset dan rekomendasi. **Belum ada kode untuk item §5.**
Bukti playtest bot ada di `qa-evidence/ux-replay/` (`uxprobe.txt` dan `uxprobe.json`), dan bisa diulang dengan
`node tools/survival-uxprobe.mjs`. Belum ada playtest manusia, jadi semua verdict di bawah adalah
penilaian desain + bot, **bukan** hasil uji pemain.

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

---

## 1. Metode

**Sumber review:**
- Google Play: Duck Survival, Survivor.io.
- Steam: Thronefall, Kingdom Two Crowns, Dome Keeper.
- Reddit: r/VampireSurvivors, r/gamedev, r/Survivorio, r/MobileGaming, r/domekeeper, r/patientgamers, r/iosgaming.
- HowLongToBeat, Metacritic, App Store (Brotato), Uptodown, AppGamer.

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

### P1 — "Alasan untuk kembali"

| ID | Apa | Kenapa (riset) | Ukuran berhasil |
|---|---|---|---|
| R7 | **Tingkat Siege I–V**, terbuka berurutan setelah menang. Tiap tingkat mengubah aturan secara **terlihat**: lebih banyak breaker, pelari cepat, gold awal lebih sedikit, dua gerbang serentak. | U3: Brotato Danger 0–5, Kingdom Rush Heroic/Iron, VS hyper mode | Bot builder menang Siege I, kalah di Siege V |
| R8 | **Variasi gerbang per run** (seeded) + **sifat horde per malam** diumumkan di senja ("RUNNERS TONIGHT", "BREAKERS AT THE WEST GATE"). Gelombang 1 malam 1 tetap gerbang yang mudah dicapai. | U4: keluhan nomor satu Duck Survival "same round… rotate the direction" | ≥ 3 urutan gerbang berbeda dalam 5 seed; FTUE tidak berubah |
| R9 | **Jalur unlock yang terlihat di panel akhir** ("2★ more: STONE BALLISTA"). Bintang/tingkat membuka varian bangunan, senjata kapten, atau warna panji. **Bukan** kartu acak. | U2 + transparansi: "players should clearly understand what they're working toward" (Entalto) | Setiap panel akhir menunjukkan unlock berikutnya |
| R10 | **Pacing malam lebih padat**: selipkan gerombolan kecil di antara 3 gelombang besar. | U6: target 48–72 % | Target ≥ 75 % untuk bot builder |
| R11 | **Commander's Orders** (opsional): mutator yang dipilih *sebelum* run (pola Thronefall) untuk ★ tambahan, mis. "NO BARRICADE", "HALF GOLD", "BLOOD MOON +30 %". Dipilih sadar, bukan acak. | U3: mutator Thronefall menambah skor/replay | Dipakai ≥ 1× oleh penguji yang sudah menang |

### P2 — QoL

| ID | Apa | Kenapa |
|---|---|---|
| R12 | Toggle suara / musik / getar di PAUSE | QoL dasar mobile; banyak yang main tanpa suara |
| R13 | Antre build (tap lingkaran berikutnya saat builder bekerja) atau waktu build 3–4 s | kerja builder ±34 s di hari 2 dengan satu antrean; K2C dikeluhkan "too much waiting" |
| R14 | "TRY NIGHT 3 AGAIN" (checkpoint dawn terakhir, bintang maksimal −1) | kalah di malam 3 = mengulang ±3,5–4 mnt yang identik |
| R15 | Kamera malam sedikit melebar saat horde berkumpul di gerbang (cek perf) | U6: tontonan horde |
| R16 | Batal build terakhir hari itu (refund penuh) | K2C: "you cannot go back on any mistakes when building" |

### Anti-pola yang harus dihindari (dari review)

- **Energi / batas main:** "Why stop me from playing if I have the time".
- **Iklan paksa dan tombol X palsu:** 58 % langsung keluar.
- **Red dot / login chores:** "500 red dots".
- **Tembok P2W dan lonjakan kesulitan** yang memaksa membayar.
- **Kartu skill acak** (keluhan "frustratingly random" di Survivor.io, dan sudah ditolak di proyek ini).
- **Grind meta sebelum bisa menang:** Brotato dipuji karena "no initial grinding… before you are able to win".

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

**Desain layar kalah & roguelite:**
- r/gamedev — https://www.reddit.com/r/gamedev/comments/1is8ag2/were_working_on_our_death_screen_and_really/
- Entalto Studios — https://entaltostudios.com/5-essential-tips-to-make-your-roguelite-game-work/
- r/gamedev (energi & iklan) — https://www.reddit.com/r/gamedev/comments/1kdbuje/point_of_energy_that_is_often_seen_in_mobile_games/
