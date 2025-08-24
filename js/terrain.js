// js/terrain.js — terrain templates + executor (function-based + steps-based)
import { S, getWorld, resetCaches } from './state.js';
import { mulberry32, rngFromSeed, clamp, randRange, choice } from './utils.js';

// ---------------- Templates registry ----------------
/** Internal mutable registry; don't export directly. */
const Templates = Object.create(null);

/** Accessors */
export function getTemplates() { return Templates; }
export function setTemplates(obj) {
  // Shallow assign; caller ensures shape { name: fn | {name, steps:[...]}, ... }
  for (const k of Object.keys(obj || {})) Templates[k] = obj[k];
}

/** Default templates (MOVE your existing function-based ones here) */
function volcanicIsland(ui = {}) {
  const { cells, width, height } = getWorld();
  console.log('volcanicIsland template called with:', { cellsLength: cells?.length, width, height, ui });
  if (!cells?.length) return;
  const cx = width * 0.5, cy = height * 0.5;
  const borderPct = Math.max(0, Math.min(40, +(ui?.borderPct ?? 8))); // 0..40%
  const R = (Math.min(width, height) * 0.5) * (1 - borderPct/100);
  const falloff = 1.6; // steeper = tighter island

  // Deterministic RNG from seed input if present
  const seed = S.seed;
  const rng = mulberry32(seed);
  const jitter = () => (rng() - 0.5) * 0.18; // +/- ~0.09

  // Base radial bump
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const dx = c.cx - cx, dy = c.cy - cy;
    const d = Math.hypot(dx, dy);
    let t = 1 - Math.pow(d / Math.max(1, R), falloff);
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    c.high = Math.max(0, Math.min(1, t + jitter()*t));
  }

  // Two light smoothing passes to remove speckle
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const nn = c.neighbors || [];
      if (!nn.length) continue;
      let acc = c.high, n = 1;
      for (const j of nn) { acc += cells[j].high; n++; }
      c.high = acc / n;
    }
  }
  
  // Debug: Check what heights were set
  const maxHeight = Math.max(...cells.map(c => c.high));
  const minHeight = Math.min(...cells.map(c => c.high));
  console.log('volcanicIsland heights set:', { minHeight, maxHeight, cellCount: cells.length });
}

function archipelago(ui = {}) {
  const { cells, width, height } = getWorld();
  if (!cells?.length) return;
  const count = Math.max(3, Math.min(30, +(ui?.smallCount ?? 8)));
  const seed = S.seed;
  const rng = mulberry32(seed);

  // reset
  for (const c of cells) c.high = 0;

  function pickInterior() {
    const margin = Math.min(width, height) * 0.08;
    // pick until interior
    for (let tries = 0; tries < 1000; tries++) {
      const idx = Math.floor(rng() * cells.length);
      const c = cells[idx];
      if (c.cx > margin && c.cy > margin && c.cx < width - margin && c.cy < height - margin) return idx;
    }
    return Math.floor(rng()*cells.length);
  }

  // paint bumps
  for (let k = 0; k < count; k++) {
    const idx = pickInterior();
    const radius = (Math.min(width, height) * 0.08) * (0.6 + rng()*0.8);
    const fall = 2.2;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const d = Math.hypot(c.cx - cells[idx].cx, c.cy - cells[idx].cy);
      let t = 1 - Math.pow(d / Math.max(1, radius), fall);
      if (t < 0) t = 0;
      c.high = Math.max(c.high, t);
    }
  }

  // smooth a bit
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const nn = c.neighbors || [];
      if (!nn.length) continue;
      let acc = c.high, n = 1;
      for (const j of nn) { acc += cells[j].high; n++; }
      c.high = acc / n;
    }
  }
}

function continents(ui = {}) {
  const { cells, width, height } = getWorld();
  if (!cells?.length) return;
  const seed = S.seed;
  const rng = mulberry32(seed);
  const bandDir = rng() < 0.5 ? 'x' : 'y';

  // base gradient
  for (const c of cells) {
    const t = bandDir === 'x' ? (c.cx / Math.max(1, width)) : (c.cy / Math.max(1, height));
    c.high = Math.max(0, Math.min(1, 0.8 * Math.abs(0.5 - t) * 2)); // low in middle, high at sides
  }
  // pepper with small bumps
  for (let k = 0; k < 200; k++) {
    const idx = Math.floor(rng() * cells.length);
    const r = 12 + rng()*40;
    for (let i = 0; i < cells.length; i++) {
      const a = cells[i], b = cells[idx];
      const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      a.high = Math.min(1, a.high + Math.max(0, 1 - d/r) * 0.12);
    }
  }
  // smooth
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const nn = c.neighbors || [];
      if (!nn.length) continue;
      let acc = c.high, n = 1;
      for (const j of nn) { acc += cells[j].high; n++; }
      c.high = acc / n;
    }
  }
}

