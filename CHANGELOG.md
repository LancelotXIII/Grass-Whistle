# Changelog

All notable changes to the **Grasswhistle** project will be documented in this file.

---

## [Unreleased] - 2026-04-12

### Tooling & distribution
- **MIT license** ([`LICENSE`](LICENSE)) and **[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)** for attribution.
- **Portable Windows build:** `npm run pack:win` (electron-builder **portable** x64) → **`release/`**.
- **Scripts:** `npm run test` (Vitest), `npm run test:golden`, `npm run lint` (ESLint), `npm run format` (Prettier).
- **Electron:** renderer **sandbox** + explicit **webSecurity** in `main/window.js`.
- **Docs:** `regenerateFromTerrain` / gameplay pipeline consistently **Steps 6–20**; architecture diagram clarifies dev vs production loading.

### Documentation
- **Doc sync (2026-04-18):** **`CHANGELOG.md`**, **`docs/Roadmap/Planning.md`** — RMXP **`@priorities`** (below vs normal only; star passage for canopy walk-behind; no priority **2**). **`docs/FILE_FORMATS.md`** — **`|tsb|`** / **`|fitb|`** phys keys in **`packMgTileset`**. **`tools/RXConverter/README.md`** — star + **normal** priority vs **Above characters**.
- **Doc sync (2026-04-16):** **`VISUAL_STYLING.md`** rewritten for **`regionRender.js`** (transparent non-visitable preview, palette in **`constants.js`**). **`ENGINE_PIPELINE.md`**, **`ARCHITECTURE.md`**, **`FUNCTION_REFERENCE.md`**, **`CLIFF_TREE_IMPLEMENTATION.md`**, **`FILE_FORMATS.md`**, **`README.md`**, **`DEVELOPMENT.md`**, **`MAINTENANCE.md`**, **`Roadmap/Planning.md`** — biome names (**Lush / Autumn** etc.), render stack location, removal of obsolete **`playShift`** / ledge / **`handleSelectPanel`** references, **`project.json` `seed`** semantics, Map Generator vs Layout handler split.
- **Engine pipeline & architecture:** **`layoutGen.js`** step comments renumbered **1–20** to match **execution order** (cliffs **11**, tile roads **12**, … **20** biome zoning last). **`docs/ENGINE_PIPELINE.md`**, **`docs/ARCHITECTURE.md`**, **`docs/CLIFF_TREE_IMPLEMENTATION.md`**, **`docs/FUNCTION_REFERENCE.md`**, **`docs/MAINTENANCE.md`**, **`README.md`** updated accordingly. Biome docs: **six biomes**, **single-panel seeds** on main visitable panels (`!isForestHalo`), **round-robin** propagation.
- **Roadmap consolidation:** **`docs/Roadmap/Planning.md`** is the single product plan (**Done** vs **Todo**). Legacy **`Phase1.md`**, **`Phase2.md`**, and **`Roadmap.md`** stub to it. **`README.md`** lists **Planning** in the documentation vault.
- **Map Generator / Render bundle:** Roadmap docs updated — derived **`layer1`/`layer2`/`layer3`**, deterministic forests, **`render.json`** + packed **`tileset.png`**, static tile IDs ≥ **384**. See **[Planning.md](docs/Roadmap/Planning.md)**.

