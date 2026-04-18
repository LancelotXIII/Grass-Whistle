# Maintenance & Extensibility Guide

This guide is for developers looking to expand Grasswhistle without disrupting the existing procedural logic.

---

## 🏗️ How to: Add a New Biome

1. **Define the Biome**: Add a new index (e.g., `6`) to the logic in `layoutGen.js`.
2. **Assign tints**: Update the high-contrast biome tint palette used by overlays:
   - `src/renderer/render/regionRender.js` (`BIOME_RGBA` for biome/cliff debug layers)
   - `App.jsx` legend labels/colors (Layout Generator UI); per-biome terrain colors in **`engine/constants.js`** (`BIOME_PALETTES`, `BIOME_NAMES`).
3. **Update biome labels/keys**: In `App.jsx`, update the biome key list used to match filenames in biome folders (used by `*_BY_BIOME` indexing). Keep **`BIOME`** / **`BIOME_NAMES`** in **`constants.js`** aligned with the engine.
4. **Update Step 20 (Biome Zoning)**: In `layoutGen.js`, update seed list length, propagation order, and scoring rules if the new biome needs elevation or land/water bias. See **`docs/ENGINE_PIPELINE.md`** (section *Step 20: Biome Zoning*).
5. **Add biome assets**: Ensure each biome folder contains the new biome’s art for any biome-aware slots you use (`ground/`, `trees/`, `road/`, `grass/`, `water/`, `cliff/`). The Map Generator indexes these by filename match (per-biome `*_BY_BIOME` maps in `mapping.json`).

---

## 🎨 How to: Modify the Palette

The `PALETTE` object in `layoutGen.js` is the single source of truth for base terrain colors.
- **Ocean/Lake**: Change the RGB arrays in `PALETTE[T.OCEAN]` or `PALETTE[T.LAKE]`.
- **Land Heights**: Update the `LAND_LEVELS` array. Index `1` is the lowest lowland, index `6` is the highest peak.
- **Verification**: After changing colors, verify that the `Ledge Shader` still provides enough contrast between adjacent elevation levels.

---

## ⚙️ How to: Adjust Settlement Density

1. **Global Budget**: Modify the `settlements` budget (UI input) and/or the internal size pool ratios inside Step 6 in `layoutGen.js` (`SETTLEMENT_LARGE_SHARE`, `SETTLEMENT_MEDIUM_SHARE`).
2. **Spacing**: Change `SETTLEMENT_SPACING_RADIUS` (default: `3`) in the named constants block near the top of `layoutGen.js`.
   - A larger radius will create more sparse, isolated kingdoms.
   - A smaller radius will create high-density "metropolis" clusters.

---

## 🖼️ How to: Map Generator Stitched Preview

The **Stitched asset preview** (Map Generator → **Render preview**) builds one canvas from every exported visitable panel at a fixed **4 px** per game cell (`MG_PREVIEW_CELL_PX`). If the resulting width or height would exceed **16384** px (`MG_CANVAS_SAFE_MAX_DIM`), the build fails with a clear error (use **Download PNG** instead). **Download PNG** runs a separate bake at **32 px/cell** (`MG_FULL_EXPORT_CELL_PX`) without updating the preview: it renders **8192×8192** max regions (`MG_EXPORT_CHUNK_PX`), encodes each PNG with **`toBlob`**, and downloads **one ZIP** of tiles (`jszip`) when the world needs more than one chunk; a small world downloads a **single PNG**. All mosaic downloads use **`toBlob`** + an object URL (not `toDataURL`) so large images are not truncated by base64 limits.

Forest sprites on the mosaic use **deterministic** hashes per panel/cell so the preview is stable across rebuilds (unlike the DOM tree overlay, which still uses `Math.random()` for variety in single-panel view).

**Wang / autotile edges**: Indexing uses a **1-cell halo** into adjacent panels when those JSON files exist (eight IPC loads per opened panel, or the full `panelMap` for stitched preview). `dir12` only reads immediate neighbors; the halo supplies those cells from neighbor grids so water does not “close” falsely at internal panel seams.

---

## 🛤️ How to: Tune Panel Highway Shape (Step 7)

Panel-level routes are chosen by A* in `layoutGen.js` (`panelRouteAStar`). To make corridors straighter or more winding, adjust the named constants next to the other panel A* costs:

- **`PANEL_ROUTE_MEANDER_WEIGHT`**: `0` removes noise scaling (shortest geometric corridors, modulo water penalties). The default is tuned for visible meandering without sacrificing connectivity.
- **`PANEL_ROUTE_MEANDER_SCALE`**: Noise frequency in panel coordinates; lower values produce broader, smoother curves; higher values add local jitter.

Changing these does not affect water penalty weights. Adding or removing `createNoise2D(rand)` calls before Step 7 shifts PRNG consumption for all later steps (see **PRNG order matters** below).

---

## 🗺️ How to: Add a Pipeline Step

Adding a new generation step to `generateFromTerrain` in `layoutGen.js`:

1. **Choose an insertion point**: Steps run sequentially inside `generateFromTerrain`. Check **`ENGINE_PIPELINE.md`** for dependencies — e.g. don't read Wang `tileIndex` before **Step 17** (`calculateTileIndices`) runs on the hot path you care about.

2. **Wrap in an IIFE**: Each step uses the pattern:
   ```javascript
   // ─── Step N: Your Step Name ──────────────────────────────────────────────────
   ; (() => {
     // step logic here
   })()
   ```
   The IIFE keeps step-local variables from leaking into the surrounding scope.

3. **Use the PRNG, never `Math.random()`**: All randomization must go through the seeded `rand` function (derived from `mulberry32`). Using `Math.random()` would break seed determinism.

4. **PRNG order matters**: Every `rand()` call advances the PRNG state. Inserting a new `rand()` call before an existing step will shift all subsequent PRNG outputs and change the map for every seed. This is a breaking change — be deliberate about placement.

5. **Update `ENGINE_PIPELINE.md`**: Add a new `###` section describing what the step does, what data it reads, and what it writes.

6. **Run the Golden Seed test**: Generate `Seed: 12345` before and after. If the output is identical, your step consumed no PRNG calls on the hot path. If it differs, that is expected and intentional — just document it.

---

## 🚀 Performance Benchmarking

When adding new stages to the pipeline:
1. **Monitor A\***: Routing is the most computationally expensive stage. Avoid increasing the map size beyond 64×64 without moving generation to a Web Worker.
2. **Canvas Offscreen**: Ensure any new overlays are "baked" to separate canvases rather than redrawn on every frame.
3. **Determinism Test**: Always run the **Golden Seed** test (`Seed: 12345`) to ensure new features haven't introduced non-deterministic `Math.random()` calls.
