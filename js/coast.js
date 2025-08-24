// js/coast.js — Build coastline polylines from Voronoi shared edges (land↔ocean), then smooth.

function key2(x, y, snapPow) {
  // snapPow = 10^snapDigits
  return (Math.round(x * snapPow)) + "," + (Math.round(y * snapPow));
}

function edgeKey(a, b) {
  return a < b ? a + "|" + b : b + "|" + a;
}

export function coastPolylines(mesh, isLand, isOcean, { snapDigits = 2 } = {}) {
  const snapPow = Math.pow(10, snapDigits);
  const polys = mesh.cells.polygons;
  const N = polys.length;

  // 1) collect candidate edges with their two incident cells
  const E = new Map(); // key -> {a, b, v1:[x,y], v2:[x,y]}
  for (let i = 0; i < N; i++) {
    const poly = polys[i];
    for (let p = 0; p < poly.length; p += 2) {
      const x1 = poly[p], y1 = poly[p + 1];
      const p2 = (p + 2) % poly.length;
      const x2 = poly[p2], y2 = poly[p2 + 1];
      const k1 = key2(x1, y1, snapPow), k2 = key2(x2, y2, snapPow);
      const ek = edgeKey(k1, k2);
      const rec = E.get(ek);
      if (!rec) E.set(ek, { a: i, b: -1, v1: [x1, y1], v2: [x2, y2], k1, k2 });
      else rec.b = i;
    }
  }

  // 2) keep only land↔ocean edges
  const edges = [];
  for (const rec of E.values()) {
    const la = rec.a >= 0 && isLand[rec.a];
    const lb = rec.b >= 0 && isLand[rec.b];
    const oa = rec.a >= 0 && isOcean[rec.a];
    const ob = rec.b >= 0 && isOcean[rec.b];
    const border = rec.b < 0; // clipped by frame

    if ((la && (ob || border)) || (lb && (oa || border))) {
      edges.push(rec);
    }
  }

  // 3) chain edges into closed polylines (using snapped endpoints)
  const adj = new Map(); // pointKey -> array of neighbor pointKeys (and original float coords)
  function pushAdj(a, b, va, vb) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push({ k: b, v: vb });
    adj.get(b).push({ k: a, v: va });
  }
  for (const e of edges) pushAdj(e.k1, e.k2, e.v1, e.v2);

  const used = new Set();
  const loops = [];

  function takeNext(startK) {
    // build one loop starting from startK
    let currK = startK;
    const ring = [];
    let prevK = null;
    while (true) {
      const nbrs = adj.get(currK) || [];
      // pick a neighbor edge we haven't consumed
      let next = null;
      for (const n of nbrs) {
        const ek = edgeKey(currK, n.k);
        if (!used.has(ek)) { next = n; used.add(ek); break; }
      }
      if (!next) break;
      // move
      const currNbrs = adj.get(currK).find(n => n.k === next.k);
      if (ring.length === 0) {
        // push real coords for start
        const first = (adj.get(currK)[0] || {}).v || edges[0].v1;
        ring.push(first);
      }
      ring.push(next.v);
      prevK = currK;
      currK = next.k;
      if (currK === startK) break;
    }
    if (ring.length >= 3) loops.push(ring);
  }

  for (const e of edges) {
    const ek = edgeKey(e.k1, e.k2);
    if (!used.has(ek)) takeNext(e.k1);
  }

  return loops; // array of [[x,y], ...] closed
}

export function smoothClosedChaikin(points, iters = 2, t = 0.25) {
  let pts = points;
  for (let it = 0; it < iters; it++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const Q = [ (1 - t) * p[0] + t * q[0], (1 - t) * p[1] + t * q[1] ];
      const R = [ t * p[0] + (1 - t) * q[0], t * p[1] + (1 - t) * q[1] ];
      out.push(Q, R);
    }
    pts = out;
  }
  return pts;
}
