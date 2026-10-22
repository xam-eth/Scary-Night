# QA Evidence — BUILD 27: horde benar-benar tegak (kelanjutan fix BUILD 26)

**Branch:** `arena/d4f2fdce-scary-night` · **Commit fix:** `b7941de` · **Tanggal:** 2026-10-22
**Pesan user:** "musuh masih belum d fix, coba kamu screenshot dan liat dengan vision".

## Cara bug dibuktikan (vision, bukan asumsi)

1. `tools/probe-horde-view.mjs` (rig level: cloneRig + walk clip, kamera depan &
   samping): ketiga varian **tegak** → `rig-probe-side.png`, `rig-probe-front.png`.
   Jadi pin BUILD 26 benar di level rig, tapi bug tetap ada in-game.
2. `tools/survival-look.mjs` (gameplay asli, malam 1): **pre-fix**
   (`pre-fix-fight.png`, `pre-fix-outside.png`) zombie tampak **berbaring
   horizontal** setinggi pintu/ tanah saat march & menyerang — persis keluhan
   user ("jalan baring", arah tak terbaca).
3. Akar masalah: fix B26 menaruh quaternion konversi sumbu pack di **root
   template** (`root.quaternion.copy(lostQ)`), padahal tiga pemakai me-nol-kan
   root sebelum memakai rig:
   - `crowd3d.bakeKind` (`rig.rotation.set(0,0,0)`) — bake atlas VAT yang justru
     dipakai horde in-game → frame bake berbaring;
   - facing per-frame `enemy3d` (`slot.model.rotation.x = 0; rotation.y = …`);
   - `enemy3d._bakePreview` (preview sprite jarak jauh).
   Probe tidak me-nol-kan root, makanya probe lolos.
4. **Fix:** konversi pindah ke node anak menengah `zombi-variant-N-orient` di
   bawah root netral (`src/game/render3d/zombipack3d.js`). Me-nol-kan atau yaw
   root tidak bisa membuang pose tegak lagi.
5. **Post-fix** (`post-fix-fight.png`, `post-fix-outside.png`, `post-fix-gate.png`,
   + frame run rantai di `look/`): zombie march & menyerang **tegak membungkuk**
   menghadap dinding/gerbang; arah terbaca. Badan berbaring yang tersisa hanya
   **mayat** (guard tumbang di menara/dinding, zombie mati di atas dinding,
   frame die clip) — dimaksudkan, bukan bug orientasi.

## Kontrak baru yang dipin

`tools/glbtest.mjs` pin "BUILD 26+27": selain upright/conv/face seperti B26,
kini juga `rootNeutral` (quaternion root template identitas) dan
`zeroedUpright` (klon template dengan root dinolkan — persis operasi bakeKind/
facing/_bakePreview — tetap tegak). Semua PASS.

## Hasil rantai penuh (`bash tools/chain.sh survival-build27`) — satu run bersih

| # | Gate | Hasil | Log |
| --- | --- | --- | --- |
| 1 | harness | EXIT=0 — 103 PASS / 0 FAIL | `logs/harness.log` |
| 2 | plotsqa | EXIT=0 — 37/37 PASS | `logs/plotsqa.log` |
| 3 | devqa | EXIT=0 — 25/25 PASS | `logs/devqa.log` |
| 4 | envqa | EXIT=0 — ENVQA PASS, 0 PAGEERROR | `logs/envqa.log` |
| 5 | intro | EXIT=0 — 0 failed | `logs/intro.log` |
| 6 | fxshots | EXIT=0 — 16/16 PASS | `logs/fxshots.log` |
| 7 | swtest | EXIT=0 — 0 FAIL | `logs/swtest.log` |
| 8 | layoutqa | EXIT=0 — BROWSER ERRORS: PASS | `logs/layoutqa.log` |
| 9 | look | EXIT=0 — errors 0; frame malam horde tegak di `look/*.png` | `logs/look.log` |
| 10 | shots | EXIT=0 — pageErrors=0 | `logs/shots.log` |
| 11 | glbtest | EXIT=0 — all PASS (termasuk pin BUILD 26+27) | `logs/glbtest.log` |
| 12 | map | EXIT=0 — 230/230 layout checks | `logs/map.log` |
| 13 | bundlecheck | EXIT=0 — 0 FAIL | `logs/bundlecheck.log` |

**CHAIN-DONE EXIT=0.** Tanpa proses yatim.

## Stamp

`index.html` → `DUSKHOLD_BUILD = '27'`; `sw.js` → `VERSION = 'duskhold-v27'`
(service worker versi baru memaksa device user menarik bundle berisi fix ini;
BUILD 26 yang cacat tidak lagi tersaji dari cache).
