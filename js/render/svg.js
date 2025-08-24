// js/render/svg.js — Minimal SVG helpers (mask + rendering)

function ensure(parent, selector, create) {
  let el = parent.querySelector(selector);
  if (!el) {
    el = create();
    parent.appendChild(el);
  }
  return el;
}

export function ensureSvgScene({ svgId = 'map', oceanColor = '#5E4FA2' } = {}) {
  const svg = document.getElementById(svgId) || document.querySelector('svg');
  if (!svg) throw new Error('SVG root not found');

  // <defs><mask id="shape"><rect fill="white"/><g id="mask-islands"/></mask></defs>
  const defs = ensure(svg, 'defs', () => document.createElementNS('http://www.w3.org/2000/svg', 'defs'));
  let mask = defs.querySelector('#shape');
  if (!mask) {
    mask = document.createElementNS(svg.namespaceURI, 'mask');
    mask.setAttribute('id', 'shape');
    defs.appendChild(mask);
    const white = document.createElementNS(svg.namespaceURI, 'rect');
    white.setAttribute('x', '0'); white.setAttribute('y', '0');
    white.setAttribute('width', '100%'); white.setAttribute('height', '100%');
    white.setAttribute('fill', 'white');
    mask.appendChild(white);
    const hole = document.createElementNS(svg.namespaceURI, 'g');
    hole.setAttribute('id', 'mask-islands');
    mask.appendChild(hole);
  }
  // shallow hatch pattern (optional)
  if (!defs.querySelector('#shallowHatch')) {
    const pat = document.createElementNS(svg.namespaceURI, 'pattern');
    pat.setAttribute('id', 'shallowHatch');
    pat.setAttribute('width', '2'); pat.setAttribute('height', '4');
    pat.setAttribute('patternUnits', 'userSpaceOnUse');
    pat.setAttribute('patternTransform', 'rotate(90 0 0)');
    const ln = document.createElementNS(svg.namespaceURI, 'line');
    ln.setAttribute('x1','0'); ln.setAttribute('y1','0'); ln.setAttribute('x2','0'); ln.setAttribute('y2','4');
    ln.setAttribute('style','stroke:black;stroke-width:0.5;fill:black;');
    pat.appendChild(ln);
    defs.appendChild(pat);
  }

  // Ocean background rect (masked)
  let ocean = svg.querySelector('#ocean-bg');
  if (!ocean) {
    ocean = document.createElementNS(svg.namespaceURI, 'rect');
    ocean.setAttribute('id', 'ocean-bg');
    ocean.setAttribute('x','0'); ocean.setAttribute('y','0');
    ocean.setAttribute('width','100%'); ocean.setAttribute('height','100%');
    ocean.setAttribute('fill', oceanColor);
    ocean.setAttribute('mask', 'url(#shape)');
    svg.appendChild(ocean);
  }

  // World group (scaled/translated elsewhere)
  let world = svg.querySelector('#world');
  if (!world) {
    world = document.createElementNS(svg.namespaceURI, 'g');
    world.setAttribute('id', 'world');
    svg.appendChild(world);
  }

  // Coast + shallow layers
  const coastG = ensure(world, '#coastline', () => {
    const g = document.createElementNS(svg.namespaceURI, 'g');
    g.setAttribute('id', 'coastline');
    g.setAttribute('fill', 'none');
    g.setAttribute('stroke', 'black');
    g.setAttribute('stroke-width', '0.6');
    g.setAttribute('stroke-linejoin', 'round');
    return g;
  });

  const shallowG = ensure(world, '#shallow', () => {
    const g = document.createElementNS(svg.namespaceURI, 'g');
    g.setAttribute('id', 'shallow');
    g.setAttribute('fill', 'url(#shallowHatch)');
    g.setAttribute('opacity', '0.8');
    return g;
  });

  return { svg, defs, mask, world, coastG, shallowG };
}

export function updateOceanMaskWithIslands(polylines, svgRoot) {
  const hole = svgRoot.querySelector('#mask-islands');
  while (hole.firstChild) hole.removeChild(hole.firstChild);
  for (const loop of polylines) {
    const path = document.createElementNS(svgRoot.namespaceURI, 'path');
    let d = `M ${loop[0][0]} ${loop[0][1]}`;
    for (let i = 1; i < loop.length; i++) d += ` L ${loop[i][0]} ${loop[i][1]}`;
    d += ' Z';
    path.setAttribute('d', d);
    path.setAttribute('fill', 'black'); // punch a hole in the mask
    hole.appendChild(path);
  }
}

export function drawCoastlines(polylines, coastG, { smoothIters = 2 } = {}) {
  while (coastG.firstChild) coastG.removeChild(coastG.firstChild);
  for (const loop of polylines) {
    const path = document.createElementNS(coastG.namespaceURI, 'path');
    let d = `M ${loop[0][0]} ${loop[0][1]}`;
    for (let i = 1; i < loop.length; i++) d += ` L ${loop[i][0]} ${loop[i][1]}`;
    d += ' Z';
    path.setAttribute('d', d);
    coastG.appendChild(path);
  }
}

export function drawShallowCells(mesh, shallowMask, shallowG) {
  while (shallowG.firstChild) shallowG.removeChild(shallowG.firstChild);
  const polys = mesh.cells.polygons;
  for (let i = 0; i < shallowMask.length; i++) {
    if (!shallowMask[i]) continue;
    const poly = polys[i];
    const p = document.createElementNS(shallowG.namespaceURI, 'path');
    let d = `M ${poly[0]} ${poly[1]}`;
    for (let j = 2; j < poly.length; j += 2) d += ` L ${poly[j]} ${poly[j+1]}`;
    d += ' Z';
    p.setAttribute('d', d);
    shallowG.appendChild(p);
  }
}
