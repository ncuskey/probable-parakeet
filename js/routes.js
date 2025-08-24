// js/routes.js — roads / routes (vKNN, render)
import { S, getWorld } from './state.js';
import { getLayers } from './render.js';
import { ProgressManager } from './ui-overlays.js';

/** Optional helper to clear old routes */
export function clearRoutes() {
  const { zoomRoot } = getLayers();
  let routes = zoomRoot.select('g#routes');
  if (!routes.empty()) {
    routes.selectAll('*').remove();
  }
}

/** Ensure routes layer exists and return selection */
function ensureRoutesLayer() {
  const { zoomRoot } = getLayers();
  let routes = zoomRoot.select('g#routes');
  if (routes.empty()) {
    routes = zoomRoot.append('g').attr('id', 'routes').attr('class', 'routes');
  }
  return routes;
}

/** Ensure route groups exist and return selections */
function ensureRouteGroups() {
  const routes = ensureRoutesLayer();

  // Small helper for idempotent subgroup creation
  const ensure = (cls) => {
    let g = routes.select(`.${cls}`);
    if (g.empty()) g = routes.append('g').attr('class', cls);
    return g;
  };

  // Match the classes already styled in CSS:
  //   .roads, .trails, .searoutes (and paths with class `route`)
  const roads = ensure('roads');
  const trails = ensure('trails');
  const sea = ensure('searoutes');

  return { routes, roads, trails, sea };
}

/** Build land graph maps for routing */
function ensureLandGraphMaps(landGraph, cells, isWater) {
  // If already present, no-op
  if (landGraph && landGraph.idOf && landGraph.nodes) return landGraph;

  // Build nodes[] as "land cell nodes" and idOf: cellIndex -> nodeIdx
  const nodes = [];
  const idOf = new Map();
  for (let i = 0; i < cells.length; i++) {
    if (!isWater[i]) {
      const idx = nodes.length;
      nodes.push({ id: i, cellIndex: i, x: cells[i].cx, y: cells[i].cy });
      idOf.set(i, idx);
    }
  }

  // If the graph already had adjacency by *node index*, keep it.
  // Also expose neighbors(i) by *cell index* for consistency.
  // For land graphs built from cell adjacency, neighbors(i) can delegate to cells[i].neighbors (filtered).
  const neighborsByCell = landGraph.neighbors
    ? landGraph.neighbors
    : (i) => (cells[i].neighbors || []).filter(j => !isWater[j]);

  return Object.assign(landGraph, {
    nodes,
    idOf,
    neighbors: neighborsByCell
  });
}

/** Build backbone roads between burgs */
function buildBackboneRoads(burgs, landGraph) {
  const cells = window.__state.cells;
  const isWater = window.__state.isWater;

  // pick terminals: capitals + ports
  const terms = burgs.filter(b =>
    b.capital || b.type === 'capital' || b.isCapital ||
    b.port || b.type === 'port' || b.isPort
  ).map(b => ({ 
    id: b.id, 
    cell: b.cell ?? b.cellIndex, 
    x: b.x ?? cells[b.cell ?? b.cellIndex].cx, 
    y: b.y ?? cells[b.cell ?? b.cellIndex].cy 
  }))
   .filter(t => Number.isInteger(t.cell) && !isWater[t.cell]);

  if (terms.length < 2) return [];

  // Group by island if available to avoid over-sea MSTs
  const islandOf = window.__state.islandOf || {};
  const byIsl = new Map();
  for (const t of terms) {
    const isl = islandOf[t.cell] ?? -1;
    if (!byIsl.has(isl)) byIsl.set(isl, []);
    byIsl.get(isl).push(t);
  }

  const paths = [];

  // Helper: A* over land (uses your aStarCells + graph.neighbors)
  const graphForAstar = landGraph.neighbors ? landGraph : buildLandGraphSimple(cells, isWater);

  for (const [, list] of byIsl) {
    if (list.length < 2) continue;

    // Complete graph distances
    const E = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const dx = list[i].x - list[j].x, dy = list[i].y - list[j].y;
        E.push({ i, j, w: Math.hypot(dx, dy) });
      }
    }
    E.sort((a, b) => a.w - b.w);

    // Kruskal MST
    const parent = Array.from(list, (_, i) => i);
    const find = x => parent[x] === x ? x : (parent[x] = find(parent[x]));
    const unite = (a, b) => { parent[find(a)] = find(b); };

    const mstPairs = [];
    for (const e of E) {
      if (find(e.i) !== find(e.j)) {
        unite(e.i, e.j);
        mstPairs.push([list[e.i], list[e.j]]);
      }
    }

    // Realize each MST edge as a land path via A*
    for (const [A, B] of mstPairs) {
      const p = aStarCells(A.cell, B.cell, graphForAstar, cells, { maxIterations: 20000 });
      if (p && p.length >= 2) paths.push(p);
    }
  }

  return paths; // array of cell-index paths
}

