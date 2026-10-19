# DUSKHOLD — Play Store listing pack (2026-10-19)

Satu folder untuk semua yang diminta Play Console selain AAB-nya. Teks di bawah
siap tempel; asset menunjuk file yang sudah ada di repo ini.

## Identitas (sudah terkunci di `bundle.config.json`)

| Field | Nilai |
|---|---|
| Package ID | `com.zyvrolabs.duskhold` (permanen di Play) |
| versionName / versionCode | `1.0.0` / `1` |
| Origin (TWA) | `https://duskhold.zyvrolabs.com` |
| minSdk / target | 23 / 36 (template Bubblewrap) |
| Orientasi | landscape (game landscape-only) |
| Kategori | Games → Strategy; tags: tower defense, survival, offline-ish TWA |
| Content rating | isi IACA questionnaire: violence fantasy ringan (monster kartun), tanpa darah → harapan Everyone 10+; jawab jujur saat review |

## Teks listing

**Judul (≤ 30):** `DUSKHOLD — Hold the Night`

**Short description (≤ 80):**
`Hold a gothic fortress through three nights — build by day, survive the siege.`
(79 karakter)

**Full description (≤ 4000):**

```
The sun is going down and the gates are weak. DUSKHOLD is a three-night
siege: every day you spend gold and wood on walls, ballista towers, guards
and a keep that must not fall — every night the horde arrives at the gates
it named at dusk, and you hold the line with your captain's own shot.

BUILD BY DAY
Walk the bailey, step into a circle and raise towers, barracks, mines and
sawmills. Upgrade the keep, the hunter's shot and the garrison's arms.
Every coin is a choice: the night does not wait for a finished plan.

READ THE NIGHT BEFORE IT COMES
At dusk the TONIGHT chip tells you the order of the gates and what is
coming through them — horde, runners, and the Breaker that ends a wave.
Badges on the walls carry the wave that reaches each gate first.
No two runs attack from the same sides: every run draws its rotation
from its own seed.

HOLD THE LINE BY NIGHT
Crossbow guards fall where they stand and must be carried off the wall.
The captain is yours alone: one stick to move, one flare to burn.
Clear a night early and dawn comes early, with a bonus for the speed.

EARN YOUR COLOURS
Every closed run banks its stars. Three, six, nine stars repaint the
captain's watch — iron, crimson, gold — and the end panel always names
the colour you are working toward. One to three stars a night, from the
keep's lowest point and the guards you brought home.

A dark, stylized 3D fortress in your pocket: landscape-only, thumb-first,
and honest about its rules. No loot boxes, no random cards — the ladder
is fixed and the night always tells you where it is coming from.

Play the first three nights free in your browser's shell; the full game
lives on the fortress walls of duskhold.zyvrolabs.com.
```
(± 1.650 karakter — masih ada ruang untuk catatan rilis)

## Asset

| Slot Play Console | File di repo |
|---|---|
| Icon (512) | `assets/brand/icon-512.png` |
| Feature graphic (1024×500) | `assets/brand/play-feature-1024x500.png` |
| Screenshot phone 1–6 (1920×1080, 16:9) | `play-listing/screenshots/gate.png`, `day.png`, `build.png`, `fight.png`, `overview.png`, `closeup.png` (`node tools/survival-look.mjs --store`) |
| Hi-res icon maskable | `assets/brand/icon-maskable-512.png` |
| Privacy policy URL | `https://duskhold.zyvrolabs.com/privacy.html` (file `privacy.html` di root) |
| Data safety form | game menyimpan progres hanya di perangkat (localStorage); tanpa akun, tanpa pelacak, tanpa iklan → deklarasi "no data collected" |

## Urutan rollout (jangan dibalik)

1. **Build** AAB+APK: lihat "Pass packaging Play" di `docs/REBUILD-ROADMAP.md`
   (mesin ber-JDK 17 + Android SDK, atau workflow `play-bundle.yml`).
2. Upload AAB ke **internal testing** dulu; Play Console → Setup → App signing:
   salin SHA-256 **app signing** (bukan upload cert) ke `.well-known/assetlinks.json`
   di origin, lalu `node tools/bundle.mjs prepare` ulang supaya file itu naik bersama
   rilis web berikutnya. Sampai cocok, TWA memperlihatkan URL bar.
3. Verifikasi: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://duskhold.zyvrolabs.com&relation=delegate_permission/common.handle_all_urls`
4. **Closed testing 12 penguji × 14 hari berturut-turut** (akun personal setelah
   13 Nov 2023) sebelum production ditawarkan.
5. **Origin-trial token Digital Goods** (WARN bundlecheck): daftar origin trial di
   Console, tempel token ke meta tag di `index.html` — tanpa itu shop tidak bisa
   menerima uang lewat Play Billing.
6. **Verifikasi developer Indonesia** (berlaku sejak 30 Sep 2026): pastikan registrasi
   package + verifikasi developer akun sudah beres sebelum submit production.
7. Kunci upload (`android/duskhold-upload.jks` + `android/signing.local.json`,
   keduanya TIDAK di git) wajib dibackup di luar repo: kehilangan password =
   kehilangan kemampuan update aplikasi ini selamanya.
