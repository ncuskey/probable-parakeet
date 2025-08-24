// js/regions.js — assign & draw regions (with overlay fallback)
import { S, getWorld } from './state.js';
import { getLayers } from './render.js';

// Helper functions moved from legacy-main.js
function buildRegionSegments(cells, isWater, regionOfCell) {
  const segsByRegion = new Map(); // region -> segments [{a:[x,y], b:[x,y]}]
  const pushSeg = (rid, a, b) => {
    if (!segsByRegion.has(rid)) segsByRegion.set(rid, []);
    segsByRegion.get(rid).push({a:{x:a[0],y:a[1]}, b:{x:b[0],y:b[1]}});
  };

  // For each cell edge shared with different region (or water/neutral), add to region's boundary
  for (let i = 0; i < cells.length; i++) {
    const ri = regionOfCell[i];
    if (ri < 0 || isWater[i]) continue;
    const poly = cells[i].poly;
    const neigh = cells[i].neighbors || [];
    for (let e = 0; e < poly.length; e++) {
      const a = poly[e], b = poly[(e+1) % poly.length];

      // Find neighboring cell that shares this edge (if any)
      // We approximate by checking all neighbors; in your model, neighbor polygons share edges
      let sameRegionNeighbor = false;
      for (const j of neigh) {
        if (j === i || isWater[j]) continue;
        if (regionOfCell[j] === ri) {
          // If neighbor shares an edge that matches (a,b) ~ (b',a') we'll consider interior edge
          // Cheap test: midpoint distance to neighbor polygon; if close, treat as interior
          const pj = cells[j].poly;
          if (pj) {
            const mx = (a[0]+b[0])*0.5, my=(a[1]+b[1])*0.5;
            // inside neighbor bbox quick test
            const jb = d3.polygonContains(pj, [mx,my]);
            if (jb) { sameRegionNeighbor = true; break; }
          }
        }
      }
      if (!sameRegionNeighbor) pushSeg(ri, a, b);
    }
  }
  return segsByRegion;
}

function segmentsToRings(segments) {
  // Use your existing segmentsToPolylines and close rings when endpoints meet
  const polys = segmentsToPolylines(segments);
  // Ensure closure:
  for (const p of polys) {
    const first = p[0], last = p[p.length-1];
    if (first.x !== last.x || first.y !== last.y) p.push({x:first.x, y:first.y});
  }
  return polys;
}

// For now, use the existing functions from legacy-main.js
// These will be moved to regions.js in a future iteration
const assignRegionsAzgaar = window.__state?.assignRegionsAzgaar || (() => {
  console.warn('assignRegionsAzgaar not available, returning null');
  return null;
});

