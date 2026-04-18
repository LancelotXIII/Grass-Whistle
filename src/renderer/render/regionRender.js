import { BIOME_PALETTES, PANEL, PALETTE, T } from '../engine/constants.js'

function mgCssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name)
  const s = v ? v.trim() : ''
  return s || fallback
}

export function mgCanvasColors() {
  return {
    crust:      mgCssVar('--canvas-bg', '#F5F3EE'),
    teal:       mgCssVar('--color-sage', '#4A6B52'),
    mauve:      mgCssVar('--color-rust', '#B05E3A'),
    yellow:     mgCssVar('--color-gold', '#C49A2B'),
    peach:      mgCssVar('--color-rust-vivid', '#C07858'),
    neon:       mgCssVar('--color-neon', '#00FFD1'),
    sageVivid:  mgCssVar('--color-sage-vivid', '#6A9E6E'),
    goldLight:  mgCssVar('--color-gold-light', '#F0E2B0'),
    rustVivid:  mgCssVar('--color-rust-vivid', '#C07858'),
    mid:        mgCssVar('--color-mid', '#8A9485'),
  }
}

/**
 * Bakes the procedural region into multiple offscreen canvases.
 * This is a high-performance step called once per generation.
 * @param {Object} region The generated region data.
 * @param {boolean} [exportMode=false] If true, strips UI ornaments (tints, grids, outlines).
 */
