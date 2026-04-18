const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
const {
  RMXP_BLANK_MAP_TEMPLATE,
  RMXP_MAPINFOS_TEMPLATE,
  ensureExportGraphicsTilesetsDir,
  ensureExportPbsDir,
} = require('./paths')
const { buildPokemonEssentialsPbs } = require('./pokemonEssentialsPbs')
const { buildRmxpExportReferenceMarkdown } = require('./rmxpExportReferenceMd')

function passagesFromManifest(tileManifest, RM_PASSAGE_SOLID) {
  return Array.isArray(tileManifest)
    ? tileManifest
        .map((t) => {
          if (!t || !Number.isFinite(t.rmTileId)) return null
          let passage = t.passage
          if (passage === undefined && t.passageBlocked === true) passage = RM_PASSAGE_SOLID
          if (!Number.isFinite(passage)) return null
          return { rmTileId: t.rmTileId | 0, passage: passage | 0 }
        })
        .filter(Boolean)
    : []
}

function terrainTagsFromManifest(tileManifest) {
  return Array.isArray(tileManifest)
    ? tileManifest
        .map((t) => {
          if (!t || !Number.isFinite(t.rmTileId)) return null
          if (!Number.isFinite(t.terrainTag) || (t.terrainTag | 0) === 0) return null
          return { rmTileId: t.rmTileId | 0, terrainTag: t.terrainTag | 0 }
        })
        .filter(Boolean)
    : []
}

function prioritiesFromManifest(tileManifest) {
  return Array.isArray(tileManifest)
    ? tileManifest
        .map((t) => {
          if (!t || !Number.isFinite(t.rmTileId)) return null
          if (!Number.isFinite(t.priority) || (t.priority | 0) === 0) return null
          return { rmTileId: t.rmTileId | 0, priority: t.priority | 0 }
        })
        .filter(Boolean)
    : []
}

