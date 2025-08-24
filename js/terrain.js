// js/terrain.js — terrain templates + executor (function-based + steps-based)
// TODO: Growth-aware oval mask system with de-fill implemented
// - Precomputed rotated-oval mask cached per run
// - Seeds gated by mask ≥ 0.65 (cores deeper at 0.72)
// - Growth attenuated by mask values
// - Propagation clipped at mask < 0.35
// - Sub-linear blending prevents saturation (h0*0.72 + v*0.62)
// - Strong carving with mega-troughs (carveSeas)
// - Final mask pass very light (pow:1.05) for subtle polish
import { S, getWorld, resetCaches, getRng as getStateRng } from './state.js';
import { mulberry32, rngFromSeed, clamp, randRange, choice } from './utils.js';
import { samplePoints } from './mesh/poisson.js';
import { buildMesh } from './mesh/mesh.js';
import { seededXY, seededCell } from './sampling.js';

// One canonical RNG for this run (legacy - use getStateRng for new code)
export function getTerrainRng(){ return mulberry32(S.seed); }
let RNG = getTerrainRng();
export function _refreshRng(){ RNG = getTerrainRng(); }

// ---------- Oval mask cache ----------
// TODO: Step 2.5 - Legacy oval mask stubbed out (replaced by border-flood oceans)
let OVAL_MASK = null; // Float32Array per-cell - NO LONGER USED
function _smooth01(x){ return x<=0?0:x>=1?1:(x*x*(3-2*x)); }
function _normUV(cx, cy, W, H, marginPx) {
  const iw = Math.max(1, W - marginPx*2), ih = Math.max(1, H - marginPx*2);
  const u = (cx - marginPx) / iw * 2 - 1;
  const v = (cy - marginPx) / ih * 2 - 1;
  return {u, v};
}

// TODO: Step 2.5 - Legacy oval mask function stubbed out (replaced by border-flood oceans)
function _makeOvalMask({innerPx=null, ax=1.0, ay=0.7, rot=0.0, n=2.5, pow=1.6} = {}) {
  // This function is no longer used - replaced by border-flood ocean classification
  const out = new Float32Array(CELLS.length);
  out.fill(1.0); // Always "inside mask" - no longer constraining
  return out;
}

// TODO: Step 2.5 - Legacy oval mask binding stubbed out (replaced by border-flood oceans)
export function bindOvalMaskForRun() {
  // This function is no longer used - replaced by border-flood ocean classification
  OVAL_MASK = _makeOvalMask(); // Always returns all 1.0s
}

// ---------- World binding (singleton per run) ----------
let WORLD = null;
let CELLS = null;
export function bindWorld() {
  WORLD = getWorld();              // must be your canonical world getter
  CELLS = WORLD?.cells || [];
  if (!Array.isArray(CELLS) || CELLS.length === 0) {
    throw new Error('[terrain] bindWorld(): cells not ready');
  }
  return WORLD;
}

// Bridge function to convert new mesh to old WORLD structure
export function bindMeshAsWorld(mesh) {
  if (!mesh || !mesh.cells) {
    throw new Error('[terrain] bindMeshAsWorld(): invalid mesh');
  }
  
  // Convert new mesh structure to old WORLD structure
  const cells = [];
  for (let i = 0; i < mesh.cells.polygons.length; i++) {
    const poly = mesh.cells.polygons[i];
    if (!poly || poly.length < 6) continue;
    
    // Compute centroid
    let cx = 0, cy = 0;
    for (let p = 0; p < poly.length; p += 2) { cx += poly[p]; cy += poly[p+1]; }
    cx /= poly.length/2; cy /= poly.length/2;
    
    cells.push({
      cx, cy,
      neighbors: mesh.cells.neighbors[i] || [],
      i: i
    });
  }
  
  WORLD = {
    width: mesh.width,
    height: mesh.height,
    cells: cells
  };
  CELLS = cells;
  
  return WORLD;
}

function cells() { return CELLS; } // shorthand

// Centralized height access helpers
export let HEIGHT_KEY = 'high';
export function resolveHeightKey() {
  const c = cells()?.[0] || {};
  HEIGHT_KEY = ('h' in c) ? 'h' : ('height' in c) ? 'height' : 'high';
}
export const readH = (c) => c[HEIGHT_KEY] ?? 0;
export const writeH = (c,v) => { c[HEIGHT_KEY] = v; };

