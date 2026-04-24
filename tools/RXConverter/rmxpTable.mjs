/**
 * RPG Maker XP `Table` (RPG::Table) binary encoding helpers.
 *
 * In XP, map tile data is stored as a 3D Table: width × height × 3 layers (z=0..2),
 * serialized as:
 *   int32le dim, xsize, ysize, zsize, length
 *   int16le[length] payload
 *
 * Indexing matches RGSS Table:
 *   idx = x + y*xsize + z*xsize*ysize
 */
export function decodeRmxpTable(userDefinedBytes) {
  if (!(userDefinedBytes instanceof Uint8Array)) {
    throw new TypeError('Expected Uint8Array for RPG::Table userDefined bytes.')
  }
  if (userDefinedBytes.byteLength < 20) {
    throw new Error('RPG::Table blob too small.')
  }
  const dv = new DataView(
    userDefinedBytes.buffer,
    userDefinedBytes.byteOffset,
    userDefinedBytes.byteLength,
  )
  let o = 0
  const readI32 = () => {
    const v = dv.getInt32(o, true)
    o += 4
    return v
  }
  const dim = readI32()
  const xsize = readI32()
  const ysize = readI32()
  const zsize = readI32()
  const length = readI32()

  if (dim !== 3) {
    throw new Error(`Unexpected Table dim=${dim} (expected 3).`)
  }
  if (xsize < 1 || ysize < 1 || zsize < 1) {
    throw new Error(`Invalid Table dimensions ${xsize}×${ysize}×${zsize}.`)
  }
  if (length !== xsize * ysize * zsize) {
    throw new Error(
      `Table length mismatch: header length=${length}, expected=${xsize * ysize * zsize}.`,
    )
  }

  const bytesNeeded = 20 + length * 2
  if (userDefinedBytes.byteLength < bytesNeeded) {
    throw new Error(
      `RPG::Table payload truncated: have=${userDefinedBytes.byteLength} need=${bytesNeeded}.`,
    )
  }

  const base = o
  const idx = (x, y, z) => x + y * xsize + z * xsize * ysize
  const get = (x, y, z) => dv.getInt16(base + idx(x, y, z) * 2, true)

  return { dim, xsize, ysize, zsize, length, get }
}

export function encodeRmxpTable({ xsize, ysize, zsize, get }) {
  if (!Number.isInteger(xsize) || xsize < 1) throw new Error('Invalid xsize.')
  if (!Number.isInteger(ysize) || ysize < 1) throw new Error('Invalid ysize.')
  if (!Number.isInteger(zsize) || zsize < 1) throw new Error('Invalid zsize.')
  if (typeof get !== 'function') throw new Error('encodeRmxpTable requires get(x,y,z).')

  const dim = 3
  const length = xsize * ysize * zsize
  const totalBytes = 20 + length * 2
  const bytes = new Uint8Array(totalBytes)
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let o = 0
  const writeI32 = (v) => {
    dv.setInt32(o, v | 0, true)
    o += 4
  }
  writeI32(dim)
  writeI32(xsize)
  writeI32(ysize)
  writeI32(zsize)
  writeI32(length)

  const base = o
  const idx = (x, y, z) => x + y * xsize + z * xsize * ysize
  for (let z = 0; z < zsize; z++) {
    for (let y = 0; y < ysize; y++) {
      for (let x = 0; x < xsize; x++) {
        const v = get(x, y, z) | 0
        dv.setInt16(base + idx(x, y, z) * 2, v, true)
      }
    }
  }
  return bytes
}

/**
 * Patch a contiguous index range in a dim=1 RPG::Table (e.g. Tilesets @passages).
 * Layout: int32le dim, xsize, ysize, zsize, length; then int16le[length] at offset 20.
 * Returns false if the blob is not a 1×1×xsize strip or is too small.
 *
 * @param {Uint8Array} userDefinedBytes
 * @param {number} fromInclusive
 * @param {number} toInclusive
 * @param {number} int16Value
 */
export function patchRmxpTable1DRange(
  userDefinedBytes,
  fromInclusive,
  toInclusive,
  int16Value,
) {
  if (!(userDefinedBytes instanceof Uint8Array) || userDefinedBytes.byteLength < 20) {
    return false
  }
  const dv = new DataView(
    userDefinedBytes.buffer,
    userDefinedBytes.byteOffset,
    userDefinedBytes.byteLength,
  )
  const dim = dv.getInt32(0, true)
  const xsize = dv.getInt32(4, true)
  const ysize = dv.getInt32(8, true)
  const zsize = dv.getInt32(12, true)
  const length = dv.getInt32(16, true)
  if (dim !== 1 || ysize !== 1 || zsize !== 1) return false
  if (length !== xsize) return false
  const bytesNeeded = 20 + length * 2
  if (userDefinedBytes.byteLength < bytesNeeded) return false
  const base = 20
  const lo = Math.max(0, fromInclusive | 0)
  const hi = Math.min(length - 1, toInclusive | 0)
  if (lo > hi) return true
  const v = int16Value | 0
  for (let i = lo; i <= hi; i++) {
    dv.setInt16(base + i * 2, v, true)
  }
  return true
}

