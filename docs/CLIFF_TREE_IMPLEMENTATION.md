# Cliff Direction Encoding + Tree Rendering System

## Overview

Two features implemented on top of the core generation pipeline:

1. **Cliff direction encoding** — each `T.CLIFF` cell stores which direction it drops toward and maps to one of 12 tileset variants.
2. **Tree rendering** — `T.FOREST` cells render a 2×3 sprite sheet via a React overlay, using a 2×1 spatial anchoring system with brick stagger.

---

## Feature 1: Cliff Direction Encoding

### Files modified
- `src/renderer/layoutGen.js` — Step 11 (global cliff pass), Step 18 organic blob pass, and `generateTestPanel`
- The cliff direction decision tree is centralized in the **exported module-level function** `cliffTileIdx(N, S, E, W, NE, SE, SW, NW)`. All three prior inline decision trees have been replaced with calls to this shared function.

### Concept

A solid cell (LAND, FOREST, ROAD) becomes `T.CLIFF` if any solid neighbour sits at a lower elevation. The cell owns the cliff edge — it is the high side — and `tileIndex` encodes which direction it drops toward.

### 12-tile strip layout

```
Index  Name          When assigned
  0    N  (edge)     Only N neighbour is lower
  1    NE (outer)    N + E + NE all lower  — exposed tip
  2    E  (edge)     Only E neighbour is lower
  3    SE (outer)    S + E + SE all lower
  4    S  (edge)     Only S neighbour is lower
  5    SW (outer)    S + W + SW all lower
  6    W  (edge)     Only W neighbour is lower
  7    NW (outer)    N + W + NW all lower
  8    NW (inner)    NW diagonal only, or N+W without NW
  9    NE (inner)    NE diagonal only, or N+E without NE
 10    SW (inner)    SW diagonal only, or S+W without SW
 11    SE (inner)    SE diagonal only, or S+E without SE
```

**Outer corners** (1,3,5,7): two cardinals and their shared diagonal are all lower — an exposed, pointy tip.  
**Inner corners** (8–11): either a diagonal-only drop (concave notch) or two cardinals without their shared diagonal also being lower.

### Tile selection priority (Step 11)

```js
// Straight edges — single cardinal, no perpendicular drop
if      (N && !E && !W) idx = 0
else if (E && !N && !S) idx = 2
else if (S && !E && !W) idx = 4
else if (W && !N && !S) idx = 6
// Outer corners — two cardinals + their diagonal all lower (exposed tip)
else if (N && E && NE)  idx = 1
else if (S && E && SE)  idx = 3
else if (S && W && SW)  idx = 5
else if (N && W && NW)  idx = 7
// Inner corners — diagonal only (concave notch)
else if (NE && !N && !E) idx = 9
else if (SE && !S && !E) idx = 11
else if (SW && !S && !W) idx = 10
else if (NW && !N && !W) idx = 8
// Inner corners — two cardinals, diagonal not lower (concave notch)
else if (N && E) idx = 9
else if (S && E) idx = 11
else if (S && W) idx = 10
else if (N && W) idx = 8
// Fallback to nearest cardinal
else if (N) idx = 0
else if (E) idx = 2
else if (S) idx = 4
else        idx = 6
```

> `T.CLIFF` is also excluded from the Step 17 Wang `tileIndex` write — cliff `tileIndex` is set in Step 11 and must not be overwritten. `T.CLIFF` is still counted as solid in the `LAND_BMP` so adjacent LAND cells get correct border tiles.

---

## Map Generator: Composite cliff tiles (high/low biome)

RPG Maker XP export is constrained to a small number of tile layers, and the cliff art contains “baked” ground. To avoid authoring 36 biome-pair cliff sheets, the Map Generator can **composite only the cliff tiles actually used** during export:

- **Underlay**: draw the **high-side biome ground** (`GROUND_BY_BIOME[highBiome]`)
- **Overlay**: draw the `CLIFF` strip tile (indexed by `tileIndex`) on top

### Data model

- `src/renderer/mg/mgCore.js`: derived cliff layer stores:
  - `biomeHigh`: biome of the **uphill** side (opposite the downhill direction encoded by `tileIndex`)
  - `biomeLow`: biome of the **downhill** neighbor (the direction encoded by `tileIndex`)

### Export packing

- `src/renderer/mg/mgCore.js`: export scans panels for cliff cells, derives unique `(high, low)` pairs, then expands each pair to **all** `tileIndex` **0–11** for packing (complete composite set per pair). **Master** atlas uses the full-world cliff set; **per–biome-composition** atlases use `buildCliffCombosForPanelKeys` so only cliff pairs that appear on panels in that group are baked (avoids pulling other biomes’ ground into a single-biome tileset).
- `src/renderer/mgTilesetPack.js`: `packMgTileset(..., { compositeCliffs: true, cliffCombos })` generates atlas tiles and lookup keys:
  - `CLIFF:${highBiome}:${lowBiome}:${tileIndex} → rmTileId`

