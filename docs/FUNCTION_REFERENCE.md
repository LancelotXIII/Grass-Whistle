# Function Reference

Catalog of major exported APIs and handlers across **`layoutGen.js`**, **`render/regionRender.js`**, **`mg/mgCore.js`**, and key **`App.jsx`** tool closures. For exhaustive private helpers inside `generateFromTerrain`, read **`ENGINE_PIPELINE.md`** and source comments.

---

## `src/renderer/layoutGen.js`

---

### Exported Public API

These are the functions imported by `App.jsx` and any other consumers. Calling anything else in `layoutGen.js` directly is unsupported.

---

#### `generateRegion({ settlements, seed, lockedSettlements, width, height, secretHalo })`
**Primary entry point.** Runs the full procedural pipeline (`generateFromTerrain`; see **`ENGINE_PIPELINE.md`**).

Wraps `generateTerrain` + `generateFromTerrain` in a retry loop (up to 20 attempts) to guarantee at least 3 islands and 1 lake. Each attempt uses `seed + attempt` so the entire retry space is deterministic. Falls back to the 20th attempt if thresholds are never met.

| Param | Type | Description |
|---|---|---|
| `settlements` | `number` | Target settlement cluster count (size varies). |
| `seed` | `number?` | Integer seed. Defaults to `Date.now()`. |
| `width` | `number?` | World width in panels. Clamped to **1–128**; default **`DEFAULT_MAP_WIDTH`** (**16**). |
| `height` | `number?` | World height in panels. Clamped to **1–128**; default **`DEFAULT_MAP_HEIGHT`** (**16**). |
| `secretHalo` | `boolean?` | Enables secret halo / bonus pocket behavior in Step 19+. Default **true**. |
| `lockedSettlements` | `Array?` | Pre-placed settlement descriptors `{ px, py, type }`. |

**Returns** `{ panelData, width, height, roadPaths, roadWaypoints, panelStats, assignedPanels, terrain, secretHalo, … }` — includes pocket/zone fields used by the Layout UI (`pocketIdGrid`, `pocketCellsById`, etc.).

---

#### `regenerateFromTerrain({ terrain, settlements, lockedSettlements, secretHalo })`
**Re-runs Steps 6–20 on a fixed terrain snapshot.**

Used after manual settlement placement — the terrain stays fixed (no re-noise, no re-bridging) but all settlements, roads, forests, grass, and tile indices are recomputed from scratch with the new locked list.

| Param | Type | Description |
|---|---|---|
| `terrain` | `Object` | `region.terrain` snapshot from `generateRegion`. |
| `settlements` | `number` | Target settlement cluster count (size varies). |
| `lockedSettlements` | `Array?` | Pre-placed settlement descriptors. |
| `secretHalo` | `boolean?` | Optional override; defaults from **`terrain.secretHalo`**, else **true**. |

**Returns** Same shape as **`generateRegion`** (including `terrain`, `secretHalo`, pocket fields).

---

#### `placeManualSettlement(region, px, py, type)`
**Immediately places a single settlement cluster on an existing region.**

Runs the same BFS cluster growth as the pipeline's `addCluster`, but directly on the live `region` object. Does NOT recompute roads, forest, grass, or tile indices. Call `regenerateFromTerrain` after for a full refresh.

| Param | Type | Description |
|---|---|---|
| `region` | `Object` | Region returned by `generateRegion` or `regenerateFromTerrain`. |
| `px` | `number` | Panel X coordinate. |
| `py` | `number` | Panel Y coordinate. |
| `type` | `'city'\|'town'\|'poi'` | Placement label (maps to settlement size: large/medium/small). |

**Returns** The same `region` object mutated in place (unchanged if placement is invalid).

---

#### `generateTestPanel(asciiMap?)`
**Generates a single isolated **`PANEL`×`PANEL`** panel from an ASCII map string** (see `PANEL` in `constants.js`; the default fixture is still **32×32** characters — extend/pad if you raise `PANEL`).

Used by the **Map Generator** tile overlay (`handleTestPanel` / **Apply**). Provides a deterministic panel for validating tileset and cliff rendering without a full region generation pass.

ASCII key: `.`=OCEAN, `L`=LAND(elev 1), `H`=LAND(elev 2, produces cliffs), `R`=ROAD, `F`=FOREST, `G`=GRASS, `W`=OCEAN.

