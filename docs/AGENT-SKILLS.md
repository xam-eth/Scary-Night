# Agent skills di repo ini

**Dipasang:** 2026-10-24 (Asia/Makassar), atas permintaan user: "install semua skill yg ada di repo ini skill godot blender dll", lalu "gunakan repo ini (img2threejs) untuk membuat asset asset yg di perlukan untuk world build".

Skill adalah folder `SKILL.md` (format terbuka [Agent Skills](https://agentskills.io)). Agen AI hanya membaca sebuah skill saat tugasnya cocok. Skill tidak ikut ke build game: tidak ada file di `.agents/` atau `.claude/` yang dimuat oleh `index.html`, service worker, atau bundle Play.

## Yang dipasang

| Sumber | Commit | Lisensi | Isi |
|---|---|---|---|
| [gamedev-skills/awesome-gamedev-agent-skills](https://github.com/gamedev-skills/awesome-gamedev-agent-skills) | `7eb1b53` (2026-10-23) | Apache-2.0 | **76 skill + router** (semua isi repo) |
| [img2threejs/img2threejs](https://github.com/img2threejs/img2threejs) | `954cd58` (2026-10-21), skill v2.0.0 | Apache-2.0 | skill `img2threejs` lengkap dengan alat `forge/` (Python stdlib) dan aturan `grimoire/` |

Rincian 76 skill dari repo pertama:

| Kelompok | Jumlah | Skill |
|---|---|---|
| Godot 4.7 | 16 | `godot-gdscript`, `godot-nodes-scenes`, `godot-signals-groups`, `godot-2d-movement`, `godot-tilemap`, `godot-physics`, `godot-ui-control`, `godot-animation`, `godot-shaders`, `godot-3d-essentials`, `godot-resources`, `godot-audio`, `godot-multiplayer`, `godot-export`, `godot-csharp`, `godot-gdscript-headless-testing` |
| Unity 6.3 | 8 | `unity-csharp-scripting`, `unity-input-system`, `unity-physics`, `unity-animation`, `unity-scriptableobjects`, `unity-tilemap-2d`, `unity-navmesh`, `unity-build-pipeline` |
| Unreal 5.8 | 6 | `unreal-blueprints`, `unreal-cpp-gameplay`, `unreal-enhanced-input`, `unreal-behavior-trees`, `unreal-niagara`, `unreal-packaging` |
| Ebitengine | 1 | `ebitengine-game` |
| Web (Phaser, PixiJS, three.js) | 6 | `phaser-core`, `phaser-arcade-physics`, `pixijs-rendering`, `threejs-scene-setup`, `threejs-gltf-loading`, `threejs-materials-lighting` |
| Engine lain | 11 | `bevy-ecs`, `pygame-core`, `love2d-core`, `defold-core`, `roblox-luau`, `roblox-datastores`, `roblox-ui`, `roblox-networking`, `roblox-characters`, `roblox-physics`, `roblox-studio-workflow` |
| Disiplin | 15 | `create-game-assets`, `game-ai`, `ai-behavior-trees-utility-ai`, `procedural-gen`, `dialogue-systems`, `save-systems`, `audio-design`, `shader-programming`, `physics-tuning`, `level-design`, `input-systems`, `game-feel`, `game-ui-ux`, `camera-systems`, `performance-optimization` |
| Genre | 9 | `platformer`, `roguelike`, `rpg`, `fps-shooter`, `tower-defense`, `card-game`, `visual-novel`, `survival-crafting`, `puzzle` |
| Workflow | 4 | `game-jam`, `prototype-fast`, `steam-publish`, `itch-publish` |
| Router | 1 | `router` (memilih skill dari engine dan jenis tugas) |

**Tentang Blender:** repo itu tidak punya skill Blender tersendiri. Panduan Blender (ekspor glTF, skala, origin, LOD) ada di dalam `create-game-assets`, file `references/three-d-pipeline.md`. Aplikasi Blender sendiri tidak dipasang.

**Tentang Godot:** 16 skill Godot terpasang, tapi game ini three.js, bukan Godot (tidak ada `project.godot`). Router mendeteksi engine dari file proyek, jadi di repo ini ia memilih skill three.js (`import * as THREE`, file `.gltf`). Skill Godot baru terpakai bila ada proyek Godot.

## Letak file

Dipasang dengan CLI resmi [`skills`](https://www.npmjs.com/package/skills), level proyek:

```bash
npx skills add gamedev-skills/awesome-gamedev-agent-skills --skill '*' -a claude-code -a codex -y
npx skills add img2threejs/img2threejs -a claude-code -a codex -y
```

- `.agents/skills/<nama>/`: satu salinan setiap skill. Jalur ini dibaca Codex, Gemini CLI, GitHub Copilot, Cursor, dan Oh My Pi.
- `.claude/skills/<nama>`: symlink ke `.agents/skills/<nama>`, untuk Claude Code.
- `skills-lock.json`: sumber dan hash setiap skill (`npx skills experimental_install` memulihkan dari file ini).

Satu file img2threejs (`integrations/glb_character_pipeline/node/package-lock.json`) diabaikan oleh `.gitignore` bawaan skill itu, padahal ada di repo sumbernya. File itu ditambahkan paksa (`git add -f`) agar salinannya utuh. File skill tidak diubah; isinya identik dengan commit sumber di tabel atas.

## Memperbarui atau menghapus

```bash
npx skills update -p            # tarik versi terbaru skill proyek
npx skills list                 # yang terpasang
npx skills remove -s <nama> -y  # hapus satu skill
```

Setelah update, catat commit baru di tabel atas.

## Skill yang relevan untuk game ini

Untuk three.js web game seperti DUSKHOLD, router akan memuat:
- `threejs-scene-setup`, `threejs-gltf-loading`, `threejs-materials-lighting`: renderer, GLB, dan material;
- `create-game-assets`: art direction dan pipeline aset;
- `img2threejs`: aset prosedural dari gambar referensi;
- `game-feel`, `camera-systems`, `game-ui-ux`, `performance-optimization`, `level-design`;
- genre `tower-defense`, `survival-crafting`, dan `roguelike`.

Pemakaian img2threejs untuk aset dunia dicatat di `docs/IMG2THREEJS-ASSETS.md`.