// ---------- Neighbor utilities (robust) ----------
function _idxOfNeighbor(nb) {
  if (typeof nb === 'number') return nb;
  if (!nb || typeof nb !== 'object') return -1;
  if (Number.isInteger(nb.i)) return nb.i;
  if (Number.isInteger(nb.index)) return nb.index;
  if (Number.isInteger(nb.id)) return nb.id;
  return -1;
}

function _neighborIndices(u) {
  const c = CELLS[u];
  const raw = c.neighbors ?? c.nbs ?? c.neighborsIds ?? c.ns ?? [];
  const out = [];
  for (const nb of raw) {
    const v = _idxOfNeighbor(nb);
    if (v >= 0 && v < CELLS.length) out.push(v);
  }
  return out;
}

// Pick an interior cell (keeps seeds off borders)
function interiorCellIndex(minEdgePx = Math.min(WORLD.width, WORLD.height) * 0.10, minMask=0.65) {
  for (let t=0; t<800; t++) {
    const i = (RNG() * CELLS.length) | 0;
    const c = CELLS[i];
    const d = Math.min(c.cx, c.cy, WORLD.width - c.cx, WORLD.height - c.cy);
    if (Number.isFinite(d) && d >= minEdgePx && (OVAL_MASK?.[i] ?? 1) >= minMask) return i;
  }
  return (CELLS.length/2)|0;
}

export function interiorDarts(k, minDistPx, minMask=0.65) {
  const minD2 = (minDistPx ?? Math.min(WORLD.width, WORLD.height) * 0.22) ** 2;
  const picks = [];
  for (let tries=0; tries<6000 && picks.length<k; tries++) {
    const i = interiorCellIndex(undefined, minMask);
    const ci = CELLS[i];
    if ((OVAL_MASK?.[i] ?? 1) < minMask) continue;
    let ok = true;
    for (const j of picks) {
      const cj = CELLS[j];
      const dx = ci.cx - cj.cx, dy = ci.cy - cj.cy;
      if (dx*dx + dy*dy < minD2) { ok = false; break; }
    }
    if (ok) picks.push(i);
  }
  return picks.length ? picks : [(CELLS.length/2)|0];
}

// Nearest cell by XY (use your own finder if available)
function nearestCellIndex(x, y) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < CELLS.length; i++) {
    const dx = CELLS[i].cx - x, dy = CELLS[i].cy - y;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// TODO: Replace growBlob with field-based system for Azgaar-style continent generation
// Search anchors: growBlob function around line 30, applyFieldAdd/applyFieldSub around line 80

function idxOfNeighbor(v) {
  if (typeof v === "number") return v;
  if (!v || typeof v !== "object") return -1;
  // accept common id fields
  if (Number.isInteger(v.i)) return v.i;
  if (Number.isInteger(v.index)) return v.index;
  if (Number.isInteger(v.id)) return v.id;
  return -1;
}

export function makeBlobField({ startIndex, peak=1, radius=0.915, sharpness=0.085, stop=0.035, warpAmp=0.055, warpFreq=0.0025, maskClip=0.35 }) {
  if (!(startIndex >= 0 && startIndex < CELLS.length)) {
    console.warn('[blob] invalid startIndex', startIndex, 'cells=', CELLS.length);
    return new Float32Array(CELLS.length);
  }
  const f = new Float32Array(CELLS.length);
  const used = new Uint8Array(CELLS.length);
  const q = [];
  f[startIndex] = peak;
  used[startIndex] = 1;
  q.push(startIndex);

  let pushCount = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const u = q[qi];
    const parent = Math.max(0, Math.min(1, f[u]));          // bound parent
    // domain warp: vary decay by a gentle noise around the target neighbor
    const cu = CELLS[u];
    const rBase = radius;
    const nextBase = parent * rBase;                        // decay by radius
    if (nextBase <= stop) continue;
    const nn = _neighborIndices(u);
    if (!nn.length && qi === 0) {
      console.warn('[blob] seed has 0 neighbors; u=', u, CELLS[u]);
    }
    for (const v of nn) {
      if (used[v]) continue;
      const mv = (OVAL_MASK?.[v] ?? 1);
      if (mv < maskClip) continue;               // don't propagate past rim
      const cv = CELLS[v];
      // noise in world space → [-warpAmp, +warpAmp]
      const n = (_noise2(cv.cx*warpFreq, cv.cy*warpFreq) - 0.5) * 2 * warpAmp;
      const rad = Math.max(0.80, Math.min(0.99, rBase + n));
      let nextBase = parent * rad;
      // IMPORTANT: mod ∈ [1 - sharpness, 1]; never > 1 so children ≤ parent
      const mod = 1 - sharpness * RNG();
      const h = (nextBase * mod) * mv;           // attenuate by mask
      if (h > f[v]) f[v] = h;
      used[v] = 1;
      q.push(v);
      pushCount++;
    }
  }
  if (pushCount === 0) {
    console.warn('[blob] no expansion from seed', startIndex, 'cx,cy=', CELLS[startIndex].cx, CELLS[startIndex].cy);
  }
  return f;
}

