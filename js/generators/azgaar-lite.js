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

// NEW: Quantile helper for percentile sea level
function quantile01(arr, p) {
  const a = Array.from(arr); // copy
  a.sort((x,y)=>x-y);
  if (a.length === 0) return 0;
  const i = Math.max(0, Math.min(a.length-1, Math.floor(p * (a.length - 1))));
  return a[i];
}

// NEW: JSFiddle-faithful cell picker with window + height constraints
function pickCellInWindow(world, rng, win, maxHeightAllowed = 1, maxTries = 50, Hfield = null) {
  const { width: W, height: H, findCell, sites } = world;
  for (let t = 0; t < maxTries; t++) {
    const x = (win.left + (win.right - win.left) * rng()) * W;
    const y = (win.top  + (win.bottom - win.top ) * rng()) * H;
    const i = findCell(x, y);
    if (i == null || i < 0) continue;
    if (Hfield && Hfield[i] > maxHeightAllowed) continue;  // match fiddle: skip tall cells
    const [sx, sy] = sites[i];
    // quick guard: ensure site itself is inside the window (prevents near-frame creeps)
    if (sx < win.left * W || sx > win.right * W) continue;
    if (sy < win.top  * H || sy > win.bottom * H) continue;
    return i;
  }
  // fallback: pick any cell whose site is in-window
  const WminX = win.left * world.width,  WmaxX = win.right * world.width;
  const WminY = win.top  * world.height, WmaxY = win.bottom * world.height;
  for (let i = 0; i < sites.length; i++) {
    const [sx, sy] = sites[i];
    if (sx >= WminX && sx <= WmaxX && sy >= WminY && sy <= WmaxY) {
      if (!Hfield || Hfield[i] <= maxHeightAllowed) return i;
    }
  }
  // ultimate fallback: center cell
  return world.findCell(world.width * 0.5, world.height * 0.5);
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

  return { delaunay: D, voronoi: V, polygons, neighbors, sites, findCell, width, height };
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

  const rng = makeRng(opts.seed ?? state.rngSeed);     // ← NEW

  // 1) Poisson → Voronoi (bounded to canvas)
  const sampler = poissonDiscSampler(W,H,pr, rng);   // ← pass rng
  const pts = []; for (let s; (s=sampler()); ) pts.push(s);
  const world = buildVoronoi(pts, W, H);  // has polygons, neighbors, sites, findCell

  // 2) Heights via blob growth
  const win = state.seedWindow;  // {left:.25,right:.75,top:.20,bottom:.75}

  // Big island seed (windowed)
  const start = pickCellInWindow(world, rng, win);
  let Hfield = growBlob(world.polygons, world.neighbors, start, state.blob, rng);

  // 2b) Optional second big island (archipelago-lite)
  if (state.secondBlobEnabled) {
    const start2 = pickCellInWindow(world, rng, win);
    const amp = Math.max(0, Math.min(1, state.secondBlobScale ?? 0.7));
    const H2 = growBlob(world.polygons, world.neighbors, start2, {
      maxHeight: (state.blob.maxHeight ?? 0.9) * amp,
      radius: state.blob.radius ?? 0.90,
      sharpness: state.blob.sharpness ?? 0.2
    }, rng);
    for (let i = 0; i < Hfield.length; i++) Hfield[i] = Math.min(1, Hfield[i] + H2[i]);
  }

  // 2c) Small random hills — strictly inside window AND only on low cells
  const hillsCount = opts.randomSmallHills ?? state.randomSmallHills;
  for (let k = 0; k < hillsCount; k++) {
    // JSFiddle skips cells with height > 0.25 and restricts to window (with ~50 tries)
    const rnd = pickCellInWindow(world, rng, win, /*maxHeightAllowed*/ 0.25, /*maxTries*/ 50, Hfield);
    const add = growBlob(world.polygons, world.neighbors, rnd, {
      maxHeight: rng() * 0.4 + 0.1,   // same range as fiddle
      radius: 0.99,
      sharpness: state.blob.sharpness
    }, rng);
    for (let i = 0; i < Hfield.length; i++) Hfield[i] = Math.min(1, Hfield[i] + add[i]);
  }

  // 3) Water classes (fixed threshold + border flood)
  let sea = opts.seaLevel ?? state.seaLevel ?? 0.2;
  if (state.seaLevelMode === 'percentile') {
    sea = quantile01(Hfield, state.seaPercentile ?? 0.35);
  }
  const water = markFeatures(world.polygons, world.neighbors, Hfield, sea, W, H);

  // 4) Coastlines
  const segments = coastSegments(world.polygons, water.isLand, water.isOcean);
  let loops = chainCoastLoops(segments);
  loops = loops.map(l => smoothChaikinClosed(l, state.smoothCoastIters));

  return {
    width: W, height: H,
    polygons: world.polygons,
    neighbors: world.neighbors,
    sites: world.sites,
    height: Hfield, seaLevel: sea,
    isLand: water.isLand, isOcean: water.isOcean,
    coastLoops: loops
  };
}
