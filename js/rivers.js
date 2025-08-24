// js/rivers.js — precipitation cache + river steps + river compute/draw
import { S, getWorld, getPrecip, setPrecip } from './state.js';
import { getLayers } from './render.js';
import { computePrecipArray } from './climate.js';
import { ProgressManager } from './ui-overlays.js';

// River filtering constants - keep only bigger rivers
const MIN_RIVER_STEPS = 24;
const MIN_RIVER_FLUX = 0.005;

/** Recompute precip cache if missing using climate provider (no window.*) */
export function recomputePrecipIfNeeded() {
  if (getPrecip()) return;
  setPrecip(computePrecipArray());
}

/** MOVE your existing BFS/flow precompute here; preserve timing/log labels. */
export function computeRiverSteps() {
  const t0 = performance.now();
  // --- MOVE BODY: your current "Compute river steps (BFS)" implementation ---
  const { cells } = getWorld();
  const N = cells.length;
  const steps = new Int16Array(N).fill(32767);
  const q = [];
  for (let i = 0; i < N; i++) {
    if (cells[i].hasRiver) { steps[i] = 0; q.push(i); }
  }
  for (let qi = 0; qi < q.length; qi++) {
    const u = q[qi];
    const ns = cells[u].neighbors||[];
    for (const v of ns) {
      if (steps[v] > steps[u] + 1) { steps[v] = steps[u] + 1; q.push(v); }
    }
  }
  // Use getWorld() for cells/graph; write any arrays you keep in S.caches if needed.
  // --------------------------------------------------------------------------
  const dt = performance.now() - t0;
  console.log(`⏱ Compute river steps (BFS): ${dt.toFixed(1)} ms`);
  return steps;
}