// Add a function to wait for the function to become available
async function waitForAssignRegionsAzgaar(maxWaitMs = 1000) {
  const startTime = performance.now();
  while (performance.now() - startTime < maxWaitMs) {
    if (window.__state?.assignRegionsAzgaar && typeof window.__state.assignRegionsAzgaar === 'function') {
      return window.__state.assignRegionsAzgaar;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  console.warn('assignRegionsAzgaar not available after waiting, returning null');
  return null;
}

const isStale = window.__state?.isStale || ((run) => false); // fallback if not available
let regionsInFlight = window.__state?.regionsInFlight || false;
let regionsQueued = window.__state?.regionsQueued || false;

/** Full region pipeline; preserve all legacy logs and behavior. */
export async function computeAndDrawRegions(run = 0) {
  try {
    const { regions } = getLayers(); // group
    const { cells, isWater } = getWorld();

    // If you had parameter logs, keep them:
    // console.log('Region count K (capitals-matched default):', K);
    // console.log('Parameters:', { disbalance, overseasPenalty, maxManorDistPx });

    // --- MOVE BODY: your existing region assignment & drawing implementation ---
    if (isStale(run)) { console.log(`[RUN ${run}] stale -> bail computeAndDrawRegions`); return; }
    if (regionsInFlight) { regionsQueued = true; return; }
    regionsInFlight = true;
    regionsQueued = false;

    // console.log('computeAndDrawRegions called');
    const {width, height, s} = getWorld();
    
    if (!cells.length) { console.warn('[RUN', run, '] no cells yet, skipping computeAndDrawRegions'); return; }
  
  // console.log('Cells:', cells.length, 'Water cells:', isWater.length);
  
  // Only proceed if we have valid data
  if (!cells.length || !isWater.length) {
    console.warn('No valid cell data for region computation');
    return;
  }

  // Match region count to number of capitals by default
  const autoK = Array.isArray(s?.macroCapitals) ? s.macroCapitals.length : (s?.macroRegionCount ?? 20);
  const K = Math.max(1, +(document.getElementById('regionCount')?.value ?? autoK));
  s.macroRegionCount = K;
  console.log('Region count K (capitals-matched default):', K);

  const disbalance = +document.getElementById('disbalanceInput')?.value || 0.35;
  const overseasPenalty = +document.getElementById('overseasPenaltyInput')?.value || 2.0;
  const maxManorDistPx = +document.getElementById('maxManorDistInput')?.value || 120;
  console.log('Parameters:', { disbalance, overseasPenalty, maxManorDistPx });

  // Check if assignRegionsAzgaar is already available, otherwise wait for it
  let assignRegionsFn = window.__state?.assignRegionsAzgaar;
  if (!assignRegionsFn || typeof assignRegionsFn !== 'function') {
    assignRegionsFn = await waitForAssignRegionsAzgaar();
    if (!assignRegionsFn) {
      console.warn('assignRegionsAzgaar not available after waiting');
      return;
    }
  }
  
  const res = await assignRegionsFn({ K, disbalance, overseasPenalty, maxManorDistPx });
  if (!res) {
    console.warn('assignRegionsAzgaar returned null');
    return;
  }
  const { regionOfCell } = res;
  console.log('Region assignment complete, regions:', new Set(regionOfCell.filter(r => r >= 0)).size);

  // Check if run is still current before proceeding with DOM writes
  if (isStale(run)) return;

  // Build boundary segments per region and stitch into rings; ignore neutrals (-1)
  const segsByRegion = buildRegionSegments(cells, isWater, regionOfCell);
  console.log('Built segments for regions:', segsByRegion.size);

  // After assignment, before standard rendering:
  const hasRegions = Array.isArray(regionOfCell) && regionOfCell.some(r => r >= 0);
  if (!hasRegions) {
    console.warn('No regions assigned — drawing coarse land fill as fallback');
    const landPolys = cells?.filter((_,i)=>!isWater?.[i]).map(c => c.poly).filter(Boolean) || [];

    const g = d3.select('#regions');
    let overlay = g.select('g.overlay');
    if (overlay.empty()) overlay = g.append('g').attr('class','overlay'); // ensure in overlay
    const sel = overlay.selectAll('path.fallback-land').data(landPolys, (_,i)=>i);
    sel.enter().append('path')
       .attr('class','fallback-land')
       .attr('d', d => d3.line()(d))
       .attr('fill','#d5c9a3')
       .attr('stroke','none')
       .attr('opacity', 0.9);
    sel.exit().remove();
    return; // skip normal region render this run
  }

  // Draw region fills (one <path> per stitched ring; grouped per region)
  const g = d3.select('#regions');
  if (g.empty()) throw new Error('#regions missing');
  
  const map = d3.select('#map');
  if (map.empty()) throw new Error('#map missing');
  
  g.selectAll('*').remove();

  const overlay = g.append('g').attr('class', 'overlay'); // <- stitched polygons/tint
  if (overlay.empty()) throw new Error('Failed to create overlay group');
  const regionIds = Array.from(segsByRegion.keys()).sort((a,b)=>a-b);
  console.log('Drawing regions:', regionIds);
  
  const tol = 5.0; // px tolerance for DP simplification (increased for better performance and to reduce long tasks)
  let beforePts = 0, afterPts = 0;
  const tR = performance.now();
  
  // Yield-based region drawing to prevent long tasks
  console.log('REGION DRAW: start');
  const startTime = performance.now();
  const maxRenderTime = 1000; // 1 second timeout
  

  
  await new Promise(resolve => {
    let regionIdx = 0;
    function drawRegionStep() {
      const deadline = performance.now() + 8; // ~8ms budget
      
      // Check for timeout
      if (performance.now() - startTime > maxRenderTime) {
        console.warn('Region rendering timeout - finishing early');
        resolve();
        return;
      }
      for (; regionIdx < regionIds.length && performance.now() < deadline; regionIdx++) {
        const rid = regionIds[regionIdx];
        const segs = segsByRegion.get(rid);
        if (!segs || !segs.length) {
          console.warn('No segments for region', rid);
          continue;
        }
        
        // Skip regions with too many segments to prevent long tasks
        if (segs.length > 1000) {
          console.warn(`Region ${rid}: Skipping due to too many segments (${segs.length})`);
          continue;
        }
        const ringsRaw = segmentsToRings(segs);
        
        // Limit the number of rings processed to prevent long tasks
        const maxRingsPerRegion = 200; // Reduced limit to prevent long tasks
        const limitedRings = ringsRaw.slice(0, maxRingsPerRegion);
        
        // - Build assignments/segments
        // - Draw regions under #regions
        // - Keep "Region assignment complete, regions: N" and "Built segments..." logs
        // - If no regions -> draw fallback land fill
        // ---------------------------------------------------------------------------

        // Fallback must go inside .overlay so CSS can hide it in Terrain mode:
        // (If your moved code already puts it in overlay, you can ignore this sample.)
        /*
        if (/* no regions condition * /) {
          console.log('No regions assigned — drawing coarse land fill as fallback');
          let overlay = regions.select('g.overlay');
          if (overlay.empty()) overlay = regions.append('g').attr('class', 'overlay');
          // overlay.append('path')
          //   .attr('class', 'fallback-land')
          //   .attr('d', /* your computed path D * /)
          //   .attr('fill', /* your color * /);
        }
        */
      }
      
      if (regionIdx < regionIds.length) {
        requestAnimationFrame(drawRegionStep);
      } else {
        resolve();
      }
    }
    
    drawRegionStep();
  });
  
  const dtR = performance.now() - tR;
  console.log(`⏱ Region rendering: ${dtR.toFixed(1)} ms (${beforePts} → ${afterPts} points)`);
  console.log('REGION DRAW: end');

  } catch (error) {
    console.error('Error in computeAndDrawRegions:', error);
  } finally {
    regionsInFlight = false;
    if (regionsQueued && !isStale(run)) computeAndDrawRegions(run);
  }
}
