# Status Rebuild 3D & Survival Milestone 1

**Pembaruan:** 2026-10-12 (Asia/Makassar)
**Status keseluruhan: MASIH TERBUKA — bukan klaim siap rilis.** Inti rebuild dunia 3D dan loop Survival Milestone 1 sudah terimplementasi. Pada 2026-10-12, arah UI/UX dan threat model dikoreksi mengikuti feedback user (lihat bagian berikut), dan seluruh gate otomatis dijalankan ulang. Acceptance visual/manual di perangkat, playtest manusia, dan packaging Play masih terbuka. Hasil tiap skrip hanya berlaku untuk cakupan yang benar-benar diuji.

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
- **Ekonomi/building:** Oil dan Wood; Extractor, Sawmill, Shelter, gate, serta upgrade Perapian sampai Lv3. Queue hanya mengerjakan satu job pada satu waktu. Produksi bangunan dan reward malam mengubah resource/survivor.
- **Perapian/cahaya:** radius dasar bertingkat di tuning (Lv1 980, Lv2 1760, Lv3 2500 world px). Di cahaya Perapian, musuh melambat (`lightMoveMul = 0.7`), lebih mudah dilukai (`lightDamageTakenMul = 1.75`), tidak bisa menyerang Hunter, dan damage ke pintu menjadi 50%.
- **Defense:** gelombang Swarm 21/21/24, 24/27/27, 30/30/30 (aktual = diminta; 66/78/90 per malam), HP Swarm 48→54→60, Breaker 0/1/2, dua Individual per malam. Hunter punya auto-shot dan skill Flare dengan radius/damage/stagger/cooldown.
- **HUD:** lihat "UI icon-first" di atas. Coach/narrative legacy disembunyikan.

## QA yang benar-benar dijalankan (2026-10-12)

| Perintah | Hasil | Batas hasil |
|---|---|---|
| `node tools/harness.mjs` | **PASS**, exit 0. Gelombang 21/21/24 → 24/27/27 → 30/30/30, aktual 66/78/90 (tanpa clamp), HP 48→54→60, Breaker 0/1/2. Cahaya: damage 17.5 vs 10, jalan breached 48 vs 86 px/dtk (melambat, bukan freeze). **Baru:** pintu tertutup memblok di 5 titik sepanjang lebarnya; damage pintu lit 10 vs dark 20 (50%); breach → nav refresh → body mencapai Perapian dalam 21.3 dtk, mencakar 3 Oil, Oil habis → `failed (THE FIRE WENT OUT)`; Breaker frontDoor → cellarDoor → perapian. Gerak 4 arah, Breaker tetap ke wall saat Hunter terlihat, auto-shot (LOS stub & LOS nyata), Flare 500→442 + cooldown, save/reload Day 2, ekonomi +20 Oil/+21 Wood/survivor 3 tetap PASS. **Balance:** idle (tanpa input/build) gagal di Night 2 karena api padam; builder aktif (bot stick + Flare lewat Input, Perapian Lv3) menang Night 3. Harness legacy mencapai dawn 300 dtk tanpa runtime error. | Bot deterministik, bukan pemain manusia. Durasi malam uji 60 dtk. Save test sengaja menjaga Oil agar mengisolasi persistence dari balance. |
| `node tools/survival-balance.mjs --seeds=3 --duration=72` (baru) | Pengukuran, bukan gate. idle 0/3 menang (gagal Night 1 ±68.7 dtk); flare-only 0/2 (lolos Night 1, gagal Night 2); active tanpa build 2/3; builder aktif 3/3. | Bot sempurna/deterministik; seed hanya mengubah jitter spawn. |
| `node tools/envqa.mjs --mode=3d-smoke` | **PASS**, exit 0, 40 assertion PASS, page errors 0. Rumah 3D (11 ruang, 628 instance, jendela/pintu) seperti sebelumnya. FTUE: Swarm 0/21/38 pada 0.2/15/30 dtk, 14 GLB + 24 silhouette, HUD tap target hanya `PAUSE`, radius 980 → 1760 lewat tombol `UPGRADE` UI baru. **Baru:** luma playfield Night 1 = **74.9/255, 12.8% near-black** (baseline sebelum koreksi 1.4/255, 99.6%). | Chromium headless/software WebGL, bukan perangkat Android/iOS nyata. |
| `node tools/survivalshots.mjs --tag=after` (+ `--landscape`) (baru) | Bukti before/after di `qa-evidence/survival-rebuild/` (diperkecil 50%). Luma playfield: Night 0/20/40 dtk 1.4/1.4/1.4 → 70.5/72.5/67.7; panel siang 10.7 → 122.1; near-black 99.5% → ≤15.8%. Alur night → popup fajar → sheet Perapian → pilih slot → build → night 2 → gagal tertangkap tanpa page error, portrait dan landscape. | Screenshot headless; bukan review perangkat atau rekaman. |
| `node tools/layoutqa.mjs` | **PASS**, exit 0 (route legacy + layout; gate full-3D, decor, kontrol, pintu, pickup/VFX, enemy/haunt, desktop boot, browser errors). | Overlap staircase–stairRail ±150×20 px masih tercatat (audit, bukan gate). |
| `node tools/glbtest.mjs` | **PASS**, exit 0. | Validasi asset/kode statis. |
| `node --check` seluruh `src/**/*.js` non-vendor, `tools/*.mjs`, `sw.js`; `git diff --check` | **PASS**. | Sintaks/diff saja. |
| `npm audit --prefix tools` | **PASS**, 0 vulnerability. | — |
| `node tools/bundle.mjs check` | **FAIL** (tidak berubah): fingerprint SHA-256 Digital Asset Links masih placeholder; WARN token origin-trial Digital Goods. | Butuh kredensial/konfigurasi release; IAP di luar scope. Catatan: `manifest.webmanifest` menyetel `orientation: landscape`, sedangkan QA/UI Survival portrait-first — perlu keputusan produk. |

