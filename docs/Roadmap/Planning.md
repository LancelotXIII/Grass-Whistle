# Grasswhistle — planning

Single reference for **Map Generator** (derived layers, **`render.json`**, **`tileset.png`**) and **RPG Maker XP export** (**.rxdata** maps, **MapInfos**, **Tilesets**). Supersedes the old **`Phase1.md`**, **`Phase2.md`**, and **`Roadmap.md`** split.

**Last updated:** 2026-04-18

---

## Status at a glance

| Area | State |
| :--- | :--- |
| **Derived layers + `render.json` + packed atlases** | **Done** — master `tileset.png` + optional **`tileset_bm_{ids}.png`** per **biome composition** (`schemaVersion` **3**); master keeps full-world cliff composites, per-composition atlases only cliff pairs used on panels in that group |
| **`MapXXX.rxdata` + `MapInfos.rxdata` + `Tilesets.rxdata` + Package for RMXP** | **Done** (core path) |
| **`@passages` (RM + Essentials)** | **Done** — matches Database: **Passage** (solid **15** where unwalkable) + **Bush flag** (**0x40**) where Essentials expects it. **`render.json`**: **`tileset.tiles[].passage`** — **CLIFF** / **WATER** Wang + forest trunk/body **15**; **GRASS** Wang **0x40** (walkable + bush); else **0** |
| **`@terrain_tags` (Essentials)** | **Done** — export applies terrain tags by semantic layer usage: **GRASS** → **2**, water (ocean/lake/waterroad) → **7**. Others **0**. Tags **8+** → **Todo** |
| **`@priorities`** | **Partial** — export writes **below (0)** vs **normal (1)** only (no **above characters / 2**). **FOREST_TOP**, tree-top **`f32`** strips, and stamp **layer 3** → **normal**; cliffs, trunks, bodies, and other solids → **below**. Canopy **walk-behind** uses **star** (`0x10` in `@passages`), not priority **2**. **Todo:** TallGrass / bridge splits and further tuning |
| **Automated Marshal / table verification tests** | **Todo** |
| **Autotiles (IDs 0–383); RM `@events`; Essentials `GameData` / PBS; cross-map transfers** | **Out of scope** (future) |

---

## Locked decisions (product)

| Topic | Choice |
| :--- | :--- |
| **Runtime target** | **Vanilla RPG Maker XP** (editor loads `Data/*.rxdata`). |
| **Map artifact** | **`.rxdata` direct** — Ruby **Marshal** via **`@hyrious/marshal`** in Electron main. |
| **YAML** | Not the shipping format for maps. |
| **Tile ID strategy (v1)** | **Static tiles only** — map data uses global tile IDs **≥ 384**; autotiles **0–383** deferred. |
| **Panel ↔ RM map** | **1 panel = 1 map** — typically **32×32** tiles × **3** z-layers. |
| **Layout world (panels)** | **Configurable** in Layout Generator (**1–128** per axis); default **16×16** (`DEFAULT_MAP_WIDTH` / `DEFAULT_MAP_HEIGHT` in **`layoutGen.js`**). |
| **Map number order** | Visit panels in **world order** (Y then X). App default: **`Map003` … `MapNNN`** (**Map001**–**Map002** reserved for the author). |
| **Layer field names** | **`layer1` / `layer2` / `layer3`** ↔ RM **`Table`** **z = 0…2** (bottom → top). |
| **Implementation layout** | Renderer: **`App.jsx`**, **`mgLayers.js`**, **`mgTilesetPack.js`**. Main: **`electron-main.js`** + **`tools/RXConverter/*.mjs`**. |

---

## Map Generator — three-layer model & Render bundle

### Intent

**Layout Generator** (`layoutGen.js` + Layout export) remains the **source of truth** for procedural **`type` / `elevation` / `tileIndex`**.

**Map Generator** **derives** **`layer1` / `layer2` / `layer3`** for display, previews, and the **Render** bundle. Derivation is **deterministic**; panel JSON on disk stays **layout-shaped** (derived layers are built **in memory** on load).

### Completed (RMXP + Essentials-friendly)

- [x] **Derivation** — `assignDerivedMapGeneratorLayers` + `recomputeMapGeneratorTileIndices` (`mg/mgCore.js`), drawing in **`mgLayers.js`** (`drawMgMappedCell`, forest overlays).
- [x] **Neighbor halo** — `loadMgNeighborPanelMap` + extended bitmaps so Wang/`dir12` match across panel edges where neighbor JSON exists.
- [x] **Stitched preview** + **Download PNG** (chunked ZIP for large worlds) + **single-panel** inspection.
- [x] **Render bundle** — `mgBuildRenderProjectBundle` / `packMgTileset` → **`render.json`** + **`tileset.png`** (master) + **`tileset_bm_{ids}.png`** (one per unique **biome composition** on a panel, including cliff hi/lo); static **`rmTileId`** ≥ **384**; forest **multi-tile** stamps; atlas layout keeps Wang rows + **virtual 160+96 slots** for orphan forest `|f32|` chunks (`mgTilesetPack.js`).
- [x] **On-disk panels** — remain layout-shaped; optional future: persist derived layers or emit from `layoutGen`.

