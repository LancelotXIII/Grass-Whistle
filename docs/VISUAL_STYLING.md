# Visual Styling Guide

This guide describes how to tweak the **Layout Generator** map preview and related visuals. The live preview is baked in **`src/renderer/render/regionRender.js`** (`bakeRegion` / `renderRegion`). **Terrain colors** for generation and export come from **`src/renderer/engine/constants.js`** (`PALETTE`, `BIOME_PALETTES`); `layoutGen.js` imports those values.

---

## Core color palette

| Feature | Key | Source |
| :--- | :--- | :--- |
| **Ocean, lake, roads, land levels, …** | `T.*`, `PALETTE.LAND_LEVELS` | `engine/constants.js` → `PALETTE` |
| **Per-biome overrides** | `BIOME_PALETTES[0..5]` | `engine/constants.js` |
| **Settlement ring** | Neon accent | `mgCanvasColors()` in `regionRender.js` reads CSS vars (e.g. `--color-neon`) |

**Water route in data:** `T.WATERROAD` is still a distinct type in layout data. **Map Generator** mapped preview treats it like water for assets/Wang; layout debug views may still use the palette entry for `T.WATERROAD`.

---

## Layout preview: visitable vs non-visitable

**Not a generation step** — only affects the **Layout Generator** canvas when `bakeRegion(region, exportMode=false, …)` runs.

- **Visitable panels** (`panelData[key].isRoute` or `.settlement`): base terrain is drawn opaque; biome / cliff-debug tints apply to those cells as configured.
- **Non-visitable panels** (preview only): base terrain pixels are **fully transparent** (`alpha = 0`). Biome and cliff-biome tint layers also skip those panels so the preview matches the idea of the **Map Generator** stitched view (only playable panels composited; background shows elsewhere).
- **Export / world PNG** (`exportMode=true`): **all** panels are drawn at full opacity so the exported `world.png` remains a complete world image.

`renderRegion` fills the display canvas with **`mgCanvasColors().crust`** (from `--canvas-bg`), then draws the baked layers — transparent holes show that color.

---

## Biome tint overlay (layout preview)

- **Location:** `bakeRegion` in `regionRender.js` — `BIOME_RGBA` table + `ImageData` into the `biomeMap` canvas.
- **Scope:** Only **visitable** panels receive tint pixels in preview (see above).
- **Indices (match `BIOME_NAMES` in `constants.js` / legend):** 0=Lush, 1=Highland, 2=Enchanted, 3=Autumn, 4=Tropical, 5=Volcanic.
- **Tweak:** Adjust the alpha in each `BIOME_RGBA` row (fourth component, ~0.45) for stronger or subtler overlays.

---

## Logic configuration (generation, not canvas)

### Coastline / sea level

- **`SEA_LEVEL`** in `engine/constants.js` (default **0.15**) — continuous elevation threshold for water vs land in early pipeline steps. **Higher** shrinks land; **lower** expands it. (This is unrelated to the old “15% brightness” preview dimming.)

### Settlements & roads

- Settlement budget and road costs live in **`layoutGen.js`** — see **`ENGINE_PIPELINE.md`** and comments on `ASTAR_*` constants.

---

## Legacy / removed canvas effects

Older docs referred to a **ledge shader**, **coordinate grain**, and **wilderness dimming** (`playShift`) inside `App.jsx`. The current **`regionRender.js`** pipeline does **not** implement ledge or grain passes; non-visitable areas use **transparency** instead of darkening.
