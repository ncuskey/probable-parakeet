// js/state.js — Single source of truth for world + params + caches
import { mulberry32 } from './utils.js';
import { makeRng } from './rng.js';

/**
 * Central state bag. Avoid touching DOM/d3 here.
 * Everything else should import from this module.
 */
export const S = {
  // Geometry / graph
  width: 1200,
  height: 800,
  cells: [],       // array of cell objects
  edges: [],       // optional
  vertices: [],    // optional

  // RNG / seed
  seed: 'azgaar-perilous-0001',  // TODO: Enhanced string seed support
  rng: mulberry32(12345),
  _rng: null,  // TODO: Memoized enhanced RNG instance

  // TODO: Mesh generation parameters
  cellCountTarget: 8000,  // Target number of cells for Poisson sampling

  // NEW: Azgaar-Lite baseline generator switch
  terrainMode: 'azgaar-lite',     // 'azgaar-lite' | 'current'

  // NEW: Azgaar-Lite RNG seed knobs
  rngSeed: 'azlite-001',   // ← NEW: change to reproduce a map
  rngAlg: 'sfc32',         // (kept for future extensibility)

  // NEW: Azgaar-Lite sea level control
  seaLevelMode: 'fixed',   // 'fixed' | 'percentile'
  seaPercentile: 0.35,     // used when seaLevelMode === 'percentile'

  // NEW: Optional second big island (archipelago)
  secondBlobEnabled: false,
  secondBlobScale: 0.7,    // relative to blob.maxHeight (0.5–0.8 works well)

  // Azgaar-lite params (match the fiddle's UX)
  poissonRadius: 4,               // "Points radius"
  blob: {                         // defaults like the sliders
    maxHeight: 0.9,               // "Max Height"
    radius: 0.90,                 // "Blob Radius" (decay per ring)
    sharpness: 0.2                // "Blob Sharpness" (random mod)
  },
  seaLevel: 0.2,                  // fixed threshold like the fiddle
  seedWindow: { left: 0.28, right: 0.72, top: 0.22, bottom: 0.74 }, // tightened window for better padding
  randomSmallHills: 10,           // count for "Random map"
  smoothCoastIters: 2,            // Chaikin passes (visual parity to curveBasisClosed)
  drawMaskOcean: true,
  drawCoastlines: true,
  drawShallow: true,

  // NEW: elevation/template controls
  template: 'radialIsland',     // 'radialIsland' | 'continentalGradient' | 'twinContinents'
  templateDir: 'WtoE',          // for continentalGradient
  targetLandFrac: 0.35,         // 35% land by default

  // noise knobs
  baseNoiseScale: 450,
  baseNoiseOctaves: 5,
  baseNoiseGain: 0.5,
  baseNoiseLac: 2.0,
  warpScale: 350,
  warpAmp: 45,

  // frame safety
  enforceOceanFrame: false,     // let the moat do the job
  frameEpsilon: 1e-4,          // how far above offending border cell to lift sea
  maxSeaBoost: 0.06,           // cap on how much we're allowed to raise sea level

  // frame moat (cell-aware ocean border)
  frameMoatPx: null,            // let it auto-compute
  frameMoatCells: 2.5,          // ≈2–3 cell layers at the edge
  frameMoatDrop: 1e-4,

  // Turn OFF the old rectangular falloff by default
  edgeFalloffPx: 0,          // ← was ~0.12*minWH; set to 0 to disable
  edgeFalloffExp: 1.6,       // kept for backward compat, unused when px=0

  // Optional: noise-modulated edge bias (disabled by default)
  edgeBiasMode: 'off',       // 'off' | 'noisy'
  edgeBiasMarginPx: 0,       // e.g. Math.round(0.10 * Math.min(width,height))
  edgeBiasAmp: 0.2,          // 0..1 intensity of bias; 0.15–0.3 is subtle
  edgeBiasNoiseScale: 900,   // big features
  edgeBiasOctaves: 3,
  edgeBiasGain: 0.5,

  // overscan generation (bigger world box)
  overscanPct: 0.18,      // a touch more overscan helps framing
  overscanPx: null,       // optional absolute px override; if null uses overscanPct

  // fit transform
  fitMode: 'fitLand',     // 'none' | 'fitLand'
  fitMarginPx: 28,        // guaranteed margin (can tune)
  allowUpscale: false,    // if false, don't scale above 1 (only shrink/translate)

  // Template center sampling window (fraction of canvas)
  seedWindow: { left: 0.18, right: 0.82, top: 0.18, bottom: 0.82 },

  // Coast smoothing
  coastSmoothIters: 2,      // Chaikin passes
  coastSnapDigits: 2,       // vertex dedup precision for edge chaining

  // Rendering toggles
  drawShallow: true,
  drawCoastlines: true,

  // Strict Safe-Zone Seeding for High-Energy Features
  enforceSeedSafeZones: true,     // hard requirement for all high-energy kernels
  seedSafeZoneRetries: 80,        // rejection-sampling attempts per seed

  // Default "central box" in percentages of the generation box
  // (Tune per project; mirrors Azgaar's randomMap ranges)
  seedZones: {
    core:   { left: 0.18, right: 0.82, top: 0.18, bottom: 0.82 },
    hill:   { left: 0.12, right: 0.88, top: 0.15, bottom: 0.88 },
    ridge:  { left: 0.12, right: 0.88, top: 0.15, bottom: 0.88 },
    trough: { left: 0.10, right: 0.90, top: 0.12, bottom: 0.90 },
    sea:    { left: 0.10, right: 0.90, top: 0.10, bottom: 0.90 },
    volcano:{ left: 0.20, right: 0.80, top: 0.20, bottom: 0.80 }
  },

  // Debug
  showSeedZones: false,

  // Tunables / params
  params: {
    seaLevel: 0.5,
    worldType: 'continents',
    regionCountK: 3,
  },

  // Derived data / caches
  caches: {
    isWater: null,    // Float32Array|Uint8Array|Array<boolean> or null
    landPaths: null,  // unified land paths, if any
    precip: null,     // precipitation array
    coastSteps: null, // coast distance steps
    riverSteps: null, // river distance steps
    regionOfCell: null, // region assignment per cell
    unifiedLandPaths: null, // unified land paths
    riverPolys: null, // river polygons
    ports: null,      // port data
    roadUsage: null,  // road usage data
    isLake: null,     // lake data
    lakeId: null,     // lake ID data
    lakes: null,      // lakes data
    // TODO: Mesh cache
    mesh: null,       // cached mesh object
  },

  // Burgs and regions
  burgs: [],
  macroCapitals: null,
  regenerationCount: 0,

  // View state
  currentViewMode: 'terrain', // 'terrain' | 'regions'
};

