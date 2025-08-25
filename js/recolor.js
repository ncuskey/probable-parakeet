// js/recolor.js — terrain recolor + canvas/SVG paint
import { S, getWorld } from './state.js';
import { getLayers, ensureRasterImage, repaintCellsForMode, ensureCellLayer, dumpComputed } from './render.js';
import { polygonToPath } from './geom/cellpaths.js';

// Defensive guard: d3 should be loaded globally in index.html
function d3req() {
  if (!('d3' in window)) {
    console.warn('[recolor] d3 not found on window. Include D3 in index.html.');
  }
  return window.d3;
}

// ---- Color ramps (MOVE your existing helpers here) -------------------------
/** Land color ramp: dark green lowlands → light green → tan → white peaks */
function landColor(t) {
  // t in [0,1], already normalized above sea level
  t = Math.max(0, Math.min(1, t));
  if (t < 0.35) {
    const u = t / 0.35; // 0..1
    return d3.interpolateYlGn(1.0 - 0.7 * u); // darker coastal greens (reversed)
  } else if (t < 0.7) {
    const u = (t - 0.35) / 0.35; // 0..1
    return d3.interpolateYlOrBr(0.25 + 0.75 * u); // foothills to tan
  } else if (t < 0.9) {
    const u = (t - 0.7) / 0.2; // 0..1
    return d3.interpolateRdYlBu(0.9 - 0.4 * u); // tan to light brown/gray
  } else {
    const u = (t - 0.9) / 0.1; // 0..1
    return d3.interpolateGreys(0.4 + 0.6 * u); // light gray to white peaks
  }
}

/** Sea color ramp */
function seaColor(t) {
  // t in [0,1]; placeholder — replace with your current water ramp
  return t < 0.5 ? '#7aaed6' : '#4e8fbf';
}

/** Get biome color for a given biome and elevation */
function getBiomeColor(biome, elevation, seaLevel) {
  const biomeColors = {
    'Ocean': '#4D83AE',
    'Tundra': '#E8F4F8',
    'Polar Desert': '#F0F8FF',
    'Boreal Forest': '#2E5A27',
    'Cold Grassland': '#8FBC8F',
    'Cold Desert': '#F5DEB3',
    'Temperate Desert': '#DEB887',
    'Grassland': '#90EE90',
    'Temperate Forest': '#228B22',
    'Rainforest': '#006400',
    'Hot Desert': '#F4A460',
    'Savanna': '#F0E68C',
    'Tropical Seasonal Forest': '#32CD32',
    'Tropical Rainforest': '#228B22'
  };
  
  // For hybrid mode, blend with elevation
  const renderMode = document.getElementById('renderMode')?.value || 'terrain';
  if (renderMode === 'hybrid' && elevation > seaLevel + 0.3) {
    // Fade to white for high elevations
    const t = Math.min(1, (elevation - seaLevel - 0.3) / 0.4);
    return d3.interpolateRgb(biomeColors[biome] || '#228B22', '#ffffff')(t);
  }
  
  return biomeColors[biome] || '#228B22';
}

/** Shade a color by a factor */
function shadeColor(color, shade) {
  let r, g, b;
  
  if (color.startsWith('rgb(')) {
    // Parse rgb(r, g, b) format
    const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (rgbMatch) {
      r = parseInt(rgbMatch[1]);
      g = parseInt(rgbMatch[2]);
      b = parseInt(rgbMatch[3]);
    } else {
      return color; // fallback if parsing fails
    }
  } else if (color.startsWith('#')) {
    // Parse hex format
    const hex = color.replace('#', '');
    r = parseInt(hex.substr(0, 2), 16);
    g = parseInt(hex.substr(2, 2), 16);
    b = parseInt(hex.substr(4, 2), 16);
  } else {
    return color; // fallback for unknown formats
  }
  
  const shadedR = Math.round(r * shade);
  const shadedG = Math.round(g * shade);
  const shadedB = Math.round(b * shade);
  
  return `rgb(${shadedR}, ${shadedG}, ${shadedB})`;
}

/** Estimate normal vector for a cell */
function estimateNormal(i, cells, H) {
  // simple gradient from neighbors
  let dx = 0, dy = 0;
  const ci = cells[i];
  for (const j of ci.neighbors) {
    const cj = cells[j];
    const dh = H[j] - H[i];
    dx += dh * (cj.cx - ci.cx);
    dy += dh * (cj.cy - ci.cy);
  }
  // normal pointing "up": N ≈ normalize([-dx, -dy, scale])
  const scale = 1.0; // simplified scale
  let nx = -dx, ny = -dy, nz = scale;
  const len = Math.hypot(nx, ny, nz);
  return [nx / len, ny / len, nz / len];
}

