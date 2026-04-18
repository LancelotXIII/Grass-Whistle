# Development

## Prereqs
- Node.js + npm

## Commands

```bash
npm install
npm run dev
npm run build
npm run start
npm run pack:win   # Windows x64 portable .exe → release/
npm run test
npm run test:golden
npm run lint
```

- `dev`: runs **Vite** (renderer) + **Electron** (main). Vite serves the renderer at `http://localhost:5176`.
- `build`: builds the renderer into `dist/`.
- `start`: runs Electron in production mode, loading `dist/index.html`.
- `pack:win`: `vite build` + **electron-builder** — produces a **portable** Windows x64 executable under **`release/`**.
- `test`: **Vitest** unit tests (e.g. pure helpers in `src/renderer/engine/`).
- `test:golden`: **`tools/regression/goldenSeeds.mjs`** — deterministic engine regression; use `--update` only when intentionally changing output.
- `lint`: **ESLint** across `src/`, `main/`, and Node entry scripts.

**Public / beta distribution** is expected to be **clone + `npm install` + `npm run dev`** (or `build` + `start`) from a **separate public repository**—see the root **`README.md`**. `pack:win` remains optional for maintainers who want a local portable `.exe`.

## Entry points
- **Main process**: `electron-main.js`
  - delegates window creation to `main/window.js`
  - registers IPC handlers in `main/ipc/index.js`
- **Preload (IPC bridge)**: `preload.js` (`window.electronAPI.*`)
- **Renderer**: `src/renderer/main.jsx` → `src/renderer/App.jsx` (tools) + `src/renderer/render/regionRender.js` (Layout bake/render) + `src/renderer/mg/*` (Map Generator mosaic / export helpers)

## IPC overview (renderer ↔ main)
Renderer calls `window.electronAPI.*` (in `preload.js`), which maps to IPC channels registered in `main/ipc/index.js`.

Key channels:
- `select-folder`
- `export-project` / `load-project`
- `save-mapping` / `load-panel-data`
- `save-render-project` — payload includes `projectPath`, `json`, `tilesetPngBase64` (master PNG), optional **`biomeTilesetPngs`** (`{ filename, base64 }[]` for `tileset_bm_*.png` composition atlases), and optional `biomeCountsMarkdown`
- `export-rmxp-maps`
- `get-assets` / `get-default-assets`
- `get-test-panel` / `save-test-panel`

## Regression harness (engine determinism)
Golden seed fixtures are in `tools/regression/fixtures/golden-seeds.json`.

```bash
node tools/regression/goldenSeeds.mjs
node tools/regression/goldenSeeds.mjs --update
```