/** Basic setters/getters (no DOM here) */
export function setSize(w, h) { S.width = w; S.height = h; }
export function setCells(cells) { S.cells = cells || []; }
export function setEdges(edges) { S.edges = edges || []; }
export function setVertices(verts) { S.vertices = verts || []; }

export function setSeed(seed) {
  S.seed = seed;
  S.rng = mulberry32(typeof seed === 'string' ? 12345 : seed); // TODO: Remove legacy rng
  S._rng = null; // TODO: Reset memoized RNG
}

// TODO: Export state object for direct access
export { S as state };

// TODO: Enhanced RNG getter with memoization
export function getRng() {
  if (!S._rng) {
    S._rng = makeRng(S.seed);
  }
  return S._rng;
}

// TODO: Mesh parameter setters
export function setCellTarget(n) { 
  S.cellCountTarget = Math.max(100, Math.min(50000, n)); 
}

export function setParam(key, val) { S.params[key] = val; }
export function getParam(key, fallback = undefined) {
  return (key in S.params) ? S.params[key] : fallback;
}

/** Cache helpers */
export function resetCaches(...keys) {
  if (!keys.length) {
    S.caches.isWater = null;
    S.caches.landPaths = null;
    S.caches.precip = null;
    S.caches.coastSteps = null;
    S.caches.riverSteps = null;
    S.caches.regionOfCell = null;
    S.caches.unifiedLandPaths = null;
    S.caches.riverPolys = null;
    S.caches.ports = null;
    S.caches.roadUsage = null;
    S.caches.isLake = null;
    S.caches.lakeId = null;
    S.caches.lakes = null;
    S.caches.mesh = null; // TODO: Reset mesh cache
    return;
  }
  for (const k of keys) if (k in S.caches) S.caches[k] = null;
}

