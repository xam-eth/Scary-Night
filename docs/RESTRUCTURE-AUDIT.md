# Audit & rencana perapian struktur (2026-10-21)

**Mandat user:** *"audit dulu semuanya debug dan pastikan tidak menghapus file
yang masih terpakai … code nya masih kurang tepat untuk dipindahtangankan atau
di sell … harus dirapikan struktur frameworknya dan dibuat system modular
setiap bagiannya … semua harus sesuai struktur real jangan berasumsi …
kebenaran harus dibuktikan dengan data dan fakta developer yang berpengalaman
… research struktur game yang benar."*

Dokumen ini = bukti + rencana. Semua angka dihasilkan
`tools/structaudit.mjs` (jalan kapan pun, output mentah
`docs/audit/struct-audit.json`); semua prinsip Struktur mengutip sumber
publik di §2. Tidak ada file yang dihapus tanpa baris bukti di
`docs/audit/REMOVALS.md`.

## 1. Keadaan terukur (sebelum perapian)

| Metrik | Nilai | Sumber |
| --- | --- | --- |
| File `src/**/*.js` | 48 | structaudit |
| LOC `src` | 45.592 | structaudit |
| File terbesar | survival.js 4.926; world3d.js 4.319; game.js 3.034; ui/screens.js 2.998; ui/survival.js 2.389; envkit.js 2.104; enemies.js 1.814 | structaudit |
| Fan-in tertinggi | core/util.js 23 importir; core/config.js 16; vendor three 10; game/economy.js 8; game/valen3d.js 8 | structaudit |
| Modul yatim | 0 (three.core.min.js sempat terlihat yatim — false positive import minified berkutip ganda; regex audit diperbaiki) | structaudit |
| Pelanggaran lapis | 6: core/util→game/economy; game/game→ui/screens; game/game→ui/survival; game/hud→ui/icons; game/hud→ui/components; shop/iap→game/economy | structaudit |
| Tools tanpa pemakai | 15 dari 40 (refs 0 di package.json/docs/chain/CI/tools lain) | structaudit |
| Aset tak terpakai | 0 (8 dir assets, 126 file, 100 % tereferensi) | structaudit |
| Sampah root | 5 zip ±101,7 MB (Godot engine + template export + 2 zip sumber aset yang ekstraknya sudah vendored) + 1 txt provenance | structaudit + REMOVALS.md |

## 2. Riset: struktur yang benar menurut sumber publik

