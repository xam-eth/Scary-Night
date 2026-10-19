# DUSKHOLD — bagaimana game ter-update tanpa install/pack ulang

App-nya di Play **bukan isi game-nya**. Yang di Play (AAB/APK) hanya *shell*
Trusted Web Activity: sebuah wrapper Android yang membuka
`https://duskhold.zyvrolabs.com` fullscreen. Isi game — kode, asset, balance,
malam baru, UI — hidup di origin itu. Konsekuensinya ada dua jalur update,
dan yang sering dipakai tidak menyentuh Play sama sekali.

## Jalur A — isi game (hampir semua update): deploy web, selesai

```
edit kode/asset -> QA chain -> naikkan stempel BUILD + sw.js VERSION
-> commit/push -> bash tools/deploy-web.sh --live
```

Apa yang terjadi di perangkat pemain, tanpa mereka melakukan apa pun:

1. launch berikut, browser membandingkan byte `sw.js` dengan yang terpasang;
2. beda → service worker baru di-install (`duskhold-vNN`), `skipWaiting()`
   mempromosikannya segera, `activate` menghapus cache bernama versi lama;
3. shell + asset tertarik ulang ke cache baru — pemain berada di build baru
   pada **satu cold start**. Pemain yang sedang main menyelesaikan sesi di
   build lama dan pindah saat launch berikutnya (tidak pernah dipaksa di
   tengah permainan).

Tidak ada review Play, tidak ada reinstall, tidak ada `playpack.sh`.
Frekuensi: sesuka Anda — harian pun boleh.

Aturan keras jalur A (dua-duanya sudah dijaga `deploy-web.sh`):

- **VERSION wajib naik setiap byte yang harus terlihat pemain berubah.**
  `activate` hanya menghapus cache yang *namanya beda*; deploy isi baru di
  bawah VERSION lama = semua pemain kekal di shell lama. Script menolak
  deploy bila origin dan tree memakai VERSION yang sama.
- **Tidak ada secret di file web.** Preflight menjalankan `bundlecheck`
  (kunci/password/server key tidak boleh ikut terdeploy).

Yang ikut jalur A: malam/balance/bangunan/UI baru, asset GLB/tekstur,
perbaikan bug, `assetlinks.json`, token origin-trial, privacy policy,
screenshot? (tidak — asset listing Play tinggal di Play Console, jalur B
tidak needed untuk itu).

## Jalur B — shell Android (jarang): pack ulang + upload AAB

Baru Needed bila yang berubah ada di *sisi Android*:

| Pemicu | Contoh |
|---|---|
| `android/twa-manifest.json` | orientasi, warna tema/splash, minSdk, fitur billing, host tambahan |
| keamanan/lib | update Bubblewrap / androidbrowserhelper |
| deadline Play | kewajiban targetSdk tahunan (sekali setahun) |
| kebijakan package | versionCode wajib naik tiap upload |

Alurnya: `versionCode` +1 di `bundle.config.json` → `node tools/bundle.mjs prepare`
→ `bash tools/playpack.sh` → upload `.aab` (internal → closed → production) →
**Play Store memperbarui shell di perangkat pemain otomatis secara senyap**
(auto-update default). Jadi walau jalur B terjadi, pemain tetap tidak
install ulang manual — mereka hanya menerima update Play seperti app lain.
Isi game tidak berubah oleh jalur ini; keduanya independen.

## Yang TIDAK boleh lewat jalur A (harus jalur B / tidak sama sekali)

- mengganti host/origin atau `packageId` (assetlinks + ID permanen di Play);
- mengubah rel billing: jalur uang harus tetap Play Billing lewat Digital
  Goods API yang dideklarasikan shell — menambah jalur bayar lain via web
  melanggar kebijakan;
- merotasi kunci upload (sekali dibuat, selamanya);
- mengubah app lewat web menjadi sesuatu yang substansialnya berbeda dari
  yang direview (kebijakan TWA Play).

## Cheatsheet

| Ingin… | Jalur | Perintah | Sampai ke pemain |
|---|---|---|---|
| rilis konten/fix game | A | `tools/deploy-web.sh --live` | cold start berikutnya |
| ganti tema/orientasi/fitur shell | B | `playpack.sh` + upload AAB | auto-update Play (jam–hari, tergantung review & rollout) |
| update tahunan targetSdk | B | sama | sama |
| uji build tanpa mengotori cache pemain | — | host non-rilis: SW unregister + purge sendiri (sudah built-in) | langsung |

Backup yang membuat semua ini tetap mungkin: `duskhold-upload.jks` +
`signing.local.json` (di luar git). Hilang = jalur B mati selamanya; jalur A
tetap hidup selama origin dan repo ada.
