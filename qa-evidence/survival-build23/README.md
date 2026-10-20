# Bukti QA BUILD 22+23 — rantai sasaran (H3/R22) + pasukan sesuai lembar konsep (2026-10-20)

Dua pass dirilis dalam satu langkah: BUILD 22 (rantai sasaran hari-2) dan BUILD 23
(pasukan dibedakan dari kapten mengikuti `ASSET_CHARACTER/characters/02-guard.png`).
Stempel akhir `BUILD 23`, service worker `duskhold-v23`. Semua frame/log dari gate
QA otomatis; acceptance visual user atas tampilan pasukan baru ini masih terbuka
(koreksi datang dari user, jadi pandangannya yang memutuskan).

## Frame

| File | Isi |
|---|---|
| `b23-1-guard-concept.png` | plotsqa §15: guard gerbang + kapten dalam satu frame — dua siluet berbeda (helm+kettle & skirt vs topi & coat) |
| `b23-2-probe-guard-front.png` | probe scratch: dua guard depan/plong — helm baja berplume, pauldron, skirt gambeson, crossbow di tangan; kapten di sampingnya bertopi |
| `b23-3-probe-guard-back-shield.png` | probe scratch: guard membelakangi kamera — perisai bundar (papan baja, field biru, boss emas) terbaca di punggung; cape tidak ada |
| `b22-1-chain-day2.png` | plotsqa §14: rantai sasaran hari 2 di tepi kiri (langkah mine tercentang) |
| `b22-2-chain-night2.png` | plotsqa §14: rantai di malam 2 (dua centang + langkah ketiga berdenyut) |

## Log (folder `logs/`)

Satu berkas per perintah gate dari run rantai BUILD 22+23: `harness.txt` (96/96),
`plotsqa.txt` (38 cek termasuk §14 B22 dan §15 B23), `devqa.txt`, `envqa.txt`,
`intro.txt`, `fxshots.txt`, `swtest.txt`, `layoutqa.txt`, `look.txt`, `shots.txt`,
`glbtest.txt`, `map.txt`, `bundlecheck.txt`. Catatan: run plotsqa pertama untuk
BUILD 22 mati oleh restart sandbox dan satu screenshot timeout (sebab: loop render
panjang + modal dawn belum di-ack); keduanya sudah diperbaiki di skrip dan run
final di folder ini yang menjadi acuan.
