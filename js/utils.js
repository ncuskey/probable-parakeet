// js/utils.js — pure helpers (no DOM/d3)

//// RNG //////////////////////////////////////////////////////////

/** Deterministic seeded RNG. Keep the original implementation from legacy-main.js. */
export function mulberry32(seed) {
  return function() {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Convenience: get a rng from a (possibly falsy) seed. */
export function rngFromSeed(seed, fallback = 12345) {
  return mulberry32(Number.isFinite(+seed) ? +seed : fallback);
}

export function randRange(rng, min = 0, max = 1) {
  return min + (max - min) * rng();
}

export function choice(rng, array) {
  return array[array.length * rng() | 0];
}

export function shuffleInPlace(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

//// Math /////////////////////////////////////////////////////////

export function clamp(x, min, max) {
  return x < min ? min : x > max ? max : x;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function distance(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  return Math.hypot(dx, dy);
}

export function sqr(v) { 
  return v * v; 
}

export function dist2(a, b) { 
  return sqr(a.x - b.x) + sqr(a.y - b.y); 
}

export function dist(a, b) { 
  return Math.hypot(a.x - b.x, a.y - b.y); 
}

export function almostEq(a, b, eps = 1e-9) { 
  return Math.abs(a - b) <= eps; 
}

//// Geometry / Curves ///////////////////////////////////////////

/** Chaikin smoothing; pure array -> array. Keep existing impl if present. */
export function chaikin(points, iters = 2) {
  let pts = points.slice();
  for (let k = 0; k < iters; k++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i+1)%pts.length];
      const Q = [0.75*a[0] + 0.25*b[0], 0.75*a[1] + 0.25*b[1]];
      const R = [0.25*a[0] + 0.75*b[0], 0.25*a[1] + 0.75*b[1]];
      out.push(Q, R);
    }
    pts = out;
  }
  return pts;
}

export function angleDeg(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const m1 = Math.hypot(v1x, v1y) || 1, m2 = Math.hypot(v2x, v2y) || 1;
  const cos = (v1x*v2x + v1y*v2y) / (m1*m2);
  return Math.acos(Math.max(-1, Math.min(1, cos))) * 180/Math.PI;
}

export function colinear(a, b, c, angleTolDeg) { 
  return angleDeg(a, b, c) <= angleTolDeg; 
}

export function totalPolylineLen(pl) { 
  let L = 0; 
  for (let i = 1; i < pl.length; i++) L += dist(pl[i-1], pl[i]); 
  return L; 
}

//// Legacy Stubs ////////////////////////////////////////////////

// TODO: Step 2.5 - Legacy no-op: always "inside mask"
export function ovalMaskValue(/* x, y or cell */) { return 1.0; }

export function dedupePolyline(pl) { 
  if (!pl || pl.length < 2) return pl; 
  const out = [pl[0]]; 
  for (let i = 1; i < pl.length; i++) { 
    const prev = out[out.length-1]; 
    const cur = pl[i]; 
    if (dist(prev, cur) < 0.5) continue; 
    out.push(cur);
  } 
  return out; 
}
