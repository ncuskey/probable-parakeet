// js/terrain.js — terrain templates + executor (function-based + steps-based)
import { S, getWorld, resetCaches } from './state.js';
import { mulberry32, rngFromSeed, clamp, randRange, choice } from './utils.js';

// --- RNG helper (we already use mulberry32(S.seed) elsewhere) ---
function getRng() {
  return mulberry32(S.seed);
}

// Pick an interior cell (keeps seeds off borders)
function interiorCellIndex(minEdgePx = Math.min(getWorld().width, getWorld().height) * 0.06) {
  const { cells, width, height } = getWorld();
  const rng = getRng();
  for (let t = 0; t < 200; t++) {
    const i = (rng() * cells.length) | 0;
    const c = cells[i];
    const d = Math.min(c.cx, c.cy, width - c.cx, height - c.cy);
    if (d >= minEdgePx) return i;
  }
  return (rng() * getWorld().cells.length) | 0;
}

// Nearest cell by XY (use your own finder if available)
function nearestCellIndex(x, y) {
  const { cells } = getWorld();
  let best = 0, bd = Infinity;
  for (let i = 0; i < cells.length; i++) {
    const dx = cells[i].cx - x, dy = cells[i].cy - y;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Azgaar-style growth: queue/BFS; children height = parentHeight * radius * modifier
function growBlob({ startIndex, peak = 1, radius = 0.94, sharpness = 0.12, stop = 0.01 }) {
  const { cells } = getWorld();
  const rng = getRng();
  const used = new Uint8Array(cells.length);
  const q = [];
  cells[startIndex].high = Math.max(cells[startIndex].high ?? 0, peak);
  used[startIndex] = 1; q.push(startIndex);
  for (let qi = 0; qi < q.length; qi++) {
    const u = q[qi];
    const parentH = cells[u].high ?? 0;
    const nextBase = parentH * radius;
    if (nextBase <= stop) continue;
    const nn = cells[u].neighbors || [];
    for (const v of nn) {
      if (used[v]) continue;
      const mod = sharpness ? (rng() * sharpness + 1.1 - sharpness) : 1; // around ~1
      const h = Math.min(1, nextBase * mod);
      cells[v].high = Math.min(1, (cells[v].high ?? 0) + h);
      used[v] = 1; q.push(v);
    }
  }
}

function rescaleHeights(factor = 1) {
  const { cells } = getWorld();
  for (const c of cells) c.high = Math.min(1, (c.high ?? 0) * factor);
}

// Use only if the template ends up too flat (max<0.3)
export function normalizeHeightsIfNeeded({ minMax = 0.3, maxTarget = 0.85 } = {}) {
  const { cells } = getWorld();
  let lo = 1, hi = 0;
  for (const c of cells) { const h = c.high ?? 0; if (h < lo) lo = h; if (h > hi) hi = h; }
  if (hi < minMax || hi <= lo) {
    const scale = (maxTarget - 0) / Math.max(1e-6, hi - lo);
    for (const c of cells) c.high = Math.max(0, Math.min(1, (c.high - lo) * scale));
  }
}

// Very gentle post-pass: sink a thin outer margin to avoid border spill
export function sinkOuterMargin(pct = 0.04, amount = 0.15) {
  const { cells, width, height } = getWorld();
  const m = Math.min(width, height) * pct;
  for (const c of cells) {
    const d = Math.min(c.cx, c.cy, width - c.cx, height - c.cy);
    if (d < m) c.high = Math.max(0, (c.high ?? 0) - amount);
  }
}

// --- Blob-based operations ---
function opMountain({ peak = 1, radius = 0.95, sharpness = 0.12 } = {}) {
  growBlob({ startIndex: interiorCellIndex(), peak, radius, sharpness });
}

function opHill({ peak = 0.5, radius = 0.95, sharpness = 0.10 } = {}) {
  growBlob({ startIndex: interiorCellIndex(), peak, radius, sharpness });
}

function opRange({ peak = 0.8, steps = 6, stepRadius = 0.93, sharpness = 0.10 } = {}) {
  const { width, height } = getWorld();
  const rng = getRng();
  let x = rng() * width, y = rng() * height, dir = rng() * Math.PI * 2;
  for (let s = 0; s < steps; s++) {
    growBlob({ startIndex: nearestCellIndex(x, y), peak, radius: stepRadius, sharpness });
    x += Math.cos(dir) * (Math.min(width, height) * 0.12);
    y += Math.sin(dir) * (Math.min(width, height) * 0.12);
    dir += (rng() - 0.5) * 0.9;
  }
}

function opTrough(args = {}) { // negative linear feature
  const { cells } = getWorld();
  const before = cells.map(c => c.high ?? 0);
  opRange(args);
  for (let i = 0; i < cells.length; i++) cells[i].high = Math.max(0, before[i] - (cells[i].high - before[i]));
}

function opPit({ depth = 0.35, radius = 0.94, sharpness = 0.10 } = {}) { // negative blob
  const { cells } = getWorld();
  const before = cells.map(c => c.high ?? 0);
  growBlob({ startIndex: interiorCellIndex(), peak: depth, radius, sharpness });
  for (let i = 0; i < cells.length; i++) cells[i].high = Math.max(0, before[i] - (cells[i].high - before[i]));
}

export function _debugHeights(label = '') {
  const { cells } = getWorld();
  let min = 1, max = 0, sum = 0, n = cells.length, gt01 = 0, gt02 = 0, gt05 = 0;
  for (const c of cells) {
    const h = c.high ?? 0;
    if (h < min) min = h;
    if (h > max) max = h;
    sum += h;
    if (h > 0.10) gt01++;
    if (h > 0.20) gt02++;
    if (h > 0.50) gt05++;
  }
  console.log(`[H] ${label} min=${min.toFixed(3)} max=${max.toFixed(3)} mean=${(sum/n).toFixed(3)} | >0.10:${gt01} >0.20:${gt02} >0.50:${gt05} / ${n}`);
}

export function normalizeHeights({minTarget = 0, maxTarget = 0.85, floor = 0} = {}) {
  const { cells } = getWorld();
  if (!cells?.length) return;
  let lo = +Infinity, hi = -Infinity;
  for (const c of cells) {
    const h = c.high ?? 0;
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return;
  const scale = (maxTarget - minTarget) / (hi - lo);
  for (const c of cells) {
    let h = c.high ?? 0;
    h = minTarget + (h - lo) * scale;
    if (h < floor) h = floor;
    c.high = Math.max(0, Math.min(1, h));
  }
}

export function sinkSmallIslands({ keep = 2, minCells = 200, epsilon = 0.01 } = {}) {
  const { cells } = getWorld();
  // label connected land components using cell.neighbors
  const isLand = cells.map(c => (c.high ?? 0) >= (S.params.seaLevel ?? 0.45));
  const comp = new Int32Array(cells.length).fill(-1);
  const sizes = [];
  let id = 0;

  for (let i = 0; i < cells.length; i++) {
    if (!isLand[i] || comp[i] !== -1) continue;
    let q = [i], head = 0;
    comp[i] = id; let sz = 0;
    while (head < q.length) {
      const u = q[head++]; sz++;
      const nn = cells[u].neighbors || [];
      for (const v of nn) if (isLand[v] && comp[v] === -1) { comp[v] = id; q.push(v); }
    }
    sizes[id++] = sz;
  }
  if (!sizes.length) return;

  // sort component ids by size, keep the largest K above threshold
  const order = sizes.map((sz, i) => [sz, i]).sort((a,b)=>b[0]-a[0]);
  const keepIds = new Set(order.filter(([sz], idx) => idx < keep || sz >= minCells).map(([,i]) => i));

  for (let i = 0; i < cells.length; i++) {
    if (isLand[i] && !keepIds.has(comp[i])) {
      // sink this micro-island just below sea level
      const sea = S.params.seaLevel ?? 0.45;
      cells[i].high = Math.min(cells[i].high ?? 0, Math.max(0, sea - epsilon));
    }
  }
}

// Legacy functions removed - using Azgaar-style blob growth instead

// ---------------- Templates registry ----------------
/** Internal mutable registry; don't export directly. */
const Templates = Object.create(null);

/** Accessors */
export function getTemplates() { return Templates; }
export function setTemplates(obj) {
  // Shallow assign; caller ensures shape { name: fn | {name, steps:[...]}, ... }
  for (const k of Object.keys(obj || {})) Templates[k] = obj[k];
}

/** Default templates (Azgaar-style blob composition) */
export function volcanicIsland() { // "High Island"
  ensureHeightsCleared();
  opMountain({ peak: 1, radius: 0.95, sharpness: 0.12 });
  for (let i = 0; i < 15; i++) opHill({ peak: 0.5, radius: 0.95, sharpness: 0.10 });
  for (let i = 0; i < 2; i++)  opRange({ peak: 0.7, steps: 6 });
  for (let i = 0; i < 2; i++)  opTrough({ peak: 0.6, steps: 5 });
  for (let i = 0; i < 3; i++)  opPit({ depth: 0.3 });
}

export function lowIsland() {
  volcanicIsland();
  rescaleHeights(0.3);  // Azgaar: "re-scaled to 0.3 modifier" for Low Island
}

export function archipelago() {
  ensureHeightsCleared();
  opMountain({ peak: 1, radius: 0.96, sharpness: 0.12 });
  for (let i = 0; i < 15; i++) opHill({ peak: 0.45, radius: 0.95, sharpness: 0.12 });
  for (let i = 0; i < 2; i++)  opTrough({ peak: 0.55, steps: 5 });
  for (let i = 0; i < 8; i++)  opPit({ depth: 0.25, radius: 0.96 });
}

export function continentalIslands() {
  ensureHeightsCleared();
  opMountain({ peak: 1, radius: 0.95, sharpness: 0.10 });
  for (let i = 0; i < 5; i++)  opTrough({ peak: 0.6, steps: 7, stepRadius: 0.94 });
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
  cfg.lowIsland = cfg.lowIsland || lowIsland;
  cfg.archipelago = cfg.archipelago || archipelago;
  cfg.continentalIslands = cfg.continentalIslands || continentalIslands;
  cfg.continents = cfg.continentalIslands; // Map "continents" to continentalIslands
  
  // Also register in our internal registry for the new API
  if (!Templates.default) Templates.default = (x) => x;
  Templates.volcanicIsland = Templates.volcanicIsland || volcanicIsland;
  Templates.lowIsland = Templates.lowIsland || lowIsland;
  Templates.archipelago = Templates.archipelago || archipelago;
  Templates.continentalIslands = Templates.continentalIslands || continentalIslands;
  Templates.continents = Templates.continentalIslands; // Map "continents" to continentalIslands
}

// ---------------- Height clear ----------------
export function ensureHeightsCleared() {
  const { cells } = getWorld();
  if (!cells?.length) return;
  for (const c of cells) c.high = 0;
}

// Steps-based executor removed - using Azgaar-style blob templates instead

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

  console.warn('[terrain] Unknown template shape for', tplKey);
  return { applied: false, type: 'unknown' };
}


