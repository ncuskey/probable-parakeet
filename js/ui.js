// js/ui.js — central DOM event wiring
import { setViewMode } from './render.js';
import { recolor } from './recolor.js';
import { applyTemplate } from './terrain.js';
import { S, setSeed, setParam, getParam, state } from './state.js';
import { toggleSettings } from './ui-overlays.js';
import { regenerateNames } from './legacy-main.js';

// NEW: Azgaar-Lite helpers
function randomSeedHex(nBytes = 8) {
  if (window.crypto?.getRandomValues) {
    const buf = new Uint8Array(nBytes);
    window.crypto.getRandomValues(buf);
    return Array.from(buf).map(b => b.toString(16).padStart(2,'0')).join('');
  }
  // fallback
  return Array.from({length:nBytes}, () => ((Math.random()*256)|0).toString(16).padStart(2,'0')).join('');
}

export function initAzLiteControls() {
  const seedInput     = document.getElementById('seedInput');
  const seedRerollBtn = document.getElementById('seedRerollBtn');
  const seaModeSelect = document.getElementById('seaModeSelect');
  const seaFixedInput = document.getElementById('seaFixedInput');
  const seaPctInput   = document.getElementById('seaPctInput');
  const seaFixedWrap  = document.getElementById('seaFixedWrap');
  const seaPctWrap    = document.getElementById('seaPctWrap');
  const secondBlobChk = document.getElementById('secondBlobChk');

  if (!seedInput) return; // controls not on this page

  // init from state
  seedInput.value = state.rngSeed ?? 'azlite-001';
  seaModeSelect.value = state.seaLevelMode ?? 'fixed';
  seaFixedInput.value = (state.seaLevel ?? 0.2).toString();
  seaPctInput.value   = (state.seaPercentile ?? 0.35).toString();
  secondBlobChk.checked = !!state.secondBlobEnabled;

  function toggleSeaWraps() {
    const fixed = seaModeSelect.value === 'fixed';
    seaFixedWrap.style.display = fixed ? '' : 'none';
    seaPctWrap.style.display   = fixed ? 'none' : '';
  }
  toggleSeaWraps();

  // events
  seedInput.addEventListener('change', () => { 
    state.rngSeed = seedInput.value.trim() || state.rngSeed; 
    try { 
      const generate = window.generate;
      if (typeof generate === 'function') {
        generate(); 
      }
    } catch (e) { 
      console.warn('[ui] generate failed', e); 
    }
  });
  
  seedRerollBtn.addEventListener('click', () => {
    state.rngSeed = `azlite-${randomSeedHex(6)}`;
    seedInput.value = state.rngSeed;
    try { 
      const generate = window.generate;
      if (typeof generate === 'function') {
        generate(); 
      }
    } catch (e) { 
      console.warn('[ui] generate failed', e); 
    }
  });

  seaModeSelect.addEventListener('change', () => {
    state.seaLevelMode = seaModeSelect.value;
    toggleSeaWraps();
    try { 
      const generate = window.generate;
      if (typeof generate === 'function') {
        generate(); 
      }
    } catch (e) { 
      console.warn('[ui] generate failed', e); 
    }
  });

  seaFixedInput.addEventListener('change', () => {
    let v = parseFloat(seaFixedInput.value);
    if (Number.isFinite(v)) state.seaLevel = Math.min(1, Math.max(0, v));
    try { 
      const generate = window.generate;
      if (typeof generate === 'function') {
        generate(); 
      }
    } catch (e) { 
      console.warn('[ui] generate failed', e); 
    }
  });

  seaPctInput.addEventListener('change', () => {
    let v = parseFloat(seaPctInput.value);
    if (Number.isFinite(v)) state.seaPercentile = Math.min(1, Math.max(0, v));
    try { 
      const generate = window.generate;
      if (typeof generate === 'function') {
        generate(); 
      }
    } catch (e) { 
      console.warn('[ui] generate failed', e); 
    }
  });

  secondBlobChk.addEventListener('change', () => {
    state.secondBlobEnabled = secondBlobChk.checked;
    try { 
      const generate = window.generate;
      if (typeof generate === 'function') {
        generate(); 
      }
    } catch (e) { 
      console.warn('[ui] generate failed', e); 
    }
  });
}

/** Helper: bind an event if the element exists. Returns the element or null. */
function bind(id, evt, handler, options) {
  const el = document.getElementById(id);
  if (!el) return null;
  el.addEventListener(evt, handler, options);
  return el;
}

