import fs from 'node:fs'
import path from 'node:path'
import { load } from '@hyrious/marshal'
import { decodeRmxpTable } from './rmxpTable.mjs'
import { toJsonable } from './marshalJson.mjs'

function usage() {
  console.log(
    [
      'Usage:',
      '  node tools/RXConverter/rxdata-to-json.mjs <MapXXX.rxdata> [out.json]',
      '',
      'Outputs a Grasswhistle-friendly JSON containing:',
      '- width/height/tilesetId',
      '- cells[] in row-major order, each with layer1/layer2/layer3.rmTileId',
    ].join('\n'),
  )
}

const inPath = process.argv[2]
if (!inPath) {
  usage()
  process.exit(1)
}
const outPath = process.argv[3] || inPath.replace(/\.rxdata$/i, '.json')

const buf = fs.readFileSync(inPath)
// Use binary strings to avoid Node/Marshal edge-cases with ivars on empty strings.
const map = load(buf, { string: 'binary' })

const iv = map?.wrapped ?? map
const sym = (s) => Symbol.for(s)

const width = iv[sym('@width')]
const height = iv[sym('@height')]
const tilesetId = iv[sym('@tileset_id')]
const dataObj = iv[sym('@data')]
const ud = dataObj?.userDefined
if (!(ud instanceof Uint8Array)) {
  throw new Error('Map @data is missing userDefined bytes (expected RPG::Table).')
}

const t = decodeRmxpTable(ud)
if (t.xsize !== width || t.ysize !== height) {
  // Some editors can desync these; prefer the table’s header as truth.
  // Still include the ivars so you can see the mismatch.
}

/** row-major cells: (y*width + x) */
const cells = []
for (let y = 0; y < t.ysize; y++) {
  for (let x = 0; x < t.xsize; x++) {
    const l1 = t.get(x, y, 0) | 0
    const l2 = t.get(x, y, 1) | 0
    const l3 = t.get(x, y, 2) | 0
    cells.push({
      layer1: l1 ? { rmTileId: l1 } : null,
      layer2: l2 ? { rmTileId: l2 } : null,
      layer3: l3 ? { rmTileId: l3 } : null,
    })
  }
}

const payload = {
  schemaVersion: 2,
  generator: 'Grasswhistle.tools',
  kind: 'rxdata_map_full',
  extractedAt: new Date().toISOString(),
  source: {
    file: path.basename(inPath),
  },
  map: {
    width: t.xsize,
    height: t.ysize,
    layers: t.zsize,
    tilesetId: tilesetId ?? null,
    ivarWidth: width ?? null,
    ivarHeight: height ?? null,
  },
  cells,
  // Full Marshal object (RPG::Map) so events/audio/etc round-trip.
  // Stored in a JSON-safe form (symbols/bytes preserved).
  marshal: toJsonable(map),
}

fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8')
console.log(`Wrote ${outPath}`)