**Build:** repo tidak memiliki `package.json` root atau script `npm run build`. Dependensi QA dipasang dengan `npm ci --prefix tools`; pemeriksaan bundle di atas bukan build Android/AAB yang sukses. Jangan menyebut paket release selesai.

## Bukti visual

- `qa-evidence/survival-ftue-00s.png`, `-15s.png`, `-30s.png`, `survival-ftue-first-30s.json` (envqa; viewport 390×844 @2x; JSON kini memuat luma checkpoint 15 dtk).
- `qa-evidence/survival-rebuild/` — before (gelap, UI teks) vs after (terang, UI ikon): `before-night-40s.png`, `before-day-panel.png`, `after-night-40s.png`, `after-day-reward.png`, `after-day-panel.png`, `after-day-select.png`, `after-day-build.png`, `after-failed.png`, serta `before-metrics.json`/`after-metrics.json`.

Ini screenshot checkpoint, bukan rekaman 30 detik, dan bukan review di perangkat fisik.

## Acceptance yang masih terbuka

1. **FTUE/readability:** dunia kini terang dan terbaca di screenshot headless (luma diassert di envqa), UI berbasis ikon, chip hint kontekstual ada. Belum: review di perangkat nyata, uji pemahaman pemain baru, rekaman 30 detik.
2. **Combat Survival manual:** bot harness/balance menggerakkan stick virtual dan Flare melalui Input; walkthrough manusia dengan joystick sentuh (gerak, Flare, mempertahankan Perapian) belum dilakukan.
3. **Light weakness:** damage musuh, perlambatan (tanpa freeze), larangan attack saat lit, **dan damage pintu lit 50%** kini diassert. Rasa/feel di perangkat belum dinilai.
4. **Balance/progression:** target bot terpenuhi (idle kalah karena api padam; builder aktif menang 3/3 pada 72 dtk). Belum ada playtest manusia; Night 3 untuk builder yang baik mungkin terlalu ringan karena hearth burn Lv3 — perlu dinilai pemain nyata.
5. **Visual pass:** sweep 17 stop per ruang/wing, state low-health/blackout, dan overlap staircase–stairRail belum selesai. Pohon siang tampak agak pucat (palet dinaikkan untuk readability) — kandidat polish.
6. **Perangkat/performa:** frame time 66–90 musuh per malam di perangkat low-end, DPR, hidden-tab resume, WebGL context-loss/restore, serta keputusan orientasi (manifest landscape vs QA portrait) belum diuji/diputuskan. Layout landscape sudah dirender di screenshot headless.
7. **Release bundle:** fingerprint signing SHA-256, token origin-trial, validasi Bubblewrap/AAB, uji TWA/Play tetap menunggu konfigurasi release. IAP tidak diubah.

## Aturan laporan

- Laporkan implementasi dan acceptance terpisah. PASS di atas hanya PASS untuk assertion perintah terkait.
- Jangan menyebut rebuild/M1 “selesai” atau “siap rilis” sampai acceptance terbuka diverifikasi dan packaging punya bukti sendiri.
- Pertahankan `?legacy=1` sebagai akses QA/komparasi. Hapus legacy route atau sistem lama hanya dengan keputusan scope eksplisit.
- Pertahankan pipeline WebGL mansion/lampu serta provenance asset; jangan re-export atau mengubah byte sumber berlisensi tanpa izin.
