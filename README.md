# Grasswhistle

Desktop app (Electron + React) for procedural map authoring and RPG Maker XP–style export: settlements, routing, cliffs, biomes, Map Generator asset mapping, **`render.json`** + packed tilesets, and optional **`.rxdata`** output via vendored **RX Converter**.

**License:** [MIT](LICENSE). Third-party: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). **History:** [CHANGELOG.md](CHANGELOG.md).

---

## Documentation

**[docs/HANDBOOK.md](docs/HANDBOOK.md)** — architecture, generation pipeline, file formats, RMXP export, IPC, and how to extend the project.

**[docs/wang_tile_layouts.md](docs/wang_tile_layouts.md)** — detailed Wang / `cliff_double` layout tables and semantic conversion (1×13 strip, 5×3 grid, 5×4 sheet, master table).

CLI details for Marshal / `.rxdata` tooling: **`tools/RXConverter/README.md`**.

---

## Tech stack

- **Electron** (main) + **React** (renderer), **Vite** (bundler / dev server)
- **Canvas** rendering; procedural logic in plain **JavaScript**
- **simplex-noise**, **jszip**, **@hyrious/marshal** (for RX Converter / RMXP)

---

## Quick start

```bash
npm install
npm run dev
```

Vite serves the renderer at `http://localhost:5176`; Electron opens automatically.

```bash
npm run build && npm run start   # production-style: load dist/ in Electron
npm run test && npm run lint
npm run pack:win                 # optional Windows portable .exe → release/
```

---

## Repository highlights

| Path | Role |
| :--- | :--- |
| `electron-main.js`, `preload.js`, `main/` | Electron lifecycle, IPC, disk I/O |
| `src/renderer/App.jsx` | UI: Layout Generator, Map Generator |
| `src/renderer/layoutGen.js` | Procedural engine |
| `src/renderer/render/regionRender.js` | Layout bake / render |
| `src/renderer/mg/` | Map Generator mosaic + render bundle |
| `tools/RXConverter/` | RMXP `.rxdata` writers + CLI (see handbook §11) |

---

## Distribution

Recommended: **clone**, **`npm install`**, **`npm run dev`** (or `build` + `start`). Optional **`npm run pack:win`** for a local portable build (unsigned Windows binaries may trigger SmartScreen).

Public clone URL referenced in earlier releases: **https://github.com/LancelotXIII/Grass-Whistle** (adjust for your fork).

---

*Enjoy forging your worlds.*