1. **Repo game memisahkan kode inti, sistem reusable, aset, tools, docs.**
   Diskusi komunitas GitHub tentang struktur repo game menyimpulkan pembagian
   `/Game` (kode inti), `/Systems` (sistem reusable: AI, inventory, UI),
   `/Assets`, `/Tools`, `/Docs` [7](https://github.com/orgs/community/discussions/185913).
2. **Satu akar source, organisasi per fitur/domain, satu konvensi nama,
   config & aset terpisah dari source, test di luar build.** Checklist struktur
   2026 untuk project JS [9](https://xcodx.io/blog/best-practices/folder-structure-best-practices).
3. **Satu folder = satu axis organisasi; jangan campur axis type vs feature vs
   layer** [10](https://medium.com/@bolik/best-practice-software-architecture-principles-2026-7feca22f6cbe).
4. **"Flat sampai sakit":** project kecil mulai lapis datar; begitu domain
   bertambah, pindah ke modul per fitur dengan `shared/` untuk kode
   lintas-domain [17](https://vueschool.io/articles/vuejs-tutorials/how-to-structure-a-large-scale-vue-js-application/).
5. **Studio game menaruh sistem bersama di `Core/` dan mengelompokkan isi per
   fitur, bukan per tipe file** (konsensus sampel Epic & guide profesional)
   [13](https://sarahhyperdense.substack.com/p/project-organization-folder-structure);
   bin engine yang wajar: Graphics, Sound, Input, Platform, Math
   [12](https://gamedev.net/forums/topic/662317-standard-project-structure-layout/).
6. **Pola decoupling game** (Component, Observer, Event Queue, Service
   Locator) dari *Game Programming Patterns* (Nystrom) — decoupling berarti
   "dua potong kode bisa dipahami terpisah"; komponen berkomunikasi lewat
   state wadah atau event, bukan referensi langsung
   [1](https://gameprogrammingpatterns.com/component.html),
   [7](https://gameprogrammingpatterns.com/decoupling-patterns.html),
   [14](https://gameprogrammingpatterns.com/event-queue.html),
   [8](https://gameprogrammingpatterns.com/architecture-performance-and-games.html).

## 3. Temuan → keputusan (data → aksi)

| # | Temuan (bukti) | Keputusan | Fase |
| --- | --- | --- | --- |
| F1 | `src/game/` flat mencampur render-3D, simulasi, dan meta (26 file) | Pecah jadi `src/game/render3d/` (world3d, buildings3d, enemy3d, troop3d, valen3d, pack3d, crowd3d, envkit, lightbake), `src/game/sim/` (survival, economy, enemies, fortress, objectives, weapons, hunt, house, mansion, exterior, haunts), `src/game/meta/` (director, coach, narrative, climax, informant); `game.js` tetap composition root di `src/game/` | 2 (selesai) |
| F2 | 7 file > 1.800 LOC | Rencana seam pecah per file ditulis di `docs/ARCHITECTURE.md` §4; dieksekusi bertahap, tiap pecahan lewat rantai QA. Pecahan 1 selesai: seam (a) survival.js → `sim/waves.js` (jadwal malam murni, 145 LOC; harness check "F2 seam (a)"; structaudit delta 0). Pecahan 2 selesai: ui/screens.js → shell 18 baris + 10 modul per-screen (harness check "F2 seam screens"; permukaan 21 nama game.js utuh) | 3+ (berjalan) |
| F3 | 6 pelanggaran lapis | (a) `migrateSave` pindah ke `core/save.js` (core tak boleh impor game); (b) `hud.js` pindah ke `src/ui/hud.js` (hud = UI); (c) `shop/iap→game/economy` dibalik jadi event/interfacce tanpa mengubah perilaku shop (constraint user: shop/IAP tidak disentuh fungsinya); (d) `game.js→ui` didokumentasikan sebagai hak composition root | 2 (a/b/d selesai; c Fase 3) |
| F4 | 40 tools, 15 refs 0 | 15 tools + 1 probe di-`git mv` ke `tools/archive/` (outputnya sudah jadi evidence committed → reproducibility aman); katalog resmi di `tools/README.md`; rantai QA satu pintu direname ke `tools/chain.sh` | 1–2 (selesai) |
| F5 | 5 zip ±101,7 MB + txt provenance di root | Dihapus/dipindah dengan SHA tercatat di `docs/audit/REMOVALS.md` | 1 (selesai) |
| F6 | Tidak ada `package.json` root (hanya `tools/`) | Tambah `package.json` root tipis: scripts delegasi ke tools (qa, chain, devserver) supaya onboarding owner baru satu perintah | 3 |
| F7 | 12+ docs tanpa peta | `docs/ARCHITECTURE.md` jadi pintu masuk (peta modul, aturan lapis, kontrak, checklist handoff); index docs di README | 2 |
| F8 | Konvensi nama campur (suffix `3d` vs tanpa) | Didokumentasikan sebagai konvensi bermakna: suffix `3d` = modul render three.js; tanpa suffix = logika/simulasi; bukan rename massal | 2 |

## 4. Urutan fase & gerbang QA

- **Fase 1 (selesai):** archive tools scratch, buang binary root, provenance.
  Gerbang: structaudit delta (refs terpakai tetap 100 %), rantai QA BUILD 24.
- **Fase 2 (selesai, menunggu rantai final):** pemindahan folder modul
  (F1, F3a/b/d, F7, F8) — mekanis (rewrite import terverifikasi), gerbang:
  rantai QA penuh + structaudit; pelanggaran lapis turun 6 → 4 (3 hak
  composition root + 1 inversi shop yang terjadwal di Fase 3).
- **Fase 3:** pemecahan file raksasa per seam (F2), inversi shop→sim via event
  (F3c), package.json root (F6). Gerbang: rantai QA penuh per pecahan +
  harness/check baru per modul yang lahir.
  Progres: pecahan 1 (seam (a) survival.js → `sim/waves.js`) selesai
  2026-10-21; rantai penuh tercatat di `qa-evidence/phase3-f2a-waves/`.
  Pecahan 2 (ui/screens.js → per-screen modules) selesai 2026-10-21; rantai
  penuh tercatat di `qa-evidence/phase3-screens/`.
- **Fase 4:** checklist handoff/jual: inventory lisensi per pack aset
  (sudah ada per-pack LICENSE/credits + glbtest), CREDITS.md gabungan,
  onboarding README, tag rilis ber-stamp.

**Aturan keras pass ini:** tidak ada penghapusan tanpa baris bukti di
REMOVALS.md; tidak ada pemindahan tanpa rantai QA hijau sesudahnya; constraint
user lama tetap berlaku (landscape only, trailer dipertahankan, shop/IAP/server
tidak disentuh fungsinya, save di `save.survival`).