### Added
- **RMXP supporting files:** **`MapInfos.rxdata`** built from an **empty** Marshal hash + **`RPG::MapInfo`** rows **only** for exported map ids (`buildMapInfosFromExportedMapsAndDump`). **`Tilesets.rxdata`** from a **blanked** bundled template + **one** filled slot (**RM tileset id**), graphic **`tileset`**, Tier A **384–511** tables. Optional **`mergeMapInfosAndDump`** / **`mergeTilesetSlotAndDump`** remain for scripted merges into a live game. Always **`Export/README_EXPORT.txt`**. Logic in **`tools/RXConverter/rmxpMapInfos.mjs`**, **`tools/RXConverter/rmxpTilesets.mjs`**, **`tools/RXConverter/rmxpTable.mjs`** (`patchRmxpTable1DRange`). Sample **`tools/RXConverter/samples/MapInfos.blank.rxdata`** = empty hash.
- **Map Generator → RPG Maker XP maps**: **Package for RMXP** (Electron) rebuilds **`render.json`** + packed **`tileset.png`** automatically, then patches the bundled **`tools/RXConverter/samples/BLANKMAP.rxdata`** template and writes **`MapNNN.rxdata`** under **`Export/Data/`** in world reading order. Shared logic in **`tools/RXConverter/rmxpMapExport.mjs`**. See **[Planning.md](docs/Roadmap/Planning.md)** for export behavior.
- **Map Generator: stitched asset preview**: After loading an exported project, **Render preview** composites every visitable panel into one scrollable canvas using the same tileset mapping and Wang indices as the single-panel overlay (`recomputeMapGeneratorTileIndices`, `drawImage` per cell). Forest sprites use a stable hash (no `Math.random()`).
- **Map Generator: full export packaging**: **Download full (32px)** splits the world into **8192×8192** max canvases (`MG_EXPORT_CHUNK_PX`), encodes each with **`canvas.toBlob`**, and delivers **one browser download** — a **ZIP** of PNG tiles (`jszip`, `STORE` compression) when there is more than one chunk; a single small world still downloads one PNG. Avoids per-tile save prompts and GPU limits on giant single canvases.
- **Step 19: Forest Halo**: Every non-visitable panel bordering a visitable panel is marked `isForestHalo=true` and flooded with `T.FOREST` (preserving cliffs, ocean, and lake). Prevents hard darkness cutoffs at playable area edges in the game engine. Tile indices recomputed after.
- **Lake block-snapping (Step 4 rewrite)**: Step 4 inland lake conversion now operates on block-snapped `panelData` cell types instead of the raw continuous `elev` float array, giving lakes the same blocky axis-aligned silhouette as surrounding terrain.

### Changed
- **RMXP tile priorities + pack/export parity (`mgTilesetPack.js`, `rmxpExport.js`):** RPG Maker XP **`@priorities`** are written with **below characters (0)** and **same as characters (1)** only — the old **above characters (2)** path is removed. **Forest tops**, **`|f32|` top** chunks, **`FOREST_TOP`** cells, and **stamp `layer === 3`** use **normal (1)**; **cliffs**, **trunk/body**, **`FOREST_TRUNK` / `FOREST_BODY`**, and other non-canopy stamps use **below (0)**. Canopy **walk-behind** still relies on the **star** passage bit (`0x10`), not priority **2**. **`packMgTileset`** treats **`|tsb|`** and **`|fitb|`** phys keys like **`|ts|`** / **`|fit|`** for passage, terrain tags, and strip kind (**wang** vs **contain**).
- **RMXP export defaults (`App.jsx`):** Packed tileset is registered in **`Tilesets.rxdata` slot 2** (`RMXP_TILESET_ID`); first exported panel map is **`Map003`** (`RMXP_START_MAP_ID`), leaving **Map001**–**Map002** for the author. **`@tileset_id`** on written maps matches the tileset slot. (Main process still accepts any **`startMapId` ≥ 2**.)
- **RMXP export:** No template file dialog — always uses repo **`tools/RXConverter/samples/BLANKMAP.rxdata`** (`electron-main.js`).
- **Render / RMXP export layout**: **`tileset.png`** is written under **`Export/Graphics/Tilesets/`** (RPG Maker **`Graphics/Tilesets`** mirror). **`render.json`** records **`tileset.imageFile`** as `Export/Graphics/Tilesets/tileset.png`. **Export RMXP** copies that tileset into the same path under the chosen export root (still falls back to legacy project-root **`tileset.png`** if present).
- **Map Generator stitched preview**: Preview **cell px** is fixed at **4** (slider removed) for a predictable UI. On-screen stitched canvas size is capped (**16384** px max per side, `MG_CANVAS_SAFE_MAX_DIM`); if the preview would exceed that, the builder errors and suggests **Download PNG** instead.
- **Map Generator `T.WATERROAD` visuals**: In Map Generator (single-panel, stitched, and full export), water-route cells use the **water** layer for Wang indices and **`WATER` mapping assets** (same family as ocean/lake), not road tiles — procedural layout views can still show magenta for route debugging where applicable.
- **Map Generator cross-panel Wang indices**: Single-panel and stitched previews now build **(PANEL+2)²** layer bitmaps with a **1-cell world halo** from loaded neighbor panels (`loadMgNeighborPanelMap` + `mgWorldCell`), so water/road/grass autotiles align at panel boundaries instead of treating each panel as an isolated island. Unloaded neighbors behave like open edge (same as before).
- **Panel highway meander (Step 7)**: Panel-level A* scales land and existing-route step costs by seeded Simplex noise (`PANEL_ROUTE_MEANDER_WEIGHT`, `PANEL_ROUTE_MEANDER_SCALE`) so settlement-to-settlement corridors wind instead of hugging the shortest geometric path. Water-heavy panels use unchanged costs.
- **Wilderness dimming** (superseded): Previously reduced `playShift` from `0.33` to `0.15` for non-visitable panels. **Layout preview** now uses **full transparency** for non-visitable panels instead of dimming (**`regionRender.js`**).

