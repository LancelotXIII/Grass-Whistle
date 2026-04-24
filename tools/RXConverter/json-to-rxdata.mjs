import fs from 'node:fs'
import path from 'node:path'
import { dump, load } from '@hyrious/marshal'
import { encodeRmxpTable } from './rmxpTable.mjs'
import { fromJsonable } from './marshalJson.mjs'
import { buildRmxpLayerGet } from './rmxpMapExport.mjs'

function usage() {
  console.log(
    [
      'Usage:',
      '  node tools/RXConverter/json-to-rxdata.mjs <in.json> <template.rxdata> <out.rxdata> [--tileset-id N] [--panel X,Y]',
      '',
      'Input JSON can be either:',
      '  - Grasswhistle Render bundle (render.json, kind: map_generator_render)',
      '  - rxdata_map_full (from tools/RXConverter/rxdata-to-json.mjs) [round-trip keeps events/etc]',
      '',
      'Notes:',
      '  - This patches a template rxdata (recommended: a blank RM/Essentials map).',
      '  - It overwrites @width/@height/@data and (optionally) @tileset_id.',
    ].join('\n'),
  )
}

const inJsonPath = process.argv[2]
const templatePath = process.argv[3]
const outPath = process.argv[4]
if (!inJsonPath || !templatePath || !outPath) {
  usage()
  process.exit(1)
}

const args = process.argv.slice(5)
const getArg = (k) => {
  const i = args.indexOf(k)
  if (i < 0) return null
  return args[i + 1] ?? null
}
const tilesetIdArg = getArg('--tileset-id')
const panelArg = getArg('--panel') // "x,y"

const input = JSON.parse(fs.readFileSync(inJsonPath, 'utf8'))

function pickPanelFromRenderBundle(bundle) {
  const panels = bundle?.panels
  if (!Array.isArray(panels) || panels.length < 1) return null
  if (!panelArg) return panels[0]
  const [sx, sy] = String(panelArg)
    .split(',')
    .map((n) => Number.parseInt(n, 10))
  return panels.find((p) => p && p.x === sx && p.y === sy) || null
}

let width = null
let height = null
let zsize = 3
let tilesetId = tilesetIdArg != null ? Number.parseInt(tilesetIdArg, 10) : null

/** @type {Array<{ layer1?: any, layer2?: any, layer3?: any }>} */
let cells = null
let marshalMap = null

if (input?.kind === 'map_generator_render' && Array.isArray(input?.panels)) {
  const panel = pickPanelFromRenderBundle(input)
  if (!panel) {
    throw new Error('No panel found in render bundle. Provide --panel X,Y or ensure panels[] exists.')
  }
  const panelSize = input?.panelSize
  if (!Number.isInteger(panelSize) || panelSize < 1) {
    throw new Error('render.json missing panelSize.')
  }
  width = panelSize
  height = panelSize
  zsize = 3
  if (tilesetId == null && Number.isInteger(panel?.tilesetId)) tilesetId = panel.tilesetId
  cells = panel?.cells
  if (!Array.isArray(cells) || cells.length !== width * height) {
    throw new Error(`Panel cells length mismatch: expected ${width * height}, got ${cells?.length}`)
  }
} else if (input?.kind === 'rxdata_map_full' && input?.map && Array.isArray(input?.cells)) {
  width = input.map.width | 0
  height = input.map.height | 0
  zsize = input.map.layers ? input.map.layers | 0 : 3
  if (tilesetId == null && Number.isInteger(input.map.tilesetId)) tilesetId = input.map.tilesetId
  cells = input.cells
  if (cells.length !== width * height) {
    throw new Error(`cells length mismatch: expected ${width * height}, got ${cells.length}`)
  }
  if (input.marshal) marshalMap = fromJsonable(input.marshal)
} else {
  throw new Error(`Unrecognized input JSON kind: ${String(input?.kind)}`)
}

if (zsize !== 3) {
  throw new Error(`Only zsize=3 is supported for RMXP maps (got ${zsize}).`)
}

// Prefer the full marshal object (keeps events/audio/etc). Otherwise load template rxdata.
const map = marshalMap
  ? marshalMap
  : load(fs.readFileSync(templatePath), { string: 'binary' })
const iv = map?.wrapped ?? map
const sym = (s) => Symbol.for(s)

// Ensure @data exists on template
const dataObj = iv[sym('@data')]
if (!dataObj) throw new Error('Template map missing @data.')

const layerGet = buildRmxpLayerGet(cells, width)
const tableBytes = encodeRmxpTable({
  xsize: width,
  ysize: height,
  zsize: 3,
  get: layerGet,
})

iv[sym('@width')] = width
iv[sym('@height')] = height
if (tilesetId != null && Number.isInteger(tilesetId)) {
  iv[sym('@tileset_id')] = tilesetId
}

// Patch the table blob
dataObj.userDefined = tableBytes

// Optional: if the template has events way out of bounds, the editor can behave oddly.
// Keep template events by default; users can provide a blank template to avoid that.

const outBuf = dump(map)
fs.writeFileSync(outPath, outBuf)
console.log(`Wrote ${outPath}`)
console.log(`Map: ${width}x${height} tiles, tilesetId=${tilesetId ?? '(template)'} template=${path.basename(templatePath)}`)

