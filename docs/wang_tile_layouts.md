# Wang tile layouts & conversion tables

**Canonical reference** for strip layouts, the **5×3** Wang grid (cliff / road / water / grass), and the **5×4** `cliff_double` sheet. Implementation: **`src/renderer/mgLayers.js`** (`MG_WANG_SEMANTIC_TO_GRID`, `MG_CLIFF_DOUBLE_CD_MAP`, `mgWangExportCellForPack`, `wangGridCell`), generation: **`layoutGen.js`** / **`engine/tiling.js`** (`cliffTileIdx`, `dir12`).

---

## 1. Original 1×13 strip (logical order)

Authoring order along a **horizontal strip** before remapping into the 5×3 block for export. Index **12** = interior / fill (**road / water / grass**; not packed for **CLIFF**).

| Strip index | Name |
|-------------|------|
| 0 | N |
| 1 | NE out |
| 2 | E |
| 3 | SE out |
| 4 | S |
| 5 | SW out |
| 6 | W |
| 7 | NW out |
| 8 | NW in |
| 9 | NE in |
| 10 | SW in |
| 11 | SE in |
| 12 | Middle (road / water only) |

---

## 2. Five×three asset grid (current sheets)

Physical **5×3** cells per strip at 32px (**160×96 px** per block). **Grid index** = `col + 5 × row` (row-major).

**Cell layout** (matches comments on `MG_WANG_SEMANTIC_TO_GRID` in `mgLayers.js`):

| col → | 0 | 1 | 2 | 3 | 4 |
|-------|---|---|---|---|---|
| **row 0** | NW out | N | NE out | SE in | SW in |
| **row 1** | W | Middle (fill) | E | NE in | NW in |
| **row 2** | SW out | S | SE out | *(unused)* | *(unused)* |

**Grid index → (col, row) → label**

| Grid idx | col | row | Name |
|----------|-----|-----|------|
| 0 | 0 | 0 | NW out |
| 1 | 1 | 0 | N |
| 2 | 2 | 0 | NE out |
| 3 | 3 | 0 | SE in |
| 4 | 4 | 0 | SW in |
| 5 | 0 | 1 | W |
| 6 | 1 | 1 | Middle |
| 7 | 2 | 1 | E |
| 8 | 3 | 1 | NE in |
| 9 | 4 | 1 | NW in |
| 10 | 0 | 2 | SW out |
| 11 | 1 | 2 | S |
| 12 | 2 | 2 | SE out |
| 13 | 3 | 2 | — |
| 14 | 4 | 2 | — |

**Export:** `mgWangExportCellForPack` maps semantic index → `[col,row]` in this grid. **`CLIFF` + semantic 12** → no tile (cliffs do not pack index 12). **`MG_WANG_EXPORT_BLOCK_*`** = 160×96 px.

---

## 3. Five×four grid (`cliff_double` sheet)

**`MG_CLIFF_DOUBLE_COLS` × `MG_CLIFF_DOUBLE_ROWS`** (5×4). Each semantic **`tileIndex`** 0–12 maps through **`MG_CLIFF_DOUBLE_CD_MAP`** to **`[p1col, p1row, p2col, p2row]`**: primary quad (usually rows 0–2) and optional **PART2** quad (row 3 or inner-corner second row). **`null`** = that part unused.

**Sheet layout (conceptual)**

| col → | 0 | 1 | 2 | 3 | 4 |
|-------|---|---|---|---|---|
| **row 0** | NW out | N | NE out | NW in | NE in |
| **row 1** | W | Middle | E | *(NE in P2)* | *(NW in P2)* |
| **row 2** | SW out **P1** | S **P1** | SE out **P1** | SW in | SE in |
| **row 3** | SW out **P2** | S **P2** | SE out **P2** | — | — |

- **P1** — first tile of a double-height piece (drawn at the anchor cell for `T.CLIFF_DOUBLE`).
- **P2** — second tile (drawn for `T.CLIFF_DOUBLE_PART2`, or second row of a two-row piece).

**Authoritative map** — copy in source:

