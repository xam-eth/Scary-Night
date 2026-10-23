# Visual-sync audit — dunia vs character vs enemies (2026-10-23)

**Pemicu:** user di device: "dunia dan character type nya tidak singkron kurang
 tepat … perhatikan object character dan enemies nya, QA screenshot, gunakan
 vision". Audit ini memotret apa yang BENAR-BENAR muncul di layar dan
 membandingkannya dengan referensi gaya milik user sendiri
 (`ASSET_CHARACTER/characters/01-captain-duskhold.png` dst., diminta user
 2026-10-17 sebagai "style reference for every other character").

## Bukti (semua dilihat dengan vision)

| File | Isi |
| --- | --- |
| `audit-lineup.png` | Studio: kapten (pack `Commander`) + prajurit (pack `King`) + 3 varian horde, satu cahaya, grade game aktif (`buildUniformGrade` + `hordeGradeMaterial`) |
| `audit-threeq.png` | Lineup yang sama, kamera 3/4 |
| `ingame-day.png` | Siang: kapten + 2 prajurit di lingkaran keep, dunia benteng stylized cerah |
| `ingame-closeup.png` | Zoom dekat keep: karakter jadi "pasak" pucat tanpa identitas warna |
| `ingame-night.png` | Malam: jubah kapten menyala pucat seperti hantu di dunia teal gelap |
| `ingame-overview.png` | Overview bailey malam |

Probe: `tools/probe-visual-audit.mjs` (lineup studio, grade game aktif).
Frame in-game: `tools/survival-look.mjs --only=day,closeup,fight,overview`.

## Temuan

1. **Tiga arah seni bertabrakan.** Dunia = benteng medieval Eropa stylized
   (dinding batu, menara, bendera heraldik, props flat-shaded cerah) — sesuai
   konsep K1 dan sesuai prompt konsep user ("bright, colorful stylized 3D
   strategy game"). Hero = figur **Mesir kuno** (pak egyptian_people.glb):
   kapten bertelanjang dada berkalung collar, rok shendit putih; prajurit
   berjubah krem bertutup kepala — keduanya bertelanjang kaki. Horde =
   **zombie kota modern** (pak polyart): kemeja+dasi, beanie+jaket, dress
   kaos — bukan undead petani abad pertengahan seperti konsep
   `03-enemy-ghoul.png` (kulit hijau pucat, robekan crimson/brown, ikat tali).
2. **Palet tidak nyambung.** Dunia + UI饱和 (mint/tan siang, teal/abu malam,
   chip warna cerah); karakter bertekstur realistis desaturated (tan, krem,
   abu-coklat) → pada zoom gameplay mereka terbaca sebagai pasak pucat
   (`ingame-closeup.png`), dan jubah putih kapten menyala seperti hantu di
   malam (`ingame-night.png`). Konsep user justru meminta tim warna tegas:
   tabard royal-blue + trim emas (kapten), gambeson biru + kettle helm
   (guard), robekan crimson/brown (ghoul).
3. **Gaya render campur.** Horde faceted flat-shaded SEBENARNYA cocok dengan
   props dunia; pack Mesir lebih halus/semi-realistis → justru hero yang
   paling keluar dari gaya dunia.
4. **Konsep user sudah benar dan konsisten** (01 kapten blue/gold, 02 guard
   biru, 03 ghoul petani) — masalahnya bukan desain konsep, tapi cast 3D yang
   dipakai sekarang berasal dari dua pack off-theme yang Commit BUILD 24/25
   pakai sebelum konsep ini dikonfrontasi langsung di layar.

## Kesimpulan

Keluhan user valid dan terukur di screenshot: ketidak-singkronan BUKAN di
dunia (dunia koheren), melainkan di casting karakter: dua pack off-theme
(Mesir kuno + zombie modern) melawan dunia medieval stylized dan referensi
gaya milik user sendiri. Perbaikan palet/grade (hook sudah ada:
`buildUniformGrade`, `hordeGradeMaterial`) hanya menutup sebagian — siluet
kostum (dasi, beanie, rok Mesir) tidak berubah oleh warna. Keputusan arah
perbaikan diserahkan ke user (lihat opsi di sesi).
