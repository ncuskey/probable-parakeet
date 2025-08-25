// js/geom/cellpaths.js
export function polygonToPath(poly) {
  if (!poly || poly.length < 3) return null;
  let s = `M${poly[0][0]},${poly[0][1]}`;
  for (let i = 1; i < poly.length; i++) s += `L${poly[i][0]},${poly[i][1]}`;
  return s + 'Z';
}

export function buildCellPaths(S) {
  const mesh  = S.mesh;
  const world = S.world;
  if (!mesh?.voronoi || !world?.cells) throw new Error('Missing mesh.voronoi or world.cells');

  const cells = world.cells;
  let built = 0, skipped = 0;

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    // Prefer existing cache
    if (c.path && c.path.length > 2) { built++; continue; }

    // Get polygon from voronoi; fallback to any existing c.poly
    let poly = (typeof mesh.voronoi.cellPolygon === 'function')
      ? mesh.voronoi.cellPolygon(i)
      : (c.poly || null);

    if (!poly || poly.length < 3) { skipped++; continue; }

    c.poly  = poly;
    c.path  = polygonToPath(poly);
    c.index = (c.index ?? i);
    c.id    = (c.id    ?? i);
    built++;
  }

  console.log('[cellpaths] built:', built, 'skipped:', skipped, 'total:', cells.length);
  return { built, skipped, total: cells.length };
}
