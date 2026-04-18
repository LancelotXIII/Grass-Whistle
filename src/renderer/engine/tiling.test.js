import { describe, it, expect } from 'vitest'
import { dir12, cliffTileIdx } from './tiling.js'

describe('dir12', () => {
  it('returns 12 for a full interior cell on a solid same-layer island', () => {
    const w = 5
    const h = 5
    const bmp = new Uint8Array(w * h).fill(1)
    expect(dir12(bmp, 2, 2, w)).toBe(12)
  })

  it('returns a non-interior index when a diagonal neighbour differs', () => {
    const w = 3
    const h = 3
    const bmp = new Uint8Array(w * h).fill(1)
    bmp[0] = 0
    expect(dir12(bmp, 1, 1, w)).toBe(8)
  })
})

describe('cliffTileIdx', () => {
  it('maps a single northern lower neighbour to 0', () => {
    expect(cliffTileIdx(true, false, false, false, false, false, false, false)).toBe(0)
  })

  it('maps all-false to a cardinal fallback (6 for west)', () => {
    expect(cliffTileIdx(false, false, false, false, false, false, false, false)).toBe(6)
  })
})