```js
// mgLayers.js — MG_CLIFF_DOUBLE_CD_MAP
0:  [1, 0, null, null],   // N
1:  [2, 0, null, null],   // NE out
2:  [2, 1, null, null],   // E
3:  [2, 2, 2,    3   ],   // SE out (+ P2)
4:  [1, 2, 1,    3   ],   // S (+ P2)
5:  [0, 2, 0,    3   ],   // SW out (+ P2)
6:  [0, 1, null, null],   // W
7:  [0, 0, null, null],   // NW out
8:  [4, 2, null, null],   // NW in
9:  [3, 2, null, null],   // NE in
10: [4, 0, 4,    1   ],   // SW in (+ P2)
11: [3, 0, 3,    1   ],   // SE in (+ P2)
12: [1, 1, null, null],   // Middle
```

---

## 4. Master semantic table (`cliffTileIdx` / `dir12` → sheets)

Internal **semantic** index **0–12** ( **`cliffTileIdx`** output for cliffs; **`dir12`** uses 0–12 on land/water/road/grass ). Independent of strip file order; **`MG_WANG_SEMANTIC_TO_GRID`** maps semantic → **5×3 grid index** for the standard Wang sheet.

| Semantic | Name | 1×13 strip idx | 5×3 grid idx | 5×3 col | 5×3 row | CD P1 col | CD P1 row | CD P2 col | CD P2 row |
|----------|------|----------------|--------------|---------|---------|-----------|-----------|-----------|-----------|
| 0 | N | 0 | 1 | 1 | 0 | 1 | 0 | — | — |
| 1 | NE out | 1 | 2 | 2 | 0 | 2 | 0 | — | — |
| 2 | E | 2 | 7 | 2 | 1 | 2 | 1 | — | — |
| 3 | SE out | 3 | 12 | 2 | 2 | 2 | 2 | 2 | 3 |
| 4 | S | 4 | 11 | 1 | 2 | 1 | 2 | 1 | 3 |
| 5 | SW out | 5 | 10 | 0 | 2 | 0 | 2 | 0 | 3 |
| 6 | W | 6 | 5 | 0 | 1 | 0 | 1 | — | — |
| 7 | NW out | 7 | 0 | 0 | 0 | 0 | 0 | — | — |
| 8 | NW in | 8 | 9 | 4 | 1 | 4 | 2 | — | — |
| 9 | NE in | 9 | 8 | 3 | 1 | 3 | 2 | — | — |
| 10 | SW in | 10 | 4 | 4 | 0 | 4 | 0 | 4 | 1 |
| 11 | SE in | 11 | 3 | 3 | 0 | 3 | 0 | 3 | 1 |
| 12 | Middle | 12 | 6 | 1 | 1 | 1 | 1 | — | — |

**Strip idx** column matches §1. **CD** columns match **`MG_CLIFF_DOUBLE_CD_MAP`** (§3).

---

## 5. `MG_WANG_SEMANTIC_TO_GRID` (frozen object)

```js
// semantic index → 5×3 linear grid index (§2)
{
  0: 1, 1: 2, 2: 7, 3: 12, 4: 11,
  5: 10, 6: 5, 7: 0, 8: 9, 9: 8,
  10: 4, 11: 3, 12: 6,
}
```

Readable mapping (from source comments):

```text
0(N)→1   1(NE out)→2   2(E)→7   3(SE out)→12   4(S)→11
5(SW out)→10   6(W)→5   7(NW out)→0
8(NW in)→9   9(NE in)→8   10(SW in)→4   11(SE in)→3
12(Fill, road/water only)→6
```

---

## 6. Atlas packing & export (pointer)

- **5×3 block** placement inside **`tileset.png`** / **`tileset_bm_*.png`**: **`packMgTileset`** in **`mgTilesetPack.js`**; each Wang strip occupies a **160×96** block; **`|f32|`** forest sidecars sit in the **remaining width** on the same row (full rules: **`docs/HANDBOOK.md`** §9).
- **RM tile IDs:** `384 + (atlasY/32) * (atlasWidth/32) + (atlasX/32)` from packed pixel positions — not a simple serial index over pack order.
- **Conversion tables:** semantic keys → **`rmTileId`** in **`render.json`** (`serializedConversionTableFromLookup`).

---

## 7. Related source files

| Topic | File |
|------|------|
| Semantic → grid, cliff_double map | `src/renderer/mgLayers.js` |
| `cliffTileIdx`, `dir12` | `src/renderer/engine/tiling.js` |
| Step 11 cliffs, double-height pairing | `src/renderer/layoutGen.js` |
| Atlas pack, forest rows | `src/renderer/mgTilesetPack.js` |