### Layer semantics

| Layer | RM `z` | Role |
| :--- | :---: | :--- |
| **`layer1`** | 0 | Ground (**`LAND`**), **road**, **water**, **`GRASS`**, or **`CLIFF`** (grass and ledge art include baked ground); forest **trunk** on anchors when tree art bakes ground in. |
| **`layer2`** | 1 | Forest **body** only (anchors); not used for grass or cliff. |
| **`layer3`** | 2 | Tree **tops** / canopy. |

**Layout `type` → derived layers** (quick reference):

| Layout `type` | **`layer1`** | **`layer2`** | **`layer3`** |
| :--- | :--- | :--- | :--- |
| `LAND` | `LAND` | — | — |
| `GRASS` | **`GRASS`** (Wang on grass bitmap) | — | — |
| `OCEAN`, `LAKE`, `WATERROAD` | water | — | — |
| `ROAD` | `ROAD` + road Wang | — | — |
| `CLIFF` | **`CLIFF`** (exported ledge index) | — | — |
| `FOREST` | trunk or `LAND` (anchors vs non-anchor) | body (anchor) | tops (anchor) |

(Full detail: **`FUNCTION_REFERENCE.md`**, **`docs/ENGINE_PIPELINE.md`**.)

**Rules (summary):** **`layer1`** carries plain terrain, **grass**, or **cliff** as a single tile each (no separate `LAND` under grass or cliff when art bakes ground). **`WATERROAD`** is water family on **`layer1`**. Forest anchors use **`layer1`–`layer3`**. Empty **`layer2`/`layer3`** → RM tile id **0** on export.

### Optional polish

- [ ] **Unit tests** for pure derivation helpers.
- [ ] **Persist derived layers** to panel JSON (faster reloads / less recompute).

### Verification

- [x] Deterministic derivation (no `Math.random` on export paths for forests).
- [x] Stitched + single-panel use same derivation / halo rules.
- [ ] Automated derivation tests — **Todo**.

### Not covered by Render bundle

- **Autotiles** (0–383) for the packed atlas — deferred.

---

## RPG Maker XP export

### Intent

From **`render.json`** + packed **`tileset.png`**, emit **RPG Maker XP** artifacts: **`MapNNN.rxdata`**, **`MapInfos.rxdata`**, **`Tilesets.rxdata`**, **`Graphics/Tilesets/tileset.png`**, **`README_EXPORT.txt`**.

**Out of scope for the exporter:** autotiles **0–383**; **`@events`**; Pokémon Essentials **`GameData`** / PBS; cross-map transfer authoring.

### Completed

- [x] **`export-rmxp-maps`** IPC (`electron-main.js`) — user picks output folder; reads project **`render.json`**.
- [x] **`rmxpMapExport.mjs`** — template **`BLANKMAP.rxdata`**; **`RPG::Table`** encode (`rmxpTable.mjs`); **`@tileset_id`**; per-panel **`MapNNN.rxdata`**.
- [x] **`rmxpMapInfos.mjs`** — **`buildMapInfosFromExportedMapsAndDump`** — **Map001** row from sample + exported maps; **Fixnum** keys via **`Map<number, …>`**.
- [x] **`rmxpTilesets.mjs`** — **`buildBlankTilesetsTemplateAndFillSlotAndDump`** — fills slot **2** from bundled `samples/Tilesets.rxdata` template; applies **`@passages`** / **`@terrain_tags`** patches with **shape-aware indexing** (global tile id vs static strip). Forest canopy uses **star** (`0x10`) in `@passages`.
- [x] **Ground / forest export correctness** — fixed `rmTileId` lookup for 3×3 forest sheets (atlas keys are **`FOREST_*:${ft}:${sub}`**, not **`FOREST_*:${ft}`**) and coerced `tileIndex` values that may load from JSON as strings. Symptom when broken: exported maps can show “missing ground” (tile id **0**) under forest layers.
- [x] **Copy `tileset.png`** into export root **`Export/Graphics/Tilesets/`** when present.
- [x] **`README_EXPORT.txt`** via **`buildExportReadme`**.
- [x] **UI** — Map Generator **Package for RMXP** rebuilds render bundle then runs export (`App.jsx`).
- [x] **Defaults** — **`RMXP_TILESET_ID = 2`**, **`RMXP_START_MAP_ID = 3`** (first file **`Map003.rxdata`**).

### Export layout (as shipped)

