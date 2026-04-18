# Grasswhistle

High-performance Electron + React application for procedural map forging. Built for advanced settlement placement, routing, and high-fidelity 2D rendering.

**License:** [MIT](LICENSE) — free to use, modify, and redistribute; keep the copyright notice. Third-party fonts and libraries are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

## 📚 Documentation Vault

Explore the technical details and maintenance guides in the [docs/](docs/) directory:

- 📋 **[Planning](docs/Roadmap/Planning.md)**: Product plan — **Done** vs **Todo** (Map Generator layers & Render bundle, RMXP export).
- 🏗️ **[Architecture](docs/ARCHITECTURE.md)**: High-level system design and Mermaid diagrams.
- 🕰️ **[Engine Pipeline](docs/ENGINE_PIPELINE.md)**: Deep dive into the procedural generation pipeline (execution order, labeled steps, biomes, Wang tiling).
- 🎨 **[Visual Styling](docs/VISUAL_STYLING.md)**: Layout preview layers, palette sources, and biome tint knobs.
- 🚀 **[Maintenance](docs/MAINTENANCE.md)**: Checklist for adding new biomes and features.
- 🧱 **[Cliff & Tree Implementation](docs/CLIFF_TREE_IMPLEMENTATION.md)**: Cliff direction encoding, Wang tiling, and tree overlay rendering.
- 📖 **[Function Reference](docs/FUNCTION_REFERENCE.md)**: Complete catalog of every named function in `layoutGen.js` and `App.jsx`.
- 🧑‍💻 **[Development](docs/DEVELOPMENT.md)**: Dev setup, entry points, and IPC overview.
- 💾 **[File formats](docs/FILE_FORMATS.md)**: Export folder structure, `mapping.json`, `render.json`, and RMXP outputs.

---

## 🛠️ Tech Stack

- **Framework**: [Electron](https://www.electronjs.org/) (Main Process) + [React](https://reactjs.org/) (Renderer)
- **Bundler**: [Vite](https://vitejs.dev/) (Fast HMR)
- **Engine**: Pure JavaScript (Deterministic Mulberry32 PRNG)
- **Noise**: `simplex-noise` (Artifact-free heightmaps)
- **Graphics**: HTML5 Canvas (Direct pixel manipulation)

---

## ✨ Core Features

- **Kingdom Generator**: Procedural landmass creation with domain warping and FBM.
- **Dynamic Settlements**: Seeded placement for Peak POIs, Coastal hubs, and Island outposts.
- **A* Route Network**: Intelligent "visitable" paths with land-bias detouring and forest avoidance; panel-level highways meander via seeded cost noise (Step 7).
- **Layout preview**: Baked canvas layers in **`regionRender.js`**; non-playable panels are **transparent** in the live preview so the UI background shows through (export still writes a full **`world.png`**).
- **Cliff Direction Encoding**: 12-tile Wang strip for directional cliff faces.
- **Tree Overlay Rendering**: 2×3 sprite sheet with brick-stagger spatial anchoring.
- **Map Generator**: Load exported projects, map terrain types to PNG assets, and render a **full-world stitched canvas** preview (visitable panels only) for fast in-game art validation. **Download full** exports the mosaic at 32px/cell as a **single PNG** or **one ZIP** of tiled PNGs for very large worlds.

---

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Launch development environment (Vite + Electron)
npm run dev
```

The Electron window will launch automatically, served by Vite at `http://localhost:5176`.

### Distribution: build from source

**Recommended for beta and public sharing:** have people **clone the published repository**, install [Node.js](https://nodejs.org/), then run the app locally:

```bash
git clone https://github.com/LancelotXIII/Grass-Whistle.git
cd Grass-Whistle
npm install
npm run dev
```

Production-style run (no dev server): `npm run build` then `npm run start` (Electron loads the Vite output in `dist/`).

There are **no official prebuilt installers** in this workflow—everyone runs code they built on their machine, which avoids unsigned-binary warnings on Windows.

### Publishing in a separate repository

If you develop in a **private** repo and **mirror or push** to a **public** repo for releases:

- Copy the full tree (or use a dedicated remote): source, `docs/`, `tools/`, `assets/`, **`LICENSE`**, **`THIRD_PARTY_NOTICES.md`**, `package.json`, lockfile if you commit it.
- Do **not** rely on publishing `node_modules/`, `dist/`, or `release/`—those stay gitignored and are produced locally with `npm install` / `npm run build`.
- Tag versions (e.g. `v0.2.0`) on the public repo so users can checkout a stable commit.
- Public clone URL: **https://github.com/LancelotXIII/Grass-Whistle**

### Optional: Windows portable `.exe` (maintainers)

On **Windows x64** only, `npm run pack:win` builds **`release/Grasswhistle <version>.exe`** via electron-builder. Unsigned executables are often flagged by SmartScreen / Smart App Control; that target is optional tooling, not the default distribution path.

### Checks before a release

```bash
npm run test          # Vitest unit tests (pure helpers)
npm run test:golden   # Engine golden-seed regression (determinism)
npm run lint          # ESLint
```

---

## 📁 Repository Structure

- `electron-main.js`: Core Electron lifecycle management.
- `preload.js`: IPC setup and web preferences.
- `vite.config.js`: Vite server and React plugin configuration.
- `index.html`: Entry point for the React application.
- `src/renderer/main.jsx`: React renderer entry point.
- `src/renderer/App.jsx`: Primary UI, Layout Generator, and Map Generator (asset mapping + stitched preview).
- `src/renderer/render/regionRender.js`: Layout Generator **`bakeRegion`** / **`renderRegion`** (terrain + overlay canvases).
- `src/renderer/layoutGen.js`: Procedural engine (generation pipeline + helpers).
- `src/renderer/index.css`: Global styles and material design tokens.
- `docs/`: Technical Documentation Vault.
- `notes/`: Optional **local-only** notes (the folder is gitignored — not part of the shared repo).

*Enjoy forging your worlds!*
