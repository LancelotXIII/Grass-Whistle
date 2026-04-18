# 🗺️ Grasswhistle — Getting Started Guide

Everything you need to install, run, and use Grasswhistle to create and export your own world maps.

---

## 🌍 What is Grasswhistle?

Grasswhistle is a desktop app that generates procedural fantasy world maps and exports them directly into **RPG Maker XP** (and **Pokémon Essentials**). You give it a seed number and some settings, and it builds a full world — terrain, biomes, forests, cliffs, roads, and named settlements — ready to drop into your game.

### ✅ What's working now

- 🌍 Procedural world generation (terrain, elevation, biomes, forests, cliffs, roads, settlements)
- 🎨 Manual biome zone painting via the Zone Edit tool
- 🗺️ Zoomable world preview with overlay toggles
- 📤 Layout export (project JSON + per-panel data + world PNG)
- 🖼️ Map Generator render preview (full-world mosaic)
- 📦 RPG Maker XP export — `.rxdata` maps, MapInfos, Tilesets, tileset atlas
- 🔗 Pokémon Essentials PBS files — map metadata and cross-map connections
- 🏷️ Passage flags and terrain tags (walkability, water, bush)

### 🚧 On the roadmap

- 🖌️ **Tileset editor** — a built-in tool to format and assign your own PNG tilesets (the mapping step is currently a placeholder)
- 🗺️ **Non-destructive map merging** — right now the export overwrites existing maps; future versions will add maps alongside your existing ones
- **Other Things as I get feedback and think of them...**

---

## 🛠️ Part 1 — Installation & First Launch

### 📦 What you need first

