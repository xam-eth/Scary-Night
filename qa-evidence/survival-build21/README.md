# Bukti QA BUILD 21 — empat bug visual user (2026-10-19)

Semua frame dan log di folder ini dihasilkan otomatis oleh gate QA pada pass BUILD 21
(stempel `BUILD 21`, service worker `duskhold-v21`). Frame diambil dari browser headless
(chromium + swiftshader), bukan render tangan. Klaim yang belum diuji manusia tetap
terbuka: acceptance visual/manual di perangkat, playtest, dan packaging.

## Frame

| File | Isi |
|---|---|
| `b21-1-garrison-horde.png` | plotsqa §13: gerbang malam dengan pasukan keluarga kapten + horde satu faksi, zoom dekat |
| `b21-2-gate-night.png` | fxshots: kapten + guard menembak di mulut gerbang malam; bolt/tracer di tinggi dada; horde abu + rim crimson |
| `b21-3-horde-faction.png` | fxshots: horde malam — badan demon abu, crawler lumut-abu, rim crimson dalam (bukan sienna/krim lama) |
| `b21-4-garrison-day.png` | fxshots: siang di plaza keep — guard berdiri sebagai keluarga karakter kapten (tabard biru dalam, trim baja) |
| `b21-5-probe-guard-day.png` | probe visual: kapten + 2 guard gerbang siang hari, satu keluarga seragam |
| `b21-6-probe-horde-night.png` | probe visual: horde malam grade v3 (abu/lumut/wraith, pupil bara, tengkorak ghostfire) |
| `b21-7-probe-bow-mount-shot.png` | probe pose: empat kandidat rotasi mount crossbow dibekukan pada 55% clip `shot`; kolom terpilih = laras sejajar bidikan |
| `b21-8-probe-bow-mount-idle.png` | probe pose yang sama pada pose idle (carry di sisi badan) |
| `b21-9-probe-gate-night.png` | probe visual: gerbang malam, guard menembak dari mulut gerbang |

## Log (folder `logs/`)

Satu berkas per perintah gate, output lengkap termasuk daftar PASS/FAIL dan JSON ringkasan:
`harness.txt` (91/91), `plotsqa.txt` (ditambah setelah run final), `devqa.txt` (25/25),
`envqa.txt`, `intro.txt`, `fxshots.txt` (16/16), `swtest.txt`, `layoutqa.txt`, `look.txt`,
`shots.txt`, `glbtest.txt`, `map.txt` (230/230), `bundlecheck.txt`.
