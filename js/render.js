// js/render.js — render layer plumbing & view-mode helpers
import { S, getWorld } from './state.js';

// Defensive guard: d3 should be loaded globally in index.html
function d3req() {
  if (!('d3' in window)) {
    console.warn('[render] d3 not found on window. Include D3 in index.html.');
  }
  return window.d3;
}

/**
 * Get (and gently normalize) main SVG layers.
 * - Ensures a #mapCells group id for selectors (keeps existing class).
 * - Returns references used by recolor/draw code.
 */
export function getLayers() {
  const d3 = d3req();
  // Heuristics: your app likely has an <svg id="mapSvg"> or similar; fall back to first SVG
  let svg = d3.select('svg#mapSvg');
  if (svg.empty()) svg = d3.select('body > svg');
  if (svg.empty()) svg = d3.select('svg');

  // Zoom root (if you use one)
  let zoomRoot = svg.select('g.zoomRoot');
  if (zoomRoot.empty()) zoomRoot = svg;

  // Cells group: accept id or class; normalize to id="mapCells"
  let mapCells = zoomRoot.select('#mapCells');
  if (mapCells.empty()) mapCells = zoomRoot.select('g.mapCells');
  if (mapCells.empty()) {
    mapCells = zoomRoot.append('g').attr('class', 'mapCells');
  }
  // normalize
  ensureMapCellsId(mapCells);

  // Regions group; keep existing if present
  let regions = zoomRoot.select('#regions');
  if (regions.empty()) regions = zoomRoot.select('g.regions');
  if (regions.empty()) regions = zoomRoot.append('g').attr('id', 'regions').attr('class', 'regions');

  return { svg, zoomRoot, mapCells, regions };
}

/** Normalize the map cells group to id="mapCells" (retain class for backwards-compat). */
export function ensureMapCellsId(selection) {
  if (!selection) return;
  const hasId = selection.attr('id') === 'mapCells';
  if (!hasId) selection.attr('id', 'mapCells');
  // ensure class is preserved
  const cls = (selection.attr('class') || '').split(/\s+/).filter(Boolean);
  if (!cls.includes('mapCells')) selection.attr('class', [...cls, 'mapCells'].join(' '));
}

/**
 * Ensure the raster <image> exists inside #mapCells for canvas-to-image terrain.
 * Returns the d3 selection for the image.
 */
export function ensureRasterImage({ width, height } = {}) {
  const d3 = d3req();
  const { mapCells } = getLayers();
  let rasterSel = mapCells.select('image#raster');
  if (rasterSel.empty()) {
    rasterSel = mapCells.insert('image', ':first-child')
      .attr('id', 'raster')
      .attr('x', 0).attr('y', 0)
      .attr('preserveAspectRatio', 'none');
  }
  if (Number.isFinite(width)) rasterSel.attr('width', width);
  if (Number.isFinite(height)) rasterSel.attr('height', height);
  return rasterSel;
}

/** View-mode toggling: add body.view-mode-<mode>, remove the others. */
export function setViewMode(mode) {
  const modes = ['terrain', 'regions'];
  if (!modes.includes(mode)) return;
  const body = document.body;
  modes.forEach(m => body.classList.toggle(`view-mode-${m}`, m === mode));

  const isRegions = mode === 'regions';
  const raster  = document.getElementById('raster') || document.querySelector('#mapCells image');
  const overlay = document.querySelector('#regions .overlay');
  if (raster)  raster.hidden  = isRegions;  // hide raster in Regions
  if (overlay) overlay.hidden = isRegions;  // hide overlay in Regions

  // Update current view mode in state
  try { 
    if (window.__state && window.__state.setCurrentViewMode) {
      window.__state.setCurrentViewMode(mode);
    }
  } catch (e) { /* noop */ }
  
  // optional repaint hook
  try { repaintCellsForMode(mode); } catch (e) { /* noop */ }
}

/**
 * Ensure proper cell layer structure with sea, cells, and grid groups.
 * Enforces stacking order and baseline styles.
 */
export function ensureCellLayer() {
  const d3 = d3req();
  const svg = d3.select('#map');           // adjust if your root id differs
  if (svg.empty()) throw new Error('#map svg root not found');

  // Ensure group order: sea under land, grid above land
  let gSea   = svg.select('#sea');
  let gCells = svg.select('#cells');
  let gGrid  = svg.select('#grid');

  if (gSea.empty())   gSea   = svg.append('g').attr('id','sea');
  if (gCells.empty()) gCells = svg.append('g').attr('id','cells');
  if (gGrid.empty())  gGrid  = svg.append('g').attr('id','grid');

  // enforce stacking (sea -> cells -> grid)
  gSea.lower();
  gGrid.raise();

  // baseline styles (inline beats most CSS)
  gSea.attr('opacity', 1.0);
  gCells.attr('opacity', 1.0);
  gGrid.attr('opacity', 1.0);

  return { gSea, gCells, gGrid };
}

/**
 * Debug utility to dump computed styles of an element.
 */
export function dumpComputed(el, label='[computed]') {
  if (!el) return console.warn(label, 'no element');
  const cs = getComputedStyle(el);
  console.log(label, {
    display: cs.display,
    visibility: cs.visibility,
    opacity: cs.opacity,
    fill: cs.fill,
    fillOpacity: cs.fillOpacity,
    stroke: cs.stroke,
    mixBlendMode: cs.mixBlendMode,
    filter: cs.filter
  });
}

/**
 * Lightweight repaint for mode switch (no heavy recompute).
 * Uses existing data attributes if your code sets them (e.g., data-terrain-fill).
 * Safe no-op if attributes weren't set yet; full recolor should still happen elsewhere.
 */
export function repaintCellsForMode(mode) {
  const d3 = d3req();
  const { mapCells } = getLayers();

  const cells = mapCells.selectAll('.mapCell');
  if (cells.empty()) return;

  if (mode === 'terrain') {
    // Prefer stored attribute if present, else keep whatever is there
    cells.attr('fill', function() {
      const el = this;
      return el.getAttribute('data-terrain-fill') ?? el.getAttribute('fill') ?? null;
    });
  } else if (mode === 'regions') {
    cells.attr('fill', function() {
      const el = this;
      return el.getAttribute('data-region-fill') ?? el.getAttribute('fill') ?? null;
    });
  }
}
