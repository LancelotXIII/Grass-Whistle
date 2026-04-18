/**
 * App.jsx — React UI orchestration and canvas rendering for Grasswhistle.
 *
 * This file contains three top-level tools: LayoutGenerator (procedural map generation),
 * Slicer (stub), and MapGenerator (asset mapping and panel inspection). The root <App>
 * component routes between them.
 *
 * Rendering pipeline (LayoutGenerator):
 *   1. `bakeRegion(region, ...)` — Called once per generation. Composites four offscreen
 *      canvases: terrain pixels, panel grid overlay, biome tint, and road debug paths.
 *      Expensive; result is cached in `bakedRef`.
 *   2. `renderRegion(canvas, region, view, baked, ...)` — Called every animation frame.
 *      Draws the cached baked canvases onto the main canvas with zoom/pan transform applied.
 *      Cheap; no pixel recomputation.
 *
 * Imported from layoutGen.js:
 *   generateRegion, generateTestPanel, placeManualSettlement, regenerateFromTerrain,
 *   dir12, PANEL, PALETTE, T
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import grasswhistleWordmarkUrl from './assets/grasswhistle-logo.png?url'
import { bakeRegion, renderRegion, mgCanvasColors } from './render/regionRender.js'
import {
  generateRegion,
  generateTestPanel,
  placeManualSettlement,
  regenerateFromTerrain,
  applyWaterBiomePass,
} from './layoutGen.js'
import {
  PANEL,
  PALETTE,
  BIOME_PALETTES,
  T,
  DEFAULT_MAP_WIDTH,
  DEFAULT_MAP_HEIGHT,
} from './engine/constants.js'
import {
  MG_PREVIEW_CELL_PX,
  MG_FULL_EXPORT_CELL_PX,
  MG_EXPORT_CHUNK_PX,
  buildMgMosaicCanvas,
  mgExportFullMosaicChunked,
  mgBuildRenderProjectBundle,
  recomputeMapGeneratorTileIndices,
} from './mg/mgCore.js'

const BIOME_KEYS = [
  { id: 0, key: 'lush', label: 'Lush' },
  { id: 1, key: 'highland', label: 'Highland' },
  { id: 2, key: 'enchanted', label: 'Enchanted' },
  { id: 3, key: 'autumn', label: 'Autumn' },
  { id: 4, key: 'tropical', label: 'Tropical' },
  { id: 5, key: 'volcanic', label: 'Volcanic' },
]

const MG_BIOME_PREFIXES = {
  GROUND: '__groundBiome__',
  TREE: '__treeBiome__',
  ROAD: '__roadBiome__',
  GRASS: '__grassBiome__',
  WATER: '__waterBiome__',
  CLIFF: '__cliffBiome__',
}

function mgBasenamesForPrefix(assetKeys, prefix) {
  return assetKeys.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length))
}

function mgBuildByBiomeFromBasenames(basenames, prefix) {
  const byBiome = { 0: '', 1: '', 2: '', 3: '', 4: '', 5: '' }
  for (const b of BIOME_KEYS) {
    const m = basenames
      .filter((n) => n.toLowerCase().includes(b.key))
      .sort((a, c) => a.length - c.length || a.localeCompare(c))[0]
    if (m) byBiome[b.id] = `${prefix}${m}`
  }
  return byBiome
}

/**
 * Recomputes biome tables from bundled asset keys and clears per-project biome dirs.
 * Slot `assetId`s are kept when still present in `mergedAssets`; otherwise the Lush biome row is used where applicable.
 */
function mergeBundledBiomeMapping(base, mergedAssets) {
  const keys = Object.keys(mergedAssets || {})
  const GROUND_BY_BIOME = mgBuildByBiomeFromBasenames(
    mgBasenamesForPrefix(keys, MG_BIOME_PREFIXES.GROUND),
    MG_BIOME_PREFIXES.GROUND,
  )
  const TREE_BY_BIOME = mgBuildByBiomeFromBasenames(
    mgBasenamesForPrefix(keys, MG_BIOME_PREFIXES.TREE),
    MG_BIOME_PREFIXES.TREE,
  )
  const ROAD_BY_BIOME = mgBuildByBiomeFromBasenames(
    mgBasenamesForPrefix(keys, MG_BIOME_PREFIXES.ROAD),
    MG_BIOME_PREFIXES.ROAD,
  )
  const GRASS_BY_BIOME = mgBuildByBiomeFromBasenames(
    mgBasenamesForPrefix(keys, MG_BIOME_PREFIXES.GRASS),
    MG_BIOME_PREFIXES.GRASS,
  )
  const WATER_BY_BIOME = mgBuildByBiomeFromBasenames(
    mgBasenamesForPrefix(keys, MG_BIOME_PREFIXES.WATER),
    MG_BIOME_PREFIXES.WATER,
  )
  const CLIFF_BY_BIOME = mgBuildByBiomeFromBasenames(
    mgBasenamesForPrefix(keys, MG_BIOME_PREFIXES.CLIFF),
    MG_BIOME_PREFIXES.CLIFF,
  )

  const slot = (name, def, fallbackId) => {
    const s = base[name] || {}
    const id = typeof s.assetId === 'string' ? s.assetId.trim() : ''
    const keep = id && mergedAssets[id]
    return {
      assetId: keep ? id : (fallbackId || ''),
      isTileset: typeof s.isTileset === 'boolean' ? s.isTileset : def.isTileset,
    }
  }

  return {
    ROAD: slot('ROAD', { isTileset: true }, ROAD_BY_BIOME[0]),
    FOREST: slot('FOREST', { isTileset: false }, TREE_BY_BIOME[0]),
    FOREST_BODY: slot('FOREST_BODY', { isTileset: false }, TREE_BY_BIOME[0]),
    FOREST_TOP: slot('FOREST_TOP', { isTileset: false }, TREE_BY_BIOME[0]),
    GRASS: slot('GRASS', { isTileset: false }, GRASS_BY_BIOME[0]),
    WATER: slot('WATER', { isTileset: true }, WATER_BY_BIOME[0]),
    CLIFF: slot('CLIFF', { isTileset: true }, CLIFF_BY_BIOME[0]),
    GROUND_BIOME_DIR: '',
    GROUND_BY_BIOME,
    TREE_BIOME_DIR: '',
    TREE_BY_BIOME,
    ROAD_BIOME_DIR: '',
    ROAD_BY_BIOME,
    GRASS_BIOME_DIR: '',
    GRASS_BY_BIOME,
    WATER_BIOME_DIR: '',
    WATER_BY_BIOME,
    CLIFF_BIOME_DIR: '',
    CLIFF_BY_BIOME,
  }
}

function rgbCss([r, g, b]) {
  return `rgb(${r},${g},${b})`
}

function biomeForestSwatchCss(biomeId) {
  const pal = BIOME_PALETTES?.[biomeId] ?? PALETTE
  const c = pal?.[T.FOREST] ?? PALETTE?.[T.FOREST]
  return rgbCss(c)
}

/** Label color from each biome's palette (`LAND_LEVELS[4]` — mid slope, readable on dark UI). */
function biomeLabelCss(biomeId) {
  const pal = BIOME_PALETTES?.[biomeId] ?? PALETTE
  const c = pal?.LAND_LEVELS?.[4] ?? pal?.[T.GRASS] ?? PALETTE[T.GRASS]
  return rgbCss(c)
}
import {
  mgMappingSlotForLayerType,
  mgLayerFallbackRgb,
  MG_WANG_COLS,
  isForestOverlayLayerType,
  collectForestTreeAnchors,
} from './mgLayers.js'

// (bakeRegion/renderRegion/mgCanvasColors moved to `render/regionRender.js`)


/**
 * Landing page component.
 * @param {Object} props
 * @param {function} props.onSelect - Callback with 'layout'|'slicer'|'map'.
 */
function StartPage({ onSelect, theme, onToggleTheme }) {
  return (
    <div className="app start">
      <div className="start__inner">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div className="start__badge">Grasswhistle · Electron</div>
          <button type="button" className="btn btn--ghost" onClick={onToggleTheme} aria-label="Toggle theme">
            Theme: {theme === 'dark' ? 'Dark' : 'Light'}
          </button>
        </div>
        <div className="start__logo-wrap">
          <div className="start__logo-card">
            <img
              className="start__logo"
              src={grasswhistleWordmarkUrl}
              alt="Grasswhistle"
              decoding="async"
            />
            <h1 className="start__title">GRASSWHISTLE</h1>
          </div>
        </div>
        <p className="start__subtitle">
          Generate regions, slice panels, and wire assets into playable maps — from one workspace.
        </p>
        <div className="start__grid">
          <button type="button" className="start-card" onClick={() => onSelect('layout')}>
            <div className="start-card__icon" aria-hidden>◧</div>
            <h2 className="start-card__title">Layout Generator</h2>
            <p className="start-card__desc">Seeded generation, settlements, and a zoomable procedural preview with export.</p>
          </button>
          <button type="button" className="start-card" onClick={() => onSelect('slicer')}>
            <div className="start-card__icon" aria-hidden>▦</div>
            <h2 className="start-card__title">Slicer</h2>
            <p className="start-card__desc">Split and prepare map imagery for your pipeline (coming soon).</p>
          </button>
          <button type="button" className="start-card" onClick={() => onSelect('map')}>
            <div className="start-card__icon" aria-hidden>⌗</div>
            <h2 className="start-card__title">Map Generator</h2>
            <p className="start-card__desc">Load exported projects, map tiles to assets, and inspect panels.</p>
          </button>
        </div>
      </div>
    </div>
  )
}

function useGeneratingPulse(active) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!active) { setTick(0); return }
    const id = setInterval(() => setTick(t => (t + 1) % 4), 250)
    return () => clearInterval(id)
  }, [active])
  return tick
}

/**
 * Main tool component for procedural region generation.
 * Handles UI state for seeds, settlement counts, and canvas interactions.
 * @param {Object} props
 * @param {function} props.onBack - Callback to return to StartPage.
 */
