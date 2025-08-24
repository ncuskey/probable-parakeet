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

// ---------- Voronoi via d3-delaunay (or your internal) ----------
function buildVoronoi(points, width, height) {
  const DelaunayCtor = (window.d3 && window.d3.Delaunay) || (window.d3 && window.d3.voronoi && null);
  if (!DelaunayCtor) {
    throw new Error('d3-delaunay not found: please expose d3.Delaunay');
  }
  const D = DelaunayCtor.from(points);
  const V = D.voronoi([0,0,width,height]);
  const N = points.length;

  // polygons + neighbors like the fiddle
  const polygons = new Array(N);
  const neighbors = new Array(N);
  for (let i=0;i<N;i++){
    polygons[i] = V.cellPolygon(i).flat();               // [x0,y0,x1,y1,...]
    neighbors[i] = Array.from(D.neighbors(i));           // indices
  }
  return { delaunay: D, voronoi: V, polygons, neighbors, width, height };
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
  const { polygons, neighbors } = buildVoronoi(pts, W, H);

  // 2) Heights via blob growth
  // big island: seed inside central window
  const win = state.seedWindow;
  const cx = (win.left + (win.right-win.left)*rng()) * W;
  const cy = (win.top  + (win.bottom-win.top)*rng()) * H;
  // find nearest cell to (cx,cy)
  let start=0, dmin=Infinity;
  for (let i=0;i<polygons.length;i++){
    const dx=polygons[i][0]-cx, dy=polygons[i][1]-cy, d=dx*dx+dy*dy;
    if (d<dmin){dmin=d; start=i;}
  }
  let Hfield = growBlob(polygons, neighbors, start, state.blob, rng);

  // 2b) Optional second big island (archipelago-lite)
  if (state.secondBlobEnabled) {
    // pick another center inside the same window; try to keep some distance
    let cx2, cy2, tries = 0;
    do {
      cx2 = (win.left + (win.right - win.left) * rng()) * W;
      cy2 = (win.top  + (win.bottom - win.top ) * rng()) * H;
      tries++;
    } while (tries < 20 && Math.hypot(cx2 - cx, cy2 - cy) < 0.18 * Math.min(W,H)); // ~18% min spacing

    // nearest cell to (cx2,cy2)
    let start2 = 0, dmin2 = Infinity;
    for (let i=0;i<polygons.length;i++){
      const dx=polygons[i][0]-cx2, dy=polygons[i][1]-cy2, d=dx*dx+dy*dy;
      if (d<dmin2){dmin2=d; start2=i;}
    }
    const amp = Math.max(0, Math.min(1, state.secondBlobScale ?? 0.7));
    const H2 = growBlob(polygons, neighbors, start2, {
      maxHeight: (state.blob.maxHeight ?? 0.9) * amp,
      radius: state.blob.radius ?? 0.90,
      sharpness: state.blob.sharpness ?? 0.2
    }, rng);
    for (let i=0;i<Hfield.length;i++) Hfield[i] = Math.min(1, Hfield[i] + H2[i]);
  }

  // 2c) Small random hills (like Random map)
  for (let k=0;k<(opts.randomSmallHills ?? state.randomSmallHills); k++){
    const rnd = (rng()*polygons.length)|0;
    const add = growBlob(polygons, neighbors, rnd, {
      maxHeight: rng()*0.4 + 0.1,  // ← rng
      radius: 0.99,
      sharpness: state.blob.sharpness
    }, rng);
    for (let i=0;i<Hfield.length;i++) Hfield[i] = Math.min(1, Hfield[i] + add[i]);
  }

  // 3) Water classes (fixed threshold + border flood)
  let sea = opts.seaLevel ?? state.seaLevel ?? 0.2;
  if (state.seaLevelMode === 'percentile') {
    sea = quantile01(Hfield, state.seaPercentile ?? 0.35);
  }
  const water = markFeatures(polygons, neighbors, Hfield, sea, W, H);

  // 4) Coastlines
  const segments = coastSegments(polygons, water.isLand, water.isOcean);
  let loops = chainCoastLoops(segments);
  loops = loops.map(l => smoothChaikinClosed(l, state.smoothCoastIters));

  return {
    width: W, height: H,
    polygons, neighbors,
    height: Hfield, seaLevel: sea,
    isLand: water.isLand, isOcean: water.isOcean,
    coastLoops: loops
  };
}