/** Helper: numeric value from input (fallback to previous). */
function readNumber(el, fallback) {
  const v = parseFloat(el?.value);
  return Number.isFinite(v) ? v : fallback;
}

/** Optional: read current UI and push into state (used at init). */
export function readUIParams() {
  const seedEl = document.getElementById('seedInput');
  if (seedEl) setSeed(readNumber(seedEl, S.seed));

  const seaEl = document.getElementById('seaLevelInput');
  if (seaEl) setParam('seaLevel', readNumber(seaEl, getParam('seaLevel') ?? 0.5));

  const wt = (document.getElementById('worldType')?.value) || getParam('worldType') || 'continents';
  setParam('worldType', wt);

  const K = readNumber(document.getElementById('regionCount'), getParam('regionCountK') ?? 3);
  setParam('regionCountK', K);
}

/** Wire all UI controls (safe: missing elements/functions → no-op). */
export function wireUI() {
  // NEW: Initialize Azgaar-Lite controls
  try { initAzLiteControls(); } catch (e) { console.warn('[ui] initAzLiteControls failed', e); }

  // Buttons
  bind('generateBtn', 'click', async () => {
    try { 
      const generate = window.generate;
      if (typeof generate === 'function') {
        await generate(); 
      } else {
        console.warn('[ui] generate function not available');
      }
    } catch (e) { 
      console.warn('[ui] generate failed', e); 
    }
  });

  bind('viewToggleBtn', 'click', () => {
    const next = document.body.classList.contains('view-mode-terrain') ? 'regions' : 'terrain';
    setViewMode(next);
  });

  bind('settingsBtn', 'click', () => {
    try { toggleSettings(); } catch (e) { console.warn('[ui] toggleSettings failed', e); }
  });

  // Seed input
  const seedEl = bind('seedInput', 'change', (e) => {
    const v = readNumber(e.currentTarget, S.seed);
    setSeed(v);
    // Seed change typically implies regeneration, not just recolor
    // If your legacy behavior was immediate recolor only, replace with recolor(0)
  });
  // (Enter key triggers generate)
  if (seedEl) seedEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') document.getElementById('generateBtn')?.click();
  });

  // Sea level slider/input → recolor only
  bind('seaLevelInput', 'input', (e) => {
    const v = readNumber(e.currentTarget, getParam('seaLevel') ?? 0.5);
    setParam('seaLevel', v);
    try { recolor(0); } catch (err) { console.warn('[ui] recolor on sea level change failed', err); }
  });

  // World type select
  bind('worldType', 'change', (e) => {
    const v = e.currentTarget?.value || 'continents';
    setParam('worldType', v);
    // Do not auto-generate to avoid heavy work on accidental change.
    // User can press Generate; if legacy auto-generated, call generate() here instead.
  });

  // Regions controls
  bind('applyRegionCountBtn', 'click', () => {
    const K = readNumber(document.getElementById('regionCount'), getParam('regionCountK') ?? 3);
    setParam('regionCountK', K);
    // Re-running the region stage alone is app-specific; safest to ask user to Generate again.
    // If legacy called computeAndDrawRegions inline, you could import and call it here.
  });

  // Regenerate names (legacy helper, if still present)
  bind('regenNamesBtn', 'click', () => {
    try { regenerateNames?.(); } catch (e) { console.warn('[ui] regenerateNames failed', e); }
  });

  // NEW: Random map button for Azgaar-Lite
  bind('randomMapBtn', 'click', async () => {
    try { 
      // Switch to Azgaar-Lite mode with random hills
      state.terrainMode = 'azgaar-lite';
      state.randomSmallHills = 11; // like the fiddle's "Random map"
      
      const generate = window.generate;
      if (typeof generate === 'function') {
        await generate(); 
      } else {
        console.warn('[ui] generate function not available');
      }
    } catch (e) { 
      console.warn('[ui] random map failed', e); 
    }
  });

  // Export buttons - handle based on text content since we removed onclick attributes
  document.querySelectorAll('button').forEach(btn => {
    const text = btn.textContent.toLowerCase();
    if (text.includes('export svg')) {
      btn.addEventListener('click', () => {
        try { 
          const saveSVG = window.saveSVG;
          if (typeof saveSVG === 'function') saveSVG(document.querySelector('svg'), 'voronoi_map.svg');
        } catch (e) { console.warn('[ui] saveSVG failed', e); }
      });
    } else if (text.includes('export png')) {
      btn.addEventListener('click', () => {
        try { 
          const savePNG = window.savePNG;
          if (typeof savePNG === 'function') savePNG(document.querySelector('svg'), 1280, 560, 'voronoi_map.png');
        } catch (e) { console.warn('[ui] savePNG failed', e); }
      });
    }
  });

  // Close button
  const closeBtn = document.querySelector('.close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      try { toggleSettings(); } catch (e) { console.warn('[ui] toggleSettings failed', e); }
    });
  }

  // Tab buttons - handle based on text content since we removed onclick attributes
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const text = btn.textContent.toLowerCase();
    let tabName = null;
    if (text.includes('terrain')) tabName = 'terrain';
    else if (text.includes('climate')) tabName = 'climate';
    else if (text.includes('settlements')) tabName = 'settlements';
    else if (text.includes('routes')) tabName = 'routes';
    
    if (tabName) {
      btn.addEventListener('click', () => {
        try { 
          const showTab = window.showTab;
          if (typeof showTab === 'function') showTab(tabName);
        } catch (e) { console.warn('[ui] showTab failed', e); }
      });
    }
  });

  // Range inputs with output updates
  const rangeInputs = [
    'sizeInput', 'highInput', 'radiusInput', 'sharpnessInput', 'smallCountInput',
    'seaLevelInput', 'borderPctInput', 'minLakeSizeInput', 'minLakeDepthInput',
    'talusInput', 'thermalStrengthInput', 'smoothAlphaInput', 'riverWidthInput',
    'rainInput', 'riverDensityInput', 'baseTempInput', 'precipScaleInput'
  ];
  
  rangeInputs.forEach(inputId => {
    const input = document.getElementById(inputId);
    const output = document.getElementById(inputId.replace('Input', 'Output'));
    if (input && output) {
      input.addEventListener('input', () => {
        output.value = input.valueAsNumber;
        
        // Handle special cases that trigger recolor
        if (['borderPctInput', 'minLakeSizeInput', 'minLakeDepthInput', 'talusInput', 
             'thermalStrengthInput', 'smoothAlphaInput', 'riverWidthInput', 'rainInput', 
             'baseTempInput', 'precipScaleInput'].includes(inputId)) {
          const applyBorder = window.__state?.applyBorder;
          if (applyBorder && inputId === 'borderPctInput') {
            applyBorder();
          }
          const recolorFn = window.recolorCurrent;
          if (typeof recolorFn === 'function') {
            recolorFn();
          }
        }
      });
    }
  });

  // Select inputs
  const selectInputs = [
    { id: 'worldType', action: 'generate' },
    { id: 'riverStyle', action: 'recolor' },
    { id: 'windBelts', action: 'recolor' },
    { id: 'renderMode', action: 'recolor' },
    { id: 'shadingMode', action: 'recolor' }
  ];
  
  selectInputs.forEach(({ id, action }) => {
    const select = document.getElementById(id);
    if (select) {
      select.addEventListener('change', () => {
        if (action === 'generate') {
          const generate = window.generate;
          if (typeof generate === 'function') generate();
        } else if (action === 'recolor') {
          const recolorFn = window.recolorCurrent;
          if (typeof recolorFn === 'function') recolorFn();
        }
      });
    }
  });

  // Checkbox inputs
  const debugInput = document.getElementById('debugOpsInput');
  if (debugInput) {
    debugInput.addEventListener('change', () => {
      const generate = window.generate;
      if (typeof generate === 'function') generate();
    });
  }

  // Apply region count button (different ID than expected)
  bind('applyRegionCount', 'click', () => {
    const K = readNumber(document.getElementById('regionCount'), getParam('regionCountK') ?? 3);
    setParam('regionCountK', K);
    // Re-running the region stage alone is app-specific; safest to ask user to Generate again.
    // If legacy called computeAndDrawRegions inline, you could import and call it here.
  });

  // Close modal with Escape key
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
      const modal = document.getElementById('settingsModal');
      if (modal && modal.style.display === 'block') {
        modal.style.display = 'none';
      }
    }
  });

  // Close modal when clicking outside of it
  window.onclick = function(event) {
    const modal = document.getElementById('settingsModal');
    if (event.target === modal) {
      modal.style.display = 'none';
    }
  };

  // First-time sync from UI → state
  readUIParams();
}
