import crypto from 'crypto'

import {
  generateRegion,
  regenerateFromTerrain,
  PANEL,
} from '../../src/renderer/layoutGen.js'

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function stableJsonHash(obj) {
  const s = JSON.stringify(obj)
  return sha256Hex(Buffer.from(s, 'utf8'))
}

function summarizeRegion(region) {
  const width = region?.width | 0
  const height = region?.height | 0
  const seed = region?.seed ?? null

  const terrain = region?.terrain
  const terrainHash =
    terrain && terrain.buffer
      ? sha256Hex(Buffer.from(terrain.buffer))
      : null

  const panelKeys = Object.keys(region?.panelData || {}).sort()
  const visitablePanels = panelKeys.filter((k) => {
    const p = region.panelData[k]
    return !!(p?.isRoute || p?.settlement)
  })

  const settlementCount = panelKeys.reduce((n, k) => n + (region.panelData[k]?.settlement ? 1 : 0), 0)
  const routePanelCount = panelKeys.reduce((n, k) => n + (region.panelData[k]?.isRoute ? 1 : 0), 0)
  const forestHaloCount = panelKeys.reduce((n, k) => n + (region.panelData[k]?.isForestHalo ? 1 : 0), 0)

  // Cell-type histogram (over visitable panels only; keeps runtime sane)
  const typeCounts = {}
  for (const k of visitablePanels) {
    const g = region.panelData[k]?.grid
    if (!Array.isArray(g)) continue
    for (const c of g) {
      const t = c?.type || 'UNKNOWN'
      typeCounts[t] = (typeCounts[t] || 0) + 1
    }
  }

  return {
    seed,
    width,
    height,
    panelSize: PANEL,
    settlementCount,
    routePanelCount,
    forestHaloCount,
    roadPathCount: Array.isArray(region?.roadPaths) ? region.roadPaths.length : 0,
    roadWaypointCount: Array.isArray(region?.roadWaypoints) ? region.roadWaypoints.length : 0,
    terrainHash,
    typeCountsHash: stableJsonHash(typeCounts),
  }
}

function buildBaselineCase({ seed, width, height, settlements, secretHalo }) {
  const region = generateRegion({ seed, width, height, settlements, secretHalo })
  const sum = summarizeRegion(region)

  // Also verify regenerateFromTerrain stability (Steps 6+ replay)
  const regen = regenerateFromTerrain({
    terrain: region.terrain,
    settlements,
    lockedSettlements: [],
    secretHalo,
  })
  const regenSum = summarizeRegion(regen)

  return {
    input: { seed, width, height, settlements, secretHalo },
    output: sum,
    regenerateFromTerrain: regenSum,
  }
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const shouldUpdate = args.has('--update')

  const fixturesPath = new URL('./fixtures/golden-seeds.json', import.meta.url)
  /** @type {{ schemaVersion: number, cases: any[] }} */
  let fixtures = null
  try {
    fixtures = JSON.parse(await (await import('fs/promises')).readFile(fixturesPath, 'utf8'))
  } catch {
    fixtures = null
  }

  const cases = [
    // Keep these relatively small so the check stays fast during refactors.
    { seed: 12345, width: 10, height: 10, settlements: 6, secretHalo: true },
    { seed: 777, width: 12, height: 8, settlements: 6, secretHalo: false },
  ].map(buildBaselineCase)

  const next = { schemaVersion: 1, cases }

  if (shouldUpdate || !fixtures) {
    await (await import('fs/promises')).mkdir(new URL('./fixtures/', import.meta.url), { recursive: true })
    await (await import('fs/promises')).writeFile(fixturesPath, JSON.stringify(next, null, 2) + '\n', 'utf8')
    process.stdout.write(`Wrote fixtures: ${fixturesPath.pathname}\n`)
    return
  }

  const diffs = []
  const prevCases = Array.isArray(fixtures?.cases) ? fixtures.cases : []
  for (let i = 0; i < Math.max(prevCases.length, next.cases.length); i++) {
    const a = prevCases[i]
    const b = next.cases[i]
    if (!a || !b) {
      diffs.push({ index: i, reason: 'case_count_changed' })
      continue
    }
    const aStr = JSON.stringify(a)
    const bStr = JSON.stringify(b)
    if (aStr !== bStr) {
      diffs.push({
        index: i,
        input: b.input,
        prevHash: sha256Hex(Buffer.from(aStr, 'utf8')),
        nextHash: sha256Hex(Buffer.from(bStr, 'utf8')),
      })
    }
  }

  if (diffs.length) {
    process.stderr.write(`Golden seed regression FAILED (${diffs.length} diffs)\n`)
    process.stderr.write(JSON.stringify(diffs, null, 2) + '\n')
    process.exitCode = 1
    return
  }

  process.stdout.write('Golden seed regression OK\n')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})

