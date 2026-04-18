# File formats

This doc describes the on-disk artifacts Grasswhistle reads/writes.

## Layout export project folder (Layout Generator → Export)

Export writes a folder like:

- `project.json` — metadata (`seed`, world size, panel size, title, timestamp). **`seed`** is the **terrain seed** used for the winning generation attempt (`region.terrain.seed` — i.e. the Layout Generator retry loop’s integer), not a generic `Date.now()` fallback when that value is present.
- `world.png` — full world preview (stitched)
- `panels/{x}_{y}.json` — per-panel layout JSON (grid, biome, settlement, flags)
- `imagery/{x}_{y}.png` — per-panel preview PNG (optional)
- `mapping.json` — Map Generator slot→asset mapping (optional)
- `assets/*/*.png` — project-local assets used by Map Generator (optional)

## `mapping.json`

Top-level keys are mapping “slots” and biome-folder configuration. Common keys:

- `GROUND`, `ROAD`, `FOREST`, `FOREST_BODY`, `FOREST_TOP`, `GRASS`, `WATER`, `CLIFF`
- `GROUND_BIOME_DIR`, `TREE_BIOME_DIR`, `ROAD_BIOME_DIR`, `GRASS_BIOME_DIR`, `WATER_BIOME_DIR`, `CLIFF_BIOME_DIR`
- `GROUND_BY_BIOME`, `TREE_BY_BIOME`, `ROAD_BY_BIOME`, `GRASS_BY_BIOME`, `WATER_BY_BIOME`, `CLIFF_BY_BIOME` (biome index `0..5` → `assetId`)

Each slot is an object like:

- `assetId` (string): key that maps to an image in `assets/` or bundled defaults
- `isTileset` (boolean): when true, the asset is treated as a Wang strip tileset

Biome folder assets are stored as **namespaced assetIds** (e.g. `__roadBiome__road_coastal.png`) so project files never depend on root-level `assets/*.png`.

## Render bundle (`render.json` + packed atlas)

Map Generator can build a render bundle:

- `render.json`
- `Export/Graphics/Tilesets/tileset.png` — **master** atlas (full world: all biomes / strips needed globally)
- `Export/Graphics/Tilesets/tileset_bm_{ids}.png` — optional **per biome-composition** atlases (e.g. `tileset_bm_0_3_5.png` for biomes 0+3+5 on a panel); panels sharing the **same set** of biome ids share one packed tileset (different mixes → different files, even if counts match)
- `Export/biome_panel_counts.md` — per-panel counts of cells per biome (written when saving the render bundle, e.g. from RMXP export)

`render.json` is intended as the canonical intermediate for game-export pipelines.

### `render.json` schema (summary)

- **`schemaVersion`**: **`3`** for current exports (older **`2`** bundles used a single `tileset` only).
- **`exportGroups`**: audit list for packaging — each row is one **composition group** (`groupIndex` / `biomeTilesetIndex`, `compositionKey`, `biomeComposition`, `panelKeys` in that group). Matches step 2–3 of the export pipeline.
- **`tileset`**: master atlas metadata (`kind: "master"`, `imageFile` → `tileset.png`, `tiles[]` manifest, **`conversionTable`**). Built **after** all `biomeTilesets` rows. Each `tiles[]` row includes **`atlasIndex`** and **`mappingKey`** where applicable.
- **`biomeTilesets`**: array of per-**composition** atlases (`biomeComposition` sorted id list, `distinctBiomeCount` = its length, `imageFile` → `tileset_bm_{ids}.png`, `tiles[]`, **`conversionTable`** `{ semKey, rmTileId }[]` — semantic lookup keys → tile id for that atlas, `biomeTilesetIndex`). Wang/terrain strips are limited to biomes that appear on panels in that group; **composite cliff** baked tiles use only `(hi, lo, ti)` pairs that appear on **those** panels (each `ti` 0–11 per pair). The **master** `tileset.png` still uses the full-world cliff combo expansion.
- **`panels[]`**: each panel includes **`biomeComposition`**, **`distinctBiomeCount`**, **`biomeTilesetIndex`**, and **`cells[]`** with `rmTileId` values from the matching **`biomeTilesets`** pack (not the master).

Saving the bundle writes the master PNG plus any `tileset_bm_*.png` composition atlases via the main process (`save-render-project` accepts optional `biomeTilesetPngs`).

### Wang tileset export grid (packed `tileset.png`)

When `isTileset` Wang strips are packed for export, each strip is laid out in a **fixed 5×3 grid** of 32×32 cells (**160×96 px** per strip in the atlas—the two unused bottom rows of a conceptual 5×5 are omitted to save space). Source art remains a **single horizontal strip** of `MG_WANG_COLS` (13) tiles; the packer places each strip index into the cell below so users can remap from generated maps without following a 1×13 row.

**Strip index → cell** (`col`, `row` from top-left, 0-based):

```text
+---+---+---+---+---+
| 7 | 0 | 1 |11 |10 |
+---+---+---+---+---+
| 6 | 12 | 2 | 9 | 8 |
+---+---+---+---+---+
| 5 | 4 | 3 | . | . |
+---+---+---+---+---+
```

- **Index 12** (interior / fill for `dir12`) sits at **`(col 1, row 1)`** as in the diagram above, for strips that are **not** `CLIFF` (cliff strips do not pack a tile for index 12).
- **Cliff** Wang strips **omit** index 12 in the export pack (only 0–11); `cliffTileIdx` never emits 12.