### Preview parity

- `src/renderer/mgLayers.js`: Map Generator preview composites cliffs the same way (high-biome ground underlay + cliff overlay).

### Asset constraints

Composite cliffs require that `mapping.CLIFF.assetId` points to an overlay strip image loaded from the **allowed asset folders** (typically the chosen `assets/cliff/` biome folder). Root-level `assets/*.png` files are not used.

---

## Feature 2: Tree Rendering

### Files modified
- `src/renderer/App.jsx` — visual output grid, tree overlay
- The Wang 2-corner tile index function is centralized in the **exported module-level function** `dir12(bmp, cx, cy, stride)` in `layoutGen.js`. The prior local `dir12` definitions in `generateTestPanel` (and the old single-panel Map Generator loader) have been replaced with calls to this shared function (passing `stride = PANEL` for single-panel grids). **Stitched / mosaic** recomputation uses **`recomputeMapGeneratorTileIndices`** in **`mg/mgCore.js`** with optional **`(PANEL+2)²`** world context.

### Sprite sheet

`tree.png` is a single tree drawn at **64×96 px** (2 tiles wide × 3 tiles tall at 32 px/tile):

```
col:  0    1
row 0        ← treetop / canopy
row 1        ← mid body
row 2        ← trunk base
```

### Rendering approach

FOREST cells are rendered in two layers inside `.mapped-grid-wrap`:

**Base layer (mapped-grid):** FOREST cells use the `GROUND` asset mapping (with the Wang `tileIndex` already set), so the terrain texture shows through at the trunk base.

**Tree overlay:** An absolutely-positioned `<div>` over the grid renders one `<img>` per tree anchor, painted top-row-first so southern trees overlap northern ones.

### Anchoring and stagger

```
1. Scan left-to-right, top-to-bottom.
2. If a FOREST cell has a FOREST neighbour to its right:
     → place a 2-wide tree, left-aligned on the current cell.
     → mark the right cell as covered (skip on next iteration).
3. If a FOREST cell has no right FOREST neighbour (or is already covered):
     → place a 1-wide tree centred on the cell (left offset −0.5).
4. Odd rows are shifted +0.5 cells right (brick stagger) for visual variety.
```

Sprite positioning (all values as % of wrap width/height, where 1 cell = `100/PANEL %`):

```js
const cellPct = 100 / PANEL          // 3.125% per cell
const spriteW = cellPct * 2          // 2 cells wide
const spriteH = cellPct * 3          // 3 cells tall

left: (wide === 2 ? cx : cx - 0.5 + rowOffset) * cellPct + '%'
top:  (cy - 2) * cellPct + '%'       // bottom-align: trunk base sits at cell bottom
```

### Note on treeSubTile / treeLayer

The `treeSubTile` and `treeLayer` cell properties were **removed** from the generation pipeline. The passes that stamped these fields in `generateFromTerrain` and `generateTestPanel` have been deleted. These properties were never read by any renderer path and existed only as vestigial scaffolding from an earlier layer-based rendering approach.

---

## Edge Cases

| Case | Behaviour |
|---|---|
| Cliff — only diagonal higher neighbours | Cardinal checks all fail → diagonal fallback (NE/SE/SW/NW) |
| Cliff — all 4 cardinals higher | `N && E` outer corner fires first |
| Cliff at world boundary | Out-of-bounds neighbours treated as not-lower |
| FOREST cell at right panel edge | No right neighbour → 1-wide centred tree |
| FOREST cell at top world row | Sprite extends above the panel top (clipped by wrap `overflow: hidden`) |
| No FOREST asset mapped | Base grid shows FOREST fallback colour; overlay skips entirely |
| No GROUND asset mapped | FOREST base cell shows FOREST fallback colour |

---

## Verification Checklist

- [ ] Regenerate a map — cliff cells show dark brown `[61,43,31]` in the procedural source panel
- [ ] Inspect a cliff cell in DevTools: `cell.tileIndex` is 0–11, `cell.type === 'CLIFF'`
- [ ] Assign a cliff tileset (12-tile strip) → each cliff cell shows the correct directional tile
- [ ] Assign `tree.png` to FOREST and a ground tileset to GROUND
- [ ] Pairs of horizontally adjacent FOREST cells render one shared 2-wide tree
- [ ] Isolated FOREST cells render a centred single tree
- [ ] Odd rows are visibly offset half a cell right relative to even rows (brick stagger)
- [ ] Ground texture is visible at tree trunks (FOREST base uses GROUND asset)
- [ ] Southern trees visually overlap northern trees within a forest blob
