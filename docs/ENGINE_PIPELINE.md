# Engine Pipeline: Procedural Generation

Grasswhistle uses a deterministic, multi-stage procedural engine to generate the structural **"bones"** of 2D RPG layouts. It focuses on terrain topology, settlement placement, and route connectivity, providing a functional skeleton for further development.

---

## 🏗️ Core Architecture

- **Logic Engine**: Pure JavaScript (`layoutGen.js`). Uses a custom PRNG (Mulberry32) for bit-level reproducibility.
- **Render Stack**: HTML5 Canvas — `App.jsx` hosts the Layout Generator view; **`src/renderer/render/regionRender.js`** bakes terrain (`bakeRegion`) and composites each frame (`renderRegion`). Non-visitable panels are transparent in preview so the canvas background shows through.

---

## 🕰️ Generation Pipeline (`generateFromTerrain`)

The full pipeline runs inside `generateFromTerrain` in `layoutGen.js`. **`// --- Step N ---` comments are numbered in execution order** (Steps **1–20**; biome zoning is **Step 20** and runs last, after the forest halo).

**Summary:** Steps 1–5 build base terrain; 6–7 settlements and panel highways; 8–10 forests; **11** cliff detection; **12** tile-level roads (with sub-passes **12.4–12.6**); **13–16** grass and edge cleanup; **17** Wang `tileIndex` (`calculateTileIndices`); **18** organic blobs; **19** forest halo + secret halo; **20** biome zoning (`pd.biome` / `cell.biome` on all panels).

| Step | What runs |
| :---: | :--- |
| 1–5 | Noise, islands, bridges, refinement, lakes, basin smoothing |
| 6–7.6 | Settlements, panel A*, breakers, scenic links |
| 8–10 | Forest borders, blobs, reachability BFS |
| 11 | Cliff detection + `cliffTileIdx` |
| 12 | Tile-level road stamping (+ sub-passes 12.4–12.6) |
| 13 | Grass blob placement |
| 14 | Grass blob size enforcement |
| 15 | Thin-strip cleanup |
| 16 | Orphan `T.LAND` cleanup |
| 17 | `calculateTileIndices()` (Wang / `dir12`) — first full pass |
| 18 | Organic terrain blobs; recomputes tile indices inside the pass |
| 19 | Forest halo + secret halo; `calculateTileIndices()` after |
| 20 | **Biome zoning** (single-panel seeds, propagation, paint all panels) |

---

### Step 1: Global Elevation & Domain Warping
The engine generates a base heightmap using **Simplex Noise**. To create organic coastlines, it applies **Domain Warping**:
- Two additional noise fields (`warpA`, `warpB`) offset the coordinates of the primary elevation noise.
- Elevation is composed of 6 octaves of Fractional Brownian Motion (FBM), weighted by `FBM_WEIGHTS = [0.38, 0.26, 0.16, 0.10, 0.06, 0.04]`.
- **Land vs ocean extent**: Land is masked to an **ellipse** around the map center (`borderFrac` in `generateLandMass` — larger values produce a **wider** island and **less** ocean at the edges). Pixels outside the mask stay at zero elevation.
- After blur/quantization, cells at or below **`SEA_LEVEL`** (`constants.js`) become water — lower thresholds yield **more** classified land for the same heightmap.
- Raw elevation is then **quantized** into 6 discrete integer levels (1–6) for land, plus 0 for ocean.

### Step 2: Small Island Injection
The engine scans for 6×6 ocean blocks to place secondary islands.
- Each island is stamped with independent warp/FBM noise profiles.
- Islands grow until they reach a minimum size (`MIN_ISLAND_PANELS = 50` land panels) to ensure map density.

### Step 3: Land Bridge Widening
To ensure connectivity between the main massif and secondary islands, the engine fills 2-panel wide corridors. This creates natural-looking "land bridges" or shallows that the routing engine can later utilize for roads.