| Param | Type | Description |
|---|---|---|
| `asciiMap` | `string?` | Newline-separated ASCII grid (`PANEL` lines × `PANEL` chars, ignoring whitespace). Defaults to `DEFAULT_TEST_MAP`. |

**Returns** `{ grid, biomeName, waterDominance, isRoute, settlement }`

---

#### `generateElevDebug({ seed, width, height })`
**Returns raw elevation data for debugging (no terrain type assignment).**

Produces the raw `Float32Array` from `generateLandMass` before any quantization or type assignment. Used by dev tooling to visualize the raw elevation field.

| Param | Type | Description |
|---|---|---|
| `seed` | `number?` | Integer seed. Defaults to `Date.now()`. |
| `width` | `number?` | World width in panels (default **`DEFAULT_MAP_WIDTH`**). |
| `height` | `number?` | World height in panels (default **`DEFAULT_MAP_HEIGHT`**). |

**Returns** `{ elev: Float32Array, W, H, width, height }`

---

#### `dir12(bmp, cx, cy, stride)`
**Wang 2-corner tile index function. Returns tile strip column 0–12.**

Encodes which of a cell's 8 neighbours are in the same terrain layer. The decision tree maps edge configurations to one of 13 tileset columns (0=N edge, 1=NE outer, 2=E edge … 12=interior fill).

Works at any bitmap scale — pass `stride=W` for world-scale bitmaps, `stride=PANEL` for single-panel bitmaps.

| Param | Type | Description |
|---|---|---|
| `bmp` | `Uint8Array` | Flat row-major bitmap (1=same layer, 0=other layer). |
| `cx` | `number` | X coordinate of the cell. |
| `cy` | `number` | Y coordinate of the cell. |
| `stride` | `number` | Row width of the bitmap. |

**Returns** `number` — tile strip index 0–12.

---

#### `cliffTileIdx(N, S, E, Ww, NE, SE, SW, NW)`
**Cliff direction encoder. Returns cliff strip column 0–11.**

Takes 8 boolean flags (true = that neighbour is at lower elevation) and maps them to a directional cliff tile. Decision tree priority: straight edges → outer corners (two cardinals + shared diagonal) → inner corners (diagonal or two cardinals without diagonal).

| Param | Type | Description |
|---|---|---|
| `N,S,E,Ww` | `boolean` | Cardinal neighbour is lower. |
| `NE,SE,SW,NW` | `boolean` | Diagonal neighbour is lower. |

**Returns** `number` — cliff strip index 0–11.

---

### Internal Pipeline Functions

These are module-private (not exported). Listed for agent reference when reading the code.

---

#### `mulberry32(seed)`
**Seeded PRNG factory.** Returns a `() => number` function producing deterministic floats in [0, 1). All generation passes use this — never `Math.random()`. Each call to the returned function advances shared state by one step.

#### `valueNoise(rand, W, H, scale)`
**Simplex noise field generator.** Returns a `Float32Array` of noise values in [0, 1] for a W×H bitmap at the given frequency scale. Used for elevation, warp fields, blob thresholds, and density.

#### `generateLandMass(rand, W, H)`
**Pipeline Step 1.** Generates the world elevation field via domain warping + 6-octave FBM + mountain peaks with starburst ridge noise + peninsula anchors + valley carving + plateau quantization. Returns a `Float32Array` of continuous elevation values in [0, 1].

#### `boxBlur(src, W, H, radius)`
**O(W×H) separable 2-pass box blur.** Approximates Gaussian smoothing via a sliding-window accumulator (complexity does not grow with radius). Used for elevation normalization and shoreline blending.

#### `makeGrid()`
**Allocates a fresh 32×32 ocean panel.** Each cell starts as `{ type: T.OCEAN, elevation: 0 }`. Used to initialize all `panelData` entries.

#### `generateTerrain(seed, width, height)` (internal)
**Pipeline Steps 1–5 (with PRNG construction).** Constructs a fresh `mulberry32` from `seed`, then delegates to `generateTerrainWithRand`. Map size uses `width`/`height` in panels (defaults **`DEFAULT_MAP_WIDTH`** / **`DEFAULT_MAP_HEIGHT`** via `clampMapPanels`).