### Fixed
- **RMXP `MapInfos.rxdata`:** RPG Maker showed **no maps** because `@hyrious/marshal` was dumping plain-object keys as **Ruby Strings**; RGSS expects **Fixnum** map ids. **`rmxpMapInfos.mjs`** now uses **`Map<number, …>`** when calling **`dump`** (and **`mergeMapInfosAndDump`** normalizes loaded data the same way).
- **RMXP Map001 in MapInfos:** Export **`buildMapInfosFromExportedMapsAndDump`** **clones map id 1** from **`tools/RXConverter/samples/MapInfos.rxdata`** (fallback **`MAP001`** row if missing), then appends panel map rows starting at the configured **`startMapId`** (app default **Map003**).
- **RM export / render.json — trees:** Forests now export as **three stacked bands** with static 32×32 tiles: **trunk on `layer1`**, **body on `layer2`**, **top on `layer3`** (ground baked into the tree art). The atlas is packed per-32×32 chunk, and anchors emit a multi-cell **`forestRmStamp`** list applied during `.rxdata` export.
- **Map Generator PNG downloads**: Replaced `canvas.toDataURL` with **`toBlob`** + object URL for mosaic downloads so very large full exports are not truncated/corrupted by huge base64 `data:` strings.
- **Residual ocean specks in visitable panels**: Coastal route panels that straddle the coastline could contain orphaned `T.OCEAN`/`T.LAKE` cells that were never touched by the forest or road passes, rendering as dark specks inside the playable area. Added a residual-ocean cleanup sub-pass after tile road stamping (now **Step 12.6**) to promote these isolated water cells to `T.LAND`. Water-dominant panels (legitimate ocean crossings) and cells connected to open water via cardinal neighbours are excluded to prevent over-promotion.
- **Ocean crossings converted to land roads**: The initial residual-ocean placement (before road stamping) caused ocean cells that should become `T.WATERROAD` to be promoted to `T.LAND` first, so `stampCenter` wrote `T.ROAD` instead. Fixed by moving it to after all road stamping (Steps **12–12.5**) so `T.WATERROAD` cells are already set before the cleanup runs.