### Step 3.5: Blocky Elevation Refinement
A second elevation pass enforces a controlled, blocky terrain style:
- The map is divided into 4×4 BLOCK-sized regions. Within each block, elevations are snapped toward a dominant level via an 8-pass relaxation loop.
- A **single-step enforcement** pass prevents impossible elevation jumps of more than 1 level between adjacent cells.
- A **diagonal pinch resolver** detects and breaks "pinch" artifacts where two diagonal pairs of differing elevations meet at a corner, removing visual noise that causes invalid cliff geometry.

### Step 4: Inland Lake Conversion
Any ocean region not reachable from the map boundary via BFS is reclassified as a **Lake** (`T.LAKE`).
- **Tiny Blobs**: Landlocked water smaller than 1 panel is converted to Level-1 land to avoid "pixel noise."

### Step 5: Enclosed Basin Smoothing & Shore Cleanup
Level-1 ground pockets entirely surrounded by higher terrain (Level 2+) are converted into lakes.
- **Cellular Automata (CA)**: A 2-pass CA smoothing step cleans lake edges, removing 1×1 jags and ensuring organic shorelines.

---

### Step 6: Settlement Placement (Clustering)
Settlements are spawned in prioritized passes:
- **Peak Constraint**: Level-6 (highest) peaks are guaranteed to get a settlement (typically **small**).
- **Coastal Constraint**: Early spawns prioritize harbors along coastlines.
- **Island Constraint**: Islands with sufficient land receive at least one settlement.
- **Central Hub**: A central settlement is placed if none exists near the map center.
- **Furthest-Point Spreading (FPS)**: Balances density by placing remaining settlement budget in the largest available land voids.
- **Spacing**: Clusters must be at least `SETTLEMENT_SPACING_RADIUS = 3` panels apart.

#### Steps 6.1–6.8: Constraint Sub-Passes
Six targeted constraint sub-passes each attempt to place a settlement meeting specific geographic criteria (coastal proximity, land coverage, elevation uniformity). Panels must meet `SETTLEMENT_VIABILITY_LAND = 0.75` (≥75% land coverage) and `SETTLEMENT_VIABILITY_UNIFORMITY = 0.75` (elevation uniformity ≥75%) to qualify.

---

### Step 7: Panel-Level A* Routing
A "Grand Highway" pass defines which 32×32 panels contain roads.
- **Costing Weights**:
  - **Existing Route**: `0.1` (Strongly encourages highway sharing)
  - **Default Land**: `1.0`
  - **Has Water**: `ASTAR_PANEL_WATER_COST = 5.0` (Moderate penalty)
  - **Water-Dominant**: `ASTAR_PANEL_WATER_DOMINANT_COST = 15.0` (Expensive — favors coastal bypass)
- **Meander (land / reuse only)**: Before Step 7, `createNoise2D(rand)` builds `panelRouteMeanderNoise`. For neighbor steps whose base cost is land (`1.0`) or existing route (`0.1`), the step cost is multiplied by `1 + PANEL_ROUTE_MEANDER_WEIGHT * noise(nx * PANEL_ROUTE_MEANDER_SCALE, ny * PANEL_ROUTE_MEANDER_SCALE)` (Simplex in ~[-1, 1]). Water penalties are unchanged so connectivity stays reliable. Tuning: `PANEL_ROUTE_MEANDER_WEIGHT` (0 = straight corridors, default ~0.45), `PANEL_ROUTE_MEANDER_SCALE` (lower = broader, smoother curves). This consumes PRNG state before Step 8, so maps are still seed-deterministic but not byte-identical to builds from before this pass existed.
- **Result**: `panelData[key].isRoute = true` on all panels along a route.

---

### Step 8: Forest Border Stamping
The wilderness is populated with vegetation in stages. Border stamping runs first:
- Unvisitable panel edges "bleed" forest inward by a random depth of `FOREST_BORDER_DEPTH_MIN = 2` to `FOREST_BORDER_DEPTH_MAX = 6` tiles.
- **Settlement panels** use the same noise field but clamp depth to **3–6** (minimum 3).

### Step 9: Forest Detail Blobs
Mid-frequency Simplex noise creates organic forest blobs within landmasses:
- Cells with noise above `FOREST_BLOB_THRESHOLD = 0.68` are stamped as `T.FOREST`.