// Sub-linear blend: prevents "fill to 1.0" plateaus when many blobs overlap
export function applyFieldAdd(field, k=1) {
  let nz = 0;
  for (let i = 0; i < CELLS.length; i++) {
    const inc = k * (field[i] || 0);
    if (inc === 0) continue;
    const h0 = readH(CELLS[i]);
    // Blend weights tuned so repeated additions asymptote below 1
    const h1 = Math.min(1, h0*0.72 + inc*0.62);
    if (h1 > h0) {
      writeH(CELLS[i], h1);
      nz++;
    }
  }
  if (nz === 0) console.warn('[add] field added zero cells');
}

// Slightly super-linear subtract to make carving "win" against fills
export function applyFieldSub(field, k=1) {
  for (let i = 0; i < CELLS.length; i++) {
    const dec = k * (field[i] || 0);
    if (dec === 0) continue;
    const h0 = readH(CELLS[i]);
    const h1 = Math.max(0, h0 - dec*0.85);
    if (h1 < h0) writeH(CELLS[i], h1);
  }
}

// Legacy growBlob function - now uses field-based system internally
function growBlob({ startIndex, peak = 1, radius = 0.94, sharpness = 0.12, stop = 0.01 }) {
  const f = makeBlobField({ startIndex, peak, radius, sharpness, stop });
  applyFieldAdd(f, 1);
}

function rescaleHeights(factor = 1) {
  for (const c of CELLS) writeH(c, Math.min(1, readH(c) * factor));
}

// Use only if the template ends up too flat (max<0.3)
export function normalizeHeightsIfNeeded({ minMax = 0.3, maxTarget = 0.85 } = {}) {
  let lo = 1, hi = 0;
  for (const c of CELLS) { const h = readH(c); if (h < lo) lo = h; if (h > hi) hi = h; }
  if (hi < minMax || hi <= lo) {
    const scale = (maxTarget - 0) / Math.max(1e-6, hi - lo);
    for (const c of CELLS) writeH(c, Math.max(0, Math.min(1, (readH(c) - lo) * scale)));
  }
}

// Very gentle post-pass: sink a thin outer margin to avoid border spill
export function sinkOuterMargin(pct = 0.04, amount = 0.15) {
  const m = Math.min(WORLD.width, WORLD.height) * pct;
  for (const c of CELLS) {
    const d = Math.min(c.cx, c.cy, WORLD.width - c.cx, WORLD.height - c.cy);
    if (d < m) writeH(c, Math.max(0, readH(c) - amount));
  }
}

// --------- math helpers ----------

// TODO: Step 2.5 - Legacy oval mask function stubbed out (replaced by border-flood oceans)
export function applyOvalMask({innerPx=null, ax=1.0, ay=0.7, rot=0.0, n=2.4, pow=1.7} = {}) {
  // This function is no longer used - replaced by border-flood ocean classification
  // No-op: heights remain unchanged
}