async function exportRmxpMaps({ appRoot, projectPath, dataDir, tilesetId, startMapId, tilesetOnly = false }) {
  if (!projectPath || !dataDir) {
    return { success: false, error: 'Missing projectPath or dataDir.' }
  }
  if (!tilesetOnly && !fs.existsSync(RMXP_BLANK_MAP_TEMPLATE)) {
    return {
      success: false,
      error: `Bundled blank map template missing:\n${RMXP_BLANK_MAP_TEMPLATE}`,
    }
  }
  const renderPath = path.join(projectPath, 'render.json')
  if (!fs.existsSync(renderPath)) {
    return {
      success: false,
      error:
        'render.json not found next to this project. In Map Generator, run “Export tileset (RMXP)”—it builds render.json and the packed tileset—or copy render.json here after a successful export.',
    }
  }

  const mapsOutDir = path.join(dataDir, 'Export', 'Data')
  fs.mkdirSync(mapsOutDir, { recursive: true })
  const tilesetDestDir = ensureExportGraphicsTilesetsDir(dataDir)

  const bundle = JSON.parse(fs.readFileSync(renderPath, 'utf8'))

  const tid = Number(tilesetId)
  const sid = startMapId != null ? Number(startMapId) : 2
  if (!Number.isFinite(tid) || tid < 1 || !Number.isInteger(tid)) {
    return { success: false, error: 'tilesetId must be an integer ≥ 1 (RPG Maker database index).' }
  }
  if (!tilesetOnly && (!Number.isFinite(sid) || sid < 2)) {
    return { success: false, error: 'startMapId must be an integer ≥ 2 (Map001 reserved for setup).' }
  }

  // Centralized RXConverter entrypoint.
  const rxIndexUrl = pathToFileURL(path.join(appRoot, 'tools', 'RXConverter', 'index.mjs')).href
  const {
    exportRenderBundleToRmxpDataDir,
    buildMapInfosFromExportedMapsAndDump,
    buildExportReadme,
    buildBlankTilesetsTemplateAndFillSlotAndDump,
    buildTilesetsFromScratchAndDump,
    mergeTilesetSlotAndDump,
    RM_PASSAGE_SOLID,
    RM_PASSAGE_STAR,
    RM_PASSAGE_BUSH,
    RM_PRIORITY_BELOW,
    RM_PRIORITY_NORMAL,
  } = await import(rxIndexUrl)

  /** Full export: MapNNN.rxdata from render bundle. Skipped when rebuilding/testing tileset only. */
  let out = { ok: true, written: [] }
  if (!tilesetOnly) {
    out = exportRenderBundleToRmxpDataDir({
      bundle,
      dataDir: mapsOutDir,
      templateMapPath: RMXP_BLANK_MAP_TEMPLATE,
      tilesetId: tid | 0,
      startMapId: sid | 0,
    })
    if (!out.ok) return { success: false, error: out.error }
  }

  let tilesetOutPath = null
  const tilesetSrcCandidates = [
    path.join(projectPath, 'Export', 'Graphics', 'Tilesets', 'tileset.png'),
    path.join(projectPath, 'tileset.png'),
  ]
  let tilesetSrc = null
  for (const p of tilesetSrcCandidates) {
    if (fs.existsSync(p)) {
      tilesetSrc = p
      break
    }
  }
  if (tilesetSrc) {
    tilesetOutPath = path.join(tilesetDestDir, 'tileset.png')
    fs.copyFileSync(tilesetSrc, tilesetOutPath)
  }

  const projectTilesetsDir = path.join(projectPath, 'Export', 'Graphics', 'Tilesets')
  if (fs.existsSync(projectTilesetsDir)) {
    for (const name of fs.readdirSync(projectTilesetsDir)) {
      if (name.startsWith('tileset_bm_') && name.endsWith('.png')) {
        fs.copyFileSync(path.join(projectTilesetsDir, name), path.join(tilesetDestDir, name))
      }
    }
  }

  const title = bundle?.metadata?.title || bundle?.metadata?.name || 'Grasswhistle'
  const tilesetsTemplatePath = path.join(appRoot, 'tools', 'RXConverter', 'samples', 'Tilesets.rxdata')
  const multi =
    (bundle?.schemaVersion | 0) >= 3 &&
    Array.isArray(bundle?.biomeTilesets) &&
    bundle.biomeTilesets.length > 0

  const tilesetsOutPath = path.join(mapsOutDir, 'Tilesets.rxdata')
  /** @type {string} */
  let tilesetsNote =
    'generated from blank template into Export/Data/Tilesets.rxdata — merge into your game Data/ after backup.'

  if (multi) {
    const biomeList = bundle.biomeTilesets
    const panelsAll = Array.isArray(bundle?.panels) ? bundle.panels : []
    const slots = biomeList.map((bt, i) => {
      const dc = bt.distinctBiomeCount
      const imageBaseName = path.basename(
        String(
          bt.imageFile ||
            (Array.isArray(bt.biomeComposition) && bt.biomeComposition.length > 0
              ? `tileset_bm_${bt.biomeComposition.map((n) => Number(n) | 0).join('_')}.png`
              : Number.isFinite(dc) && (dc | 0) > 0
                ? `tileset_bm_k${dc | 0}.png`
                : 'tileset_bm_0.png'),
        ),
        '.png',
      )
      const slotLabel =
        Array.isArray(bt.biomeComposition) && bt.biomeComposition.length > 0
          ? `biomes ${bt.biomeComposition.join('+')}`
          : Number.isFinite(dc) && (dc | 0) > 0
            ? `${dc | 0} biome id(s)`
            : String(bt.signature ?? '')

      const byId = new Map()
      const setPassage = (id, passage) => {
        id = id | 0; if (id <= 0) return
        const prev = byId.get(id) || {}
        const p = passage | 0
        const next =
          prev.passage === RM_PASSAGE_SOLID ? RM_PASSAGE_SOLID
          : p === RM_PASSAGE_SOLID ? RM_PASSAGE_SOLID
          : prev.passage === RM_PASSAGE_BUSH ? RM_PASSAGE_BUSH
          : p === RM_PASSAGE_BUSH ? RM_PASSAGE_BUSH
          : p
        byId.set(id, { ...prev, passage: next })
      }
      const setTerrain = (id, terrainTag) => {
        id = id | 0; if (id <= 0) return
        const t = terrainTag | 0; if (!t) return
        const prev = byId.get(id) || {}; if (prev.terrainTag) return
        byId.set(id, { ...prev, terrainTag: t })
      }
      const setPriority = (id, pr) => {
        id = id | 0; if (id <= 0) return
        const prev = byId.get(id) || {}
        byId.set(id, { ...prev, priority: Math.max(prev.priority ?? RM_PRIORITY_BELOW, pr | 0) })
      }
      const scanLayer = (layer) => {
        if (!layer || !Number.isFinite(layer.rmTileId)) return
        const id = layer.rmTileId, lt = layer.type
        if (lt === 'OCEAN' || lt === 'LAKE' || lt === 'WATERROAD') {
          setPassage(id, RM_PASSAGE_SOLID); setTerrain(id, 7); setPriority(id, RM_PRIORITY_BELOW)
        } else if (lt === 'CLIFF') {
          setPassage(id, RM_PASSAGE_SOLID); setPriority(id, RM_PRIORITY_BELOW)
        } else if (lt === 'FOREST_TRUNK' || lt === 'FOREST_BODY') {
          setPassage(id, RM_PASSAGE_SOLID); setPriority(id, RM_PRIORITY_BELOW)
        } else if (lt === 'FOREST_TOP') {
          setPassage(id, RM_PASSAGE_STAR); setPriority(id, RM_PRIORITY_NORMAL)
        } else if (lt === 'GRASS') {
          setPassage(id, RM_PASSAGE_BUSH); setTerrain(id, 2); setPriority(id, RM_PRIORITY_BELOW)
        } else {
          setPassage(id, 0); setPriority(id, RM_PRIORITY_BELOW)
        }
      }
      const scanStamp = (stamp) => {
        if (!stamp || !Number.isFinite(stamp.rmTileId)) return
        if ((stamp.layer | 0) === 3) {
          setPassage(stamp.rmTileId, RM_PASSAGE_STAR); setPriority(stamp.rmTileId, RM_PRIORITY_NORMAL)
        } else {
          setPassage(stamp.rmTileId, RM_PASSAGE_SOLID); setPriority(stamp.rmTileId, RM_PRIORITY_BELOW)
        }
      }
      // Authoritative per-atlas defaults from `packMgTileset` (every packed cell has passage / priority / terrain).
      // Panel-only scanning can miss wang indices that never appear on a map cell but still exist in the
      // tileset — they would otherwise stay 0 (fully passable) after we clear the static region.
      const tileManifest = Array.isArray(bt.tiles) ? bt.tiles : []
      for (const t of tileManifest) {
        if (!t || !Number.isFinite(t.rmTileId)) continue
        const id = t.rmTileId | 0
        if (id <= 0) continue
        let passage = t.passage
        if (passage === undefined && t.passageBlocked === true) passage = RM_PASSAGE_SOLID
        if (Number.isFinite(passage)) setPassage(id, passage | 0)
        if (Number.isFinite(t.terrainTag) && (t.terrainTag | 0) !== 0) setTerrain(id, t.terrainTag | 0)
        if (Number.isFinite(t.priority) && (t.priority | 0) !== 0) setPriority(id, t.priority | 0)
      }
      for (const p of panelsAll) {
        if ((p.biomeTilesetIndex | 0) !== i) continue
        for (const c of (p.cells || [])) {
          scanLayer(c?.layer1); scanLayer(c?.layer2); scanLayer(c?.layer3)
          if (Array.isArray(c?.forestRmStamp)) c.forestRmStamp.forEach(scanStamp)
        }
      }

      const tilePassages = [...byId.entries()].map(([id, v]) => ({ rmTileId: id, passage: v.passage ?? 0 }))
      const tileTerrainTags = [...byId.entries()].filter(([, v]) => v.terrainTag).map(([id, v]) => ({ rmTileId: id, terrainTag: v.terrainTag }))
      const tilePriorities = [...byId.entries()].filter(([, v]) => (v.priority | 0) !== RM_PRIORITY_BELOW).map(([id, v]) => ({ rmTileId: id, priority: v.priority }))

      return { slotId: (tid | 0) + i, imageBaseName, displayName: `${title} [${slotLabel}]`, tilePassages, tileTerrainTags, tilePriorities }
    })
    const r = buildTilesetsFromScratchAndDump(tilesetsTemplatePath, slots)
    if (!r.ok) return { success: false, error: `Tilesets build failed: ${r.error}` }
    fs.writeFileSync(tilesetsOutPath, r.buffer)
    tilesetsNote = `Per biome-composition tilesets (one atlas per unique set of biome ids used on a panel): database slots ${tid}-${
      tid + biomeList.length - 1
    } (each map uses the atlas matching that panel's biome mix). Master atlas remains as tileset.png for reference. Merge into your game Data/ after backup.`
  } else {
    const tileManifest = bundle?.tileset?.tiles

    let tilePassages = passagesFromManifest(tileManifest, RM_PASSAGE_SOLID)

    let tileTerrainTags = terrainTagsFromManifest(tileManifest)

    let tilePriorities = prioritiesFromManifest(tileManifest)

    // Prefer deriving Essentials terrain tags from actual tile usage in the render bundle.
    const derivedTerrainById = new Map() // rmTileId -> terrainTag
    const panelsForTags = Array.isArray(bundle?.panels) ? bundle.panels : []
    for (const p of panelsForTags) {
      const cells = Array.isArray(p?.cells) ? p.cells : []
      for (const c of cells) {
        for (const layer of [c?.layer1, c?.layer2, c?.layer3]) {
          if (!layer || !Number.isFinite(layer.rmTileId)) continue
          const id = layer.rmTileId | 0
          const lt = layer.type
          if (lt === 'GRASS') {
            if (!derivedTerrainById.has(id)) derivedTerrainById.set(id, 2)
          } else if (lt === 'LAKE' || lt === 'OCEAN' || lt === 'WATERROAD') {
            derivedTerrainById.set(id, 7)
          }
        }
      }
    }
    if (derivedTerrainById.size > 0) {
      tileTerrainTags = [...derivedTerrainById.entries()]
        .map(([rmTileId, terrainTag]) => ({ rmTileId, terrainTag }))
        .filter((x) => (x.terrainTag | 0) !== 0)
    }

    // Fallback: derive passability + terrain tags + priorities by scanning rendered panel layers.
    if (tilePassages.length === 0 || tileTerrainTags.length === 0 || tilePriorities.length === 0) {
      const byId = new Map() // rmTileId -> { passage?, terrainTag?, priority? }
      const setPassage = (rmTileId, passage) => {
        const id = Number(rmTileId) | 0
        if (!Number.isFinite(id) || id <= 0) return
        const prev = byId.get(id) || {}
        const p = passage | 0
        const nextPassage =
          prev.passage === RM_PASSAGE_SOLID
            ? RM_PASSAGE_SOLID
            : p === RM_PASSAGE_SOLID
              ? RM_PASSAGE_SOLID
              : prev.passage === RM_PASSAGE_BUSH
                ? RM_PASSAGE_BUSH
                : p === RM_PASSAGE_BUSH
                  ? RM_PASSAGE_BUSH
                  : p
        byId.set(id, { ...prev, passage: nextPassage })
      }
      const setTerrain = (rmTileId, terrainTag) => {
        const id = Number(rmTileId) | 0
        if (!Number.isFinite(id) || id <= 0) return
        const prev = byId.get(id) || {}
        const t = terrainTag | 0
        if (!t) return
        if (prev.terrainTag) return
        byId.set(id, { ...prev, terrainTag: t })
      }
      const setPriority = (rmTileId, pr) => {
        const id = Number(rmTileId) | 0
        if (!Number.isFinite(id) || id <= 0) return
        const prev = byId.get(id) || {}
        const next = Math.max(prev.priority ?? RM_PRIORITY_BELOW, pr | 0)
        byId.set(id, { ...prev, priority: next })
      }
      const scanLayer = (layer) => {
        if (!layer) return
        const id = layer.rmTileId
        const lt = layer.type
        if (!Number.isFinite(id)) return
        if (lt === 'OCEAN' || lt === 'LAKE' || lt === 'WATERROAD') {
          setPassage(id, RM_PASSAGE_SOLID)
          setTerrain(id, 7)
          setPriority(id, RM_PRIORITY_BELOW)
        } else if (lt === 'CLIFF') {
          setPassage(id, RM_PASSAGE_SOLID)
          setPriority(id, RM_PRIORITY_BELOW)
        } else if (lt === 'GRASS') {
          setPassage(id, RM_PASSAGE_BUSH)
          setTerrain(id, 2)
          setPriority(id, RM_PRIORITY_BELOW)
        } else if (lt === 'FOREST_TRUNK' || lt === 'FOREST_BODY') {
          setPassage(id, RM_PASSAGE_SOLID)
          setPriority(id, RM_PRIORITY_BELOW)
        } else if (lt === 'FOREST_TOP') {
          setPassage(id, RM_PASSAGE_STAR)
          setPriority(id, RM_PRIORITY_NORMAL)
        } else {
          setPassage(id, 0)
          setPriority(id, RM_PRIORITY_BELOW)
        }
      }
      const scanStamp = (stamp) => {
        if (!stamp || !Number.isFinite(stamp.rmTileId)) return
        const layer = stamp.layer | 0
        if (layer === 3) {
          setPassage(stamp.rmTileId, RM_PASSAGE_STAR)
          setPriority(stamp.rmTileId, RM_PRIORITY_NORMAL)
        } else {
          setPassage(stamp.rmTileId, RM_PASSAGE_SOLID)
          setPriority(stamp.rmTileId, RM_PRIORITY_BELOW)
        }
      }
      const panels = Array.isArray(bundle?.panels) ? bundle.panels : []
      for (const p of panels) {
        const cells = Array.isArray(p?.cells) ? p.cells : []
        for (const c of cells) {
          scanLayer(c?.layer1)
          scanLayer(c?.layer2)
          scanLayer(c?.layer3)
          const st = c?.forestRmStamp
          if (Array.isArray(st)) st.forEach(scanStamp)
        }
      }
      if (tilePassages.length === 0) {
        tilePassages = [...byId.entries()].map(([rmTileId, v]) => ({ rmTileId, passage: v.passage ?? 0 }))
      }
      if (tileTerrainTags.length === 0) {
        tileTerrainTags = [...byId.entries()]
          .map(([rmTileId, v]) => (v.terrainTag ? { rmTileId, terrainTag: v.terrainTag } : null))
          .filter(Boolean)
      }
      if (tilePriorities.length === 0) {
        tilePriorities = [...byId.entries()]
          .map(([rmTileId, v]) => ({ rmTileId, priority: v.priority ?? RM_PRIORITY_BELOW }))
          .filter((x) => (x.priority | 0) !== RM_PRIORITY_BELOW)
      }
    }

    const builtTs = buildBlankTilesetsTemplateAndFillSlotAndDump(
      tilesetsTemplatePath,
      tid | 0,
      'tileset',
      `${title} (Grasswhistle)`,
      { tilePassages, tileTerrainTags, tilePriorities },
    )
    if (!builtTs.ok) return { success: false, error: `Tilesets template build failed: ${builtTs.error}` }

    fs.writeFileSync(tilesetsOutPath, builtTs.buffer)
  }

  let mapInfosOutPath = null
  let mapInfosNote = null
  if (!tilesetOnly) {
    const builtMi = buildMapInfosFromExportedMapsAndDump(out.written, {
      title,
      mapInfosTemplatePath: RMXP_MAPINFOS_TEMPLATE,
    })
    if (!builtMi.ok) return { success: false, error: `MapInfos build failed: ${builtMi.error}` }

    mapInfosOutPath = path.join(mapsOutDir, 'MapInfos.rxdata')
    fs.writeFileSync(mapInfosOutPath, builtMi.buffer)
    mapInfosNote =
      'Merged from bundled MapInfos.pokemon_essentials_v21_blank.rxdata (reserved editor rows) plus your exported panel map ids — merge or replace your game Data/MapInfos.rxdata after backup.'
  }

  const exportRoot = path.join(dataDir, 'Export')
  fs.mkdirSync(exportRoot, { recursive: true })
  const readmePath = path.join(exportRoot, 'README_EXPORT.txt')
  if (tilesetOnly) {
    fs.writeFileSync(
      readmePath,
      [
        'Grasswhistle — RPG Maker XP tileset-only export',
        '===============================================',
        '',
        'This run wrote only the packed tileset graphic and Tilesets.rxdata slot (no Map*.rxdata).',
        'Merge into your game project:',
        '  - Export/Data/Tilesets.rxdata  → Data/',
        '  - Export/Graphics/Tilesets/tileset.png → Graphics/Tilesets/',
        '',
        `Tileset database id: ${tid}`,
        '',
        tilesetsNote,
        '',
        'Back up your game Data/ and Graphics/ before overwriting.',
      ].join('\r\n'),
      'utf8',
    )
  } else {
    fs.writeFileSync(
      readmePath,
      buildExportReadme({ written: out.written, tilesetId: tid, mapInfosNote, tilesetsNote }),
      'utf8',
    )
  }

  let mapMetadataPath = null
  let mapConnectionsPath = null
  let mapConnectionsExtraPath = null
  if (!tilesetOnly) {
    const pbsDir = ensureExportPbsDir(dataDir)
    const { mapMetadataTxt, mapConnectionsTxt, mapConnectionsExtraTxt } = buildPokemonEssentialsPbs({
      written: out.written,
      title,
      panelSize: bundle?.panelSize,
    })
    mapMetadataPath = path.join(pbsDir, 'map_metadata.txt')
    mapConnectionsPath = path.join(pbsDir, 'map_connections.txt')
    mapConnectionsExtraPath = path.join(pbsDir, 'map_connections_extra.txt')
    fs.writeFileSync(mapMetadataPath, mapMetadataTxt, 'utf8')
    fs.writeFileSync(mapConnectionsPath, mapConnectionsTxt, 'utf8')
    fs.writeFileSync(mapConnectionsExtraPath, mapConnectionsExtraTxt, 'utf8')
  }

  const referenceMdPath = path.join(exportRoot, 'EXPORT_REFERENCE.md')
  fs.writeFileSync(
    referenceMdPath,
    buildRmxpExportReferenceMarkdown({
      now: new Date(),
      title,
      bundle,
      tilesetId: tid,
      startMapId: sid,
      dataDir,
      written: out.written || [],
      tilesetOnly: !!tilesetOnly,
      multiBiomeTilesets: multi,
      tilesetOutPath,
      tilesetsOutPath,
      mapInfosOutPath,
      readmePath,
      mapMetadataPath,
      mapConnectionsPath,
      mapConnectionsExtraPath,
      tilesetsNote,
      mapInfosNote,
    }),
    'utf8',
  )

  return {
    success: true,
    tilesetOnly: !!tilesetOnly,
    written: out.written,
    outputDir: mapsOutDir,
    tilesetPath: tilesetOutPath,
    tilesetsPath: tilesetsOutPath,
    mapInfosPath: mapInfosOutPath,
    readmePath,
    referenceMdPath,
    mapMetadataPath,
    mapConnectionsPath,
    mapConnectionsExtraPath,
  }
}

module.exports = { exportRmxpMaps }