### Step 10: Forest Reachability BFS
Any land tile unreachable from a settlement without crossing forest or water is converted to forest, forming dense, impassable wilderness zones. This step ensures the forest system creates meaningful barriers rather than cosmetic noise.

---

### Step 11: Cliff Detection & Direction Encoding
Each solid cell (LAND, FOREST, ROAD) adjacent to a lower-elevation solid neighbor becomes `T.CLIFF`. The `tileIndex` encodes which direction the cliff drops toward, mapping to one of 12 tileset variants:
- **Straight edges** (indices 0, 2, 4, 6): One cardinal direction lower, no perpendicular drop.
- **Outer corners** (indices 1, 3, 5, 7): Two cardinals and their shared diagonal all lower — exposed tip.
- **Inner corners** (indices 8–11): Diagonal-only drop, or two cardinals without their shared diagonal also being lower.

This logic is centralized in the exported `cliffTileIdx(N, S, E, W, NE, SE, SW, NW)` function. Cliff `tileIndex` values are not overwritten by the Wang tiling pass (Step 17).

---

### Step 12: Tile-Level Road Stamping
Within Route Panels, the engine routes individual 1×1 tiles using a specialized A* with turn constraints:
- **Turn Constraint**: Roads must travel straight for at least 2 tiles before turning.
- **Straightness Bias**: Straight segments have a momentum bonus, creating cleaner RPG-style paths.
- **Waypoints**: `getStableEdgePoint` computes stable panel-edge anchors; `getPanelInteriorPoint` can compute an interior goal when a panel needs an endpoint.
- **Topology**:
  - **2-edge corridor panels** route edge→edge directly (no forced interior merge).
  - **3–4 edge junction panels** build a shared **spine** path first (between the most separated edges), then connect remaining edges to the nearest reachable point on the spine.
  - **Endpoint panels** (settlements / special endpoints) route edges into a stable interior goal so roads don’t stop at borders.
- **Directional intent**: interior waypoint scoring mildly penalizes candidates that lie “behind” the incoming edge direction to reduce immediate reversals/U-turn-looking joins.
- **Stamping**: `stampPath` writes a 3-tile-wide road with corner padding.
- **Cliffs**: stamping is blocked only on `T.CLIFF` tiles themselves (roads may stamp adjacent to cliffs).
- **Weights**: Cliff (impassable via `ASTAR_TILE_CLIFF_PASSABLE_COST = 500`) > Forest (50) > Land (1) > Existing Road (0.01).
- Sub-passes 12.4 (cliff-side paving) and 12.5 (road cleanup) run immediately after the main stamp.

#### Step 12.6: Residual Ocean Cleanup
Coastal route panels can contain `T.OCEAN`/`T.LAKE` cells that were never touched by the forest or road passes, which would render as dark specks inside the playable area. This pass promotes those orphaned water cells to `T.LAND` at the panel's dominant elevation.

Two guards prevent over-promotion:
- **Water-dominant panels are skipped entirely** — panels where water covers >50% of tiles are legitimate ocean-crossing routes; their water cells are left intact.
- **Isolation check** — within qualifying panels, only cells with no water cardinal neighbour are promoted. Cells that are part of a connected inlet (touching open ocean through a chain of water cells) are left as water.

Must run after Step 12.5 so that `T.WATERROAD` cells (ocean tiles the road already crossed) are set first and not overwritten.

---

### Secret halo (current behavior)
Secret halos are special “forest halo” regions (Step 19) that become enclosed pockets or interior voids.

- **Grouping**: enclosed halo clusters use **4-neighbor panel connectivity** (edge-connected).
- **Restore**: secret halo panels are restored to `T.LAND` interiors with a forest border:
  - minimum thickness **4 tiles** everywhere on any exterior edge
  - noise bulges deepen the border up to **16 tiles**
- **Internal connectivity**: each cluster stamps an internal connected corridor network (spanning tree over panels). In secret halos, this uses a **bulldoze-ground** stamp (converts to `T.LAND`) rather than stamping visible `T.ROAD`.
  - preserves `T.OCEAN` / `T.LAKE` / `T.WATERROAD` / `T.CLIFF` and does not overwrite `T.GRASS`
