# RXConverter

Helper scripts (Node) for converting between **RPG Maker XP `.rxdata`** maps and Grasswhistle JSON artifacts.

Run from the **repo root** so `node_modules/@hyrious/marshal` resolves.

## `rxdata-to-json.mjs`

Extract a `.rxdata` (Ruby Marshal) map to JSON: tile grid (`cells`) plus full **`marshal`** (events, audio, etc.).

```bash
node tools/RXConverter/rxdata-to-json.mjs "C:\path\to\Data\Map001.rxdata" "out.json"
```

Output (`kind: rxdata_map_full`):

- `map.width`, `map.height`, `map.tilesetId`
- `cells[]` — length width×height, row-major; each cell has `layer1|layer2|layer3` with `rmTileId` or `null`
- `marshal` — JSON-safe Marshal object graph (includes `@events`, BGM/BGS, encounters, …)

## `json-to-rxdata.mjs`

Build a `.rxdata` by loading **`rxdata_map_full`** from JSON (round-trip), or by **patching a template** when the input is `render.json`.

```bash
node tools/RXConverter/json-to-rxdata.mjs render.json "C:\path\to\Data\Map001.rxdata" "Map999.rxdata" --panel 0,0 --tileset-id 4
```

Notes:

- `--panel X,Y` selects a panel from `render.json` (defaults to the first).
- `--tileset-id` overrides `@tileset_id` when writing.
- Always overwrites `@width`, `@height`, and `@data` (`RPG::Table`) from `cells`.

## `rmxpMapInfos.mjs` (library)

- **`buildMapInfosFromExportedMapsAndDump(written, { title, mapInfosTemplatePath })`** — clone **all** rows from **`mapInfosTemplatePath`** when non-empty (app default: **`samples/MapInfos.pokemon_essentials_v21_blank.rxdata`**), then one **`RPG::MapInfo` per exported map id** from **`exportRenderBundleToRmxpDataDir`** (includes blank **group parent** rows + letter-suffixed panel children with `@parent_id`). Uses **`Map<number, …>`** so keys marshal as **Fixnum**. Used by Electron **Package for RMXP**.
- **`cloneMapInfoOneFromTemplate(templatePath)`** — load id **1** only (for tests / tooling).
- **`mergeMapInfosAndDump(sourcePath, written, { title })`** — load an existing game `MapInfos.rxdata`, copy into a numeric-key **`Map`**, add/replace entries (orders continue after current max). For **manual / scripted** merge into a live project.
- **`buildExportReadme(opts)`** — text for **`README_EXPORT.txt`**.

## `rmxpTilesets.mjs` (library)

- **`buildBlankTilesetsTemplateAndFillSlotAndDump(templatePath, slotId, imageBaseName, displayName, opts?)`** — from bundled **`samples/Tilesets.rxdata`**: null every slot, fill **only** `slotId` (clone donor). Used by Electron **Package for RMXP**.
- **`mergeTilesetSlotAndDump(sourcePath, slotId, imageBaseName, displayName, opts?)`** — patch a **user** **`Tilesets.rxdata`** in place (same rules as blank build). For scripts / custom tooling.

Exported maps reference the slot via **RM tileset id**; **`Graphics/Tilesets/tileset.png`** must match **`@tileset_name` `tileset`**.

Notes:

- The bundled `samples/Tilesets.rxdata` is treated as the **authoritative template** (intended to match a clean Essentials project).
- Table patching is **shape-aware**: depending on the template, `@passages` / `@terrain_tags` / `@priorities` may be indexed by
  global tile id (0..N) or by the static strip offset (tileId − 384). The patcher detects the table length and writes to the correct index.
- For forest canopy **walk-behind** (player walks in front of the sprite without changing collision), use the **star flag** (`0x10`) in `@passages`. Grasswhistle packed exports pair that with **normal** map-layer priority (**1**), not RPG Maker’s **Above characters** priority (**2**).

## `rmxpMapExport.mjs` (library)