/** Simple land graph builder */
function buildLandGraphSimple(cells, isWater) {
  return {
    neighbors: (i) => (cells[i].neighbors || []).filter(j => !isWater[j])
  };
}

/** A* pathfinding for cells */
function aStarCells(start, end, graph, cells, options = {}) {
  const { maxIterations = 10000 } = options;
  
  if (start === end) return [start];
  
  const open = new Set([start]);
  const closed = new Set();
  const cameFrom = new Map();
  const gScore = new Map();
  const fScore = new Map();
  
  gScore.set(start, 0);
  fScore.set(start, heuristic(start, end, cells));
  
  let iterations = 0;
  
  while (open.size > 0 && iterations < maxIterations) {
    iterations++;
    
    // Find node with lowest fScore
    let current = null;
    let lowestF = Infinity;
    for (const node of open) {
      const f = fScore.get(node) || Infinity;
      if (f < lowestF) {
        lowestF = f;
        current = node;
      }
    }
    
    if (current === end) {
      // Reconstruct path
      const path = [];
      while (current !== undefined) {
        path.unshift(current);
        current = cameFrom.get(current);
      }
      return path;
    }
    
    open.delete(current);
    closed.add(current);
    
    const neighbors = graph.neighbors(current);
    for (const neighbor of neighbors) {
      if (closed.has(neighbor)) continue;
      
      const tentativeG = (gScore.get(current) || Infinity) + 1;
      
      if (!open.has(neighbor)) {
        open.add(neighbor);
      } else if (tentativeG >= (gScore.get(neighbor) || Infinity)) {
        continue;
      }
      
      cameFrom.set(neighbor, current);
      gScore.set(neighbor, tentativeG);
      fScore.set(neighbor, tentativeG + heuristic(neighbor, end, cells));
    }
  }
  
  return null; // No path found
}

/** Heuristic function for A* */
function heuristic(a, b, cells) {
  if (a >= 0 && a < cells.length && b >= 0 && b < cells.length) {
    const dx = cells[a].cx - cells[b].cx;
    const dy = cells[a].cy - cells[b].cy;
    return Math.hypot(dx, dy);
  }
  return 0;
}