/** Compute shading for cells */
function computeShading(cells, sea) {
  const lightDir = [-0.5, -0.5, 1]; // Light direction
  const lightLen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]);
  const normalizedLight = lightDir.map(v => v / lightLen);
  
  const H = cells.map(c => c.high);
  const shades = new Float32Array(cells.length);
  
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].high >= sea) {
      // Only shade land cells
      const normal = estimateNormal(i, cells, H);
      const dot = normal[0] * normalizedLight[0] + 
                 normal[1] * normalizedLight[1] + 
                 normal[2] * normalizedLight[2];
      shades[i] = Math.max(0.25, dot); // 0.25 = ambient
    } else {
      shades[i] = 1.0; // No shading for water
    }
  }
  
  return shades;
}

// ---- Canvas singleton for raster painting ---------------------------------
let TerrainCanvas = null;
export function ensureTerrainCanvas() {
  if (TerrainCanvas) return TerrainCanvas;
  
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let terrainDirty = true;
  
  TerrainCanvas = {
    canvas,
    ctx,
    setDirty: () => { terrainDirty = true; },
    isDirty: () => terrainDirty,
    markClean: () => { terrainDirty = false; }
  };
  
  return TerrainCanvas;
}

// ---- Main recolor ----------------------------------------------------------
/**
 * Paints terrain as (a) canvas raster -> <image id="raster"> and/or (b) SVG per-cell fills.
 * Returns { landFraction } and logs "Land fraction ~ X.XX".
 */
export function recolor(run = 0) {
  // Use elevation sea level if available, otherwise fall back to params
  const sea = (S.elevation?.seaLevel ?? S.params?.seaLevel ?? 0.5);
  const cells = S.world?.cells ?? [];
  const mask = (S.water?.isWater && S.water.isWater.length === cells.length) ? S.water.isWater : null;

  if (!cells?.length) return { landFraction: 0 };

  // --- Compute land fraction (same way you did before)
  let landCount = 0;
  for (let i = 0; i < cells.length; i++) {
    const waterHere = mask ? !!mask[i] : ((cells[i].high ?? 0) < sea);
    if (!waterHere) landCount++;
  }
  const landFraction = cells.length ? +(landCount / cells.length).toFixed(2) : 0;
  console.log(`Land fraction ~ ${landFraction.toFixed(2)}`);
  
  // Console markers for quick verification
  console.log('[recolor] sea=', sea.toFixed(3), 'mask=', !!mask, 'maskLen=', mask?.length);
  console.log('[recolor]', { sea, cells: cells.length, mask: !!mask });
  
  // Helper function to get cell index consistently
  function cellIndex(d) {
    // d may be a plain data object or bound with an index/id property
    return (d?.index ?? d?.id ?? d?.i ?? null);
  }

  // --- Painting: decide between canvas raster + SVG
  const { mapCells } = getLayers();

  // Get rendering parameters
  const renderMode = document.getElementById('renderMode')?.value || 'terrain';
  const shadingMode = document.getElementById('shadingMode')?.value || 'flat';
  
  // Compute shading if enabled
  const shades = shadingMode === 'shaded' ? computeShading(cells, sea) : null;

  // Check if we're using canvas rendering
  const isCoarse = window.matchMedia('(pointer: coarse)').matches;
  const useCanvas = isCoarse ? cells.length > 4000 : cells.length > 8000;

  // (A) Canvas raster path: update <image id="raster">
  if (useCanvas && ensureTerrainCanvas().isDirty()) {
    const { canvas, ctx } = ensureTerrainCanvas();
    canvas.width = width;
    canvas.height = height;

    cells.forEach(cell => {
      const i = cellIndex(cell);
      if (i == null) return; // skip unbound cells
      const waterHere = mask ? !!mask[i] : ((cells[i].high ?? 0) < sea);
      if (waterHere) {
        // Skip water cells - they're handled by ocean backdrop
        return;
      }
      
      let baseColor;
      if (renderMode === 'biomes' || renderMode === 'hybrid') {
        baseColor = getBiomeColor(cell.biome, cell.high, sea);
      } else {
        const tl = (cell.high - sea) / Math.max(1 - sea, 0.0001);
        const tt = Math.max(0, Math.min(1, tl));
        baseColor = landColor(tt);
      }
      
      if (shadingMode === 'shaded' && shades) {
        baseColor = shadeColor(baseColor, shades[cell.index]);
      }
      
      // Draw cell on canvas
      ctx.fillStyle = baseColor;
      if (cell.poly && cell.poly.length > 2) {
        ctx.beginPath();
        ctx.moveTo(cell.poly[0][0], cell.poly[0][1]);
        for (let i = 1; i < cell.poly.length; i++) {
          ctx.lineTo(cell.poly[i][0], cell.poly[i][1]);
        }
        ctx.closePath();
        ctx.fill();
      }
    });

    // Update canvas image in SVG
    const dataURL = canvas.toDataURL();
    ensureRasterImage({ width, height }).attr('href', dataURL);
    ensureTerrainCanvas().markClean();
  } else if (!useCanvas) {
    // (B) SVG per-cell paints (always run for small maps — keep your legacy gating if needed)
    const sel = mapCells.selectAll('.mapCell');
    if (!sel.empty()) {
      sel.attr('fill', (d) => {
        const i = cellIndex(d);
        if (i == null) return '#ccc'; // debug color if something is unbound
        const waterHere = mask ? !!mask[i] : ((cells[i].high ?? 0) < sea);
        if (waterHere) {
          return 'none';
        } else {
          let baseColor;
          if (renderMode === 'biomes' || renderMode === 'hybrid') {
            baseColor = getBiomeColor(d.biome, d.high, sea);
          } else {
            const tl = (d.high - sea) / Math.max(1 - sea, 0.0001);
            const tt = Math.max(0, Math.min(1, tl));
            baseColor = landColor(tt);
          }
          
          if (shadingMode === 'shaded' && shades) {
            return shadeColor(baseColor, shades[d.index]);
          } else {
            return baseColor;
          }
        }
      })
      .attr('stroke', 'none') // Ensure no cell borders after recoloring
      .style('fill', (d) => {
        const i = cellIndex(d);
        if (i == null) return '#ccc'; // debug color if something is unbound
        const waterHere = mask ? !!mask[i] : ((cells[i].high ?? 0) < sea);
        if (waterHere) {
          return 'none';
        } else {
          let baseColor;
          if (renderMode === 'biomes' || renderMode === 'hybrid') {
            baseColor = getBiomeColor(d.biome, d.high, sea);
          } else {
            const tl = (d.high - sea) / Math.max(1 - sea, 0.0001);
            const tt = Math.max(0, Math.min(1, tl));
            baseColor = landColor(tt);
          }
          
          if (shadingMode === 'shaded' && shades) {
            return shadeColor(baseColor, shades[d.index]);
          } else {
            return baseColor;
          }
        }
      })
      .attr('data-terrain-fill', (d) => {
        const i = cellIndex(d);
        if (i == null) return '#ccc'; // debug color if something is unbound
        const waterHere = mask ? !!mask[i] : ((cells[i].high ?? 0) < sea);
        if (waterHere) return 'none';
        const tl = (d.high - sea) / Math.max(1 - sea, 0.0001);
        const tt = Math.max(0, Math.min(1, tl));
        return landColor(tt);
      });
    }
  }

  // Let view-mode helper reapply any cached attrs instantly (no heavy work)
  try { repaintCellsForMode(document.body.classList.contains('view-mode-terrain') ? 'terrain' : 'regions'); } catch (_e) {}

  return { landFraction };
}

