// TODO: Step 2.5 - Water classification and coast/distance helpers (FMG-style)
export function classifyWater(mesh, elevation, seaLevel) {
  const N = elevation.length;
  const isWater = new Uint8Array(N);
  for (let i = 0; i < N; i++) isWater[i] = elevation[i] <= seaLevel ? 1 : 0;

  const { width, height } = mesh;
  const { polygons, neighbors } = mesh.cells;
  const edgeEps = 1e-6;

  // helper: does a cell polygon touch the bounding box?
  function touchesBorder(poly) {
    for (let i = 0; i < poly.length; i += 2) {
      const x = poly[i], y = poly[i + 1];
      if (x <= edgeEps || y <= edgeEps || x >= width - edgeEps || y >= height - edgeEps) return true;
    }
    return false;
  }

  // Ring-buffer queue (faster than shift())
  const isOcean = new Uint8Array(N);
  const q = new Int32Array(N);
  let qh = 0, qt = 0;

  // seed with any water cell that touches the border
  for (let i = 0; i < N; i++) {
    if (isWater[i] && touchesBorder(polygons[i])) {
      isOcean[i] = 1;
      q[qt++] = i;
    }
  }

  // flood across water neighbors to mark the entire ocean set
  while (qh < qt) {
    const i = q[qh++]; // pop head
    const ns = neighbors[i];
    for (let k = 0; k < ns.length; k++) {
      const j = ns[k];
      if (!isOcean[j] && isWater[j]) {
        isOcean[j] = 1;
        q[qt++] = j;
      }
    }
  }

  // lakes = water that isn't ocean
  const isLake = new Uint8Array(N);
  for (let i = 0; i < N; i++) isLake[i] = (isWater[i] && !isOcean[i]) ? 1 : 0;

  return { isWater, isOcean, isLake };
}

export function computeCoastAndDistance(mesh, isLand, isOcean) {
  const N = isLand.length;
  const { neighbors, centroids } = mesh.cells;

  // coast = land with ≥1 ocean neighbor (NOT lake)
  const isCoast = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!isLand[i]) continue;
    const ns = neighbors[i];
    for (let k = 0; k < ns.length; k++) {
      if (isOcean[ns[k]]) { isCoast[i] = 1; break; }
    }
  }

  // BFS distances from coast over land graph
  const distToCoast = new Float32Array(N);
  distToCoast.fill(Infinity);

  const q = new Int32Array(N);
  let qh = 0, qt = 0;

  for (let i = 0; i < N; i++) if (isCoast[i]) { distToCoast[i] = 0; q[qt++] = i; }

  while (qh < qt) {
    const i = q[qh++];
    const xi = centroids[2*i], yi = centroids[2*i + 1];
    const ns = neighbors[i];
    for (let k = 0; k < ns.length; k++) {
      const j = ns[k];
      if (!isLand[j]) continue; // distance only for land
      // edge weight = euclidean distance between centroids
      const w = Math.hypot(centroids[2*j] - xi, centroids[2*j + 1] - yi);
      const nd = distToCoast[i] + w;
      if (nd + 1e-9 < distToCoast[j]) { distToCoast[j] = nd; q[qt++] = j; }
    }
  }

  return { isCoast, distToCoast };
}

export function computeShallow(mesh, isLand, isOcean) {
  const N = isLand.length;
  const shallow = new Uint8Array(N);
  const ns = mesh.cells.neighbors;
  for (let i = 0; i < N; i++) {
    if (!isOcean[i]) continue;
    for (let k = 0; k < ns[i].length; k++) {
      if (isLand[ns[i][k]]) { shallow[i] = 1; break; }
    }
  }
  return shallow;
}