#### `generateTerrainWithRand(rand, width, height, W, H)`
**Pipeline Steps 1–5 (with existing PRNG).** Runs all terrain passes: land mass → island injection → bridge widening → blocky elevation refinement → lake conversion + CA smoothing. Separating PRNG construction from logic allows the retry loop to attempt terrain without rebuilding the call stack.

#### `cloneTerrainPanelData(panelData)`
**Deep-clones `type` and `elevation` only.** Preserves the terrain snapshot so Steps 6–20 can mutate freely without affecting `region.terrain`. Derived fields (`tileIndex`, `settlement`, `isRoute`, etc.) are intentionally omitted — they will be recomputed.

#### `generateFromTerrain({ panelData, width, height, islandSeeds, rand, seed, settlements, lockedSettlements })`
**Pipeline Steps 6–20.** Orchestrator for all gameplay feature passes. Operates on a pre-cloned `panelData` and a PRNG positioned after Step 5. Returns the fully populated region object. Contains all the internal closures listed below as nested functions.

---

### Closures inside `generateFromTerrain`

These are defined inside the main pipeline function as `const fn = ...`. They close over `panelData`, `W`, `H`, `seed`, and the PRNG state.

---

#### `addCluster(rootStat, sizeGoal, type)`
**BFS settlement cluster growth.** Starting from `rootStat`, expands outward via randomised BFS, absorbing neighbours that share the dominant elevation and are not already assigned. Enforces `SETTLEMENT_SPACING_RADIUS` separation. Mutates `panelData`, `assignedPanels`, and `clusters`.

#### `panelRouteAStar(startKey, targetKeysSet)`
**Panel-level A\* routing.** Finds the cheapest route from one settlement panel to any panel in `targetKeysSet`. Builds the "Grand Highway" skeleton. Uses `MinHeap` with lazy-deletion. Base costs: water-dominant=15.0, water=5.0, existing route=0.1, land=1.0. For steps whose base cost is ≤1 (land or reuse), the cost is scaled by seeded Simplex noise (`panelRouteMeanderNoise`) so highways meander; see Step 7 in `ENGINE_PIPELINE.md` (`PANEL_ROUTE_MEANDER_WEIGHT`, `PANEL_ROUTE_MEANDER_SCALE`).

**Returns** `string[]|null` — ordered panel keys, or null if unreachable.

#### `getPassableCliffTiles(px, py)`
**Finds cliff tiles that can be crossed by roads.** Only straight-edge cliffs (tileIndex 0=N, 2=E, 4=S, 6=W) where all 3 adjacent same-axis cliffs are also straight-edge are considered passable (3-tile-wide corridor required).

**Returns** `Set<number>` — flat local indices of passable cliff tiles.

#### `buildCliffDistMap(px, py)`
**BFS distance-to-nearest-cliff map.** Seeds from all cliff tiles in the panel, expands outward via BFS. Values capped at 4. Used by `makeTileCost` to penalize roads that hug cliff edges.

**Returns** `Int8Array` length PANEL×PANEL — distance to nearest cliff (max 4; 127=none).

#### `makeTileCost(px, py, passableCliffs, cliffDist)`
**Produces a tile cost function clamped to a single panel.** Tiles outside the panel → Infinity. Cliff tiles → Infinity unless in `passableCliffs` (then `ASTAR_TILE_CLIFF_PASSABLE_COST`). All others get terrain base cost + cliff proximity penalty from `ASTAR_TILE_CLIFF_STAMP_PENALTIES`.

**Returns** `(x, y) => number` — cost function for `tileRoute`.

#### `tileRoute(swx, swy, twx, twy, tileCost)`
**Tile-level A\* between two world-pixel coordinates.** Cardinal moves only. `tileCost` is injected so this is reusable across both the road stamp pass and the cliff-side paving pass. Uses `MinHeap` with lazy-deletion (acceptable at PANEL×PANEL = 1024 max nodes).

**Returns** `Array<[number,number]>|null` — ordered [wx, wy] world pixels, or null.

#### `isNearCliff(wx, wy)`
**3×3 neighbourhood cliff check.** Returns true if any tile in the 3×3 neighbourhood of world pixel (wx, wy) is a cliff. Kept for internal utilities/debug; road stamping no longer uses this as a guard (stamping is only blocked on `T.CLIFF` tiles themselves).

