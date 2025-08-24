// js/recolor.js — terrain recolor + canvas/SVG paint
import { S, getWorld } from './state.js';
import { getLayers, ensureRasterImage, repaintCellsForMode } from './render.js';

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
  const { width, height, cells, isWater } = getWorld();
  const sea = (S.params?.seaLevel ?? 0.5);

  if (!cells?.length) return { landFraction: 0 };

  // --- Compute land fraction (same way you did before)
  let landCount = 0;
  if (isWater) {
    for (let i = 0; i < cells.length; i++) if (!isWater[i]) landCount++;
  } else {
    // If no mask yet, derive from height vs. sea (keep identical to legacy)
    for (let i = 0; i < cells.length; i++) if ((cells[i].high ?? 0) >= sea) landCount++;
  }
  const landFraction = cells.length ? +(landCount / cells.length).toFixed(2) : 0;
  console.log(`Land fraction ~ ${landFraction.toFixed(2)}`);

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
      if (isWater[cell.index]) {
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
        if (isWater[d.index]) {
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
        if (isWater[d.index]) {
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
        if (isWater[d.index]) return 'none';
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
