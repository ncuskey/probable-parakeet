// TODO: Step 2 - Elevation generation with templates, noise, and auto sea-level tuning
import { makeNoise2D, fbm2, warp2 } from './noise.js';

/** Template functions: return base 0..1 shape before noise */
function radialIslandTemplate(cx, cy, x, y) {
  const dx = (x - cx), dy = (y - cy);
  const r = Math.hypot(dx, dy);
  // map radius to [0,1] with gentle rim falloff
  // assume map diagonal for normalization inside caller
  return 1 - r; // (we'll normalize later)
}

function continentalGradientTemplate(width, height, x, y, dir = 'WtoE') {
  // simple linear gradient, then we'll curve it a bit with a cosine
  let t = 0;
  if (dir === 'WtoE') t = x / width;
  if (dir === 'EtoW') t = 1 - x / width;
  if (dir === 'NtoS') t = y / height;
  if (dir === 'StoN') t = 1 - y / height;
  // curve central mass up
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

function twinContinentsTemplate(width, height, x, y) {
  const cx1 = width * 0.33, cx2 = width * 0.67, cy = height * 0.5;
  const d1 = Math.hypot(x - cx1, y - cy);
  const d2 = Math.hypot(x - cx2, y - cy);
  const r1 = 1 - d1, r2 = 1 - d2;
  return Math.max(r1, r2);
}

function normalize01(arr) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const span = (mx - mn) || 1;
  for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] - mn) / span;
}

function percentile(arr, p) {
  // arr is Float32Array; copy indexes to avoid mutating original
  const n = arr.length;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a,b) => arr[a] - arr[b]);
  const k = Math.max(0, Math.min(n - 1, Math.floor(p * (n - 1))));
  return arr[idx[k]];
}

function computeSlope(mesh, height) {
  const N = height.length;
  const slope = new Float32Array(N);
  const { neighbors, centroids } = mesh.cells;
  for (let i = 0; i < N; i++) {
    const xi = centroids[2*i], yi = centroids[2*i+1];
    let maxg = 0;
    const ns = neighbors[i];
    for (let n = 0; n < ns.length; n++) {
      const j = ns[n];
      const xj = centroids[2*j], yj = centroids[2*j+1];
      const dij = Math.hypot(xj - xi, yj - yi) || 1;
      const g = Math.abs(height[j] - height[i]) / dij;
      if (g > maxg) maxg = g;
    }
    slope[i] = Math.min(1, maxg * 1000); // scale for visualization
  }
  return slope;
}

function bfsDistanceToCoast(mesh, isCoast) {
  const N = isCoast.length;
  const dist = new Float32Array(N).fill(Infinity);
  const q = [];
  for (let i = 0; i < N; i++) if (isCoast[i]) { dist[i] = 0; q.push(i); }
  const { neighbors, centroids } = mesh.cells;
  while (q.length) {
    const i = q.shift();
    const xi = centroids[2*i], yi = centroids[2*i+1];
    const ns = neighbors[i];
    for (let k = 0; k < ns.length; k++) {
      const j = ns[k];
      const xj = centroids[2*j], yj = centroids[2*j+1];
      const w = Math.hypot(xj - xi, yj - yi);
      const nd = dist[i] + w;
      if (nd + 1e-6 < dist[j]) { dist[j] = nd; q.push(j); }
    }
  }
  return dist;
}

export function generateElevation(mesh, state) {
  const { width, height } = mesh;
  const N = mesh.points.length / 2;
  const { template = 'radialIsland', templateDir = 'WtoE' } = state;
  const { baseNoiseScale = 450, baseNoiseOctaves = 5, baseNoiseGain = 0.5, baseNoiseLac = 2.0 } = state;
  const { warpScale = 350, warpAmp = 45 } = state;

  const noise2 = makeNoise2D(state.seed);
  const elevation = new Float32Array(N);

  // precompute normalizers
  const cx = width * 0.5, cy = height * 0.5;
  const diag = Math.hypot(width, height);

  for (let i = 0; i < N; i++) {
    let x = mesh.cells.centroids[2*i], y = mesh.cells.centroids[2*i+1];

    // 1) template base
    let t0 = 0;
    if (template === 'radialIsland') {
      t0 = radialIslandTemplate(cx, cy, x, y);
      t0 = (t0 / (0.5 * diag));  // scale radius to ~0..1 range
      t0 = Math.max(0, 1 - Math.min(1, t0)); // invert & clamp for island (high center)
    } else if (template === 'continentalGradient') {
      t0 = continentalGradientTemplate(width, height, x, y, templateDir);
    } else if (template === 'twinContinents') {
      const r = Math.max(
        1 - (Math.hypot(x - width*0.33, y - cy) / (0.45 * diag)),
        1 - (Math.hypot(x - width*0.67, y - cy) / (0.45 * diag))
      );
      t0 = Math.max(0, r);
    } else {
      t0 = continentalGradientTemplate(width, height, x, y, 'WtoE');
    }

    // 2) domain warp (low-frequency deformation)
    const [wx, wy] = warp2(noise2, x, y, { scale: warpScale, amp: warpAmp });

    // 3) FBM noise
    const n = fbm2(noise2, wx, wy, {
      octaves: baseNoiseOctaves,
      lacunarity: baseNoiseLac,
      gain: baseNoiseGain,
      scale: baseNoiseScale
    }); // [-1,1]

    // 4) blend template with noise (bias so template dominates large shape)
    const v = 0.72 * t0 + 0.28 * ((n + 1) * 0.5); // 0..1-ish
    elevation[i] = v;
  }

  // Normalize 0..1
  normalize01(elevation);

  // Auto-tune sea level to match target land fraction
  const target = Math.max(0.05, Math.min(0.90, state.targetLandFrac || 0.35));
  // choose threshold as (1 - target) percentile of elevation (since land = elevation > seaLevel)
  const seaLevel = percentile(elevation, 1 - target);

  const isLand = new Uint8Array(N);
  for (let i = 0; i < N; i++) isLand[i] = elevation[i] > seaLevel ? 1 : 0;

  // Coast mask: land cell with ≥1 ocean neighbor
  const isCoast = new Uint8Array(N);
  const neighbors = mesh.cells.neighbors;
  for (let i = 0; i < N; i++) {
    if (!isLand[i]) continue;
    const ns = neighbors[i];
    for (let k = 0; k < ns.length; k++) {
      if (!isLand[ns[k]]) { isCoast[i] = 1; break; }
    }
  }

  // Slope (for shading & later path/rivers)
  const slope = computeSlope(mesh, elevation);

  // Distance to coast (graph metric, for rivers/biomes later)
  const distToCoast = bfsDistanceToCoast(mesh, isCoast);

  return { height: elevation, seaLevel, isLand, isCoast, distToCoast, slope };
}