- **Node.js** (version 18 or newer) — download from [nodejs.org](https://nodejs.org)
  - On the download page, pick the **LTS** version (the one that says "Recommended for Most Users")
  - Run the installer and accept all defaults
- **Git** (optional, only needed if you cloned the repo) — [git-scm.com](https://git-scm.com)

### ⬇️ Install the app

1. Open a terminal (on Windows: press `Win + R`, type `cmd`, press Enter)
2. Navigate to the Grasswhistle folder:
   ```
   cd "path\to\Grass Whistle - Map Maker"
   ```
3. Install dependencies (do this once):
   ```
   npm install
   ```
   This will download everything the app needs. It may take a minute or two.

### 🚀 Launch the app

```
npm run dev
```

A window will open — that's Grasswhistle. You're ready to go.

> 💡 **Want a standalone .exe instead?** Run `npm run pack:win` and find the portable executable inside the `release/` folder. No terminal needed to run it after that.

---

## 🌱 Part 2 — Generating a World Map

When the app opens, you'll see three tools on the home screen. Start with **Layout Generator**.

### ⚙️ Step 1 — Configure your world

You'll see a settings panel on the left with a few options:

| Setting | What it does | Default |
|---|---|---|
| 🏷️ **Project name** | A name for your world (used in exported filenames) | — |
| ↔️ **World width / height** | How many map panels wide and tall the world is | 16 × 16 |
| 🏘️ **Settlements** | How many towns and cities to place | 9 |

> ℹ️ A "panel" is one individual RPG Maker map (48×48 tiles). A 16×16 world = 256 maps total.

### ✨ Step 2 — Generate

1. Enter a **seed** — any whole number (e.g. `12345`). The same seed always produces the same map, so write it down if you like a result.
2. Click **Generate**.
3. A progress indicator will appear while the world is built. It usually finishes in a few seconds.

### 🔍 Step 3 — Explore the map

Once generated, a canvas appears showing the full world. You can:

- 🖱️ **Scroll** to zoom in and out (zooms toward your cursor)
- ✋ **Middle-click drag** or **right-click drag** to pan around
- 👆 **Hover** over any panel to see its name

### 🎨 Step 3b — Editing biomes (optional)

Biomes are placed automatically based on the seed, but the result won't be great. You can repaint any biome zone by hand before exporting.

**To enter biome editing mode**, click the **✏️ Zone Edit: Off** button in the sidebar — it turns on and highlights the biome zones across the map.

While Zone Edit is on:
- 🖱️ **Hover** over the map to see the biome zones light up as distinct regions
- 👆 **Left-click** any highlighted zone to open a biome picker
- Choose from the six biomes to repaint the entire zone:

| Biome | Feel |
|---|---|
| 🌿 Lush | Green, grassy meadows |
| 🏔️ Highland | Rocky, grey mountain terrain |
| ✨ Enchanted | Magical, purple-tinted forest |
| 🍂 Autumn | Warm orange and red foliage |
| 🌴 Tropical | Bright, dense jungle |
| 🌋 Volcanic | Dark, ashy, and dramatic |

The map redraws immediately so you can see the change. Repeat for as many zones as you like. When you're done, click **✏️ Zone Edit: On** again to turn it off and return to normal navigation.

> 💾 Biome edits are part of your session — they'll be included when you export the layout in the next step.

### 📤 Step 4 — Export the layout

When you're happy with the world, click **Export project** (the 📤 button).

- Choose a folder to save into (e.g. `MyWorld/`)
- Grasswhistle writes:
  - 📄 `project.json` — your world settings and seed
  - 🖼️ `world.png` — a full-size preview image of the whole map
  - 📁 `panels/` — one JSON file per map panel (the raw data for each map)

Keep this folder — you'll load it in the next step.

---

## 🎮 Part 3 — Turning Your Map Into RPG Maker XP Files

Once you have an exported layout, open the **Map Generator** from the home screen.

### 📂 Step 1 — Load your project

Click **Load project** and select the folder you exported in Part 2. Grasswhistle reads all the panel data and gets ready to render.

### 🖼️ Step 2 — (Coming soon) Map terrain to tilesets

This step is currently a placeholder — a built-in tileset editor is on the roadmap. For now, the app uses its built-in placeholder tiles automatically. When the editor arrives, you'll be able to assign your own PNG tilesets here, matching terrain types (Ground, Road, Forest, Water, Cliff, etc.) to the correct rows in your tileset image.


### 👁️ Step 3 — Render & preview

Click **Render preview**. The app builds all the tile layers across every panel and shows a zoomable mosaic of the entire world at reduced scale. Use this to check things look right before exporting.

### 📦 Step 4 — Export for RPG Maker XP

Click **Package for RMXP** and choose an output folder (e.g. `MyWorld-Export/`).

Grasswhistle will write a complete folder structure ready to copy into your RPG Maker XP project:

```
Export/
├── Data/
│   ├── Map003.rxdata        ← one .rxdata file per map panel
│   ├── Map004.rxdata
│   ├── ...
│   ├── MapInfos.rxdata      ← the map directory RPG Maker reads
│   └── Tilesets.rxdata      ← tileset configuration
├── Graphics/
│   └── Tilesets/
│       └── tileset.png      ← the tile atlas image
├── PBS/                     ← Pokémon Essentials connection data
│   ├── map_metadata.txt
│   └── map_connections.txt
└── README_EXPORT.txt        ← merge checklist (read this!)
```

### 🗂️ Step 5 — Merge into your RPG Maker project

The application currently does a full override of maps. Adding maps non-destructively is on the roadmap.

1. Open your RPG Maker XP project folder in File Explorer.
2. Copy the contents of `Export/` into the root of your project folder.
3. Open RPG Maker XP. Your new maps will appear in the map tree. 🎉

> 🎮 The `PBS/` folder contains ready-to-use `map_connections.txt` entries so adjacent maps connect correctly. Merge these into your existing PBS files.

---

## 💡 Part 4 — Tips & Troubleshooting

### 🔁 Reproducibility
The same **seed + settings** always produces the exact same world. If you want to share a world with someone or recreate it later, just note the seed.

### 📐 World size guide

| World size | Map panels | Good for |
|---|---|---|
| 8 × 8 | 64 maps | 🧪 Small region, quick testing |
| 16 × 16 | 256 maps | 🗺️ Full region or small continent |
| 32 × 32 | 1 024 maps | 🌍 Large continent |

> ⚠️ Very large worlds (64×64+) may take longer to render and produce large export files.

### ❌ The app won't start
- Make sure you ran `npm install` first.
- Make sure Node.js is installed — run `node --version` in a terminal to check. It should print something like `v20.x.x`.

### 📂 The export folder is empty
- Make sure you clicked **Package for RMXP** (not just Render preview) and that you selected a valid output folder.

### 🖼️ Something looks wrong in-game
- Check that `tileset.png` was copied into `Graphics/Tilesets/` in your RMXP project.
- Open the Tileset editor in RPG Maker and confirm Tileset slot 2 points to the correct image.

---

## ⚡ Quick Reference

| What you want to do | Command / button |
|---|---|
| 🚀 Start the app | `npm run dev` |
| 📦 Build a standalone .exe | `npm run pack:win` |
| 🌍 Generate a world | Layout Generator → set seed → Generate |
| 💾 Save the world data | Layout Generator → 📤 Export project |
| 🎮 Create RPG Maker files | Map Generator → Load project → Package for RMXP |
| 🔁 Repeat a world exactly | Use the same seed and world size |
