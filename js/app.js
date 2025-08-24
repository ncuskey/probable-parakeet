// js/app.js — module entry
// TODO: Clean up unused imports and fix init call
// Search anchors: ~1-33 (app.js entrypoint)

// legacy main side-effects (defines window.generate and sets up runtime wiring)
import './legacy-main.js';
import { wireUI } from './ui.js';
import { ProgressManager } from './ui-overlays.js';
import { state } from './state.js';
import { buildBaseMesh } from './terrain.js';
import { generateElevation } from './elevation.js';

// TODO: Step 2 - New orchestrator function for elevation generation
export async function generateWorld() {
  console.time('generateWorld');

  // 1) Base mesh (Step 1)
  const mesh = buildBaseMesh();

  // 2) Elevation + sea level (Step 2)
  const t0 = performance.now();
  const elev = generateElevation(mesh, state);
  const t1 = performance.now();
  const landCount = elev.isLand.reduce((a,b)=>a+b,0);
  const landFrac = (landCount / elev.isLand.length);
  console.log(`[elevation] seaLevel=${elev.seaLevel.toFixed(3)} landFrac=${(landFrac*100).toFixed(1)}% time=${(t1-t0).toFixed(1)}ms`);

  console.timeEnd('generateWorld');
  return { mesh, elev };
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
