// js/state.js — Single source of truth for world + params + caches
import { mulberry32 } from './utils.js';

/**
 * Central state bag. Avoid touching DOM/d3 here.
 * Everything else should import from this module.
 */
export const S = {
  // Geometry / graph
  width: 1024,
  height: 768,
  cells: [],       // array of cell objects
  edges: [],       // optional
  vertices: [],    // optional

  // RNG / seed
  seed: 12345,
  rng: mulberry32(12345),

  // Tunables / params
  params: {
    seaLevel: 0.5,
    worldType: 'volcanicIsland',
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
  S.seed = Number.isFinite(+seed) ? +seed : 12345;
  S.rng = mulberry32(S.seed);
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
  
  const sea = S.params.seaLevel;
  const out = new Uint8Array(cells?.length || 0);
  
  for (let i = 0; i < out.length; i++) {
    const c = cells[i] || {};
    const flag = c.water ?? c.isWater ?? (c.high != null ? c.high < sea : false);
    out[i] = flag ? 1 : 0;
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