// --------- tiny value noise (tileable-enough for our use) ----------
function _hash(x,y){ // deterministic; uses WORLD dims as salt
  let h = ((x*73856093) ^ (y*19349663) ^ (WORLD.width|0) ^ ((WORLD.height|0)<<1)) >>> 0;
  h ^= h<<13; h ^= h>>>17; h ^= h<<5;
  return (h & 0xfffffff) / 0xfffffff;
}
function _lerp(a,b,t){ return a + (b-a)*t; }
function _noise2(x,y){ // grid value-noise
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi,      yf = y - yi;
  const v00=_hash(xi,yi), v10=_hash(xi+1,yi), v01=_hash(xi,yi+1), v11=_hash(xi+1,yi+1);
  const tx = _smooth01(xf), ty = _smooth01(yf);
  return _lerp(_lerp(v00,v10,tx), _lerp(v01,v11,tx), ty);
}

// Multiply heights by a border mask: 0 at edge -> 1 in interior.
export function applyEdgeMask({ innerMarginPx=null, power=1.6 } = {}) {
  const w = WORLD.width, h = WORLD.height;
  const inner = innerMarginPx ?? Math.min(w,h) * 0.06;
  // distance from edge normalized to [0..1] after an inner offset
  for (const c of CELLS) {
    const d = Math.min(c.cx, c.cy, w - c.cx, h - c.cy); // px to nearest edge
    const m = _smooth01(Math.max(0, d - inner) / (Math.min(w,h)*0.5 - inner));
    const factor = Math.pow(m, power);
    writeH(c, readH(c) * factor);
  }
}

export function capHeights(maxH=0.92){
  for (const c of CELLS) writeH(c, Math.min(maxH, readH(c)));
}

// --- Blob-based operations ---
// Positive add
function opMountain(opts = {}) {
  const { peak = 1, radius = 0.975, sharpness = 0.065 } = opts; // wider, smoother
  const startIndex = seededCell(WORLD, () => RNG(), 'volcano');
  const f = makeBlobField({ startIndex, peak, radius, sharpness, stop: 0.035, warpAmp:0.055, warpFreq:0.003, maskClip:0.35 });
  applyFieldAdd(f, 1);
}

function opHill(opts = {}) {
  const { peak = 0.42, radius = 0.975, sharpness = 0.065 } = opts; // many broad hills
  const startIndex = seededCell(WORLD, () => RNG(), 'hill');
  const f = makeBlobField({ startIndex, peak, radius, sharpness, stop: 0.035, warpAmp:0.055, warpFreq:0.003, maskClip:0.35 });
  applyFieldAdd(f, 1);
}

function opRange({ peak = 0.8, steps = 6, stepRadius = 0.92, sharpness = 0.105 } = {}) {
  let [x, y] = seededXY(WORLD, () => RNG(), 'ridge');
  let dir = RNG() * Math.PI * 2;
  for (let s = 0; s < steps; s++) {
    const f = makeBlobField({ startIndex: nearestCellIndex(x, y), peak, radius: stepRadius, sharpness, stop: 0.035, warpAmp:0.055, warpFreq:0.003, maskClip:0.35 });
    applyFieldAdd(f, 1);
    x += Math.cos(dir) * (Math.min(WORLD.width, WORLD.height) * 0.12);
    y += Math.sin(dir) * (Math.min(WORLD.width, WORLD.height) * 0.12);
    dir += (RNG() - 0.5) * 0.9;
  }
}

// Negative: subtract gently (scale k)
function opTrough(opts = {}) {
  const { peak = 0.40, steps = 6, stepRadius = 0.935, sharpness = 0.075, strength = 0.25 } = opts;
  let [x, y] = seededXY(WORLD, () => RNG(), 'trough');
  let dir = RNG() * Math.PI * 2;
  for (let s = 0; s < steps; s++) {
    const idx = nearestCellIndex(x, y);
    const f = makeBlobField({ startIndex: idx, peak, radius: stepRadius, sharpness, stop: 0.035, warpAmp:0.055, warpFreq:0.003, maskClip:0.35 });
    applyFieldSub(f, strength); // gentle carve
    x += Math.cos(dir) * (Math.min(WORLD.width, WORLD.height) * 0.12);
    y += Math.sin(dir) * (Math.min(WORLD.width, WORLD.height) * 0.12);
    dir += (RNG() - 0.5) * 0.9;
  }
}

