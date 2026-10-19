# DUSKHOLD — guide pack AAB/APK (Play)

Satu perintah untuk dua file:

```bash
bash tools/playpack.sh
```

hasilnya di `dist-play/` (gitignored):

| File | Untuk |
|---|---|
| `DUSKHOLD-<versionName>-<versionCode>.aab` | upload ke Play Console (internal → closed → production) |
| `DUSKHOLD-<versionName>-<versionCode>.apk` | sideload / uji perangkat sendiri; Play tidak menerima APK |

## Mesin yang bisa menjalankannya

| Syarat | Kenapa |
|---|---|
| internet biasa (reach `dl.google.com` + `maven.google.com`) | Bubblewrap mengunduh JDK/Android SDK; Gradle menarik artifact |
| node + npm | repo ini node; Bubblewrap paket npm |
| JDK 17 **atau** bersedia Bubblewrap memasangnya | Android cmdline-tools menolak JDK 18+ |
| ± 1–2 GB disk + RAM cukup Gradle | SDK + build |
| kunci upload tersedia (lihat bawah) | signing |

**Sandbox dev Arena bukan mesin itu** (jaringannya hanya github/npm/pypi). Di sana
skrip berhenti di probe 0/6 dengan alasan itu — setengah detik, bukan satu jam.

## Kunci upload: dari mana, ke mana

- Dibuat sekali pada 2026-10-19: `duskhold-upload.jks` (PKCS12, RSA 2048, ±27 tahun)
  + `signing.local.json` (dua password). **Tidak pernah di git.**
- Lokasi kanonik saat build: `android/` (script menaruhnya di sana sebentar).
  Lokasi backup sandbox dev: `/home/user/duskhold-keys/`.
- Script mencari berurutan: `android/` → `$DUSKHOLD_KEYS_DIR` → `~/duskhold-keys`
  → sibling repo `../duskhold-keys`.
- **Backup keduanya di luar git sekarang** (drive terenkripsi / password manager).
  Kehilangan password = package `com.zyvrolabs.duskhold` di Play tidak bisa
  di-update lagi oleh siapa pun.
- Fingerprint SHA-256 cert: `android/upload-fingerprint.txt` (sudah masuk
  `.well-known/assetlinks.json` + `android/twa-manifest.json`).

## Apa yang script lakukan (6 tahap)

0. **Probe**: internet ke repo Google, node/npm, JDK 17 (atau serahkan ke
   Bubblewrap), Bubblewrap CLI (di-`npm i -g` bila belum).
1. **Kunci**: cari + baca password dari `signing.local.json`.
2. **Identitas**: host/versi dari `bundle.config.json` (source of truth).
3. **Proyek Gradle**: kalau `android/app/build.gradle` sudah ada (run sebelumnya),
   dipakai ulang; kalau belum, `bubblewrap init --manifest <host>/manifest.webmanifest`
   di direktori temp (prompt install JDK/SDK dijawab yes), lalu
   `android/twa-manifest.json` **yang terkomit** ditimpa ke hasil init dan
   `bubblewrap update` dijalankan — repo tetap sumber kebenaran, dan scaffold
   disimpan ke `android/` untuk run berikutnya.
4. **Build**: `bubblewrap build` dengan dua password signing di-stdin.
5. **Kumpulkan**: salin ke `dist-play/` bernama versi + cetak sha256.
6. **Langkah sesudahnya** (dicetak juga oleh script): upload, SHA app-signing ke
   assetlinks, closed testing 12×14 hari, token origin-trial Digital Goods,
   backup kunci.

## Jalan lain: GitHub Actions

Bila tidak ada mesin pribadi yang cocok: repo punya
`.github/workflows/play-bundle.yml` (workflow_dispatch). Tambah tiga secrets
(nilainya diambil sendiri dari file backup, jangan lewat chat/issue):
`DUSKHOLD_KEYSTORE_B64` (base64 .jks), `DUSKHOLD_STORE_PASSWORD`,
`DUSKHOLD_KEY_PASSWORD`; lalu Actions → play-bundle → Run workflow. Artifact
`duskhold-play-bundle` berisi kedua file (retensi 7 hari). Workflow ini belum
pernah dieksekusi dari sandbox dev; run pertama mungkin perlu menyesuaikan
urutan prompt Bubblewrap — lihat Troubleshooting.

## Jalan manual (bila script tidak cocok)

```bash
npm install -g @bubblewrap/cli          # sekali
# JDK 17 di PATH; bila belum ada, init menawarkannya
mkdir -p /tmp/bw && cd /tmp/bw
yes | bubblewrap init --manifest https://duskhold.zyvrolabs.com/manifest.webmanifest
cp <repo>/android/twa-manifest.json ./twa-manifest.json
cp <backup>/duskhold-upload.jks ./duskhold-upload.jks
bubblewrap update
bubblewrap build                         # minta password store lalu password key
ls -la app-release-bundle.aab app-release-signed.apk
```

## Naik versi

1. `bundle.config.json`: `versionCode` +1 (wajib naik tiap upload), `versionName` bila perlu.
2. `node tools/bundle.mjs prepare` (menulis ulang manifest web + twa-manifest, fingerprint ikut).
3. `bash tools/playpack.sh`.

## Troubleshooting

| Gejala | Sebab / obat |
|---|---|
| `FAIL cannot reach dl.google.com` | mesin tanpa internet Google (sandbox dev, proxy korporat). Pindah mesin atau pakai workflow Actions |
| `JDK was found but it is not 17` | uninstall/`JAVA_HOME` ke JDK 17; JDK 18+ ditolak Android cmdline-tools |
| build berhenti minta password padahal sudah di-stdin | versi Bubblewrap mengubah urutan prompt: jalankan `bubblewrap build` manual di `android/`, ketik dua passwordnya |
| `init` menolak direktori tidak kosong | script sudah init di temp dir; manual: pakai direktori baru |
| TWA terinstal tapi menampilkan URL bar | assetlinks belum cocok: setelah upload pertama, ganti fingerprint di `.well-known/assetlinks.json` ke SHA-256 **app signing** Play (bukan upload key), publish, uji ulang via `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://duskhold.zyvrolabs.com&relation=delegate_permission/common.handle_all_urls` |
| shop tidak menerima pembayaran | token origin-trial Digital Goods belum ditempel di `index.html` (WARN bundlecheck) |
| ingin scaffold ulang dari nol | hapus `android/app` (+ file gradle hasil init) tapi **jangan** `twa-manifest.json`, lalu jalankan script lagi |
| password salah / keystore korup | restore dari backup `duskhold-keys`; jangan pernah generate kunci baru setelah ada upload di Play |

## Yang TIDAK berubah oleh pack ini

Game-nya sendiri tidak disentuh: TWA hanya membungkus origin
`https://duskhold.zyvrolabs.com`. Artinya rilis web dan rilis Play berjalan
sendiri-sendiri — service worker `duskhold-vNN` mengurus freshness di perangkat,
dan Play hanya mengantarkan shell-nya.