- **Water access classification**: clusters are flagged per panel:
  - `isSecretHaloWaterAccess=true` if the cluster borders a continuous water body that also borders any main (non-halo) visitable tile
  - otherwise `isSecretHaloLandLocked=true`
- **Landlocked escape hatch**: landlocked clusters carve a 2-wide bulldozed corridor from a chosen boundary panel to a nearby main visitable panel.

---

### Step 13: Grass Blob Placement
`T.GRASS` terrain is stamped in organic blobs on land panels not already marked as forest or route:
- Cells with Simplex noise above `GRASS_BLOB_THRESHOLD = 0.55` are candidates.
- Blobs are grown via BFS to fill cohesive regions.

### Step 14: Grass Blob Size Enforcement
Grass blobs that are too small or too large are reverted to `T.LAND`:
- Minimum size: `GRASS_BLOB_MIN_SIZE = 32` cells.
- Maximum size: `GRASS_BLOB_MAX_SIZE = 36` cells.
- This prevents single scattered cells and runaway blob overgrowth.

### Step 15: Thin-Strip Cleanup
A sweep pass removes thin single-cell corridors of grass or cliff that would create visual artifacts when rendered. Cells surrounded by incompatible neighbors are reverted to their underlying terrain type.

### Step 16: Orphan LAND Cleanup
Single-tile `T.LAND` specks (no land-like cardinal neighbors) are upgraded to `T.FOREST` to avoid stray pixels. Settlement panels are excluded.

---

### Step 17: Tile Index Calculation
The Wang 2-corner `tileIndex` is computed for every non-cliff cell using the exported `dir12(bmp, cx, cy, stride)` function:
- A `LAND_BMP` Uint8Array marks which cells are "solid" (land, forest, road, grass, cliff).
- The 12-tile index encodes which of the 8 neighbors are also solid, mapping to the correct directional tile in the Wang tileset.
- `T.CLIFF` cells are excluded — their `tileIndex` was set in Step 11 and must not be overwritten.

`calculateTileIndices()` is invoked again after Step 18 organic blobs and after Step 19 so edited terrain stays consistent.

---

### Step 18: Organic Terrain Blobs
A final pass adds organic terrain variation within large homogeneous land regions:
- Regions smaller than `ORGANIC_BLOB_MIN_REGION = 30` cells are skipped.
- Blobs use a warp-distorted noise profile for irregular shapes.
- Cliff ring edges are re-encoded using `cliffTileIdx` after blob boundaries are finalized.

---

### Step 19: Forest Halo
Every non-visitable panel that directly borders a visitable panel (route or settlement) is marked as a render-only halo and flooded with `T.FOREST`.
- Prevents hard darkness cutoffs at the edges of the playable area in the game engine.
- Halo panels are flagged with `isForestHalo=true` — render-only, no gameplay logic.
- Halo panels also receive `isRoute=true` so the renderer treats the edge consistently; **biome seeds explicitly exclude** `isForestHalo` (see Step 20 below).
- `T.OCEAN`, `T.LAKE`, and `T.CLIFF` cells are preserved as-is; only land/grass/road cells become forest.
- Candidate panels are collected into a `Set` before mutation so halos are never themselves halo'd.
- `calculateTileIndices()` is called once more after this pass so halo forest cells get correct Wang borders.

---

### Step 20: Biome Zoning — runs **after** Step 19
Biomes are assigned **per panel** and then copied to every cell in that panel (`panelData[key].biome`, `cell.biome`). This pass runs **after** the forest halo so **`isForestHalo` is known** and seeds never land on halo panels.

**Six biomes (indices 0–5):** Lush, Highland, Enchanted, Autumn, Tropical, Volcanic (same order as `BIOME_NAMES` in `engine/constants.js` and the Layout Generator legend in `App.jsx`).