function opPit({ depth = 0.35, radius = 0.935, sharpness = 0.105 } = {}) {
  const startIndex = seededCell(WORLD, () => RNG(), 'sea');
  const f = makeBlobField({ startIndex, peak: depth, radius, sharpness, stop: 0.035, warpAmp:0.055, warpFreq:0.003, maskClip:0.35 });
  applyFieldSub(f, 1);
}

function carveSeas({count=3, minMask=0.55} = {}){
  for (let k=0;k<count;k++){
    const seed = seededCell(WORLD, () => RNG(), 'sea');
    // Wide, soft trough; allow carving closer to rim (looser maskClip)
    const f = makeBlobField({
      startIndex: seed,
      peak: 0.68 + RNG()*0.12,   // how much to remove before scaling below
      radius: 0.955,
      sharpness: 0.07,
      stop: 0.05,                // longer reach to open basins/straits
      warpAmp: 0.07,
      warpFreq: 0.002,
      maskClip: 0.22             // allow carving nearer boundary
    });
    // Carve with moderate strength so we create bays/seas, not voids
    applyFieldSub(f, 0.55 + RNG()*0.1);
  }
}

function _stats(label='[H]') {
  let min=1, max=0, sum=0, g10=0, g20=0, g50=0;
  for (const c of CELLS) {
    const h = readH(c);
    if (h < min) min = h;
    if (h > max) max = h;
    sum += h;
    if (h > 0.10) g10++;
    if (h > 0.20) g20++;
    if (h > 0.50) g50++;
  }
  const n = CELLS.length || 1;
  console.log(`${label} min=${min.toFixed(3)} max=${max.toFixed(3)} mean=${(sum/n).toFixed(3)} | >0.10:${g10} >0.20:${g20} >0.50:${g50} / ${n}`);
}

export function _debugHeights(label = '') {
  _stats(`[H] ${label}`);
}

export function normalizeHeights({minTarget = 0, maxTarget = 0.9} = {}) {
  let lo = Infinity, hi = -Infinity;
  for (const c of CELLS) { const h = readH(c); if (h < lo) lo = h; if (h > hi) hi = h; }
  if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return;
  const s = (maxTarget - minTarget) / (hi - lo);
  for (const c of CELLS) writeH(c, Math.max(0, Math.min(1, minTarget + (readH(c) - lo) * s)));
}