/** Full rivers compute (and render if your legacy code also draws rivers here). */
export function computeRivers(run = 0) {
  const t0 = performance.now();
  const { svg, zoomRoot, mapCells } = getLayers();
  const { cells, width, height, isWater } = getWorld();
  const precip = getPrecip(); // already ensured by recomputePrecipIfNeeded()

  // --- MOVE BODY: your existing computeRivers implementation ---
  const riversShade = d3.select('g.riversShade');
  const riversG = d3.select('g.rivers');
  
  // Defensive guard
  if (!cells?.length) {
    console.warn('computeRivers: no cells, skipping');
    return;
  }
  
  riversShade.selectAll('path').remove();
  riversG.selectAll('path').remove();
  const sea = +document.getElementById('seaLevelInput').value;
  const landIdxs = [];
  for (let i = 0; i < cells.length; i++) if (cells[i].high >= sea) landIdxs.push(i);
  if (!landIdxs.length) { window.__state.riverStats = { majors:0, confluences:0, majorsDrawn:0, majorsReachedSea:0, avgMainLength:0 }; return; }

  // Update progress during river computation
  ProgressManager.update(62, 'Computing rivers...', 'Building distance field...');

  // Use cached typed arrays
  const {dist, down, flux} = window.__state.tmp;
  dist.fill(1e9); down.fill(-1); flux.fill(0);

  // Distance-to-coast field (toward sea only)
  const INF = 1e9;
  const bfsQueue = [];
  for (let i = 0; i < cells.length; i++) if (cells[i].high < sea) { dist[i] = 0; bfsQueue.push(i); }
  for (let qi = 0; qi < bfsQueue.length; qi++) {
    const v = bfsQueue[qi];
    const dv = dist[v] + 1;
    const nbs = cells[v].neighbors;
    for (let k = 0; k < nbs.length; k++) { const nb = nbs[k]; if (dist[nb] > dv) { dist[nb] = dv; bfsQueue.push(nb); } }
  }

  // Flow directions
  landIdxs.forEach(i => {
    let best = -1, bestH = Infinity;
    const di = dist[i];
    const nbs = cells[i].neighbors;
    for (let k = 0; k < nbs.length; k++) {
      const nb = nbs[k];
      if (dist[nb] < di && cells[nb].high <= bestH) { bestH = cells[nb].high; best = nb; }
    }
    if (best === -1) {
      for (let k = 0; k < nbs.length; k++) {
        const nb = nbs[k];
        if (cells[nb].high < cells[i].high && cells[nb].high < bestH) { bestH = cells[nb].high; best = nb; }
      }
    }
    if (best === -1) {
      let bestD = Infinity; bestH = Infinity;
      for (let k = 0; k < nbs.length; k++) {
        const nb = nbs[k]; const dd = dist[nb]; const hh = cells[nb].high;
        if (dd < bestD || (dd === bestD && hh < bestH)) { bestD = dd; bestH = hh; best = nb; }
      }
    }
    down[i] = best;
  });

  // Sort by elevation (top-down)
  const orderByElev = landIdxs.slice().sort((a,b) => cells[b].high - cells[a].high);

  // Precipitation-driven flux
  // Use global if available; otherwise fallback to cache or zeros
  const precipArray = precip ?? computePrecipArray();
  for (const i of orderByElev) flux[i] = Math.max(0, precipArray[i]);
  for (const i of orderByElev) { const j = down[i]; if (j !== -1) flux[j] += flux[i]; }

  // Helpers
  const valsAll = landIdxs.map(i => flux[i]).sort((a,b)=>a-b);
  const maxF = valsAll.length ? valsAll[valsAll.length-1] : 1;
  const up = Array.from({length: cells.length}, () => []);
  landIdxs.forEach(i => { const j = down[i]; if (j !== -1 && cells[j].high >= sea) up[j].push(i); });
  const countConfluences = (thr) => up.reduce((acc,arr,idx)=> acc + ((cells[idx].high>=sea && arr.filter(a=>flux[a]>=thr).length>=2)?1:0), 0);

  const curve = d3.curveCatmullRom.alpha(0.6);
  const pathOpen = d3.line().x(d=>d[0]).y(d=>d[1]).curve(curve);
  function lengthOf(pts){ let L=0; for (let i=1;i<pts.length;i++){ const dx=pts[i][0]-pts[i-1][0], dy=pts[i][1]-pts[i-1][1]; L+=Math.hypot(dx,dy);} return L; }

  // Polygonal river rendering based on Azgaar's technique
  function createPolygonalRiver(segments, flux, isMain) {
    const riverStyle = document.getElementById('riverStyle').value;
    if (riverStyle === 'lines') return false;
    
    const widening = +document.getElementById('riverWidthInput').value || 200;
    const maxWidth = isMain ? 4.2 : 2.2;
    
    segments.forEach(seg => {
      if (seg.length < 2) return;
      
      // Calculate total length manually
      let totalLength = 0;
      for (let i = 1; i < seg.length; i++) {
        const dx = seg[i][0] - seg[i-1][0];
        const dy = seg[i][1] - seg[i-1][1];
        totalLength += Math.hypot(dx, dy);
      }
      
      if (totalLength < 10) return; // Skip very short segments
      
      // Create polygonal path
      const path = [];
      for (let i = 0; i < seg.length; i++) {
        const pt = seg[i];
        const t = i / Math.max(1, seg.length - 1);
        const width = Math.min(maxWidth, 0.5 + t * widening / totalLength);
        
        if (i === 0) {
          // Start point
          const next = seg[i + 1];
          const dx = next[0] - pt[0];
          const dy = next[1] - pt[1];
          const len = Math.hypot(dx, dy);
          const nx = -dy / len;
          const ny = dx / len;
          path.push([pt[0] + nx * width, pt[1] + ny * width]);
          path.unshift([pt[0] - nx * width, pt[1] - ny * width]);
        } else if (i === seg.length - 1) {
          // End point
          const prev = seg[i - 1];
          const dx = pt[0] - prev[0];
          const dy = pt[1] - prev[1];
          const len = Math.hypot(dx, dy);
          const nx = -dy / len;
          const ny = dx / len;
          path.push([pt[0] + nx * width, pt[1] + ny * width]);
          path.unshift([pt[0] - nx * width, pt[1] - ny * width]);
        } else {
          // Middle point - smooth transition
          const prev = seg[i - 1];
          const next = seg[i + 1];
          const dx1 = pt[0] - prev[0];
          const dy1 = pt[1] - prev[1];
          const dx2 = next[0] - pt[0];
          const dy2 = next[1] - pt[1];
          
          const len1 = Math.hypot(dx1, dy1);
          const len2 = Math.hypot(dx2, dy2);
          
          const nx1 = -dy1 / len1;
          const ny1 = dx1 / len1;
          const nx2 = -dy2 / len2;
          const ny2 = dx2 / len2;
          
          // Average normals for smooth transition
          const nx = (nx1 + nx2) / 2;
          const ny = (ny1 + ny2) / 2;
          const normLen = Math.hypot(nx, ny);
          
          path.push([pt[0] + nx * width / normLen, pt[1] + ny * width / normLen]);
          path.unshift([pt[0] - nx * width / normLen, pt[1] - ny * width / normLen]);
        }
      }
      
      // Close the polygon
      path.push(path[0]);
      
      // Create the path element
      const pathData = d3.line()(path);
      riversG.append('path')
        .attr('d', pathData)
        .attr('fill', isMain ? '#4a90e2' : '#6baed6')
        .attr('stroke', 'none')
        .attr('opacity', 0.8);
    });
    
    return true;
  }

  // River threshold and rendering - use higher threshold for bigger rivers
  const thr = Math.max(maxF * 0.35, MIN_RIVER_FLUX); // 35% of max flux or minimum threshold
  const confluences = countConfluences(thr);
  const majors = landIdxs.filter(i => flux[i] >= thr).length;
  
  // Build river segments
  const segments = [];
  const visited = new Set();
  
  function chainFrom(s, stopSet) {
    const chain = [cells[s].poly[0]]; // Start with cell center
    let curr = s;
    const seen = new Set([s]);
    
    while (curr !== -1 && !stopSet.has(curr) && !visited.has(curr)) {
      visited.add(curr);
      const next = down[curr];
      if (next === -1 || stopSet.has(next) || seen.has(next)) break;
      seen.add(next);
      
      // Add midpoint between cells
      const midX = (cells[curr].cx + cells[next].cx) / 2;
      const midY = (cells[curr].cy + cells[next].cy) / 2;
      chain.push([midX, midY]);
      
      curr = next;
    }
    
    if (chain.length > MIN_RIVER_STEPS) {
      segments.push(chain);
    }
  }
  
  // Build major rivers (above threshold)
  landIdxs.filter(i => flux[i] >= thr).forEach(i => {
    if (!visited.has(i)) {
      chainFrom(i, new Set());
    }
  });
  
  // Render rivers
  if (segments.length > 0) {
    createPolygonalRiver(segments, flux, true);
    
    // Also render as lines for debugging
    segments.forEach(seg => {
      if (seg.length > 1) {
        riversG.append('path')
          .attr('d', pathOpen(seg))
          .attr('stroke', '#2c5aa0')
          .attr('stroke-width', '0.8px')
          .attr('fill', 'none');
      }
    });
  }
  
  // Store river statistics
  window.__state.riverStats = {
    majors: majors,
    confluences: confluences,
    majorsDrawn: segments.length,
    majorsReachedSea: segments.filter(seg => {
      const lastCell = visited.has(seg[seg.length - 1]) ? seg[seg.length - 1] : null;
      return lastCell && cells[lastCell].high < sea;
    }).length,
    avgMainLength: segments.length > 0 ? segments.reduce((sum, seg) => sum + lengthOf(seg), 0) / segments.length : 0
  };

  const dt = performance.now() - t0;
  console.log(`⏱ Compute rivers: ${dt.toFixed(1)} ms`);
}
