/**
 * Narrow cliff_double troubleshooting: scans the generated region and reports only
 * cells that look wrong (not the full grid).
 */
import { PANEL, T } from '../engine/constants.js'

/**
 * @param {{ panelData?: Object, width?: number, height?: number }} region
 * @returns {{
 *   counts: { cliffDouble: number, part2: number, cliff: number, innerCornerDoubles: number, innerPart2: number },
 *   innerAnchorsWithInvalidSouth: Array<{ wx: number, wy: number, anchorTi: number, reason: string, southType: string, southTi: number }>,
 *   part2ScanOrderSample: Array<{ wx: number, wy: number, ti: number }>,
 *   innerCornerDoubleCells: Array<{ wx: number, wy: number, ti: number }>,
 *   innerPart2Cells: Array<{ wx: number, wy: number, ti: number }>,
 *   part2ByTi: Record<number, number>,
 * }}
 */
export function probeCliffDoubleRegion(region) {
  const panelData = region?.panelData
  const width = region?.width | 0
  const height = region?.height | 0
  if (!panelData || width < 1 || height < 1) {
    return {
      counts: { cliffDouble: 0, part2: 0, cliff: 0, innerCornerDoubles: 0, innerPart2: 0 },
      innerAnchorsWithInvalidSouth: [],
      part2ScanOrderSample: [],
      innerCornerDoubleCells: [],
      innerPart2Cells: [],
      part2ByTi: {},
    }
  }

  const W = width * PANEL
  const H = height * PANEL

  const getCell = (wx, wy) => {
    if (wx < 0 || wy < 0 || wx >= W || wy >= H) return null
    return panelData[`${(wx / PANEL) | 0},${(wy / PANEL) | 0}`]?.grid[(wy % PANEL) * PANEL + (wx % PANEL)] ?? null
  }

  let cliffDouble = 0
  let part2 = 0
  let cliff = 0
  let innerCornerDoubles = 0
  let innerPart2 = 0

  /** @type {Array<{ wx: number, wy: number, anchorTi: number, reason: string, southType: string, southTi: number }>} */
  const innerAnchorsWithInvalidSouth = []
  /** @type {Array<{ wx: number, wy: number, ti: number }>} */
  const part2ScanOrderSample = []
  /** @type {Array<{ wx: number, wy: number, ti: number }>} */
  const innerCornerDoubleCells = []
  /** @type {Array<{ wx: number, wy: number, ti: number }>} */
  const innerPart2Cells = []
  /** @type {Record<number, number>} */
  const part2ByTi = {}

  for (let wy = 0; wy < H; wy++) {
    for (let wx = 0; wx < W; wx++) {
      const c = getCell(wx, wy)
      if (!c) continue
      const t = c.type
      const ti = c.tileIndex | 0

      if (t === T.CLIFF_DOUBLE) {
        cliffDouble++
        if (ti === 10 || ti === 11) {
          innerCornerDoubles++
          if (innerCornerDoubleCells.length < 20) innerCornerDoubleCells.push({ wx, wy, ti })
          const below = getCell(wx, wy + 1)
          if (!below) {
            innerAnchorsWithInvalidSouth.push({
              wx,
              wy,
              anchorTi: ti,
              reason: 'NO_CELL_SOUTH',
              southType: '',
              southTi: -1,
            })
          } else if (below.type === T.CLIFF) {
            innerAnchorsWithInvalidSouth.push({
              wx,
              wy,
              anchorTi: ti,
              reason: 'PLAIN_CLIFF',
              southType: below.type,
              southTi: below.tileIndex | 0,
            })
          } else if (below.type === T.CLIFF_DOUBLE) {
            innerAnchorsWithInvalidSouth.push({
              wx,
              wy,
              anchorTi: ti,
              reason: 'CLIFF_DOUBLE_NOT_PART2',
              southType: below.type,
              southTi: below.tileIndex | 0,
            })
          } else if (below.type !== T.CLIFF_DOUBLE_PART2) {
            innerAnchorsWithInvalidSouth.push({
              wx,
              wy,
              anchorTi: ti,
              reason: 'NOT_PART2',
              southType: below.type,
              southTi: below.tileIndex | 0,
            })
          }
        }
      } else if (t === T.CLIFF_DOUBLE_PART2) {
        part2++
        part2ByTi[ti] = (part2ByTi[ti] || 0) + 1
        if (part2ScanOrderSample.length < 30) part2ScanOrderSample.push({ wx, wy, ti })
        if (ti === 10 || ti === 11) {
          innerPart2++
          if (innerPart2Cells.length < 20) innerPart2Cells.push({ wx, wy, ti })
        }
      } else if (t === T.CLIFF) {
        cliff++
      }
    }
  }

  return {
    counts: { cliffDouble, part2, cliff, innerCornerDoubles, innerPart2 },
    innerAnchorsWithInvalidSouth,
    part2ScanOrderSample,
    innerCornerDoubleCells,
    innerPart2Cells,
    part2ByTi,
  }
}

/**
 * Logs a short report. Call from DevTools: `probeCliffDouble()`.
 * @param {{ panelData?: Object, width?: number, height?: number }} region
 */
export function logCliffDoubleProbe(region) {
  const r = probeCliffDoubleRegion(region)
  console.log(
    '[cliff_double probe] counts:',
    r.counts,
    '— doubles / part2 / cliff; innerCornerDoubles & innerPart2 = ti 10 or 11 only'
  )
  console.log('[cliff_double probe] PART2 rows by anchor semantic (tileIndex):', r.part2ByTi)
  if (r.counts.innerCornerDoubles === 0) {
    console.log('[cliff_double probe] No CLIFF_DOUBLE inner-corner anchors (ti 10/11) in this region.')
  } else if (r.innerAnchorsWithInvalidSouth.length > 0) {
    console.warn(
      '[cliff_double probe] Inner corner (ti 10/11): cell south must be CLIFF_DOUBLE_PART2 only — not plain CLIFF, not another CLIFF_DOUBLE anchor, not other terrain:'
    )
    console.table(r.innerAnchorsWithInvalidSouth)
  } else {
    console.log(
      '[cliff_double probe] All inner-corner anchors (ti 10/11) have CLIFF_DOUBLE_PART2 directly south.'
    )
  }
  if (r.innerCornerDoubleCells.length > 0) {
    console.log('[cliff_double probe] sample CLIFF_DOUBLE inner-corner anchors (ti 10/11), up to 20:')
    console.table(r.innerCornerDoubleCells)
  } else {
    console.log('[cliff_double probe] No CLIFF_DOUBLE cells with ti 10 or 11 in this region.')
  }
  if (r.innerPart2Cells.length > 0) {
    console.log('[cliff_double probe] sample PART2 for inner corners (ti 10/11), up to 20 — inspect these in-world:')
    console.table(r.innerPart2Cells)
  } else if (r.counts.innerPart2 === 0 && r.counts.innerCornerDoubles > 0) {
    console.warn(
      '[cliff_double probe] There are inner-corner doubles but zero PART2 with ti 10/11 — check north-of-PART2 pairing.'
    )
  }
  if (r.part2ScanOrderSample.length > 0) {
    console.log(
      '[cliff_double probe] first PART2 cells in scan order (often ti 3/4/5 — not inner 10/11):'
    )
    console.table(r.part2ScanOrderSample)
  }
  return r
}
