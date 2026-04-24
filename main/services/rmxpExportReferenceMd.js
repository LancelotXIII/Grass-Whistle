const path = require('path')

function escCell(s) {
  if (s == null) return ''
  return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function relFromDataDir(dataDir, absPath) {
  if (!absPath || !dataDir) return absPath || ''
  try {
    return path.relative(dataDir, absPath).split(path.sep).join('/')
  } catch {
    return absPath
  }
}

/**
 * Group `written` rows into { parent, children[] } in export order.
 * Skips the region_root entry (top-level folder, not a map group).
 */
function clusterWritten(written) {
  const out = []
  let i = 0
  while (i < written.length) {
    const w = written[i]
    if (w && w.rmxpRole === 'region_root') {
      i++
      continue
    }
    if (w && w.rmxpRole === 'group_parent') {
      const parent = w
      const children = []
      i++
      while (
        i < written.length &&
        written[i]?.rmxpRole === 'panel' &&
        (written[i].parentMapId | 0) === (parent.mapId | 0)
      ) {
        children.push(written[i])
        i++
      }
      out.push({ parent, children })
    } else {
      out.push({ parent: null, children: [w] })
      i++
    }
  }
  return out
}

/**
 * @param {object} opts
 * @param {Date} [opts.now]
 * @param {string} opts.title
 * @param {object} opts.bundle
 * @param {number} opts.tilesetId
 * @param {number} opts.startMapId
 * @param {string} opts.dataDir
 * @param {Array<object>} opts.written
 * @param {boolean} opts.tilesetOnly
 * @param {boolean} opts.multiBiomeTilesets
 * @param {string|null} opts.tilesetOutPath
 * @param {string|null} opts.tilesetsOutPath
 * @param {string|null} opts.mapInfosOutPath
 * @param {string|null} opts.readmePath
 * @param {string|null} opts.mapMetadataPath
 * @param {string|null} opts.mapConnectionsPath
 * @param {string|null} opts.mapConnectionsExtraPath
 * @param {string} [opts.tilesetsNote]
 * @param {string} [opts.mapInfosNote]
 */
function buildRmxpExportReferenceMarkdown(opts) {
  const now = opts.now instanceof Date ? opts.now : new Date()
  const title = escCell(opts.title || 'Grasswhistle')
  const bundle = opts.bundle || {}
  const tid = opts.tilesetId | 0
  const sid = opts.startMapId | 0
  const dataDir = opts.dataDir || ''
  const written = Array.isArray(opts.written) ? opts.written : []
  const tilesetOnly = !!opts.tilesetOnly
  const multi = !!opts.multiBiomeTilesets

  const lines = []

  lines.push('# RPG Maker XP export reference')
  lines.push('')
  lines.push(`*Generated ${now.toISOString()} by Grasswhistle Map Generator.*`)
  lines.push('')
  lines.push('This file documents what was produced in this export so you can merge into Pokémon Essentials (or another RMXP project) with context.')
  lines.push('')

  lines.push('## Project and render bundle')
  lines.push('')
  lines.push('| Field | Value |')
  lines.push('| --- | --- |')
  lines.push(`| Display title | ${title} |`)
  lines.push(`| \`render.json\` kind | ${escCell(bundle.kind || '—')} |`)
  lines.push(`| Schema version | ${escCell(bundle.schemaVersion != null ? String(bundle.schemaVersion) : '—')} |`)
  lines.push(`| Panel size (tiles) | ${escCell(bundle.panelSize != null ? String(bundle.panelSize) : '—')} |`)
  lines.push(`| Panels in bundle | ${Array.isArray(bundle.panels) ? bundle.panels.length : 0} |`)
  if (bundle.metadata && typeof bundle.metadata === 'object') {
    const keys = Object.keys(bundle.metadata)
    lines.push(`| Bundle metadata keys | ${escCell(keys.join(', ') || '—')} |`)
  }
  lines.push('')

  lines.push('## Export parameters')
  lines.push('')
  lines.push('| Setting | Value |')
  lines.push('| --- | --- |')
  lines.push(`| First map id (\`startMapId\`) | ${sid} |`)
  lines.push(`| Base tileset database id (\`tilesetId\`) | ${tid} |`)
  lines.push(`| Multi-biome atlases | ${multi ? 'yes (one Tilesets slot per biome composition)' : 'no (single atlas)'} |`)
  lines.push('')

  if (tilesetOnly) {
    lines.push('## Tileset-only export')
    lines.push('')
    lines.push('This run did **not** write `Map*.rxdata`, MapInfos, or PBS map files — only tileset graphics and `Tilesets.rxdata`.')
    lines.push('')
  } else {
    lines.push('## How maps are grouped')
    lines.push('')
    lines.push(
      'Panels are grouped by **map name** from generation (`Settlement N`, `Route N`, `Bonus Area N`, `Halo`, or `x,y` fallback). ' +
        'Export **order** is: **Settlement → Route → Bonus Area → Halo → other**, then cluster number and map position.',
    )
    lines.push('')
    lines.push(
      'A **top-level region map** (named after the region/project) is written first as a blank folder. ' +
      'Each group then gets a **1×1 blank parent map** nested under it, and one **child map per panel**, named `{Group name} A`, `B`, … in top-left → bottom-right order within the group.',
    )
    lines.push('')

    const clusters = clusterWritten(written)
    lines.push('### Groups (parent + panel maps)')
    lines.push('')
    lines.push('| # | Group name | Parent map id | Parent file | Panel maps (id / file / name / grid) |')
    lines.push('| --- | --- | --- | --- | --- |')
    let gi = 0
    for (const { parent, children } of clusters) {
      gi++
      if (parent) {
        const kids = children
          .map(
            (c) =>
              `${c.mapId}: \`${escCell(c.file)}\` “${escCell(c.mapName)}” @ (${c.x},${c.y})`,
          )
          .join('; ')
        lines.push(
          `| ${gi} | ${escCell(parent.mapName)} | ${parent.mapId} | \`${escCell(parent.file)}\` | ${kids || '—'} |`,
        )
      } else if (children[0]) {
        const c = children[0]
        lines.push(
          `| ${gi} | *(ungrouped)* | — | — | ${c.mapId}: \`${escCell(c.file)}\` @ (${c.x},${c.y}) |`,
        )
      }
    }
    lines.push('')

    lines.push('### Full map list')
    lines.push('')
    lines.push('| Map id | File | Role | Editor name | Parent map id | Panel (x,y) |')
    lines.push('| --- | --- | --- | --- | --- | --- |')
    for (const w of written) {
      const role =
        w.rmxpRole === 'region_root' ? 'region root (blank)' :
        w.rmxpRole === 'group_parent' ? 'group parent (blank)' : 'panel'
      const pid = w.parentMapId != null && (w.parentMapId | 0) > 0 ? String(w.parentMapId | 0) : '—'
      const xy =
        w.rmxpRole === 'region_root' || w.rmxpRole === 'group_parent' || w.x == null || w.y == null ? '—' : `(${w.x},${w.y})`
      lines.push(
        `| ${w.mapId | 0} | \`${escCell(w.file)}\` | ${role} | ${escCell(w.mapName)} | ${pid} | ${xy} |`,
      )
    }
    lines.push('')
  }

  lines.push('## Tilesets')
  lines.push('')
  lines.push('| Output | Path (relative to folder you exported into) |')
  lines.push('| --- | --- |')
  if (opts.tilesetOutPath) {
    lines.push(`| Packed atlas PNG | \`${escCell(relFromDataDir(dataDir, opts.tilesetOutPath))}\` |`)
  } else {
    lines.push('| Packed atlas PNG | *(not found / not copied)* |')
  }
  if (opts.tilesetsOutPath) {
    lines.push(`| \`Tilesets.rxdata\` | \`${escCell(relFromDataDir(dataDir, opts.tilesetsOutPath))}\` |`)
  }
  lines.push('')
  if (multi) {
    const n = Array.isArray(bundle.biomeTilesets) ? bundle.biomeTilesets.length : 0
    lines.push(
      `**Multi-atlas mode:** \`Tilesets.rxdata\` defines **${n}** slot(s), ids **${tid}**–**${tid + Math.max(0, n) - 1}**. Each panel map references the slot that matches its biome mix. Copy every \`tileset_bm_*.png\` next to \`tileset.png\` if present.`,
    )
  } else {
    lines.push(`**Single-atlas mode:** all exported maps use tileset id **${tid}** with graphic \`tileset.png\`.`)
  }
  lines.push('')
  if (opts.tilesetsNote) {
    lines.push('**Notes:**')
    lines.push('')
    lines.push(opts.tilesetsNote)
    lines.push('')
  }

  if (!tilesetOnly) {
    lines.push('## MapInfos')
    lines.push('')
    if (opts.mapInfosOutPath) {
      lines.push(`- **File:** \`${escCell(relFromDataDir(dataDir, opts.mapInfosOutPath))}\``)
    }
    lines.push(
      '- **Template:** bundled Pokémon Essentials–style `MapInfos.pokemon_essentials_v21_blank.rxdata` (Intro / Start rows when ids do not collide), merged with the map rows above.',
    )
    if (opts.mapInfosNote) {
      lines.push(`- **Note:** ${escCell(opts.mapInfosNote)}`)
    }
    lines.push('')

    lines.push('## Pokémon Essentials PBS (reference)')
    lines.push('')
    lines.push('These are **text** stubs for Essentials; compile to `.dat` with your game’s tools if you use them.')
    lines.push('')
    lines.push('| File | Path |')
    lines.push('| --- | --- |')
    if (opts.mapMetadataPath) {
      lines.push(`| \`map_metadata.txt\` | \`${escCell(relFromDataDir(dataDir, opts.mapMetadataPath))}\` |`)
    }
    if (opts.mapConnectionsPath) {
      lines.push(`| \`map_connections.txt\` | \`${escCell(relFromDataDir(dataDir, opts.mapConnectionsPath))}\` |`)
    }
    if (opts.mapConnectionsExtraPath) {
      lines.push(`| \`map_connections_extra.txt\` | \`${escCell(relFromDataDir(dataDir, opts.mapConnectionsExtraPath))}\` |`)
    }
    lines.push('')
    lines.push(
      `Panel-based **map connections** use **map id** and **${escCell(String(bundle.panelSize || '?'))}** tiles per panel step on the world grid. Group parent maps are **not** listed in PBS — only real panel maps.`,
    )
    lines.push('')
  }

  lines.push('## Plain-text readme')
  lines.push('')
  if (opts.readmePath) {
    lines.push(`See also \`${escCell(relFromDataDir(dataDir, opts.readmePath))}\` for merge reminders.`)
  } else {
    lines.push('*(No README path recorded.)*')
  }
  lines.push('')

  lines.push('## Merge checklist')
  lines.push('')
  lines.push('- Back up your game’s `Data/` and `Graphics/`.')
  lines.push('- Copy `Export/Data/*` → game `Data/`.')
  lines.push('- Copy `Export/Graphics/*` → game `Graphics/`.')
  lines.push('- Optionally merge `Export/PBS/*.txt` into your PBS workflow.')
  lines.push('')

  return lines.join('\n')
}

module.exports = { buildRmxpExportReferenceMarkdown }
