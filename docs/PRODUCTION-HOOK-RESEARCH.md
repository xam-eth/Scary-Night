# Riset Production-Readiness & Hook Pembuka (v1, 2026-10-19)

**Pertanyaan yang dijawab:** (1) apakah game-nya sendiri sudah siap production,
(2) apakah hook di awal cukup kuat mempertahankan user. **Metode:** benchmark
retensi 2025/2026, bedah desain game pembanding yang relevan (survivor-like,
minimalist TD, lane TD, mobile best-practice), lalu audit detik-per-detik
terhadap kode DUSKHOLD sendiri. Semua verdict di sini **verdict desain + bot**:
angka manusia menunggu playtest (lihat protokol di §6 riset UX).

---

## 1. Angka pasar: batas yang harus dilewati

| Kohor | D1 | D7 | D30 | Sumber |
|---|---|---|---|---|
| Median semua game (11.600 judul, GameAnalytics 2025) | ~22 % | 3,4–3,9 % | 0,7–0,8 % | [gameanalytics](https://www.gameanalytics.com/reports/2026-mobile-pc-gaming-benchmarks), [gamegrowthadvisor](https://gamegrowthadvisor.com/blog/2026-03-17-mobile-game-retention-strategies-2026/) |
| Top quartile | 25–27 % (Android) | 7–8 % | 1,6–1,8 % | sama |
| Top 1 % | 64–68 % | 25 %+ | 13–15 % | sama |
| **Genre strategy** | **25,4 %** | **8,1 %** | **3,1 %** | [segwise](https://segwise.ai/blog/mobile-gaming-app-user-retention-strategies), [digitalmindsbpo](https://digitalmindsbpo.com/blog/mobile-game-retention-benchmarks/) |
| Mid-core/strategy "tier baik" | 35–45 % | 15–22 % | 8–12 % | [appagent](https://appagent.com/blog/mobile-game-retention-benchmarks/), [vmobify](https://vmobify.com/blog/app-retention-benchmarks) |

Konsekuensi: DUSKHOLD (strategy) harus mengalahkan **22 % D1** hanya untuk
satunya median, dan **25,4 %** untuk rata-rata genrenya. Di mana pertarungan itu
dimenangkan?

- **Hari 0, menit 0–10.** Data Google Play Developer: performer terburuk
  kehilangan **46 % install di menit ke-5** dan 58 % di menit ke-10; performer
  terbaik hanya 17 % / 24 %. Dua anti-pattern: "flats" (retensi datar sampai
  menit 5–10 → fun datang terlambat) dan "gorge" (turun dulu beberapa menit,
  baru naik) ([Play Dev, "Why the first ten minutes are crucial"](https://medium.com/googleplaydev/why-the-first-ten-minutes-is-crucial-if-you-want-to-keep-players-coming-back-to-your-mobile-game-4a89031b6308)).
- **First session yang selesai.** Pemain yang menuntaskan sesi pertama yang
  bermakna 3–4× lebih mungkin kembali di D2; target industri: core gameplay
  < 60 dtk, momen "aha" < 90 dtk, tur first-run ≤ 2 langkah, FTUE completion
  > 80 % ([playio](https://blog.playio.co/mobile-game-onboarding-retention),
  [deepgamedive](https://www.deepgamedive.com/blog/retention-is-everywhere.html)).
- **Strategi keluar di D14–30 pada plateau progresi** — bukan di hari pertama
  ([gamegrowthadvisor](https://gamegrowthadvisor.com/blog/2026-03-17-mobile-game-retention-strategies-2026/)): artinya hook awal membeli D1, tetapi **isi
  progresi** yang membeli D7/D30.

## 2. Bedah game pembanding

### Vampire Survivors — raja "one more run"
- **Instant action:** pilih karakter → langsung jalan, musuh muncul; tanpa
  tutorial panjang; level-up pertama dalam 1–2 menit = pilihan nyata sebelum
  hook sempat aus ([kokutech](https://www.kokutech.com/blog/gamedev/design-patterns/power-fantasy/vampire-survivors)).
- **Unlock terlihat dari menu:** layar Collection & Unlocks tampak sebelum run
  pertama selesai — posibilidad space dipamerkan di depan hidung ([playcritically](https://playcritically.com/2023/01/18/vampire-survivors-review/)).
- **Kegagalan tetap membayar:** mati di menit 12 tetap membawa gold + progres
  unlock; sesi pendek tidak pernah terasa sia-sia ([delayedrespawnse](https://delayedrespawnse.com/blog/does-vampire-survivors-respect-your-limited-play-time/)).
  Pemain menyebut persis ini sebagai alasan bertahan: "constant unlocks… every
  run lets me check one more box" ([reddit](https://www.reddit.com/r/VampireSurvivors/comments/1khkit6/what_makes_vampire_survivors_so_addictive_for_you/)).
- Run 15–30 menit = sesi selesai alami, selalu ada "satu kotak lagi".

### Thronefall — minimalisme yang meng-layer
- Kompleksitas di-layer perlahan: level 1 = tutorial yang tidak terasa; sistem
  baru masuk hanya di level belakang sehingga onboarding tidak pernah berubah
  ([gamedeveloper](https://www.gamedeveloper.com/design/mastering-minimalism-and-layering-complexity-with-strategy-game-thronefall)).
- **Pilihan direduksi sengaja:** pemain tidak memilih *apa & di mana* (slot
  fixed), hanya *kapan/urutan* — beban kognitif turun, keputusan tetap bermakna.
- **Forgiving by design:** bangunan respawn gratis tiap pagi (tapi tak berincome
  saat baru respawn) — frustrasi dikurangi tanpa menghapus stakes.
- Loop siang-bangun/malam-bertahan yang sama persis dengan DUSKHOLD; review
  memuji legibility: semua terbaca sekilas ([siliconera](https://www.siliconera.com/review-thronefall-is-a-beautifully-simplistic-rts-game/)).

### Kingdom Rush — kurikulum kampanye
- ~10 level pertama pada dasarnya tutorial: satu mekanik baru per level, popup
  tepat saat tipe musuh baru muncul ("just-in-time"), peta dengan lane/pad/choke
  yang terbaca sendiri ([gamedeveloper campaign design](https://www.gamedeveloper.com/design/kingdom-rush---the-wonderful-campaign-level-design),
  [towerward](https://towerward.com/blog/best-tower-defense-games-for-beginners)).
- Readability > depth untuk pemula: pemain selalu bisa menjawab "apa yang harus
  saya lakukan sekarang" dari lingkungan, bukan dari teks.

### Aturan main mobile yang terukur
- **40-second rule** Fortnite mobile: keputusan bermakna tiap ±40 dtk; sesi
  3 menit terasa puas, 30 menit terasa kaya; breakpoint alami sering
  ([Epic](https://dev.epicgames.com/documentation/fortnite/designing-for-mobile-in-fortnite)).
- Onboarding = value demonstration, bukan manual; interactive > passive; skip
  untuk veteran ([vitex](https://vitex.asia/losing-97-of-players-5-retention-strategies-that-work/),
  [loungelizard](https://www.loungelizard.com/blog/3-ways-to-boost-your-mobile-game-ux/)).
- **Cutscene:** tahap intro video punya churn per-detik tertinggi di seluruh
  FTUE — perpendek, beri skip, atau hapus; cutscene wajib-tonton ulang = churn
  trigger bagi returning player ([medium data-science](https://medium.com/data-science/incremental-data-science-for-mobile-game-development-955bb059e8a6),
  [bugnet](https://bugnet.io/blog/how-to-measure-and-reduce-tutorial-drop-off)).

## 3. Audit detik-per-detik pembukaan DUSKHOLD (dari kode)

| t | Yang terjadi | Sumber |
|---|---|---|
| 0:00 | menu → PLAY; run mulai langsung di **malam 1** | `survival.js` restart/phase |
| 0:00–0:07 | intro cine 7,2 dtk, 3 caption (PROTECT THE KEEP / THE HORDE COMES AT NIGHT / YOU ARE THE CAPTAIN), horn di 5,2 dtk; **tap skip aktif sejak 0,35 dtk**; dimainkan tiap run | `CINE.intro`, `_wantsIntro` |
| ~0:03 | handover kendali: elapsed diset ke mark gelombang 1 → **horde sudah di gerbang saat stick hidup** | `_startIntro` |
| ~0:05–0:15 | kill pertama: auto-shot kapten + burst + angka damage (early win terbaca) | fx QA |
| ~1:12 | malam 1 selesai (72 dtk) → kartu reward fajar (ack) | wave times |
| hari 2 | **bangun pertama**: gold awal 38 + income; lingkaran "WALK INTO A CIRCLE TO BUILD"; hint narator just-in-time; hari **tanpa timer** (pemain yang menekan NIGHT) | tuning, ui |
| malam 2 | chip TONIGHT mengumumkan urutan gerbang + isi; rotasi berseed per run | B17 |
| malam 3 → fajar | cine kedatangan 7 dtk → panel akhir: bintang 1–3, MVP, rekor/NEW BEST, baris tangga watch (B19) | B16/B19 |
| kalah | panel kalah: track malam, "Ns TO DAWN", satu tip dari penyebab nyata, baris tangga tetap ada | R4/B19 |

### Skor terhadap 10 kriteria riset

| Kriteria riset | DUSKHOLD | Catatan |
|---|---|---|
| input pertama < 60 dtk | **✓** | 0,35 dtk bila skip; 7,2 dtk bila ditonton — jauh di bawah batas |
| early win < 3 menit | **✓** | kill pertama ±10 dtk setelah handover, feedback lengkap |
| satu tujuan visual jelas di 30 dtk pertama | **✓** | caption + badge gerbang + Keep di tengah frame |
| teach-by-doing, hint just-in-time | **✓** | lingkaran BUILD, hint narator per mekanik; tanpa dinding teks |
| skip path untuk veteran | **✓** | cine skip; tapi cine **utuh 7,2 dtk ditawarkan tiap run** (lihat H4) |
| progresi terlihat SEBELUM run pertama selesai | **✗** | tangga watch + rekor hanya muncul di panel akhir (menit 5–10); tidak ada layar Collection/Unlocks ala VS; menu tidak memamerkan possibility space |
| kegagalan tetap membayar | **≈** | rekor + tip + nights di record ya; tetapi `survivalStars(won=false)=0` → **kalah menabung 0 bintang**, tangga beku sampai menang pertama — persis kebalikan aturan VS |
| panjang sesi alami 3–10 menit | **✓** | satu run ±6–10 menit; hari tanpa timer = breakpoint ramah |
| variasi antar-run | **✓** | rotasi gerbang berseed (R8); balance 5 seed terukur |
| alasan kembali besok | **≈** | tangga 9★ + NEW BEST + rotasi; tanpa sasaran jangka pendek yang terlihat (daftar "next goal"), tanpa daily |

**Verdict hook:** pembukaan DUSKHOLD sudah lolos 6 dari 10 kriteria dengan margin
besar (kecepatan, early win, readability, skip) — di atas anti-pattern "flats"
dan "gorge". Tiga lubang yang menahan di atas median genre: **progresi tak
terlihat sampai run berakhir**, **kalah tidak menggerakkan tangga**, dan
**biaya ulang cine** bagi returning player. Ketiganya murah diperbaiki
(H1–H4 di bawah) dibanding menulis ulang pembukaan.

## 4. Matriks production-readiness

| Aspek | Status | Catatan |
|---|---|---|
| Stabilitas / regressi | **kuat** | 85 cek harness + 33 plotsqa + 16 fxshots + 25 devqa + 230 map + sw/env/layout/glb — semua otomatis, berseed, replayable |
| Performa low-end | **belum terukur di perangkat nyata** | riset v3 menguji secara teori; VAT + KayKit ringan, tapi fps/pacing di HP kelas bawah Indonesia = tugas playtest perangkat |
| Isi untuk D7/D30 | **tipis** | 3 malam, ±7 bangunan, 4 tier watch, 6 rotasi; genre menuntut dinding unlock (VS) atau kampanye level (KR); backlog R7/R10/R11 adalah jawaban yang sudah ada |
| Monetisasi | **rail siap, isi setengah** | katalog IAP terdefinisi (coat, revive, dawnbreaker, remove_ads) + rail Digital Goods; **token origin-trial belum ditempel**; dan `remove_ads` menjual sesuatu yang **belum ada** (tidak ada ads di game) — harus diisi atau dihapus sebelum review |
| Kebijakan Play | **proses menunggu pemilik** | closed testing 12×14 hari, verifikasi developer ID (30 Sep 2026), data-safety local-only, privacy page ada |
| Analytics / funnel FTUE | **tidak ada** | tidak ada telemetri → funnel first-session tidak terukur di produksi. Pilihan: tetap tanpa telemetri (privacy stance) dan mengukur lewat protokol playtest + bot probe; atau opt-in anonim kecil. Rekomendasi: **tanpa telemetri produksi dulu**, perkuat probe bot |
| Store listing | **siap** | teks, 6 screenshot 16:9, feature graphic, icon; video preview belum ada (usul: rekam dari puppeteer) |
| Acceptance manusia | **belum ada** | semua verdict di repo ini desain+bot sampai playtest pertama |

**Verdict production:** *belum siap production*, dengan blocker yang semuanya
sudah terdaftar: (P1) playtest perangkat low-end, (P2) keputusan telemetri,
(P3) kejujuran `remove_ads`, (P4) proses Play (token, closed test, verifikasi
ID), (P5) kedalaman isi D7. Tidak ada blocker teknis tak terduga — pipeline,
save, SW freshness, dan packaging sudah beres.

## 5. Rekomendasi (prioritas dampak retensi / biaya)

**Hook:**
- **H1 — kekalahan tetap membayar (paling penting, murah).** Kalah menabung
  bintang sebesar malam yang bertahan (`nightsCompleted`, 0–2), menang tetap
  1–3. Tangga selalu bergerak setiap run = aturan VS; baris panel menyebut
  sumbernya ("+2 NIGHTS HELD"). Ukur: bot probe — ladder total naik pada run
  kalah; perasaan "run sia-sia" hilang di playtest.
- **H2 — progresi terlihat sebelum run berakhir.** Layar PAUSE (dan panel
  akhir) memuat tangga watch lengkap: tier sekarang, warna berikutnya, sisa
  bintang, dan siluet tier terkunci — layar "Unlocks" mini ala VS tanpa konten
  baru. Murah: data sudah ada (`unlockSummary` + `UNLOCK_TIERS`).
- **H3 — rantai sasaran run pertama. (TERBANGUN BUILD 22, 2026-10-20;**
  harness 94/94 + plotsqa §14; playtest manusia masih terbuka**)** Tiga langkah
  bercentang di hari 2 (bangun mine → bangun tower → tahan malam 2) sebagai
  hint chain yang naik tingkat otomatis; memberi "satu tujuan visual"
  lanjutan setelah caption intro habis.
- **H4 — aturan ulang cine (butuh persetujuan user).** Trailer pembuka tetap
  ada dan utuh pada run pertama per save (permintaan user dihormati); run
  berikutnya memainkan versi pendek ±2,5 dtk (horn + satu caption) yang tetap
  bisa di-skip. Data: cutscene berulang = churn trigger returning player.
- **H5 — ceremonies kecil:** pop "+1★" ke tangga saat bintang dibank (kini
  hanya baris teks di panel akhir).

**Production:**
- **P1** playtest perangkat (protocol riset UX §6) + mode fps-budget bila perlu.
- **P2** putuskaan telemetri: rekomendasi tanpa telemetri produksi; tambah
  probe bot funnel first-session (step: cine-skip?, kill pertama?, build
  pertama?, selesai malam 1?, sesi 2?) sebagai pengganti.
- **P3** `remove_ads`: implement ads interstitial jujur ATAU hapus item dari
  katalog sebelum submit.
- **P4** ops Play: token origin-trial, closed testing, verifikasi ID.
- **P5** isi D7 dari backlog: R7 (Siege tier), R10 (pacing), rotasi tambahan —
  urutan diputuskan setelah playtest pertama.
- **P6** video preview store dari rekaman puppeteer (16:9, 30 dtk).

## 6. Mapping ke backlog

H1–H5 diajukan sebagai baris P1 baru di `docs/UX-REPLAY-RESEARCH.md`
(R20–R24); P1–P6 masuk catatan status riset ini + roadmap. Tidak ada kode yang
berubah oleh riset ini.
