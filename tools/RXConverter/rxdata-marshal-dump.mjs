/**
 * Dump any Ruby Marshal `.rxdata` to readable JSON (no map/table special cases).
 * Use for Tilesets.rxdata, System.rxdata, etc.
 */
import fs from 'node:fs'
import path from 'node:path'
import { load } from '@hyrious/marshal'
import { toJsonable } from './marshalJson.mjs'

function usage() {
  console.log(
    [
      'Usage:',
      '  node tools/RXConverter/rxdata-marshal-dump.mjs <file.rxdata|file.dat> [out.json]',
      '',
      'Writes JSON with { kind, source, marshal } — full Marshal graph as JSON-safe data.',
    ].join('\n'),
  )
}

const inPath = process.argv[2]
if (!inPath) {
  usage()
  process.exit(1)
}
const outPath =
  process.argv[3] || inPath.replace(/\.(rxdata|dat)$/i, '.marshal.json')

const buf = fs.readFileSync(inPath)
const root = load(buf, { string: 'binary' })

const payload = {
  schemaVersion: 1,
  generator: 'Grasswhistle.tools',
  kind: 'rxdata_marshal_dump',
  extractedAt: new Date().toISOString(),
  source: { file: path.basename(inPath) },
  marshal: toJsonable(root),
}

fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8')
console.log(`Wrote ${outPath}`)
