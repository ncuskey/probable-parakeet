// js/generators/azgaar-lite.js
// Azgaar-lite: minimal, JSFiddle-faithful terrain
// No overscan, no falloff, no moat, no erosion, no tuning.
// Dependencies: d3-delaunay (preferred) or existing Delaunay/Voronoi you already bundle.

import { state } from '../state.js';

// ---------- Seeded RNG functions ----------
function hash32(str){
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function sfc32(a, b, c, d){
  return function() {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0; 
    let t = (a + b) | 0;
    a = b ^ b >>> 9;
    b = (c + (c << 3)) | 0;
    c = (c << 21 | c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

function makeRng(seedStr){
  const s1 = hash32(seedStr + ':a');
  const s2 = hash32(seedStr + ':b');
  const s3 = hash32(seedStr + ':c');
  const s4 = hash32(seedStr + ':d');
  const rng = sfc32(s1, s2, s3, s4);
  // warm up
  for (let i=0;i<15;i++) rng();
  return rng;
}

// Simple Poisson disc sampler (returns a function that yields points)
function poissonDiscSampler(width, height, radius, rng) {
  const k = 30; // attempts per active point
  const cellSize = radius / Math.SQRT2;
  const gridW = Math.ceil(width / cellSize);
  const gridH = Math.ceil(height / cellSize);
  const grid = new Int32Array(gridW * gridH).fill(-1);
  const points = [];
  const active = [];

  function gridIndex(x, y) { return (y * gridW + x) | 0; }

  function insert(p, idx) {
    const gx = Math.floor(p[0] / cellSize);
    const gy = Math.floor(p[1] / cellSize);
    grid[gridIndex(gx, gy)] = idx;
  }

  function inRange(p) { 
    return p[0] >= 0 && p[0] < width && p[1] >= 0 && p[1] < height; 
  }

  function isFar(p) {
    const gx = Math.floor(p[0] / cellSize);
    const gy = Math.floor(p[1] / cellSize);
    
    for (let y = Math.max(0, gy - 2); y <= Math.min(gridH - 1, gy + 2); y++) {
      for (let x = Math.max(0, gx - 2); x <= Math.min(gridW - 1, gx + 2); x++) {
        const gi = gridIndex(x, y);
        if (grid[gi] !== -1) {
          const q = points[grid[gi]];
          const dx = q[0] - p[0], dy = q[1] - p[1];
          if (dx * dx + dy * dy < radius * radius) return false;
        }
      }
    }
    return true;
  }

  // Seed with initial point
  const p0 = [rng() * width, rng() * height];
  points.push(p0); 
  active.push(0); 
  insert(p0, 0);

  // Return generator function
  return function() {
    if (active.length === 0) return null;
    
    const i = active[(active.length * rng()) | 0];
    let found = false;
    
    for (let n = 0; n < k; n++) {
      const r = radius * (1 + rng());
      const theta = 2 * Math.PI * rng();
      const p = [
        points[i][0] + r * Math.cos(theta), 
        points[i][1] + r * Math.sin(theta)
      ];
      
      if (inRange(p) && isFar(p)) {
        points.push(p);
        insert(p, points.length - 1);
        active.push(points.length - 1);
        found = true; 
        break;
      }
    }
    
    if (!found) {
      const last = active.pop();
      if (last !== i) {
        const idx = active.indexOf(i);
        if (idx !== -1) active[idx] = last;
      }
    }
    
    return points[points.length - 1];
  };
}

// NEW: Quantile helper for percentile sea level
function quantile01(arr, p) {
  const a = Array.from(arr); // copy
  a.sort((x,y)=>x-y);
  if (a.length === 0) return 0;
  const i = Math.max(0, Math.min(a.length-1, Math.floor(p * (a.length - 1))));
  return a[i];
}

// NEW: Analytic safe-zone seeding helpers

// Does a cell's polygon touch the frame?
function cellTouchesFrame(poly, W, H, eps = 1e-6) {
  for (let p = 0; p < poly.length; p += 2) {
    const x = poly[p], y = poly[p + 1];
    if (x <= eps || x >= W - eps || y <= eps || y >= H - eps) return true;
  }
  return false;
}

// BFS graph distance (in cells) from each cell to the frame
function distToFrame(world) {
  const { polygons, neighbors, width: W, height: H } = world;
  const N = polygons.length;
  const dist = new Int32Array(N).fill(-1);
  const q = [];
  for (let i = 0; i < N; i++) {
    if (cellTouchesFrame(polygons[i], W, H)) { dist[i] = 0; q.push(i); }
  }
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi], d = dist[i] + 1;
    for (const j of neighbors[i]) if (dist[j] === -1) { dist[j] = d; q.push(j); }
  }
  return dist;
}

// Expected multiplicative falloff per ring.
// In the fiddle: mod ~ U[1.1 - sharpness, 1.1] → E[mod] = 1.1 - 0.5*sharpness.
function meanFalloff(radius, sharpness) {
  const m = (1.1 - 0.5 * (sharpness ?? 0.2));
  return Math.max(0.01, Math.min(0.999, (radius ?? 0.9) * m));
}

// How many neighbor rings until a value drops below sea?
// k = ceil( log(sea/height0) / log(f) ) with safety padding
function influenceSteps(height0, radius, sharpness, sea, safetySteps = null) {
  if (!(height0 > sea)) return 0;
  const f = meanFalloff(radius, sharpness);
  const k = Math.ceil(Math.log(sea / height0) / Math.log(f));
  return Math.max(0, k + (safetySteps ?? state.safeZone?.safetySteps ?? 2));
}

// NEW: Safe cell picker with window + min distance to frame
function pickCellInWindowSafe(world, rng, win, minDistSteps, opts = {}) {
  const { width: W, height: H, findCell, sites, distFrame } = world;
  const maxTries = opts.maxTries ?? state.safeZone?.maxTries ?? state.seedSafeZoneRetries ?? 80;
  const maxHeightAllowed = opts.maxHeightAllowed ?? Infinity;
  const Hfield = opts.Hfield ?? null;

  const WminX = win.left * W, WmaxX = win.right * W;
  const WminY = win.top  * H, WmaxY = win.bottom * H;

  let best = -1, bestd = -1;

  for (let t = 0; t < maxTries; t++) {
    const x = (win.left + (win.right - win.left) * rng()) * W;
    const y = (win.top  + (win.bottom - win.top ) * rng()) * H;
    const i = findCell(x, y);
    if (i == null || i < 0) continue;

    const [sx, sy] = sites[i];
    if (sx < WminX || sx > WmaxX || sy < WminY || sy > WmaxY) continue;
    if (Hfield && Hfield[i] > maxHeightAllowed) continue;

    const d = distFrame[i];
    if (d > minDistSteps) return i;       // success
    if (d > bestd) { bestd = d; best = i; } // remember farthest-in-window
  }
  return best >= 0 ? best : world.findCell(W * 0.5, H * 0.5);
}

// ---------- Voronoi via d3-delaunay (or your internal) ----------
function buildVoronoi(points, width, height) {
  const D = d3.Delaunay.from(points);
  const V = D.voronoi([0, 0, width, height]);
  const N = points.length;

  const polygons = new Array(N);
  const neighbors = new Array(N);
  for (let i = 0; i < N; i++) {
    polygons[i] = V.cellPolygon(i).flat();          // [x0,y0,x1,y1,...]
    neighbors[i] = Array.from(D.neighbors(i));      // indices
  }

  // sites: one per cell, matches JSFiddle's use of polygon.data[0/1]
  const sites = new Array(N);
  for (let i = 0; i < N; i++) {
    sites[i] = [D.points[2 * i], D.points[2 * i + 1]];
  }

  const findCell = (x, y) => D.find(x, y);

  const world = {
    delaunay: D, voronoi: V, polygons, neighbors, sites, findCell, width, height
  };
  world.distFrame = distToFrame(world); // ⬅️ NEW
  return world;
}

// ---------- Blob growth (BFS over neighbors) ----------
function growBlob(polygons, neighbors, start, opts, rng) {
  const { maxHeight, radius, sharpness } = opts;
  const N = polygons.length;
  const H = new Float32Array(N);      // height field
  const used = new Uint8Array(N);
  const q = [start]; used[start]=1; H[start]+=maxHeight;

  for (let qi=0; qi<q.length && H[q[qi]]>0.01; qi++){
    const i = q[qi];
    let h = H[i] * radius;
    for (const n of neighbors[i]) {
      if (used[n]) continue;
      let mod = rng()*sharpness + 1.1 - sharpness;
      if (sharpness === 0) mod = 1;
      H[n] += h * mod;
      if (H[n] > 1) H[n] = 1;
      used[n] = 1;
      q.push(n);
    }
  }
  return H;
}

// ---------- Feature marking (border flood like fiddle) ----------
function markFeatures(polygons, neighbors, H, seaLevel, width, height) {
  const N = polygons.length;
  const type = new Uint8Array(N); // 0=unmarked,1=Ocean,2=Island,3=Lake
  const name = new Array(N);      // optional
  const isLand = new Uint8Array(N);
  for (let i=0;i<N;i++) isLand[i] = H[i] >= seaLevel ? 1 : 0;

  // ocean flood from a border cell (use corner 0,0 like fiddle)
  // find cell nearest (0,0)
  let start = 0, sx=Infinity;
  for (let i=0;i<N;i++){
    const p = polygons[i];
    const dx=p[0]-0, dy=p[1]-0;
    const d = dx*dx+dy*dy;
    if (d<sx) {sx=d; start=i;}
  }
  const q=[start], used=new Uint8Array(N);
  used[start]=1; type[start]=1;
  while(q.length){
    const i=q.shift();
    for (const n of neighbors[i]){
      if (used[n]) continue;
      if (!isLand[n]) { type[n]=1; used[n]=1; q.push(n); }
    }
  }

  // islands & lakes: BFS unmarked sets
  let island=0, lake=0;
  for(let i=0;i<N;i++){
    if (type[i]) continue;
    const land = !!isLand[i];
    const mark = land ? 2 : 3;
    const q2=[i]; type[i]=mark;
    while(q2.length){
      const j=q2.shift();
      for (const n of neighbors[j]){
        if (type[n]) continue;
        if (!!isLand[n] === land) { type[n]=mark; q2.push(n); }
      }
    }
    if (land) island++; else lake++;
  }

  return { isLand, isOcean: type.map ? type.map(v=>v===1) : Uint8Array.from(type,v=>+(v===1)), type };
}

// ---------- Robust coastline extraction (no rounding) ----------

// canonical string for an endpoint with high precision
function vkey(x, y) {
  // 1e-6 precision is plenty for d3-voronoi floating points
  return `${x.toFixed(6)}|${y.toFixed(6)}`;
}

// canonical undirected key for an edge (order-independent)
function ekey(a, b) {
  const ka = vkey(a[0], a[1]);
  const kb = vkey(b[0], b[1]);
  return ka < kb ? `${ka}__${kb}` : `${kb}__${ka}`;
}

/**
 * Build a global edge map from all cell polygons.
 * Each unique Voronoi segment will end up with up to two adjacent cells.
 */
function buildEdgeMap(polygons) {
  const map = new Map(); // ekey -> { a:[x,y], b:[x,y], cells:[i,j?] }
  for (let i = 0; i < polygons.length; i++) {
    const poly = polygons[i];
    if (!poly || poly.length < 6) continue;
    for (let p = 0; p < poly.length; p += 2) {
      const x1 = poly[p], y1 = poly[p + 1];
      const p2 = (p + 2) % poly.length;
      const x2 = poly[p2], y2 = poly[p2 + 1];
      const a = [x1, y1], b = [x2, y2];
      const k = ekey(a, b);
      let rec = map.get(k);
      if (!rec) {
        rec = { a, b, cells: [i] };
        map.set(k, rec);
      } else if (rec.cells.length === 1 && rec.cells[0] !== i) {
        rec.cells.push(i);
      } // ignore rare >2 due to numerical quirks
    }
  }
  return map;
}

/**
 * Extract only those edges that separate land from ocean.
 * - Ignores frame edges (they have only one adjacent cell in the map).
 * - Returns undirected segments as [ [x1,y1], [x2,y2] ].
 */
function coastSegments(polygons, isLand, isOcean) {
  const edgeMap = buildEdgeMap(polygons);
  const segs = [];
  for (const rec of edgeMap.values()) {
    if (!rec.cells || rec.cells.length !== 2) continue; // frame edge -> skip
    const [i, j] = rec.cells;
    const li = !!isLand[i], lj = !!isLand[j];
    if (li === lj) continue; // not a land-water boundary
    // (Optional: if you want only ocean coasts, ensure the water side is ocean)
    const waterIsOcean = li ? !!isOcean[j] : !!isOcean[i];
    if (!waterIsOcean) continue;
    segs.push([rec.a, rec.b]);
  }
  return segs;
}

/**
 * Chain segments into closed loops by exact endpoint keys.
 * Pick the next edge by smallest left-turn to keep a smooth traversal.
 */
function chainCoastLoops(segments) {
  // adjacency map: vkey -> [{pt:[x,y], other:[x,y]}...]
  const adj = new Map();
  const pushAdj = (k, from, to) => {
    if (!adj.has(k)) adj.set(k, []);
    adj.get(k).push({ pt: to, other: from });
  };
  const used = new Set(); // stores ekey for used segments

  for (const [a, b] of segments) {
    const ka = vkey(a[0], a[1]);
    const kb = vkey(b[0], b[1]);
    const ke = ekey(a, b);
    if (used.has(ke)) continue;
    pushAdj(ka, a, b);
    pushAdj(kb, b, a);
  }

  const loops = [];

  // angle helper
  const angle = (ax, ay, bx, by, cx, cy) => {
    const ux = bx - ax, uy = by - ay;
    const vx = cx - bx, vy = cy - by;
    return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); // signed turn
  };

  function takeNext(curr, prev) {
    const k = vkey(curr[0], curr[1]);
    const list = (adj.get(k) || []).filter(({ pt }) => !used.has(ekey(curr, pt)));
    if (list.length === 0) return null;
    if (!prev) return list[0].pt; // any start
    // choose the smallest left turn (more continuous)
    let best = list[0].pt, bestTurn = Infinity;
    for (const { pt } of list) {
      const t = Math.abs(angle(prev[0], prev[1], curr[0], curr[1], pt[0], pt[1]));
      if (t < bestTurn) { bestTurn = t; best = pt; }
    }
    return best;
  }

  // iterate edges; build loops
  for (const [a, b] of segments) {
    const ke = ekey(a, b);
    if (used.has(ke)) continue;

    const loop = [a];
    let prev = null;
    let curr = a;

    // walk forward until we close
    // guard against pathological long runs
    for (let iter = 0; iter < 10000; iter++) {
      const next = takeNext(curr, prev);
      if (!next) break;
      used.add(ekey(curr, next));
      loop.push(next);
      prev = curr;
      curr = next;
      if (vkey(curr[0], curr[1]) === vkey(loop[0][0], loop[0][1])) break;
    }

    if (loop.length >= 3) loops.push(loop);
  }

  return loops;
}

// Chaikin smoothing (closed)
function smoothChaikinClosed(points, iters=2, t=0.25){
  let pts = points;
  for (let it=0; it<iters; it++){
    const out=[];
    for (let i=0;i<pts.length;i++){
      const p=pts[i], q=pts[(i+1)%pts.length];
      out.push([(1-t)*p[0]+t*q[0], (1-t)*p[1]+t*q[1]]);
      out.push([t*p[0]+(1-t)*q[0], t*p[1]+(1-t)*q[1]]);
    }
    pts=out;
  }
  return pts;
}

// ---------- Public entry ----------
export function generateAzgaarLite(opts = {}) {
  const W = opts.width  ?? state.width;
  const H = opts.height ?? state.height;
  const pr = opts.poissonRadius ?? state.poissonRadius;

  const rng = makeRng(opts.seed ?? state.rngSeed);

  // 1) Voronoi
  const sampler = poissonDiscSampler(W, H, pr, rng);
  const pts = []; for (let s; (s = sampler()); ) pts.push(s);
  const world = buildVoronoi(pts, W, H);

  const win = state.seedWindow;
  // conservative sea threshold for safe-zone math
  const seaRef = (state.seaLevelMode === 'fixed' ? (state.seaLevel ?? 0.2) : 0.2);

  // === Big island ===
  const kIsland = influenceSteps(
    state.blob.maxHeight ?? 0.9,
    state.blob.radius ?? 0.90,
    state.blob.sharpness ?? 0.2,
    seaRef
  );
  const start = pickCellInWindowSafe(world, rng, win, kIsland);
  let Hfield = growBlob(world.polygons, world.neighbors, start, state.blob, rng);

  // === Optional 2nd big island ===
  if (state.secondBlobEnabled) {
    const amp = Math.max(0, Math.min(1, state.secondBlobScale ?? 0.7));
    const k2 = influenceSteps(
      (state.blob.maxHeight ?? 0.9) * amp,
      state.blob.radius ?? 0.90,
      state.blob.sharpness ?? 0.2,
      seaRef
    );
    const start2 = pickCellInWindowSafe(world, rng, win, k2);
    const H2 = growBlob(world.polygons, world.neighbors, start2, {
      maxHeight: (state.blob.maxHeight ?? 0.9) * amp,
      radius: state.blob.radius ?? 0.90,
      sharpness: state.blob.sharpness ?? 0.2
    }, rng);
    for (let i = 0; i < Hfield.length; i++) Hfield[i] = Math.min(1, Hfield[i] + H2[i]);
  }

  // === Small hills ===
  const hillsCount = opts.randomSmallHills ?? state.randomSmallHills;
  for (let h = 0; h < hillsCount; h++) {
    const h0 = rng() * 0.4 + 0.1; // same as fiddle
    const kHill = influenceSteps(h0, 0.99, state.blob.sharpness ?? 0.2, seaRef);
    const rnd = pickCellInWindowSafe(world, rng, win, kHill, {
      maxHeightAllowed: 0.25, // fiddle behavior
      Hfield
    });
    const add = growBlob(world.polygons, world.neighbors, rnd, {
      maxHeight: h0,
      radius: 0.99,
      sharpness: state.blob.sharpness
    }, rng);
    for (let i = 0; i < Hfield.length; i++) Hfield[i] = Math.min(1, Hfield[i] + add[i]);
  }

  // === Sea level + water + robust coasts (unchanged) ===
  let sea = opts.seaLevel ?? state.seaLevel ?? 0.2;
  if (state.seaLevelMode === 'percentile') sea = quantile01(Hfield, state.seaPercentile ?? 0.35);

  const water = markFeatures(world.polygons, world.neighbors, Hfield, sea, W, H);
  const segments = coastSegments(world.polygons, water.isLand, water.isOcean);
  let loops = chainCoastLoops(segments);
  loops = loops.map(l => smoothChaikinClosed(l, state.smoothCoastIters));

  return {
    width: W, height: H, polygons: world.polygons, neighbors: world.neighbors, sites: world.sites,
    height: Hfield, seaLevel: sea, isLand: water.isLand, isOcean: water.isOcean, coastLoops: loops
  };
}