export function bakeRegion(region, exportMode = false, showPanelGrid = true, showBonusAreas = true) {
  const CTP = mgCanvasColors()
  const { panelData, width, height } = region
  const totalW = width * PANEL, totalH = height * PANEL

  const offscreen = document.createElement('canvas')
  offscreen.width = totalW
  offscreen.height = totalH
  const ctx = offscreen.getContext('2d')
  const imgData = ctx.createImageData(totalW, totalH)
  const data = imgData.data

  // --- Pass 1: Base Terrain Colors ---
  // Preview (exportMode=false): only visitable panels (route/settlement) are drawn; others stay
  // transparent so the canvas background shows — same idea as Map Generator stitched preview.
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const pd = panelData[`${px},${py}`]
      if (!pd) continue
      const drawTerrain = exportMode || !!(pd.isRoute || pd.settlement)
      for (let cy = 0; cy < PANEL; cy++) {
        const gy = py * PANEL + cy
        for (let cx = 0; cx < PANEL; cx++) {
          const gx = px * PANEL + cx
          const i = (gy * totalW + gx) * 4
          if (!drawTerrain) {
            data[i] = 0
            data[i + 1] = 0
            data[i + 2] = 0
            data[i + 3] = 0
            continue
          }
          const cell = pd.grid[cy * PANEL + cx]
          const baseBiome = (cell && cell.biome !== undefined) ? cell.biome : pd.biome
          const pal = (!exportMode && baseBiome !== undefined && BIOME_PALETTES[baseBiome])
            ? BIOME_PALETTES[baseBiome]
            : PALETTE
          let r, g, b
          if (cell.type === T.LAND && cell.elevation >= 1) {
            ;[r, g, b] = pal.LAND_LEVELS[cell.elevation] ?? [82, 164, 71]
          } else if (cell.type === T.CLIFF) {
            ;[r, g, b] = pal[T.CLIFF]
          } else if (cell.type === T.GRASS || cell.type === T.FOREST) {
            ;[r, g, b] = pal[cell.type] ?? [128, 128, 128]
          } else {
            ;[r, g, b] = pal[cell.type] ?? [128, 128, 128]
          }
          data[i] = r
          data[i + 1] = g
          data[i + 2] = b
          data[i + 3] = 255
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0)

  // Bake overlay (panel grid + settlement highlights) into a separate canvas
  const overlay = document.createElement('canvas')
  overlay.width = totalW
  overlay.height = totalH
  const octx = overlay.getContext('2d')
  octx.clearRect(0, 0, totalW, totalH)

  // Biome map (exclusive tint layer)
  const biomeMap = document.createElement('canvas')
  biomeMap.width = totalW
  biomeMap.height = totalH
  const bctx = biomeMap.getContext('2d')
  bctx.clearRect(0, 0, totalW, totalH)

  // Cliff biome debug map (tint only cliffs by their biome)
  const cliffBiomeMap = document.createElement('canvas')
  cliffBiomeMap.width = totalW
  cliffBiomeMap.height = totalH
  const cbctx = cliffBiomeMap.getContext('2d')
  cbctx.clearRect(0, 0, totalW, totalH)

  // --- Pass 3: Overlays (Panel Grid & Biomes) ---
  // High-contrast biome tint palette (used for biome/cliff debug overlays).
  const BIOME_RGBA = [
    [0, 200, 255, Math.round(255 * 0.45)],  // 0: Coastal (cyan)
    [145, 70, 255, Math.round(255 * 0.45)], // 1: Highland (violet)
    [255, 60, 200, Math.round(255 * 0.45)], // 2: Mystic (magenta)
    [255, 190, 0, Math.round(255 * 0.45)],  // 3: Autumn (amber)
    [60, 220, 90, Math.round(255 * 0.45)],  // 4: Tropical (green)
    [255, 70, 50, Math.round(255 * 0.45)],  // 5: Volcanic (red-orange)
  ]

  // Biome tint should reflect per-cell `cell.biome` edits (zone painting).
  if (!exportMode) {
    const bImg = bctx.createImageData(totalW, totalH)
    const bd = bImg.data
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const pd = panelData[`${px},${py}`]
        if (!pd) continue
        if (!(pd.isRoute || pd.settlement)) continue
        for (let cy = 0; cy < PANEL; cy++) {
          const gy = py * PANEL + cy
          for (let cx = 0; cx < PANEL; cx++) {
            const gx = px * PANEL + cx
            const cell = pd.grid[cy * PANEL + cx]
            const baseBiome = (cell && cell.biome !== undefined) ? cell.biome : pd.biome
            const rgba = (baseBiome !== undefined && BIOME_RGBA[baseBiome]) ? BIOME_RGBA[baseBiome] : null
            if (!rgba) continue
            const i = (gy * totalW + gx) * 4
            bd[i] = rgba[0]; bd[i + 1] = rgba[1]; bd[i + 2] = rgba[2]; bd[i + 3] = rgba[3]
          }
        }
      }
    }
    bctx.putImageData(bImg, 0, 0)
  }

  // Cliff-biome tint: only color cliff pixels (debug).
  if (!exportMode) {
    const cImg = cbctx.createImageData(totalW, totalH)
    const cd = cImg.data
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const pd = panelData[`${px},${py}`]
        if (!pd) continue
        if (!(pd.isRoute || pd.settlement)) continue
        for (let cy = 0; cy < PANEL; cy++) {
          const gy = py * PANEL + cy
          for (let cx = 0; cx < PANEL; cx++) {
            const gx = px * PANEL + cx
            const cell = pd.grid[cy * PANEL + cx]
            if (!cell || cell.type !== T.CLIFF) continue
            const baseBiome = (cell.biome !== undefined) ? cell.biome : pd.biome
            const rgba = (baseBiome !== undefined && BIOME_RGBA[baseBiome]) ? BIOME_RGBA[baseBiome] : null
            if (!rgba) continue
            const i = (gy * totalW + gx) * 4
            cd[i] = rgba[0]; cd[i + 1] = rgba[1]; cd[i + 2] = rgba[2]
            cd[i + 3] = Math.max(rgba[3], Math.round(255 * 0.75))
          }
        }
      }
    }
    cbctx.putImageData(cImg, 0, 0)
  }

  // --- Pass 3: Cluster outlines + centroids (panel-resolution, drawn in renderRegion) ---
  // Group panels by mapName, trace outer edges at panel grid resolution.
  /** @type {Map<string, { path: Path2D, cx: number, cy: number, color: string }>} */
  const clusterOutlines = new Map()
  if (!exportMode && showPanelGrid) {
    // Collect panels per cluster name.
    /** @type {Map<string, Array<[number,number]>>} */
    const clusterPanels = new Map()
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const pd = panelData[`${px},${py}`]
        if (!pd?.mapName) continue
        if (!clusterPanels.has(pd.mapName)) clusterPanels.set(pd.mapName, [])
        clusterPanels.get(pd.mapName).push([px, py])
      }
    }

    for (const [name, members] of clusterPanels) {
      const memberSet = new Set(members.map(([x, y]) => `${x},${y}`))
      const path = new Path2D()
      let sumX = 0, sumY = 0
      // Sample panel to determine cluster type for color.
      const [spx, spy] = members[0]
      const spd = panelData[`${spx},${spy}`]
      let color, type
      if (spd.settlement) { color = '#00FFD1'; type = 'settlement' }
      else if (spd.isForestHaloEnclosed) { color = '#39FF14'; type = 'bonus' }
      else if (spd.isForestHalo) { color = '#7ABFFF'; type = 'halo' }
      else { color = '#FF6B6B'; type = 'route' }

      // Halo never gets a label; bonus areas are skipped entirely if secretHalo is off.
      if (type === 'halo') continue
      if (type === 'bonus' && !showBonusAreas) continue

      for (const [px, py] of members) {
        sumX += px; sumY += py
        const x0 = px * PANEL, y0 = py * PANEL
        const x1 = x0 + PANEL, y1 = y0 + PANEL
        const noTop    = !memberSet.has(`${px},${py - 1}`)
        const noBottom = !memberSet.has(`${px},${py + 1}`)
        const noLeft   = !memberSet.has(`${px - 1},${py}`)
        const noRight  = !memberSet.has(`${px + 1},${py}`)
        // Extend each edge segment into corners it shares with a perpendicular edge,
        // so there are no gaps where two boundary edges meet.
        if (noTop)    { path.moveTo(noLeft  ? x0 : x0 + 1, y0 + 1); path.lineTo(noRight  ? x1 : x1 - 1, y0 + 1) }
        if (noBottom) { path.moveTo(noLeft  ? x0 : x0 + 1, y1 - 1); path.lineTo(noRight  ? x1 : x1 - 1, y1 - 1) }
        if (noLeft)   { path.moveTo(x0 + 1, noTop ? y0 : y0 + 1);   path.lineTo(x0 + 1, noBottom ? y1 : y1 - 1) }
        if (noRight)  { path.moveTo(x1 - 1, noTop ? y0 : y0 + 1);   path.lineTo(x1 - 1, noBottom ? y1 : y1 - 1) }
      }

      clusterOutlines.set(name, {
        path,
        cx: sumX / members.length,
        cy: sumY / members.length,
        color,
        type,
      })
    }

    // Unnamed panels (ocean/unvisited) — individual thin white outline, no label.
    const unnamedPath = new Path2D()
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const pd = panelData[`${px},${py}`]
        if (pd?.mapName) continue
        const I = 1
        const x0 = px * PANEL, y0 = py * PANEL
        const x1 = x0 + PANEL, y1 = y0 + PANEL
        unnamedPath.moveTo(x0 + I, y0 + I)
        unnamedPath.lineTo(x1 - I, y0 + I)
        unnamedPath.lineTo(x1 - I, y1 - I)
        unnamedPath.lineTo(x0 + I, y1 - I)
        unnamedPath.closePath()
      }
    }
    clusterOutlines.set('__unnamed__', { path: unnamedPath, cx: -1, cy: -1, color: 'rgba(255,255,255,0.18)', unnamed: true })
  }

  // --- Pass 4: Road Skeleton Debug ---
  const roadDebug = document.createElement('canvas')
  roadDebug.width = totalW; roadDebug.height = totalH
  const rctx = roadDebug.getContext('2d')
  rctx.clearRect(0, 0, totalW, totalH)
  rctx.lineWidth = 1
  for (const path of (region.roadPaths ?? [])) {
    if (!path || path.length < 2) continue
    // Determine if this path crosses water (for color)
    const hasWater = path.some(([wx, wy]) => {
      const pk = `${(wx / PANEL) | 0},${(wy / PANEL) | 0}`
      const c = panelData[pk]?.grid[(wy % PANEL) * PANEL + (wx % PANEL)]
      return c && (c.type === T.WATERROAD)
    })
    rctx.strokeStyle = hasWater ? 'rgba(202, 158, 230, 0.92)' : 'rgba(229, 200, 144, 0.92)'
    rctx.beginPath()
    rctx.moveTo(path[0][0] + 0.5, path[0][1] + 0.5)
    for (let i = 1; i < path.length; i++)
      rctx.lineTo(path[i][0] + 0.5, path[i][1] + 0.5)
    rctx.stroke()
  }

  // Draw waypoints (A* entry/exit points) as magenta dots
  for (const [wx, wy] of (region.roadWaypoints ?? [])) {
    rctx.fillStyle = 'rgba(255, 0, 255, 0.9)'
    rctx.fillRect(wx, wy, 1, 1)
  }

  // Zone outlines (for biome zone hover highlight).
  // Built in world-cell coords so `renderRegion` can transform with pan/zoom.
  let pocketOutlines = null
  if (!exportMode && region.pocketIdGrid && region.pocketCellsById) {
    const pocketIdGrid = region.pocketIdGrid
    const pocketCellsById = region.pocketCellsById
    // Index by pocketId; element 0 is unused (pocket ids start at 1).
    pocketOutlines = Array(pocketCellsById.length).fill(null)

    for (let pocketId = 1; pocketId < pocketCellsById.length; pocketId++) {
      const members = pocketCellsById[pocketId]
      if (!members || members.length === 0) continue

      const path = new Path2D()
      for (let i = 0; i < members.length; i++) {
        const wi = members[i]
        const x = wi % totalW
        const y = (wi / totalW) | 0

        // Add perimeter edges where a 4-neighbor is not in this pocket.
        // Top
        if (y === 0 || pocketIdGrid[wi - totalW] !== pocketId) {
          path.moveTo(x, y)
          path.lineTo(x + 1, y)
        }
        // Bottom
        if (y === totalH - 1 || pocketIdGrid[wi + totalW] !== pocketId) {
          path.moveTo(x, y + 1)
          path.lineTo(x + 1, y + 1)
        }
        // Left
        if (x === 0 || pocketIdGrid[wi - 1] !== pocketId) {
          path.moveTo(x, y)
          path.lineTo(x, y + 1)
        }
        // Right
        if (x === totalW - 1 || pocketIdGrid[wi + 1] !== pocketId) {
          path.moveTo(x + 1, y)
          path.lineTo(x + 1, y + 1)
        }
      }
      pocketOutlines[pocketId] = path
    }
  }

  return { map: offscreen, overlay, biomeMap, cliffBiomeMap, roadDebug, pocketOutlines, clusterOutlines }
}