export function sinkSmallIslands({ keep = 2, minCells = 200, epsilon = 0.01 } = {}) {
  // label connected land components using cell.neighbors
  const sea = Number.isFinite(S?.params?.seaLevel) ? S.params.seaLevel : 0.20;
  const isLand = CELLS.map(c => readH(c) >= sea);
  const comp = new Int32Array(CELLS.length).fill(-1);
  const sizes = [];
  let id = 0;

  for (let i = 0; i < CELLS.length; i++) {
    if (!isLand[i] || comp[i] !== -1) continue;
    let q = [i], head = 0;
    comp[i] = id; let sz = 0;
    while (head < q.length) {
      const u = q[head++]; sz++;
      const nn = _neighborIndices(u);
      for (const v of nn) if (isLand[v] && comp[v] === -1) { comp[v] = id; q.push(v); }
    }
    sizes[id++] = sz;
  }
  if (!sizes.length) return;

  // sort component ids by size, keep the largest K above threshold
  const order = sizes.map((sz, i) => [sz, i]).sort((a,b)=>b[0]-a[0]);
  const keepIds = new Set(order.filter(([sz], idx) => idx < keep || sz >= minCells).map(([,i]) => i));

  for (let i = 0; i < CELLS.length; i++) {
    if (isLand[i] && !keepIds.has(comp[i])) {
      // sink this micro-island just below sea level
      const sea = S.params.seaLevel ?? 0.45;
      writeH(CELLS[i], Math.min(readH(CELLS[i]), Math.max(0, sea - epsilon)));
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
  _refreshRng(); // IMPORTANT: seed ops for this run
  bindWorld();
  // TODO: Step 2.5 - bindOvalMaskForRun() removed (replaced by border-flood oceans)
  opMountain({ peak: 1, radius: 0.95, sharpness: 0.12 });
  for (let i = 0; i < 15; i++) opHill({ peak: 0.5, radius: 0.95, sharpness: 0.10 });
  for (let i = 0; i < 2; i++)  opRange({ peak: 0.7, steps: 6 });
  for (let i = 0; i < 2; i++)  opTrough({ peak: 0.6, steps: 5 });
  for (let i = 0; i < 3; i++)  opPit({ depth: 0.3 });
}

export function lowIsland() {
  ensureHeightsCleared();
  _refreshRng(); // IMPORTANT: seed ops for this run
  bindWorld();
  // TODO: Step 2.5 - bindOvalMaskForRun() removed (replaced by border-flood oceans)
  opMountain({ peak: 1, radius: 0.95, sharpness: 0.12 });
  for (let i = 0; i < 15; i++) opHill({ peak: 0.5, radius: 0.95, sharpness: 0.10 });
  for (let i = 0; i < 2; i++)  opRange({ peak: 0.7, steps: 6 });
  for (let i = 0; i < 2; i++)  opTrough({ peak: 0.6, steps: 5 });
  for (let i = 0; i < 3; i++)  opPit({ depth: 0.3 });
  rescaleHeights(0.3);  // Azgaar: "re-scaled to 0.3 modifier" for Low Island
}

export function archipelago() {
  ensureHeightsCleared();
  _refreshRng(); // IMPORTANT: seed ops for this run
  bindWorld();
  // TODO: Step 2.5 - bindOvalMaskForRun() removed (replaced by border-flood oceans)
  opMountain({ peak: 1, radius: 0.96, sharpness: 0.12 });
  for (let i = 0; i < 15; i++) opHill({ peak: 0.45, radius: 0.95, sharpness: 0.12 });
  for (let i = 0; i < 2; i++)  opTrough({ peak: 0.55, steps: 5 });
  for (let i = 0; i < 8; i++)  opPit({ depth: 0.25, radius: 0.96 });
}

export function continentalIslands() {
  ensureHeightsCleared();
  _refreshRng();
  bindWorld();             // make sure CELLS is bound
  resolveHeightKey();      // ensure we write the property recolor reads
  // TODO: Step 2.5 - bindOvalMaskForRun() removed (replaced by border-flood oceans)
  
  // Use safe-zone seeding for cores
  const cores = [];
  for (let i = 0; i < 3; i++) {
    const idx = seededCell(WORLD, () => RNG(), 'core');
    cores.push(idx);
  }
  
  for (const idx of cores) {
    const f = makeBlobField({ startIndex: idx, peak: 1, radius: 0.985, sharpness: 0.06, stop: 0.025, warpAmp:0.06, warpFreq:0.003 });
    const nz = f.reduce((a,v)=>a+(v>0),0);
    console.log('[core] seed', idx, 'nonzero=', nz);
    applyFieldAdd(f, 1.0);
  }
  _stats('[H] after cores');

  const hills = 22 + ((RNG()*8)|0); // fewer hills; less global fill
  for (let i=0;i<hills;i++){
    const f = makeBlobField({
      startIndex: seededCell(WORLD, () => RNG(), 'hill'),
      peak: 0.33 + RNG()*0.08, radius: 0.935, sharpness: 0.075, stop: 0.035,
      warpAmp:0.055, warpFreq:0.003, maskClip:0.46
    });
    applyFieldAdd(f, 1);
  }
  _stats('[H] after hills');

  for (let i=0; i<2; i++) opTrough({ strength: 0.45 });
  _stats('[H] after troughs');
  
  // existing gentle troughs (keep or reduce to 1–2); then carve seas:
  carveSeas({count: 2 + ((RNG()*2)|0), minMask: 0.58});
  _stats('[H] after seas');
  
  // TODO: Step 2.5 - applyOvalMask() removed (replaced by border-flood oceans)
  // pick a random oval aspect & rotation so coastlines aren't canvas-aligned
  const A = 0.80 + RNG()*0.25;        // ax
  const B = 0.55 + RNG()*0.25;        // ay
  const TH = RNG() * Math.PI;         // rotation
  // Optional light polish (small pow) - REMOVED: applyOvalMask({ ax:A, ay:B, rot:TH, n:2.6, pow:1.05 });
  _stats('[H] after oval mask (removed)');

  // ---- Fail-safe: if still zero, draw a visible disk in the middle ----
  const hasLand = CELLS.some(c => readH(c) > 0.05);
  if (!hasLand) {
    console.warn('[failsafe] heights still zero; painting a demo disk');
    const mid = (CELLS.length/2)|0;
    const { cx: mx, cy: my } = CELLS[mid];
    const R2 = (Math.min(WORLD.width, WORLD.height)*0.25)**2;
    for (const c of CELLS) {
      const dx = c.cx - mx, dy = c.cy - my;
      const d2 = dx*dx + dy*dy;
      if (d2 < R2) writeH(c, Math.max(readH(c), 0.8*(1 - d2/R2)));
    }
    _stats('[H] after FAILSAFE');
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
  if (!CELLS?.length) return;
  for (const c of CELLS) writeH(c, 0);
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

  // Refresh RNG before any terrain operations
  _refreshRng();

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

export function _debugSingleMountain() {
  ensureHeightsCleared();
  _refreshRng();
  bindWorld();
  // TODO: Step 2.5 - bindOvalMaskForRun() removed (replaced by border-flood oceans)
  const i = interiorCellIndex(undefined, 0.65);
  const f = makeBlobField({ startIndex: i, peak: 1, radius: 0.975, sharpness: 0.065, stop: 0.035, warpAmp:0.055, warpFreq:0.003, maskClip:0.35 });
  applyFieldAdd(f, 1);
}

export function _probeFieldFrom(i) {
  const f = makeBlobField({ startIndex: i, peak: 1, radius: 0.975, sharpness: 0.065, stop: 0.035, warpAmp:0.055, warpFreq:0.003, maskClip:0.35 });
  let mx = 0, cnt = 0;
  for (let k = 0; k < f.length; k++) { if (f[k] > 0) { cnt++; if (f[k] > mx) mx = f[k]; } }
  console.log(`[F] from ${i} -> nonzero=${cnt} max=${mx.toFixed(3)}`);
  return f;
}

export function _probeAddOnce(){
  bindWorld();
  // TODO: Step 2.5 - bindOvalMaskForRun() removed (replaced by border-flood oceans)
  const i = interiorCellIndex(undefined, 0.65);
  const f = makeBlobField({ startIndex:i, peak:1, radius:0.975, sharpness:0.065, stop:0.035, warpAmp:0.055, warpFreq:0.003, maskClip:0.35 });
  let nz=0,mx=0; for (let k=0;k<f.length;k++){ if(f[k]>0){nz++; if(f[k]>mx) mx=f[k];}}
  console.log(`[F] seed=${i} nonzero=${nz} max=${mx.toFixed(3)}`);
  applyFieldAdd(f,1);
  _stats('[H] after probe');
}

// TODO: Base mesh generation entry point
/**
 * Build base mesh using Poisson-disc sampling and Delaunay/Voronoi
 * @returns {Object} Mesh object with cached topology
 */
export function buildBaseMesh() {
  const { width: viewW, height: viewH, cellCountTarget } = S;
  const rng = getStateRng();

  // compute overscan size
  const pad =
    S.overscanPx != null
      ? S.overscanPx
      : Math.max(0, Math.round(Math.min(viewW, viewH) * (S.overscanPct || 0)));

  const genW = viewW + 2 * pad;
  const genH = viewH + 2 * pad;

  // derive spacing from desired *visible* cell target; compensate for bigger area
  const effectiveTarget = Math.max(1000, Math.round(cellCountTarget * (genW * genH) / (viewW * viewH)));
  const area = genW * genH;
  const c = 1.2;
  const spacing = Math.sqrt((area / effectiveTarget) * c);

  const t0 = performance.now();
  const points = samplePoints({ width: genW, height: genH, minDist: spacing, k: 30 }, rng);
  const t1 = performance.now();
  const mesh = buildMesh({ width: genW, height: genH, points });
  const t2 = performance.now();

  // stash generation bounds for later transforms
  mesh.genBounds = { x: 0, y: 0, width: genW, height: genH, pad, viewW, viewH };

  console.log(
    `[mesh] points=${points.length/2} genBox=${genW}×${genH} (pad=${pad}) ` +
    `poisson=${(t1-t0).toFixed(1)}ms delaunay+voronoi=${(t2-t1).toFixed(1)}ms`
  );
  
  // TODO: Cache mesh in state
  S.caches.mesh = mesh;
  
  return mesh;
}