**Composite cliffs** (baked ground + cliff overlay for export) use the **same 5×3 cell positions** per strip index `ti` as non-composite cliff Wang strips (index 12 is never packed). The **master** atlas collects `(hi, lo)` pairs from cliff cells **world-wide** and expands each pair to **all** `ti` **0–11**. Each **`biomeTilesets`** atlas only includes pairs seen on panels in that composition group (same `ti` expansion per included pair). Non-composite Wang strips are still trimmed by which biomes appear on panels in that atlas’s group.

Constants: `MG_WANG_EXPORT_INDEX_TO_CELL`, `MG_WANG_EXPORT_BLOCK_W_PX`, `MG_WANG_EXPORT_BLOCK_H_PX`, `mgWangExportCellForPack` in [`src/renderer/mgLayers.js`](../src/renderer/mgLayers.js); packing in [`src/renderer/mgTilesetPack.js`](../src/renderer/mgTilesetPack.js). Phys-key markers **`|tsb|`** (Wang “b” variant) and **`|fitb|`** (fit/bake variant) follow the same passage / terrain / strip-kind rules as **`|ts|`** / **`|fit|`** during `packMgTileset`.

**Forest tiles (`|f32|`):** The atlas is **8 tiles (256px) wide**. Each 5×3 Wang block uses **160px** width, leaving **3 columns (96px)** on the same row. Each tree sheet **horizontal band** `v` (same `assetId`) is packed into that **3×3** using fixed cells—**not** raw emission order:

```text
+──────────────────────+──────────────────────+──────────────────+
| Wide tree top left   | Wide tree top right  | Skinny tree top  |
+──────────────────────+──────────────────────+──────────────────+
| Wide tree body left  | Wide tree body right | Skinny tree body |
+──────────────────────+──────────────────────+──────────────────+
| Wide tree trunk left | Wide tree trunk right| Skinny tree trunk|
+──────────────────────+──────────────────────+──────────────────+
```

(`f32SidecarCell` in [`mgTilesetPack.js`](../src/renderer/mgTilesetPack.js) maps `t`/`m`/`b` and wide vs skinny `ni` to `row`/`col`.) The **first** tree band in pack order pairs with the **first** Wang block on a row (160px Wang + 96px `|f32|` = **256px** per “slot”). **Row layout:** each Wang block starts a **new row** at the left margin (unused space on the previous row is allowed). If there are **more** tree bands than Wang blocks, orphan `|f32|` chunks are **not** laid out in linear index order: each 3×3 uses a **virtual** slot—**160px blank** (as if a Wang strip were there) then the 3×3 tree block on the right, advancing by the full **256px** slot so columns line up with paired rows.

Key fields:
- `schemaVersion` (number)
- `kind` = `map_generator_render`
- `panelSize` (number)
- `tileset` (object): master atlas — `rmTileIdBase`, `imageFile`, `tilePx`, `tiles[]` manifest
- `biomeTilesets` (array, schema ≥ 3): per–biome-composition packs (see above)
- `panels[]` where each panel has `cells[]`
  - each panel (schema ≥ 3): `biomeComposition`, `distinctBiomeCount`, `biomeTilesetIndex`
  - each cell includes `type`, `elevation`, `tileIndex`, and `biome` (0..5) when known
  - derived render layers `layer1/layer2/layer3` include `type`, `tileIndex`, and `rmTileId`
    - cliffs may include `biomeHigh` / `biomeLow` on `layer1` for composite cliff export (high-side ground underlay + biomeLow overlay)
    - `rmTileId` is derived from the tile’s **pixel grid position** in the atlas: `384 + (atlasY/32) * (atlasWidth/32) + (atlasX/32)`. This matches how RPG Maker XP assigns sequential IDs to 32×32 cells when reading a tileset image. It is NOT a simple sequential counter over pack order — tiles repacked into a 5×3 Wang grid land at non-sequential pixel positions.
  - forests may include `forestRmStamp` (`dx`, `dy`, `layer`, `rmTileId`, **`semKey`**) for multi-tile placement during `.rxdata` export; `semKey` matches `conversionTable[].semKey` so cross-map forest spill can remap into the target map’s atlas

## RMXP export output (`export-rmxp-maps`)

When exporting to an output folder, Grasswhistle writes under `Export/`:

- `Export/Data/MapNNN.rxdata`
- `Export/Data/MapInfos.rxdata`
- `Export/Data/Tilesets.rxdata`
- `Export/Graphics/Tilesets/tileset.png` (master; copied when available)
- `Export/Graphics/Tilesets/tileset_bm_*.png` (per–biome-composition atlases, when present)
- `Export/README_EXPORT.txt`

With **`schemaVersion` ≥ 3** and a non-empty **`biomeTilesets`** list, each map’s **`@tileset_id`** is **`tilesetId + panel.biomeTilesetIndex`** (default **`tilesetId`** is **2** in the app). **`Tilesets.rxdata`** is filled with **one database entry per** `biomeTilesets` row (slots **2, 3, …**), each pointing at the matching **`tileset_bm_{ids}`** base name. The master **`tileset.png`** is still copied for reference; maps use the per-group atlases so **`rmTileId`** values match the packed strip for that panel’s biome mix.

Pokémon Essentials PBS helpers are also written:
- `Export/PBS/map_metadata.txt`
- `Export/PBS/map_connections.txt`
- `Export/PBS/map_connections_extra.txt`