Used by the **Electron** app: rebuilds `render.json`/`tileset.png` as needed, patches the bundled **`samples/BLANKMAP.rxdata`**, and writes **`MapNNN.rxdata`** under **`Export/Data/`** inside the folder the user picks (then they copy into the game’s **`Data/`**). Same tile-table rules as **`json-to-rxdata.mjs`** (including forest multi-tile stamps).

**Grasswhistle UI defaults** (`MapGenerator` → Package for RMXP, `src/renderer/App.jsx`): **`tilesetId` = 2** (`RMXP_TILESET_ID`) so the packed atlas fills **`Tilesets.rxdata` slot 2** and every exported map’s **`@tileset_id`** matches; **`startMapId` = 3** (`RMXP_START_MAP_ID`) so the first panel file is **`Map003.rxdata`**, leaving **Map001** (cloned **MapInfo** only) and **Map002** unused by export.

## `rxdata-marshal-dump.mjs`

Dump **any** Ruby Marshal blob to JSON — **`.rxdata`**, **`.dat`**, etc. No map-specific fields.

```bash
node tools/RXConverter/rxdata-marshal-dump.mjs "C:\path\to\Data\Tilesets.rxdata" "Tilesets.marshal.json"
node tools/RXConverter/rxdata-marshal-dump.mjs "C:\path\to\PBS\map_metadata.dat"
```

If you omit the output path, the script writes **`<name>.marshal.json`** next to the input (works for **`.rxdata`** and **`.dat`**).

**Pokémon Essentials** compiles many PBS tables to Marshal **`.dat`** files (e.g. **`GameData::MapMetadata`**). Same loader as **`Tilesets.rxdata`**; use this tool to inspect or diff them.

## Supporting modules

- `rmxpTable.mjs` — encode/decode `RPG::Table` binary blobs; **`patchRmxpTable1DRange`** for tileset tables
- `marshalJson.mjs` — JSON-safe round-trip for Marshal-loaded objects

## `samples/`

Example inputs / outputs for spikes (optional; safe to delete or regenerate).

| File | What it is |
| :--- | :--- |
| **`BLANKMAP.*`**, **`Tilesets.*`** | RM XP **`Map` / `Tilesets`** Marshal. |
| **`MapInfos.rxdata`** → **`MapInfos.marshal.json`** | RM XP **map list** for the editor: a Ruby **Hash** keyed by **map id** (`"1"`, `"2"`, …). Each value is **`RPG::MapInfo`** (`@name`, `@order`, `@parent_id`, `@scroll_x` / `@scroll_y`, `@expanded`). **No tiles** — geometry is in **`MapXXX.rxdata`**. Regenerate JSON: `node tools/RXConverter/rxdata-marshal-dump.mjs tools/RXConverter/samples/MapInfos.pokemon_essentials_v21_blank.rxdata`. |
| **`MapInfos.blank.rxdata`** | Marshal dump of an **empty** Hash (`{}`) — conceptual “blank” **`MapInfos`** before any map rows. |
| **`map_metadata.dat`** → **`map_metadata.marshal.json`** | Essentials **`GameData::MapMetadata`** registry (hash keyed by **map id**): `@real_name`, `@outdoor_map`, `@town_map_position`, `@teleport_destination`, battle BGMs, `@flags`, … **Per-map** data **beside** **`MapInfos.rxdata` / `MapXXX.rxdata`**. |
| **`metadata.dat`** | **`GameData::Metadata`** (singleton-ish): start money, **`@home`** map + coords, default battle BGMs, surf/bicycle BGM. |
| **`map_connections.dat`** | Array of **border connection** tuples: map id, direction (**N/S/E/W** as short strings), offset, other map id, other direction, offset. Used for seamless map edges in Essentials. |
| **`town_map.dat`** | **`GameData::TownMap`**: region graphic filename + **`@point`** entries (grid x/y, names, fly coordinates, …). Links to **`@town_map_position`** in map metadata. |

**Export note:** Grasswhistle targets **fully tiled maps**: **`MapXXX.rxdata`** + **`MapInfos.rxdata`** + tileset integration. The **`.dat`** samples are **Essentials `GameData`** reference only (**`map_metadata`**, **`town_map`**, **`map_connections`**, **`metadata`**) — **not** generated by the app; game authors handle PBS / gameplay.