**Seeds (one panel each):**
- **Lush (0):** Map center panel when possible; otherwise the first eligible panel in row-major order.
- **Highland (1):** Panel containing a highest-elevation land cell (from world scan), with fallbacks to the highest `panelStats.maxElev` among **eligible** panels if that panel is not usable.
- **Volcanic (5):** Second-tier peak (original logic: next-below-global-max elevation), with fallbacks that prefer high `maxElev` among remaining panels (excluding Lush/Highland picks when possible).
- **Tropical (4):** Minimum-elevation land, with fallbacks to lowest `maxElev` among eligible panels.
- **Enchanted (2) & Autumn (3):** Highest **empty-score** among remaining eligible panels (land/road favor, forest/ocean penalized), deterministic tie-break by panel key.

**Eligible seed panel** (`seedVisitable`): `(isRoute || settlement)` **and** `!isForestHalo` — i.e. main playable panels only, not the Step 19 halo ring.

**Propagation:** Round-robin in fixed biome order **0→5**. Each sweep, each biome claims **one** unassigned **cardinal** neighbor of its territory, chosen by a score: Highland/Volcanic favor high `maxElev`, Tropical favors low, others neutral; all favor land-heavy panels and treat water-dominant panels as last resort. Repeats until every panel has an owner, then fills any stragglers from best adjacent biome (deterministic ties).

**Post-pass: zone blend at biome thresholds (cell-level):** After panel ownership is final, a boundary pass compares each **4-neighbor panel edge** where biomes differ. It computes each panel’s **average land elevation** (excluding ocean/lake; elevation ≥ 1) and the **lowest elevation present** across the pair. Then it rewrites **`cell.biome`** on both panels so:
- The biome of the **lower-average** panel “owns” **all tiles at the lowest elevation level present**.
- The other biome “owns” **all higher elevation levels**.

This keeps `panelData[key].biome` as the base label, while `cell.biome` carries the blended boundary detail.

**Post-pass: pocket dominant fill (cell-level):** Finally, the engine flood-fills contiguous **land pockets** (4-neighbor connectivity) within **main visitable panels only** (`isRoute|settlement` and `!isForestHalo`), bounded by water/lake/cliff. For each pocket it picks the **dominant biome** by counting `cell.biome` values (ties → lowest id) and fills the whole pocket to that biome. This removes small “sliver” artifacts created by the blend step.

**Post-pass: water biome assignment (cell-level):** After landish zones are finalized, every `T.OCEAN` / `T.LAKE` cell is assigned a stable `cell.biome` based on nearby land so water edges can key off the correct biome in the Map Generator:

- Prefer **orthogonal** neighbors first; if none exist, fall back to **diagonals** (corner-only shoreline).
- Land sources are `T.LAND`, `T.FOREST`, `T.ROAD`, `T.GRASS`.
- **Water-by-cliff edge case**: if a water cell is bordered by `T.CLIFF`, the water biome is taken from the cliff’s **uphill owner** tile (opposite the downhill direction encoded by the cliff’s `tileIndex`), not from the cliff cell itself.

---

## 📚 Terminology Glossary

| Term | Definition |
| :--- | :--- |
| **Panel Chunk** | One **panel** = **`PANEL`×`PANEL` cells** (see `PANEL` in `engine/constants.js`, currently **48**). |
| **Domain Warping** | Offsetting noise coordinates with another noise field for organic shapes. |
| **FBM** | Fractional Brownian Motion — layered octaves of noise for natural-looking elevation. |
| **Wang 2-Corner Tiling** | A 12-tile directional tileset system encoding which neighbors share the same terrain type. |
| **Layout preview cutout** | In `regionRender.js::bakeRegion` (preview mode), panels that are not `isRoute` / `settlement` are left **transparent** so the UI canvas background shows through (aligned with Map Generator stitched preview). See **`VISUAL_STYLING.md`**. |
| **Mulberry32** | A high-performance 32-bit PRNG used for seed determinism. |
| **Golden Seed** | `Seed: 12345` — Used for logic parity testing. |
| **Lazy-Deletion A\*** | A* variant using `if (g > dist) continue` instead of decrease-key. Intentional at current map scale. |