/**
 * Main render loop. Composites baked canvases with zoom/pan transforms.
 * Performs zero per-pixel work for maximum 60FPS performance.
 */
export function renderRegion(
  canvas,
  region,
  view,
  baked,
  showRoadDebug = false,
  showBiomes = true,
  showCliffBiome = false,
  hoverZoneId = 0,
  hoverCluster = null
) {
  const CTP = mgCanvasColors()
  const { width, height } = region
  const totalW = width * PANEL, totalH = height * PANEL

  const baseScale = Math.min(canvas.width / totalW, canvas.height / totalH)
  const scale = baseScale * (view?.zoom ?? 1)
  const renderW = Math.floor(totalW * scale), renderH = Math.floor(totalH * scale)
  const offX = Math.floor((canvas.width - Math.floor(totalW * baseScale)) / 2) + Math.floor(view?.panX ?? 0)
  const offY = Math.floor((canvas.height - Math.floor(totalH * baseScale)) / 2) + Math.floor(view?.panY ?? 0)

  const ctx = canvas.getContext('2d')
  ctx.fillStyle = CTP.crust
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  if (baked) {
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(baked.map, offX, offY, renderW, renderH)
    if (showBiomes && baked.biomeMap)
      ctx.drawImage(baked.biomeMap, offX, offY, renderW, renderH)
    // Cliff biome debug overlay: exclusive toggle (draw after biome tint if both enabled).
    if (showCliffBiome && baked.cliffBiomeMap)
      ctx.drawImage(baked.cliffBiomeMap, offX, offY, renderW, renderH)
    ctx.drawImage(baked.overlay, offX, offY, renderW, renderH)
    if (showRoadDebug && baked.roadDebug)
      ctx.drawImage(baked.roadDebug, offX, offY, renderW, renderH)

    const hoverPath = hoverZoneId > 0 && baked.pocketOutlines && baked.pocketOutlines[hoverZoneId]
    if (hoverPath) {
      ctx.save()
      ctx.translate(offX, offY)
      ctx.scale(scale, scale)
      const outerW = Math.max(3 / scale, 2.4 / scale)
      const innerW = Math.max(2.4 / scale, 1.9 / scale)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'

      // Outer stroke: high-contrast silhouette (reads on bright + tinted terrain).
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.78)'
      ctx.lineWidth = outerW
      ctx.stroke(hoverPath)

      // Inner stroke: bright accent (pops against the dark outer stroke).
      ctx.strokeStyle = CTP.neon
      ctx.lineWidth = innerW
      ctx.shadowColor = CTP.neon
      ctx.shadowBlur = Math.max(6 / scale, 4.5 / scale)
      ctx.stroke(hoverPath)
      ctx.shadowBlur = 0
      ctx.shadowColor = 'transparent'
      ctx.restore()
    }

    // Cluster outlines + one label per cluster — all in screen space for crispness.
    if (baked.clusterOutlines?.size) {
      ctx.save()
      ctx.translate(offX, offY)
      ctx.scale(scale, scale)
      for (const { path, color, unnamed } of baked.clusterOutlines.values()) {
        ctx.strokeStyle = color
        ctx.lineWidth = unnamed ? (1 / scale) : (4 / scale)
        ctx.globalAlpha = unnamed ? 1 : 0.8
        ctx.stroke(path)
      }
      ctx.restore()

      ctx.save()
      ctx.font = 'bold 11px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const [name, { cx, cy, color, type, unnamed }] of baked.clusterOutlines) {
        if (unnamed || type === 'halo') continue
        const sx = offX + Math.floor((cx + 0.5) * PANEL * scale)
        const sy = offY + Math.floor((cy + 0.5) * PANEL * scale)
        const metrics = ctx.measureText(name)
        const tw = metrics.width
        const th = 11
        const pad = { x: 5, y: 3 }
        ctx.globalAlpha = 0.72
        ctx.fillStyle = 'rgba(0,0,0,0.82)'
        ctx.beginPath()
        ctx.roundRect(sx - tw / 2 - pad.x, sy - th / 2 - pad.y, tw + pad.x * 2, th + pad.y * 2, 3)
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.fillStyle = color
        ctx.shadowColor = 'rgba(0,0,0,0.6)'
        ctx.shadowBlur = 2
        ctx.fillText(name, sx, sy)
        ctx.shadowBlur = 0
      }
      ctx.restore()

      // Hovered cluster — draw a filled glow over all its panels.
      if (hoverCluster && baked.clusterOutlines.has(hoverCluster)) {
        const { path, color } = baked.clusterOutlines.get(hoverCluster)
        ctx.save()
        ctx.translate(offX, offY)
        ctx.scale(scale, scale)
        ctx.strokeStyle = color
        ctx.lineWidth = 6 / scale
        ctx.globalAlpha = 0.9
        ctx.shadowColor = color
        ctx.shadowBlur = 12 / scale
        ctx.stroke(path)
        ctx.shadowBlur = 0
        ctx.restore()
      }
    }
  }
}