### Refactor
- **Map Generator tile indexing**: `handleSelectPanel` uses shared `recomputeMapGeneratorTileIndices` with optional world context from neighbor panels (see cross-panel Wang change above).
- **Dead Code Removal**: Deleted `BEACH_LEVEL` constant (unused), `generateRegionOnce` function (unreachable dead code), `treeSubTile`/`treeLayer` assignment passes in `generateFromTerrain`, `generateTestPanel`, and `App.jsx::handleSelectPanel` (fields never read by any renderer path), and a duplicate `getCellPx` definition inside `generateFromTerrain`.
- **Shared `dir12` Function**: Extracted the Wang 2-corner tile index decision tree into an exported module-level function `dir12(bmp, cx, cy, stride)` in `layoutGen.js`. All three prior inline implementations (in `calculateTileIndices`, `generateTestPanel`, and `App.jsx::handleSelectPanel`) replaced with calls to the shared function.
- **Shared `cliffTileIdx` Function**: Extracted the 16-branch cliff direction decision tree into an exported module-level function `cliffTileIdx(N, S, E, W, NE, SE, SW, NW)` in `layoutGen.js`. All three prior inline trees (in global cliff pass — **Step 11** in current numbering — Step 18 organic blob pass, and `generateTestPanel`) replaced with calls to the shared function.
- **Named Constants**: Extracted ~19 inline magic numbers into named constants at module scope in `layoutGen.js`: `FBM_WEIGHTS`, `WARP_SCALE_FACTOR`, `PEAK_MIN_SEP_FACTOR`, `MIN_ISLAND_PANELS`, `SETTLEMENT_VIABILITY_LAND`, `SETTLEMENT_VIABILITY_UNIFORMITY`, `SETTLEMENT_SPACING_RADIUS`, `FOREST_BLOB_THRESHOLD`, `FOREST_BORDER_DEPTH_MIN`, `FOREST_BORDER_DEPTH_MAX`, `GRASS_BLOB_THRESHOLD`, `GRASS_BLOB_MIN_SIZE`, `GRASS_BLOB_MAX_SIZE`, `ASTAR_PANEL_WATER_DOMINANT_COST`, `ASTAR_PANEL_WATER_COST`, `ASTAR_TILE_CLIFF_PASSABLE_COST`, `ASTAR_TILE_CLIFF_WAYPOINT_PENALTIES`, `ASTAR_TILE_CLIFF_STAMP_PENALTIES`, `ORGANIC_BLOB_MIN_REGION`.
- **JSDoc**: Added comprehensive JSDoc to 25+ functions in `layoutGen.js` and 14 handler functions in `App.jsx`. Added module-level architectural comment to `App.jsx`. Added `PERF-NOTE` comments on the island growth loop and A* lazy-deletion strategy.
- **Documentation Sync**: All docs updated to reflect the current 18-step pipeline, correct A* costs, actual region data structure fields, exported function locations, and removed dead code. Stale references (`BEACH_LEVEL`, "11-stage", "1,600 lines", `treeSubTile`/`treeLayer`) corrected throughout.

---

## [0.1.0] - 2026-04-09

### Added
- **18-Step Procedural Pipeline** (originally implemented as 16 stages, since grown to 18 steps with Blocky Elevation Refinement at Step 3.5 and additional cliff/grass/cleanup/tile/organic passes at Steps 12–18): Transitioned from a simple 8-stage grid to a complex multi-stage pipeline including Island Injection, Bridge Widening, and a multi-pass Forest System.
- **Simplex Noise Integration**: Replaced primitive value noise with `simplex-noise` for smoother, artifact-free landmasses and domain warping.
- **Multi-Pass Canvas Rendering**: Implemented an offscreen "baking" strategy in `App.jsx` with 4 separate layers (Terrain, Biomes, Overlays, Road Debug) for 60FPS pan/zoom performance.
- **Ledge Shader**: Added an elevation-aware outline pass to create pseudo-3D height and depth.
- **Biome Zoning**: BFS-based biome assignment (6 variants) with boundary logic at route junctions.
- **Tile-Level A\***: Implemented turn-constrained A* with `getStableEdgePoint`/`getPanelInteriorPoint` waypoints and 3-tile-wide `stampPath` for cleaner settlement-to-settlement road paths.
- **Cliff Direction Encoding**: 12-tile Wang strip for directional cliff face rendering, using `cliffTileIdx`.
- **Grass Terrain Type**: Organic grass blob placement with size enforcement.
- **Tree Overlay Rendering**: 2×3 sprite sheet with brick-stagger spatial anchoring over FOREST cells.
- **Manual Settlement Placement**: User-driven settlement injection via `placeManualSettlement`.

### Fixed
- **Seed Determinism**: Unified all randomization under the `Mulberry32` PRNG.
- **Coastal Artifacts**: Added Cellular Automata shore smoothing to remove single-pixel water blobs.
- **Diagonal Pinch Artifacts**: Added diagonal pinch resolver in Step 3.5 to prevent invalid cliff geometry.

### Changed
- **Tech Stack**: Upgraded to **Vite 5** and **React 18**.
- **Port Assignment**: Moved development server to port **5176** to avoid common conflicts.
