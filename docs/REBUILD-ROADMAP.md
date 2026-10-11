# Status Rebuild 3D & Survival Milestone 1

**Pembaruan:** 2026-10-11 (Asia/Makassar)
**Status keseluruhan: MASIH TERBUKA — bukan klaim siap rilis.** Inti rebuild dunia 3D dan loop Survival Milestone 1 sudah terimplementasi, dan seluruh gate otomatis yang dijalankan ulang di bawah lulus. Acceptance visual/manual, balance lintas perangkat, dan packaging Play masih terbuka. Hasil tiap skrip hanya berlaku untuk cakupan yang benar-benar diuji.

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

## Implementasi Survival M1 yang ada

- **Loop:** tiga malam dengan fase day/night, reward malam, builder queue, save/checkpoint `day`/`phase`, serta keadaan akhir complete/failed.
- **Ekonomi/building:** Oil dan Wood; Extractor, Sawmill, Shelter, gate, serta upgrade Perapian sampai Lv3. Queue hanya mengerjakan satu job pada satu waktu. Produksi bangunan dan reward malam mengubah resource/survivor.
- **Perapian/cahaya:** radius dasar bertingkat di tuning (Lv1 980, Lv2 1760, Lv3 2500 world px). Di cahaya Perapian, musuh melambat (`lightMoveMul = 0.46`), lebih mudah dilukai (`lightDamageTakenMul = 1.75`), dan damage tertentu ke pintu berkurang.
- **Defense:** parameter gelombang yang diminta per hari adalah 7/7/8, 8/9/9, 10/10/10. Namun `spawnSwarm` menerapkan minimum 20 body per gelombang, sehingga hasil aktual tetap 60 Swarm per malam; eskalasi aktual lain yang terukur ialah HP Swarm 48→54→60 dan Breaker 0/1/2 (ditambah dua Individual per malam). Belum diputuskan apakah minimum 20 ini memang desain atau parameter wave seharusnya memengaruhi jumlah body. Hunter punya auto-shot dan skill Flare dengan radius/damage/stagger/cooldown.
- **HUD:** route Survival menampilkan Night/time, Oil/Wood, level Perapian, pause, dan kontrol sentuh. Coach/narrative legacy disembunyikan. Tes FTUE di bawah membuktikan layar permainan aktif dan HUD pada 0/15/30 detik; tes itu **tidak** membuktikan readability manual, teks tutorial terpandu, atau pemahaman pemain baru.

## QA yang benar-benar dijalankan (2026-10-11)

| Perintah | Hasil | Batas hasil |
|---|---|---|
| `node tools/harness.mjs` | **PASS**, exit 0. Deterministic three-day probe: parameter gelombang 7/7/8 → 8/9/9 → 10/10/10 terverifikasi, tetapi spawner aktual menghasilkan 60 Swarm/malam (20 per wave), HP 48→54→60, Breaker 0/1/2; empat arah input keyboard M1 melewati Player update di dining (right/left/down/up = 131.4/147.2/164.4/143.6 world px dalam 1.5 detik); Perapian membandingkan damage musuh 17.5 vs 10, speed 26.68 vs 58, dan attack diblokir hanya saat lit; Breaker mempertahankan target frontDoor; auto-shot diuji dengan LOS stub dan satu hit pada target sintetis memakai `hasLOS`/collision mansion aktif (ruang dining); Flare menurunkan target 500→442 HP dan cooldown mencegah pemakaian ulang; save/reload kembali ke Day 2/day (1/3 malam, durasi uji 60 detik); Extractor/Sawmill/Shelter selesai dan memberi +18 Oil/+21 Wood serta survivors 3; Perapian naik Lv1→Lv3; Night-3 builder/idle probe selesai. | Pergerakan adalah input keyboard sintetis dari satu tile yang dipilih collision-clear; bukan uji joystick sentuh/manusia. Target combat sintetis dan LOS positif dipilih di ruang kosong; bukan walkthrough menembak melalui obstacle atau combat melawan crowd GLB. Perbandingan damage pintu lit/unlit belum diassert. Builder-vs-idle bukan uji balance pemain nyata. Harness legacy terpisah mencapai dawn pada 300 detik tanpa runtime error. |
| `node tools/glbtest.mjs` | **PASS**, exit 0. Rig Hunter, enam tipe musuh, mapping animasi, cap 14 rig, 21 asset kit, lisensi/provenance, serta tidak adanya painter Canvas/fallback yang diuji. | Validasi asset/kode statis; bukan inspeksi visual semua kombinasi combat. |
| `node tools/envqa.mjs --mode=3d-smoke` | **PASS**, exit 0. 11/11 ruang, 26 portal, 251 floor, 99 wall, 32 corner, 9 window; 628 instance aktif termasuk 140 arsitektur, tanpa instance tersembunyi atau perubahan transform saat melewati 6 anchor; sembilan jendela dan tujuh pintu (hinge/swing 90°, collision/LOS/shadow) lulus. Route default masuk Night 1; checkpoint FTUE 0.2/15/30 detik mencatat Swarm 0/20/40, durasi malam 72 detik, HUD aktif, dan radius Perapian bertambah 980→1760 setelah upgrade UI. Browser page errors = 0. | Smoke browser/Chromium dan framebuffer, bukan perangkat Android/iOS nyata atau sweep visual 17 stop. Tes cahaya dan AI di mode Survival belum menjadi assertion terpisah untuk setiap nilai. |
| `node tools/layoutqa.mjs` | **PASS**, exit 0. Mode QA legacy dibuka eksplisit lewat `?legacy=1`; full-3D gate, decor state, keyboard movement, pintu, pickup/VFX, enemy/haunt scene, desktop boot, browser errors, fit/collision audit lulus. Pemeriksaan melihat 11 ruang/26 portal, proyeksi 0.0000 px, floor raycast 0.0000 world px, 0 pemanggilan Canvas world, dan 0 metode paint Mansion lama. | Ini gate route legacy + layout, bukan walkthrough Survival M1. Audit menemukan satu overlap staircase–stairRail sekitar 150×20 px; reachable room area terukur 77–95%. |
| `node --check` untuk seluruh `src/**/*.js` non-vendor, `tools/*.mjs`, `sw.js`; `git diff --check` | **PASS**. | Pemeriksaan sintaks/diff saja. |
| `npm audit --prefix tools` | **PASS**, 0 vulnerability setelah menghapus dependency dev yang tidak digunakan. | Tidak menggantikan audit backend/Play. |
| `node tools/bundle.mjs check` | **FAIL**, satu assertion: 0/1 Digital Asset Links fingerprint valid (butuh SHA-256 signing key nyata). Ada WARN bahwa Digital Goods origin-trial token belum diisi; Bubblewrap tidak terpasang. | Blocker release Play/IAP yang memerlukan kredensial/konfigurasi release; tidak diubah karena IAP di luar scope. Bukan kegagalan gate gameplay. |

