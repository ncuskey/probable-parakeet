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

// ---------- Coastlines (land↔water edges) ----------
function coastEdges(polygons, neighbors, isLand, isOcean){
  const N = polygons.length;
  const edges = [];
  for (let i=0;i<N;i++){
    if (!isLand[i]) continue;
    const poly = polygons[i];
    // loop polygon edges, test neighbor water
    for (let p=0;p<poly.length;p+=2){
      const x1=poly[p], y1=poly[p+1];
      const p2=(p+2)%poly.length;
      const x2=poly[p2], y2=poly[p2+1];
      // decide if this edge borders ocean: check any neighbor that shares it
      // (cheap check: if any neighbor is ocean and has a nearly-collinear matching segment)
      let oceanTouch=false;
      for (const n of neighbors[i]){
        if (!isOcean[n]) continue;
        const polyN = polygons[n];
        for (let k=0;k<polyN.length;k+=2){
          const nx1=polyN[k], ny1=polyN[k+1];
          const k2=(k+2)%polyN.length;
          const nx2=polyN[k2], ny2=polyN[k2+1];
          // share if endpoints equal (within epsilon)
          const e = 1e-6;
          const same = (Math.hypot(nx1-x2,ny1-y2)<e && Math.hypot(nx2-x1,ny2-y1)<e) ||
                       (Math.hypot(nx1-x1,ny1-y1)<e && Math.hypot(nx2-x2,ny2-y2)<e);
          if (same){ oceanTouch=true; break; }
        }
        if (oceanTouch) break;
      }
      if (oceanTouch) edges.push([[x1,y1],[x2,y2]]);
    }
  }
  return edges;
}

// chain edges into loops (very small, robust)
function chainLoops(edges){
  const map = new Map();
  const key = ([x,y]) => `${Math.round(x*100)}/${Math.round(y*100)}`;
  for (const [a,b] of edges){
    const ka=key(a), kb=key(b);
    if (!map.has(ka)) map.set(ka,[]);
    if (!map.has(kb)) map.set(kb,[]);
    map.get(ka).push(kb);
    map.get(kb).push(ka);
  }
  const used = new Set();
  const loops = [];
  for (const [a,b] of edges){
    const ek = key(a)+'|'+key(b);
    if (used.has(ek)) continue;
    let curr = [a,b]; used.add(ek);
    // forward
    while(true){
      const last = curr[curr.length-1];
      const arr = map.get(key(last))||[];
      const next = arr.find(k => {
        const npt = k.split('/').map(v=>parseFloat(v)/100);
        const ek2 = key(last)+'|'+k;
        return !used.has(ek2);
      });
      if (!next) break;
      const [nx,ny] = next.split('/').map(v=>parseFloat(v)/100);
      used.add(key(last)+'|'+next);
      curr.push([nx,ny]);
      if (Math.hypot(nx-curr[0][0], ny-curr[0][1]) < 1e-6) break;
    }
    if (curr.length>=3) loops.push(curr);
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

  // a few random hills (like Random map)
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
  const sea = opts.seaLevel ?? state.seaLevel;
  const water = markFeatures(polygons, neighbors, Hfield, sea, W, H);

  // 4) Coastlines
  const edges = coastEdges(polygons, neighbors, water.isLand, water.isOcean);
  let loops = chainLoops(edges);
  loops = loops.map(l => smoothChaikinClosed(l, state.smoothCoastIters));

  return {
    width: W, height: H,
    polygons, neighbors,
    height: Hfield, seaLevel: sea,
    isLand: water.isLand, isOcean: water.isOcean,
    coastLoops: loops
  };
}