export function setIsWater(arr) { S.caches.isWater = arr || null; }
export function setLandPaths(paths) { S.caches.landPaths = paths || null; }
export function setPrecip(arr) { S.caches.precip = arr || null; }
export function getPrecip() { return S.caches.precip; }
export function setCoastSteps(arr) { S.caches.coastSteps = arr || null; }
export function setRiverSteps(arr) { S.caches.riverSteps = arr || null; }
export function setRegionOfCell(arr) { S.caches.regionOfCell = arr || null; }
export function setUnifiedLandPaths(paths) { S.caches.unifiedLandPaths = paths || null; }
export function setRiverPolys(polys) { S.caches.riverPolys = polys || null; }
export function setPorts(ports) { S.caches.ports = ports || null; }
export function setRoadUsage(usage) { S.caches.roadUsage = usage || null; }
export function setIsLake(arr) { S.caches.isLake = arr || null; }
export function setLakeId(arr) { S.caches.lakeId = arr || null; }
export function setLakes(lakes) { S.caches.lakes = lakes || null; }

export function setBurgs(burgs) { S.burgs = burgs || []; }
export function setMacroCapitals(capitals) { S.macroCapitals = capitals; }
export function setRegenerationCount(count) { S.regenerationCount = count; }
export function setCurrentViewMode(mode) { S.currentViewMode = mode; }

/** Ensure isWater array is computed and cached */
export function ensureIsWater(cells) {
  if (S.caches.isWater?.length === cells?.length) return S.caches.isWater;
  
  const sea = Number.isFinite(S?.params?.seaLevel) ? S.params.seaLevel : 0.20;
  
  const out = new Uint8Array(cells?.length || 0);
  
  for (let i = 0; i < out.length; i++) {
    const c = cells[i] || {};
    const h = (c.high ?? c.h ?? 0);
    const isWater = (c.water ?? c.isWater ?? (h < sea)) ? 1 : 0;
    out[i] = isWater;
  }
  
  S.caches.isWater = out;
  return out;
}

/** Standard "world" shape that callers use throughout the app. */
export function getWorld() {
  // Get width/height from DOM if available, otherwise use stored values
  let width = S.width, height = S.height;
  if (typeof d3 !== 'undefined' && typeof document !== 'undefined') {
    const mapElement = document.getElementById('map');
    if (mapElement) {
      width = +mapElement.getAttribute('width') || S.width;
      height = +mapElement.getAttribute('height') || S.height;
    }
  }
  
  return {
    s: S, // Keep backward compatibility
    width: width,
    height: height,
    cells: S.cells,
    edges: S.edges,
    vertices: S.vertices,
    isWater: S.caches.isWater || [],
    burgs: S.burgs,
    regionOfCell: S.caches.regionOfCell || null,
    coastSteps: S.caches.coastSteps || null,
    riverSteps: S.caches.riverSteps || null,
    landPaths: S.caches.landPaths || null,
  };
}

export function computeLandFraction(cells, sea) {
  let land = 0;
  for (const c of cells) if ((c.high ?? c.h ?? 0) >= sea) land++;
  return land / (cells.length || 1);
}

export function tuneSeaLevelToTarget(cells, { target=0.35, step=0.01, maxIters=40 } = {}) {
  if (!S.params) S.params = {};
  if (!Number.isFinite(S.params.seaLevel)) S.params.seaLevel = 0.22;
  for (let it=0; it<maxIters; it++) {
    const lf = computeLandFraction(cells, S.params.seaLevel);
    // Move sea up if too much land, down if too little
    if (lf > target + 0.02) { S.params.seaLevel += step; }
    else if (lf < target - 0.02) { S.params.seaLevel -= step; }
    else break;
  }
  // clamp
  S.params.seaLevel = Math.max(0.02, Math.min(0.80, S.params.seaLevel));
  return S.params.seaLevel;
}