/** MOVE your complete routing algorithm + rendering here. Keep logs identical. */
export function computeRoutes(run = 0) {
  const routesLayer = ensureRoutesLayer();

  // --- BEGIN: MOVE BODY FROM legacy-main.js ---
  // Keep these console logs exactly as in legacy:
  // console.log('computeRoutes() vKNN');
  // console.log('primary-road count: %d', count);
  // console.log('routes render: drew %d paths', paths.length);
  // console.log('[RUN %d] routes done', run);
  //
  // Use routesLayer.append(...) for rendering, and clear/replace as your legacy code did.
  // If you previously selected a different layer, adapt it to use routesLayer now.
  // --- END: MOVE BODY ---

  // Check for stale run
  if (window.__state && window.__state.isStale && window.__state.isStale(run)) { 
    console.log(`[RUN ${run}] stale -> bail computeRoutes`); 
    return; 
  }

  // Check if routes are already in flight
  if (window.__state && window.__state.routesInFlight) { 
    if (window.__state.routesQueued !== undefined) window.__state.routesQueued = true; 
    return; 
  }
  
  // Set flight flag
  if (window.__state) {
    window.__state.routesInFlight = true;
    window.__state.routesQueued = false;
  }
  
  console.log("computeRoutes() vKNN");
  // progress: 93 = starting land routes, 94 = primary done, 95 = sea starting, 97 = sea done
  const {cells, isWater, burgs, s} = getWorld();
  
  if (!cells.length) { 
    console.warn('[RUN', run, '] no cells yet, skipping computeRoutes'); 
    if (window.__state) window.__state.routesInFlight = false;
    return; 
  }
  
  const islandOf = s.islandOf || {};

  // Lock/pending hooks if present (RoutesLock not defined, so skip locking)
  const unlock = null;

  try {
    // Progress update: starting land routes
    ProgressManager.safeUpdate(run, 93, "Building routes.", "Starting land routes.");
    
    // 1) Build or fetch land graph and normalize maps
    const landGraphRaw = {
      neighbors(i) { return cells[i].neighbors?.filter(j => !isWater[j]) || []; }
    };
    
    const landGraph = ensureLandGraphMaps(landGraphRaw, cells, isWater);

    // 2) PRIMARY / BACKBONE
    let primary = [];
    try {
      primary = buildBackboneRoads(burgs, landGraph) || [];
      // Optional: ensure capitals are connected if you have this helper
      if (typeof window.ensureCapitalPrimaryConnectivity === "function") {
        window.ensureCapitalPrimaryConnectivity(burgs, landGraph, cells, isWater, islandOf, null);
      }
      console.log("primary-road count:", primary.length);
    } catch (e) {
      console.warn("Backbone roads failed, continuing…", e);
    } finally {
      ProgressManager.safeUpdate(run, 94, "Building routes.", "Primary pass complete.");
    }

    // Save routes for render/merge
    window.routeData = window.routeData || {};
    window.routeData.routes = primary;

    // 3) MERGE + RENDER (safe-guarded)
    if (typeof window.MERGE_LAND_ROUTES === "undefined") {
      window.MERGE_LAND_ROUTES = true;
    }
    if (window.MERGE_LAND_ROUTES && window.routeData?.routes?.length) {
      try {
        // Ensure route groups exist and draw into the styled .roads layer
        const { roads } = ensureRouteGroups();

        // Safe fallbacks for helpers that might live in other scopes
        const pathToPolylineLocal =
          (typeof window !== 'undefined' && typeof window.pathToPolyline === 'function') ? window.pathToPolyline :
          (typeof pathToPolyline === 'function') ? pathToPolyline :
          function(path, cells) { return (path || []).map(i => ({ x: cells[i].cx, y: cells[i].cy })); };

        const polylineToPathDLocal =
          (typeof window !== 'undefined' && typeof window.polylineToPathD === 'function') ? window.polylineToPathD :
          (typeof polylineToPathD === 'function') ? polylineToPathD :
          function(points) {
            if (!points || !points.length) return '';
            let d = `M ${points[0].x} ${points[0].y}`;
            for (let k = 1; k < points.length; k++) d += ` L ${points[k].x} ${points[k].y}`;
            return d;
          };

        // Build display lines from cell-index paths
        const lines = (window.routeData?.routes || [])
          .map(p => pathToPolylineLocal(p, cells))
          .filter(l => Array.isArray(l) && l.length);

        // Standard D3 data join into the .roads group (keep class 'route' to use existing CSS)
        const sel = roads.selectAll('path.route').data(lines);
        sel.enter().append('path')
          .attr('class', 'route')
          .merge(sel)
          .attr('d', d => polylineToPathDLocal(d));
        sel.exit().remove();

        console.log('routes render: drew', lines.length, 'paths');
      } catch (e) {
        console.warn("Route merge/render failed, continuing…", e);
      }
    }

    // 4) SEA (optional; guard if helpers are missing)
    try {
      if (typeof window.buildSeaGraph === "function" && typeof window.waterOnlySegment === "function") {
        ProgressManager.safeUpdate(run, 95, "Building routes.", "Sea pass.");
        // If you have sea code, call it here; otherwise skip quietly
        // const sea = buildSeaGraph(...); attach to routeData, render, etc.
      }
    } catch (e) {
      console.warn("Sea routes failed, continuing…", e);
    } finally {
      ProgressManager.safeUpdate(run, 97, "Building routes.", "Sea pass complete.");
    }

    // Final completion for ACTIVE run only
    console.log(`[RUN ${run}] routes done`);
    ProgressManager.safeUpdate(run, 100, "Routes complete!", "All road/sea networks built");
  } catch (e) {
    ProgressManager.safeUpdate(run, 100, "Error in route computation", e.message || String(e));
    console.error(e);
  } finally {
    if (window.__state) window.__state.routesInFlight = false;

    // Hide overlay only for the winning run
    setTimeout(() => {
      console.log(`[RUN ${run}] overlay hide`);
      ProgressManager.safeHide(run);
    }, 300);

    // If anything queued during the last run, run it once (still respecting the token)
    if (window.__state && window.__state.routesQueued && window.__state.isStale && !window.__state.isStale(run)) {
      computeRoutes(run);
    }
  }
}