function LayoutGenerator({ onBack }) {
  const [projectName, setProjectName] = useState('MyNewWorld')
  const [seed, setSeed] = useState('12345')
  const [worldPanelsW, setWorldPanelsW] = useState(DEFAULT_MAP_WIDTH)
  const [worldPanelsH, setWorldPanelsH] = useState(DEFAULT_MAP_HEIGHT)
  const [settlements, setSettlements] = useState(9)
  const [secretHalo, setSecretHalo] = useState(() => {
    try {
      const v = localStorage.getItem('layoutGenerator.secretHalo')
      if (v === '0') return false
      if (v === '1') return true
    } catch (_) { /* ignore */ }
    return true
  })
  const [region, setRegion] = useState(null)
  const [manualSettlements, setManualSettlements] = useState([]) // [{ px, py, type }]
  const [generating, setGenerating] = useState(false)
  const genPulse = useGeneratingPulse(generating)
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 })
  const [showRoadDebug, setShowRoadDebug] = useState(false)
  const [showBiomes, setShowBiomes] = useState(false)
  const [showPanelGrid, setShowPanelGrid] = useState(true)
  const [ctxMenu, setCtxMenu] = useState(null) // { screenX, screenY, px, py }
  const [zoneBiomeMenu, setZoneBiomeMenu] = useState(null) // { screenX, screenY, zoneId }
  const showRoadDebugRef = useRef(false)
  const showBiomesRef = useRef(false)
  const dragRef = useRef(null) // { startX, startY, startPanX, startPanY }
  const hoverZoneRef = useRef(0) // 0 = none, >0 zone id
  const hoverClusterRef = useRef(null) // mapName string | null
  const [hoveredPanel, setHoveredPanel] = useState(null) // { mapName, screenX, screenY } | null
  const [zoneEditMode, setZoneEditMode] = useState(false)

  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const viewRef = useRef(view)
  const bakedRef = useRef(null)

  // (Biome panel counts UI temporarily disabled.)

  useEffect(() => {
    try {
      localStorage.setItem('layoutGenerator.secretHalo', secretHalo ? '1' : '0')
    } catch (_) { /* ignore */ }
  }, [secretHalo])

  // Rebake when region or panel grid visibility changes
  useEffect(() => {
    bakedRef.current = region ? bakeRegion(region, false, showPanelGrid, secretHalo) : null
    redraw()
  }, [region, showPanelGrid, secretHalo])

  const redraw = useCallback((resize = false) => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    if (resize) {
      const w = container.clientWidth, h = container.clientHeight
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
    }
    if (region)
      renderRegion(
        canvas,
        region,
        viewRef.current,
        bakedRef.current,
        showRoadDebugRef.current,
        showBiomesRef.current,
        false,
        hoverZoneRef.current,
        hoverClusterRef.current
      )
  }, [region])

  // View changes (pan/zoom): just redraw, never resize
  useEffect(() => {
    viewRef.current = view
    redraw()
  }, [view, redraw])

  useEffect(() => {
    showRoadDebugRef.current = showRoadDebug
    redraw()
  }, [showRoadDebug, redraw])

  useEffect(() => {
    showBiomesRef.current = showBiomes
    redraw()
  }, [showBiomes, redraw])

  // Container resize or data changes: resize then redraw
  useEffect(() => {
    redraw(true)
    const ro = new ResizeObserver(() => redraw(true))
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [redraw])

  /** Zooms the viewport toward/away from the cursor position on mouse-wheel events. */
  const handleWheel = useCallback((e) => {
    if (!region) return
    e.preventDefault()
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width)
    const my = (e.clientY - rect.top) * (canvas.height / rect.height)

    setView(v => {
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const newZoom = Math.max(0.5, Math.min(16, v.zoom * factor))
      // Scale pan so the point under the cursor stays fixed
      const zoomRatio = newZoom / v.zoom
      const { width: rw, height: rh } = region
      const totalW = rw * PANEL, totalH = rh * PANEL
      const baseScale = Math.min(canvas.width / totalW, canvas.height / totalH)
      const basOffX = Math.floor((canvas.width - Math.floor(totalW * baseScale)) / 2)
      const basOffY = Math.floor((canvas.height - Math.floor(totalH * baseScale)) / 2)
      const originX = basOffX + v.panX
      const originY = basOffY + v.panY
      const newPanX = mx - (mx - originX) * zoomRatio - basOffX
      const newPanY = my - (my - originY) * zoomRatio - basOffY
      return { zoom: newZoom, panX: newPanX, panY: newPanY }
    })
  }, [region])

  // Drag to pan — update viewRef directly and redraw without touching React state.
  /**
   * Begins a pan drag on middle-click or right-click.
   * Pan state is tracked via `dragRef` (a ref) to avoid triggering React re-renders
   * on every mousemove — `setView` is only called once on mouse-up to commit.
   */
  const handleMouseDown = useCallback((e) => {
    if (e.button === 1 || e.button === 2) {
      e.preventDefault()
      dragRef.current = { startX: e.clientX, startY: e.clientY, startPanX: viewRef.current.panX, startPanY: viewRef.current.panY }
    }
  }, [])
  /**
   * Converts a canvas-relative client pixel to world cell coordinates `{ wx, wy }`.
   * Returns null if no region is loaded or the point falls outside the map bounds.
   */
  const canvasToWorldCellCoords = useCallback((clientX, clientY) => {
    if (!region) return null
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const mx = (clientX - rect.left) * (canvas.width / rect.width)
    const my = (clientY - rect.top) * (canvas.height / rect.height)
    const { width: rw, height: rh } = region
    const totalW = rw * PANEL, totalH = rh * PANEL
    const baseScale = Math.min(canvas.width / totalW, canvas.height / totalH)
    const offX = Math.floor((canvas.width - Math.floor(totalW * baseScale)) / 2)
    const offY = Math.floor((canvas.height - Math.floor(totalH * baseScale)) / 2)
    const v = viewRef.current
    const scale = baseScale * v.zoom
    const wx = Math.floor((mx - offX - v.panX) / scale)
    const wy = Math.floor((my - offY - v.panY) / scale)
    if (wx < 0 || wy < 0 || wx >= totalW || wy >= totalH) return null
    return { wx, wy }
  }, [region])

  /**
   * Mousemove handling:
   * - If dragging: update pan (no React state update).
   * - Otherwise: update hovered biome pocket id and request a redraw if changed.
   */
  const handleMouseMove = useCallback((e) => {
    const canvas = canvasRef.current
    if (!canvas || !region) return

    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.startX
      const dy = e.clientY - dragRef.current.startY
      viewRef.current = { ...viewRef.current, panX: dragRef.current.startPanX + dx, panY: dragRef.current.startPanY + dy }
      renderRegion(
        canvas,
        region,
        viewRef.current,
        bakedRef.current,
        showRoadDebugRef.current,
        showBiomesRef.current,
        false,
        hoverZoneRef.current,
        hoverClusterRef.current
      )
      return
    }

    const coords = canvasToWorldCellCoords(e.clientX, e.clientY)
    const worldW = region.width * PANEL
    const hoverZoneId = (zoneEditMode && coords && region.pocketIdGrid)
      ? (region.pocketIdGrid[coords.wy * worldW + coords.wx] ?? 0)
      : 0

    if (hoverZoneId !== hoverZoneRef.current) {
      hoverZoneRef.current = hoverZoneId
      renderRegion(
        canvas,
        region,
        viewRef.current,
        bakedRef.current,
        showRoadDebugRef.current,
        showBiomesRef.current,
        false,
        hoverZoneRef.current,
        hoverClusterRef.current
      )
    }

    if (coords) {
      const px = Math.floor(coords.wx / PANEL)
      const py = Math.floor(coords.wy / PANEL)
      const pd = region.panelData?.[`${px},${py}`]
      const mapName = pd?.mapName ?? null
      setHoveredPanel(mapName ? { mapName, screenX: e.clientX, screenY: e.clientY } : null)
      if (mapName !== hoverClusterRef.current) {
        hoverClusterRef.current = mapName
        renderRegion(canvas, region, viewRef.current, bakedRef.current, showRoadDebugRef.current, showBiomesRef.current, false, hoverZoneRef.current, mapName)
      }
    } else {
      setHoveredPanel(null)
      if (hoverClusterRef.current !== null) {
        hoverClusterRef.current = null
        renderRegion(canvas, region, viewRef.current, bakedRef.current, showRoadDebugRef.current, showBiomesRef.current, false, hoverZoneRef.current, null)
      }
    }
  }, [region, canvasToWorldCellCoords, zoneEditMode])
  /** Commits the pan position to React state and clears the drag ref on mouse release. */
  const handleMouseUp = useCallback((e) => {
    if (dragRef.current) {
      setView(viewRef.current)  // commit to React state so zoom calculations stay in sync
      dragRef.current = null
      return
    }
    // Left click on a highlighted zone opens biome picker menu.
    if (e?.button === 0 && region && zoneEditMode && hoverZoneRef.current !== 0) {
      if (ctxMenu) setCtxMenu(null)
      setZoneBiomeMenu({ screenX: e.clientX, screenY: e.clientY, zoneId: hoverZoneRef.current })
    }
  }, [region, ctxMenu, zoneEditMode])
  /** Clears drag + hover highlight when the mouse leaves the canvas. */
  const handleMouseLeave = useCallback(() => {
    if (dragRef.current) {
      setView(viewRef.current)
      dragRef.current = null
    }
    setHoveredPanel(null)
    hoverClusterRef.current = null
    // When a zone menu is open, allow the pointer to move from the canvas to the menu
    // without clearing hover or dismissing the menu.
    if (zoneBiomeMenu) return
    if (hoverZoneRef.current !== 0) {
      hoverZoneRef.current = 0
      const canvas = canvasRef.current
      if (canvas && region) {
        renderRegion(
          canvas,
          region,
          viewRef.current,
          bakedRef.current,
          showRoadDebugRef.current,
          showBiomesRef.current,
          false,
          0,
          null
        )
      }
    }
  }, [region, zoneBiomeMenu])

  /**
   * Converts a canvas-relative client pixel to panel grid coordinates `{x, y}`.
   * Accounts for the current zoom and pan transform applied in `renderRegion`.
   * Returns null if no region is loaded or the point falls outside the map bounds.
   */
  const canvasToPanelCoords = useCallback((clientX, clientY) => {
    if (!region) return null
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const mx = (clientX - rect.left) * (canvas.width / rect.width)
    const my = (clientY - rect.top) * (canvas.height / rect.height)
    const { width: rw, height: rh } = region
    const totalW = rw * PANEL, totalH = rh * PANEL
    const baseScale = Math.min(canvas.width / totalW, canvas.height / totalH)
    const offX = Math.floor((canvas.width - Math.floor(totalW * baseScale)) / 2)
    const offY = Math.floor((canvas.height - Math.floor(totalH * baseScale)) / 2)
    const v = viewRef.current
    const scale = baseScale * v.zoom
    const wx = (mx - offX - v.panX) / scale
    const wy = (my - offY - v.panY) / scale
    const px = Math.floor(wx / PANEL)
    const py = Math.floor(wy / PANEL)
    if (px < 0 || py < 0 || px >= rw || py >= rh) return null
    return { px, py }
  }, [region])

  const applyBiomeToZone = useCallback((zoneId, biome) => {
    if (!region) return
    const worldW = region.width * PANEL
    const worldH = region.height * PANEL
    const members = region.pocketCellsById?.[zoneId]
    if (!members || members.length === 0) return

    for (let i = 0; i < members.length; i++) {
      const wi = members[i]
      if (wi < 0 || wi >= worldW * worldH) continue
      const wx = wi % worldW
      const wy = (wi / worldW) | 0
      const pk = `${(wx / PANEL) | 0},${(wy / PANEL) | 0}`
      const pd = region.panelData?.[pk]
      const cell = pd?.grid?.[(wy % PANEL) * PANEL + (wx % PANEL)]
      if (cell) cell.biome = biome
    }

    applyWaterBiomePass(region.panelData, worldW, worldH)
    setRegion(r => (r ? { ...r } : r))
  }, [region])

  /** Settlement placement context menu (temporarily disabled). */
  const handleContextMenu = useCallback((e) => {
    e.preventDefault()
    // Intentionally do nothing for now — we still prevent the browser context menu
    // so right-drag panning feels consistent.
  }, [])

  /**
   * Places a manual settlement of the given type at the context menu panel coords.
   * Calls `placeManualSettlement` then `regenerateFromTerrain` to rebuild roads/forests
   * with the new locked settlement list. Triggers a full re-bake.
   *
   * @param {'city'|'town'|'poi'} type Settlement type to place.
   */
  const handlePlaceSettlement = useCallback((type) => {
    if (!ctxMenu || !region) return
    const { px, py } = ctxMenu
    setCtxMenu(null)
    placeManualSettlement(region, px, py, type)
    // Record for locked regeneration
    setManualSettlements(prev => [...prev, { px, py, type }])
    // Mutation is in-place — trigger re-bake by replacing region reference
    setRegion(r => ({ ...r }))
  }, [ctxMenu, region])

  /**
   * Triggers map generation (or regeneration) based on current UI parameters.
   * If locked settlements exist, calls `regenerateFromTerrain` to preserve terrain.
   * Otherwise calls `generateRegion` for a full fresh generation.
   * Runs async, setting `generating` state while in progress.
   */
  const handleGenerate = () => {
    setGenerating(true)
    setTimeout(async () => {
      // Let React paint the "Generating…" overlay before synchronous generation starts.
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      try {
        let result
        if (region && manualSettlements.length > 0 && region.terrain) {
          // Regenerate steps 6–14 only, preserving terrain and locked settlements
          result = regenerateFromTerrain({
            terrain: region.terrain,
            settlements,
            lockedSettlements: manualSettlements,
            secretHalo,
          })
        } else {
          // Full generation — new terrain + steps 6–14
          setManualSettlements([])
          result = generateRegion({
            seed: seed ? parseInt(seed, 10) : Date.now(),
            settlements,
            width: worldPanelsW,
            height: worldPanelsH,
            secretHalo,
          })
          setView({ zoom: 1, panX: 0, panY: 0 })
        }
        setRegion(result)
        if (result && Number.isFinite(result.width) && Number.isFinite(result.height)) {
          setWorldPanelsW(result.width)
          setWorldPanelsH(result.height)
        }
      } catch (err) {
        console.error('Generation failed:', err)
      } finally {
        setGenerating(false)
      }
    }, 0)
  }

  /**
   * Exports the current map to the user's selected folder via Electron IPC.
   * Writes: project metadata JSON, world overview PNG, and per-panel JSON + PNG files.
   * The world PNG is captured from the main canvas at `EXPORT_SCALE` px/panel resolution.
   */
  const handleExport = async () => {
    if (!region || !bakedRef.current) return
    const basePath = await window.electronAPI.selectFolder()
    if (!basePath) return

    setGenerating(true)
    setTimeout(async () => {
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      try {
        const cleanBaked = bakeRegion(region, true)
        const { map, overlay, biomeMap } = cleanBaked
        const { width, height, panelData } = region
        const totalW = width * PANEL, totalH = height * PANEL

        // 1. Composite full world canvas
        const worldCanvas = document.createElement('canvas')
        worldCanvas.width = totalW; worldCanvas.height = totalH
        const ctx = worldCanvas.getContext('2d')
        ctx.drawImage(map, 0, 0)
        ctx.drawImage(biomeMap, 0, 0)
        ctx.drawImage(overlay, 0, 0)
        const worldPNG = worldCanvas.toDataURL('image/png')

        // 2. Prepare panels & imagery
        const panelsToExport = []
        const EXPORT_SCALE = 32
        const sliceCanvas = document.createElement('canvas')
        sliceCanvas.width = PANEL * EXPORT_SCALE
        sliceCanvas.height = PANEL * EXPORT_SCALE
        const sctx = sliceCanvas.getContext('2d')
        sctx.imageSmoothingEnabled = false // Ensure pixel-perfect upscaling

        for (const key of Object.keys(panelData)) {
          const pd = panelData[key]
          if (pd.isRoute || pd.settlement) {
            const [px, py] = key.split(',').map(Number)
            
            // Render panel tile-by-tile for high res export
            sctx.clearRect(0, 0, sliceCanvas.width, sliceCanvas.height)
            sctx.drawImage(
              worldCanvas, 
              px * PANEL, py * PANEL, PANEL, PANEL, // source
              0, 0, sliceCanvas.width, sliceCanvas.height // destination
            )
            const panelPNG = sliceCanvas.toDataURL('image/png')

            // Export biome per tile so downstream mapping/tools can use it (Map Generator).
            const exportPd = structuredClone(pd)
            if (Array.isArray(exportPd.grid)) {
              const pb = exportPd.biome ?? 0
              for (const c of exportPd.grid) {
                if (!c) continue
                c.biome = c.biome !== undefined ? c.biome : pb
              }
            }

            panelsToExport.push({
              x: px, y: py,
              data: exportPd,
              png: panelPNG
            })
          }
        }

        const payload = {
          metadata: {
            title: projectName,
            seed: region.terrain?.seed ?? region.seed ?? Date.now(),
            width, height, panelSize: PANEL,
            timestamp: new Date().toISOString()
          },
          worldPNG,
          panels: panelsToExport
        }

        const res = await window.electronAPI.exportProject(basePath, projectName, payload)
        if (res.success) {
          alert(`Successfully exported project to:\n${res.path}`)
        } else {
          alert(`Export failed: ${res.error}`)
        }
      } catch (err) {
        console.error(err)
        alert('An error occurred during export.')
      } finally {
        setGenerating(false)
      }
    }, 100)
  }

  const CTP = mgCanvasColors()

  return (
    <div className="app layout-root">
      <header className="mg-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <img className="sidebar__logo" src={grasswhistleWordmarkUrl} alt="" />
          <div className="mg-header__titles">
            <h1>Layout Generator</h1>
            <span>Project: {projectName || 'Untitled'}</span>
          </div>
        </div>
        <div className="mg-header__actions">
          <button type="button" className="btn btn--secondary" onClick={handleExport} disabled={!region || generating}>
            📤 Export project
          </button>
          <button type="button" className="btn btn--ghost" onClick={onBack}>
            ← Back to menu
          </button>
        </div>
      </header>

      <div className="layout-body">
        <aside className="sidebar" aria-label="Layout controls">
        <div className="sidebar__body">
          <div className="sidebar__section">
            <label className="field-label" htmlFor="lg-project">📁 Project name</label>
            <input
              id="lg-project"
              className="field-input"
              type="text"
              placeholder="MyNewWorld"
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
            />
          </div>
          <div className="sidebar__section">
            <span className="field-label">🌍 World size (panels)</span>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <label htmlFor="lg-world-w" className="sr-only">Width in panels</label>
              <input
                id="lg-world-w"
                className="field-input"
                style={{ flex: 1 }}
                type="number"
                min={1}
                max={128}
                title={`World width in panels (each panel is ${PANEL}×${PANEL} tiles)`}
                disabled={manualSettlements.length > 0}
                value={worldPanelsW}
                onChange={(e) => setWorldPanelsW(parseInt(e.target.value, 10) || 1)}
              />
              <span aria-hidden style={{ color: 'var(--text-secondary)' }}>×</span>
              <label htmlFor="lg-world-h" className="sr-only">Height in panels</label>
              <input
                id="lg-world-h"
                className="field-input"
                style={{ flex: 1 }}
                type="number"
                min={1}
                max={128}
                title="World height in panels"
                disabled={manualSettlements.length > 0}
                value={worldPanelsH}
                onChange={(e) => setWorldPanelsH(parseInt(e.target.value, 10) || 1)}
              />
            </div>
            <p className="sidebar__hint" style={{ marginTop: '6px' }}>
              Your world is {worldPanelsW} × {worldPanelsH} panels
              <br />
              • {worldPanelsW * PANEL} × {worldPanelsH * PANEL} tiles total
              <br />
              • {(worldPanelsW * PANEL * 32).toLocaleString()} × {(worldPanelsH * PANEL * 32).toLocaleString()} px total
              <br />
              (1 panel = {PANEL}×{PANEL} tiles &amp; 1 tile = 32×32 px)
            </p>
            {manualSettlements.length > 0 && (
              <p className="sidebar__hint" style={{ marginTop: '6px' }}>
                Clear manual settlements to change world size.
              </p>
            )}
          </div>
          <div className="sidebar__section">
            <label className="field-label" htmlFor="lg-seed">🎲 Seed</label>
            <input
              id="lg-seed"
              className="field-input"
              type="number"
              placeholder="Random"
              value={seed}
              onChange={e => setSeed(e.target.value)}
            />
          </div>
          <div className="sidebar__section">
            <label className="field-label" htmlFor="lg-settlements">🏘️ Settlements</label>
            <input
              id="lg-settlements"
              className="field-input"
              type="number"
              min="0"
              value={settlements}
              onChange={e => setSettlements(parseInt(e.target.value, 10) || 0)}
            />
            <p className="sidebar__hint" style={{ marginTop: '6px' }}>
              Settlements are key locations placed on land panels. We’ll try to fit as many as we can up to this number (terrain constraints may produce fewer).
            </p>
          </div>
          <div className="sidebar__section">
            <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={secretHalo}
                onChange={e => setSecretHalo(e.target.checked)}
              />
              <span>🗝️ Bonus Areas</span>
            </label>
            <p className="sidebar__hint" style={{ marginTop: '6px' }}>
              Bonus pockets outside the main ring — extra playable space that'd otherwise go to waste.
            </p>
          </div>
          <p className="sidebar__hint">🖱️ Middle-click or right-drag to pan. Wheel to zoom.</p>
          {manualSettlements.length > 0 && (
            <p className="sidebar__hint" style={{ color: 'var(--warning)' }}>
              {manualSettlements.length} manual settlement{manualSettlements.length > 1 ? 's' : ''} locked — regenerate will preserve {manualSettlements.length > 1 ? 'them' : 'it'}.
            </p>
          )}
          <div className="btn-stack">
            <button type="button" className="btn btn--primary btn--block" onClick={handleGenerate} disabled={generating}>
              {generating ? '⏳ Generating…' : region ? '🔄 Regenerate' : '✨ Generate'}
            </button>
            {manualSettlements.length > 0 && (
              <button
                type="button"
                className="btn btn--ghost btn--block"
                onClick={() => setManualSettlements([])}
              >
                🗑️ Clear manual settlements
              </button>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => setView({ zoom: 1, panX: 0, panY: 0 })}
              disabled={!region}
            >
              🔍 Reset zoom
            </button>
            <button
              type="button"
              className={`btn btn--block${zoneEditMode ? ' btn--primary' : ' btn--ghost'}`}
              onClick={() => {
                const next = !zoneEditMode
                setZoneEditMode(next)
                setShowPanelGrid(!next)
                if (!next) {
                  hoverZoneRef.current = 0
                  setZoneBiomeMenu(null)
                  const canvas = canvasRef.current
                  if (canvas && region) renderRegion(canvas, region, viewRef.current, bakedRef.current, showRoadDebugRef.current, showBiomesRef.current, false, 0, null)
                }
              }}
              disabled={!region}
            >
              {zoneEditMode ? '✏️ Zone Edit: On' : '✏️ Zone Edit: Off'}
            </button>
          </div>
        </div>
      </aside>

      <div
        ref={containerRef}
        className={`map-viewport${region ? ' map-viewport--interactive' : ''}`}
      >
        {region && zoneEditMode && (
          <div className="legend-stack legend-stack--biome" aria-hidden>
            <div className="legend">
              <div className="legend__heading">🎨 Zone biomes</div>
              {[
                { biome: 0, label: '🌿 Lush' },
                { biome: 1, label: '🏔️ Highland' },
                { biome: 2, label: '✨ Enchanted' },
                { biome: 3, label: '🍂 Autumn' },
                { biome: 4, label: '🌴 Tropical' },
                { biome: 5, label: '🌋 Volcanic' },
              ].map(({ biome, label }) => (
                <div key={label} className="legend__row">
                  <div className="legend__swatch" style={{ background: biomeForestSwatchCss(biome) }} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <div className="legend-hint">
              Click a highlighted zone to change its biome.
            </div>
          </div>
        )}
        {region && (
          <div className="legend legend--terrain" aria-hidden>
            <div className="legend__heading">🗺️ Terrain &amp; features</div>
            {[
              { color: `rgb(${PALETTE[T.OCEAN].join(',')})`, label: '🌊 Ocean' },
              { color: `rgb(${PALETTE[T.LAKE].join(',')})`, label: '🏞️ Lake' },
              { color: `rgb(${PALETTE.LAND_LEVELS[1].join(',')})`, label: '🟫 Land (low)' },
              { color: `rgb(${PALETTE.LAND_LEVELS[6].join(',')})`, label: '🏔️ Land (peak)' },
              { color: `rgb(${PALETTE[T.CLIFF].join(',')})`, label: '⛰️ Cliff' },
              { color: `rgb(${PALETTE[T.FOREST].join(',')})`, label: '🌲 Forest' },
              { color: `rgb(${PALETTE[T.GRASS].join(',')})`, label: '🌿 Grass' },
              { color: `rgb(${PALETTE[T.ROAD].join(',')})`, label: '🛤️ Road' },
              { color: `rgb(${PALETTE[T.WATERROAD].join(',')})`, label: '🌉 Water road' },
              { color: '#00FFD1', label: '🏠 Settlement', border: true },
              { color: '#FF6B6B', label: '🛣️ Route', border: true },
              { color: '#39FF14', label: '🗝️ Bonus Area', border: true },
              { color: '#7ABFFF', label: '🌫️ Halo', border: true },
            ].map(({ color, label, border }) => (
              <div key={label} className="legend__row">
                <div
                  className={`legend__swatch${border ? ' legend__swatch--ring' : ''}`}
                  style={{
                    background: border ? 'transparent' : color,
                    border: border ? `2px solid ${color}` : undefined,
                  }}
                />
                <span style={{ color: 'var(--text-primary)' }}>{label}</span>
              </div>
            ))}
          </div>
        )}
        {!region && !generating && (
          <div className="map-overlay-msg" aria-hidden>
            <p>Configure parameters and click Generate</p>
          </div>
        )}
        <canvas
          ref={canvasRef}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onContextMenu={handleContextMenu}
        />
        {hoveredPanel && (
          <div style={{
            position: 'fixed',
            left: hoveredPanel.screenX + 14,
            top: hoveredPanel.screenY - 10,
            background: 'rgba(0,0,0,0.75)',
            color: '#fff',
            padding: '3px 8px',
            borderRadius: 4,
            fontSize: 12,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 9999,
          }}>
            {hoveredPanel.mapName}
          </div>
        )}
        {generating && (
          <div className="map-overlay-msg map-overlay-msg--busy" aria-live="polite">
            <p className="map-overlay-msg__pill">
              <span className="map-overlay-spinner" aria-hidden />
              <span>{`Generating${'.'.repeat(genPulse)}`}</span>
            </p>
          </div>
        )}
        {ctxMenu && (
          <div
            style={{
              position: 'fixed',
              top: ctxMenu.screenY,
              left: ctxMenu.screenX,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '4px 0',
              zIndex: 1000,
              minWidth: '140px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            }}
            onMouseLeave={() => setCtxMenu(null)}
          >
            <div style={{ padding: '4px 8px', fontSize: '10px', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)', marginBottom: '4px' }}>
              Panel {ctxMenu.px},{ctxMenu.py}
            </div>
            {[['city', 'Settlement'], ['town', 'Settlement'], ['poi', 'Settlement']].map(([type, label]) => (
              <button
                key={type}
                type="button"
                onClick={() => handlePlaceSettlement(type)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '6px 12px', background: 'none', border: 'none',
                  color: 'var(--text-primary)', fontSize: '12px', cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                Place {label}
              </button>
            ))}
          </div>
        )}
        {zoneBiomeMenu && (
          <div
            style={{
              position: 'fixed',
              top: zoneBiomeMenu.screenY,
              left: zoneBiomeMenu.screenX,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '4px 0',
              zIndex: 1000,
              minWidth: '160px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            }}
            onMouseLeave={() => setZoneBiomeMenu(null)}
          >
            <div style={{ padding: '4px 8px', fontSize: '10px', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)', marginBottom: '4px' }}>
              Set zone biome
            </div>
            {[
              [0, 'Lush'],
              [1, 'Highland'],
              [2, 'Enchanted'],
              [3, 'Autumn'],
              [4, 'Tropical'],
              [5, 'Volcanic'],
            ].map(([biome, label]) => (
              <button
                key={biome}
                type="button"
                onClick={() => {
                  const zid = zoneBiomeMenu.zoneId
                  setZoneBiomeMenu(null)
                  applyBiomeToZone(zid, biome)
                }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '6px 12px', background: 'none', border: 'none',
                  color: 'var(--text-primary)', fontSize: '12px', cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  )
}

/**
 * Stub component for the Slicer tool.
 * @param {Object} props
 * @param {function} props.onBack - Callback to return to StartPage.
 */
function Slicer({ onBack }) {
  return (
    <div className="app">
      <div className="stub">
        <h1>Slicer</h1>
        <p>Slice maps and prep imagery for your pipeline — this tool is still a stub.</p>
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          Back to menu
        </button>
      </div>
    </div>
  )
}

// Map Generator core logic lives in `src/renderer/mg/mgCore.js`.

// (legacy Map Generator implementation removed; see `src/renderer/mg/mgCore.js`)

const MG_INITIAL_MAPPING = {
  // Bundled app `assets/<ground|trees|…>/` only; per-project `assets/` is not used.
  ROAD:        { assetId: '', isTileset: true },
  FOREST:      { assetId: '', isTileset: false },
  FOREST_BODY: { assetId: '', isTileset: false },
  FOREST_TOP:  { assetId: '', isTileset: false },
  GRASS:       { assetId: '', isTileset: false },
  WATER:       { assetId: '', isTileset: true },
  CLIFF:       { assetId: '', isTileset: true },
  GROUND_BIOME_DIR: '',
  GROUND_BY_BIOME: { 0: '', 1: '', 2: '', 3: '', 4: '', 5: '' },
  TREE_BIOME_DIR: '',
  TREE_BY_BIOME: { 0: '', 1: '', 2: '', 3: '', 4: '', 5: '' },
  ROAD_BIOME_DIR: '',
  ROAD_BY_BIOME: { 0: '', 1: '', 2: '', 3: '', 4: '', 5: '' },
  GRASS_BIOME_DIR: '',
  GRASS_BY_BIOME: { 0: '', 1: '', 2: '', 3: '', 4: '', 5: '' },
  WATER_BIOME_DIR: '',
  WATER_BY_BIOME: { 0: '', 1: '', 2: '', 3: '', 4: '', 5: '' },
  CLIFF_BIOME_DIR: '',
  CLIFF_BY_BIOME: { 0: '', 1: '', 2: '', 3: '', 4: '', 5: '' },
}

/**
 * Functional component for the Map Generator tool.
 * Handles loading project data and eventually configuring tiles.
 * @param {Object} props
 * @param {function} props.onBack - Callback to return to StartPage.
 */
function MapGenerator({ onBack }) {
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(false)
  const [selectedPanel, setSelectedPanel] = useState(null) // { x, y }
  const [panelDetail, setPanelDetail] = useState(null) // { data, png }
  const [showGrid, setShowGrid] = useState(true)
  const [mapping, setMapping] = useState(() => ({ ...MG_INITIAL_MAPPING }))
  /** Project `assets/` is unused; Map Generator only uses bundled app `assets/`. */
  const emptyProjectAssetsRef = useRef({}).current
  const [defaultAssets, setDefaultAssets] = useState({}) // bundled biome folders under app `assets/`
  const [testMap, setTestMap] = useState('')
  const [mosaicCellPx] = useState(MG_PREVIEW_CELL_PX)
  const [mosaicBusy, setMosaicBusy] = useState(false)
  const [mosaicProgress, setMosaicProgress] = useState(null) // { phase, cur, total }
  const [mosaicInfo, setMosaicInfo] = useState(null)
  const mosaicCanvasRef = useRef(null)
  const mosaicScrollRef = useRef(null)
  const worldScrollRef = useRef(null)
  const mosaicPanDragRef = useRef(null)
  const worldPanDragRef = useRef(null)
  /** Global mapping cards — biome details collapsed by default. */
  const [mappingCardOpen, setMappingCardOpen] = useState(() => ({
    ground: false,
    grass: false,
    road: false,
    water: false,
    cliff: false,
    trees: false,
  }))
  /** World view preview — collapsed by default (large visual). */
  const [worldViewOpen, setWorldViewOpen] = useState(false)
  /** RPG Maker XP export: defaults for `@tileset_id` and first map id. */
  const RMXP_TILESET_ID = 2
  const RMXP_START_MAP_ID = 3
  /** When true, RMXP export writes only `Tilesets.rxdata` + tileset PNGs (no `Map*.rxdata` / MapInfos / PBS). */
  const RMXP_TILESET_ONLY = false

  useEffect(() => {
    void (async () => {
      if (!window.electronAPI?.getBundledGrasswhistleAssets) return
      const res = await window.electronAPI.getBundledGrasswhistleAssets()
      if (!res?.success || !res.assets) return
      setDefaultAssets(res.assets)
      setMapping((cur) => mergeBundledBiomeMapping(cur, res.assets))
    })()
    window.electronAPI.getTestPanel().then((res) => {
      if (res.success) setTestMap(res.map)
    })
  }, [])

  useEffect(() => {
    setMosaicInfo(null)
    const c = mosaicCanvasRef.current
    if (c) {
      c.width = 0
      c.height = 0
    }
  }, [project?.path])

  useEffect(() => {
    return () => {
      // Clean up any in-progress middle-button scroll pans.
      if (mosaicPanDragRef.current?.cleanup) mosaicPanDragRef.current.cleanup()
      if (worldPanDragRef.current?.cleanup) worldPanDragRef.current.cleanup()
      mosaicPanDragRef.current = null
      worldPanDragRef.current = null
    }
  }, [])

  // preview cell px is fixed

  const attachMiddleScrollPan = useCallback((el, dragRef) => {
    const onMove = (e) => {
      const st = dragRef.current
      if (!st) return
      const dx = e.clientX - st.lastX
      const dy = e.clientY - st.lastY
      st.lastX = e.clientX
      st.lastY = e.clientY
      el.scrollLeft -= dx
      el.scrollTop -= dy
    }

    const end = () => {
      window.removeEventListener('mousemove', onMove, true)
      window.removeEventListener('mouseup', end, true)
      window.removeEventListener('blur', end, true)
      el.classList.remove('is-panning')
      dragRef.current = null
    }

    return { onMove, end }
  }, [])

  const handleMiddleScrollPanMouseDown = useCallback((e, el, dragRef) => {
    if (!el) return
    if (e.button !== 1) return
    e.preventDefault()
    if (dragRef.current?.cleanup) dragRef.current.cleanup()

    const { onMove, end } = attachMiddleScrollPan(el, dragRef)
    dragRef.current = {
      lastX: e.clientX,
      lastY: e.clientY,
      cleanup: end,
    }
    el.classList.add('is-panning')
    window.addEventListener('mousemove', onMove, true)
    window.addEventListener('mouseup', end, true)
    window.addEventListener('blur', end, true)
  }, [attachMiddleScrollPan])

  const toggleMappingCard = useCallback((key) => {
    setMappingCardOpen((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  /** Prompts the user to select a project folder and loads the project metadata + bundled Grasswhistle assets. */
  const handleLoad = async () => {
    const path = await window.electronAPI.selectFolder()
    if (!path) return

    setLoading(true)
    try {
      const res = await window.electronAPI.loadProject(path)
      if (res.success) {
        setProject(res.data)

        const bundled = await window.electronAPI.getBundledGrasswhistleAssets()
        const pack = bundled?.success ? bundled.assets : {}
        if (bundled?.success) setDefaultAssets(pack)

        const slot = (defaults, savedSlot) => {
          const s = savedSlot || {}
          return {
            assetId: (typeof s.assetId === 'string' && s.assetId.trim() !== '') ? s.assetId : defaults.assetId,
            isTileset: (typeof s.isTileset === 'boolean') ? s.isTileset : defaults.isTileset,
          }
        }

        let baseForMerge = { ...MG_INITIAL_MAPPING }
        if (res.data.mapping) {
          const saved = res.data.mapping
          baseForMerge = {
            ROAD:        slot({ assetId: '', isTileset: true },  saved.ROAD),
            FOREST:      slot({ assetId: '', isTileset: false }, saved.FOREST),
            FOREST_BODY: slot({ assetId: '', isTileset: false }, saved.FOREST_BODY),
            FOREST_TOP:  slot({ assetId: '', isTileset: false }, saved.FOREST_TOP),
            GRASS:       slot({ assetId: '', isTileset: false }, saved.GRASS),
            WATER:       slot({ assetId: '', isTileset: true },  saved.WATER),
            CLIFF:       slot({ assetId: '', isTileset: true },  saved.CLIFF),
            GROUND_BIOME_DIR: saved.GROUND_BIOME_DIR || '',
            GROUND_BY_BIOME: saved.GROUND_BY_BIOME || { 0: '', 1: '', 2: '', 3: '', 4: '', 5: '' },
            TREE_BIOME_DIR: saved.TREE_BIOME_DIR || '',
            TREE_BY_BIOME: saved.TREE_BY_BIOME || { 0: '', 1: '', 2: '', 3: '', 4: '', 5: '' },
            ROAD_BIOME_DIR: saved.ROAD_BIOME_DIR || '',
            ROAD_BY_BIOME: saved.ROAD_BY_BIOME || { 0: '', 1: '', 2: '', 3: '', 4: '', 5: '' },
            GRASS_BIOME_DIR: saved.GRASS_BIOME_DIR || '',
            GRASS_BY_BIOME: saved.GRASS_BY_BIOME || { 0: '', 1: '', 2: '', 3: '', 4: '', 5: '' },
            WATER_BIOME_DIR: saved.WATER_BIOME_DIR || '',
            WATER_BY_BIOME: saved.WATER_BY_BIOME || { 0: '', 1: '', 2: '', 3: '', 4: '', 5: '' },
            CLIFF_BIOME_DIR: saved.CLIFF_BIOME_DIR || '',
            CLIFF_BY_BIOME: saved.CLIFF_BY_BIOME || { 0: '', 1: '', 2: '', 3: '', 4: '', 5: '' },
          }
        }
        const nextMapping = mergeBundledBiomeMapping(baseForMerge, pack)
        setMapping(nextMapping)
        try {
          const saveRes = await window.electronAPI.saveMapping(path, nextMapping)
          if (!saveRes.success) console.warn('Could not save mapping:', saveRes.error)
        } catch (e) {
          console.error(e)
        }

        setSelectedPanel(null)
        setPanelDetail(null)
      } else {
        alert(`Load failed: ${res.error}`)
      }
    } catch (err) {
      console.error(err)
      alert('An error occurred during loading.')
    } finally {
      setLoading(false)
    }
  }

  /** Reloads bundled Grasswhistle `assets/<category>/` folders and recomputes biome tables. */
  const handleRefreshAssets = async () => {
    if (!project) return
    const res = await window.electronAPI.getBundledGrasswhistleAssets()
    if (!res?.success || !res.assets) return
    setDefaultAssets(res.assets)
    setMapping((cur) => mergeBundledBiomeMapping(cur, res.assets))
  }

  /**
   * Persists the current terrain-type → asset mapping to `mapping.json` in the project folder.
   * @param {Object} m Mapping object (`{ terrainType: assetKey, ... }`).
   */
  const handleSaveMapping = async (m) => {
    if (!project) return
    const mapToSave = m || mapping
    try {
      const res = await window.electronAPI.saveMapping(project.path, mapToSave)
      if (res.success && import.meta.env.DEV) {
        console.log('Mapping saved')
      }
    } catch (err) {
      console.error(err)
    }
  }

  /**
   * Generates and displays the test panel from the current ASCII map string.
   * Calls `generateTestPanel` (no PRNG involved) and updates `selectedPanelData`.
   * @param {string} [map=testMap] ASCII map string to parse.
   */
  const handleTestPanel = (map = testMap) => {
    const pd = generateTestPanel(map || undefined)
    recomputeMapGeneratorTileIndices(pd.grid, undefined)
    setSelectedPanel({ x: -1, y: -1 })
    setPanelDetail({ data: pd, png: null })
  }

  const handleBuildMosaic = useCallback(async () => {
    if (!project) return
    setMosaicBusy(true)
    setMosaicProgress({ phase: 'load', cur: 0, total: project.panels.length })
    setMosaicInfo(null)
    try {
      const { canvas, cellPx, gw, gh, panelCount } = await buildMgMosaicCanvas({
        project,
        mapping,
        assets: emptyProjectAssetsRef,
        defaultAssets,
        cellPx: MG_PREVIEW_CELL_PX,
        onProgress: (cur, total) => setMosaicProgress({ phase: 'load', cur, total }),
      })
      const el = mosaicCanvasRef.current
      if (el) {
        el.width = canvas.width
        el.height = canvas.height
        const c = el.getContext('2d')
        c.imageSmoothingEnabled = false
        c.drawImage(canvas, 0, 0)
      }
      setMosaicInfo({
        cellPx,
        gw,
        gh,
        panelCount,
        pixelW: canvas.width,
        pixelH: canvas.height,
      })
    } catch (err) {
      console.error(err)
      alert(err?.message || 'Stitched preview failed.')
    } finally {
      setMosaicBusy(false)
      setMosaicProgress(null)
    }
  }, [project, mapping, defaultAssets, mosaicCellPx])

  // Downloading the low-res preview mosaic is intentionally omitted (use Download PNG instead).

  /** Bakes stitched mosaic at `MG_FULL_EXPORT_CELL_PX` px/cell and downloads; does not replace preview canvas. */
  const handleDownloadFullMosaic = useCallback(async () => {
    if (!project) return
    setMosaicBusy(true)
    setMosaicProgress({ phase: 'load', cur: 0, total: project.panels.length })
    try {
      const { tileCount, zipped, downloadName } = await mgExportFullMosaicChunked({
        project,
        mapping,
        assets: emptyProjectAssetsRef,
        defaultAssets,
        onProgress: setMosaicProgress,
      })
      alert(
        zipped
          ? `Saved ${downloadName} with ${tileCount} PNG tiles inside (max ${MG_EXPORT_CHUNK_PX}px per side). Unzip and use _x_y in filenames to align in your tools or game.`
          : `Saved ${downloadName} at ${MG_FULL_EXPORT_CELL_PX}px per cell.`
      )
    } catch (err) {
      console.error(err)
      alert(err?.message || 'Full-resolution download failed.')
    } finally {
      setMosaicBusy(false)
      setMosaicProgress(null)
    }
  }, [project, mapping, defaultAssets])

  // Render bundle output is generated automatically before RMXP export (maps + Tilesets.rxdata + graphics).

  /** Full RMXP package under Export/ when `RMXP_TILESET_ONLY` is false; tileset-only when true. */
  const handleExportRmxpMaps = useCallback(async () => {
    if (!project) return
    if (!window.electronAPI?.exportRmxpMaps) {
      alert('RMXP export requires the Electron app.')
      return
    }
    setMosaicBusy(true)
    try {
      const dataDir = await window.electronAPI.selectFolder()
      if (!dataDir) return

      // Ensure render outputs exist and are up-to-date before export (avoids requiring a separate “Render” step).
      setMosaicProgress({ phase: 'load', cur: 0, total: project.panels.length })
      const { json, pngBase64, biomeTilesetPngs, biomeCountsMarkdown } = await mgBuildRenderProjectBundle({
        project,
        mapping,
        assets: emptyProjectAssetsRef,
        defaultAssets,
        onProgress: setMosaicProgress,
      })
      setMosaicProgress({ phase: 'write', cur: 1, total: 1 })
      const saved = await window.electronAPI.saveRenderProject(
        project.path,
        json,
        pngBase64,
        biomeTilesetPngs,
        biomeCountsMarkdown,
      )
      if (!saved.success) throw new Error(saved.error || 'Could not save render output.')

      const res = await window.electronAPI.exportRmxpMaps({
        projectPath: project.path,
        dataDir,
        tilesetId: RMXP_TILESET_ID,
        startMapId: RMXP_START_MAP_ID,
        tilesetOnly: RMXP_TILESET_ONLY,
      })
      if (!res.success) throw new Error(res.error || 'Export failed.')
      const outDir = res.outputDir || dataDir
      const lines = (res.written || [])
        .map((w) =>
          w.rmxpRole === 'group_parent'
            ? `${w.file} (group "${w.mapName ?? ''}")`
            : `${w.file} (panel ${w.x},${w.y})`,
        )
        .join('\n')
      const extra = [
        saved.paths?.biomeCounts ? `Biome counts (markdown):\n${saved.paths.biomeCounts}` : null,
        res.tilesetPath ? `Tileset PNG:\n${res.tilesetPath}` : null,
        res.tilesetsPath ? `Tilesets.rxdata:\n${res.tilesetsPath}` : null,
        res.mapInfosPath ? `MapInfos.rxdata:\n${res.mapInfosPath}` : null,
        res.readmePath ? `README:\n${res.readmePath}` : null,
        res.referenceMdPath ? `Export reference (markdown):\n${res.referenceMdPath}` : null,
      ]
        .filter(Boolean)
        .join('\n\n')
      if (res.tilesetOnly) {
        alert(
          `Tileset-only RMXP export (no map .rxdata files).\n\nOutput:\n${outDir}\n\n${extra ? `${extra}\n\n` : ''}Merge Export/Data/Tilesets.rxdata and Export/Graphics/Tilesets/tileset.png into your game. See Export/README_EXPORT.txt and Export/EXPORT_REFERENCE.md.`,
        )
      } else {
        alert(
          `Wrote ${res.written.length} map file(s) to:\n${outDir}\n\n(under Export/Data relative to the folder you picked.)\n\n${lines}\n\n${extra ? `${extra}\n\n` : ''}Merge Export/ into your game (Data + Graphics). MapInfos.rxdata merges the bundled Pokémon Essentials-style template with your panel map ids; Tilesets.rxdata targets your chosen slot. See Export/README_EXPORT.txt and Export/EXPORT_REFERENCE.md.`,
        )
      }
    } catch (err) {
      console.error(err)
      alert(err?.message || 'RMXP export failed.')
    } finally {
      setMosaicBusy(false)
      setMosaicProgress(null)
    }
  }, [project, mapping, defaultAssets])

  return (
    <div className="app mg-root">
      <header className="mg-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <img className="sidebar__logo" src={grasswhistleWordmarkUrl} alt="" />
          <div className="mg-header__titles">
            <h1>Map Generator</h1>
            {project && <span>Project: {project.metadata.title}</span>}
          </div>
        </div>
        <div className="mg-header__actions">
          <button type="button" className="btn btn--secondary" onClick={handleLoad} disabled={loading}>
            {project ? '🔄 Switch project' : '📂 Load project'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onBack}>
            ← Back to menu
          </button>
        </div>
      </header>

      {!project ? (
        <div className="mg-empty">
          <p>No project loaded. Open a Grasswhistle export folder to begin.</p>
          <button type="button" className="btn btn--primary" onClick={handleLoad} disabled={loading}>
            📂 Open project folder…
          </button>
        </div>
      ) : (
        <div className="mg-body">
          <aside className="mg-aside" aria-label="Project and mapping">
            <section>
              <h3 className="mg-section-title">📋 Project metadata</h3>
              <div className="mg-meta">
                <div>
                  Size: {project.metadata.width}×{project.metadata.height} panels
                </div>
                <div>
                  Tile scale: {project.metadata.panelSize}×{project.metadata.panelSize}
                </div>
                <div>Total panels: {project.panels.length}</div>
              </div>
            </section>

            <section>
              <h3 className="mg-section-title">🎨 Global mapping</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div className="mg-card mg-card--row">
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    Bundled assets: {Object.keys(defaultAssets).length}
                  </div>
                  <button type="button" className="btn btn--secondary" style={{ padding: '4px 10px', fontSize: '11px', minHeight: 0 }} onClick={handleRefreshAssets}>
                    Refresh
                  </button>
                </div>

                <div className="mg-card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      style={{ padding: '2px 6px', fontSize: '11px', minHeight: 0, lineHeight: 1 }}
                      aria-expanded={mappingCardOpen.ground}
                      onClick={() => toggleMappingCard('ground')}
                      title={mappingCardOpen.ground ? 'Hide biome details' : 'Show biome details'}
                    >
                      {mappingCardOpen.ground ? '▾' : '▸'}
                    </button>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '11px', fontWeight: 600 }}>Ground</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        Bundled Grasswhistle assets
                      </div>
                    </div>
                  </div>
                  {mappingCardOpen.ground && (
                    <>
                      {(() => {
                        const missing = BIOME_KEYS.filter(b => !mapping.GROUND_BY_BIOME?.[b.id]).map(b => b.label)
                        if (missing.length === 0) return null
                        return (
                          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--warning)' }}>
                            Missing: {missing.join(', ')} (fallback → Lush)
                          </div>
                        )
                      })()}
                      <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px' }}>
                        {BIOME_KEYS.map(b => (
                          <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '11px' }}>
                            <span style={{ color: biomeLabelCss(b.id) }}>{b.label}</span>
                            <span
                              style={{
                                color: mapping.GROUND_BY_BIOME?.[b.id] ? 'var(--text-primary)' : 'var(--text-tertiary)',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                              title={mapping.GROUND_BY_BIOME?.[b.id] || 'missing'}
                            >
                              {mapping.GROUND_BY_BIOME?.[b.id] ? 'OK' : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <div className="mg-card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      style={{ padding: '2px 6px', fontSize: '11px', minHeight: 0, lineHeight: 1 }}
                      aria-expanded={mappingCardOpen.grass}
                      onClick={() => toggleMappingCard('grass')}
                      title={mappingCardOpen.grass ? 'Hide biome details' : 'Show biome details'}
                    >
                      {mappingCardOpen.grass ? '▾' : '▸'}
                    </button>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '11px', fontWeight: 600 }}>Grass</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        Bundled Grasswhistle assets
                      </div>
                    </div>
                  </div>
                  {mappingCardOpen.grass && (
                    <>
                      {(() => {
                        const missing = BIOME_KEYS.filter(b => !mapping.GRASS_BY_BIOME?.[b.id]).map(b => b.label)
                        if (missing.length === 0) return null
                        return (
                          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--warning)' }}>
                            Missing: {missing.join(', ')} (fallback → Lush)
                          </div>
                        )
                      })()}
                      <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px' }}>
                        {BIOME_KEYS.map(b => (
                          <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '11px' }}>
                            <span style={{ color: biomeLabelCss(b.id) }}>{b.label}</span>
                            <span
                              style={{
                                color: mapping.GRASS_BY_BIOME?.[b.id] ? 'var(--text-primary)' : 'var(--text-tertiary)',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                              title={mapping.GRASS_BY_BIOME?.[b.id] || 'missing'}
                            >
                              {mapping.GRASS_BY_BIOME?.[b.id] ? 'OK' : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <div className="mg-card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      style={{ padding: '2px 6px', fontSize: '11px', minHeight: 0, lineHeight: 1 }}
                      aria-expanded={mappingCardOpen.road}
                      onClick={() => toggleMappingCard('road')}
                      title={mappingCardOpen.road ? 'Hide biome details' : 'Show biome details'}
                    >
                      {mappingCardOpen.road ? '▾' : '▸'}
                    </button>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '11px', fontWeight: 600 }}>Road</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        Bundled Grasswhistle assets
                      </div>
                    </div>
                  </div>
                  {mappingCardOpen.road && (
                    <>
                      {(() => {
                        const missing = BIOME_KEYS.filter(b => !mapping.ROAD_BY_BIOME?.[b.id]).map(b => b.label)
                        if (missing.length === 0) return null
                        return (
                          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--warning)' }}>
                            Missing: {missing.join(', ')} (fallback → Lush)
                          </div>
                        )
                      })()}
                      <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px' }}>
                        {BIOME_KEYS.map(b => (
                          <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '11px' }}>
                            <span style={{ color: biomeLabelCss(b.id) }}>{b.label}</span>
                            <span
                              style={{
                                color: mapping.ROAD_BY_BIOME?.[b.id] ? 'var(--text-primary)' : 'var(--text-tertiary)',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                              title={mapping.ROAD_BY_BIOME?.[b.id] || 'missing'}
                            >
                              {mapping.ROAD_BY_BIOME?.[b.id] ? 'OK' : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <div className="mg-card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      style={{ padding: '2px 6px', fontSize: '11px', minHeight: 0, lineHeight: 1 }}
                      aria-expanded={mappingCardOpen.water}
                      onClick={() => toggleMappingCard('water')}
                      title={mappingCardOpen.water ? 'Hide biome details' : 'Show biome details'}
                    >
                      {mappingCardOpen.water ? '▾' : '▸'}
                    </button>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '11px', fontWeight: 600 }}>Water</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        Bundled Grasswhistle assets
                      </div>
                    </div>
                  </div>
                  {mappingCardOpen.water && (
                    <>
                      {(() => {
                        const missing = BIOME_KEYS.filter(b => !mapping.WATER_BY_BIOME?.[b.id]).map(b => b.label)
                        if (missing.length === 0) return null
                        return (
                          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--warning)' }}>
                            Missing: {missing.join(', ')} (fallback → Lush)
                          </div>
                        )
                      })()}
                      <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px' }}>
                        {BIOME_KEYS.map(b => (
                          <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '11px' }}>
                            <span style={{ color: biomeLabelCss(b.id) }}>{b.label}</span>
                            <span
                              style={{
                                color: mapping.WATER_BY_BIOME?.[b.id] ? 'var(--text-primary)' : 'var(--text-tertiary)',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                              title={mapping.WATER_BY_BIOME?.[b.id] || 'missing'}
                            >
                              {mapping.WATER_BY_BIOME?.[b.id] ? 'OK' : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <div className="mg-card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      style={{ padding: '2px 6px', fontSize: '11px', minHeight: 0, lineHeight: 1 }}
                      aria-expanded={mappingCardOpen.cliff}
                      onClick={() => toggleMappingCard('cliff')}
                      title={mappingCardOpen.cliff ? 'Hide biome details' : 'Show biome details'}
                    >
                      {mappingCardOpen.cliff ? '▾' : '▸'}
                    </button>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '11px', fontWeight: 600 }}>Cliff</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        Bundled Grasswhistle assets
                      </div>
                    </div>
                  </div>
                  {mappingCardOpen.cliff && (
                    <>
                      {(() => {
                        const missing = BIOME_KEYS.filter(b => !mapping.CLIFF_BY_BIOME?.[b.id]).map(b => b.label)
                        if (missing.length === 0) return null
                        return (
                          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--warning)' }}>
                            Missing: {missing.join(', ')} (fallback → Lush)
                          </div>
                        )
                      })()}
                      <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px' }}>
                        {BIOME_KEYS.map(b => (
                          <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '11px' }}>
                            <span style={{ color: biomeLabelCss(b.id) }}>{b.label}</span>
                            <span
                              style={{
                                color: mapping.CLIFF_BY_BIOME?.[b.id] ? 'var(--text-primary)' : 'var(--text-tertiary)',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                              title={mapping.CLIFF_BY_BIOME?.[b.id] || 'missing'}
                            >
                              {mapping.CLIFF_BY_BIOME?.[b.id] ? 'OK' : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <div className="mg-card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      style={{ padding: '2px 6px', fontSize: '11px', minHeight: 0, lineHeight: 1 }}
                      aria-expanded={mappingCardOpen.trees}
                      onClick={() => toggleMappingCard('trees')}
                      title={mappingCardOpen.trees ? 'Hide biome details' : 'Show biome details'}
                    >
                      {mappingCardOpen.trees ? '▾' : '▸'}
                    </button>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '11px', fontWeight: 600 }}>Trees</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        Bundled Grasswhistle assets
                      </div>
                    </div>
                  </div>
                  {mappingCardOpen.trees && (
                    <>
                      {(() => {
                        const missing = BIOME_KEYS.filter(b => !mapping.TREE_BY_BIOME?.[b.id]).map(b => b.label)
                        if (missing.length === 0) return null
                        return (
                          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--warning)' }}>
                            Missing: {missing.join(', ')} (fallback → Lush)
                          </div>
                        )
                      })()}
                      <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px' }}>
                        {BIOME_KEYS.map(b => (
                          <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '11px' }}>
                            <span style={{ color: biomeLabelCss(b.id) }}>{b.label}</span>
                            <span
                              style={{
                                color: mapping.TREE_BY_BIOME?.[b.id] ? 'var(--text-primary)' : 'var(--text-tertiary)',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                              title={mapping.TREE_BY_BIOME?.[b.id] || 'missing'}
                            >
                              {mapping.TREE_BY_BIOME?.[b.id] ? 'OK' : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </section>

            <section>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                <h3 className="mg-section-title" style={{ margin: 0 }}>🗺️ World view</h3>
                <button
                  type="button"
                  className="btn btn--ghost"
                  style={{ padding: '4px 10px', fontSize: '11px', minHeight: 0 }}
                  aria-expanded={worldViewOpen}
                  onClick={() => setWorldViewOpen(o => !o)}
                >
                  {worldViewOpen ? 'Hide' : 'Show'}
                </button>
              </div>
              {worldViewOpen && (
                project.worldPNG ? (
                  <div
                    ref={worldScrollRef}
                    className="mg-world-frame"
                    style={{ marginTop: 'var(--space-3)' }}
                    onAuxClick={(e) => {
                      if (e.button === 1) e.preventDefault()
                    }}
                    onMouseDown={(e) => handleMiddleScrollPanMouseDown(e, worldScrollRef.current, worldPanDragRef)}
                  >
                    <img src={project.worldPNG} alt="Exported world" />
                  </div>
                ) : (
                  <div style={{ marginTop: 'var(--space-3)', fontSize: '11px', color: 'var(--text-secondary)' }}>No world image in project.</div>
                )
              )}
            </section>

            {loading && <div className="mg-loading">Loading…</div>}
          </aside>

          <main className="mg-main">
            <section className="mg-mosaic-section mg-mosaic-section--primary">
              <div className="mg-mosaic-toolbar">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={handleBuildMosaic}
                  disabled={mosaicBusy || loading}
                >
                  {mosaicBusy ? '⏳ Rendering…' : '🖼️ Render preview'}
                </button>
                <button type="button" className="btn btn--secondary" onClick={handleDownloadFullMosaic} disabled={mosaicBusy || loading}>
                  ⬇️ Download PNG
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void handleExportRmxpMaps()}
                  disabled={mosaicBusy || loading}
                  title="Writes Tilesets.rxdata + tileset.png only (no Map*.rxdata) while we rebuild the map export pipeline."
                >
                  📦 Package for export
                </button>
              </div>
              {mosaicProgress && (
                <div className="mg-mosaic-progress" aria-live="polite">
                  {mosaicProgress.phase === 'zip'
                    ? 'Building ZIP…'
                    : mosaicProgress.phase === 'tiles'
                      ? `Encoding tiles ${mosaicProgress.cur + 1}/${mosaicProgress.total}…`
                      : mosaicProgress.phase === 'pack'
                        ? 'Packing tileset atlas…'
                        : mosaicProgress.phase === 'serialize'
                          ? `Serializing panels ${mosaicProgress.cur + 1}/${mosaicProgress.total}…`
                          : mosaicProgress.phase === 'write'
                            ? 'Writing render.json & Export/Graphics/Tilesets/tileset.png…'
                            : `Loading panels ${mosaicProgress.cur}/${mosaicProgress.total}…`}
                </div>
              )}
              {mosaicInfo && (
                <div className="mg-mosaic-meta">
                  {mosaicInfo.pixelW}×{mosaicInfo.pixelH}px · world {mosaicInfo.gw}×{mosaicInfo.gh} panels · {mosaicInfo.cellPx}px/cell
                </div>
              )}
              <div
                ref={mosaicScrollRef}
                className="mg-mosaic-scroll"
                onAuxClick={(e) => {
                  if (e.button === 1) e.preventDefault()
                }}
                onMouseDown={(e) => handleMiddleScrollPanMouseDown(e, mosaicScrollRef.current, mosaicPanDragRef)}
              >
                <canvas ref={mosaicCanvasRef} className="mg-mosaic-canvas" />
              </div>
            </section>
          </main>

        </div>
      )}

      {selectedPanel && panelDetail && (
        <div className="panel-overlay" role="dialog" aria-modal="true" aria-labelledby="panel-overlay-title">
          <div className="panel-overlay__header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
              <h2 id="panel-overlay-title">{selectedPanel.x === -1 ? 'Tile Test Panel' : `Panel ${selectedPanel.x}, ${selectedPanel.y}`}</h2>
              <div className="panel-overlay__badge">
                Biome: <strong>{panelDetail.data.biomeName || 'Unknown'}</strong>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <button
                type="button"
                className={`btn btn--ghost${showGrid ? ' btn--active' : ''}`}
                onClick={() => setShowGrid(v => !v)}
              >
                {showGrid ? 'Hide grid' : 'Show grid'}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  setSelectedPanel(null)
                  setPanelDetail(null)
                }}
              >
                {selectedPanel.x === -1 ? 'Close test panel' : 'Back to world'}
              </button>
            </div>
          </div>

          <div className="panel-overlay__body">
            <div className="panel-overlay__col">
              <div className="panel-overlay__label">Procedural source (layout)</div>
              <div className="panel-overlay__stage">
                <div className="mapped-grid-wrap">
                  <div className={`mapped-grid${showGrid ? '' : ' mapped-grid--no-grid'}`}>
                    {(panelDetail.data.grid || []).map((cell, i) => {
                      let rgb
                      if (cell.type === T.LAND) rgb = PALETTE.LAND_LEVELS[cell.elevation] || PALETTE.LAND_LEVELS[1]
                      else if (cell.type === T.FOREST) rgb = PALETTE[T.FOREST]
                      else if (cell.type === T.GRASS) rgb = PALETTE[T.GRASS]
                      else if (cell.type === T.ROAD) rgb = PALETTE[T.ROAD]
                      else if (cell.type === T.OCEAN) rgb = PALETTE[T.OCEAN]
                      else if (cell.type === T.WATERROAD) rgb = PALETTE[T.WATERROAD]
                      else if (cell.type === T.LAKE) rgb = PALETTE[T.LAKE]
                      else if (cell.type === T.CLIFF) rgb = PALETTE[T.CLIFF]
                      else rgb = [80, 80, 80]
                      return (
                        <div
                          key={i}
                          className="mapped-cell"
                          style={{ background: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` }}
                        />
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="panel-overlay__col">
              <div className="panel-overlay__label">Visual output (mapped assets)</div>
              <div className="panel-overlay__stage">
                <div className="mapped-grid-wrap">
                  <div className={`mapped-grid${showGrid ? '' : ' mapped-grid--no-grid'}`}>
                    {(panelDetail.data.grid || []).map((cell, i) => {
                      const layers = cell.layer1
                        ? [cell.layer1, cell.layer2, cell.layer3].filter(Boolean).filter(
                            (lay) => !isForestOverlayLayerType(lay.type)
                          )
                        : (() => {
                            const t = cell.type
                            if (t === 'LAND' || t === 'GROUND') return [{ type: T.LAND, tileIndex: cell.tileIndex }]
                            if (t === 'ROAD') return [{ type: T.ROAD, tileIndex: cell.tileIndex }]
                            if (t === 'FOREST') return [{ type: T.LAND, tileIndex: cell.tileIndex }]
                            if (t === 'GRASS') return [{ type: T.GRASS, tileIndex: cell.tileIndex }]
                            if (t === 'OCEAN' || t === 'LAKE' || t === 'WATERROAD') return [{ type: t, tileIndex: cell.tileIndex }]
                            if (t === 'CLIFF') return [{ type: T.CLIFF, tileIndex: cell.tileIndex }]
                            return [{ type: t, tileIndex: cell.tileIndex }]
                          })()
                      const cols = MG_WANG_COLS
                      const rows = 1
                      const first = layers[0]
                      const firstSlot = first ? mgMappingSlotForLayerType(first.type, mapping) : null
                      const firstUrl = firstSlot?.assetId ? defaultAssets[firstSlot.assetId] : null
                      const fb = first ? mgLayerFallbackRgb(cell, first.type) : [80, 80, 80]
                      const fallbackBg = `rgb(${fb[0]},${fb[1]},${fb[2]})`

                      return (
                        <div
                          key={i}
                          className="mapped-cell"
                          style={{ position: 'relative', ...(!firstUrl ? { background: fallbackBg } : {}) }}
                        >
                          {layers.map((layer, li) => {
                            const slot = mgMappingSlotForLayerType(layer.type, mapping)
                            const assetId = slot?.assetId
                            const dataUrl = assetId ? defaultAssets[assetId] : null
                            const useTileset = slot?.isTileset && layer.tileIndex !== undefined
                            const [r, g, b] = mgLayerFallbackRgb(cell, layer.type)
                            const layerBg = `rgb(${r},${g},${b})`
                            return (
                              <div
                                key={li}
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  zIndex: li,
                                  ...(li > 0 && !dataUrl ? { background: layerBg } : {}),
                                }}
                              >
                                {dataUrl ? (
                                  useTileset ? (
                                    <div className="tile-crop">
                                      <img
                                        src={dataUrl}
                                        alt=""
                                        style={{
                                          position: 'absolute',
                                          width: `${cols * 100}%`,
                                          height: `${rows * 100}%`,
                                          left: `-${(layer.tileIndex % cols) * 100}%`,
                                          top: `-${Math.floor(layer.tileIndex / cols) * 100}%`,
                                          imageRendering: 'pixelated',
                                        }}
                                      />
                                    </div>
                                  ) : (
                                    <img src={dataUrl} alt="" style={{ imageRendering: 'pixelated', width: '100%', height: '100%', objectFit: 'fill' }} />
                                  )
                                ) : null}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                  {/* Forest layer2 (body) + layer3 (canopy): same sheet as canvas; clip splits one 3-cell-tall sprite vertically. */}
                  {(() => {
                    const bodyUrl =
                      defaultAssets[mapping.FOREST_BODY?.assetId] ||
                      defaultAssets[mapping.FOREST?.assetId]
                    const topsUrl =
                      defaultAssets[mapping.FOREST_TOP?.assetId] ||
                      defaultAssets[mapping.FOREST?.assetId]
                    if (!bodyUrl && !topsUrl) return null
                    const cellPct = 100 / PANEL
                    const spriteW = cellPct * 2
                    const spriteH = cellPct * 3
                    const grid = panelDetail.data.grid || []
                    const trees = collectForestTreeAnchors(grid, selectedPanel.x, selectedPanel.y)

                    return (
                      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}>
                        {trees.map(({ cx, cy, wide, variant }, i) => (
                          <React.Fragment key={i}>
                            {bodyUrl ? (
                              <div
                                style={{
                                  position: 'absolute',
                                  left: `${cx * cellPct}%`,
                                  top: `${(cy - 2) * cellPct}%`,
                                  width: `${wide === 2 ? spriteW : cellPct}%`,
                                  height: `${spriteH}%`,
                                  backgroundImage: `url(${bodyUrl})`,
                                  backgroundSize: `${wide === 2 ? '150%' : '300%'} 300%`,
                                  backgroundPosition: `${wide === 2 ? '0%' : '100%'} ${variant * 50}%`,
                                  backgroundRepeat: 'no-repeat',
                                  imageRendering: 'pixelated',
                                  pointerEvents: 'none',
                                  clipPath: 'inset(33.33% 0 0 0)',
                                  zIndex: 1,
                                }}
                              />
                            ) : null}
                            {topsUrl ? (
                              <div
                                style={{
                                  position: 'absolute',
                                  left: `${cx * cellPct}%`,
                                  top: `${(cy - 2) * cellPct}%`,
                                  width: `${wide === 2 ? spriteW : cellPct}%`,
                                  height: `${spriteH}%`,
                                  backgroundImage: `url(${topsUrl})`,
                                  backgroundSize: `${wide === 2 ? '150%' : '300%'} 300%`,
                                  backgroundPosition: `${wide === 2 ? '0%' : '100%'} ${variant * 50}%`,
                                  backgroundRepeat: 'no-repeat',
                                  imageRendering: 'pixelated',
                                  pointerEvents: 'none',
                                  clipPath: 'inset(0 0 66.66% 0)',
                                  zIndex: 2,
                                }}
                              />
                            ) : null}
                          </React.Fragment>
                        ))}
                      </div>
                    )
                  })()}
                </div>
              </div>
            </div>

            <div className="props-rail">
              {selectedPanel.x === -1 ? (
                <>
                  <h3>Test map layout</h3>
                  <p style={{ fontSize: '10px', color: 'var(--text-tertiary)', margin: '0 0 var(--space-2)' }}>
                    . ocean &nbsp; L land &nbsp; H high (cliff) &nbsp; R road &nbsp; F forest &nbsp; G grass &nbsp; W water
                  </p>
                  <textarea
                    spellCheck={false}
                    value={testMap}
                    onChange={e => setTestMap(e.target.value)}
                    style={{
                      width: '100%', height: '160px', fontFamily: 'monospace', fontSize: '10px',
                      background: 'var(--surface-2)', color: 'var(--text-primary)',
                      border: '1px solid var(--border)', borderRadius: '4px',
                      padding: 'var(--space-2)', resize: 'vertical', boxSizing: 'border-box',
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn--primary"
                    style={{ width: '100%', marginTop: 'var(--space-2)', marginBottom: 'var(--space-4)' }}
                    onClick={() => { handleTestPanel(testMap); window.electronAPI.saveTestPanel(testMap) }}
                  >
                    Apply
                  </button>
                </>
              ) : (
                <>
                  <h3>Panel properties</h3>

                  <div className="props-block">
                    <label>Type</label>
                    <div className="value" style={{ color: 'var(--warning)' }}>
                      {panelDetail.data.settlement ? 'Settlement' : 'Wilderness'}
                    </div>
                  </div>

                  {panelDetail.data.settlement && (
                    <div className="props-block props-block--gold">
                      <label>Spine</label>
                      <div className="value">
                        {(() => {
                          const s = panelDetail.data.settlement
                          const legacyType = typeof s?.type === 'string' ? s.type : null
                          const size = typeof s?.size === 'string' ? s.size : null
                          const label = legacyType ? legacyType : size ? `settlement-${size}` : 'settlement'
                          return `${label.toUpperCase()} (ID ${s?.id ?? '?'})`
                        })()}
                      </div>
                    </div>
                  )}

                  <div className="props-block">
                    <label>Stats</label>
                    <div className="props-kv">
                      <div>Water: {(panelDetail.data.waterDominance * 100).toFixed(1)}%</div>
                      <div>Road: {panelDetail.data.isRoute ? 'Active' : 'N/A'}</div>
                    </div>
                  </div>

                  <div className="props-block" style={{ marginTop: 'var(--space-2)' }}>
                    <label style={{ fontSize: '10px', marginBottom: 'var(--space-2)' }}>Active mapping</label>
                    <div className="props-kv">
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                        <span>Ground</span>
                        <span className="mono" style={{ color: defaultAssets[mapping.GROUND?.assetId] ? 'var(--warning)' : 'var(--text-tertiary)' }}>
                          {mapping.GROUND?.assetId || 'none'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                        <span>Road</span>
                        <span className="mono" style={{ color: defaultAssets[mapping.ROAD?.assetId] ? 'var(--warning)' : 'var(--text-tertiary)' }}>
                          {mapping.ROAD?.assetId || 'none'}
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Root Application component.
 * Manages top-level routing between different tool views.
 */
export default function App() {
  const [currentView, setCurrentView] = useState('start')
  const [theme, setTheme] = useState('light')

  useEffect(() => {
    const saved = localStorage.getItem('grasswhistle.theme') ?? localStorage.getItem('mf.theme')
    if (saved === 'light' || saved === 'dark') {
      setTheme(saved)
      document.documentElement.dataset.theme = saved
      return
    }
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches
    const t = prefersDark ? 'dark' : 'light'
    setTheme(t)
    document.documentElement.dataset.theme = t
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((cur) => {
      const next = cur === 'dark' ? 'light' : 'dark'
      localStorage.setItem('grasswhistle.theme', next)
      document.documentElement.dataset.theme = next
      return next
    })
  }, [])
  const handleSelect = view => setCurrentView(view)
  const handleBack = () => setCurrentView('start')
  if (currentView === 'layout') return <LayoutGenerator onBack={handleBack} />
  if (currentView === 'slicer') return <Slicer onBack={handleBack} />
  if (currentView === 'map') return <MapGenerator onBack={handleBack} />
  return <StartPage onSelect={handleSelect} theme={theme} onToggleTheme={toggleTheme} />
}