/** Register defaults (or keep only if not already defined). */
export function registerDefaultTemplates() {
  // Get the existing config system and ensure it exists
  if (!window.__state) window.__state = {};
  if (!window.__state.config) window.__state.config = {};
  if (!window.__state.config.templates) window.__state.config.templates = {};
  
  const cfg = window.__state.config.templates;
  if (!cfg.default) cfg.default = (x) => x;
  cfg.volcanicIsland = cfg.volcanicIsland || volcanicIsland;
  cfg.archipelago = cfg.archipelago || archipelago;
  cfg.continents = cfg.continents || continents;
  
  // Also register in our internal registry for the new API
  if (!Templates.default) Templates.default = (x) => x;
  Templates.volcanicIsland = Templates.volcanicIsland || volcanicIsland;
  Templates.archipelago = Templates.archipelago || archipelago;
  Templates.continents = Templates.continents || continents;
}

// ---------------- Height clear ----------------
export function ensureHeightsCleared() {
  const { cells } = getWorld();
  if (!cells?.length) return;
  for (const c of cells) c.high = 0;
}

// ---------------- Steps-based executor ----------------
/**
 * Execute an array of step objects like:
 * { op:'mountain', at:'center', high:0.9, radius:0.94, sharpness:0.18 }
 * { op:'add', value:0.07 }
 * { op:'multiply', factor:1.1 }
 * { op:'hills', count:5, distribution:0.4, high:0.25, radius:0.985, ... }
 */
function executeSteps(steps = [], uiVals = {}) {
  const { cells, width, height } = getWorld();
  const rng = mulberry32(S.seed);

  const ops = {
    mountain: (st) => {
      const cx = st.at === 'center' ? width * 0.5 : (st.x ?? width * 0.5);
      const cy = st.at === 'center' ? height * 0.5 : (st.y ?? height * 0.5);
      const H = +st.high ?? 0.8;
      const R = Math.max(4, (Math.min(width, height) * (+st.radius ?? 0.9)));
      const sharp = clamp(+st.sharpness ?? 0.2, 0.01, 4);
      for (const c of cells) {
        const d = Math.hypot(c.cx - cx, c.cy - cy);
        let t = 1 - Math.pow(d / Math.max(1, R), 1 + sharp);
        t = clamp(t, 0, 1);
        c.high = Math.max(c.high ?? 0, H * t);
      }
    },

    add: (st) => {
      const v = +st.value ?? 0;
      for (const c of cells) c.high = clamp((c.high ?? 0) + v, 0, 1);
    },

    multiply: (st) => {
      const k = +st.factor ?? 1;
      for (const c of cells) c.high = clamp((c.high ?? 0) * k, 0, 1);
    },

    hills: (st) => {
      const cnt = Math.max(1, (st.count ?? 5) | 0);
      const dist = clamp(+st.distribution ?? 0.4, 0.05, 2);
      const H = clamp(+st.high ?? 0.25, 0, 1);
      const rScale = clamp(+st.radius ?? 0.98, 0.05, 2);
      for (let k = 0; k < cnt; k++) {
        const idx = (rng() * cells.length) | 0;
        const bx = cells[idx].cx, by = cells[idx].cy;
        const R = (Math.min(width, height) * rScale) * (0.25 + rng() * dist);
        for (const c of cells) {
          const d = Math.hypot(c.cx - bx, c.cy - by);
          const t = Math.max(0, 1 - d / Math.max(1, R));
          c.high = clamp(Math.max(c.high ?? 0, H * t), 0, 1);
        }
      }
    }
  };

  // Back-compat aliases
  ops.addLand = ops.add;
  ops.multiplyLand = ops.multiply;

  for (const st of steps) {
    const fn = ops[st.op];
    if (!fn) { console.warn('[terrain] unknown op', st.op); continue; }
    console.log('Executing step:', st);
    fn(st);
  }
}

// ---------------- Template application ----------------
/**
 * Apply the template indicated by tplKey.
 * Supports function-based templates (fn(uiVals)) and steps-based ({steps:[...]}).
 * Returns summary info for logging.
 */
export function applyTemplate(tplKey, uiVals = {}) {
  registerDefaultTemplates();

  // Try both the new internal registry and the legacy config system
  const tpl = Templates[tplKey] ?? window.__state?.config?.templates?.[tplKey] ?? Templates.default;
  const type = (typeof tpl === 'function') ? 'function' : 'object';

  console.log('Applying template:', tplKey, 'Template found:', !!tpl, 'Type:', type, 'Value:', tpl);

  if (typeof tpl === 'function') {
    tpl(uiVals);
    resetCaches('isWater'); // heights changed → water mask invalid
    return { applied: true, type };
  }
  if (tpl && Array.isArray(tpl.steps)) {
    executeSteps(tpl.steps, uiVals);
    resetCaches('isWater');
    console.log('Template steps executed successfully:', tplKey);
    return { applied: true, type, stepsCount: tpl.steps.length };
  }

  console.warn('[terrain] Unknown template shape for', tplKey);
  return { applied: false, type: 'unknown' };
}