/**
 * Defensive terrain painting with explicit fill colors and proper layer management.
 * Ensures land/water fills are visible and can't be overridden by CSS.
 */
export function recolorTerrain(S) {
  const d3 = d3req();
  const svg = d3.select('#map');
  if (svg.empty()) throw new Error('#map svg root not found');

  // Remove prior debug reset if it exists
  const dbg = d3.select('#debug-reset');
  if (!dbg.empty()) {
    dbg.remove();
    console.log('[recolor] removed debug reset style');
  }

  // Add hard preconditions for recolor
  if (!S?.world?.cells?.length) {
    console.warn('[recolor] abort: world cells not ready');
    return;
  }
  if (!S?.elevation?.height?.length || typeof S?.elevation?.seaLevel !== 'number') {
    console.warn('[recolor] abort: elevation not ready');
    return;
  }
  if (!S?.water?.isWater?.length) {
    console.warn('[recolor] abort: water mask not ready');
    return;
  }

  // --- DEBUG: nuke anything that could hide paint ---
  svg.attr('opacity', 1).attr('filter', null);
  svg.selectAll('g').attr('opacity', 1).attr('filter', null).attr('mask', null).attr('clip-path', null)
    .style('mix-blend-mode', 'normal');

  // Hide known overlays that could cover everything
  d3.select('#overlay').attr('display', 'none');
  d3.select('#raster').attr('display', 'none');
  d3.select('#shade').attr('display', 'none');

  const { gSea, gCells } = ensureCellLayer();

  const sea = (S.elevation?.seaLevel ?? S.params?.seaLevel ?? 0.5);
  const cells = S.world?.cells ?? [];
  const mask  = (S.water?.isWater && S.water.isWater.length === cells.length) ? S.water.isWater : null;

  console.log('[recolor] sea=', sea.toFixed(3), 'cells=', cells.length, 'mask=', !!mask);

  // --- 2a) paint a solid sea underlay so "water" is obvious ---
  // Ensure the sea is actually under you
  const vb = svg.attr('viewBox');
  let w = +svg.attr('width'), h = +svg.attr('height');
  if ((!w || !h) && vb) {
    const parts = vb.split(/\s+/).map(Number);
    w = parts[2]; h = parts[3];
  }
  if (!w || !h) { w = 2048; h = 1024; }
  
  gSea.selectAll('rect.sea-underlay').data([0]).join('rect')
    .attr('class','sea-underlay')
    .attr('x', 0).attr('y', 0)
    .attr('width', w)
    .attr('height', h)
    .attr('fill', '#7fb1e6')          // visible blue
    .attr('pointer-events', 'none');

  // --- 2b) join cells and force visible land fills ---
  // EXPECTATION: each cell object has .index or .id set to its canonical index
  const keyFn = (d, i) => (d?.index ?? d?.id ?? i);

  const sel = gCells.selectAll('path.cell').data(cells, keyFn);

  sel.enter()
    .append('path')
    .attr('class','cell')
    .merge(sel)
    .attr('d', (d, i) => {
      // Try cached path, then cached poly, then compute from mesh voronoi on the fly
      if (d.path && d.path.length > 2) return d.path;

      if (d.poly && d.poly.length >= 3) {
        const p = polygonToPath(d.poly);
        d.path = p;
        return p;
      }

      const idx = d?.index ?? d?.id ?? i;
      const v = S.mesh?.voronoi;
      if (v && typeof v.cellPolygon === 'function') {
        const poly = v.cellPolygon(idx);
        if (poly && poly.length >= 3) {
          d.poly = poly;
          const p = polygonToPath(poly);
          d.path = p;
          return p;
        }
      }
      // Last-resort tiny debug dot to make the cell visible
      const cx = d.cx ?? d.x ?? d[0] ?? 0;
      const cy = d.cy ?? d.y ?? d[1] ?? 0;
      return `M${cx-0.5},${cy}h1v1h-1Z`;
    })
    .attr('stroke', 'none')                 // kill grid lines here
    .attr('vector-effect', 'non-scaling-stroke')
    .attr('fill-rule', 'evenodd')
    .attr('fill', (d, i) => {
      const idx = d?.index ?? d?.id ?? i;
      const h = cells[idx]?.high ?? 0;
      const waterHere = mask ? !!mask[idx] : (h < sea);
      if (waterHere) return 'rgba(0,0,0,0)';    // transparent; sea underlay shows through
      // Land ramp — deliberately simple & *visible*
      // (replace with your palette later)
      if (h > 0.85) return '#73431e';
      if (h > 0.70) return '#9b5e2e';
      if (h > 0.55) return '#c49a6c';
      if (h > 0.45) return '#88b04b';
      if (h > 0.35) return '#6ea04b';
      return '#4a8f4a';
    });

  sel.exit().remove();

  // Log computed styles of a sample cell
  const sample = d3.select('#cells path.cell').node();
  dumpComputed(sample, '[computed] path.cell');

  // Sanity: how many paths missing 'd'?
  const missingD = d3.selectAll('#cells path.cell').filter(function() {
    const d = this.getAttribute('d'); return !d || d.length < 3;
  }).size();
  console.log('[recolor] after paint: missing d=', missingD);

  // --- 2c) assert we actually painted land ---
  let landCount = 0;
  for (let i = 0; i < cells.length; i++) {
    const h = cells[i]?.high ?? 0;
    const water = mask ? !!mask[i] : (h < sea);
    if (!water) landCount++;
  }
  console.log('[recolor] painted land cells=', landCount, 'of', cells.length);

  // DEBUG: if everything is still black, hard-force a visible land
  if (landCount === 0) {
    gCells.selectAll('path.cell').attr('fill', '#44cc55');
    console.warn('[recolor] fallback applied: forced land fill for debug');
  }

  // Additional debugging for covering elements
  console.log('SVG elements check:', [...document.querySelectorAll('#map *')].map(n => ({
    n: n.tagName, 
    id: n.id, 
    cls: n.className?.baseVal || n.className, 
    op: getComputedStyle(n).opacity, 
    disp: getComputedStyle(n).display,
    fill: getComputedStyle(n).fill
  })).filter(el => el.fill === 'rgb(0, 0, 0)' || el.disp === 'none'));

  // Count paths we painted transparent for water
  const waterPaths = d3.selectAll('#cells path.cell').filter(function() {
    const f = this.getAttribute('fill');
    return f === 'none' || f === 'transparent' || f === 'rgba(0,0,0,0)';
  }).size();
  console.log('[recolor] painted water cells=', waterPaths, 'of', S.world.cells.length);
}