#### `stampCenter(wx, wy)`
**Stamps the centre tile of a road.** Can overwrite water cells (they become `T.WATERROAD`). Silently skips out-of-bounds or cliff-adjacent positions.

#### `stampSide(wx, wy)`
**Stamps a widening side tile of a road.** Unlike `stampCenter`, does NOT overwrite water cells — roads only widen onto land. Silently skips out-of-bounds or cliff-adjacent positions.

#### `stampPath(path)`
**Stamps a 3-tile-wide road along a pixel path.** On straight segments, widens perpendicularly via `stampSide`. At turns, fills a box to avoid gaps. The centre tile is always written via `stampCenter`. Sub-passes 12.4 (cliff-side paving) and 12.5 (road blob cleanup) run immediately after all `stampPath` calls within **Step 12**.

#### `getStableEdgePoint(px, py, dx, dy)`
**Selects a deterministic road entry/exit point on the shared edge between two panels.** Uses a sub-PRNG seeded from `seed` and edge coordinates so the same edge always resolves to the same point regardless of traversal order. Prefers land tiles in the centre third of the edge; falls back to best-scoring candidate. Scores account for terrain type, cliff proximity, and distance to panel centre.

**Returns** `[number, number]|null` — world pixel [wx, wy], or null.

#### `getPanelInteriorPoint(px, py, cliffDist)`
**Finds the cheapest road waypoint in the centre 50% of a panel.** Scans the inner 50% of panel tiles, scoring by terrain cost and cliff proximity. Ties broken by Euclidean distance to panel centre.

**Returns** `[number, number]|null` — world pixel [wx, wy], or null.

---

### Utility Classes

#### `MinHeap`
**Binary min-heap.** Used as the priority queue in both `panelRouteAStar` and `tileRoute`. Supports O(log n) `push` and `pop`. Does NOT support decrease-key — callers use lazy-deletion instead (`if (g > dist[key]) continue`).

| Method | Description |
|---|---|
| `push(item)` | Insert item. Item must have an `f` field (priority). |
| `pop()` | Remove and return the minimum-priority item. |
| `size` | Current number of items. |

---

## `src/renderer/render/regionRender.js`

---

### `mgCanvasColors()`
**Reads CSS custom properties** from `document.documentElement` (e.g. `--canvas-bg`, `--color-neon`) with hex fallbacks. Used by `bakeRegion` / `renderRegion` for overlay strokes and the preview canvas background fill.

---

#### `bakeRegion(region, exportMode?, showPanelGrid?)`
**Expensive one-time pixel bake.** Called from `LayoutGenerator` after `generateRegion` / `regenerateFromTerrain`.

Builds offscreen canvases:
- **`map`** — per-cell terrain RGBA. **Preview** (`exportMode=false`): only **`isRoute` / `settlement`** panels are opaque; other panels are **fully transparent** so the UI background shows through. **Export** (`exportMode=true`): all panels drawn opaque (full world for `world.png`).
- **`overlay`** — optional panel grid strokes, settlement / halo debug outlines.
- **`biomeMap`** — biome tint `ImageData` (**visitable panels only** in preview).
- **`cliffBiomeMap`** — cliff-only biome debug tint (**visitable panels only** in preview).
- **`roadDebug`** — road polylines + waypoint dots (world-sized).
- **`pocketOutlines`** — precomputed `Path2D` list for zone-hover outline (preview).

| Param | Type | Description |
|---|---|---|
| `region` | `Object` | Region from `generateRegion`. |
| `exportMode` | `boolean?` | If true, export-style bake (full opacity; no biome/cliff debug image passes). Default false. |
| `showPanelGrid` | `boolean?` | Whether to draw route/settlement panel grid strokes on the overlay when not in export mode. Default true. |

**Returns** `{ map, overlay, biomeMap, cliffBiomeMap, roadDebug, pocketOutlines }`

---

#### `renderRegion(canvas, region, view, baked, showRoadDebug?, showBiomes?, showCliffBiome?, hoverZoneId?)`
**Cheap per-frame composite** — fills the display canvas with **`mgCanvasColors().crust`**, then composites `baked.map`, optional biome / cliff-biome layers, `overlay`, optional `roadDebug`, and optional zone-hover stroke.

