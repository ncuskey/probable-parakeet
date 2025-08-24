// js/viewport.js — viewport utilities for overscan + fit-to-canvas

/**
 * Compute land bbox, padded rect, and world->canvas transform
 */

// Compute land bbox from mesh and land classification
export function computeLandBBox(mesh, isLand) {
  const { polygons } = mesh.cells;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let any = false;
  for (let i = 0; i < isLand.length; i++) {
    if (!isLand[i]) continue;
    const poly = polygons[i];
    for (let p = 0; p < poly.length; p += 2) {
      const x = poly[p], y = poly[p + 1];
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
    any = true;
  }
  if (!any) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Pad rectangle with margin, clamped to bounds
export function padRect(rect, pad, boundsW, boundsH) {
  if (!rect) return null;
  const x = Math.max(0, rect.x - pad);
  const y = Math.max(0, rect.y - pad);
  const x2 = Math.min(boundsW, rect.x + rect.width + pad);
  const y2 = Math.min(boundsH, rect.y + rect.height + pad);
  return { x, y, width: x2 - x, height: y2 - y };
}

// Compute fit transform to fit rect into canvas
export function fitTransformToCanvas(rect, canvasW, canvasH, { allowUpscale = false } = {}) {
  if (!rect) {
    // identity fallback
    return { s: 1, tx: 0, ty: 0, src: { x: 0, y: 0, width: canvasW, height: canvasH } };
  }
  const sx = canvasW / rect.width;
  const sy = canvasH / rect.height;
  let s = Math.min(sx, sy);
  if (!allowUpscale) s = Math.min(1, s); // only shrink by default

  const outW = rect.width * s;
  const outH = rect.height * s;
  const tx = (canvasW - outW) * 0.5 - rect.x * s;
  const ty = (canvasH - outH) * 0.5 - rect.y * s;

  return { s, tx, ty, src: rect };
}

// NEW: fit with guaranteed canvas-side margin, independent of gen bounds.
export function fitTransformWithMargin(rect, canvasW, canvasH, {
  marginPx = 24,
  allowUpscale = false
} = {}) {
  if (!rect) return { s: 1, tx: 0, ty: 0, src: { x: 0, y: 0, width: canvasW, height: canvasH } };

  const usableW = Math.max(1, canvasW - 2 * marginPx);
  const usableH = Math.max(1, canvasH - 2 * marginPx);

  let s = Math.min(usableW / rect.width, usableH / rect.height);
  if (!allowUpscale) s = Math.min(1, s);  // never >1 unless allowed

  const outW = rect.width * s;
  const outH = rect.height * s;

  // Place the rect centered inside the usable area, leaving >= marginPx on all sides
  const tx = marginPx + (usableW - outW) * 0.5 - rect.x * s;
  const ty = marginPx + (usableH - outH) * 0.5 - rect.y * s;

  return { s, tx, ty, src: rect };
}

/** Apply transform to an SVG group element <g id="world">, not the whole svg. */
export function applySvgGroupTransform(groupEl, { s, tx, ty }) {
  if (!groupEl) return;
  groupEl.setAttribute('transform', `translate(${tx.toFixed(3)},${ty.toFixed(3)}) scale(${s.toFixed(6)})`);
}
