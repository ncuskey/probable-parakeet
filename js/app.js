// js/app.js — module entry
// TODO: Clean up unused imports and fix init call
// Search anchors: ~1-33 (app.js entrypoint)

// legacy main side-effects (defines window.generate and sets up runtime wiring)
import './legacy-main.js';
import { wireUI } from './ui.js';
import { ProgressManager } from './ui-overlays.js';
import { state } from './state.js';
import { buildBaseMesh, bindMeshAsWorld } from './terrain.js';
import { generateElevation } from './elevation.js';
import { classifyWater, computeCoastAndDistance, computeShallow } from './water.js';
import { coastPolylines, smoothClosedChaikin } from './coast.js';
import { ensureSvgScene, updateOceanMaskWithIslands, drawCoastlines, drawShallowCells } from './render/svg.js';
import { computeLandBBox, fitTransformWithMargin, applySvgGroupTransform } from './viewport.js';
import { ensureSeedZoneOverlay } from './sampling.js';

// NEW: Azgaar-Lite imports
import { generateAzgaarLite } from './generators/azgaar-lite.js';
import { renderAzgaarLite } from './render/azgaar-lite-svg.js';

// TODO: Step 2.5 - New orchestrator function with water classification
export async function generateWorld() {
  console.time('generateWorld');

  // NEW: Azgaar-Lite baseline generator switch
  if (state.terrainMode === 'azgaar-lite') {
    const svg = document.querySelector('svg'); // or #map
    const world = generateAzgaarLite();
    renderAzgaarLite(svg, world);
    console.timeEnd('generateWorld');
    return world;
  }

  // else: call your existing pipeline (unchanged)
  // 1) Base mesh (Step 1)
  const mesh = buildBaseMesh();
  
  // Bridge new mesh to old WORLD structure for terrain functions
  bindMeshAsWorld(mesh);

  // 2) Elevation + sea level (Step 2)
  const t0 = performance.now();
  const elev = generateElevation(mesh, state);
  const t1 = performance.now();
  const landCount = elev.isLand.reduce((a,b)=>a+b,0);
  const landFrac = (landCount / elev.isLand.length);
  console.log(`[elevation] seaLevel=${elev.seaLevel.toFixed(3)} landFrac=${(landFrac*100).toFixed(1)}% time=${(t1-t0).toFixed(1)}ms`);

  // 2.5) FMG-style oceans & coasts (border flood)
  const t2 = performance.now();
  const water = classifyWater(mesh, elev.height, elev.seaLevel);
  const coast = computeCoastAndDistance(mesh, elev.isLand, water.isOcean);

  // override Step-2 coast/dist to the new ocean-aware values
  elev.isCoast = coast.isCoast;
  elev.distToCoast = coast.distToCoast;

  const oceanCount = water.isOcean.reduce((a, b) => a + b, 0);
  const lakeCount  = water.isLake.reduce((a, b) => a + b, 0);
  const coastCount = coast.isCoast.reduce((a,b)=>a+b,0);

  console.log(
    `[water] land=${landCount} ocean=${oceanCount} lakes=${lakeCount} coast=${coastCount} time=${(performance.now()-t2).toFixed(1)}ms`
  );

  // Shallow ring
  const shallow = computeShallow(mesh, elev.isLand, water.isOcean);

  // 2.7) FIT-TO-CANVAS transform
  let view = { s: 1, tx: 0, ty: 0, src: { x: 0, y: 0, width: mesh.width, height: mesh.height } };
  if (state.fitMode === 'fitLand') {
    const landBox = computeLandBBox(mesh, elev.isLand);
    view = fitTransformWithMargin(landBox, state.width, state.height, {
      marginPx: state.fitMarginPx ?? 24,
      allowUpscale: state.allowUpscale ?? false
    });
  }
  state.viewTransform = view; // stash for renderers/tools

  console.log(
    `[fit] rect=(${view.src.x.toFixed(1)},${view.src.y.toFixed(1)} ${view.src.width.toFixed(1)}×${view.src.height.toFixed(1)})` +
    ` -> s=${view.s.toFixed(3)} tx=${view.tx.toFixed(1)} ty=${view.ty.toFixed(1)}`
  );

  // 3) Coast polylines (land↔ocean), smoothed
  const t3 = performance.now();
  let loops = coastPolylines(mesh, elev.isLand, water.isOcean, { snapDigits: state.coastSnapDigits });
  loops = loops.map(loop => smoothClosedChaikin(loop, state.coastSmoothIters, 0.25));
  const t4 = performance.now();
  console.log(`[coast] ${loops.length} loops smoothed time=${(t4-t3).toFixed(1)}ms`);

  // 4) Render ocean mask + shallow + coasts
  const { svg, mask, world, coastG, shallowG } = ensureSvgScene({ svgId: 'map' });
  updateOceanMaskWithIslands(loops, svg);
  if (state.drawShallow) drawShallowCells(mesh, shallow, shallowG);
  if (state.drawCoastlines) drawCoastlines(loops, coastG, { smoothIters: state.coastSmoothIters });

  // Apply the saved world transform (from Step 2.7) so land fits in canvas
  if (state.viewTransform) applySvgGroupTransform(world, state.viewTransform);

  // Optional: visualize seed zones for debugging
  ensureSeedZoneOverlay(svg, mesh);

  console.timeEnd('generateWorld');
  return { mesh, elev, water, shallow, loops, view };
}


window.addEventListener('DOMContentLoaded', () => {
  // Future: we'll route UI wiring here as modules split out.
  
  // Initialize progress manager
  ProgressManager.init();
  
  // Bind UI first so any init-time UI reads are consistent
  wireUI();
  
  // Kick off an initial generation if available from legacy module
  if (typeof window.generate === 'function') {
    try { window.generate(); } catch (e) { console.warn('[app] initial generate failed:', e); }
  }
  
  // Register service worker for offline functionality
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(registration => {
        // console.log('ServiceWorker registration successful');
      })
      .catch(err => {
        // console.log('ServiceWorker registration failed: ', err);
      });
  }
  
  // Self-test harness (opt-in via ?selftest=1)
  if (new URL(location.href).searchParams.get('selftest') === '1') {
    import('./selftest.js');
  }
});
