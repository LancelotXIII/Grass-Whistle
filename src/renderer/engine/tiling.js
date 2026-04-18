/**
 * @file Shared tiling helpers used by both the engine and Map Generator.
 */

/**
 * Computes the directional 12-tile Wang index for a cell in a flat bitmap.
 *
 * A cell is an "edge" (true) when its neighbour in that direction does NOT share
 * the same terrain layer (i.e. the neighbour bit is 0). The decision tree maps
 * the 8-neighbour edge configuration to a strip column index used by tilesets.
 *
 * Strip layout (columns 0–12):
 *   0=N  1=NE(outer)  2=E  3=SE(outer)  4=S  5=SW(outer)  6=W  7=NW(outer)
 *   8=NW(inner)  9=NE(inner)  10=SW(inner)  11=SE(inner)  12=fill(interior)
 *
 * Works for any bitmap width — pass `stride=W` for world-scale bitmaps and
 * `stride=PANEL` for single-panel bitmaps.
 *
 * @param {Uint8Array} bmp   Flat row-major bitmap (1 = same layer, 0 = other layer).
 * @param {number}     cx    X coordinate of the cell within the bitmap.
 * @param {number}     cy    Y coordinate of the cell within the bitmap.
 * @param {number}     stride Row width of the bitmap (used for bounds checking).
 * @returns {number} Tile strip index 0–12.
 */
export function dir12(bmp, cx, cy, stride) {
  const rows = (bmp.length / stride) | 0
  const g = (x, y) => (x < 0 || y < 0 || x >= stride || y >= rows) ? 0 : bmp[y * stride + x]
  const N = !g(cx, cy - 1), S = !g(cx, cy + 1), E = !g(cx + 1, cy), Ww = !g(cx - 1, cy)
  const NE = !g(cx + 1, cy - 1), SE = !g(cx + 1, cy + 1), SW = !g(cx - 1, cy + 1), NW = !g(cx - 1, cy - 1)
  if      (N && !E && !Ww)  return 0
  else if (E && !N && !S)   return 2
  else if (S && !E && !Ww)  return 4
  else if (Ww && !N && !S)  return 6
  else if (N && E && NE)    return 1
  else if (S && E && SE)    return 3
  else if (S && Ww && SW)   return 5
  else if (N && Ww && NW)   return 7
  else if (NE && !N && !E)  return 9
  else if (SE && !S && !E)  return 11
  else if (SW && !S && !Ww) return 10
  else if (NW && !N && !Ww) return 8
  else if (N && E)          return 9
  else if (S && E)          return 11
  else if (S && Ww)         return 10
  else if (N && Ww)         return 8
  else if (N)               return 0
  else if (E)               return 2
  else if (S)               return 4
  else if (Ww)              return 6
  else                      return 12
}

/**
 * Encodes cliff direction in 12 variants (0–11) using 8-neighbor edge tests.
 * Mirrors the intent in docs/ENGINE_PIPELINE.md Step 11 (cliff detection).
 *
 * @returns {number}
 */
export function cliffTileIdx(N, S, E, Ww, NE, SE, SW, NW) {
  // Straight edges — single cardinal, no perpendicular drop
  if      (N && !E && !Ww) return 0
  else if (E && !N && !S)  return 2
  else if (S && !E && !Ww) return 4
  else if (Ww && !N && !S) return 6
  // Outer corners — two cardinals + shared diagonal all lower (exposed tip)
  else if (N && E && NE)   return 1
  else if (S && E && SE)   return 3
  else if (S && Ww && SW)  return 5
  else if (N && Ww && NW)  return 7
  // Inner corners — diagonal drop only (concave notch)
  else if (NE && !N && !E)  return 9
  else if (SE && !S && !E)  return 11
  else if (SW && !S && !Ww) return 10
  else if (NW && !N && !Ww) return 8
  // Inner corners — two cardinals, diagonal not lower (concave notch)
  else if (N && E)  return 9
  else if (S && E)  return 11
  else if (S && Ww) return 10
  else if (N && Ww) return 8
  // Fallback to nearest cardinal
  else if (N)  return 0
  else if (E)  return 2
  else if (S)  return 4
  else         return 6
}