| Param | Type | Description |
|---|---|---|
| `canvas` | `HTMLCanvasElement` | Target display canvas. |
| `region` | `Object` | Region (dimensions). |
| `view` | `{ zoom, panX, panY }` | Camera. |
| `baked` | `Object` | Output of `bakeRegion`. |
| `showRoadDebug` | `boolean?` | Draw road debug layer. |
| `showBiomes` | `boolean?` | Draw biome tint layer. |
| `showCliffBiome` | `boolean?` | Draw cliff-only biome debug layer. |
| `hoverZoneId` | `number?` | Pocket id for hover outline (0 = none). |

---

## `src/renderer/mg/mgCore.js` (Map Generator core)

These exports power stitched preview, full PNG/ZIP export, and render-bundle assembly. **`App.jsx`** imports them into the **MapGenerator** component.

#### `recomputeMapGeneratorTileIndices(grid, context?)`
#### `loadMgNeighborPanelMap(projectPath, px, py, centerGrid)`
#### `mgWorldCell` / `buildMgExtendedLayerBmp` / `buildMgMosaicCanvas` / `mgExportFullMosaicChunked` / …

Same behavior as previously documented under “Map Generator helpers”; see **`ARCHITECTURE.md`** and source JSDoc in **`mgCore.js`** for signatures.

---

## `src/renderer/App.jsx`

---

### React — `LayoutGenerator` handlers

The following closures live inside **`LayoutGenerator`**. They close over component state and refs.

---

#### `canvasToPanelCoords(clientX, clientY)`
**Converts screen pixel coordinates to panel grid coordinates.**

Accounts for canvas offset, zoom level, and pan offset. Returns `{ wx, wy }` in world pixels and `{ px, py }` in panel units.

#### `handleContextMenu(e)`
**Prevents the browser context menu** on the layout canvas (`preventDefault`) so **right-drag pan** matches middle-mouse pan. Manual settlement placement via context menu is **currently disabled** (handler does not open `ctxMenu`).

#### `handlePlaceSettlement(type)`
**Would place a settlement** at `ctxMenu` panel coordinates when that menu is open — calls `placeManualSettlement` and bumps `manualSettlements`. With the context menu disabled, this path is inactive unless `ctxMenu` is wired again.

#### `handleGenerate()`
**Triggers a full map generation.**

Reads form inputs (seed, settlements), calls `generateRegion`, then calls `bakeRegion` on the result and stores it in state.

#### `handleExport()`
**Exports the current region to a Grasswhistle project folder** (Electron IPC).

Re-bakes with **`bakeRegion(region, true)`** for a clean `world.png`, writes **`project.json`** (metadata includes **`seed`** from **`region.terrain.seed`** when present), **`panels/*.json`**, and panel PNGs for visitable panels. Does not perform a simple single-file PNG download.

#### `handleWheel(e)`
**Handles scroll-to-zoom.** Adjusts `view.zoom` clamped to [0.5, 8]. Zoom is applied toward the cursor position so the point under the mouse stays fixed.

#### `handleMouseDown(e)`
**Starts pan drag on middle button (`button === 1`) or right button (`button === 2`).** Left button does not start a drag here (used for zone clicks on mouse-up).

#### `handleMouseMove(e)`
**Updates pan offset during drag.** Applies delta from the mouse-down anchor to `view.panX` / `view.panY`.

#### `handleMouseUp(e)`
**Ends pan drag** (commits `view` to React state). If the pointer was not dragging, a **left click** while a **zone hover id** is active opens the **zone biome** picker menu (`zoneBiomeMenu`).

---

### React — `MapGenerator` handlers (subset)

These live inside **`MapGenerator`** in the same `App.jsx` file.

#### `handleLoad()`
**Loads an exported project directory** via Electron IPC (`load-project`). Populates `metadata`, `panels`, `mapping`, `worldPNG`, and asset slots.

#### `handleRefreshAssets()` / `handleSaveMapping(m)`
Re-scan loose assets or write **`mapping.json`** for the loaded project path.

#### `handleTestPanel(map?)`
Builds **`generateTestPanel(map)`** output and opens the **panel overlay** at synthetic coordinates **`(-1, -1)`** for ASCII / tileset experiments. The overlay **Apply** button re-invokes this path and may call **`saveTestPanel`** IPC.

*(Per-panel inspection from exported `panels/*.json` was removed from the sidebar; cross-panel Wang for previews runs inside **`mgCore.js`** when building the stitched mosaic.)*
