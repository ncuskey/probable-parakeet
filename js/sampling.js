// js/sampling.js — Safe-zone seeding helpers for high-energy features
import { S } from './state.js';

/**
 * Convert window percentages to pixel coordinates
 */
export function windowToPixels(win, width, height) {
  return {
    x0: Math.max(0, Math.floor(win.left  * width)),
    x1: Math.min(width,  Math.ceil (win.right * width)),
    y0: Math.max(0, Math.floor(win.top   * height)),
    y1: Math.min(height, Math.ceil (win.bottom* height))
  };
}

/**
 * Sample random (x,y) coordinates within a window
 */
export function sampleXYInWindow(rng, width, height, win) {
  // Handle both function and object RNG formats
  const rngFunc = typeof rng === 'function' ? rng : rng.float || (() => Math.random());
  const x = (win.left + (win.right - win.left) * rngFunc());
  const y = (win.top  + (win.bottom- win.top ) * rngFunc());
  return [x * width, y * height];
}

/**
 * Pick a random cell whose polygon centroid lies in the window
 */
export function sampleCellInWindow(mesh, rng, win, maxTries = 80) {
  // Handle both function and object RNG formats
  const rngFunc = typeof rng === 'function' ? rng : rng.float || (() => Math.random());
  
  // Handle both new mesh and old WORLD structures
  let N, width, height;
  if (mesh.cells?.polygons) {
    // New mesh structure
    N = mesh.cells.polygons.length;
    width = mesh.width;
    height = mesh.height;
  } else if (mesh.cells?.length) {
    // Old WORLD structure
    N = mesh.cells.length;
    width = mesh.width;
    height = mesh.height;
  } else {
    return -1; // Invalid mesh structure
  }
  
  let tries = 0;
  while (tries++ < maxTries) {
    const i = Math.floor(rngFunc() * N);
    
    let cx, cy;
    if (mesh.cells?.polygons?.[i]) {
      // New mesh structure - compute centroid from polygon
      const poly = mesh.cells.polygons[i];
      if (!poly || poly.length < 6) continue;
      cx = 0; cy = 0;
      for (let p = 0; p < poly.length; p += 2) { cx += poly[p]; cy += poly[p+1]; }
      cx /= poly.length/2; cy /= poly.length/2;
    } else if (mesh.cells?.[i]) {
      // Old WORLD structure - use cell centroid directly
      const cell = mesh.cells[i];
      cx = cell.cx;
      cy = cell.cy;
    } else {
      continue;
    }

    const u = cx / width, v = cy / height;
    if (u >= win.left && u <= win.right && v >= win.top && v <= win.bottom) return i;
  }
  return -1; // caller will fallback
}

/**
 * Get the seed window for a given feature kind
 */
export function getSeedWindow(kind) {
  const z = S.seedZones?.[kind];
  if (z) return z;
  return { left: 0.2, right: 0.8, top: 0.2, bottom: 0.8 };
}

/**
 * Main entry: get an (x,y) seed for a given kind, honoring safe zones if enabled.
 */
export function seededXY(mesh, rng, kind) {
  // Handle both function and object RNG formats
  const rngFunc = typeof rng === 'function' ? rng : rng.float || (() => Math.random());
  
  if (!S.enforceSeedSafeZones) {
    return [rngFunc()*mesh.width, rngFunc()*mesh.height];
  }
  const win = getSeedWindow(kind);
  return sampleXYInWindow(rngFunc, mesh.width, mesh.height, win);
}

/**
 * Main entry: get a cell index seed for a given kind, honoring safe zones if enabled.
 */
export function seededCell(mesh, rng, kind) {
  // Handle both function and object RNG formats
  const rngFunc = typeof rng === 'function' ? rng : rng.float || (() => Math.random());
  
  if (!S.enforceSeedSafeZones) {
    // Handle both new mesh and old WORLD structures
    const cellCount = mesh.cells?.polygons?.length || mesh.cells?.length || 1000;
    return Math.floor(rngFunc() * cellCount);
  }
  const win = getSeedWindow(kind);
  const idx = sampleCellInWindow(mesh, rngFunc, win, S.seedSafeZoneRetries || 80);
  if (idx >= 0) return idx;
  // Fallback: sample xy inside window and return nearest cell
  const [x,y] = sampleXYInWindow(rngFunc, mesh.width, mesh.height, win);
  // Find nearest cell using centroids
  let best = 0, bd = Infinity;
  const cellCount = mesh.cells?.polygons?.length || mesh.cells?.length || 1000;
  for (let i = 0; i < cellCount; i++) {
    let cx, cy;
    if (mesh.cells?.centroids) {
      cx = mesh.cells.centroids[2*i];
      cy = mesh.cells.centroids[2*i+1];
    } else if (mesh.cells?.[i]) {
      cx = mesh.cells[i].cx;
      cy = mesh.cells[i].cy;
    } else {
      continue;
    }
    const dx = cx - x, dy = cy - y;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/**
 * Optional: draw translucent debug rects
 */
export function ensureSeedZoneOverlay(svgRoot, mesh) {
  if (!S.showSeedZones) return;
  const svg = svgRoot || document.querySelector('svg');
  if (!svg) return;
  let g = svg.querySelector('#seed-zones');
  if (!g) {
    g = document.createElementNS(svg.namespaceURI, 'g');
    g.setAttribute('id','seed-zones');
    g.setAttribute('pointer-events','none');
    svg.appendChild(g);
  }
  g.innerHTML = '';
  const kinds = Object.keys(S.seedZones || {});
  for (const k of kinds) {
    const win = S.seedZones[k];
    const r = document.createElementNS(svg.namespaceURI, 'rect');
    r.setAttribute('x', (win.left*mesh.width).toFixed(1));
    r.setAttribute('y', (win.top*mesh.height).toFixed(1));
    r.setAttribute('width', ((win.right-win.left)*mesh.width).toFixed(1));
    r.setAttribute('height', ((win.bottom-win.top)*mesh.height).toFixed(1));
    r.setAttribute('fill', 'rgba(255,255,0,0.06)');
    r.setAttribute('stroke', 'rgba(255,200,0,0.5)');
    r.setAttribute('stroke-dasharray','4 3');
    r.setAttribute('data-kind', k);
    g.appendChild(r);
  }
}