**Build:** repo tidak memiliki `package.json` root atau script `npm run build`. Dependensi QA dipasang dengan `npm ci --prefix tools`; pemeriksaan bundle di atas bukan build Android/AAB yang sukses. Jangan menyebut paket release selesai.

## Bukti visual FTUE

`node tools/envqa.mjs --mode=3d-smoke` menghasilkan bukti baru pada viewport mobile 390×844, deviceScaleFactor 2:

- `qa-evidence/survival-ftue-00s.png`
- `qa-evidence/survival-ftue-15s.png`
- `qa-evidence/survival-ftue-30s.png`
- `qa-evidence/survival-ftue-first-30s.json` — waktu/state, HUD, resource, jumlah Swarm/rig, radius api, serta nama screenshot.

Ini **tiga checkpoint screenshot**, bukan rekaman 30 detik. Review visual atas artefak menunjukkan HUD amber (Night/timer, Oil/Wood, Perapian, pause, serta ikon stick/skill) terbaca, tetapi dunia mansion nyaris tidak terbaca pada ketiga frame Night karena sangat gelap. Tidak tampak petunjuk onboarding berbentuk teks/coach; hanya HUD dan ikon kontrol. Ini temuan dari screenshot headless, bukan review perangkat fisik, dan tidak membuktikan rekaman 30 detik atau onboarding terpandu.

## Acceptance yang masih terbuka

1. **FTUE/readability:** screenshot sudah direview dan HUD/ikon kontrol terbaca, tetapi mansion terlalu gelap untuk dibaca dengan nyaman; tidak terlihat petunjuk teks/coach. Perlu review pada perangkat serta keputusan apakah requirement berarti HUD minimal atau onboarding terpandu. Rekaman 30 detik belum dibuat.
2. **Combat Survival manual:** input keyboard sintetis M1 kini PASS bergerak di empat arah dari tile collision-clear. Walkthrough pemain/joystick sentuh untuk gerak dan Flare, kill/death, serta interaksi Swarm/Breaker masih terbuka. Harness membuktikan auto-shot mengenai target sintetis baik pada LOS stub maupun dengan LOS/collision mansion aktif di ruang kosong; tembakan melalui/terhalang obstacle dan playtest pemain nyata belum dibuktikan.
3. **Light weakness:** assertion otomatis lit/unlit sekarang **PASS** untuk damage musuh (17.5 vs 10), speed yang dipilih pada jalur update musuh (26.68 vs 58; fungsi gerak di-spy), dan larangan attack saat lit. Pembandingan damage pintu lit/unlit, efek visual di perangkat, dan rasa/balance masih terbuka.
4. **Balance/progression:** loop deterministik selesai dan outcome Day 3 tercatat, tetapi belum ada playtest balance manusia. Ada keputusan desain yang perlu dikonfirmasi: bobot wave 7/8/10 meningkat pada argumen, namun minimum spawner membuat aktualnya 20 Swarm per wave di semua malam; eskalasi saat ini berasal dari HP Swarm dan jumlah Breaker. Belum ditetapkan apakah itu memang pacing yang dikehendaki atau jumlah Swarm seharusnya benar-benar meningkat. Kurva reward, ekonomi, Perapian, dan gate juga belum dinilai manusia.
5. **Visual pass:** sweep 17 stop/screenshot per ruang/wing, occlusion/darkness/readability low-health/blackout, seluruh state interaksi, dan review khusus layout overlap staircase–stairRail belum selesai.
6. **Perangkat/performa:** frame time, GPU/memory, perangkat low-end, landscape/orientation change, DPR, hidden-tab resume, serta WebGL context-loss/restore belum diuji.
7. **Release bundle:** fingerprint signing SHA-256, Digital Goods origin-trial token, validasi Bubblewrap/AAB, dan uji TWA/Play tetap menunggu konfigurasi release. Tidak mengubah IAP pada pekerjaan ini.

## Aturan laporan

- Laporkan implementasi dan acceptance terpisah. PASS di atas hanya PASS untuk assertion perintah terkait.
- Jangan menyebut rebuild/M1 “selesai” atau “siap rilis” sampai acceptance terbuka diverifikasi dan packaging punya bukti sendiri.
- Pertahankan `?legacy=1` sebagai akses QA/komparasi. Hapus legacy route atau sistem lama hanya dengan keputusan scope eksplisit.
- Pertahankan pipeline WebGL mansion/lampu serta provenance asset; jangan re-export atau mengubah byte sumber berlisensi tanpa izin.