| Path (under chosen root) | Contents |
| :--- | :--- |
| **`Export/Data/Map003.rxdata` …** | One map per visitable panel (world order). |
| **`Export/Data/MapInfos.rxdata`** | Map id **1** from sample + exported panel maps. |
| **`Export/Data/Tilesets.rxdata`** | Template + slot **2** filled (default). |
| **`Export/Graphics/Tilesets/tileset.png`** | Packed atlas. |
| **`Export/README_EXPORT.txt`** | Merge checklist. |
| **`Export/PBS/map_metadata.txt`** | Essentials PBS map metadata (includes `ShowArea = true` while debugging). |
| **`Export/PBS/map_connections.txt`** | Essentials bordering edge connections. |
| **`Export/PBS/map_connections_extra.txt`** | Essentials diagonal/corner-only coordinate connections (kept separate from Debug rewrite). |

### Remaining work

- [ ] **`@priorities`** — Essentials **TallGrass** (tag 10) upper/lower tile split and similar (**priority** 1 / **0**); optional bridge / overlay rules beyond current **below** vs **normal** defaults.
- [ ] **Essentials terrain refinements** — e.g. **StillWater (6)** vs **DeepWater (5)** vs **Water (7)** by layout type; tags **8+** (RM editor only supports **0–7**; higher via Debug “Edit Terrain Tags”).
- [ ] **Research spike** — vanilla RM + optional Essentials: numeric **priority** behaviour, **`EXTRA_AUTOTILES`** vs atlas height.
- [ ] **Verification** — automated parity: exported **`@data.userDefined`** vs **`json-to-rxdata.mjs`**; Marshal **load → dump** regression tests.
- [ ] **Variable `panelSize`** — only **32×32** template today; add templates or resize path if **`PANEL`** ever changes.

### Debugging tools (repo)

CLI under **`tools/RXConverter/`**: `rxdata-to-json.mjs`, `json-to-rxdata.mjs`, `rxdata-marshal-dump.mjs`. See **`tools/RXConverter/README.md`**.

### Risks

| Risk | Mitigation |
| :--- | :--- |
| Marshal fidelity | Round-trip tests; Ruby `load_data` fallback if needed. |
| Tileset / graphic mismatch | Dedicated slot + **384+** alignment docs. |
| Wholesale **MapInfos** / **Tilesets** replace | Authors merge manually in RM or use **`mergeMapInfosAndDump`** / **`mergeTilesetSlotAndDump`** from **`tools/RXConverter/`** if scripting. |

---

## Essentials / Pokémon (reference)

- Same **RM XP** map/tileset Marshal types.
- **Do not generate** Essentials **`GameData`**, PBS, encounters, metadata — **author responsibility**.
- **`@terrain_tags`**, bridges, **`EXTRA_AUTOTILES`** — [Essentials Tilesets wiki](https://essentialsdocs.fandom.com/wiki/Tilesets); deeper tables lived in the old **`Phase2.md`** spec.

---

## User constraints

- **Chipset width:** **256 px** (8 × 32 px tiles per row) for RM tileset graphics.
- **Large worlds:** one **`.rxdata`** per panel, not one giant map file.

---

## Code map

| Piece | Location |
| :--- | :--- |
| Derivation + Map Generator UI | `src/renderer/App.jsx` |
| Layers / forest draw | `src/renderer/mgLayers.js` |
| Atlas pack + **`rmTileId`** | `src/renderer/mgTilesetPack.js` |
| Procedural engine | `src/renderer/layoutGen.js` |
| IPC + export orchestration | `electron-main.js`, `preload.js` |
| Table encode, map/tileset/mapinfos export | `tools/RXConverter/rmxpTable.mjs`, `rmxpMapExport.mjs`, `rmxpTilesets.mjs`, `rmxpMapInfos.mjs` |

---

## Document history

- **2026-04-12:** Derived layers + Render bundle shipped.
- **2026-04-13:** RMXP export shipped (Package for RMXP; tileset slot **2**; maps from **Map003**).
- **2026-04-13:** Merged legacy **`Roadmap.md`**, **`Phase1.md`**, **`Phase2.md`** into this file.
- **2026-04-13:** Dropped “Phase” framing — content grouped by **Map Generator** vs **RMXP export**.
- **2026-04-13:** Dropped optional tracking for configurable export IDs, merge-into-live-game UI — fixed defaults (**slot 2**, **Map003**) and scriptable merge helpers are sufficient.

---

## References

- **`docs/ARCHITECTURE.md`** — system overview.
- **`docs/ENGINE_PIPELINE.md`** — procedural steps 1–19.
- **`docs/FUNCTION_REFERENCE.md`** — function catalog.
- **`tools/RXConverter/README.md`** — RXConverter CLI.
- **`CHANGELOG.md`** — release notes.
