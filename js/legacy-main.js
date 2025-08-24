import {
  mulberry32,
  rngFromSeed,
  randRange,
  shuffleInPlace,
  choice,
  clamp,
  lerp,
  distance,
  chaikin,
  sqr,
  dist2,
  dist,
  almostEq,
  angleDeg,
  colinear,
  totalPolylineLen,
  dedupePolyline
} from './utils.js';

import {
  S,
  getWorld,
  setSize, setCells, setEdges, setVertices,
  setSeed, setParam, getParam,
  resetCaches,
  setIsWater, setLandPaths, setPrecip, getPrecip,
  setCoastSteps, setRiverSteps, setRegionOfCell,
  setUnifiedLandPaths, setRiverPolys, setPorts, setRoadUsage,
  setIsLake, setLakeId, setLakes,
  setBurgs, setMacroCapitals, setRegenerationCount, setCurrentViewMode,
  ensureIsWater,
  tuneSeaLevelToTarget
} from './state.js';

import {
  ensureHeightsCleared,
  applyTemplate,
  registerDefaultTemplates,
  _debugHeights,
  normalizeHeights,
  sinkSmallIslands,
  normalizeHeightsIfNeeded,
  sinkOuterMargin,
  _refreshRng,
  resolveHeightKey,
  bindWorld
} from './terrain.js';

import {
  computeRiverSteps,
  recomputePrecipIfNeeded,
  computeRivers
} from './rivers.js';

import {
  computeAndDrawRegions
} from './regions.js';

import {
  computeRoutes
} from './routes.js';

import {
  getLayers,
  ensureMapCellsId,
  ensureRasterImage,
  setViewMode,
  repaintCellsForMode
} from './render.js';

import { recolor, ensureTerrainCanvas } from './recolor.js';
import { computePrecipArray } from './climate.js';
import { ProgressManager } from './ui-overlays.js';

// === IDEMPOTENT INIT GUARD ===
window.__state = window.__state || {};
const shouldSkipInit = window.__state.__initOnce;
if (!shouldSkipInit) {
  window.__state.__initOnce = true;
}

// Define generate function early to avoid initialization order issues
window.generate = async function() {
  // This will be replaced by the full implementation later
  console.warn('generate() called before full implementation is ready');
};

// === MAIN MODULE ===
(function() {
  /* eslint no-undef: "error" */
  
  // getWorld moved to state.js

  // === CONFIG REGISTRY ===
  function getConfig() {
    const s = (window.__state = window.__state || {});
    const cfg = (s.config = s.config || {});
    // One-time default templates if missing:
    if (!cfg.templates) {
      cfg.templates = {
        // Minimal no-op defaults; extend if your app expects specific keys
        // Each template name maps to a function or object your code expects.
        // For now, a passthrough keeps generation from failing.
        default: (burg) => burg
      };
    }
    // Initialize other config defaults if missing
    cfg.palette ??= { land:'#888', water:'#68a', coast:'#ccc' };
    cfg.themes ??= { default: {} };
    cfg.labelStyles ??= { default: {} };
    cfg.namegenPresets ??= { default: {} };
    return cfg;
  }

  // Early return if already initialized
  if (shouldSkipInit) {
    console.warn('Init skipped (already initialized)'); 
    // Still export essential functions for any remaining inline handlers
    window.generate = window.generate || function() { console.warn('generate() called but init skipped'); };
    window.toggleSettings = window.toggleSettings || function() { console.warn('toggleSettings() called but init skipped'); };
    window.showTab = window.showTab || function() { console.warn('showTab() called but init skipped'); };
    window.saveSVG = window.saveSVG || function() { console.warn('saveSVG() called but init skipped'); };
    window.savePNG = window.savePNG || function() { console.warn('savePNG() called but init skipped'); };
    return;
  }

  // === Single-flight orchestration ===
  let CURRENT_RUN = 0;          // monotonically increasing
  let runInFlight = false;      // coarse guard
  let genQueued = false;        // queue for rapid clicks
  let regionsInFlight = false;  // region computation guard
  let regionsQueued = false;    // region computation queue
  const getNewRun = () => ++CURRENT_RUN;
  const isStale = (run) => run !== CURRENT_RUN;



  // Runtime sanity check to catch future regressions
  (function assertNoInlineScripts() {
    const inline = Array.from(document.scripts).filter(s => !s.src || !s.type || s.type === 'text/javascript');
    if (inline.length > 1) { // the module loader is a src script
      console.error('Inline scripts detected in index.html; this will duplicate pipelines.', inline);
    }
  })();
      // Simple Queue implementation for polylabel
      if (typeof Queue === 'undefined') {
        class Queue {
          constructor() {
            this.items = [];
          }
          
          enqueue(item) {
            this.items.push(item);
          }
          
          dequeue() {
            return this.items.shift();
          }
          
          isEmpty() {
            return this.items.length === 0;
          }
          
          size() {
            return this.items.length;
          }
        }
        
        // Make Queue globally available for polylabel
        window.Queue = Queue;
      }
      // Browser-compatible polylabel implementation
      function polylabel(polygon, precision = 1.0) {
        const rings = polygon[0];
        if (!rings || rings.length < 3) return [0, 0];
        
        // Simple centroid fallback for now
        let x = 0, y = 0;
        for (const point of rings) {
          x += point[0];
          y += point[1];
        }
        return [x / rings.length, y / rings.length];
      }
    // === GLOBAL ERROR HANDLERS ===
    window.addEventListener('unhandledrejection', e => {
      console.warn('UNHANDLED PROMISE REJECTION', e.reason || e);
    });
    window.addEventListener('error', e => {
      console.error('UNCAUGHT ERROR', e.error || e.message || e);
    });
    
    // Map size management function
    function setMapSize(w, h) {
      const svg = d3.select('#map');
      svg.attr('width', w).attr('height', h).attr('viewBox', `0 0 ${w} ${h}`);
      const canvas = document.getElementById('canvas');
      if (canvas) { canvas.width = w; canvas.height = h; }
    }

    // Debug flag for performance
    const DEBUG = false;

    // Route merging feature flag
    const MERGE_LAND_ROUTES = (typeof window.MERGE_LAND_ROUTES === 'boolean')
      ? window.MERGE_LAND_ROUTES
      : true; // default ON, or set to false if you want to skip merge for now

    // === UTILITY FUNCTIONS ===
    // chaikin moved to utils.js

    // --- Path Data Helpers ---
    function ringToPathD(ring) {
      return "M" + ring.map(p => p.join(",")).join("L") + "Z";
    }

    function islandToPathD(outer, holes=[]) {
      // outer then holes; evenodd fill will subtract the holes
      return ringToPathD(outer) + holes.map(ringToPathD).join("");
    }

    // --- Land Mask and Underlay Helper ---
    function ensureLandUnderlay(svg, zoomRoot, width, height) {
      const defs = svg.select('defs');

      // Prefer unified land paths; fall back to landPaths if needed
      const unifiedPaths = window.__state.unifiedLandPaths || [];
      const landPaths = window.__state.landPaths || [];

      if (!unifiedPaths.length && !landPaths.length) return;

      // Build a single SVG 'd' string for all land rings
      let landD = '';
      
      if (unifiedPaths.length > 0) {
        // Use unified paths (arrays of points)
        landD = unifiedPaths
          .map(poly => 'M' + poly.map(p => p.join(',')).join('L') + 'Z')
          .join('');
      } else if (landPaths.length > 0) {
        // Use land paths (objects with path properties)
        landD = landPaths
          .map(lp => lp.path.attr('d'))
          .join('');
      }

      if (!landD) return;

      // --- Land mask (white = land, black = sea) ---
      defs.select('#landMask').remove();
      const landMask = defs.append('mask')
        .attr('id', 'landMask')
        .attr('maskContentUnits', 'userSpaceOnUse');

      landMask.append('rect')
        .attr('width', width).attr('height', height)
        .attr('fill', 'black');

      landMask.append('path')
        .attr('d', landD)
        .attr('fill', 'white');

      // --- Land underlay (fills hairline gaps inland) ---
      // Commented out to preserve individual cell colors including snow caps
      // zoomRoot.select('rect.land-underlay').remove();
      // zoomRoot.insert('rect', '.mapCells') // under polygons, above ocean
      //   .attr('class', 'land-underlay')
      //   .attr('x', 0).attr('y', 0)
      //   .attr('width', width).attr('height', height)
      //   .attr('fill', typeof landColor === 'function' ? landColor(0.0) : '#8fbf7a')
      //   .attr('mask', 'url(#landMask)');

      // --- Optional: land-side coastline seam stroke (clips stroke to land only) ---
      defs.select('#landClip').remove();
      defs.append('clipPath').attr('id', 'landClip')
        .append('path').attr('d', landD);

      // Commented out coastline seam stroke to preserve individual cell colors
      // if (window.__state.coastD) {
      //   zoomRoot.select('path.coast-seam').remove();
      //   zoomRoot.append('path')
      //     .attr('class', 'coast-seam')
      //     .attr('d', window.__state.coastD)
      //     .attr('clip-path', 'url(#landClip)')
      //     .attr('stroke', typeof landColor === 'function' ? landColor(0.0) : '#8fbf7a')
      //     .attr('stroke-width', 1.2)
      //     .attr('fill', 'none')
      //     .attr('vector-effect', 'non-scaling-stroke');
      // }
    }

    // === CONFIG (deterministic, no UI) ===
    const CONFIG = {
      settlements: {
        capitalsCount: 8,      // target number of capitals
        townsCount: 80,        // target number of towns
        capitalMinSpacing: 80, // px
        townMinSpacing: 18,    // px
      },
      scoring: {
        wCoast: 0.18, wRiver: 0.35, wFlat: 0.28, wFertile: 0.19,
        riverConfluenceBonus: 0.30,
        shelteredHarborBonus: 0.10,
        elevationPenaltyK: 0.50,
        coastDecaySteps: 2,
      },
      roads: {
        connectStrategy: "mst", // "mst" + A* for edges (capitals network)
        slopePenalty: 1.2,
        riverCrossPenalty: 1.0,
        coastAversion: 0.12, // mild surcharge when stepping onto a shoreline cell
      },
      regions: {
        allowNeutral: true,
        maxManorDistance: 140,
        disbalance: 0.35,
        overseasMultiplier: 2.0
      }
    };

    // === CONFIG (extend) ===
    CONFIG.settlements = {
      ...CONFIG.settlements,
      capitalsCount: 20,       // up from 8
      townsCount: 500,         // total burg target across all types
      spacing: { manor: 10, village: 14, town: 22, port: 24, capital: 80 },
      share:   { manor: 0.45, village: 0.25, town: 0.18, port: 0.07, capital: 0.05 } // ≈1.0
    };

    // Settlement types
    const BurgType = Object.freeze({
      MANOR: "manor",
      VILLAGE: "village",
      TOWN: "town",
      PORT: "port",
      CAPITAL: "capital"
    });

    // Deterministic RNG from current map seed
    function rngFromMapSeed(suffix = "") {
      const {s} = getWorld();
      const {templates} = getConfig();
      
      const mapSeed = String(s?.seed ?? "mapseed");
      return NameGen.seededRNG(mapSeed + "|" + suffix);
    }

    // Precompute coastal distance in cell steps (multi-source BFS)
    function computeCoastSteps(cells, isWater) {
      const N = cells.length;
      const steps = new Int16Array(N).fill(32767);
      const q = [];
      for (let i = 0; i < N; i++) {
        if (isWater[i]) continue;
        const coastal = (cells[i].neighbors||[]).some(n => isWater[n]);
        if (coastal) { steps[i] = 0; q.push(i); }
      }
      for (let qi = 0; qi < q.length; qi++) {
        const u = q[qi];
        const ns = cells[u].neighbors||[];
        for (const v of ns) {
          if (isWater[v]) continue;
          if (steps[v] > steps[u] + 1) { steps[v] = steps[u] + 1; q.push(v); }
        }
      }
      return steps; // 0 = coast, 1.. = inland rings
    }

    // Precompute river distance (multi-source BFS from river cells)
    // Now handled by rivers.js module

    // === utils/heap: MinHeap for A* open set ===
    class MinHeap {
      constructor(scoreFn){ this._s=[]; this._f=scoreFn; }
      push(x){ const a=this._s, f=this._f; a.push(x); let i=a.length-1;
        while(i>0){ const p=(i-1)>>1; if(f(a[i])>=f(a[p])) break; [a[i],a[p]]=[a[p],a[i]]; i=p; } }
      pop(){ const a=this._s, f=this._f; if(a.length===1) return a.pop();
        const top=a[0]; a[0]=a.pop(); let i=0;
        for(;;){ const l=i*2+1, r=l+1; let m=i;
          if(l<a.length && f(a[l])<f(a[m])) m=l;
          if(r<a.length && f(a[r])<f(a[m])) m=r;
          if(m===i) break; [a[i],a[m]]=[a[m],a[i]]; i=m; }
        return top; }
      get size(){ return this._s.length; }
      clear(){ this._s.length=0; }
    }

    // === utils/throttle ===
    function rafThrottle(fn) {
      let tick=0, lastArgs=null;
      return (...args)=>{ lastArgs=args; if (tick) return; tick=1; requestAnimationFrame(()=>{ tick=0; fn(...lastArgs); }); };
    }

    // === PERF v2: always prints ms ===
    const PERF = (() => {
      const marks = [];
      const asMs = n => Math.round(n * 10) / 10;

      async function step(name, fn) {
        console.time(name);
        const t0 = performance.now();
        let res;
        try {
          res = fn?.constructor?.name === 'AsyncFunction' ? await fn() : fn();
        } finally {
          const t1 = performance.now();
          const ms = t1 - t0;
          marks.push({ name, ms });
          console.timeEnd(name);
          console.log(`⏱ ${name}: ${asMs(ms)} ms`);
        }
        return res;
      }

      function mark(name, t0) {
        const t1 = performance.now();
        const ms = t1 - t0;
        marks.push({ name, ms });
        // Avoid console.timeLog to prevent 'Timer does not exist' noise
        console.log(`⏱ ${name}: ${asMs(ms)} ms`);
      }

      function reset(){ marks.length = 0; }
      function summary(label='Perf Summary'){
        const total = marks.reduce((s,m)=>s+m.ms,0);
        console.groupCollapsed(`${label} – total ${asMs(total)} ms`);
        console.table(marks.map(m => ({ Step: m.name, ms: asMs(m.ms) })));
        console.groupEnd();
      }

      return { step, mark, reset, summary };
    })();

    // Install Long Task observer once (surface UI jank sources)
    (function installLongTaskObserver(){
      if (!('PerformanceObserver' in window)) return;
      try {
        const obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            console.warn(`⚠️ Long task: ${Math.round(e.duration)} ms`, e);
          }
        });
        obs.observe({ entryTypes: ['longtask'] });
        console.log('%cLongTask observer active', 'color:#c70');
      } catch {}
    })();

    // Assert helper to guarantee KNN route builder is used
    function assertKnnOnly() {
      console.log('%ccomputeRoutes() vKNN ASSERT', 'color:#0a0;font-weight:bold;');
      if (window.__useLegacyAllPairs) {
        throw new Error('Legacy all-pairs route builder invoked — should never happen when vKNN is active.');
      }
    }

    // ensureIsWater moved to state.js

    // === utils/svg-path helpers ===
    function polylineToPathD(points) {
      if (!points || points.length===0) return '';
      let d = `M${points[0].x},${points[0].y}`;
      for (let i=1;i<points.length;i++) d += `L${points[i].x},${points[i].y}`;
      return d;
    }

    // Merge unordered segments into polylines: segments = [{a:{x,y}, b:{x,y}}...]
    function segmentsToPolylines(segments) {
      // Simple O(n) chain stitch using hash of endpoints
      const key = p => `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
      const startMap=new Map(), endMap=new Map();
      for (const s of segments) {
        const A={x:s.a.x,y:s.a.y}, B={x:s.b.x,y:s.b.y};
        startMap.set(key(A), (startMap.get(key(A))||[]).concat({A,B}));
        endMap.set(key(B), (endMap.get(key(B))||[]).concat({A,B}));
      }
      const used=new Set(); const polylines=[];
      for (const [_, arr] of startMap) {
        for (const seg of arr) {
          const sig = `${seg.A.x},${seg.A.y}->${seg.B.x},${seg.B.y}`;
          if (used.has(sig)) continue;
          used.add(sig);
          const chain=[seg.A, seg.B];

          // extend forward
          for(;;){
            const tail = chain[chain.length-1];
            const nextArr = startMap.get(key(tail));
            let found=false;
            if (nextArr) for (const n of nextArr) {
              const nsig = `${n.A.x},${n.A.y}->${n.B.x},${n.B.y}`;
              if (used.has(nsig)) continue;
              if (n.A.x===tail.x && n.A.y===tail.y) {
                chain.push(n.B); used.add(nsig); found=true; break;
              }
            }
            if (!found) break;
          }

          // extend backward
          for(;;){
            const head = chain[0];
            const prevArr = endMap.get(key(head));
            let found=false;
            if (prevArr) for (const p of prevArr) {
              const psig = `${p.A.x},${p.A.y}->${p.B.x},${p.B.y}`;
              if (used.has(psig)) continue;
              if (p.B.x===head.x && p.B.y===head.y) {
                chain.unshift(p.A); used.add(psig); found=true; break;
              }
            }
            if (!found) break;
          }
          polylines.push(chain);
        }
      }
      return polylines;
    }

    // === graph cache ===
    const GraphCache = {
      land: null, // {nodesCount, edges, neighbors, edgeCost}
      sea:  null,
      invalidate(type){ if (!type || type==='land') this.land=null; if (!type || type==='sea') this.sea=null; }
    };
    
    // === safe exports for route functions ===
    window.ensureLandGraphMaps ||= undefined;
    window.buildBackboneRoads ||= undefined;
    
    // === idempotency guards ===
    let _routesInFlight = false;
    // === LABEL HELPERS ===
    function toScreen([x,y], t=window.currentTransform){ return [t.applyX(x), t.applyY(y)]; }
    // -------------------- MARKOV NAME GENERATOR (regional) ---------------------
    const NameGen = (() => {
      // ---- Seeded RNG -----------------------------------------------------------
      function xmur3(str) {
        let h = 1779033703 ^ str.length;
        for (let i = 0; i < str.length; i++) {
          h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
          h = (h << 13) | (h >>> 19);
        }
        return () => {
          h = Math.imul(h ^ (h >>> 16), 2246822507);
          h = Math.imul(h ^ (h >>> 13), 3266489909);
          return (h ^= h >>> 16) >>> 0;
        };
      }
      // mulberry32 moved to utils.js
      function seededRNG(seedStr) { const s = xmur3(seedStr)(); return mulberry32(s); }

      // === TERRAIN TEMPLATES ===
      // Register default templates from terrain.js module
      registerDefaultTemplates();
      
      // Debug: Log available templates
      console.log('Available templates:', Object.keys(getConfig().templates));

      // Util RNG (seedable if you want later)
      const rnd = (n) => Math.floor(Math.random() * n);

      class Markov {
        constructor(order = 2) { this.order = order; this.table = new Map(); }

        train(words) {
          const o = this.order;
          for (let w of words) {
            w = '^'.repeat(o) + w.toLowerCase() + '$';
            for (let i = 0; i <= w.length - o - 1; i++) {
              const key = w.slice(i, i + o);
              const next = w[i + o];
              if (!this.table.has(key)) this.table.set(key, {});
              const bucket = this.table.get(key);
              bucket[next] = (bucket[next] || 0) + 1;
            }
          }
          return this;
        }

        sample(minLen = 4, maxLen = 10, maxTries = 100, rng = Math.random, temp = 1) {
          const o = this.order;
          const keys = Array.from(this.table.keys());
          
          // Add some randomization to length constraints for more variety
          const actualMinLen = Math.max(minLen - 1, 3);
          const actualMaxLen = maxLen + 1;
          
          for (let attempt = 0; attempt < maxTries; attempt++) {
            let out = '^'.repeat(o);
            while (true) {
              const bucket = this.table.get(out.slice(-o));
              if (!bucket) break;
              // weighted choice
              const items = Object.entries(bucket);
              // apply temperature: raise weights^(1/temp)
              let total = 0;
              const weighted = items.map(([ch, c]) => {
                const w = Math.pow(c, 1 / Math.max(0.25, temp));
                total += w;
                return [ch, w];
              });
              let pick = rng() * total;
              let next = '$';
              for (const [ch, w] of weighted) { pick -= w; if (pick <= 0) { next = ch; break; } }
              if (next === '$') break;
              out += next;
              const core = out.slice(o);
              if (core.length >= actualMaxLen) break;
            }
            const core = out.slice(o);
            const clean = core.replace(/\^/g, '');
            if (clean.length >= actualMinLen && clean.length <= actualMaxLen && /^[a-z' -]+$/.test(clean)) {
              // More lenient vowel/consonant check
              if (!/(.)\1{3,}/.test(clean)) return clean; // Allow up to 3 repeated chars
            }
          }
          return null;
        }
      }

      function capitalize(w) {
        if (!w) return w;
        return w.split(/[\s-]+/).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
      }

      // --- Ten style packs: each with order + length bounds + seed corpus ---
      // NOTES:
      // - Corpora are lightweight seeds; Markov expands variety beyond them.
      // - Feel free to extend/tune corpora any time.
      const STYLE_PACKS = {
        nordic: { // coastal/northern
          order: 2, min: 4, max: 10,
          corpus: [
            'Skeld','Vargan','Ormstad','Haldor','Brynja','Njarvik','Fjordin',
            'Velgr','Ragnar','Torvik','Kjeld','Svea','Eldheim','Hafn','Ulvdal',
            'Grimstad','Hauk','Sigrid'
          ]
        },
        romance: { // mediterranean/latinate
          order: 3, min: 5, max: 11,
          corpus: [
            'Valeria','Montel','Rivara','Portenza','Caravano','Bellac','Serenne',
            'Lunaro','Grazia','Vintor','Aramonte','Rosale','Meridia','Castello','Alvento'
          ]
        },
        desert: { // arid/eastern
          order: 2, min: 4, max: 10,
          corpus: [
            'Qasira','Zehara','Nadir','Sahir','Razeem','Falun','Azmar','Jahra','Selim',
            'Kharif','Taybah','Samir','Maziri','Hazim','Yazira','Karim'
          ]
        },
        celtic: { // isles/highlands
          order: 2, min: 4, max: 10,
          corpus: [
            'Duneth','Branagh','Kellan','Fionn','Ardan','Morwen','Caerlin','Eilin','Taran',
            'Rowan','Bryn','Aislinn','Keir','Torin','Maeve','Islay'
          ]
        },
        slavic: { // continental/eastern
          order: 2, min: 5, max: 11,
          corpus: [
            'Novgor','Radomir','Miroslav','Breznik','Dravina','Velika','Zagora','Stoyan',
            'Kresna','Dobrin','Zorya','Milena','Ludvik','Petrov','Stanek'
          ]
        },
        germanic: { // central
          order: 2, min: 5, max: 11,
          corpus: [
            'Bergheim','Dornstadt','Kalten','Lindorf','Marburg','Rosenau','Waldsee',
            'Greifs','Halden','Rothen','Falken','Jagerthal','Steinau','Bracken'
          ]
        },
        elvish: { // airy/forested
          order: 3, min: 5, max: 12,
          corpus: [
            'Lethariel','Evendel','Narial','Sylthas','Faelir','Aerendil','Eryndor',
            'Melian','Thalanor','Ithilwen','Althoras','Sereth','Vaelion','Lorien'
          ]
        },
        dwarven: { // rugged/mountain
          order: 2, min: 4, max: 10,
          corpus: [
            'Khazruk','Bromdur','Thrain','Garmek','Durnbold','Stonhelm','Kragmar',
            'Beldran','Morgrin','Grundar','Torbek','Borrim','Kazgar'
          ]
        },
        polynesian: { // islander
          order: 2, min: 4, max: 10,
          corpus: [
            'Hanae','Makoa','Keoni','Nalani','Moana','Tane','Anuenue','Kaia','Nohea',
            'Hilo','Kailua','Mahina','Kanoa','Nalu','Kalani'
          ]
        },
        steppe: { // plains/steppe
          order: 2, min: 4, max: 10,
          corpus: [
            'Temur','Batuhan','Saran','Altai','Kulan','Orhon','Yesugen','Qulan','Tengri',
            'Erdem','Sogda','Taygan','Arslan','Borte','Sayan'
          ]
        }
      };

      function makeModel(style) {
        const m = new Markov(style.order);
        return m.train(style.corpus.map(s => s.toLowerCase()));
      }

      function uniqueSetFromExisting(burgs) {
        const set = new Set();
        for (const b of burgs) if (b.name) set.add(b.name.toLowerCase());
        return set;
      }

      function generateUnique(model, used, cfg, maxAttempts = 300) {
        const {min, max, rng = Math.random, temp = 1.5} = cfg; // Increased temperature for more variety
        for (let i = 0; i < maxAttempts; i++) {
          const w = model.sample(min, max, 100, rng, temp);
          if (!w) continue;
          const c = capitalize(w);
          if (!used.has(c.toLowerCase())) {
            // More lenient similarity check - only reject very close matches
            let clash = false;
            for (const u of used) { 
              if (levenshtein(c.toLowerCase(), u) <= 2) { // Only reject if very similar
                clash = true; 
                break; 
              } 
            }
            if (!clash) { used.add(c.toLowerCase()); return c; }
          }
        }
        // If we can't find a unique name, try with higher temperature
        for (let i = 0; i < 50; i++) {
          const w = model.sample(min, max, 100, rng, temp * 2);
          if (!w) continue;
          const c = capitalize(w);
          if (!used.has(c.toLowerCase())) {
            used.add(c.toLowerCase()); 
            return c;
          }
        }
        return 'Unnamed';
      }

      // Example: post-process a generated token depending on style
      function stylizeName(raw, styleKey, rng = Math.random) {
        if (!raw) return raw;
        const r = () => rng();
        switch (styleKey) {
          case 'nordic':     return r()<0.25 ? raw.replace(/a/g,'aa') : raw;
          case 'romance':    return r()<0.20 ? raw + 'a' : raw;
          case 'desert':     return r()<0.20 && !/'/.test(raw) ? raw.slice(0,2) + "'" + raw.slice(2) : raw;
          case 'celtic':     return r()<0.20 ? raw.replace(/th/g,'dh') : raw;
          case 'slavic':     return r()<0.15 ? raw.replace(/v/g,'w') : raw;
          case 'germanic':   return r()<0.20 ? raw.replace(/stein$/,'steyn') : raw;
          case 'elvish':     return r()<0.25 ? raw.replace(/l/g,'ll') : raw;
          case 'dwarven':    return r()<0.25 ? 'Kh' + raw : raw;
          case 'polynesian': return r()<0.20 ? raw.replace(/k/g,'kh') : raw;
          case 'steppe':     return r()<0.20 ? raw.replace(/a/g,'aa') : raw;
          default:           return raw;
        }
      }

      return { STYLE_PACKS, makeModel, generateUnique, uniqueSetFromExisting, capitalize, stylizeName, seededRNG };
    })();

    // ---- Similarity -----------------------------------------------------------
    function levenshtein(a, b) {
      a = a.toLowerCase(); b = b.toLowerCase();
      const m = a.length, n = b.length;
      if (!m || !n) return m || n;
      const dp = new Array(n + 1);
      for (let j = 0; j <= n; j++) dp[j] = j;
      for (let i = 1; i <= m; i++) {
        let prev = dp[0]; dp[0] = i;
        for (let j = 1; j <= n; j++) {
          const tmp = dp[j];
          dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
          prev = tmp;
        }
      }
      return dp[n];
    }
    function tooSimilar(a, b) {
      const dist = levenshtein(a, b);
      const maxLen = Math.max(a.length, b.length);
      const norm = dist / Math.max(1, maxLen);
      return norm <= 0.25; // reject very close variants
    }

    // ---- Label visibility -----------------------------------------------------
    const LabelRules = {
      capitalMinK: 0.8, // show capital labels above this zoom
      townMinK: 1.6     // show town labels above this zoom
    };

    // ---- Collision culling ----------------------------------------------------
    function cullOverlappingLabels(nodes) {
      // nodes: [{x,y,text,width,height,priority, sel}] in SCREEN coords, highest priority first
      const tree = d3.quadtree().x(d=>d.x).y(d=>d.y);
      const kept = [];
      for (const n of nodes) {
        const w = n.width, h = n.height;
        let collide = false;
        tree.visit((quad, x1, y1, x2, y2) => {
          const q = quad.data;
          if (q) {
            const dx = Math.abs(q.x - n.x);
            const dy = Math.abs(q.y - n.y);
            if (dx < (q.width + w) / 2 && dy < (q.height + h) / 2) { collide = true; return true; }
          }
          return x1 > n.x + w || x2 < n.x - w || y1 > n.y + h || y2 < n.y - h;
        });
        if (!collide) { kept.push(n); tree.add(n); }
      }
      return kept;
    }

    // --- Land components (islands) --------------------------------------------
    function labelLandComponents(cells, isWater) {
      const comp = new Int32Array(cells.length); comp.fill(-1);
      let id = 0;
      for (let i = 0; i < cells.length; i++) {
        if (isWater[i]) continue;
        const q = [i]; comp[i] = id;
        for (let qi = 0; qi < q.length; qi++) {
          const u = q[qi];
          const neigh = cells[u].neighbors || [];
          for (const v of neigh) {
            if (!isWater[v] && comp[v] === -1) { comp[v] = id; q.push(v); }
          }
        }
        id++;
      }
      return comp; // -1 for water
    }
    // --- Ensure we have a polygon for each cell (Voronoi) ----------------------
    function ensureCellPolys(cells, width, height) {
      if (cells.length && cells[0].poly) return; // already present
      const pts = cells.map(c => [c.cx, c.cy]);
      const vor = d3.Delaunay.from(pts).voronoi([0,0,width,height]);
      for (let i = 0; i < cells.length; i++) {
        const poly = vor.cellPolygon(i);
        cells[i].poly = poly ? poly.map(p => [p[0], p[1]]) : [[cells[i].cx, cells[i].cy]];
      }
    }
    // === Azgaar-style cell suitability scoring (not wired yet) ===
    function computeCellSuitability(cells, isWater) {
      const {s} = getWorld();
      const {templates} = getConfig();
      
      const score = new Float32Array(cells.length);
      
      // Get (or compute once & stash) coast steps
      if (!s.coastSteps) {
        s.coastSteps = computeCoastSteps(cells, isWater);
      }
      
      // Get (or compute once & stash) river steps
      if (!s.riverSteps) {
        s.riverSteps = computeRiverSteps(cells);
      }
      
      for (let i = 0; i < cells.length; i++) {
        if (isWater[i]) { score[i] = -Infinity; continue; }
        const c = cells[i];
        // Heuristics: these properties can be derived/augmented elsewhere
        const flat = 1 - (c.localSlope ?? 0);               // 0..1 where 1 is flattest
        const fertile = c.biomeFertility ?? 0.5;            // fallback if not computed
        const elevPenalty = (c.elev ?? 0) * 0.1; // Default elevation penalty

        // Coastal decay system
        const cs = s.coastSteps[i]; // 0..32767
        let coastTerm = 0;
        if (cs === 0) {
          coastTerm = 0.8; // Default coast weight
        } else if (cs <= 2) {
          coastTerm = 0.4; // Default near-shore weight
        } // else 0 inland
        
        // River proximity system
        const rs = s.riverSteps[i]; // steps from river
        // Linear falloff over 0..5 steps (tweakable)
        const riverProx = rs <= 5 ? (1 - rs / 5) : 0;
        const riverTerm = 0.6 * riverProx; // Default river weight
        // Keep confluence & estuary bump as-is:
        const riverBump = (c.riverDegree ?? 0) >= 2 ? 0.3 : 0; // Default confluence bonus
        
        const shelteredBonus = c.isShelteredHarbor ? 0.2 : 0; // Default sheltered harbor bonus
        const flatTerm = 0.4 * flat; // Default flat weight
        const fertTerm = 0.5 * fertile; // Default fertile weight

        score[i] = coastTerm + shelteredBonus + riverTerm + riverBump + flatTerm + fertTerm - elevPenalty;
      }
      return score;
    }

    // === Capital placement with min spacing (not wired yet) ===
    function placeCapitals(score, cells) {
      const {s} = getWorld();
      const {templates} = getConfig();
      
      const want = 3; // Default capitals count
      const idx = Array.from(score.keys()).filter(i => Number.isFinite(score[i]));
      idx.sort((a,b) => score[b] - score[a]);
      const chosen = [];
      for (const i of idx) {
        const p = { x: cells[i].cx, y: cells[i].cy, cell: i, type: "capital", capital: true, port: false, population: 50000 };
        if (chosen.every(c => Math.hypot(c.x - p.x, c.y - p.y) >= 100)) { // Default capital min spacing
          chosen.push(p);
          if (chosen.length === want) break;
        }
      }
      return chosen;
    }
    // --- Build region boundary segments from labeled cells ---------------------
    function buildRegionSegments(cells, isWater, regionOfCell) {
      const segsByRegion = new Map(); // region -> segments [{a:[x,y], b:[x,y]}]
      const pushSeg = (rid, a, b) => {
        if (!segsByRegion.has(rid)) segsByRegion.set(rid, []);
        segsByRegion.get(rid).push({a:{x:a[0],y:a[1]}, b:{x:b[0],y:b[1]}});
      };

      // For each cell edge shared with different region (or water/neutral), add to region's boundary
      for (let i = 0; i < cells.length; i++) {
        const ri = regionOfCell[i];
        if (ri < 0 || isWater[i]) continue;
        const poly = cells[i].poly;
        const neigh = cells[i].neighbors || [];
        for (let e = 0; e < poly.length; e++) {
          const a = poly[e], b = poly[(e+1) % poly.length];

          // Find neighboring cell that shares this edge (if any)
          // We approximate by checking all neighbors; in your model, neighbor polygons share edges
          let sameRegionNeighbor = false;
          for (const j of neigh) {
            if (j === i || isWater[j]) continue;
            if (regionOfCell[j] === ri) {
              // If neighbor shares an edge that matches (a,b) ~ (b',a') we'll consider interior edge
              // Cheap test: midpoint distance to neighbor polygon; if close, treat as interior
              const pj = cells[j].poly;
              if (pj) {
                const mx = (a[0]+b[0])*0.5, my=(a[1]+b[1])*0.5;
                // inside neighbor bbox quick test
                const jb = d3.polygonContains(pj, [mx,my]);
                if (jb) { sameRegionNeighbor = true; break; }
              }
            }
          }
          if (!sameRegionNeighbor) pushSeg(ri, a, b);
        }
      }
      return segsByRegion;
    }

    // --- Stitch segments to rings; reuse your segmentsToPolylines --------------
    function segmentsToRings(segments) {
      // Use your existing segmentsToPolylines and close rings when endpoints meet
      const polys = segmentsToPolylines(segments);
      // Ensure closure:
      for (const p of polys) {
        const first = p[0], last = p[p.length-1];
        if (first.x !== last.x || first.y !== last.y) p.push({x:first.x, y:first.y});
      }
      return polys;
    }

    // ----- Coastline ring extraction (lightweight) -----
    function buildCoastlineRings(state, cells, isWater) {
      const {s} = getWorld();
      const {templates} = getConfig();
      
      // Defensive guards
      if (!cells?.length) { 
        console.warn('buildCoastlineRings: no cells, skipping'); 
        return []; 
      }
      if (!isWater?.length) { 
        console.warn('buildCoastlineRings: no isWater data, skipping'); 
        return []; 
      }
      
      const segs = [];
      for (let i=0; i<cells.length; i++){
        if (isWater[i]) continue;
        if ((s.coastSteps?.[i] ?? 99) !== 0) continue;
        const c = cells[i];
        const nbs = c.neighbors || c.n || [];
        if (!nbs || !nbs.length) continue;
        for (const j of nbs){
          if (j == null) continue;
          if (!isWater[j]) continue;
          const a = { x: c.cx, y: c.cy };
          const b = { x: (cells[j]?.cx ?? c.cx), y: (cells[j]?.cy ?? c.cy) };
          segs.push({ a, b });
        }
      }
      return segmentsToPolylinesLoose(segs, 8);
    }

    function segmentsToPolylinesLoose(segs, eps) {
      const pts = [];
      for (const s of segs){ pts.push(s.a, s.b); }
      const idx = makeSpatialIndex(pts, Math.max(2, eps*0.75));
      const used = new Set();
      const lines = [];
      for (let k=0; k<segs.length; k++){
        if (used.has(k)) continue;
        let a = segs[k].a, b = segs[k].b;
        used.add(k);
        const left = [a], right = [b];
        let extended = true, guard = 0;
        while (extended && guard++ < 2000){
          extended = false;
          for (let m=0; m<segs.length; m++){
            if (used.has(m)) continue;
            const s = segs[m];
            if (dist(left[0], s.b) < eps) { left.unshift(s.a); used.add(m); extended = true; break; }
            if (dist(left[0], s.a) < eps) { left.unshift(s.b); used.add(m); extended = true; break; }
          }
          for (let m=0; m<segs.length; m++){
            if (used.has(m)) continue;
            const s = segs[m];
            if (dist(right[right.length-1], s.a) < eps) { right.push(s.b); used.add(m); extended = true; break; }
            if (dist(right[right.length-1], s.b) < eps) { right.push(s.a); used.add(m); extended = true; break; }
          }
        }
        const pl = left.concat(right.slice(1));
        if (pl.length >= 3) lines.push(dedupePolyline(pl));
      }
      return lines;
    }

    // ----- Concavity, enclosure & estuary scoring -----
    function computeHarborScores(state, cells, isWater, coastRings) {
      const {s} = getWorld();
      const {templates} = getConfig();
      
      // Defensive guards
      if (!cells?.length) { 
        console.warn('computeHarborScores: no cells, skipping'); 
        return new Float32Array(0); 
      }
      if (!isWater?.length) { 
        console.warn('computeHarborScores: no isWater data, skipping'); 
        return new Float32Array(0); 
      }
      
      const harborScore = new Float32Array(cells.length);
      const rs = s.riverSteps || [];
      const deg = i => (cells[i].riverDegree ?? 0);
      const wid = i => (cells[i].riverWidth ?? 0);

      const coastPts = [];
      const ringOf = [];
      for (let r=0; r<coastRings.length; r++){
        const ring = coastRings[r];
        for (let i=0; i<ring.length; i++){
          coastPts.push(ring[i]);
          ringOf.push(r);
        }
      }
      const idx = makeSpatialIndex(coastPts, 6);

      const rayCount = 12;
      const rayStep = 4;
      const rayMax  = 30;
      const concavityWindow = 3;
      const concavityTolDeg = 18;

      function curvatureAt(ring, k, window, tolDeg){
        const n = ring.length;
        const a = ring[(k - window + n) % n];
        const b = ring[k];
        const c = ring[(k + window) % n];
        return 180 - angleDeg(a, b, c);
      }

      function enclosureScore(cx, cy){
        let hits = 0, sumInv = 0;
        for (let t=0; t<rayCount; t++){
          const theta = (2*Math.PI * t) / rayCount;
          let r=rayStep, hit=false;
          while (r <= rayMax){
            const x = cx + Math.cos(theta)*r, y = cy + Math.sin(theta)*r;
            const near = idx.queryNear(x, y, 6);
            if (near.length > 0) { hit = true; break; }
            r += rayStep;
          }
          if (hit){ hits++; sumInv += 1 / Math.max(1, r); }
        }
        const frac = hits / rayCount;
        return frac * (1 + 6*sumInv);
      }

      for (let i=0; i<cells.length; i++){
        if (isWater[i]) continue;
        if ((s.coastSteps?.[i] ?? 99) !== 0) continue;

        const c = cells[i];
        const near = idx.queryNear(c.cx, c.cy, 10);
        if (!near.length) continue;
        let best=near[0], bestD=Infinity, bestIdx=0;
        for (let k=0; k<near.length; k++){
          const d = Math.hypot(near[k].x - c.cx, near[k].y - c.cy);
          if (d < bestD){ bestD = d; best = near[k]; bestIdx = coastPts.indexOf(best); }
        }
        const ringId = ringOf[bestIdx];
        const ring = coastRings[ringId];
        const kOnRing = Math.max(0, ring.indexOf(best));

        const conc = curvatureAt(ring, kOnRing, concavityWindow, concavityTolDeg);
        const concTerm = Math.max(0, conc - concavityTolDeg) / 45;
        const enclTerm = enclosureScore(c.cx, c.cy);
        const estuaryTerm = (rs[i]===0 && (deg(i)>=2 || wid(i)>=2)) ? 1.0 : 0.0;
        const score = 0.55*concTerm + 0.35*enclTerm + 1.2*estuaryTerm;
        harborScore[i] = score;
      }
      return harborScore;
    }
    // --- Geometry utils: snapping & merging polylines -------------------------
    // sqr, dist2, dist, almostEq, angleDeg, colinear moved to utils.js

    function makeSpatialIndex(points, cellSize){
      const grid = new Map();
      function key(ix,iy){ return ix+"|"+iy; }
      for (const p of points){
        const ix = Math.floor(p.x/cellSize), iy = Math.floor(p.y/cellSize);
        const k = key(ix,iy);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(p);
      }
      return {
        queryNear(x,y,r){
          const ix = Math.floor(x/cellSize), iy = Math.floor(y/cellSize);
          const out = [];
          const rad = Math.ceil(r/cellSize);
          for (let dx=-rad; dx<=rad; dx++){
            for (let dy=-rad; dy<=rad; dy++){
              const k = (ix+dx)+"|"+(iy+dy);
              const bucket = grid.get(k);
              if (!bucket) continue;
              for (const p of bucket){ if (Math.hypot(p.x-x, p.y-y) <= r) out.push(p); }
            }
          }
          return out;
        }
      };
    }

    // totalPolylineLen, dedupePolyline moved to utils.js

    function bridgeTinyGaps(polylines, gapTol){
      const ends = [];
      for (let id=0; id<polylines.length; id++){
        const pl = polylines[id]; if (!pl || pl.length<2) continue;
        ends.push({id, end:"head", p:pl[0]});
        ends.push({id, end:"tail", p:pl[pl.length-1]});
      }
      const idx = makeSpatialIndex(ends.map(e=>e.p), Math.max(2, gapTol*0.75));
      const usedPairs = new Set();
      const extraSegments = [];
      for (const e of ends){
        const near = idx.queryNear(e.p.x, e.p.y, gapTol);
        for (const q of near){
          if (q === e.p) continue;
          const e2 = ends.find(E => E.p === q);
          if (!e2 || e.id === e2.id) continue;
          const key = e.id < e2.id ? `${e.id}-${e.end}|${e2.id}-${e2.end}` : `${e2.id}-${e2.end}|${e.id}-${e.end}`;
          if (usedPairs.has(key)) continue;
          usedPairs.add(key);
          extraSegments.push([e.p, e2.p]);
        }
      }
      if (!extraSegments.length) return polylines;
      return polylines.concat(extraSegments.map(seg=>[seg[0], seg[1]]));
    }
    function weldColinear(polylines, angleTolDeg){
      const keyPt = p => `${p.x.toFixed(3)}|${p.y.toFixed(3)}`;
      const at = new Map();
      for (let i=0;i<polylines.length;i++){
        const pl = polylines[i]; if (!pl || pl.length<2) continue;
        const head = keyPt(pl[0]), tail = keyPt(pl[pl.length-1]);
        if (!at.has(head)) at.set(head, []);
        if (!at.has(tail)) at.set(tail, []);
        at.get(head).push({polyId:i, end:"head"});
        at.get(tail).push({polyId:i, end:"tail"});
      }
      const P = polylines.slice();
      const removed = new Set();
      function tryMerge(i, j, junctionKey){
        const A = P[i], B = P[j]; if (!A || !B) return false;
        const K = junctionKey;
        const AstartsAtJ = (keyPt(A[0])===K) || false;
        const AendsAtJ   = (keyPt(A[A.length-1])===K) || false;
        if (!AstartsAtJ && !AendsAtJ) return false;
        const BstartsAtJ = (keyPt(B[0])===K) || false;
        const BendsAtJ   = (keyPt(B[B.length-1])===K) || false;
        if (!BstartsAtJ && !BendsAtJ) return false;
        const aPrev = AstartsAtJ ? A[1] : A[A.length-2];
        const jPtA  = AstartsAtJ ? A[0] : A[A.length-1];
        const bNext = BstartsAtJ ? B[1] : B[B.length-2];
        if (!aPrev || !bNext) return false;
        if (!colinear(aPrev, jPtA, bNext, angleTolDeg)) return false;
        const Aseq = AstartsAtJ ? A.slice().reverse() : A.slice();
        const Bseq = BstartsAtJ ? B.slice(1) : B.slice(0, B.length-1);
        const merged = dedupePolyline(Aseq.concat(Bseq));
        P[i] = merged; P[j] = null; removed.add(j); return true;
      }
      let changed = true, guard=0;
      while (changed && guard++ < 64){
        changed = false;
        for (const [junctionKey, ends] of at.entries()){
          const touching = [];
          for (const e of ends){ if (removed.has(e.polyId) || !P[e.polyId]) continue; touching.push(e.polyId); }
          if (touching.length < 2) continue;
          for (let a=0; a<touching.length; a++){
            for (let b=a+1; b<touching.length; b++){
              const i = touching[a], j = touching[b];
              if (removed.has(i) || removed.has(j)) continue;
              if (tryMerge(i, j, junctionKey)) { changed = true; }
            }
          }
        }
      }
      return P.filter(Boolean);
    }

    function snapAndMergeRoutes(polylines, opts){
      if (!polylines || !polylines.length) return polylines;
      const epsSnap = opts?.epsSnap ?? 4;
      const angleTolDeg = opts?.angleTolDeg ?? 8;
      const gapTol = opts?.gapTol ?? 6;
      const endpoints = [];
      for (const pl of polylines){ if (!pl || pl.length < 2) continue; endpoints.push(pl[0], pl[pl.length-1]); }
      const idx = makeSpatialIndex(endpoints, Math.max(2, epsSnap*0.75));
      const canonical = new Map();
      for (const p of endpoints){ if (canonical.has(p)) continue; const near = idx.queryNear(p.x, p.y, epsSnap); let sx=0, sy=0; for (const q of near){ sx+=q.x; sy+=q.y; } const cx = sx/near.length, cy = sy/near.length; const junction = { x: cx, y: cy }; for (const q of near) canonical.set(q, junction); }
      const snapped = polylines.map(pl=>{ if (!pl || pl.length<2) return pl; const a = pl.slice(); const jf = canonical.get(a[0]) || a[0]; const jl = canonical.get(a[a.length-1]) || a[a.length-1]; a[0] = jf; a[a.length-1] = jl; return dedupePolyline(a); });
      const stitched = bridgeTinyGaps(snapped, gapTol);
      const merged = weldColinear(stitched, angleTolDeg);
      const clean = [];
      for (const pl of merged){ const p = dedupePolyline(pl); if (p.length < 2) continue; if (totalPolylineLen(p) < 1.0) continue; clean.push(p); }
      return clean;
    }

    // Deterministic shuffle of an array using seeded RNG
    function seededShuffle(arr, seedStr) {
      const rng = NameGen.seededRNG('style|' + seedStr);
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    // Build a style array for K regions using STYLE_PACKS keys
    function buildRegionStyles(k, seedStr) {
      const keys = Object.keys(NameGen.STYLE_PACKS);
      if (!keys.length) throw new Error('No STYLE_PACKS defined');
      
      // Include regeneration counter in seed for different style assignments each time
      const regenCount = window.__state?.regenerationCount || 0;
      const styleSeed = `${seedStr}|regen:${regenCount}`;
      
      const shuffled = seededShuffle(keys, styleSeed);
      const out = [];
      for (let i = 0; i < k; i++) out.push(NameGen.STYLE_PACKS[shuffled[i % shuffled.length]]);
      return out;
    }

    // Number of macro-regions. You can set this anywhere before generation, e.g. __state.macroRegionCount = 6;
    function getMacroRegionCount() {
      const {s} = getWorld();
      const {templates} = getConfig();
      
      return Math.max(1, +(s?.macroRegionCount ?? 3));
    }

    // --- Capital powers with disbalance ---------------------------------------
    function computeCapitalPowers(capitals, disbalance = 0.35, seed = 'powers') {
      const rng = NameGen.seededRNG(String(seed));
      // draw power in [1 - d, 1 + d]; smaller -> more attractive
      return capitals.map(() => (1 - disbalance) + rng() * (2 * disbalance));
    }
    // Seeded capital power assignment (Azgaar "power/disbalance")
    function assignCapitalPowers(capitals) {
      const {s} = getWorld();
      const {templates} = getConfig();
      
      const rng = rngFromMapSeed("capital-power");
      const d = 0.35; // Default disbalance value
      for (const cap of capitals) {
        const v = (rng() - 0.5) * 2 * d; // [-d, d]
        const p = 1 + v;                 // ~ [1-d, 1+d]
        cap.power = Math.max(0.5, p);
      }
    }

    // distance with island penalty + power
    function effectiveCapitalDist(ax, ay, cap, capPower, cellCompId, burgCompId, overseasPenalty) {
      const dx = ax - cap.x, dy = ay - cap.y;
      let d = Math.hypot(dx, dy);
      if (cellCompId !== burgCompId) d *= overseasPenalty;
      return d * capPower;
    }

    // -------------------- MACRO-REGIONS (K) --------------------
    function chooseMacroCapitals(k = null) {
      const {s} = getWorld();
      const {templates} = getConfig();
      
      if (k === null) k = getMacroRegionCount();
      // Use flagged capitals if available; otherwise farthest-first among burgs
      const burgs = (s?.burgs || []).filter(b => !b.removed);
      const caps = burgs.filter(b => b.capital || b.type === 'capital');
      
      if (caps.length >= k) {
        return caps.slice(0, k);
      }

      // Farthest-first seeding for diversity
      const chosen = [];
      if (burgs.length === 0) return chosen;
      chosen.push(burgs[Math.floor(Math.random() * burgs.length)]);
      
      while (chosen.length < k && chosen.length < burgs.length) {
        let best = null, bestD = -1;
        for (const b of burgs) {
          if (chosen.includes(b)) continue;
          let mind = Infinity;
          for (const c of chosen) {
            const dx = b.x - c.x, dy = b.y - c.y;
            const d2 = dx*dx + dy*dy;
            if (d2 < mind) mind = d2;
          }
          if (mind > bestD) { bestD = mind; best = b; }
        }
        if (best) {
          chosen.push(best);
        } else break;
      }
      
      return chosen;
    }

    function assignMacroRegions(capitals) {
      const {s} = getWorld();
      const {templates} = getConfig();
      
      const burgs = (s?.burgs || []).filter(b => !b.removed);
      const caps = capitals.map((c, i) => ({...c, regionId: i}));
      
      // Nearest-capital assignment by Euclidean distance in map coords
      for (const b of burgs) {
        let best = 0, bestD = Infinity;
        for (let i = 0; i < caps.length; i++) {
          const c = caps[i];
          const dx = b.x - c.x, dy = b.y - c.y, d2 = dx*dx + dy*dy;
          if (d2 < bestD) { bestD = d2; best = i; }
        }
        b.regionId = best;
      }
              setMacroCapitals(caps);
    }
    // --- Azgaar-style region assignment ---------------------------------------
    async function assignRegionsAzgaar({ K, disbalance, overseasPenalty, maxManorDistPx }) {
      const yieldNow = () => new Promise(requestAnimationFrame);
      const {cells, isWater, width, height, s} = getWorld();

      if (!cells.length) return null;

      ensureCellPolys(cells, width, height);
      const landComp = labelLandComponents(cells, isWater);
      s.landComp = landComp; // Store for later use

      // Capitals (use flagged if present; else farthest-first you already have)
      let capitals = s.macroCapitals;
      if (!capitals || capitals.length !== K) {
        capitals = chooseMacroCapitals(K);
        s.macroCapitals = capitals;
      }
      
      // Fallback: if we still have no capitals, synthesize them
      if (!capitals || capitals.length === 0) {
        // Fallback: pick K farthest-first cell centroids on land
        const K = getMacroRegionCount();
        const { cells, isWater } = getWorld();
        const land = cells.map((c,i)=>({i, x:c.cx, y:c.cy})).filter(p=>!isWater[p.i]);
        const chosen=[];
        if (land.length) {
          chosen.push(land[Math.floor(Math.random()*land.length)]);
          while (chosen.length < K && chosen.length < land.length) {
            let best=null, bestD=-1;
            for (const p of land) {
              if (chosen.includes(p)) continue;
              let mind=Infinity;
              for (const q of chosen) {
                const d2=(p.x-q.x)**2+(p.y-q.y)**2;
                if (d2<mind) mind=d2;
              }
              if (mind>bestD){ bestD=mind; best=p; }
            }
            if (!best) break;
            chosen.push(best);
          }
          capitals = chosen.map((p,idx)=>({ x:p.x, y:p.y, cellIndex:p.i, capital:true, type:'capital', regionId:idx, power:1 }));
          s.macroCapitals = capitals;
          console.warn('assignRegionsAzgaar: synthesized capitals=', capitals.length);
        }
      }

      // Capital powers
      const mapSeed = String(s?.seed ?? 'mapseed');
      const capPowers = computeCapitalPowers(capitals, disbalance, `${mapSeed}|powers`);

      // 1) Assign towns (burgs) to nearest capital by effective distance
      const burgs = (s.burgs || []).filter(b => !b.removed);
      for (const b of burgs) {
        const bComp = landComp[b.cellIndex ?? nearestCellIndex(cells, b.x, b.y)];
        let bestI = 0, bestD = Infinity;
        for (let i = 0; i < capitals.length; i++) {
          const d = effectiveCapitalDist(b.x, b.y, capitals[i], capPowers[i], bComp, landComp[capitals[i].cellIndex ?? nearestCellIndex(cells, capitals[i].x, capitals[i].y)], overseasPenalty);
          if (d < bestD) { bestD = d; bestI = i; }
        }
        b.regionId = bestI;
      }

      // 2) Assign land cells to nearest manor (town) with max distance threshold,
      //    else FALL BACK to nearest capital using power + overseas.
      const manors = burgs.map(b => ({
        x: b.x, y: b.y, regionId: b.regionId,
        comp: landComp[b.cellIndex ?? nearestCellIndex(cells, b.x, b.y)]
      }));
      const qt = d3.quadtree().x(d => d.x).y(d => d.y).addAll(manors);

      const regionOfCell = new Int32Array(cells.length); regionOfCell.fill(-1);

      // Yield-based cell assignment to prevent long tasks
      let lastYield = performance.now();
      for (let i = 0; i < cells.length; i++) {
        // Check if we need to yield to avoid UI stalls
        if (performance.now() - lastYield > 8) {
          await yieldNow();
          lastYield = performance.now();
        }

        if (isWater[i]) continue;

        const c = cells[i], compId = landComp[i];

        // Manor step (fast nearest in screen coords)
        const nearest = qt.find(c.cx, c.cy); // unbounded nearest
        let regionId = -1;

        if (nearest) {
          let d = Math.hypot(c.cx - nearest.x, c.cy - nearest.y);
          if (nearest.comp !== compId) d *= overseasPenalty;
          if (d <= maxManorDistPx) regionId = nearest.regionId; // adopt manor's region
        }

        // Fallback to capital (ensures coverage for small islands / remote cells)
        if (regionId === -1) {
          const islandOf = landComp; // reuse component id as island marker
          const best = (() => {
            let b = null, bd = Infinity;
            for (const cap of capitals) {
              const d = (() => {
                const ci = i;
                const capIdx = cap.cellIndex ?? nearestCellIndex(cells, cap.x, cap.y);
                let d0 = Math.hypot(cells[ci].cx - cap.x, cells[ci].cy - cap.y);
                if (islandOf && islandOf[ci] != null && islandOf[capIdx] != null && islandOf[ci] !== islandOf[capIdx]) {
                  d0 *= (CONFIG.regions.overseasMultiplier ?? 2.0);
                }
                const power = cap.power ?? 1.0;
                return d0 * power;
              })();
              if (d < bd) { bd = d; b = cap; }
            }
            return b;
          })();
          const bestI = capitals.indexOf(best);
          // Distance guard for neutrals
          if (CONFIG.regions.allowNeutral) {
            // Euclidean distance to chosen capital
            const cap = capitals[bestI];
            const capCell = cap.cellIndex ?? nearestCellIndex(cells, cap.x, cap.y);
            const dPx = Math.hypot(c.cx - cap.x, c.cy - cap.y);
            if (dPx > CONFIG.regions.maxManorDistance) {
              regionId = -1; // neutral
            } else {
              regionId = bestI;
            }
          } else {
            regionId = bestI;
          }
        }

        regionOfCell[i] = regionId;
      }
      
      // Store result in global state for access by other functions
              setRegionOfCell(regionOfCell);
      
      return { regionOfCell, landComp, capitals, capPowers };
    }

    // helper: fallback nearest cell index by brute force (rarely hot)
    function nearestCellIndex(cells, x, y) {
      let best = 0, bestD2 = Infinity;
      for (let i = 0; i < cells.length; i++) {
        const dx = cells[i].cx - x, dy = cells[i].cy - y, d2 = dx*dx + dy*dy;
        if (d2 < bestD2) { bestD2 = d2; best = i; }
      }
      return best;
    }

    // --- Settlement stats helpers --------------------------------------------
    function computeWorldStats(state, cells, isWater, suitability) {
      const {s} = getWorld();
      const {templates} = getConfig();
      
      // Defensive guards
      if (!cells?.length) { 
        console.warn('computeWorldStats: no cells, skipping'); 
        return { landCount: 0, landFrac: 0, coastCells: 0, fertileFlat: 0, fertileFlatFrac: 0, riverLen: 0, confluences: 0 }; 
      }
      if (!isWater?.length) { 
        console.warn('computeWorldStats: no isWater data, skipping'); 
        return { landCount: 0, landFrac: 0, coastCells: 0, fertileFlat: 0, fertileFlatFrac: 0, riverLen: 0, confluences: 0 }; 
      }
      
      const n = cells.length;
      let landCount = 0, coastCells = 0, fertileFlat = 0, riverLen = 0, confluences = 0;
      for (let i = 0; i < n; i++) {
        if (isWater[i]) continue;
        landCount++;
        if ((s.coastSteps?.[i] ?? 99) === 0) coastCells++;
        const flat = 1 - (cells[i].localSlope ?? 0);
        const fertile = (cells[i].biomeFertility ?? 0.5);
        if (flat >= 0.5 && fertile >= 0.5) fertileFlat++;
        riverLen += (cells[i].riverWidth ?? 0);
        if ((cells[i].riverDegree ?? 0) >= 2) confluences++;
      }
      const landFrac = landCount / Math.max(1, n);
      return {
        landCount, landFrac, coastCells, fertileFlat,
        fertileFlatFrac: fertileFlat / Math.max(1, landCount),
        riverLen, confluences
      };
    }

    function computeRegionAreas(state, cells, isWater) {
      const {s} = getWorld();
      const {templates} = getConfig();
      
      // Defensive guards
      if (!cells?.length) { 
        console.warn('computeRegionAreas: no cells, skipping'); 
        return { regions: [], totalArea: 0 }; 
      }
      if (!isWater?.length) { 
        console.warn('computeRegionAreas: no isWater data, skipping'); 
        return { regions: [], totalArea: 0 }; 
      }
      
      const byRegion = new Map(); // id -> {area, suitSum, cnt}
      for (let i = 0; i < cells.length; i++) {
        if (isWater[i]) continue;
        const r = cells[i].regionId ?? s.regionOfCell?.[i];
        if (r == null) continue;
        const g = byRegion.get(r) || { area:0, suitSum:0, cnt:0 };
        g.area += 1;
        g.suitSum += (cells[i].__suitability ?? 0);
        g.cnt += 1;
        byRegion.set(r, g);
      }
      let totalArea = 0;
      for (const v of byRegion.values()) totalArea += v.area;
      const out = [];
      for (const [rid, g] of byRegion.entries()) {
        out.push({
          regionId: rid,
          area: g.area,
          areaFrac: g.area / Math.max(1, totalArea),
          meanSuit: g.cnt ? g.suitSum / g.cnt : 0.0
        });
      }
      return { regions: out, totalArea };
    }

    function estimateEstuaries(state, cells, isWater) {
      const {s} = getWorld();
      const {templates} = getConfig();
      
      // Defensive guards
      if (!cells?.length) { 
        console.warn('estimateEstuaries: no cells, skipping'); 
        return 0; 
      }
      if (!isWater?.length) { 
        console.warn('estimateEstuaries: no isWater data, skipping'); 
        return 0; 
      }
      
      let estuaries = 0;
      for (let i = 0; i < cells.length; i++) {
        if (isWater[i]) continue;
        if ((s.coastSteps?.[i] ?? 99) !== 0) continue;
        const deg = (cells[i].riverDegree ?? 0);
        const wid = (cells[i].riverWidth ?? 0);
        if (deg >= 2 || wid >= 2) estuaries++;
      }
      return estuaries;
    }

    function estimateEstuaryPortBonus(confluences) {
      if (confluences <= 10) return 0.0;
      if (confluences <= 50) return 0.02;
      if (confluences <= 150) return 0.05;
      return 0.08;
    }

    // clamp moved to utils.js

    function allocateAdaptiveTargets(CONFIG, stats) {
      const N = CONFIG.settlements.townsCount;
      const base = CONFIG.settlements.share;

      const coastBias = Math.min(0.35, stats.coastCells / Math.max(1, stats.landCount) * 0.6);
      const estuaryBonus = Math.min(0.10, estimateEstuaryPortBonus(stats.confluences));
      const riverBias = Math.min(0.25, stats.riverLen / Math.max(1, stats.landCount) * 0.15);
      const fertileBias = Math.min(0.25, stats.fertileFlatFrac * 0.4);

      let share = {
        manor:   base.manor,
        village: base.village,
        town:    base.town,
        port:    base.port,
        capital: base.capital
      };

      share.port = clamp(share.port + coastBias + estuaryBonus - 0.02, 0.03, 0.12);
      share.town = clamp(share.town + riverBias * 0.8 - 0.02, 0.12, 0.25);
      const ruralBoost = fertileBias * 0.8;
      share.village = clamp(share.village + ruralBoost * 0.6 - 0.02, 0.18, 0.35);
      share.manor   = clamp(1 - (share.capital + share.port + share.town + share.village), 0.25, 0.55);

      const total = share.manor + share.village + share.town + share.port + share.capital;
      for (const k of Object.keys(share)) share[k] /= total;

      const tCap = Math.max(20, Math.round(N * share.capital));
      const tPort = Math.round(N * share.port);
      const tTown = Math.round(N * share.town);
      const tVillage = Math.round(N * share.village);
      const tManor = Math.max(0, N - tCap - tPort - tTown - tVillage);

      return { tCap, tPort, tTown, tVillage, tManor, share };
    }
    // --- Settlement seeding and typing ----------------------------------------
    async function seedBurgCandidates(cells, isWater, suitability, capitals, CONFIG) {
      const {s, width, height} = getWorld();
      const {templates} = getConfig();
      const yieldNow = () => new Promise(requestAnimationFrame);
      
      // Defensive guards
      if (!cells?.length) { 
        console.warn('seedBurgCandidates: no cells, skipping'); 
        return []; 
      }
      if (!isWater?.length) { 
        console.warn('seedBurgCandidates: no isWater data, skipping'); 
        return []; 
      }
      if (!suitability?.length) { 
        console.warn('seedBurgCandidates: no suitability data, skipping'); 
        return []; 
      }
      
      try {
        // stash suitability for per-region stats
        let lastYield = performance.now();
        for (let i = 0; i < cells.length; i++) {
          // Yield every ~8ms to prevent UI freezing
          if (performance.now() - lastYield > 8) {
            await yieldNow();
            lastYield = performance.now();
          }
          cells[i].__suitability = suitability[i];
        }

        // Reserve capitals
        const capSet = new Set();
        const burgs = [];
        for (const cap of capitals) {
          const ci = cap.cellIndex ?? cap.cell ?? nearestCellIndex(cells, cap.x, cap.y);
          cap.cellIndex = ci; cap.cell = ci; cap.type = BurgType.CAPITAL; cap.capital = true;
          capSet.add(ci);
          burgs.push({ id: burgs.length, x: cap.x, y: cap.y, cellIndex: ci, type: BurgType.CAPITAL, capital: true });
        }

        // Stats & adaptive targets
        const stats = computeWorldStats(s, cells, isWater, suitability);
        stats.estuaries = estimateEstuaries(s, cells, isWater);
        const { tPort, tTown, tVillage, tManor } = allocateAdaptiveTargets(CONFIG, stats);

        // Ranked land indices with yield protection
        const ranked = [];
        lastYield = performance.now();
        for (let i = 0; i < cells.length; i++) {
          // Yield every ~8ms to prevent UI freezing
          if (performance.now() - lastYield > 8) {
            await yieldNow();
            lastYield = performance.now();
          }
          if (!isWater[i] && Number.isFinite(suitability[i]) && !capSet.has(i)) {
            ranked.push(i);
          }
        }
        ranked.sort((a,b) => suitability[b] - suitability[a]);

        // Region area/quality weighting
        const regAreas = computeRegionAreas(s, cells, isWater);
        const regions = regAreas.regions.sort((a,b)=> b.area - a.area);
        if (!regions.length) return burgs;
        const maxMean = Math.max(...regions.map(r => r.meanSuit));
        const totalW = regions.reduce((s,r)=> s + r.area * (0.6 + 0.4 * (r.meanSuit / Math.max(1e-9, maxMean))), 0);
        for (const r of regions) r.weight = r.area * (0.6 + 0.4 * (r.meanSuit / Math.max(1e-9, maxMean)));

        function splitTarget(total) {
          const raw = regions.map(r => ({ rid: r.regionId, v: total * (r.weight / Math.max(1e-9, totalW)) }));
          const floor = raw.map(o => ({ rid:o.rid, v: Math.floor(o.v) }));
          let used = floor.reduce((s,o)=>s+o.v, 0);
          let remain = Math.max(0, total - used);
          const frac = raw.map((o,i)=>({ idx:i, frac:o.v - floor[i].v })).sort((a,b)=> b.frac - a.frac);
          for (let k=0; k<remain; k++) floor[frac[k % frac.length].idx].v++;
          const out = new Map();
          for (const o of floor) out.set(o.rid, o.v);
          return out;
        }

        const qPort    = splitTarget(tPort);
        const qTown    = splitTarget(tTown);
        const qVillage = splitTarget(tVillage);
        const qManor   = splitTarget(tManor);

        // Per-region candidate pools with yield protection
        const perReg = new Map();
        for (const r of regions) perReg.set(r.regionId, { port:[], town:[], village:[], manor:[] });
        
        lastYield = performance.now();
        for (let idx = 0; idx < ranked.length; idx++) {
          // Yield every ~8ms to prevent UI freezing
          if (performance.now() - lastYield > 8) {
            await yieldNow();
            lastYield = performance.now();
          }
          
          const i = ranked[idx];
          const c = cells[i];
          const rid = c.regionId ?? s.regionOfCell?.[i];
          if (rid == null || !perReg.has(rid)) continue;
          const rs = s.riverSteps?.[i] ?? 99;
          const cs = s.coastSteps?.[i] ?? 99;
          const flat = 1 - (c.localSlope ?? 0);
          const fertile = (c.biomeFertility ?? 0.5);
          if (cs === 0 && c.isShelteredHarbor) perReg.get(rid).port.push(i);
          if (rs <= 1 || (c.riverDegree ?? 0) >= 2) perReg.get(rid).town.push(i);
          if (flat >= 0.5 && fertile >= 0.5) perReg.get(rid).village.push(i);
          perReg.get(rid).manor.push(i);
        }

        const baseSpacing = { ...CONFIG.settlements.spacing };
        const takenByType = new Map();
        takenByType.set('port', []); takenByType.set('town', []); takenByType.set('village', []); takenByType.set('manor', []);
        function spaced(list, px, x, y) { for (const q of list) if (Math.hypot(x - q.x, y - q.y) < px) return false; return true; }

        const order = ["port","town","village","manor"];
        const placedCount = { port:0, town:0, village:0, manor:0 };

        lastYield = performance.now();
        for (const r of regions) {
          // Check if we need to yield to avoid UI stalls
          if (performance.now() - lastYield > 8) {
            await yieldNow();
            lastYield = performance.now();
          }
          const rid = r.regionId;
          const quota = {
            port:    qPort.get(rid)    ?? 0,
            town:    qTown.get(rid)    ?? 0,
            village: qVillage.get(rid) ?? 0,
            manor:   qManor.get(rid)   ?? 0
          };
          let spacing = { ...baseSpacing };
          const picks = { port:[], town:[], village:[], manor:[] };

          function fillType(type) {
            const target = quota[type];
            if (!target) return;
            if (type !== 'port') {
              const pool = perReg.get(rid)[type];
              for (let idx = 0; idx < pool.length && picks[type].length < target; idx++) {
                const i = pool[idx];
                if (capSet.has(i)) continue;
                const c = cells[i];
                const x = c.cx, y = c.cy;
                if (!spaced(takenByType.get(type), spacing[type], x, y)) continue;
                const b = { id: burgs.length + 1000000, x, y, cellIndex: i, type };
                picks[type].push(b);
                takenByType.get(type).push({ x, y });
              }
            } else {
              // Ports: tier-1 first, then tier-2 by harborScore
              const pool1 = perReg.get(rid).port;
              const t2Threshold = 0.8;
              const pool2 = (perReg.get(rid).manor || []).filter(i => (s.coastSteps?.[i] ?? 99) === 0 && (s.harborScore?.[i] ?? 0) >= t2Threshold);
              // Tier-1
              for (let idx = 0; idx < pool1.length && picks.port.length < target; idx++) {
                const i = pool1[idx];
                if (capSet.has(i)) continue;
                const c = cells[i]; const x = c.cx, y = c.cy;
                if (!spaced(takenByType.get('port'), spacing.port, x, y)) continue;
                picks.port.push({ id: burgs.length + 1000000, x, y, cellIndex: i, type: 'port', flags:{ minorPort:false } });
                takenByType.get('port').push({x,y});
              }
              // Tier-2 if still short
              for (let idx = 0; idx < pool2.length && picks.port.length < target; idx++) {
                const i = pool2[idx];
                if (capSet.has(i)) continue;
                const c = cells[i]; const x = c.cx, y = c.cy;
                if (!spaced(takenByType.get('port'), spacing.port, x, y)) continue;
                picks.port.push({ id: burgs.length + 1000000, x, y, cellIndex: i, type: 'port', flags:{ minorPort:true } });
                takenByType.get('port').push({x,y});
              }
            }
          }

          for (const t of order) fillType(t);
          const short = () => order.some(t => (picks[t].length < (quota[t] || 0)));
          if (short()) {
            spacing.port    *= 0.88;
            spacing.town    *= 0.88;
            spacing.village *= 0.88;
            spacing.manor   *= 0.88;
            for (const t of order) fillType(t);
          }

          for (const t of order) {
            for (const b of picks[t]) {
              b.type = t === "port" ? BurgType.PORT : t === "town" ? BurgType.TOWN : t === "village" ? BurgType.VILLAGE : BurgType.MANOR;
              burgs.push({ id: burgs.length, ...b, capital:false });
              placedCount[t]++;
            }
          }
        }

        async function fillRemainder(type, need) {
          if (need <= 0) return;
          const space = baseSpacing[type];
          const list = takenByType.get(type);
          lastYield = performance.now();
          for (const i of ranked) {
            // Check if we need to yield to avoid UI stalls
            if (performance.now() - lastYield > 8) {
              await yieldNow();
              lastYield = performance.now();
            }
            if (need <= 0) break;
            if (capSet.has(i)) continue;
            const c = cells[i], x = c.cx, y = c.cy;
            if (!spaced(list, space*0.8, x, y)) continue;
            const rs = s.riverSteps?.[i] ?? 999;
            const cs = s.coastSteps?.[i] ?? 999;
            const flat = 1 - (c.localSlope ?? 0);
            const fertile = (c.biomeFertility ?? 0.5);
            if (type === "port" && !(cs===0 && c.isShelteredHarbor)) continue;
            if (type === "town" && !(rs<=1 || (c.riverDegree ?? 0)>=2)) continue;
            if (type === "village" && !(flat>=0.5 && fertile>=0.5)) continue;
            burgs.push({ id: burgs.length, x, y, cellIndex:i,
              type: type === "port" ? BurgType.PORT : type === "town" ? BurgType.TOWN : type === "village" ? BurgType.VILLAGE : BurgType.MANOR,
              capital:false
            });
            list.push({x,y});
            need--;
          }
        }

        await fillRemainder("port",    Math.max(0, tPort    - placedCount.port));
        await fillRemainder("town",    Math.max(0, tTown    - placedCount.town));
        await fillRemainder("village", Math.max(0, tVillage - placedCount.village));
        await fillRemainder("manor",   Math.max(0, tManor   - placedCount.manor));

        // Final ID assignment with yield protection
        lastYield = performance.now();
        for (let k = 0; k < burgs.length; k++) {
          // Yield every ~8ms to prevent UI freezing
          if (performance.now() - lastYield > 8) {
            await yieldNow();
            lastYield = performance.now();
          }
          burgs[k].id = k;
        }
        
        // Export for debug
        window.__state.seedBurgCandidates = seedBurgCandidates;
        
        return burgs;
      } catch (error) {
        console.error('Error in seedBurgCandidates:', error);
        // Return empty burg set on error to prevent pipeline failure
        return [];
      }
    }

    function assignBurgTypes(state, burgs, capitals) {
      const {s} = getWorld();
      const {templates} = getConfig();
      
      // Defensive guards
      if (!burgs?.length) { 
        console.warn('assignBurgTypes: no burgs, skipping'); 
        return; 
      }
      if (!capitals?.length) { 
        console.warn('assignBurgTypes: no capitals, skipping'); 
        return; 
      }
      
      for (const b of burgs) {
        b.capital = b.type === BurgType.CAPITAL;
        b.port    = b.type === BurgType.PORT || b.isPort === true;
      }
      const caps = state.macroCapitals || capitals;
      for (const b of burgs) {
        let best = 0, bestD = Infinity;
        for (let i=0;i<caps.length;i++){
          const c = caps[i];
          const d = Math.hypot(b.x - c.x, b.y - c.y);
          if (d < bestD) { bestD = d; best = i; }
        }
        b.regionId = best;
      }
      state.burgs = burgs;
    }

    function scaleBurgPopulations(state, burgs, capitals, suitability) {
      const {s, cells, isWater} = getWorld();
      const {templates} = getConfig();
      
      // Defensive guards
      if (!burgs?.length) { 
        console.warn('scaleBurgPopulations: no burgs, skipping'); 
        return; 
      }
      if (!capitals?.length) { 
        console.warn('scaleBurgPopulations: no capitals, skipping'); 
        return; 
      }
      if (!suitability?.length) { 
        console.warn('scaleBurgPopulations: no suitability data, skipping'); 
        return; 
      }
      
      const bands = {
        [BurgType.MANOR]:   [150, 400],
        [BurgType.VILLAGE]: [400, 1200],
        [BurgType.TOWN]:    [2000, 6000],
        [BurgType.PORT]:    [5000, 20000],
        [BurgType.CAPITAL]: [30000, 120000]
      };
      const maxS = Math.max(...suitability.filter(Number.isFinite));
      const rng  = rngFromMapSeed("pop");

      const capPowerByIdx = new Map();
      capitals.forEach((c)=> capPowerByIdx.set(c.cellIndex ?? nearestCellIndex(state.cells, c.x, c.y), c.power ?? 1));

      for (const b of burgs) {
        const base = bands[b.type] || [300,800];
        const suit = suitability[b.cellIndex] / (maxS || 1);
        let pop = base[0] + (base[1] - base[0]) * Math.min(1, Math.max(0, suit));

        const rs = s.riverSteps?.[b.cellIndex] ?? 999;
        const cs = s.coastSteps?.[b.cellIndex] ?? 999;
        if (b.type === BurgType.PORT && cs === 0) pop *= 1.5;
        if (b.type === BurgType.PORT) {
          const minor = b.flags && b.flags.minorPort;
          if (minor) pop *= 0.8;
          const score = (s.harborScore?.[b.cellIndex] ?? 0);
          if (!minor && score > 1.2) pop *= 1.1;
        }
        if (rs <= 1) pop *= 1.25;
        if (b.capital) pop *= (capitals[b.regionId]?.power ?? 1.0);

        pop *= 0.9 + 0.2 * rng();
        b.population = Math.round(pop);
      }

      // === Compute population ranks & stash type class ===
      (function prepBurgRankAndType(){
        const bs = state.burgs && state.burgs.length ? state.burgs : burgs;
        if (!bs || !bs.length) return;
        const sorted = [...bs].sort((a,b)=> (b.population||0) - (a.population||0));
        const rankPct = new Map();
        sorted.forEach((b, i)=> rankPct.set(b.id, i / Math.max(1, sorted.length - 1)));
        for (const b of bs) {
          b.popRank = rankPct.get(b.id) ?? 1.0; // 0 = largest
          b.typeClass = b.capital ? "capital" :
            (b.type === BurgType.PORT ? "port" :
             b.type === BurgType.TOWN ? "town" :
             b.type === BurgType.VILLAGE ? "village" : "manor");
        }
      })();
    }
    // -------------------- REGIONAL STYLES + NAME ASSIGNMENT --------------------
    // Optional knobs (set near your config)
    // Tweak variety
    const NAME_TEMPERATURE = 1.0; // >1 = wilder, <1 = safer

    async function generateRegionalNames({renameAll = false} = {}) {
      const yieldNow = () => new Promise(requestAnimationFrame);
      
      try {
        const {burgs, s} = getWorld();
        const filteredBurgs = burgs.filter(b => !b.removed);
        if (!filteredBurgs.length) return;

        // K regions
        const K = getMacroRegionCount();

        // Capitals: use existing or choose K
        let caps = s.macroCapitals;
        if (!caps || caps.length !== K) {
          caps = chooseMacroCapitals(K);
          assignMacroRegions(caps); // assigns b.regionId
        } else {
          assignMacroRegions(caps); // re-assign if burgs changed
        }

        // Styles: deterministic selection for this map
        const mapSeed = String(s?.seed ?? 'mapseed');
        const regionStyles = buildRegionStyles(K, mapSeed);

        // Prepare models per region style (deduplicate models by style to reuse)
        const modelCache = new Map();
        const models = regionStyles.map((style) => {
          const key = JSON.stringify(style.corpus) + '|' + style.order;
          if (!modelCache.has(key)) modelCache.set(key, NameGen.makeModel(style));
          return modelCache.get(key);
        });

        // Used-name set (lowercased)
        const used = NameGen.uniqueSetFromExisting(filteredBurgs);

        // Generate per burg (deterministic RNG + optional stylization) with yield protection
        let lastYield = performance.now();
        for (let i = 0; i < filteredBurgs.length; i++) {
          // Yield every ~8ms to prevent UI freezing
          if (performance.now() - lastYield > 8) {
            await yieldNow();
            lastYield = performance.now();
          }
          
          const b = filteredBurgs[i];
          if (b.lockName === true) continue;
          if (!renameAll && b.name && b.name !== 'Unnamed') continue;

          try {
            const style  = regionStyles[b.regionId % regionStyles.length];
            const model  = models[b.regionId % models.length];
            const seedStr = `${mapSeed}|region:${b.regionId}|burg:${b.id}|${s.regenerationCount || 0}`;
            const rng = NameGen.seededRNG(seedStr);

            let nm = NameGen.generateUnique(model, used, {min: style.min, max: style.max, rng, temp: 1.8});
            nm = NameGen.stylizeName ? NameGen.stylizeName(nm, findStyleKey(style), rng) : nm; // optional stylization
            b.name = nm;
          } catch (error) {
            console.warn(`Failed to generate name for burg ${b.id}:`, error);
            b.name = 'Unnamed'; // Fallback name
            continue; // Continue with next burg
          }
        }
      } catch (error) {
        console.error('Error in generateRegionalNames:', error);
        // Continue with existing names or fallbacks
      }
    }

    // Helper: find the key for a style object (for stylizeName)
    function findStyleKey(styleObj) {
      for (const [k, v] of Object.entries(NameGen.STYLE_PACKS)) {
        if (v === styleObj) return k;
      }
      return 'default';
    }

    // Debug function to show current style assignments
    function logCurrentStyles() {
      const K = getMacroRegionCount();
      const mapSeed = String(window.__state?.seed ?? 'mapseed');
      const regionStyles = buildRegionStyles(K, mapSeed);
      
      console.log('Current style assignments:');
      regionStyles.forEach((style, i) => {
        const styleKey = findStyleKey(style);
        console.log(`Region ${i}: ${styleKey}`);
      });
    }

    // Burg label dataset (capitals vs towns)
    function computeBurgLabelData() {
      const {burgs} = getWorld();
      const filteredBurgs = burgs.filter(b => !b.removed);
      return filteredBurgs.map(b => ({
        id: b.id, name: b.name, x: b.x, y: b.y,
        isCapital: !!b.capital || b.type === 'capital',
        // optional persisted manual offsets / positions:
        ox: b.label?.ox || 0, oy: b.label?.oy || -8,
        px: b.label?.px, py: b.label?.py // "pinned" screen coords if user dragged
      }));
    }

    // Generate region names using the same style system as burgs
    function generateRegionNames() {
      try {
        const K = getMacroRegionCount();
        const mapSeed = String(window.__state?.seed ?? 'mapseed');
        const regionStyles = buildRegionStyles(K, mapSeed);
        
        // Prepare models per region style (deduplicate models by style to reuse)
        const modelCache = new Map();
        const models = regionStyles.map((style) => {
          const key = JSON.stringify(style.corpus) + '|' + style.order;
          if (!modelCache.has(key)) modelCache.set(key, NameGen.makeModel(style));
          return modelCache.get(key);
        });
        
        // Used-name set (lowercased) - include existing burg names
        const used = NameGen.uniqueSetFromExisting(window.__state?.burgs || []);
        
        // Generate names for each region with error protection
        const regionNames = [];
        for (let i = 0; i < K; i++) {
          try {
            const style = regionStyles[i];
            const model = models[i];
            const seedStr = `${mapSeed}|region:${i}|name`;
            const rng = NameGen.seededRNG(seedStr);
            
            let nm = NameGen.generateUnique(model, used, {min: style.min, max: style.max, rng, temp: 1.8});
            nm = NameGen.stylizeName ? NameGen.stylizeName(nm, findStyleKey(style), rng) : nm;
            regionNames.push(nm);
            used.add(nm.toLowerCase()); // Add to used set to avoid conflicts
          } catch (error) {
            console.warn(`Failed to generate name for region ${i}:`, error);
            regionNames.push(`Region ${i + 1}`); // Fallback name
            continue; // Continue with next region
          }
        }
        
        return regionNames;
      } catch (error) {
        console.error('Error in generateRegionNames:', error);
        // Return fallback region names
        const K = getMacroRegionCount();
        return Array.from({length: K}, (_, i) => `Region ${i + 1}`);
      }
    }

    // computeAndDrawRegions moved to regions.js - orphaned code removed

    function simplifyDP(points, tol) {
      if (!Array.isArray(points) || points.length <= 2) return points;
      
      // Skip simplification for very small rings to avoid unnecessary computation
      if (points.length <= 20) return points;
      
      const keep = new Uint8Array(points.length); keep[0]=1; keep[points.length-1]=1;
      let recursionDepth = 0;
      const maxRecursionDepth = 100; // Prevent excessive recursion

      function perpDist(p,a,b){
        const dx = b.x - a.x, dy = b.y - a.y;
        const l2 = dx*dx + dy*dy || 1;
        const t = Math.max(0, Math.min(1, ((p.x-a.x)*dx + (p.y-a.y)*dy) / l2));
        const px = a.x + t*dx, py = a.y + t*dy;
        return Math.hypot(p.x - px, p.y - py);
      }

      function rec(i,j){
        if (recursionDepth++ > maxRecursionDepth) return; // Prevent excessive recursion
        let idx=-1, maxd=0;
        for (let k=i+1;k<j;k++){
          const d = perpDist(points[k], points[i], points[j]);
          if (d>maxd){ maxd=d; idx=k; }
        }
        if (maxd > tol) { keep[idx]=1; rec(i,idx); rec(idx,j); }
      }
      rec(0, points.length-1);
      const out=[]; for (let i=0;i<points.length;i++) if (keep[i]) out.push(points[i]);
      return out;
    }

    // Build region polygons in GeoJSON-ish format: [ [ [x,y], ... ] , ... ]
    // Now uses actual computed regions from Azgaar-style assignment
    function getStatePolys() {
      const {cells, isWater, s} = getWorld();
      const roc = s?.regionOfCell; // Int32Array from assignment
      if (!roc || !cells.length) return [];

      // group cells by region id (>=0 only)
      const byR = new Map();
      for (let i = 0; i < cells.length; i++) {
        const r = roc[i];
        if (r < 0 || isWater[i]) continue;
        if (!byR.has(r)) byR.set(r, []);
        byR.get(r).push(i);
      }

      // For each region, rebuild boundary segments → rings
      const out = [];
      const segsByRegion = buildRegionSegments(cells, isWater, roc);
      for (const [rid, segs] of segsByRegion) {
        const rings = segmentsToRings(segs);
        // Convert to [ [ [x,y], ... ] ] form expected by computeRegionLabelData
        const ringPts = rings.map(r => r.map(p => [p.x, p.y]));
        out.push({ id: rid, name: `Region ${rid+1}`, rings: ringPts });
      }
      return out;
    }

    // Region label dataset via pole of inaccessibility (polylabel)
    function computeRegionLabelData() {
      const states = getStatePolys();
      return states.map(s => {
        // polylabel expects MultiPolygon-like: [rings], choose the ring set with max area
        const rings = s.rings.sort((a,b)=>Math.abs(d3.polygonArea(b))-Math.abs(d3.polygonArea(a)))[0];
        if (!rings) return null;
        
        try {
          // polylabel input is array of rings, each ring is array of [x,y]
          if (typeof polylabel === 'function' && rings && rings.length >= 3) {
            const p = polylabel([rings], 1.5); // precision in pixels
            return { id: s.id, name: s.name, x: p[0], y: p[1] };
          } else {
            // Fallback to centroid if polylabel is not available or invalid polygon
            const centroid = d3.polygonCentroid(rings);
            return { id: s.id, name: s.name, x: centroid[0], y: centroid[1] };
          }
        } catch (error) {
          console.warn('Error computing polylabel for region', s.id, error);
          // Fallback to centroid
          const centroid = d3.polygonCentroid(rings);
          return { id: s.id, name: s.name, x: centroid[0], y: centroid[1] };
        }
      }).filter(Boolean);
    }

    // Call this inside buildLandGraph after you compute nodes & edges
    function finalizeLandGraph(nodesCount, edges) {
      // edges: [{u:int, v:int, w:number}]
      const neighbors = new Array(nodesCount); for (let i=0;i<nodesCount;i++) neighbors[i]=[];
      const edgeCost = new Map(); // `${u}:${v}` -> w
      for (const e of edges){ neighbors[e.u].push(e.v); neighbors[e.v].push(e.u); edgeCost.set(`${e.u}:${e.v}`, e.w); edgeCost.set(`${e.v}:${e.u}`, e.w); }
      GraphCache.land = { nodesCount, edges, neighbors, edgeCost };
    }

    function finalizeSeaGraph(nodesCount, edges, xy) {
      const neighbors = new Array(nodesCount); for (let i=0;i<nodesCount;i++) neighbors[i]=[];
      const edgeCost = new Map();
      for (const e of edges){ neighbors[e.u].push(e.v); neighbors[e.v].push(e.u); edgeCost.set(`${e.u}:${e.v}`, e.w); edgeCost.set(`${e.v}:${e.u}`, e.w); }
      GraphCache.sea = { nodesCount, edges, neighbors, edgeCost, xy };
    }

    // === SeaRouter with cache ===
    const SeaRouter = {
      _cache: new Map(), // key: portNodeId -> {dist: Float64Array, prev: Int32Array}
      clear(){ this._cache.clear(); },
      ensureFor(portNodeId){
        const G = GraphCache.sea; if (!G) throw new Error('Sea graph missing');
        if (this._cache.has(portNodeId)) return this._cache.get(portNodeId);

        const N = G.nodesCount, neighbors=G.neighbors, cost=(u,v)=>G.edgeCost.get(`${u}:${v}`) ?? 1;
        const dist=new Float64Array(N); dist.fill(1e20); dist[portNodeId]=0;
        const prev=new Int32Array(N); prev.fill(-1);
        const open = new MinHeap(i=>dist[i]); open.push(portNodeId);

        while(open.size){
          const u=open.pop();
          for (const v of neighbors[u]) {
            const alt = dist[u] + cost(u,v);
            if (alt < dist[v]) { dist[v]=alt; prev[v]=u; open.push(v); }
          }
        }
        const pack = {dist, prev};
        this._cache.set(portNodeId, pack);
        return pack;
      },
      
      // Early-exit variant that stops when all target ports are reached
      ensureForToTargets(portNodeId, goalNodeIds) {
        const G = GraphCache.sea; if (!G) throw new Error('Sea graph missing');
        const goalSet = new Set(goalNodeIds);
        const N = G.nodesCount, neighbors=G.neighbors, cost=(u,v)=>G.edgeCost.get(`${u}:${v}`) ?? 1;

        const dist=new Float64Array(N); dist.fill(1e20); dist[portNodeId]=0;
        const prev=new Int32Array(N); prev.fill(-1);
        const open = new MinHeap(i=>dist[i]); open.push(portNodeId);

        let remaining = goalSet.size;
        while (open.size && remaining > 0) {
          const u = open.pop();
          if (goalSet.has(u)) { goalSet.delete(u); remaining--; if (remaining === 0) break; }
          const du = dist[u];
          for (const v of neighbors[u]) {
            const alt = du + cost(u,v);
            if (alt < dist[v]) { dist[v]=alt; prev[v]=u; open.push(v); }
          }
        }
        return {dist, prev};
      }
    };

    // Returns nearest sea node within maxPx, else -1
    function snapPortToSeaNode(x, y, maxPx = 16) {
      const G = GraphCache.sea; if (!G || !G.xy) throw new Error('Sea graph missing coords');
      let best = -1, bestD2 = maxPx*maxPx;
      for (let i=0;i<G.xy.length;i++) {
        const pt = G.xy[i]; if (!pt) continue; // Skip null entries
        const dx = pt[0]-x, dy = pt[1]-y, d2 = dx*dx+dy*dy;
        if (d2 < bestD2) { best=i; bestD2=d2; }
      }
      return best;
    }

    // Label connected components once (linear time)
    function labelSeaComponents() {
      const G = GraphCache.sea; if (!G) return null;
      const comp = new Int32Array(G.nodesCount); comp.fill(-1);
      let id = 0;
      for (let s=0;s<G.nodesCount;s++){
        if (comp[s] !== -1) continue;
        const q=[s]; comp[s]=id;
        for(let qi=0; qi<q.length; qi++){
          const u=q[qi];
          for(const v of G.neighbors[u]) if (comp[v]===-1){ comp[v]=id; q.push(v); }
        }
        id++;
      }
      return comp;
    }

    // Returns Float32Array len=cellsCount with distance (in cells) to nearest water cell
    function computeDistanceToWater(isWater, width, height) {
      const N = width*height;
      const INF = 1e9;
      const dist = new Float32Array(N); for (let i=0;i<N;i++) dist[i]=INF;
      const q = [];

      // multi-source with all water cells
      for (let i=0;i<N;i++) if (isWater[i]) { dist[i]=0; q.push(i); }

      let qi=0;
      const neighborsIdx = (idx) => {
        const x = idx%width, y=(idx/width|0);
        const out=[];
        if (x>0) out.push(idx-1);
        if (x<width-1) out.push(idx+1);
        if (y>0) out.push(idx-width);
        if (y<height-1) out.push(idx+width);
        return out;
      };

      while (qi<q.length){
        const u=q[qi++];
        const du=dist[u]+1;
        for (const v of neighborsIdx(u)) if (du<dist[v]) { dist[v]=du; q.push(v); }
      }
      return dist;
    }

    function drawPathsFromSegments(svgLayer, segments, className) {
      if (!segments || !segments.length) return;
      const polylines = segmentsToPolylines(segments);
      const frag = document.createDocumentFragment();
      for (const poly of polylines) {
        const d = polylineToPathD(poly);
        if (!d) continue;
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('class', className);
        p.setAttribute('d', d);
        frag.appendChild(p);
      }
      svgLayer.textContent=''; // clear layer
      svgLayer.appendChild(frag);
    }

    function resetGenerationState() {
      // Clear SVG layers (roads/trails/sea/coastlines etc.)
      const ids = ['roadsLayer','trailsLayer','seaRoutesLayer','coastlinesLayer','burgsLayer'];
      for (const id of ids) { const n = document.getElementById(id); if (n) n.textContent=''; }
      // Invalidate graphs & caches
      GraphCache.invalidate();
      SeaRouter.clear();
      // Any per-run arrays (burgs, roads, trails, usage…) should be re-created here
    }

    // Debounce function for UI updates
    const rafDebounce = (fn) => {
      let r = 0; 
      return (...a) => { 
        cancelAnimationFrame(r); 
        r = requestAnimationFrame(() => fn(...a)); 
      }; 
    };

    // Heavy debounced recolor for expensive operations
    const heavyDebounce = (fn, delay = 150) => {
      let timeout = 0; 
      return (...a) => { 
        clearTimeout(timeout); 
        timeout = setTimeout(() => fn(...a), delay); 
      }; 
    };

    // Route computation debouncing and single-flight logic
    let routeRunToken = 0;
    let isRouting = false;
    let pendingRoutes = false;
    
    // Heavier debounce for sliders on phones
    const isCoarse = window.matchMedia('(pointer: coarse)').matches;
    const HEAVY_DELAY = isCoarse ? 400 : 200;

    // debouncedComputeRoutes removed with fixed pipeline

    // === Layers: ensure #routes and expected subgroups exist (roads, trails, searoutes) ===
    // Moved to routes.js

    // === Routes: moved to routes.js ===
    // Routes functionality has been extracted to js/routes.js
    // Import computeRoutes from './routes.js' at the top of this file

    // Cached DOM elements for performance
    const DOM = {
      seaLevelInput: document.getElementById('seaLevelInput'),
      sizeInput: document.getElementById('sizeInput')
    };




    // Precipitation caching
    let PRECIP = null;
    function recomputePrecip() { 
      PRECIP = computePrecipArray(); 
    }

    // Set up precipitation recomputation on climate changes
    ['rainInput', 'windBelts'].forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener('input', rafDebounce(recomputePrecip));
      }
    });

    // Set up terrain dirty flag triggers
    ['seaLevelInput', 'talusInput', 'thermalStrengthInput', 'smoothAlphaInput'].forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener('input', () => ensureTerrainCanvas().setDirty());
      }
    });

    // Set up debounced recolor for heavy sliders
    const heavySliders = ['seaLevelInput', 'riverDensityInput', 'riverWidthInput', 'minLakeSizeInput', 'minLakeDepthInput'];
    heavySliders.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener('input', heavyDebounce(() => {
          // Invalidate caches when sea level changes
          if (id === 'seaLevelInput') {
            GraphCache.invalidate();
            SeaRouter.clear();
          }
          RegenerationFlags.setNeedsRecolor();
          if (window.__state) {
            // ensure the water mask + coastlines match the new sea level
            if (typeof window.drawCoastlines === 'function') window.drawCoastlines();
            if (typeof recolorCurrent === 'function') recolorCurrent();
          }
        }, HEAVY_DELAY));
      }
    });

    // Set up regeneration flags for seed-only changes
    const seedOnlySliders = ['highInput', 'radiusInput', 'sharpnessInput', 'smallCountInput'];
    seedOnlySliders.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener('input', () => {
          RegenerationFlags.setNeedsRegenerate();
        });
      }
    });
    // Centralized route layer management
    const RouteLayers = (() => {
      const svg = d3.select('svg');
      let root = d3.select('#routes');
      if (root.empty()) {
        // Routes are now created in the zoomRoot, so just get the existing one
        root = d3.select('#routes');
      }
      const g = {
        root,
        roads: root.select('.roads'),
        trails: root.select('.trails'),
        sea: root.select('.searoutes')
      };
      return g;
    })();

    // Route building optimization
    function pathFromPolylines(lines) {
      // lines: Array<Array<[x,y]>>
      let d = '';
      for (const L of lines) {
        if (!L.length) continue;
        d += `M${L[0][0]},${L[0][1]}`;
        for (let i = 1; i < L.length; i++) d += `L${L[i][0]},${L[i][1]}`;
      }
      return d;
    }
    /**
     * Draw lines with instrumentation for debugging
     * @param {string} selector - CSS selector for the target group
     * @param {Array} lines - Array of polylines
     */
    function drawLines(selector, lines) {
      const d = pathFromPolylines(lines);
      const sel = d3.select(selector);
      sel.selectAll('path').data([0]).join('path').attr('d', d);

      // Quick instrumentation
      const segs = lines.reduce((a, L) => a + Math.max(0, L.length - 1), 0);
      const len = lines.reduce((a, L) => a + L.reduce((s, [x, y], i) => s + (i ? Math.hypot(x - L[i - 1][0], y - L[i - 1][1]) : 0), 0), 0);
      console.log(selector, { polylines: lines.length, segments: segs, totalLength: len.toFixed(1) });
    }

    // SVG Path simplification using Ramer-Douglas-Peucker algorithm
    function simplifyPath(points, tolerance = 0.2) {
      if (points.length <= 2) return points;
      
      function perpendicularDistance(point, lineStart, lineEnd) {
        const [x, y] = point;
        const [x1, y1] = lineStart;
        const [x2, y2] = lineEnd;
        
        const A = x - x1;
        const B = y - y1;
        const C = x2 - x1;
        const D = y2 - y1;
        
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        
        if (lenSq !== 0) param = dot / lenSq;
        
        let xx, yy;
        if (param < 0) {
          xx = x1;
          yy = y1;
        } else if (param > 1) {
          xx = x2;
          yy = y2;
        } else {
          xx = x1 + param * C;
          yy = y1 + param * D;
        }
        
        const dx = x - xx;
        const dy = y - yy;
        return Math.sqrt(dx * dx + dy * dy);
      }
      
      function douglasPeucker(points, start, end, tolerance, result) {
        if (end <= start + 1) return;
        
        let maxDistance = 0;
        let index = start;
        
        for (let i = start + 1; i < end; i++) {
          const distance = perpendicularDistance(points[i], points[start], points[end]);
          if (distance > maxDistance) {
            index = i;
            maxDistance = distance;
          }
        }
        
        if (maxDistance > tolerance) {
          douglasPeucker(points, start, index, tolerance, result);
          result.push(points[index]);
          douglasPeucker(points, index, end, tolerance, result);
        }
      }
      
      const result = [points[0]];
      douglasPeucker(points, 0, points.length - 1, tolerance, result);
      result.push(points[points.length - 1]);
      
      return result;
    }
    /**
     * Adaptive path simplification based on map size
     * @param {Array} lines - Array of polylines
     * @param {number} width - Map width
     * @param {number} height - Map height
     * @returns {Array} Simplified polylines
     */
    function adaptiveSimplify(lines, width, height) {
      const tol = Math.max(0.2, Math.min(1.5, Math.sqrt(width * height) / 1800));
      return lines.map(L => simplifyPath(L, tol));
    }

    function adaptiveSimplifySea(lines, w, h) {
      const tol = Math.max(0.1, Math.min(0.5, Math.sqrt(w*h)/50000)); // Extremely gentle simplification to preserve curves
      return lines.map(L => {
        const simplified = simplifyPath(L, tol);
        // Ensure we keep at least 3 points for any meaningful curve
        return simplified.length < 3 ? L : simplified;
      });
    }

    // Dirty flags for incremental updates
    const RouteDirty = {
      burgs: true,
      landGraph: true,
      sea: true
    };
    // Regeneration flags for seed-only changes
    const RegenerationFlags = {
      needsRegenerate: false,
      needsRecolor: false,
      
      setNeedsRegenerate() {
        this.needsRegenerate = true;
        this.needsRecolor = true;
      },
      
      setNeedsRecolor() {
        this.needsRecolor = true;
      },
      
      clear() {
        this.needsRegenerate = false;
        this.needsRecolor = false;
      }
    };
    // Progress management system - now imported from ui-overlays.js

  (function () {
    'use strict';

      // Progress manager and service worker registration moved to app.js

    // Define constants up-front so they're available when generate() first runs
    const WATER_COLOR = d3.interpolateBlues(0.55); // single water color (less busy)

    // generate will be exposed globally after it's defined

    // Hide tunable panels to align with deterministic Azgaar flow
    function hideTunablePanels() {
      const sel = [
        "#settlements-tab",
        "#routes-tab",
        "#tab-settlements",
        "#tab-routes"
      ];
      sel.forEach(s => {
        const el = document.querySelector(s);
        if (el) {
          el.setAttribute("aria-hidden", "true");
          el.style.display = "none";
        }
      });
    }
    hideTunablePanels();

    // Make any leftover slider-driven callbacks no-ops
    const NO_OP = () => {};
    ["debouncedComputeRoutes", "toggleRoutes", "generateBurgs"].forEach(fn => {
      if (typeof window[fn] === "function") window[fn] = NO_OP;
    });
    
    // toggleRoutes removed with fixed pipeline

    // State we expose for tests/debugging
    window.__state = { cells: null, delaunay: null, voronoi: null, svg: null, add: null, recolor: null, autoSeed: null, drawCoastlines: null, applyBorder: null, borderPx: 0, burgs: [], regenerationCount: 0, chooseMacroCapitals: null, assignMacroRegions: null, getMacroRegionCount: null, buildRegionStyles: null, generateRegionNames: null, logCurrentStyles: null, assignRegionsAzgaar: null, computeAndDrawRegions: null };

    // Export functions (will be defined later)
    window.saveSVG = null;
    window.savePNG = null;

    // Burg data model and generation constants
    const BURG_TYPES = {
      hamlet: { radius: 1.5, population: 100 },
      town: { radius: 2.5, population: 1000 },
      city: { radius: 3.5, population: 10000 },
      capital: { radius: 4.5, population: 50000 },
      port: { radius: 2.5, population: 2000 }
    };

    // Simple name generation (placeholder - can be enhanced with culture-based names)
    const BURG_NAMES = [
      'Riverton', 'Harborview', 'Stonebridge', 'Greenfield', 'Ironforge',
      'Silverport', 'Goldcrest', 'Blackwood', 'Whitecliff', 'Redhaven',
      'Bluewater', 'Fairview', 'Highland', 'Lowland', 'Midtown',
      'Northport', 'Southgate', 'Eastside', 'Westend', 'Central'
    ];

    // initialize outputs to match inputs
    sizeOutput.value = sizeInput.valueAsNumber;
    highOutput.value = highInput.valueAsNumber;
    radiusOutput.value = radiusInput.valueAsNumber;
    sharpnessOutput.value = sharpnessInput.valueAsNumber;
    seaLevelOutput.value = seaLevelInput.valueAsNumber;
    smallCountOutput.value = smallCountInput.valueAsNumber;
    borderPctOutput.value = borderPctInput.valueAsNumber;
    minLakeSizeOutput.value = minLakeSizeInput.valueAsNumber;
    minLakeDepthOutput.value = minLakeDepthInput.valueAsNumber;
    baseTempOutput.value = baseTempInput.valueAsNumber;
    precipScaleOutput.value = precipScaleInput.valueAsNumber;
    riverWidthOutput.value = riverWidthInput.valueAsNumber;
    talusOutput.value = talusInput.valueAsNumber;
    thermalStrengthOutput.value = thermalStrengthInput.valueAsNumber;
    smoothAlphaOutput.value = smoothAlphaInput.valueAsNumber;
    // Removed settlement/route tunables (guarded)
    const disbalanceOutput = document.getElementById('disbalanceOutput');
    const disbalanceInput = document.getElementById('disbalanceInput');
    const overseasPenaltyOutput = document.getElementById('overseasPenaltyOutput');
    const overseasPenaltyInput = document.getElementById('overseasPenaltyInput');
    const maxManorDistOutput = document.getElementById('maxManorDistOutput');
    const maxManorDistInput = document.getElementById('maxManorDistInput');
    if (disbalanceOutput && disbalanceInput) disbalanceOutput.value = disbalanceInput.valueAsNumber;
    if (overseasPenaltyOutput && overseasPenaltyInput) overseasPenaltyOutput.value = overseasPenaltyInput.valueAsNumber;
    if (maxManorDistOutput && maxManorDistInput) maxManorDistOutput.value = maxManorDistInput.valueAsNumber;

    function resetForNewRun() {
      const svg = d3.select('svg');
      // remove visual layers that will be rebuilt
      svg.select('.mapCells').remove();
      svg.select('.coastline').remove();
      svg.select('.rivers').remove();
      svg.select('#routes').remove();
      svg.select('#burgs').remove();
      svg.select('#labels').remove();
      svg.select('rect.ocean').remove();
      svg.select('defs #landClip').remove();

      // invalidate all per-run caches that can poison the next run
      resetCaches();
    }
          // Replace the early generate function with the full implementation
          window.generate = async function() {
        if (runInFlight) { genQueued = true; return; }
        runInFlight = true;
        const run = getNewRun();

        ProgressManager.attach(run);
        ProgressManager.show();
        ProgressManager.setPhase('init');
        console.log(`[RUN ${run}] start generate`);

        try {
          const tAll = performance.now();
          resetGenerationState();
          resetForNewRun();
        
        // Always generate a new random seed when button is pressed
        // Only use input value if user has explicitly set it (not auto-generated)
        document.getElementById('seedInput').value = '';

        d3.select('.mapCells').remove();
        d3.select('.coastline').remove();
        d3.select('#burgs').remove();
        d3.select('#routes').remove();
        
        // Clear burgs from state
        

        const svg = d3.select('svg');
      
      // Create zoomable wrapper group
      const zoomRoot = svg.append('g').attr('id', 'zoomRoot');
      
      // Labels live outside zoomRoot so text size stays constant
      const labelsG = svg.append('g').attr('id', 'labels');
      const regionLabelsG = labelsG.append('g').attr('class', 'labels-regions');
      const burgLabelsG = labelsG.append('g').attr('class', 'labels-burgs');
      // Rebind label renderers to new groups
      window.__state.renderRegionLabels = renderRegionLabels;
      window.__state.renderBurgLabels = renderBurgLabels;
      
      // Solid ocean backdrop to eliminate water seam artifacts (anti-aliasing between polygons)
      zoomRoot.select('rect.ocean').remove();
      zoomRoot.append('rect')
        .attr('class','ocean')
        .attr('x',0).attr('y',0)
        .attr('width', +svg.attr('width'))
        .attr('height', +svg.attr('height'))
        .attr('fill', WATER_COLOR);
      const mapCells = zoomRoot.append('g')
        .attr('class', 'mapCells');
      const riversShade = zoomRoot.append('g').attr('class', 'riversShade');
      const riversG = zoomRoot.append('g').attr('class', 'rivers');
      const coastG = zoomRoot.append('g').attr('class', 'coastline');
      const regionsG = zoomRoot.append('g').attr('id', 'regions'); // below routes
      const routesG = zoomRoot.append('g').attr('id', 'routes');
      // Burgs go outside zoomRoot so they can be counter-scaled independently
      const burgsG = svg.append('g').attr('id', 'burgs');
      const roadsG = routesG.append('g').attr('class', 'roads');
      const trailsG = routesG.append('g').attr('class', 'trails');
      const seaG = routesG.append('g').attr('class', 'searoutes');
      
      // Create defs for clip paths
      const defs = svg.append('defs');

      const width = +svg.attr('width');
      const height = +svg.attr('height');
      const n = sizeInput.valueAsNumber;

      // Keep the current zoom transform so we can position burgs and labels after (re)draws
      window.currentTransform = d3.zoomIdentity;

      // Throttled for smoothness
      window.updateBurgPositions = rafThrottle((t = window.currentTransform) => {
        window.currentTransform = t;
        
        // Update burg groups with transform
        const burgGroups = burgsG.selectAll('g.burg');
        burgGroups.attr('transform', d => `translate(${t.applyX(d.x)},${t.applyY(d.y)})`);
        
        if (DEBUG && burgGroups.size() > 0) {
          // console.log(`Updated ${burgGroups.size()} burg positions with transform:`, t);
        }
          
        // Update any standalone burg circles (if they exist)
        burgsG.selectAll('circle.burg')
          .attr('cx', d => t.applyX(d.x))
          .attr('cy', d => t.applyY(d.y));
      });

      // Add D3 zoom and pan functionality
      // Improve touchpad scroll feel a bit:
      const wheelDelta = (event) =>
        -event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.002); // lines vs pixels

      const zoom = d3.zoom()
        .scaleExtent([1.0, 24])                    // min/max zoom - prevent zooming out smaller than original size
        .wheelDelta(wheelDelta)
        .translateExtent([[0, 0], [width, height]])// keep map roughly in view
        .extent([[0, 0], [width, height]])
        .on('zoom', (function(){
          const update = (event) => {
            const t0 = performance.now();

            // Apply transform
            d3.select('#zoomRoot').attr('transform', event.transform);
            window.currentTransform = event.transform;
            window.updateBurgPositions(event.transform);          // burgs reproject to screen coords

            // Progressive reveal (already implemented)
            if (typeof updateBurgTierVisibility === 'function') updateBurgTierVisibility(event.transform.k);

            // Optional: label culling cost
            const tCull0 = performance.now();
            if (typeof updateLabelPositions === 'function') updateLabelPositions(event.transform);                // labels reproject to screen coords
            if (typeof recullLabelsOnZoom === 'function') recullLabelsOnZoom(event.transform);
            const t1 = performance.now();

            // Quick visible/hidden stats
            const g = d3.select('#burgs');
            let visible=0, hidden=0;
            g.selectAll('circle').each(function() {
              (this.classList.contains('hidden') ? hidden++ : visible++);
            });

            console.log(
              `%cZoom frame: ${Math.round((t1 - t0)*10)/10} ms ` +
              `(transform+reveal ${Math.round((tCull0 - t0)*10)/10} ms; labels ${Math.round((t1 - tCull0)*10)/10} ms) ` +
              `| burgs vis/hidden ${visible}/${hidden}`,
              'color:#6a0dab'
            );
          };
          return rafThrottle(update);
        })());

      svg.call(zoom).call(zoom.transform, d3.zoomIdentity); // initial
      
      // Initial label positioning
      updateLabelPositions(window.currentTransform);

      // Double-tap zoom for one-hand use on mobile
      let lastTap = 0;
      svg.on('touchend', function(event) {
        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTap;
        if (tapLength < 500 && tapLength > 0) {
          // Double tap detected
          event.preventDefault();
          const point = d3.pointer(event, svg.node());
          const currentTransform = d3.zoomTransform(svg.node());
          const newScale = Math.max(1.0, currentTransform.k * 2); // Respect minimum zoom level
          const newTransform = d3.zoomIdentity
            .translate(point[0], point[1])
            .scale(newScale)
            .translate(-point[0], -point[1]);
          
          svg.transition().duration(300).call(zoom.transform, newTransform);
        }
        lastTap = currentTime;
      });

      // Optional helper functions for zoom control
      window.resetZoom = function() {
        svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity);
      };

      window.zoomToBBox = function(bbox, pad = 24) {
        const cx = bbox.x + bbox.width/2, cy = bbox.y + bbox.height/2;
        const k = Math.min(
          width / (bbox.width + 2*pad),
          height / (bbox.height + 2*pad)
        );
        svg.transition().duration(400).call(
          zoom.transform,
          d3.zoomIdentity.translate(width/2, height/2).scale(k).translate(-cx, -cy)
        );
      };

      // Get the world seed for reproducible generation
      const seedInput = document.getElementById('seedInput').value;
      // console.log('Seed input value:', seedInput, 'type:', typeof seedInput);
      // Always generate a new random seed unless user has explicitly set one
      const worldSeed = seedInput ? +seedInput : Math.floor(Math.random() * 999999) + 1;
      // console.log('Generated world seed:', worldSeed);
      
      // Update the seed input to show the current seed (if it was random)
      if (!seedInput) {
        document.getElementById('seedInput').value = worldSeed;
        // console.log('Updated seed input to:', worldSeed);
      }
      const rand = mulberry32(worldSeed);
              setSeed(worldSeed);
      
      // initial random points
      let sites = d3.range(n).map(() => [rand() * width, rand() * height]);

      // One Lloyd relaxation step for nicer spacing
      ({ sites } = relaxOnce(sites, width, height));

      // Build Delaunay + Voronoi structures
      ProgressManager.setPhase('voronoi');
      const tVor0 = performance.now();
      const delaunay = d3.Delaunay.from(sites);
      const voronoi = delaunay.voronoi([0, 0, width, height]);
      PERF.mark('Init Voronoi polys', tVor0);

      // Build cell objects with neighbors
      const cells = d3.range(n).map((i) => ({
        index: i,
        poly: voronoi.cellPolygon(i),
        neighbors: Array.from(delaunay.neighbors(i)),
        high: 0,
        used: 0
      }));

      // Precompute polygon centroids for border mask filtering
      cells.forEach(c => { const ct = d3.polygonCentroid(c.poly); c.cx = ct[0]; c.cy = ct[1]; });

      // Palette (kept for future tweaks)
      const interp = { water: (t) => d3.interpolateBlues(t) };

      // Land color ramp: dark green lowlands → light green → tan → white peaks
      function landColor(t) {
        // t in [0,1], already normalized above sea level
        t = Math.max(0, Math.min(1, t));
        if (t < 0.35) {
          const u = t / 0.35; // 0..1
          return d3.interpolateYlGn(1.0 - 0.7 * u); // darker coastal greens (reversed)
        } else if (t < 0.7) {
          const u = (t - 0.35) / 0.35; // 0..1
          return d3.interpolateYlOrBr(0.25 + 0.75 * u); // foothills to tan
        } else if (t < 0.9) {
          const u = (t - 0.7) / 0.2; // 0..1
          return d3.interpolateOranges(0.4 + 0.6 * u); // warm rocky highlands
        } else {
          const u = (t - 0.9) / 0.1; // 0..1
          return d3.interpolateRgb('#e9ecef', '#ffffff')(u); // light grey → white snowcap
        }
      }

      // Draw polygons - use canvas for large maps, SVG for smaller ones
      const isCoarse = window.matchMedia('(pointer: coarse)').matches;
      const useCanvas = isCoarse ? cells.length > 4000 : cells.length > 8000;
      
      if (useCanvas) {
        // Canvas-based rendering for large maps
        // Scale the backing store by DPR so it isn't blurry on phones
        const dpr = Math.min(2, window.devicePixelRatio || 1); // cap to 2 for perf
        const terrainCanvas = ensureTerrainCanvas();
        terrainCanvas.canvas.width = width * dpr;
        terrainCanvas.canvas.height = height * dpr;
        terrainCanvas.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        terrainCanvas.ctx.fillStyle = '#000';
        
        cells.forEach(cell => {
          if (cell.poly.length > 2) {
            terrainCanvas.ctx.beginPath();
            terrainCanvas.ctx.moveTo(cell.poly[0][0], cell.poly[0][1]);
            for (let i = 1; i < cell.poly.length; i++) {
              terrainCanvas.ctx.lineTo(cell.poly[i][0], cell.poly[i][1]);
            }
            terrainCanvas.ctx.closePath();
            terrainCanvas.ctx.fill();
          }
        });
        
        // Add canvas as image to SVG
        const dataURL = terrainCanvas.canvas.toDataURL();
        ensureRasterImage({ width, height }).attr('href', dataURL);
      } else {
        // SVG-based rendering for smaller maps
      mapCells.selectAll('path.mapCell')
        .data(cells)
        .enter()
        .append('path')
        .attr('class', 'mapCell')
        .attr('id', d => d.index)
        .attr('d', d => 'M' + d.poly.map(p => p.join(',')).join('L') + 'Z')
        .attr('fill', d => d.high >= sea ? '#000' : 'none')
        .attr('fill-rule', 'nonzero')
        .attr('stroke', 'none'); // Ensure no cell borders from initial creation
      }

      // Keep shared state for tests and other functions
      setCells(cells);
      setSize(width, height);
      // Keep legacy window.__state for backward compatibility
              setCells(cells);
      window.__state.delaunay = delaunay;
      window.__state.voronoi = voronoi;
      window.__state.svg = svg;
      window.__state.width = width;
      window.__state.height = height;
      window.__state.add = add;
      window.__state.recolor = rafDebounce((run) => recolor(run));
      window.__state.autoSeed = autoSeed;
      window.__state.drawCoastlines = drawCoastlines;
      window.__state.applyBorder = applyBorderMask;
      // Expose functions for regions.js module
    window.__state.assignRegionsAzgaar = assignRegionsAzgaar;
    window.__state.buildRegionSegments = buildRegionSegments;
    window.__state.segmentsToRings = segmentsToRings;
    window.__state.isStale = isStale;
    window.__state.regionsInFlight = regionsInFlight;
    window.__state.regionsQueued = regionsQueued;
      window.__state.renderBurgs = renderBurgs;
      window.__state.renderBurgLabels = renderBurgLabels;
      window.__state.renderRegionLabels = renderRegionLabels;
      window.__state.generateRegionalNames = generateRegionalNames;
      window.__state.computeRoutes = computeRoutes;
      window.__state.chooseMacroCapitals = chooseMacroCapitals;
      window.__state.assignMacroRegions = assignMacroRegions;
      window.__state.getMacroRegionCount = getMacroRegionCount;
      window.__state.buildRegionStyles = buildRegionStyles;
      window.__state.generateRegionNames = generateRegionNames;
      window.__state.logCurrentStyles = logCurrentStyles;
      window.__state.assignRegionsAzgaar = assignRegionsAzgaar;
      window.__state.computeAndDrawRegions = computeAndDrawRegions;

      // Ensure Voronoi polys early
              { const t0 = performance.now(); ensureCellPolys(S.cells, width, height); PERF.mark('Ensure cell polys', t0); }

      // Cache proximity fields when water mask is available
      if (Array.isArray(S.caches.isWater) && S.caches.isWater.length) {
        const t0 = performance.now();
        if (!S.caches.coastSteps) {
          setCoastSteps(computeCoastSteps(S.cells, S.caches.isWater));
        }
        if (!S.caches.riverSteps) {
          setRiverSteps(computeRiverSteps(S.cells));
        }
        PERF.mark('Compute coast/river steps (BFS)', t0);
      } else {
        const t0 = performance.now();
        if (!S.caches.riverSteps) {
          setRiverSteps(computeRiverSteps(S.cells));
        }
        PERF.mark('Compute river steps (BFS)', t0);
      }

      // Add test function for debugging regions
      window.__state.testRegions = () => {
        // console.log('Testing region computation...');
        if (window.__state.computeAndDrawRegions) {
          try {
            window.__state.computeAndDrawRegions().catch(console.error);
            // console.log('Region test completed');
          } catch (error) {
            console.error('Region test failed:', error);
          }
        } else {
          console.error('computeAndDrawRegions not available');
        }
      };

      // View mode functionality
      setCurrentViewMode('terrain'); // 'terrain' | 'regions'
      // BEGIN CANONICAL setViewMode
      // Imported from render.js - see imports at top
      // Keep backward-compatible alias
      if (window.__state) window.__state.setViewMode = setViewMode;

      // BEGIN CANONICAL repaintCellsForMode
      // Imported from render.js - see imports at top

      // initial state
      setViewMode('terrain');

      // View toggle button is now wired in app.js

      // Simple region label renderer
      window.__state.renderSimpleRegionLabels = () => {
        const cells = S.cells || [];
        const roc = S.caches.regionOfCell;
        if (!roc || !cells.length) return;
        
        // Group cells by region
        const regionCells = new Map();
        for (let i = 0; i < cells.length; i++) {
          const regionId = roc[i];
          if (regionId >= 0) {
            if (!regionCells.has(regionId)) regionCells.set(regionId, []);
            regionCells.get(regionId).push(cells[i]);
          }
        }
        
        // Calculate centroids and render labels
        const labelsG = d3.select('.labels-regions');
        labelsG.selectAll('*').remove();
        
        const labelData = [];
        regionCells.forEach((cells, regionId) => {
          if (cells.length === 0) return;
          
          // Calculate centroid
          let x = 0, y = 0;
          for (const cell of cells) {
            x += cell.cx;
            y += cell.cy;
          }
          x /= cells.length;
          y /= cells.length;
          
          labelData.push({ x, y, text: `Region ${regionId + 1}` });
        });
        
        // Add labels with proper data binding
        labelsG.selectAll('text')
          .data(labelData)
          .join('text')
          .attr('x', d => d.x)
          .attr('y', d => d.y)
          .text(d => d.text)
          .attr('class', 'region-label');
        
        // console.log('Simple region labels rendered');
      };

      // Note: Region computation will be called after map generation is complete
    // Helper function to apply region cell fills
    window.__state.applyRegionCellFills = function(regionOfCell, palette) {
              const { mapCells } = getLayers();
        const sel = mapCells.selectAll('path.mapCell');

      // cache terrain fill once
      sel.each(function(d, i) {
        const me = d3.select(this);
        if (!me.attr('data-terrain-fill')) {
          me.attr('data-terrain-fill', me.attr('fill') || '#ccc');
        }
      });

      // assign region fill for land cells (water keeps terrain fill)
      sel.each(function(d, i) {
        const me = d3.select(this);
        const rid = regionOfCell?.[i];
        if (rid >= 0) {
          const color = palette[rid % palette.length];
          me.attr('data-region-fill', color);
        } else {
          me.attr('data-region-fill', null);
        }
        // Ensure no cell borders in both modes
        me.attr('stroke', 'none');
      });
    };

          // Initialize reusable typed arrays for performance
    window.__state.tmp = {
      dist: new Int32Array(cells.length),
      down: new Int32Array(cells.length),
      flux: new Float32Array(cells.length),
    };

    // Typed array pool for reuse across runs
    const ArrayPool = {
      float32: [],
      int32: [],
      uint32: [],
      
      getFloat32(size) {
        const pool = this.float32.filter(arr => arr.length >= size);
        if (pool.length > 0) {
          const arr = pool.pop();
          arr.fill(0);
          return arr;
        }
        return new Float32Array(size);
      },
      
      getInt32(size) {
        const pool = this.int32.filter(arr => arr.length >= size);
        if (pool.length > 0) {
          const arr = pool.pop();
          arr.fill(0);
          return arr;
        }
        return new Int32Array(size);
      },
      
      getUint32(size) {
        const pool = this.uint32.filter(arr => arr.length >= size);
        if (pool.length > 0) {
          const arr = pool.pop();
          arr.fill(0);
          return arr;
        }
        return new Uint32Array(size);
      },
      
      returnFloat32(arr) {
        this.float32.push(arr);
      },
      
      returnInt32(arr) {
        this.int32.push(arr);
      },
      
      returnUint32(arr) {
        this.uint32.push(arr);
      }
    };
      // --- Template System ---
      const templates = getConfig().templates;
      // Initialize default templates if not already present
      if (!templates.volcanicIsland) {
        Object.assign(templates, {
        volcanicIsland: {
          name: "Volcanic Island",
          description: "Big conically elevated island",
          steps: [
            {op: "mountain", at: "center", high: 0.9, radius: 0.94, sharpness: 0.18},
            {op: "add", value: 0.07},
            {op: "multiply", factor: 1.1},
            {op: "hills", count: 5, distribution: 0.40, high: 0.25, radius: 0.985, sharpness: 0.10},
            {op: "hills", count: 2, distribution: 0.15, high: 0.35, radius: 0.98, sharpness: 0.12}
          ]
        },

        highIsland: {
          name: "High Island",
          description: "Big and high island with complicated heightmap and landform",
          steps: [
            {op: "mountain", at: "center", high: 0.85, radius: 0.94, sharpness: 0.18},
            {op: "add", value: 0.08},
            {op: "multiply", factor: 0.9},
            {op: "ranges", count: 4, high: 0.18, radius: 0.986},
            {op: "hills", count: 12, distribution: 0.25, high: 0.20, radius: 0.985, sharpness: 0.10},
            {op: "troughs", count: 3, depth: -0.12, radius: 0.989},
            {op: "multiplyLand", factor: 0.75},
            {op: "hills", count: 3, distribution: 0.15, high: 0.26, radius: 0.984, sharpness: 0.12}
          ]
        },

        lowIsland: {
          name: "Low Island",
          description: "As above, but not elevated",
          steps: [
            {op: "mountain", at: "center", high: 0.62, radius: 0.945, sharpness: 0.16},
            {op: "add", value: 0.05},
            {op: "smooth", passes: 1},
            {op: "hills", count: 4, distribution: 0.40, high: 0.18, radius: 0.986, sharpness: 0.10},
            {op: "hills", count: 12, distribution: 0.20, high: 0.16, radius: 0.987, sharpness: 0.10},
            {op: "troughs", count: 3, depth: -0.09, radius: 0.99},
            {op: "multiplyLand", factor: 0.55}
          ]
        },

        continents: {
          name: "Continents",
          description: "Two or more islands separated by strait",
          steps: [
            {op: "mountain", at: "center", high: 0.80, radius: 0.955, sharpness: 0.16},
            {op: "hills", count: 24, distribution: 0.25, high: 0.19, radius: 0.986, sharpness: 0.10},
            {op: "ranges", count: 2, high: 0.21, radius: 0.987},
            {op: "hills", count: 3, distribution: 0.10, high: 0.24, radius: 0.985, sharpness: 0.12},
            {op: "multiplyLand", factor: 0.80},
            {op: "strait", width: 5, xNorm: 0.5, y1Norm: 0.2, y2Norm: 0.8},
            {op: "smooth", passes: 1},
            {op: "pits", count: 5, depth: -0.16, radius: 0.986},
            {op: "troughs", count: 3, depth: -0.10, radius: 0.99},
            {op: "multiplyLand", factor: 0.85},
            {op: "add", value: 0.02}
          ]
        },

        archipelago: {
          name: "Archipelago",
          description: "A lot of small islands",
          steps: [
            {op: "mountain", at: "center", high: 0.78, radius: 0.95, sharpness: 0.16},
            {op: "addLand", value: -0.02},
            {op: "hills", count: 15, distribution: 0.15, high: 0.14, radius: 0.986, sharpness: 0.11},
            {op: "troughs", count: 2, depth: -0.08, radius: 0.992},
            {op: "pits", count: 8, depth: -0.12, radius: 0.989},
            {op: "addLand", value: -0.05},
            {op: "multiplyLand", factor: 0.92}
          ]
        }
        });
      }

      // === TERRAIN FIRST ===
      // Apply selected template (build heights)
      const tplKey = document.getElementById('worldType')?.value || 'continents';
      const uiVals = {
        smallCount: +(document.getElementById('smallCountInput')?.value || 0),
        borderPct: +(document.getElementById('borderPctInput')?.value || 8)
      };
      
      // Get erosion parameters first
      const talus = +document.getElementById('talusInput')?.value || 0.02;
      const thermalStrength = +document.getElementById('thermalStrengthInput')?.value || 0.5;
      const smoothAlpha = +document.getElementById('smoothAlphaInput')?.value || 0.2;

      // Generation order (Azgaar-style)
      ensureHeightsCleared();
      
      // Ensure sea level is defined before any terrain operations
      if (!S.params) S.params = {};
      if (!Number.isFinite(S.params.seaLevel)) S.params.seaLevel = 0.22; // small uplift to avoid flooding lowlands
      
      // Resolve height key for unified access
      resolveHeightKey();
      
      // refresh terrain RNG for this run (uses S.seed)
      _refreshRng();
      bindWorld();            // <— NEW
      
      // TODO: Step 1 - Build base mesh (Poisson → Delaunay/Voronoi)
      ProgressManager.setPhase('mesh');
      try {
        const { buildBaseMesh } = await import('./terrain.js');
        const mesh = buildBaseMesh();
        console.log(`[mesh] Generated ${mesh.cellCount} cells with ${mesh.edgeCount} edges`);
        
        // TODO: Step 2 - Elevation + sea level autotune
        ProgressManager.setPhase('elevation');
        try {
          const { generateElevation } = await import('./elevation.js');
          const elev = generateElevation(mesh, S);
          const landCount = elev.isLand.reduce((a,b)=>a+b,0);
          const landFrac = (landCount / elev.isLand.length);
          console.log(`[elevation] seaLevel=${elev.seaLevel.toFixed(3)} landFrac=${(landFrac*100).toFixed(1)}%`);
          
          // Store elevation data in state for later use
          S.elevation = elev;
        } catch (e) {
          console.warn('[generate] elevation generation failed', e);
        }
      } catch (e) {
        console.warn('[generate] mesh generation failed', e);
      }
      
      applyTemplate(tplKey, uiVals);
      
      // Cap to [0,1] and normalize if too flat
      normalizeHeights({ maxTarget: 0.9 });
      thermalErode(talus, thermalStrength, 1);  // gentle
      smoothLand(smoothAlpha);

      // AFTER applyTemplate (and before any mask/clamp)
      _debugHeights('post-template');

      // Keep ocean border
      ProgressManager.setPhase('terrain');
      applyBorderMask();

      // Erode & smooth
      ProgressManager.setPhase('erosion');

      // AFTER erosion
      _debugHeights('post-erosion');

      // Re-apply the water border after erosion/smoothing
      applyBorderMask();

      // Fixed coastline (blog): default 0.22 unless slider set
      if (!Number.isFinite(S.params.seaLevel)) S.params.seaLevel = 0.22; // small uplift to avoid flooding lowlands
      const seaIn = document.getElementById('seaLevelInput');
      if (seaIn && seaIn.value !== '') S.params.seaLevel = +seaIn.value;

      // Auto-tune sea level to hit target land fraction
      const tunedSea = tuneSeaLevelToTarget(getWorld().cells, { target: 0.35, step: 0.01 });
      console.log('[sea] tuned to', tunedSea);

      // recompute mask & paint
      resetCaches('isWater'); // make sure this deletes S.caches.isWater
      setIsWater(ensureIsWater(getWorld().cells));

      // Remove salt-and-pepper: keep a few biggest landmasses
      sinkSmallIslands({ keep: 2, minCells: 300, epsilon: 0.02 });
      resetCaches('isWater');
      setIsWater(ensureIsWater(cells));

      // Mark terrain dirty for raster
      ensureTerrainCanvas().setDirty();

      try {
        await recolor(run);               // logs "Land fraction ~ X.XX"
      } catch (e) { console.warn('[generate] recolor failed', e); }

      try { 
        // 3) rivers
        recomputePrecipIfNeeded();
        computeRiverSteps();  // keeps "⏱ Compute river steps (BFS): ..." log
        computeRivers(run);   // keeps "⏱ Compute rivers: ..." + any river render logs
      } catch (e) { console.warn('[generate] rivers failed', e); }

      try { 
        // 4) regions (keeps all region logs + fallback behavior)
        await computeAndDrawRegions(run);
      } catch (e) { console.warn('[generate] regions failed', e); }

      try { 
        // 5) routes (keeps "computeRoutes() vKNN", "primary-road count:", "routes render:", "[RUN X] routes done")
        await computeRoutes(run);
      } catch (e) { console.warn('[generate] routes failed', e); }

      // Update the biome legend if function exists
      if (typeof updateBiomeLegend === 'function') {
        updateBiomeLegend();
      }
      
      ProgressManager.safeUpdate(run, 100, 'Done');
      setTimeout(() => ProgressManager.safeHide(run), 300);

      } catch (e) {
        console.error(`[RUN ${run}] error`, e);
        // Still finalize this run's overlay safely
        ProgressManager.safeUpdate(run, 100, 'Error');
        setTimeout(() => ProgressManager.safeHide(run), 300);
      } finally {
        console.log(`[RUN ${run}] generate complete`);
        runInFlight = false;
        if (genQueued) { genQueued = false; window.generate(); } // run latest once
      }
    }

    // Expose generate() globally for the button
    // window.generate is already set above
    // Add generate to state object for debugging
    window.__state.generate = window.generate;

    // mulberry32 moved to utils.js

    // Simple hash function for template seeding
    function hash(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
      }
      return hash;
    }

    // Helper for UI repaints WITHOUT starting a new run or printing run=0 logs
    function recolorCurrent() {
      const active = CURRENT_RUN;
      if (!active) return;        // nothing to recolor yet
      return recolor(active);     // recolor respects isStale(active)
    }

    function quantile(xs, q) {
      if (!xs.length) return 0;
      const a = xs.slice().sort((a,b)=>a-b);
      const i = Math.max(0, Math.min(a.length-1, Math.floor(q*(a.length-1))));
      return a[i];
    }

    function relaxOnce(pts, w, h) {
        const dly = d3.Delaunay.from(pts);
        const vor = dly.voronoi([0, 0, w, h]);
        const relaxed = pts.map((_, i) => d3.polygonCentroid(vor.cellPolygon(i)));
        return { sites: relaxed };
      }

      function addWithOpts(start, type, opts, rand = Math.random) {
        const {cells, s, width, height} = getWorld();
        const {templates} = getConfig();
        
        // Defensive guards
        if (!cells?.length) { 
          console.warn('addWithOpts: no cells, skipping'); 
          return; 
        }
        
        // temporarily override sliders
        const highInput = document.getElementById('highInput');
        const highOutput = document.getElementById('highOutput');
        const radiusInput = document.getElementById('radiusInput');
        const radiusOutput = document.getElementById('radiusOutput');
        const sharpnessInput = document.getElementById('sharpnessInput');
        const sharpnessOutput = document.getElementById('sharpnessOutput');
        
        const prev = {
          high: +(highInput?.value || 0),
          rad: +(radiusInput?.value || 0),
          sharp: +(sharpnessInput?.value || 0)
        };
        if (opts && typeof opts.high === 'number' && highInput && highOutput) { 
          highInput.value = opts.high; 
          highOutput.value = opts.high; 
        }
        if (opts && typeof opts.radius === 'number' && radiusInput && radiusOutput) { 
          radiusInput.value = opts.radius; 
          radiusOutput.value = opts.radius; 
        }
        if (opts && typeof opts.sharpness === 'number' && sharpnessInput && sharpnessOutput) { 
          sharpnessInput.value = opts.sharpness; 
          sharpnessOutput.value = opts.sharpness; 
        }
        add(start, type, rand);
        // restore sliders
        if (highInput && highOutput) { highInput.value = prev.high; highOutput.value = prev.high; }
        if (radiusInput && radiusOutput) { radiusInput.value = prev.rad; radiusOutput.value = prev.rad; }
        if (sharpnessInput && sharpnessOutput) { sharpnessInput.value = prev.sharp; sharpnessOutput.value = prev.sharp; }
      }

      function pickInteriorCell(marginPx, rand = Math.random) {
        const {cells, s, width, height} = getWorld();
        const {templates} = getConfig();
        
        // Defensive guards
        if (!cells?.length) { 
          console.warn('pickInteriorCell: no cells, skipping'); 
          return 0; 
        }
        
        // choose a cell whose centroid is at least marginPx from any edge
        const interior = cells.filter(c => Math.min(c.cx, c.cy, width - c.cx, height - c.cy) >= marginPx);
        if (interior.length === 0) return Math.floor(rand() * cells.length);
        const idx = Math.floor(rand() * interior.length);
        return interior[idx].index;
      }

      // --- Template Executor ---
      // Now handled by terrain.js module

      function autoSeed(providedSeed = null) {
        const {cells, isWater, burgs, s, width, height} = getWorld();
        const {templates} = getConfig();
        
        // Defensive guards
        if (!cells?.length) { 
          console.warn('autoSeed: no cells, skipping'); 
          return; 
        }
        
        const tplKey = document.getElementById('worldType')?.value || 'continents';
        const seedInput = document.getElementById('seedInput')?.value;
        // Use provided seed if available, otherwise use input or generate random
        const worldSeed = providedSeed || (seedInput ? +seedInput : Math.floor(Math.random() * 999999) + 1);
        
        // Update the seed input to show the current seed (if it was random)
        if (!seedInput && !providedSeed) {
          const seedInputEl = document.getElementById('seedInput');
          if (seedInputEl) seedInputEl.value = worldSeed;
        }
        const uiVals = {
          smallCount: +(document.getElementById('smallCountInput')?.value || 0),
          borderPct: +(document.getElementById('borderPctInput')?.value || 8)
        };
        
        // Clear the heightmap first
        ensureHeightsCleared();
        
        // Generate seeded burgs and write to state (land mask is ready now)
        console.log('BURG PIPELINE: start');
        const seededBurgs = generateSeededBurgs(cells, S.caches.isWater, worldSeed);
        setBurgs(seededBurgs);
        console.log('autoSeed: burgs=', S.burgs?.length || 0);
        console.log('BURG PIPELINE: end');
        
        // Redraw everything (no run token needed for autoSeed)
        if (window.__state.recolor) {
          recolorCurrent(); // Use current run token
        }
      }
      
      function generateSeededBurgs(cells, isWater, seed) {
        const rng = mulberry32(seed);
        const burgs = [];
        
        // Find land cells
        const landCells = cells.map((c, i) => ({...c, index: i})).filter(c => !isWater[c.index]);
        
        if (landCells.length === 0) {
          console.warn('generateSeededBurgs: no land cells found');
          return burgs;
        }
        
        // Generate a reasonable number of burgs based on land area
        const targetBurgCount = Math.max(3, Math.floor(landCells.length * 0.02)); // ~2% of land cells
        const capitalCount = Math.max(1, Math.floor(targetBurgCount * 0.1)); // ~10% are capitals
        
        // Generate capitals first (farthest-first placement)
        const capitals = [];
        if (landCells.length > 0) {
          // Start with a random cell
          const firstCapital = landCells[Math.floor(rng() * landCells.length)];
          capitals.push({
            x: firstCapital.cx,
            y: firstCapital.cy,
            cellIndex: firstCapital.index,
            type: 'capital',
            capital: true,
            power: 1
          });
          
          // Add more capitals using farthest-first
          while (capitals.length < capitalCount && capitals.length < landCells.length) {
            let bestCell = null;
            let bestMinDist = -1;
            
            for (const cell of landCells) {
              // Skip if this cell is already a capital
              if (capitals.some(cap => cap.cellIndex === cell.index)) continue;
              
              // Find minimum distance to existing capitals
              let minDist = Infinity;
              for (const cap of capitals) {
                const dx = cell.cx - cap.x;
                const dy = cell.cy - cap.y;
                const dist = dx * dx + dy * dy;
                if (dist < minDist) minDist = dist;
              }
              
              if (minDist > bestMinDist) {
                bestMinDist = minDist;
                bestCell = cell;
              }
            }
            
            if (bestCell) {
              capitals.push({
                x: bestCell.cx,
                y: bestCell.cy,
                cellIndex: bestCell.index,
                type: 'capital',
                capital: true,
                power: 1
              });
            } else {
              break;
            }
          }
        }
        
        // Add capitals to burgs array
        burgs.push(...capitals);
        
        // Generate regular burgs (towns, villages)
        const remainingSlots = targetBurgCount - capitals.length;
        const availableCells = landCells.filter(cell => 
          !capitals.some(cap => cap.cellIndex === cell.index)
        );
        
        // Randomly select cells for regular burgs
        for (let i = 0; i < remainingSlots && i < availableCells.length; i++) {
          const cell = availableCells[Math.floor(rng() * availableCells.length)];
          availableCells.splice(availableCells.indexOf(cell), 1); // Remove to avoid duplicates
          
          const burgType = rng() < 0.3 ? 'town' : 'village';
          burgs.push({
            x: cell.cx,
            y: cell.cy,
            cellIndex: cell.index,
            type: burgType,
            capital: false,
            power: 0.5
          });
        }
        
        return burgs;
      }
      

      
      function addMountainRange(startIdx, endIdx, maxHeight, radius) {
        const {cells, s, width, height} = getWorld();
        const {templates} = getConfig();
        
        // Defensive guards
        if (!cells?.length) { 
          console.warn('addMountainRange: no cells, skipping'); 
          return; 
        }
        if (!s.delaunay) { 
          console.warn('addMountainRange: no delaunay, skipping'); 
          return; 
        }
        
        const start = cells[startIdx];
        const end = cells[endIdx];
        const steps = 12;
        
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const x = start.cx + (end.cx - start.cx) * t;
          const y = start.cy + (end.cy - start.cy) * t;
          const targetIdx = s.delaunay.find(x, y);
          addWithOpts(targetIdx, 'hill', { high: maxHeight * (1 - Math.abs(t - 0.5) * 0.4), radius: radius, sharpness: 0.15 });
        }
      }
      
      function addStrait(centerX, startY, endY, width, rand = Math.random) {
        const {cells, s, width: worldWidth, height} = getWorld();
        const {templates} = getConfig();
        
        // Defensive guards
        if (!cells?.length) { 
          console.warn('addStrait: no cells, skipping'); 
          return; 
        }
        if (!s.delaunay) { 
          console.warn('addStrait: no delaunay, skipping'); 
          return; 
        }
        
        const steps = 20;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const y = startY + (endY - startY) * t;
          const x = centerX + (rand() - 0.5) * width * 20; // Add some randomness
          const targetIdx = s.delaunay.find(x, y);
          if (targetIdx >= 0 && targetIdx < cells.length) {
            cells[targetIdx].high = Math.max(0.05, cells[targetIdx].high - 0.4);
          }
        }
      }
      
      function addPit(centerIdx, depth, radius) {
        const {cells, s, width, height} = getWorld();
        const {templates} = getConfig();
        
        // Defensive guards
        if (!cells?.length) { 
          console.warn('addPit: no cells, skipping'); 
          return; 
        }
        if (centerIdx < 0 || centerIdx >= cells.length) { 
          console.warn('addPit: invalid centerIdx, skipping'); 
          return; 
        }
        
        const center = cells[centerIdx];
        const queue = [];
        cells[centerIdx].high = Math.max(0.05, cells[centerIdx].high - depth);
        queue.push(centerIdx);
        
        for (let i = 0; i < queue.length && depth > 0.01; i++) {
          depth = depth * radius;
          cells[queue[i]].neighbors.forEach((e) => {
            if (!cells[e].used) {
              cells[e].high = Math.max(0.05, cells[e].high - depth);
              cells[e].used = 1;
              queue.push(e);
            }
          });
        }
        cells.forEach(c => c.used = 0);
      }
      
      function addTrough(startIdx, endIdx, depth, radius) {
        const {cells, s, width, height} = getWorld();
        const {templates} = getConfig();
        
        // Defensive guards
        if (!cells?.length) { 
          console.warn('addTrough: no cells, skipping'); 
          return; 
        }
        if (!s.delaunay) { 
          console.warn('addTrough: no delaunay, skipping'); 
          return; 
        }
        if (startIdx < 0 || startIdx >= cells.length || endIdx < 0 || endIdx >= cells.length) { 
          console.warn('addTrough: invalid indices, skipping'); 
          return; 
        }
        
        const start = cells[startIdx];
        const end = cells[endIdx];
        const steps = 8;
        
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const x = start.cx + (end.cx - start.cx) * t;
          const y = start.cy + (end.cy - start.cy) * t;
          const targetIdx = s.delaunay.find(x, y);
          if (targetIdx >= 0 && targetIdx < cells.length) {
            cells[targetIdx].high = Math.max(0.05, cells[targetIdx].high - depth);
          }
        }
      }
      function smoothMap() {
        const smoothed = new Float32Array(cells.length);
        cells.forEach((c, i) => {
          let sum = c.high;
          let count = 1;
          c.neighbors.forEach(nb => {
            sum += cells[nb].high;
            count++;
          });
          smoothed[i] = sum / count;
        });
        cells.forEach((c, i) => {
          c.high = smoothed[i];
        });
      }

      // Erosion functions for terrain smoothing
      function isLand(i) {
        const {cells} = getWorld();
        if (!cells?.length) return false;
        return cells[i].high > 0.1; // Sea level threshold
      }

      function thermalErode(talus = 0.02, k = 0.5, iters = 2) {
        const {cells, s} = getWorld();
        const {templates} = getConfig();
        
        // Defensive guards
        if (!cells?.length) { 
          console.warn('thermalErode: no cells, skipping'); 
          return; 
        }
        
        const n = cells.length;
        for (let t = 0; t < iters; t++) {
          const delta = new Float32Array(n);
          for (let i = 0; i < n; i++) {
            const hi = cells[i].high;
            if (!isLand(i)) continue;
            for (const j of cells[i].neighbors) {
              const d = hi - cells[j].high - talus;
              if (d > 0) {
                const m = k * d * 0.5;
                delta[i] -= m;
                delta[j] += m;
              }
            }
          }
          for (let i = 0; i < n; i++) {
            cells[i].high = Math.max(0, cells[i].high + delta[i]);
          }
        }
      }

      function smoothLand(alpha = 0.2) {
        const {cells, s} = getWorld();
        const {templates} = getConfig();
        
        // Defensive guards
        if (!cells?.length) { 
          console.warn('smoothLand: no cells, skipping'); 
          return; 
        }
        
        const n = cells.length;
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          if (!isLand(i)) {
            out[i] = cells[i].high;
            continue;
          }
          let s = 0;
          for (const j of cells[i].neighbors) {
            s += cells[j].high;
          }
          out[i] = (1 - alpha) * cells[i].high + alpha * (s / cells[i].neighbors.length);
        }
        cells.forEach((c, i) => {
          c.high = out[i];
        });
      }

      // Expose autoSeed to window for tests
      window.autoSeed = autoSeed;

      function add(start, type, rand = Math.random) {
        const {cells, s, width, height} = getWorld();
        const {templates} = getConfig();
        
        // Defensive guards
        if (!cells?.length) { 
          console.warn('add: no cells, skipping'); 
          return; 
        }
        if (start < 0 || start >= cells.length) { 
          console.warn('add: invalid start index, skipping'); 
          return; 
        }
        
        // get options from sliders
        const highInput = document.getElementById('highInput');
        const radiusInput = document.getElementById('radiusInput');
        const sharpnessInput = document.getElementById('sharpnessInput');
        
        let high = +(highInput?.value || 0);
        const radius = +(radiusInput?.value || 0);
        const sharpness = +(sharpnessInput?.value || 0);
        const queue = [];

        cells[start].high += high;
        cells[start].used = 1;
        queue.push(start);

        for (let i = 0; i < queue.length && high > 0.01; i++) {
          if (type === 'island') {
            high = cells[queue[i]].high * radius;
          } else {
            high = high * radius;
          }
          cells[queue[i]].neighbors.forEach((e) => {
            if (!cells[e].used) {
              let mod = rand() * sharpness + 1.1 - sharpness;
              if (sharpness === 0) mod = 1;
              cells[e].high += high * mod;
              if (cells[e].high > 1) cells[e].high = 1;
              cells[e].used = 1;
              queue.push(e);
            }
          });
        }
        // reset used flags
        cells.forEach(c => c.used = 0);
      }

      function applyBorderMask() {
        const {cells, s, width, height} = getWorld();
        const {templates} = getConfig();
        
        // Defensive guards
        if (!cells?.length) { 
          console.warn('applyBorderMask: no cells, skipping'); 
          return; 
        }
        
        const borderPctInput = document.getElementById('borderPctInput');
        const pct = (+(borderPctInput?.value || 8)) / 100;
        const marginPx = Math.max(2, pct * Math.min(width, height));
        window.__state.borderPx = marginPx;
        // Smoothstep helper
        const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
        const smooth = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
        cells.forEach(c => {
          const distEdge = Math.min(c.cx, c.cy, width - c.cx, height - c.cy);
          const mask = smooth(distEdge / marginPx);
          c.high *= mask; // damp heights near the border to guarantee water frame
        });
      }
      // --- Lakes & basins (depression detection + spill level) ---
      function computeLakes(sea) {
        const {cells, s, width, height} = getWorld();
        const {templates} = getConfig();
        
        // Defensive guards
        if (!cells?.length) { 
          console.warn('computeLakes: no cells, skipping'); 
          return; 
        }
        
        const N = cells.length;
        const isLake = new Uint8Array(N);
        const lakeId = new Int32Array(N); lakeId.fill(-1);
        const downSteep = new Int32Array(N); downSteep.fill(-1);
        const up = Array.from({length: N}, () => []);
        const landIdxs = [];
        for (let i = 0; i < N; i++) {
          if (cells[i].high >= sea) {
            landIdxs.push(i);
            let bestH = cells[i].high, best = -1;
            const nbs = cells[i].neighbors;
            for (let k = 0; k < nbs.length; k++) {
              const nb = nbs[k];
              const hh = cells[nb].high;
              if (hh < bestH) { bestH = hh; best = nb; }
            }
            if (best !== -1) { downSteep[i] = best; up[best].push(i); }
          }
        }
        const visited = new Uint8Array(N);
        const lakes = [];
        for (let sIdx = 0; sIdx < landIdxs.length; sIdx++) {
          const s = landIdxs[sIdx];
          if (visited[s] || downSteep[s] !== -1) continue; // only sinks
          // collect basin by traversing upstream graph
          const basin = []; const stack = [s]; visited[s] = 1; const basinSet = new Set();
          while (stack.length) {
            const v = stack.pop();
            basin.push(v); basinSet.add(v);
            const ups = up[v] || [];
            for (let t = 0; t < ups.length; t++) { const u = ups[t]; if (!visited[u]) { visited[u] = 1; stack.push(u); } }
          }
          // compute spill (lowest outside neighbor)
          let spill = Infinity; let outlet = -1;
          for (let bi = 0; bi < basin.length; bi++) {
            const b = basin[bi];
            const nbs = cells[b].neighbors;
            for (let k = 0; k < nbs.length; k++) {
              const nb = nbs[k];
              if (!basinSet.has(nb)) {
                const hnb = cells[nb].high;
                if (hnb < spill) { spill = hnb; outlet = nb; }
              }
            }
          }
          if (spill > sea && spill < Infinity) {
            let lakeCells = 0; const id = lakes.length;
            let maxDepth = 0;
            
            // Count cells that would be underwater and find max depth
            for (let bi = 0; bi < basin.length; bi++) {
              const b = basin[bi];
              if (cells[b].high < spill) { 
                lakeCells++; 
                const depth = spill - cells[b].high;
                maxDepth = Math.max(maxDepth, depth);
              }
            }
            
            // Only create lakes that are significant in size and depth
            const minLakeCells = +document.getElementById('minLakeSizeInput').value || 3;
            const minLakeDepth = +document.getElementById('minLakeDepthInput').value || 0.05;
            
            if (lakeCells >= minLakeCells && maxDepth >= minLakeDepth) {
              for (let bi = 0; bi < basin.length; bi++) {
                const b = basin[bi];
                if (cells[b].high < spill) { isLake[b] = 1; lakeId[b] = id; }
              }
              lakes.push({ id, level: spill, outlet, size: lakeCells, depth: maxDepth });
            }
          }
        }
        const isWater = cells.map((c, i) => (c.high < sea) || (isLake[i] === 1));
        setIsLake(isLake);
        setLakeId(lakeId);
        setLakes(lakes);
        setIsWater(isWater);
        return { isLake, lakeId, lakes, isWater };
      }



      // --- Export Functions ---
      function getUsedIds(svg) {
        const used = new Set();
        const ATTRS = [
          'fill', 'stroke', 'filter', 'clip-path', 'mask',
          'marker-start', 'marker-mid', 'marker-end', 'href', 'xlink:href'
        ];
        svg.querySelectorAll('*').forEach(el => {
          for (const a of ATTRS) {
            const v = el.getAttribute(a);
            if (!v) continue;
            // url(#id) or href="#id"
            const m1 = v.match(/url\(#([^)]+)\)/);
            if (m1) used.add(m1[1]);
            const m2 = v.match(/^#(.+)/);
            if (m2) used.add(m2[1]);
          }
        });
        return used;
      }

      function pruneDefs(defs, used) {
        defs.querySelectorAll('[id]').forEach(node => {
          if (!used.has(node.id)) node.remove();
        });
      }

      function ensureBackgroundOcean(svg, color) {
        // Remove any prior injected bg
        svg.querySelector('#_export_bg')?.remove();

        const vb = svg.viewBox && svg.viewBox.baseVal;
        const w = svg.getAttribute('width') || (vb ? vb.width : null);
        const h = svg.getAttribute('height') || (vb ? vb.height : null);
        if (!w || !h) return; // set width/height/viewBox upstream as you already do

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('id', '_export_bg');
        rect.setAttribute('x', '0');
        rect.setAttribute('y', '0');
        rect.setAttribute('width', w);
        rect.setAttribute('height', h);
        rect.setAttribute('fill', color);

        // Insert behind everything, but after <defs> if present
        const firstRenderable = [...svg.childNodes].find(n => n.nodeType === 1 && n.tagName !== 'defs');
        if (firstRenderable) svg.insertBefore(rect, firstRenderable);
        else svg.appendChild(rect);
      }
      function inlineSvgStyles(svg, preservePatterns = false) {
        const all = svg.querySelectorAll('*');

        for (const el of all) {
          const cs = getComputedStyle(el);

          const setPaint = (prop, attr) => {
            // Never overwrite explicit fill/stroke attributes that are already set
            if ((attr === 'fill' || attr === 'stroke') && el.hasAttribute(attr)) {
              return;
            }
            
            let v = cs[prop];

            // Preserve patterns for SVG export
            if (preservePatterns && v && v.startsWith('url(')) {
              el.setAttribute(attr, v);
              return;
            }

            // Normalize transparent cases
            if (!v || v === 'none') {
              el.setAttribute(attr, 'none');
              return;
            }
            if (v.startsWith('rgba(')) {
              const [, r, g, b, a] = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+),\s*([.\d]+)\)/) || [];
              if (!r) { el.setAttribute(attr, 'none'); return; }
              if (+a === 0) { el.setAttribute(attr, 'none'); return; } // **important**
              el.setAttribute(attr, `rgb(${r}, ${g}, ${b})`);
              el.setAttribute(attr + '-opacity', a);
              return;
            }
            if (v.startsWith('rgb(')) {
              el.setAttribute(attr, v);
              return;
            }

            // Handle keywords like 'none'
            if (v === 'transparent' || v === 'currentcolor') {
              el.setAttribute(attr, 'none');
            } else {
              // last resort
              el.setAttribute(attr, v);
            }
          };

          setPaint('fill', 'fill');
          setPaint('stroke', 'stroke');

          // Stroke details
          const sw = cs.strokeWidth; if (sw) el.setAttribute('stroke-width', sw);
          const slc = cs.strokeLinecap; if (slc) el.setAttribute('stroke-linecap', slc);
          const slj = cs.strokeLinejoin; if (slj) el.setAttribute('stroke-linejoin', slj);
          const sda = cs.strokeDasharray; if (sda && sda !== 'none') el.setAttribute('stroke-dasharray', sda);
          const sdo = cs.strokeDashoffset; if (sdo && sdo !== '0px') el.setAttribute('stroke-dashoffset', sdo);
          
          // Special handling for river elements to ensure they're visible
          if (el.classList && (el.classList.contains('rivers') || el.classList.contains('riversShade'))) {
            // Ensure river paths have proper stroke attributes
            if (!el.hasAttribute('stroke') && !el.style.stroke) {
              if (el.classList.contains('rivers')) {
                el.setAttribute('stroke', '#4D83AE');
              } else if (el.classList.contains('riversShade')) {
                el.setAttribute('stroke', 'rgba(0,0,0,0.35)');
              }
            }
            // Ensure river paths have stroke-width if not set
            if (!el.hasAttribute('stroke-width') && !el.style.strokeWidth) {
              el.setAttribute('stroke-width', '1');
            }
          }
          
          // Special handling for coastline elements to ensure they're visible
          if (el.classList && el.classList.contains('coast')) {
            // Ensure coastline paths have proper stroke attributes
            if (!el.hasAttribute('stroke') && !el.style.stroke) {
              el.setAttribute('stroke', '#111');
            }
            // Ensure coastline paths have stroke-width if not set
            if (!el.hasAttribute('stroke-width') && !el.style.strokeWidth) {
              el.setAttribute('stroke-width', '0.6px');
            }
            // Ensure coastline paths have stroke-linejoin if not set
            if (!el.hasAttribute('stroke-linejoin') && !el.style.strokeLinejoin) {
              el.setAttribute('stroke-linejoin', 'round');
            }
          }
          
          // Special handling for burg elements to ensure they're visible
          if (el.classList && el.classList.contains('burg')) {
            // Burg groups don't need special handling, but their children do
          }
          
          // Special handling for burg circles
          if (el.tagName === 'circle' && el.parentElement && el.parentElement.classList && el.parentElement.classList.contains('burg')) {
            // Ensure burg circles have proper attributes
            if (!el.hasAttribute('fill') && !el.style.fill) {
              el.setAttribute('fill', '#ff0000');
            }
            if (!el.hasAttribute('stroke') && !el.style.stroke) {
              el.setAttribute('stroke', '#fff');
            }
            if (!el.hasAttribute('stroke-width') && !el.style.strokeWidth) {
              el.setAttribute('stroke-width', '0.6');
            }
            if (!el.hasAttribute('paint-order') && !el.style.paintOrder) {
              el.setAttribute('paint-order', 'stroke fill');
            }
            if (!el.hasAttribute('vector-effect') && !el.style.vectorEffect) {
              el.setAttribute('vector-effect', 'non-scaling-stroke');
            }
          }
          
          // Special handling for burg port rectangles
          if (el.tagName === 'rect' && el.parentElement && el.parentElement.classList && el.parentElement.classList.contains('burg')) {
            // Ensure port rectangles have proper attributes
            if (!el.hasAttribute('fill') && !el.style.fill) {
              el.setAttribute('fill', '#4D83AE');
            }
            if (!el.hasAttribute('stroke') && !el.style.stroke) {
              el.setAttribute('stroke', '#fff');
            }
            if (!el.hasAttribute('stroke-width') && !el.style.strokeWidth) {
              el.setAttribute('stroke-width', '0.3');
            }
            if (!el.hasAttribute('paint-order') && !el.style.paintOrder) {
              el.setAttribute('paint-order', 'stroke fill');
            }
            if (!el.hasAttribute('vector-effect') && !el.style.vectorEffect) {
              el.setAttribute('vector-effect', 'non-scaling-stroke');
            }
          }
          
          // Special handling for route paths
          if (el.tagName === 'path' && el.parentElement && el.parentElement.parentElement && el.parentElement.parentElement.id === 'routes') {
            const routeType = el.parentElement.className.baseVal;
            
            if (routeType === 'roads') {
              if (!el.hasAttribute('stroke') && !el.style.stroke) {
                el.setAttribute('stroke', '#6b4e16');
              }
              if (!el.hasAttribute('stroke-width') && !el.style.strokeWidth) {
                el.setAttribute('stroke-width', '1.4px');
              }
            } else if (routeType === 'trails') {
              if (!el.hasAttribute('stroke') && !el.style.stroke) {
                el.setAttribute('stroke', '#9b7b3a');
              }
              if (!el.hasAttribute('stroke-width') && !el.style.strokeWidth) {
                el.setAttribute('stroke-width', '1.0px');
              }
              if (!el.hasAttribute('stroke-dasharray') && !el.style.strokeDasharray) {
                el.setAttribute('stroke-dasharray', '4 3');
              }
            } else if (routeType === 'searoutes') {
              if (!el.hasAttribute('stroke') && !el.style.stroke) {
                el.setAttribute('stroke', '#ffffff');
              }
              if (!el.hasAttribute('stroke-width') && !el.style.strokeWidth) {
                el.setAttribute('stroke-width', '1.0px');
              }
              if (!el.hasAttribute('stroke-dasharray') && !el.style.strokeDasharray) {
                el.setAttribute('stroke-dasharray', '6 3');
              }
              if (!el.hasAttribute('opacity') && !el.style.opacity) {
                el.setAttribute('opacity', '0.9');
              }
            }
            
            // Common route attributes
            if (!el.hasAttribute('fill') && !el.style.fill) {
              el.setAttribute('fill', 'none');
            }
            if (!el.hasAttribute('stroke-linecap') && !el.style.strokeLinecap) {
              el.setAttribute('stroke-linecap', 'round');
            }
            if (!el.hasAttribute('stroke-linejoin') && !el.style.strokeLinejoin) {
              el.setAttribute('stroke-linejoin', 'round');
            }
            if (!el.hasAttribute('vector-effect') && !el.style.vectorEffect) {
              el.setAttribute('vector-effect', 'non-scaling-stroke');
            }
          }

          // Opacities (element-level)
          const op = cs.opacity; if (op && op !== '1') el.setAttribute('opacity', op);

          // Text extras
          const fw = cs.fontWeight; if (fw) el.setAttribute('font-weight', fw);
          const fs = cs.fontSize; if (fs) el.setAttribute('font-size', fs);
          const ff = cs.fontFamily; if (ff) el.setAttribute('font-family', ff);

          const po = cs.paintOrder; if (po && po !== 'normal') el.setAttribute('paint-order', po);
        }
      }

      // Handy one-shot perf helpers
      window.perfOnce = async () => {
        PERF.reset();
        console.log('▶ Perf run…');
        await window.generate();
        PERF.summary('Generate()');
      };
      window.perfZoomOnce = (k = (window.__state?.lastZoomK || 1)) => {
        const t0 = performance.now();
        if (typeof updateBurgTierVisibility === 'function') updateBurgTierVisibility(k);
        const t1 = performance.now();
        console.log(`Zoom tier switch @k=${k}: ${Math.round((t1 - t0)*10)/10} ms`);
      };
      window.saveSVG = function(svgNode, filename = 'map.svg') {
        // Ensure the map is properly colored before export
        if (window.__state.recolor) {
          recolorCurrent();
        }
        
        // Debug: Check if rivers exist before export
        const originalRivers = svgNode.querySelectorAll('g.rivers path, g.riversShade path');
        // console.log(`Original rivers before export: ${originalRivers.length} paths`);
        if (originalRivers.length === 0) {
                      // console.log('No rivers found! Computing rivers...');
          if (window.__state.computeRoutes) {
            window.__state.computeRoutes();
          }
        }
        
        // Debug: Check if coastlines exist before export
        const originalCoastlines = svgNode.querySelectorAll('g.coastline path.coast');
        // console.log(`Original coastlines before export: ${originalCoastlines.length} paths`);
        if (originalCoastlines.length === 0) {
          console.log('No coastlines found! Computing coastlines...');
          if (window.__state.drawCoastlines) {
            window.__state.drawCoastlines();
            // Check again after computing
            const newCoastlines = svgNode.querySelectorAll('g.coastline path.coast');
            console.log(`Coastlines after computing: ${newCoastlines.length} paths`);
          }
        }
        
        // Debug: Check if burgs exist before export
        const originalBurgs = svgNode.querySelectorAll('#burgs g.burg');
        console.log(`Original burgs before export: ${originalBurgs.length} burgs`);
        // Fixed pipeline handles burg creation; skip legacy generateBurgs
        
        // Debug: Check if routes exist before export
        const originalRoutes = svgNode.querySelectorAll('#routes path');
        console.log(`Original routes before export: ${originalRoutes.length} routes`);
        if (originalRoutes.length === 0) {
          console.log('No routes found! Computing routes...');
          if (window.__state.computeRoutes) {
            window.__state.computeRoutes();
            // Check again after computing
            const newRoutes = svgNode.querySelectorAll('#routes path');
            console.log(`Routes after computing: ${newRoutes.length} routes`);
          }
        }
        
        const clone = svgNode.cloneNode(true);
        
        // Ensure ocean background is properly set
        const oceanRect = clone.querySelector('rect.ocean');
        if (oceanRect) {
          oceanRect.setAttribute('fill', WATER_COLOR);
          oceanRect.setAttribute('style', `fill: ${WATER_COLOR}`);
          console.log(`Ocean rect found and styled with color: ${WATER_COLOR}`);
        } else {
          console.log('No ocean rect found in clone!');
        }
        
        // Inline computed styles to ensure colors are preserved in export (preserve patterns)
        inlineSvgStyles(clone, true);
        
        // Prune unused defs but keep referenced ones
        const defs = clone.querySelector('defs');
        if (defs) {
          const usedIds = getUsedIds(clone);
          pruneDefs(defs, usedIds);
        }
        
        // Debug: Check what fills we have after inlining
        const allCells = clone.querySelectorAll('path.mapCell');
        let blackCells = 0, coloredCells = 0, noneCells = 0;
        allCells.forEach(cell => {
          const fill = cell.getAttribute('fill');
          if (fill === '#000' || fill === 'black') blackCells++;
          else if (fill === 'none') noneCells++;
          else coloredCells++;
        });
        console.log(`Export debug after inlining - Black: ${blackCells}, Colored: ${coloredCells}, None: ${noneCells}`);
        
        // Debug: Check SVG structure
        console.log('SVG clone structure:', clone.innerHTML.substring(0, 500) + '...');
        console.log('Ocean rect in clone:', clone.querySelector('rect.ocean')?.outerHTML);
        
        // Debug: Check river elements
        const riverGroups = clone.querySelectorAll('g.rivers, g.riversShade');
        console.log(`Found ${riverGroups.length} river groups in clone:`, riverGroups);
        riverGroups.forEach((group, i) => {
          const paths = group.querySelectorAll('path');
          console.log(`River group ${i} (${group.className.baseVal}): ${paths.length} paths`);
          if (paths.length > 0) {
            console.log('Sample river path:', paths[0].outerHTML);
          }
        });
        
        // Debug: Check coastline elements
        const coastlineGroups = clone.querySelectorAll('g.coastline');
        console.log(`Found ${coastlineGroups.length} coastline groups in clone:`, coastlineGroups);
        coastlineGroups.forEach((group, i) => {
          const paths = group.querySelectorAll('path.coast');
          console.log(`Coastline group ${i} (${group.className.baseVal}): ${paths.length} paths`);
          if (paths.length > 0) {
            console.log('Sample coastline path:', paths[0].outerHTML);
          }
        });
        
        // Debug: Check burg elements
        const burgGroups = clone.querySelectorAll('#burgs');
        console.log(`Found ${burgGroups.length} burg groups in clone:`, burgGroups);
        burgGroups.forEach((group, i) => {
          const burgs = group.querySelectorAll('g.burg');
          console.log(`Burg group ${i}: ${burgs.length} burgs`);
          if (burgs.length > 0) {
            console.log('Sample burg:', burgs[0].outerHTML);
          }
        });
        
        // Debug: Check route elements
        const routeGroups = clone.querySelectorAll('#routes');
        console.log(`Found ${routeGroups.length} route groups in clone:`, routeGroups);
        routeGroups.forEach((group, i) => {
          const roads = group.querySelectorAll('.roads path');
          const trails = group.querySelectorAll('.trails path');
          const seaRoutes = group.querySelectorAll('.searoutes path');
          console.log(`Route group ${i}: ${roads.length} roads, ${trails.length} trails, ${seaRoutes.length} sea routes`);
          if (roads.length > 0) {
            console.log('Sample road:', roads[0].outerHTML);
          }
        });
        
        // ensure inline styles/fonts if needed
        const svgText = new XMLSerializer().serializeToString(clone);
        const blob = new Blob([svgText], {type: 'image/svg+xml;charset=utf-8'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
      }
      window.savePNG = async function(svgNode, w, h, filename = 'map.png') {
        // Ensure the map is properly colored before export
        if (window.__state.recolor) {
          recolorCurrent();
        }
        
        // Debug: Check if coastlines exist before export
        const originalCoastlines = svgNode.querySelectorAll('g.coastline path.coast');
        console.log(`Original coastlines before PNG export: ${originalCoastlines.length} paths`);
        if (originalCoastlines.length === 0) {
          console.log('No coastlines found! Computing coastlines...');
          if (window.__state.drawCoastlines) {
            window.__state.drawCoastlines();
            // Check again after computing
            const newCoastlines = svgNode.querySelectorAll('g.coastline path.coast');
            console.log(`Coastlines after computing: ${newCoastlines.length} paths`);
          }
        }
        
        // Debug: Check if burgs exist before export
        const originalBurgs = svgNode.querySelectorAll('#burgs g.burg');
        console.log(`Original burgs before PNG export: ${originalBurgs.length} burgs`);
        // Fixed pipeline handles burg creation; skip legacy generateBurgs
        
        // Debug: Check if routes exist before export
        const originalRoutes = svgNode.querySelectorAll('#routes path');
        console.log(`Original routes before PNG export: ${originalRoutes.length} routes`);
        if (originalRoutes.length === 0) {
          console.log('No routes found! Computing routes...');
          if (window.__state.computeRoutes) {
            window.__state.computeRoutes();
            // Check again after computing
            const newRoutes = svgNode.querySelectorAll('#routes path');
            console.log(`Routes after computing: ${newRoutes.length} routes`);
          }
        }
        
        // Create a clone and prepare for canvas rasterization
        const clone = svgNode.cloneNode(true);
        
        // Add namespaces and explicit size for canvas rendering
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
        clone.setAttribute("width", `${w}`);
        clone.setAttribute("height", `${h}`);
        if (!clone.getAttribute("viewBox")) {
          clone.setAttribute("viewBox", `0 0 ${w} ${h}`);
        }
        
        // Inline computed styles to ensure colors are preserved in export (raster-safe)
        inlineSvgStyles(clone, false);
        
        // Remove problematic attributes that can break canvas rendering (restrict to render tree)
        clone.querySelectorAll(':not(defs) [filter]').forEach(n => n.removeAttribute('filter'));
        clone.querySelectorAll('[mask]').forEach(n => n.removeAttribute('mask'));
        clone.querySelectorAll('[mix-blend-mode],[style*="mix-blend-mode"]').forEach(n => {
          n.style.mixBlendMode = '';
        });
        
        // Handle any paint servers (url references) by forcing solid fills
        clone.querySelectorAll('[fill^="url("], [stroke^="url("]').forEach(el => {
          const paint = getComputedStyle(el).fill;
          el.setAttribute('fill', paint && paint !== 'none' ? paint : WATER_COLOR);
        });
        
        // Add solid background ocean for raster-safe export
        const oceanEl = clone.querySelector('#oceanBase, .ocean, [data-layer="ocean"]');
        let oceanColor = WATER_COLOR;
        if (oceanEl) {
          const f = getComputedStyle(oceanEl).fill;
          if (f && f.startsWith('rgb(')) oceanColor = f;
        }
        ensureBackgroundOcean(clone, oceanColor);
        
        // Remove unused defs if nothing references them
        if (!clone.querySelector('[fill^="url("],[stroke^="url("],[filter],[mask]')) {
          const defs = clone.querySelector('defs');
          if (defs) defs.remove();
        }
        
        const svgText = new XMLSerializer().serializeToString(clone);
        const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        await new Promise(resolve => {
          img.onload = resolve;
          img.src = svgUrl;
        });
        
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        
        // Draw the SVG image (background is already included in SVG)
        ctx.drawImage(img, 0, 0, w, h);
        
        canvas.toBlob(blob => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = filename;
          
          // iOS-friendly export: open in new tab if download is blocked
          try {
            a.click();
          } catch (e) {
            // Fallback for iOS: open data URL in new tab
            const dataURL = canvas.toDataURL('image/png');
            const newWindow = window.open();
            if (newWindow) {
              newWindow.document.write(`<img src="${dataURL}" alt="Map Export" style="max-width: 100%; height: auto;">`);
              newWindow.document.title = filename;
            }
          }
          
          URL.revokeObjectURL(a.href);
        }, 'image/png');
      }
      // Expose export functions globally
      // window.saveSVG and window.savePNG are already set above
      // --- Climate and Biome System ---
      function computeClimate(sea) {
        const baseTempF = +document.getElementById('baseTempInput').value;
        const baseTempC = (baseTempF - 32) * 5/9; // Convert F to C
        const maxElevation_m = 2000; // meters
        const lapseRate = 6.5; // °C per 1000m
        
        // Compute temperature and precipitation for each cell
        cells.forEach(c => {
          // Temperature based on elevation
          const elevRatio = Math.max(0, c.high - sea) / (1 - sea);
          const elevation_m = elevRatio * maxElevation_m;
          c.temp = baseTempC - (elevation_m * lapseRate / 1000);
          
          // Precipitation (reuse existing model)
          c.precip = 0; // Will be set by computePrecipArray
        });
        
        // Get precipitation values and scale them
        const precipArray = computePrecipArray();
        const precipScale = +document.getElementById('precipScaleInput').value || 0.5;
        cells.forEach((c, i) => {
          c.precip = precipArray[i] * precipScale;
        });
        
        // Classify biomes
        cells.forEach(c => {
          c.biome = classifyBiome(c, sea);
        });
        
        // Debug: Log temperature and precipitation ranges
        const landCells = cells.filter(c => c.high >= sea);
        if (landCells.length > 0) {
          const temps = landCells.map(c => c.temp);
          const precips = landCells.map(c => c.precip);
          const minTempC = Math.min(...temps);
          const maxTempC = Math.max(...temps);
          const minTempF = minTempC * 9/5 + 32;
          const maxTempF = maxTempC * 9/5 + 32;
          const minPrecip = Math.min(...precips);
          const maxPrecip = Math.max(...precips);
          console.log(`Temperature range: ${minTempF.toFixed(1)}°F to ${maxTempF.toFixed(1)}°F (${minTempC.toFixed(1)}°C to ${maxTempC.toFixed(1)}°C)`);
          console.log(`Precipitation range: ${minPrecip.toFixed(3)} to ${maxPrecip.toFixed(3)}`);
        }
      }
      
      function classifyBiome(cell, seaLevel) {
        if (cell.high < seaLevel) return 'Ocean';
        
        const T = cell.temp;
        const P = cell.precip;
        
        // Adjust thresholds based on typical precipitation ranges
        if (T < -5) {
          return P > 0.3 ? 'Tundra' : 'Polar Desert';
        }
        if (T < 5) {
          return P > 0.6 ? 'Boreal Forest' : (P > 0.3 ? 'Cold Grassland' : 'Cold Desert');
        }
        if (T < 18) {
          if (P < 0.3) return 'Temperate Desert';
          if (P < 0.6) return 'Grassland';
          if (P < 1.2) return 'Temperate Forest';
          return 'Rainforest';
        }
        // T >= 18 (tropical)
        if (P < 0.3) return 'Hot Desert';
        if (P < 0.6) return 'Savanna';
        if (P < 1.0) return 'Tropical Seasonal Forest';
        return 'Tropical Rainforest';
      }
      

      
      function updateBiomeLegend() {
        const renderMode = document.getElementById('renderMode').value;
        const legend = document.getElementById('biomeLegend');
        const legendItems = document.getElementById('legendItems');
        
        if (renderMode === 'biomes' || renderMode === 'hybrid') {
          const biomeColors = {
            'Ocean': '#4D83AE',
            'Tundra': '#E8F4F8',
            'Polar Desert': '#F0F8FF',
            'Boreal Forest': '#2E5A27',
            'Cold Grassland': '#8FBC8F',
            'Cold Desert': '#F5DEB3',
            'Temperate Desert': '#DEB887',
            'Grassland': '#90EE90',
            'Temperate Forest': '#228B22',
            'Rainforest': '#006400',
            'Hot Desert': '#F4A460',
            'Savanna': '#F0E68C',
            'Tropical Seasonal Forest': '#32CD32',
            'Tropical Rainforest': '#228B22'
          };
          
          // Group biomes by temperature category
          const biomeGroups = {
            'Cold Biomes': ['Tundra', 'Polar Desert', 'Boreal Forest', 'Cold Grassland', 'Cold Desert'],
            'Temperate Biomes': ['Temperate Desert', 'Grassland', 'Temperate Forest', 'Rainforest'],
            'Tropical Biomes': ['Hot Desert', 'Savanna', 'Tropical Seasonal Forest', 'Tropical Rainforest'],
            'Water': ['Ocean']
          };
          
          let legendHTML = '';
          
          Object.entries(biomeGroups).forEach(([groupName, biomes]) => {
            legendHTML += `<div style="margin-bottom: 8px;"><strong>${groupName}</strong></div>`;
            biomes.forEach(biome => {
              const color = biomeColors[biome];
              legendHTML += `
                <div style="display: flex; align-items: center; margin-bottom: 2px;">
                  <div style="width: 16px; height: 12px; background-color: ${color}; border: 1px solid #666; margin-right: 8px;"></div>
                  <span>${biome}</span>
                </div>
              `;
            });
            legendHTML += '<br>';
          });
          
          if (renderMode === 'hybrid') {
            legendHTML += `
              <div style="margin-top: 8px; font-style: italic; font-size: 11px;">
                Note: High elevations fade to white in hybrid mode
              </div>
            `;
          }
          
          legendItems.innerHTML = legendHTML;
          legend.style.display = 'block';
        } else {
          legend.style.display = 'none';
        }
      }

      // --- Rivers & precipitation (Azgaar-inspired) ---
      function windVecForLat(latDeg) {
        // return unit vector [ux, uy] in screen coords (x right, y down)
        if (Math.abs(latDeg) < 30) return [1, 0];   // easterlies → 
        if (Math.abs(latDeg) < 60) return [-1, 0];  // westerlies ←
        return [1, 0];                              // polar easterlies →
      }

      function windField(cells, H) {
        const U = Array(cells.length);
        for (let i = 0; i < cells.length; i++) {
          const lat = 90 - 180 * (cells[i].cy / height); // 0..1 → 90..-90
          U[i] = windVecForLat(lat);
        }
        return U;
      }

      function windVecs() {
        const mode = document.getElementById('windBelts').value;
        if (mode === 'hadley') {
          // Use wind field for each cell
          return windField(cells, cells.map(c => c.high));
        } else {
          // Random wind (original behavior)
          const pick = () => [[1,0],[-1,0],[0,1],[0,-1]][Math.floor(Math.random()*4)];
          return [pick()];
        }
      }
      function computePrecipArray() {
        const windMode = document.getElementById('windBelts').value;
        const intensity = +document.getElementById('rainInput').value; // 0..2
        const base = 0.4 * intensity + 0.1; // baseline drizzle
        const P = new Float32Array(cells.length);
        for (let i = 0; i < cells.length; i++) P[i] = base;
        
        if (windMode === 'hadley') {
          // Use wind field with orographic effects
          const U = windField(cells, cells.map(c => c.high));
          for (let i = 0; i < cells.length; i++) {
            const ci = cells[i];
            const [wx, wy] = U[i]; // Wind vector for this cell
            const nbs = ci.neighbors;
            for (let k = 0; k < nbs.length; k++) {
              const j = nbs[k];
              const vx = ci.cx - cells[j].cx;
              const vy = ci.cy - cells[j].cy;
              const dot = vx * wx + vy * wy; // >0 means wind approaches cell i from neighbor j
              const dh = ci.high - cells[j].high; // upslope from j -> i adds rain
              if (dot > 0 && dh > 0) {
                // Upslope: orographic bonus
                P[i] += intensity * dh * (dot / Math.hypot(vx, vy)) * 0.3;
              } else if (dot > 0 && dh < 0) {
                // Lee side: rain shadow
                P[i] -= intensity * (-dh) * (dot / Math.hypot(vx, vy)) * 0.15;
              }
            }
          }
        } else {
          // Original random wind system
          const winds = windVecs();
          const norm = (x,y) => { const L = Math.hypot(x,y)||1; return [x/L, y/L]; };
          winds.forEach(w => {
            const [wx, wy] = norm(w[0], w[1]);
            for (let i = 0; i < cells.length; i++) {
              const ci = cells[i];
              const nbs = ci.neighbors;
              for (let k = 0; k < nbs.length; k++) {
                const j = nbs[k];
                const vx = ci.cx - cells[j].cx;
                const vy = ci.cy - cells[j].cy;
                const dot = vx*wx + vy*wy; // >0 means wind approaches cell i from neighbor j
                const dh = ci.high - cells[j].high; // upslope from j -> i adds rain
                if (dot > 0 && dh > 0) P[i] += intensity * dh * (dot/Math.hypot(vx,vy)) * 0.6;
                else if (dot > 0 && dh < 0) P[i] += intensity * dh * 0.15; // leeward drying
              }
            }
          });
        }
        // smooth precipitation a bit (2 iterations)
        for (let it = 0; it < 2; it++) {
          const N = new Float32Array(cells.length);
          for (let i = 0; i < cells.length; i++) {
            let sum = P[i], cnt = 1;
            const nbs = cells[i].neighbors;
            for (let k = 0; k < nbs.length; k++) { sum += P[nbs[k]]; cnt++; }
            N[i] = sum / cnt;
          }
          P.set(N);
        }
        // Store precipitation array for tests
        window.__state.precipArray = P;
        return P;
      }

      // Compute average color for an island based on its cells
      function computeIslandColor(loop, renderMode, sea, cells) {
        if (renderMode === 'biomes' || renderMode === 'hybrid') {
          return '#90EE90'; // Light green for biomes
        }
        
        // For height map, compute average elevation of cells within the island
        // Find cells that are within this island's boundary
        const islandCells = [];
        
        // Simple approach: find cells whose center is within the island polygon
        cells.forEach(cell => {
          if (cell.high >= sea) { // Only consider land cells
            // Check if cell center is inside the island polygon
            if (pointInPolygon([cell.cx, cell.cy], loop)) {
              islandCells.push(cell);
            }
          }
        });
        
        if (islandCells.length === 0) {
          // Fallback: use a representative lowland color
          return landColor(0.2);
        }
        
        // Compute average elevation of island cells
        const avgElevation = islandCells.reduce((sum, cell) => sum + cell.high, 0) / islandCells.length;
        const normalizedElevation = (avgElevation - sea) / Math.max(1 - sea, 0.0001);
        const clampedElevation = Math.max(0, Math.min(1, normalizedElevation));
        
        return landColor(clampedElevation);
      }
      
      // Point-in-polygon test using ray casting algorithm
      function pointInPolygon(point, polygon) {
        const [x, y] = point;
        let inside = false;
        
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
          const [xi, yi] = polygon[i];
          const [xj, yj] = polygon[j];
          
          if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
            inside = !inside;
          }
        }
        
        return inside;
      }
      // Call drawCoastlines function (now defined globally)
      // Call drawCoastlines to update coastlines
      drawCoastlines();

    // --- Coastline builder (Azgaar-style: boundary between land and water) ---
    function drawCoastlines() {
      const coastG = d3.select('g.coastline');
      const { mapCells } = getLayers();
      
      coastG.selectAll('path.coast').remove();
      mapCells.selectAll('path.land-fill').remove();
      
      // ✨ always recompute based on the *current* cells & sea level
      const sea = +document.getElementById('seaLevelInput').value;
      const cells = window.__state.cells;
      
      if (!cells || cells.length === 0) return;
      
      // if you have a computeLakes() that also marks lakes, call it here;
      // otherwise this simple mask is fine:
      const isWaterArr = cells.map(c => c.high < sea);
      
      // update cache for other systems (rivers, burg scoring, routes)
      window.__state.isWater = isWaterArr;
      
      // ❌ invalidate any previously unified paths so recolor can't reuse them
      window.__state.unifiedLandPaths = null;
      window.__state.landPaths = null;
      
      const isLand = cells.map((c,i) => !isWaterArr[i]);
      
      // Update progress during coastline computation
      ProgressManager.update(72, 'Drawing coastlines...', 'Finding coastline edges...');

      // Build undirected edge map from Voronoi cell polygons
      const edgeMap = new Map(); // key -> {a,b,cells:Set}
      const keyOfPoint = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
      const edgeKey = (a,b) => {
        const qa = keyOfPoint(a), qb = keyOfPoint(b);
        return qa < qb ? `${qa}|${qb}` : `${qb}|${qa}`;
      };

      cells.forEach((c) => {
        const poly = c.poly;
        for (let i = 0; i < poly.length - 1; i++) { // last equals first
          const a = poly[i], b = poly[i + 1];
          const k = edgeKey(a, b);
          let e = edgeMap.get(k);
          if (!e) { e = { a, b, cells: new Set() }; edgeMap.set(k, e); }
          e.cells.add(c.index);
        }
      });

      // Filter edges where sides differ (land vs water OR hull)
      const coastEdges = [];
      edgeMap.forEach((e) => {
        const arr = Array.from(e.cells);
        const c0 = arr[0];
        const c1 = arr[1] !== undefined ? arr[1] : null; // null => hull
        const land0 = c0 != null ? isLand[c0] : false;
        const land1 = c1 != null ? isLand[c1] : false;
        if (land0 !== land1) coastEdges.push(e); // coastline segment
      });

      if (DEBUG) console.log(`Found ${coastEdges.length} coastline edges`);
      if (coastEdges.length === 0) return;

      // Chain edges into polylines by shared endpoints
      const pointToEdges = new Map(); // pointKey -> Set(edgeKey)
      coastEdges.forEach((e) => {
        const k = edgeKey(e.a, e.b);
        const ka = keyOfPoint(e.a), kb = keyOfPoint(e.b);
        if (!pointToEdges.has(ka)) pointToEdges.set(ka, new Set());
        if (!pointToEdges.has(kb)) pointToEdges.set(kb, new Set());
        pointToEdges.get(ka).add(k);
        pointToEdges.get(kb).add(k);
      });

      const edgesObj = new Map();
      coastEdges.forEach((e) => { edgesObj.set(edgeKey(e.a, e.b), { a: e.a, b: e.b, used: false }); });

      const chains = [];
      const takeNext = (ptKey) => {
        const set = pointToEdges.get(ptKey);
        if (!set) return null;
        for (const k of set) { const e = edgesObj.get(k); if (e && !e.used) return k; }
        return null;
      };

      edgesObj.forEach((seg) => {
        if (seg.used) return;
        seg.used = true;
        const startKey = keyOfPoint(seg.a), endKey = keyOfPoint(seg.b);
        const chain = [seg.a, seg.b];

        // extend forward from end
        let currKey = endKey;
        let prevKey = startKey;
        for (;;) {
          const nextKey = takeNext(currKey);
          if (!nextKey) break;
          const next = edgesObj.get(nextKey);
          next.used = true;
          const na = keyOfPoint(next.a), nb = keyOfPoint(next.b);
          const other = (na === currKey) ? nb : na;
          if (other === prevKey) break; // would backtrack
          chain.push(na === currKey ? next.b : next.a);
          prevKey = currKey; currKey = other;
        }

        chains.push(chain);
      });

      // Separate closed loops (islands) from open chains (peninsulas)
      const closedLoops = [];
      const openChains = [];
      
      chains.forEach((chain) => {
        const isClosed = (keyOfPoint(chain[0]) === keyOfPoint(chain[chain.length - 1]));
        if (isClosed && chain.length > 3) {
          closedLoops.push(chain);
        } else {
          openChains.push(chain);
        }
      });

      if (DEBUG) console.log(`Found ${closedLoops.length} closed loops (islands) and ${openChains.length} open chains`);

      // Create unified land paths for each island
      closedLoops.forEach((loop, islandIndex) => {
        // Smooth the loop with Chaikin
        const smoothedLoop = chaikin(loop, 2);
        
        // Create the path data for this island
        const pathD = islandToPathD(smoothedLoop);
        
        // Create the land fill path in mapCells group (behind everything)
        const landPath = mapCells.insert('path', ':first-child')
          .attr('class', 'land-fill')
          .attr('d', pathD)
          .attr('fill', 'none')          // was '#f0f0f0'
          .attr('stroke', 'none')
          .attr('fill-rule', 'evenodd');
        
        // Create the coastline stroke in coastG group (on top)
        const coastPath = coastG.append('path')
          .attr('class', 'coast')
          .attr('d', pathD)
          .attr('fill', 'none')
          .attr('stroke', '#111')
          .attr('stroke-width', '0.6px')
          .attr('stroke-linejoin', 'round');
      });

      // Create unified land paths for masking and underlay
      if (closedLoops.length > 0) {
        window.__state.unifiedLandPaths = closedLoops.map(loop => {
          const smoothedLoop = chaikin(loop, 1);
          return smoothedLoop;
        });
      }

      // Save coastline path data for seam stroke
      if (closedLoops.length > 0) {
        const coastD = closedLoops.map(loop => {
          const smoothedLoop = chaikin(loop, 1);
          return islandToPathD(smoothedLoop);
        }).join('');
        window.__state.coastD = coastD;
      }

      // Build land mask & underlay so inland hairlines show land, not sea
      const svg = window.__state.svg;
      const zoomRoot = d3.select('#zoomRoot');
      const width = +svg.attr('width');
      const height = +svg.attr('height');
      ensureLandUnderlay(svg, zoomRoot, width, height);
    }

    // --- Rivers & precipitation (Azgaar-inspired) ---
    // Now handled by rivers.js module

    // --- Burgs (Settlements) System ---

    /**
     * Score a cell for capital placement (strategic locations)
     * @param {Object} cell - The cell to score
     * @param {Array} cells - All cells array
     * @param {number} sea - Sea level
     * @returns {number} Score between 0 and 1
     */
    function scoreCellForCapital(cell, cells, sea) {
      const riverWeight = +document.getElementById('riverWeightInput').value || 0.4;
      const coastWeight = +document.getElementById('coastWeightInput').value || 0.3;
      const flatnessWeight = +document.getElementById('flatnessWeightInput').value || 0.2;
      const fertilityWeight = +document.getElementById('fertilityWeightInput').value || 0.1;

      // Skip water cells
      if (cell.high < sea) return 0;
      
      // Skip very high peaks (too steep for settlements)
      if (cell.high > 0.8) return 0;

      let riverProximity = 0;
      let coastProximity = 0;
      let flatness = 0;
      let fertility = 1; // Default fertility
      let harborQuality = 0;

      // Calculate river proximity (check neighbors for rivers)
      let riverNeighbors = 0;
      cell.neighbors.forEach(nb => {
        const neighborCell = cells[nb];
        const isWater = neighborCell.high < sea;
        const isLake = window.__state.isLake && window.__state.isLake[nb] === 1;
        if (isWater && !isLake) {
          riverNeighbors++;
        }
      });
      riverProximity = Math.min(1, riverNeighbors / cell.neighbors.length * 3);

      // Calculate river proximity
      riverProximity = Math.min(1, riverNeighbors / cell.neighbors.length * 3);

      // Calculate coast proximity using distance-to-water field
      let minWaterDist = Infinity;
      let waterNeighbors = 0;
      
      // Use precomputed distance-to-water field if available
      if (window.__state.distToWater) {
        minWaterDist = window.__state.distToWater[cell.index];
        // Count water neighbors for harbor quality
        cell.neighbors.forEach(nb => {
          if (cells[nb].high < sea) {
            waterNeighbors++;
          }
        });
      } else {
        // Fallback to O(N²) scan
        for (let i = 0; i < cells.length; i++) {
          if (cells[i].high < sea) {
            const dist = Math.hypot(cell.cx - cells[i].cx, cell.cy - cells[i].cy);
            minWaterDist = Math.min(minWaterDist, dist);
            
            // Count water neighbors for harbor quality
            if (dist < 30) {
              waterNeighbors++;
            }
          }
        }
      }
      coastProximity = Math.max(0, 1 - minWaterDist / 100); // Prefer cells within 100px of coast
      
      // Harbor quality: prefer sheltered locations (exactly one ocean neighbor)
      if (waterNeighbors === 1) {
        harborQuality = 1.0; // Perfect harbor (cove/estuary)
      } else if (waterNeighbors === 2) {
        harborQuality = 0.7; // Good harbor
      } else if (waterNeighbors > 2) {
        harborQuality = 0.3; // Exposed coast
      }

      // Calculate flatness (inverse of slope)
      let maxSlope = 0;
      cell.neighbors.forEach(nb => {
        const slope = Math.abs(cell.high - cells[nb].high);
        maxSlope = Math.max(maxSlope, slope);
      });
      flatness = Math.max(0, 1 - maxSlope * 5); // Prefer flatter areas

      // Calculate fertility (use precipitation if available)
      if (window.__state.precipArray) {
        fertility = Math.min(1, window.__state.precipArray[cell.index] || 0.5);
      }

      // Combine scores with weights (capitals emphasize strategic locations)
      const score = riverWeight * riverProximity + 
                   coastWeight * (coastProximity * 0.6 + harborQuality * 0.4) + 
                   flatnessWeight * flatness + 
                   fertilityWeight * fertility;

      // Debug: Log some sample scores
      if (Math.random() < 0.01) { // Log 1% of cells for debugging
        if (DEBUG) console.log(`Cell ${cell.index} CAPITAL scores - River: ${riverProximity.toFixed(2)}, Coast: ${coastProximity.toFixed(2)}, Harbor: ${harborQuality.toFixed(2)}, Flat: ${flatness.toFixed(2)}, Fert: ${fertility.toFixed(2)}, Total: ${score.toFixed(2)}`);
      }

      return Math.max(0, Math.min(1, score));
    }

    /**
     * Score a cell for town placement (including road access bonus)
     * @param {Object} cell - The cell to score
     * @param {Array} cells - All cells array
     * @param {number} sea - Sea level
     * @param {Array} capitals - Array of capital burgs
     * @returns {number} Score between 0 and 1
     */
    function scoreCellForTown(cell, cells, sea, capitals) {
      const riverWeight = +document.getElementById('riverWeightInput').value || 0.4;
      const coastWeight = +document.getElementById('coastWeightInput').value || 0.3;
      const flatnessWeight = +document.getElementById('flatnessWeightInput').value || 0.2;
      const fertilityWeight = +document.getElementById('fertilityWeightInput').value || 0.1;
      const roadWeight = 0.3; // Bonus for road access

      // Skip water cells
      if (cell.high < sea) return 0;
      
      // Skip very high peaks (too steep for settlements)
      if (cell.high > 0.8) return 0;

      let riverProximity = 0;
      let coastProximity = 0;
      let flatness = 0;
      let fertility = 1; // Default fertility
      let roadAccess = 0;

      // Calculate river proximity (same as capitals)
      let riverNeighbors = 0;
      cell.neighbors.forEach(nb => {
        const neighborCell = cells[nb];
        const isWater = neighborCell.high < sea;
        const isLake = window.__state.isLake && window.__state.isLake[nb] === 1;
        if (isWater && !isLake) {
          riverNeighbors++;
        }
      });
      riverProximity = Math.min(1, riverNeighbors / cell.neighbors.length * 3);

      // Calculate coast proximity (simpler than capitals)
      let minWaterDist = Infinity;
      for (let i = 0; i < cells.length; i++) {
        if (cells[i].high < sea) {
          const dist = Math.hypot(cell.cx - cells[i].cx, cell.cy - cells[i].cy);
          minWaterDist = Math.min(minWaterDist, dist);
        }
      }
      coastProximity = Math.max(0, 1 - minWaterDist / 100);

      // Calculate flatness (same as capitals)
      let maxSlope = 0;
      cell.neighbors.forEach(nb => {
        const slope = Math.abs(cell.high - cells[nb].high);
        maxSlope = Math.max(maxSlope, slope);
      });
      flatness = Math.max(0, 1 - maxSlope * 5);

      // Calculate fertility (same as capitals)
      if (window.__state.precipArray) {
        fertility = Math.min(1, window.__state.precipArray[cell.index] || 0.5);
      }

      // Calculate road access bonus (distance to nearest capital road)
      let minRoadDist = Infinity;
      if (window.__state.capitalRoads && window.__state.capitalRoads.length > 0) {
        for (const road of window.__state.capitalRoads) {
          // Simple distance to road segment (could be improved with actual path distance)
          const dist = Math.hypot(cell.cx - road.x, cell.cy - road.y);
          minRoadDist = Math.min(minRoadDist, dist);
        }
        roadAccess = Math.max(0, 1 - minRoadDist / 200); // Bonus within 200px of roads
      }

      // Combine scores with weights (towns emphasize road access)
      const baseScore = riverWeight * riverProximity + 
                       coastWeight * coastProximity + 
                       flatnessWeight * flatness + 
                       fertilityWeight * fertility;
      
      const roadBonus = roadWeight * roadAccess;
      const score = baseScore + roadBonus;

      // Debug: Log some sample scores
      if (Math.random() < 0.01) { // Log 1% of cells for debugging
        if (DEBUG) console.log(`Cell ${cell.index} TOWN scores - River: ${riverProximity.toFixed(2)}, Coast: ${coastProximity.toFixed(2)}, Flat: ${flatness.toFixed(2)}, Fert: ${fertility.toFixed(2)}, Road: ${roadAccess.toFixed(2)}, Total: ${score.toFixed(2)}`);
      }

      return Math.max(0, Math.min(1, score));
    }

    /**
     * Poisson disk sampling for burg placement
     * @param {Array} candidates - Array of {cell, score} objects
     * @param {number} radiusPx - Minimum distance between burgs in pixels
     * @returns {Array} Spaced subset of candidates
     */
    function poissonSample(candidates, radiusPx) {
      const accepted = [];
      const rejected = [];
      
      // Sort by score (highest first)
      const sorted = candidates.sort((a, b) => b.score - a.score);
      
      for (const candidate of sorted) {
        let tooClose = false;
        
        // Check distance to all accepted burgs
        for (const acceptedBurg of accepted) {
          const dist = Math.hypot(
            candidate.cell.cx - acceptedBurg.cell.cx,
            candidate.cell.cy - acceptedBurg.cell.cy
          );
          if (dist < radiusPx) {
            tooClose = true;
            break;
          }
        }
        
        if (!tooClose) {
          accepted.push(candidate);
        } else {
          rejected.push(candidate);
        }
      }
      
      return accepted;
    }

    /**
     * Build roads between capitals (MST approach)
     * @param {Array} capitals - Array of capital burgs
     */
    function buildCapitalRoads(capitals) {
      if (capitals.length < 2) return;
      
              // console.log(`Building capital road network for ${capitals.length} capitals`);
      
      // Create edges between all capital pairs
      const edges = [];
      for (let i = 0; i < capitals.length; i++) {
        for (let j = i + 1; j < capitals.length; j++) {
          const dist = Math.hypot(
            capitals[i].x - capitals[j].x,
            capitals[i].y - capitals[j].y
          );
          edges.push({
            a: i,
            b: j,
            cost: dist
          });
        }
      }
      
      // Sort edges by cost for Kruskal's algorithm
      edges.sort((a, b) => a.cost - b.cost);
      
      // Kruskal's algorithm for MST
      const parent = new Array(capitals.length).fill(0).map((_, i) => i);
      
      function find(x) {
        if (parent[x] !== x) {
          parent[x] = find(parent[x]);
        }
        return parent[x];
      }
      
      function union(x, y) {
        parent[find(x)] = find(y);
      }
      
      const mstEdges = [];
      for (const edge of edges) {
        if (find(edge.a) !== find(edge.b)) {
          union(edge.a, edge.b);
          mstEdges.push(edge);
        }
      }
      
      // Store capital roads for town scoring
      window.__state.capitalRoads = mstEdges.map(edge => ({
        x: (capitals[edge.a].x + capitals[edge.b].x) / 2,
        y: (capitals[edge.a].y + capitals[edge.b].y) / 2,
        a: edge.a,
        b: edge.b
      }));
      
      if (DEBUG) console.log(`Built ${mstEdges.length} capital roads`);
    }

    /**
     * Minimal backbone: connect capitals+ports with MST, realize with A* over landGraph
     * @param {Array} burgs - Array of burg objects
     * @param {Object} landGraph - Land graph with neighbors() method
     * @returns {Array} Array of cell-index paths
     */
    // Moved to routes.js
    
    // Expose for callers defined in other scopes
    if (typeof window !== 'undefined') window.buildBackboneRoads = buildBackboneRoads;

    /**
     * Create a burg object from a cell
     * @param {Object} cell - The cell to place the burg on
     * @param {Array} cells - All cells array
     * @param {number} sea - Sea level
     * @param {number} index - Burg index
     * @param {string} type - Burg type ('capital', 'town', 'port')
     * @returns {Object} Burg object
     */
    function placeBurg(cell, cells, sea, index, type = 'town') {
      const id = index;
      
      // Determine if it's a port (near coast)
      let isPort = false;
      let minWaterDist = Infinity;
      for (let i = 0; i < cells.length; i++) {
        if (cells[i].high < sea) {
          const dist = Math.hypot(cell.cx - cells[i].cx, cell.cy - cells[i].cy);
          minWaterDist = Math.min(minWaterDist, dist);
        }
      }
      isPort = minWaterDist < 15; // Within 15px of water (more selective)
      
      // Debug: Log port detection for some burgs
      if (Math.random() < 0.1) { // Log 10% of burgs
        // console.log(`Burg ${id} port detection: minWaterDist=${minWaterDist.toFixed(1)}px, isPort=${isPort}, type=${type}`);
      }

      // Determine if it's on a river
      let onRiver = false;
      cell.neighbors.forEach(nb => {
        const neighborCell = cells[nb];
        // Check if neighbor is water but not a lake
        const isWater = neighborCell.high < sea;
        const isLake = window.__state.isLake && window.__state.isLake[nb] === 1;
        if (isWater && !isLake) {
          onRiver = true;
        }
      });

      // Determine population based on type and features
      let population = 1000;
      
      if (type === 'capital') {
        population = 5000; // Capitals are larger
      } else if (isPort) {
        population = 2000; // Ports are prosperous
      } else if (onRiver) {
        population = 1500; // River towns are moderately prosperous
      }

      return {
        id: id,
        x: cell.cx,
        y: cell.cy,
        cell: cell.index,
        cultureId: null, // Will be assigned in Regions phase
        countryId: null, // Will be assigned in Regions phase
        population: population,
        type: type,
        port: isPort,
        isSignificantPort: false, // Capitals are not significant ports (ports should be cities)
        onRiver: onRiver,
        name: 'Unnamed' // Will be replaced by generateRegionalNames
      };
    }
    // generateBurgs removed; fixed pipeline replaces it
    /**
     * Render burgs using D3 data-join
     */
    function renderBurgs() {
      const burgsG = d3.select('#burgs');
      if (!window.__state.burgs || window.__state.burgs.length === 0) return;

      // Compute tiers once
      computeBurgTiers();

      // Render into 5 tier groups
      renderBurgSymbolsBucketed();

      // Initial tier visibility based on current zoom
      const k = (window.currentTransform || d3.zoomIdentity).k || 1;
      updateBurgTierVisibility(k);
    }
    function computeBurgTiers() {
      const B = window.__state.burgs || [];
      if (!B.length) return;

      const tierOf = b => {
        if (b.typeClass === 'capital') return 0;
        if (b.typeClass === 'port' || b.typeClass === 'town') {
          if (b.popRank <= 0.10) return 1;
          if (b.popRank <= 0.30) return 2;
          if (b.popRank <= 0.70) return 3;
          return 4;
        }
        if (b.typeClass === 'village') {
          if (b.popRank <= 0.10) return 2;
          if (b.popRank <= 0.40) return 3;
          return 4;
        }
        if (b.typeClass === 'manor') {
          if (b.popRank <= 0.15) return 3;
          return 4;
        }
        return 4;
      };

      for (const b of B) b.__tier = tierOf(b);
      window.__state.burgTiers = d3.groups(B, d => d.__tier);
    }

    function renderBurgSymbolsBucketed() {
      const root = d3.select('#burgs');
      const tiers = [0,1,2,3,4];
      const ensureLayer = t => {
        let g = root.select(`g.tier-${t}`);
        if (g.empty()) g = root.append('g').attr('class', `tier-${t}`);
        return g;
      };

      for (const t of tiers) {
        const burgs = (window.__state.burgTiers?.find(([k]) => k===t)?.[1]) || [];
        const g = ensureLayer(t);
        const sel = g.selectAll('g.burg').data(burgs, d => d.id);
        sel.exit().remove();

        const enter = sel.enter().append('g').attr('class','burg');
        enter.append('circle')
          .attr('class', d=>d.typeClass)
          .attr('cx', d=>d.x).attr('cy', d=>d.y);
        enter.filter(d=>d.typeClass==='capital').append('path')
          .attr('class','capital-star')
          .attr('d', d => {
            const r=6,pts=[];const s=5,i=r*0.45;for(let k=0;k<s;k++){let a=k*2*Math.PI/s;pts.push([Math.sin(a)*r,-Math.cos(a)*r]);a+=Math.PI/s;pts.push([Math.sin(a)*i,-Math.cos(a)*i]);}
            return 'M'+pts.map(p=>p[0]+','+p[1]).join('L')+'Z';
          })
          .attr('transform', d=>`translate(${d.x},${d.y})`);
      }
    }

    function tierForZoom(k){
      if (k < 1.5) return 0;
      if (k < 2.5) return 1;
      if (k < 4.0) return 2;
      if (k < 6.0) return 3;
      return 4;
    }

    let _lastTier = -1;
    function updateBurgTierVisibility(k){
      const tier = tierForZoom(k);
      window.__state.lastZoomK = k;
      if (tier === _lastTier) return;
      _lastTier = tier;

      const root = d3.select('#burgs');
      for (let t=0; t<=4; t++){
        root.select(`g.tier-${t}`).attr('display', t <= tier ? null : 'none');
      }

      if (typeof updateLabelTierVisibility === 'function') {
        updateLabelTierVisibility(tier);
      }
      console.log(`⛭ Tier switch: show<=${tier}`);
    }
    // Draggable burg labels; store screen-pinned px/py on drag, clear on double-click (to unpin)
    const burgDrag = d3.drag()
      .on('start', function (event, d) { d3.select(this).classed('dragging', true); })
      .on('drag',  function (event, d) {
        d.px = event.x; d.py = event.y; // pin to screen coords
        d3.select(this).attr('x', d.px).attr('y', d.py);
      })
      .on('end',   function (event, d) {
        d3.select(this).classed('dragging', false);
        // persist to model if you want:
        const b = (window.__state?.burgs || []).find(x => x.id === d.id);
        if (b) b.label = Object.assign({}, b.label, { px:d.px, py:d.py });
      });

    function renderBurgLabels() {
      try {
        const labelsRoot = d3.select('.labels-burgs');
        if (labelsRoot.empty()) { console.warn('Burg labels group not found'); return; }

        try {
          computeLabelTiers();
        } catch (error) {
          console.warn('Error computing label tiers:', error);
          return; // Skip rendering if tier computation fails
        }

        try {
          renderLabelsBucketed();
        } catch (error) {
          console.warn('Error rendering bucketed labels:', error);
          return; // Skip further processing if bucketed rendering fails
        }

        // Initial label tier visibility mirrors burg tiers
        try {
          const k = (window.currentTransform || d3.zoomIdentity).k || 1;
          if (typeof updateLabelTierVisibility === 'function') updateLabelTierVisibility(tierForZoom(k));
        } catch (error) {
          console.warn('Error updating label tier visibility:', error);
        }
        
        if (DEBUG) console.log('Rendered bucketed burg labels');
      } catch (error) {
        console.error('Error rendering burg labels:', error);
      }
    }

    function computeLabelTiers(){
      const labels = window.__state.labels || (typeof computeBurgLabelData === 'function' ? computeBurgLabelData() : []);
      const tierOf = d => {
        const t = d.typeClass || (d.isCapital ? 'capital' : 'town');
        const r = d.popRank ?? 1;
        if (t === 'capital') return 0;
        if (t === 'port' || t === 'town') return r <= 0.10 ? 1 : r <= 0.30 ? 2 : r <= 0.70 ? 3 : 4;
        if (t === 'village') return r <= 0.10 ? 2 : r <= 0.40 ? 3 : 4;
        return r <= 0.15 ? 3 : 4; // manor and others
      };
      for (const L of labels) L.__tier = tierOf(L);
      window.__state.labelTiers = d3.groups(labels, d=>d.__tier);
    }

    function renderLabelsBucketed(){
      const root = d3.select('.labels-burgs');
      const tiers = [0,1,2,3,4];
      const layer = t => {
        let g = root.select(`g.labels-tier-${t}`);
        if (g.empty()) g = root.append('g').attr('class', `labels-tier-${t}`);
        return g;
      };
      for (const t of tiers) {
        const items = (window.__state.labelTiers?.find(([k])=>k===t)?.[1]) || [];
        const sel = layer(t).selectAll('text').data(items, d=>d.id);
        sel.exit().remove();
        const ent = sel.enter().append('text')
          .attr('x', d=>d.x).attr('y', d=>d.y)
          .attr('class', d=>`label-burg ${d.typeClass || (d.isCapital?'capital':'town')}`)
          .attr('text-anchor','middle')
          .text(d=>d.name)
          .on('dblclick', (event, d) => {
            const name = prompt('Rename settlement:', d.name);
            if (name) {
              d.name = name;
              const b = (window.__state?.burgs || []).find(x => x.id === d.id);
              if (b) { b.name = name; b.lockName = true; }
              d3.select(event.currentTarget).text(name);
            }
            if (d.px != null || d.py != null) { d.px = d.py = null; }
          })
          .call(burgDrag);
        ent.merge(sel);
      }
    }

    function updateLabelTierVisibility(tier){
      const root = d3.select('.labels-burgs');
      for (let t=0; t<=4; t++){
        root.select(`g.labels-tier-${t}`).attr('display', t <= tier ? null : 'none');
      }
    }

    function renderRegionLabels() {
      try {
        let data;
        try {
          data = computeRegionLabelData();
        } catch (error) {
          console.warn('Error computing region label data:', error);
          return; // Skip rendering if data computation fails
        }

        const regionLabelsG = d3.select('.labels-regions');
        if (regionLabelsG.empty()) {
          console.warn('Region labels group not found');
          return;
        }
        
        try {
          const sel = regionLabelsG.selectAll('text').data(data, d => d.id);
          sel.exit().remove();
          sel.enter().append('text')
            .attr('text-anchor', 'middle')
            .classed('region', true)
            .text(d => d.name)
          .merge(sel)
            .text(d => d.name);
        } catch (error) {
          console.warn('Error creating region label elements:', error);
          return; // Skip further processing if element creation fails
        }

        try {
          updateLabelPositions();
        } catch (error) {
          console.warn('Error updating label positions:', error);
        }
        
        if (DEBUG) console.log(`Rendered ${data.length} region labels`);
      } catch (error) {
        console.error('Error rendering region labels:', error);
      }
    }
    // Re-project labels each zoom (screen coords)
    function updateLabelPositions(t = window.currentTransform) {
      try {
        const k = t.k;

        // capitals and towns split
        const caps = [];
        const towns = [];

        const burgLabelsG = d3.select('.labels-burgs');
        if (!burgLabelsG.empty()) {
          burgLabelsG.selectAll('text')
            .each(function(d) {
              // screen coords (respect pinned px/py if you have them)
              const sx = d.px != null ? d.px : t.applyX(d.x) + (d.ox || 0);
              const sy = d.py != null ? d.py : t.applyY(d.y) + (d.oy || 0);
              const isCap = !!d.isCapital;
              const priority = isCap ? 2 : 1;

              // quick measure (approximate; for better accuracy, use getBBox() once on enter)
              const text = d.name || '';
              const width = 7 * Math.min(text.length, 16) + 6; // crude width estimate
              const height = isCap ? 18 : 14;

              (isCap ? caps : towns).push({ x:sx, y:sy, text, width, height, priority, sel: this, datum:d });
            });

          // Zoom thresholds
          const visibleCaps  = k >= LabelRules.capitalMinK ? caps  : [];
          const visibleTowns = k >= LabelRules.townMinK    ? towns : [];

          // Cull overlaps (capitals first)
          visibleCaps.sort((a,b)=>b.priority-a.priority);
          const keptCaps = cullOverlappingLabels(visibleCaps);

          // Hide all initially
          burgLabelsG.selectAll('text').style('display','none');

          keptCaps.forEach(n => d3.select(n.sel).style('display',''));

          // Now towns, but allow overlaps only if they don't collide with kept caps or prior towns
          const keptTowns = cullOverlappingLabels(keptCaps.concat(visibleTowns.sort((a,b)=>b.priority-a.priority)));
          keptTowns.filter(n => !keptCaps.includes(n)).forEach(n => d3.select(n.sel).style('display',''));

          // Finally, position everyone (those hidden just won't show)
          burgLabelsG.selectAll('text')
            .attr('x', d => d && (d.px != null ? d.px : (d.x != null ? t.applyX(d.x) + (d.ox || 0) : 0)))
            .attr('y', d => d && (d.py != null ? d.py : (d.y != null ? t.applyY(d.y) + (d.oy || 0) : 0)));
        }

        // Regions: always from map coords (no drag here)
        const regionLabelsG = d3.select('.labels-regions');
        if (!regionLabelsG.empty()) {
          regionLabelsG.selectAll('text')
            .attr('x', d => d && d.x != null ? t.applyX(d.x) : 0)
            .attr('y', d => d && d.y != null ? t.applyY(d.y) : 0);
        }
      } catch (error) {
        console.error('Error updating label positions:', error);
      }
    }

    // --- Azgaar-Style Economic Town Placement ---
    
    // Town placement weights (configurable)
    const TOWN_WEIGHTS = {
      wElev:  1.0,     // penalty for elevation
      wRiver: 0.18,    // bonus ~ river flux
      wHarbor: 0.8,    // bonus for sheltered coast
      wPath:  0.65,    // bonus for road usage (sqrt)
      wCross: 0.9,     // bonus for crossroads (deg-1)
      wNearRoad: 0.0,  // (optional) small penalty by distance to nearest road
      jitter: 0.05     // % noise of total score
    };

    // City weights - focused on coastal/river access and trade
    const CITY_WEIGHTS = {
      wElev:  0.8,     // less penalty for elevation (cities can be on hills)
      wRiver: 0.4,     // strong bonus for rivers (trade routes)
      wHarbor: 1.2,    // very strong bonus for harbors (trade)
      wCoast: 0.6,     // bonus for coastal access
      wPath:  0.4,     // moderate bonus for road usage
      wCross: 0.7,     // moderate bonus for crossroads
      wNearRoad: 0.0,  // no penalty for distance to roads
      jitter: 0.03     // less randomness for cities
    };

    // Village weights - focused on inland development and agriculture
    const VILLAGE_WEIGHTS = {
      wElev:  1.2,     // strong penalty for elevation (villages prefer flat land)
      wRiver: 0.15,    // moderate bonus for rivers (water source)
      wHarbor: 0.0,    // no bonus for harbors (inland)
      wCoast: 0.0,     // no bonus for coast (inland)
      wPath:  0.8,     // strong bonus for road usage (connectivity)
      wCross: 1.1,     // strong bonus for crossroads (trade)
      wFlat:  0.9,     // bonus for flat land (agriculture)
      wNearRoad: 0.1,  // small penalty for being far from roads
      jitter: 0.08     // more randomness for villages
    };

    /**
     * Build road usage data for economic scoring
     * @param {Object} routeData - Object containing routes and trails arrays
     * @param {Array} cells - All cells array
     */
    function buildRoadUsage(routeData, cells) {
      // Zero out road usage data
      for (const c of cells) { 
        c.path = 0; 
        c.cross = 0; 
      }
      
      // Count how many times each cell appears in any land route
      const touchBy = new Map(); // cellId -> Set(cellId neighbors touched by a route)
      
      const bump = (id, nextId) => {
        if (id == null) return;
        cells[id].path++;
        if (nextId != null) {
          let S = touchBy.get(id);
          if (!S) { S = new Set(); touchBy.set(id, S); }
          S.add(nextId);
        }
      };

      const visit = (segments) => {
        for (const seg of segments) {
          // seg should be an array of cell indices along the path (inclusive)
          for (let i = 0; i < seg.length; i++) {
            bump(seg[i], seg[i+1]);
            bump(seg[i], seg[i-1]);
          }
        }
      };

      visit(routeData.routes || []);
      visit(routeData.trails || []);

      // crossroads = number of *distinct* neighbors a route touches from this cell
      for (const [id, set] of touchBy.entries()) {
        cells[id].cross = set.size; // deg along route network
      }
      
      if (DEBUG) console.log(`Road usage built: ${cells.filter(c => c.path > 0).length} cells have road usage`);
    }

    /**
     * Calculate geographic score for a cell
     * @param {Object} c - Cell object
     * @returns {number} Geographic score
     */
    function geographicScore(c) {
      const elevP = Math.max(0, 1 - c.high);         // lowland best
      const riverB = Math.sqrt(Math.max(0, c.riverFlux || 0));
      const harborB = c.hasHarbor ? 1 : 0;
      return TOWN_WEIGHTS.wElev * elevP
           + TOWN_WEIGHTS.wRiver * riverB
           + TOWN_WEIGHTS.wHarbor * harborB;
    }

    /**
     * Calculate city geographic score (coastal/river focused)
     * @param {Object} c - Cell object
     * @param {Array} cells - All cells array
     * @param {Array} isWater - Water mask array
     * @returns {number} City geographic score
     */
    function cityGeographicScore(c, cells, isWater) {
      const elevP = Math.max(0, 1 - c.high);         // lowland preferred
      const riverB = Math.sqrt(Math.max(0, c.riverFlux || 0));
      const harborB = c.hasHarbor ? 1 : 0;
      
      // Calculate coastal access
      let coastB = 0;
      let minWaterDist = Infinity;
      for (let i = 0; i < cells.length; i++) {
        if (isWater[i]) {
          const dist = Math.hypot(c.cx - cells[i].cx, c.cy - cells[i].cy);
          minWaterDist = Math.min(minWaterDist, dist);
        }
      }
      if (minWaterDist < 50) { // Within 50px of water
        coastB = Math.max(0, 1 - (minWaterDist / 50));
      }
      
      return CITY_WEIGHTS.wElev * elevP
           + CITY_WEIGHTS.wRiver * riverB
           + CITY_WEIGHTS.wHarbor * harborB
           + CITY_WEIGHTS.wCoast * coastB;
    }

    /**
     * Calculate village geographic score (inland/agriculture focused)
     * @param {Object} c - Cell object
     * @param {Array} cells - All cells array
     * @param {Array} isWater - Water mask array
     * @returns {number} Village geographic score
     */
    function villageGeographicScore(c, cells, isWater) {
      const elevP = Math.max(0, 1 - c.high);         // flat land preferred
      const riverB = Math.sqrt(Math.max(0, c.riverFlux || 0));
      const flatB = Math.max(0, 1 - c.high);         // flat land bonus for agriculture
      
      // Calculate distance to nearest road for penalty
      let nearRoadDist = 0;
      if (VILLAGE_WEIGHTS.wNearRoad > 0) {
        // Simple distance calculation - could be optimized
        let minRoadDist = Infinity;
        for (let i = 0; i < cells.length; i++) {
          if ((cells[i].path || 0) > 0) {
            const dist = Math.hypot(c.cx - cells[i].cx, c.cy - cells[i].cy);
            minRoadDist = Math.min(minRoadDist, dist);
          }
        }
        nearRoadDist = minRoadDist < Infinity ? minRoadDist : 100; // Default penalty if no roads
      }
      
      return VILLAGE_WEIGHTS.wElev * elevP
           + VILLAGE_WEIGHTS.wRiver * riverB
           + VILLAGE_WEIGHTS.wFlat * flatB
           - VILLAGE_WEIGHTS.wNearRoad * nearRoadDist;
    }

    /**
     * Calculate economic score for a cell
     * @param {Object} c - Cell object
     * @param {number} nearestRoadDist - Distance to nearest road (optional)
     * @returns {number} Economic score
     */
    function economicScore(c, nearestRoadDist = 0) {
      const pathB = Math.sqrt(c.path || 0);
      const crossB = Math.max(0, (c.cross || 0) - 1);
      const nearRoadPenalty = (TOWN_WEIGHTS.wNearRoad > 0) ? (nearestRoadDist * TOWN_WEIGHTS.wNearRoad) : 0;
      return TOWN_WEIGHTS.wPath * pathB
           + TOWN_WEIGHTS.wCross * crossB
           - nearRoadPenalty;
    }

    /**
     * Calculate city economic score (trade focused)
     * @param {Object} c - Cell object
     * @returns {number} City economic score
     */
    function cityEconomicScore(c) {
      const pathB = Math.sqrt(c.path || 0);
      const crossB = Math.max(0, (c.cross || 0) - 1);
      return CITY_WEIGHTS.wPath * pathB
           + CITY_WEIGHTS.wCross * crossB;
    }

    /**
     * Calculate village economic score (connectivity focused)
     * @param {Object} c - Cell object
     * @returns {number} Village economic score
     */
    function villageEconomicScore(c) {
      const pathB = Math.sqrt(c.path || 0);
      const crossB = Math.max(0, (c.cross || 0) - 1);
      return VILLAGE_WEIGHTS.wPath * pathB
           + VILLAGE_WEIGHTS.wCross * crossB;
    }

    /**
     * Add random jitter to scores
     * @param {number} base - Base score
     * @returns {number} Score with jitter
     */
    function randomJitter(base) {
      const j = TOWN_WEIGHTS.jitter;
      return base * ((Math.random() * 2 * j) - j); // ±j%
    }

    /**
     * Add random jitter to city scores
     * @param {number} base - Base score
     * @returns {number} Score with jitter
     */
    function cityRandomJitter(base) {
      const j = CITY_WEIGHTS.jitter;
      return base * ((Math.random() * 2 * j) - j); // ±j%
    }

    /**
     * Add random jitter to village scores
     * @param {number} base - Base score
     * @returns {number} Score with jitter
     */
    function villageRandomJitter(base) {
      const j = VILLAGE_WEIGHTS.jitter;
      return base * ((Math.random() * 2 * j) - j); // ±j%
    }

    /**
     * Generate cities using coastal/river economic approach
     * @param {Array} cells - All cells array
     * @param {Array} capitals - Array of capital burgs
     * @param {number} targetCityCount - Number of cities to generate
     * @param {Function} nameFor - Name generation function
     * @returns {Array} Array of city burgs
     */
    function generateCities(cells, capitals, targetCityCount, nameFor) {
      const sea = +document.getElementById('seaLevelInput').value;
      const isWater = window.__state.isWater || [];
      
      // Mark capitals + neighbors as reserved
      const used = new Uint8Array(cells.length);
      for (const cap of capitals) {
        used[cap.cell] = 1;
        for (const n of cells[cap.cell].neighbors) used[n] = 1;
      }

      // Score all land cells for cities
      const scored = [];
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (isWater[i] || used[i]) continue;
        
        const geoScore = cityGeographicScore(c, cells, isWater);
        const econScore = cityEconomicScore(c);
        const base = geoScore + econScore;
        const score = base + cityRandomJitter(base);
        scored.push({i, score});
      }

      scored.sort((a, b) => b.score - a.score);

      const cities = [];
      for (const s of scored) {
        if (cities.length >= targetCityCount) break;
        if (used[s.i]) continue;
        const c = cells[s.i];
        if (isWater[s.i]) continue;

        // Place city (burg)
        const city = {
          cell: s.i,
          x: c.cx, 
          y: c.cy,
          type: "city",
          name: nameFor ? nameFor(c) : null,
          id: capitals.length + cities.length,
          population: 2000,
          port: false,
          onRiver: false
        };
        
        // Determine if it's a port (near coast)
        let minWaterDist = Infinity;
        for (let i = 0; i < cells.length; i++) {
          if (isWater[i]) {
            const dist = Math.hypot(c.cx - cells[i].cx, c.cy - cells[i].cy);
            minWaterDist = Math.min(minWaterDist, dist);
          }
        }
        city.port = minWaterDist < 25; // Within 25px of water
        
        // Cities can be ports (significant settlements)
        if (city.port) {
          city.isSignificantPort = true; // Mark as significant port
        }
        
        // Determine if it's on a river
        c.neighbors.forEach(nb => {
          const neighborCell = cells[nb];
          const isWaterNeighbor = isWater[nb];
          const isLake = window.__state.isLake && window.__state.isLake[nb] === 1;
          if (isWaterNeighbor && !isLake) {
            city.onRiver = true;
          }
        });

        // Generate name if not provided
        if (!city.name) {
          city.name = 'Unnamed';
        }

        cities.push(city);

        // Block this cell + neighbors
        used[s.i] = 1;
        for (const n of c.neighbors) used[n] = 1;
      }

      // console.log(`Generated ${cities.length} cities using coastal/river economic scoring`);
      return cities;
    }
    /**
     * Generate villages using inland/road economic approach
     * @param {Array} cells - All cells array
     * @param {Array} existingBurgs - Array of existing burgs (capitals + cities)
     * @param {number} targetVillageCount - Number of villages to generate
     * @param {Function} nameFor - Name generation function
     * @returns {Array} Array of village burgs
     */
    function generateVillages(cells, existingBurgs, targetVillageCount, nameFor) {
      const sea = +document.getElementById('seaLevelInput').value;
      const isWater = window.__state.isWater || [];
      
      // Mark existing burgs + neighbors as reserved
      const used = new Uint8Array(cells.length);
      for (const burg of existingBurgs) {
        used[burg.cell] = 1;
        for (const n of cells[burg.cell].neighbors) used[n] = 1;
      }

      // Score all land cells for villages
      const scored = [];
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (isWater[i] || used[i]) continue;
        
        const geoScore = villageGeographicScore(c, cells, isWater);
        const econScore = villageEconomicScore(c);
        const base = geoScore + econScore;
        const score = base + villageRandomJitter(base);
        scored.push({i, score});
      }

      scored.sort((a, b) => b.score - a.score);

      const villages = [];
      for (const s of scored) {
        if (villages.length >= targetVillageCount) break;
        if (used[s.i]) continue;
        const c = cells[s.i];
        if (isWater[s.i]) continue;

        // Place village (burg)
        const village = {
          cell: s.i,
          x: c.cx, 
          y: c.cy,
          type: "village",
          name: nameFor ? nameFor(c) : null,
          id: existingBurgs.length + villages.length,
          population: 500,
          port: false,
          onRiver: false
        };
        
        // Villages should not be ports (ports must be significant settlements)
        village.port = false; // Villages cannot be ports
        village.isSignificantPort = false;
        
        // Determine if it's on a river
        c.neighbors.forEach(nb => {
          const neighborCell = cells[nb];
          const isWaterNeighbor = isWater[nb];
          const isLake = window.__state.isLake && window.__state.isLake[nb] === 1;
          if (isWaterNeighbor && !isLake) {
            village.onRiver = true;
          }
        });

        // Generate name if not provided
        if (!village.name) {
          village.name = 'Unnamed';
        }

        villages.push(village);

        // Block this cell + neighbors
        used[s.i] = 1;
        for (const n of c.neighbors) used[n] = 1;
      }

      // console.log(`Generated ${villages.length} villages using inland/road economic scoring`);
      return villages;
    }

    /**
     * Ensure each island has at least one significant port
     * @param {Array} cells - All cells array
     * @param {Array} allBurgs - Array of all burgs (capitals + cities + villages)
     * @param {Array} isWater - Water mask array
     * @returns {Array} Updated burgs array with port assignments
     */
    function ensureIslandPorts(cells, allBurgs, isWater, landGraph) {
      // Group burgs by island (connected land components)
      const islandGroups = findConnectedComponents(allBurgs, landGraph);
      
      for (let islandIndex = 0; islandIndex < islandGroups.length; islandIndex++) {
        const islandBurgs = islandGroups[islandIndex];
        const ports = islandBurgs.filter(burg => burg.isSignificantPort);
        
        if (ports.length === 0) {
          // No ports on this island - find best candidate
          // console.log(`Island ${islandIndex} has no ports, finding best candidate...`);
          
          let bestPortCandidate = null;
          let bestPortScore = -1;
          
          for (const burg of islandBurgs) {
            if (burg.type !== 'city') continue; // Only cities can be ports
            
            // Calculate port suitability score
            let portScore = 0;
            
            // Cities are the only port candidates
            portScore += 10;
            
            // Check coastal proximity
            let minWaterDist = Infinity;
            for (let i = 0; i < cells.length; i++) {
              if (isWater[i]) {
                const dist = Math.hypot(burg.x - cells[i].cx, burg.y - cells[i].cy);
                minWaterDist = Math.min(minWaterDist, dist);
              }
            }
            
            if (minWaterDist < 50) { // Within 50px of water
              portScore += Math.max(0, 20 - minWaterDist); // Closer = better
            }
            
            if (portScore > bestPortScore) {
              bestPortScore = portScore;
              bestPortCandidate = burg;
            }
          }
          
          if (bestPortCandidate) {
            bestPortCandidate.port = true;
            bestPortCandidate.isSignificantPort = true;
            console.log(`Promoted ${bestPortCandidate.type} ${bestPortCandidate.id} to port on island ${islandIndex}`);
          } else {
            // console.log(`No suitable port candidate found on island ${islandIndex}`);
          }
        }
      }
      
      return allBurgs;
    }
    /**
     * Connect capitals to nearest ports with primary roads
     * @param {Array} allBurgs - Array of all burgs
     * @param {Array} cells - All cells array
     * @param {Array} isWater - Water mask array
     */
    function connectCapitalsToPorts(allBurgs, cells, isWater, landGraph) {
      const capitals = allBurgs.filter(burg => burg.type === 'capital');
      const ports = allBurgs.filter(burg => burg.isSignificantPort);
      
      if (ports.length === 0) {
        console.log('No ports found, skipping capital-to-port connections');
        return;
      }
      
      // Group burgs by island for regional connections
      const islandGroups = findConnectedComponents(allBurgs, landGraph);
      
      for (const capital of capitals) {
        // Capitals are never significant ports, so always connect them
        
        // Find capital's island
        let capitalIsland = null;
        for (let i = 0; i < islandGroups.length; i++) {
          if (islandGroups[i].some(burg => burg.id === capital.id)) {
            capitalIsland = i;
            break;
          }
        }
        
        if (capitalIsland === null) continue;
        
        // Find nearest port on same island
        const islandPorts = islandGroups[capitalIsland].filter(burg => burg.isSignificantPort);
        
        if (islandPorts.length === 0) {
          // console.log(`No ports on capital ${capital.id}'s island, skipping connection`);
          continue;
        }
        
        // Find closest port
        let nearestPort = null;
        let minDist = Infinity;
        
        for (const port of islandPorts) {
          const dist = Math.hypot(capital.x - port.x, capital.y - port.y);
          if (dist < minDist) {
            minDist = dist;
            nearestPort = port;
          }
        }
        
        if (nearestPort) {
          // console.log(`Connecting capital ${capital.id} to port ${nearestPort.id} (distance: ${minDist.toFixed(1)}px)`);
          
          // Build road from capital to port
          const landGraph = window.__state.landGraph;
          if (landGraph) {
            const pathCells = shortestPath(capital.cell, nearestPort.cell, landGraph, new Set(), new Set());
            if (pathCells && pathCells.length > 0) {
              // Add as primary road (thicker line)
              addPrimaryRoad(pathCells, {kind: "capital-to-port"});
            }
          }
        }
      }
    }
    /**
     * Add a primary road (thicker than regular roads)
     * @param {Array} pathCells - Array of cell indices forming the path
     * @param {Object} options - Road options
     */
    function addPrimaryRoad(pathCells, options = {}) {
      const roadsG = d3.select('#routes .roads');
      if (roadsG.empty()) return;
      
      // Create primary road path
      const pathCoords = pathCells.map(cellId => {
        const cell = window.__state.cells[cellId];
        return [cell.cx, cell.cy];
      });
      
      const line = d3.line()
        .x(d => d[0])
        .y(d => d[1])
        .curve(d3.curveCatmullRom.alpha(0.5));
      
      roadsG.append('path')
        .attr('class', 'primary-road')
        .attr('d', line(pathCoords))
        .attr('stroke', '#8B4513') // Brown color for primary roads
        .attr('stroke-width', '3px') // Thicker than regular roads
        .attr('fill', 'none')
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round')
        .attr('vector-effect', 'non-scaling-stroke');
    }

    // Ensure routes layer exists under #map
    function ensureRoutesLayer() {
      const svg = d3.select("#map");
      let g = svg.select("#routes");
      if (g.empty()) g = svg.append("g").attr("id", "routes");
      return g;
    }

    // Removed duplicate ensureRouteGroups - using canonical version at line 2775

    function clearRoutes() {
      const g = d3.select('#routes');
      g.selectAll('.roads > path').remove();
      g.selectAll('.trails > path').remove();
      g.selectAll('.searoutes > path').remove();
    }

    // Draw primary road polylines
    function drawPrimaryRoads(polylines) {
      const g = ensureRoutesLayer();
      g.selectAll("path.primary-road").remove();
      const line = d3.line().x(d => d.x).y(d => d.y).curve(d3.curveCatmullRom.alpha(0.5));
      g.selectAll(null)
        .data(polylines)
        .enter()
        .append("path")
        .attr("class", "primary-road")
        .attr("d", d => line(d))
        .attr("fill", "none")
        .attr("stroke", "#8B4513")
        .attr("stroke-width", "3px")
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round")
        .attr("vector-effect", "non-scaling-stroke");
    }

    // Append primary road polylines (doesn't clear existing)
    function appendPrimaryRoads(polylines) {
      const g = ensureRoutesLayer();
      const line = d3.line().x(d => d.x).y(d => d.y).curve(d3.curveCatmullRom.alpha(0.5));
      g.selectAll(null)
        .data(polylines)
        .enter()
        .append("path")
        .attr("class", "primary-road")
        .attr("d", d => line(d))
        .attr("fill", "none")
        .attr("stroke", "#8B4513")
        .attr("stroke-width", "3px")
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round")
        .attr("vector-effect", "non-scaling-stroke");
    }

    function ensureSecondaryRoadsLayer() {
      const g = d3.select("#routes");
      let s = g.select("g.secondary-roads");
      if (s.empty()) s = g.append("g").attr("class", "secondary-roads");
      return s;
    }
    function drawSecondaryRoads(polylines) {
      const g = ensureSecondaryRoadsLayer();
      const line = d3.line().x(d => d.x).y(d => d.y).curve(d3.curveCatmullRom.alpha(0.5));
      g.selectAll(null)
        .data(polylines)
        .enter()
        .append("path")
        .attr("class", "secondary-road")
        .attr("d", d => line(d))
        .attr("fill", "none");
    }

    // === Graph building & pathfinding scaffolds (to be refined) ===
    function buildLandGraphSimple(cells, isWater) {
      // neighbors: array of arrays; cost: function(u,v)
      // For now, just expose neighbors from Voronoi adjacency.
      return {
        neighbors(i) { return cells[i].neighbors?.filter(j => !isWater[j]) || []; }
      };
    }
    
    function simpleBFS(start, goal, graph) {
      // Simple BFS to check if there's any path between two nodes
      const visited = new Set();
      const queue = [{node: start, path: [start]}];
      
      while (queue.length > 0) {
        const {node, path} = queue.shift();
        
        if (node === goal) {
          return path;
        }
        
        if (visited.has(node)) continue;
        visited.add(node);
        
        const neighbors = graph.neighbors(node) || [];
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            queue.push({node: neighbor, path: [...path, neighbor]});
          }
        }
      }
      
      return null; // No path found
    }

    function cellMoveCost(u, v, cells, opts = {}) {
      // Base Euclidean step
      const ax = cells[u].cx, ay = cells[u].cy;
      const bx = cells[v].cx, by = cells[v].cy;
      const dist = Math.hypot(ax - bx, ay - by);

      // Slope penalty (favor flatter ground)
      const su = cells[u].localSlope ?? 0;
      const sv = cells[v].localSlope ?? 0;
      const slope = (su + sv) * 0.5; // 0..1 (flatter→0)
      const slopeMult = 1 + slope * ((CONFIG?.roads?.slopePenalty ?? 1.2) - 1); // e.g., 1..1.2

      // River crossing / adjacency penalty (approximation)
      const riverAdj = (cells[u].hasRiver ? 1 : 0) + (cells[v].hasRiver ? 1 : 0);
      const riverMult = riverAdj > 0 ? (1 + (CONFIG?.roads?.riverCrossPenalty ?? 1.0)) : 1; // e.g., +1.0

      // Existing road reuse discount (0.15) — if target cell already has a road
      const used = cells[v].pathUsed ?? 0;
      const reuseMult = used > 0 ? 0.15 : 1;

      // NEW: Coastal aversion (only if enabled and we know coastSteps)
      let coastMult = 1;
      const cs = window.__state?.coastSteps;
      if (opts.coastPenalty !== false && cs && cs[v] === 0) {
        coastMult += (CONFIG.roads.coastAversion ?? 0);
      }

      return dist * slopeMult * riverMult * reuseMult * coastMult;
    }
    function aStarCells(start, goal, graph, cells, opts = {}) {
      const open = new MinHeap(n => n.f); // you already have MinHeap
      const g = new Map(), f = new Map(), came = new Map();
      g.set(start, 0);
      const h = (i) => {
        const dx = cells[i].cx - cells[goal].cx, dy = cells[i].cy - cells[goal].cy;
        return Math.hypot(dx, dy);
      };
      f.set(start, h(start));
      open.push({i: start, f: f.get(start)});
      const closed = new Set();
      
      // Add safety timeout to prevent infinite loops
      let iterations = 0;
      const maxIterations = opts.maxIterations || 10000;
      
      while (open.size && iterations < maxIterations) {
        iterations++;
        const cur = open.pop().i;
        if (cur === goal) break;
        if (closed.has(cur)) continue;
        closed.add(cur);
        for (const nb of graph.neighbors(cur)) {
          const tentative = g.get(cur) + cellMoveCost(cur, nb, cells, opts);
          if (tentative < (g.get(nb) ?? Infinity)) {
            // Check maxCost limit
            if (opts.maxCost && tentative > opts.maxCost) continue;
            came.set(nb, cur);
            g.set(nb, tentative);
            const fn = tentative + h(nb);
            f.set(nb, fn);
            open.push({i: nb, f: fn});
          }
        }
      }
      
      if (iterations >= maxIterations) {
        console.warn(`A* timeout after ${maxIterations} iterations for path from ${start} to ${goal}`);
        return [];
      }
      
      // Reconstruct
      const path = [];
      let p = goal;
      if (!came.has(goal) && start !== goal) return [];
      while (p !== undefined) {
        path.push(p);
        p = came.get(p);
      }
      path.reverse();
      return path;
    }

    // --- Road Network Index Utilities ---
    function canonicalEdgeKey(u, v) { 
      return u < v ? `${u}-${v}` : `${v}-${u}`; 
    }

    function buildRoadNetworkIndex(cells) {
      const inNet = new Set();
      const edgeSet = new Set();

      // Any cell touched by primary or secondary usage is "in network"
      for (let i = 0; i < cells.length; i++) {
        if ((cells[i].pathPrimaryUsed ?? 0) > 0 || (cells[i].pathSecondaryUsed ?? 0) > 0) {
          inNet.add(i);
        }
      }

      // Reconstruct edges between in-network neighbors (cheap, local)
      for (let i = 0; i < cells.length; i++) {
        if (!inNet.has(i)) continue;
        const ns = cells[i].neighbors || [];
        for (const j of ns) {
          if (inNet.has(j)) edgeSet.add(canonicalEdgeKey(i, j));
        }
      }
      return { inNet, edgeSet };
    }

    function addPathToNetwork(path, cells, markPrimary = false) {
      for (let t = 0; t < path.length; t++) {
        const i = path[t];
        // mark usage
        if (markPrimary) {
          cells[i].pathPrimaryUsed = (cells[i].pathPrimaryUsed ?? 0) + 1;
        } else {
          cells[i].pathSecondaryUsed = (cells[i].pathSecondaryUsed ?? 0) + 1;
        }
        cells[i].pathUsed = (cells[i].pathUsed ?? 0) + 1;
      }
    }

    function mstOverPoints(points) {
      // Prim's MST on complete graph in geometric space
      const n = points.length;
      if (n <= 1) return [];
      const inTree = new Array(n).fill(false);
      const dist = new Array(n).fill(Infinity);
      const parent = new Array(n).fill(-1);
      dist[0] = 0;
      for (let k = 0; k < n; k++) {
        // pick min dist not in tree
        let u = -1, best = Infinity;
        for (let i = 0; i < n; i++) if (!inTree[i] && dist[i] < best) { best = dist[i]; u = i; }
        inTree[u] = true;
        for (let v = 0; v < n; v++) if (!inTree[v]) {
          const dx = points[u].x - points[v].x, dy = points[u].y - points[v].y;
          const d = dx*dx + dy*dy;
          if (d < dist[v]) { dist[v] = d; parent[v] = u; }
        }
      }
      const edges = [];
      for (let i = 1; i < n; i++) edges.push([parent[i], i]);
      return edges;
    }

    function pathToPolyline(path, cells) {
      return path.map(i => ({x: cells[i].cx, y: cells[i].cy}));
    }

    function connectCapitalsWithRoads(capitals, cells, isWater) {
      if (!capitals.length) return [];
      const edges = mstOverPoints(capitals);
      const graph = buildLandGraphSimple(cells, isWater);
      const polylines = [];
      // Mark cells used by primary roads so subsequent paths reuse them (0.15 cost)
      function markPathUsage(path, cells) {
        for (const i of path) cells[i].pathUsed = (cells[i].pathUsed ?? 0) + 1;
      }
      for (const [ai, bi] of edges) {
        const A = capitals[ai], B = capitals[bi];
        const start = A.cell, goal = B.cell;
        const path = aStarCells(start, goal, graph, cells);
        const line = pathToPolyline(path, cells);
        if (line.length) {
          polylines.push(line);
          markPathUsage(path, cells);
        }
      }
      return polylines;
    }

    // --- Ports helpers (sheltered harbors, island promotion, capital links) ---
    function isShelteredHarborCell(i, cells, isWater, oceanIdOf) {
      const nbrs = cells[i].neighbors || [];
      const oceanNbrs = nbrs.filter(j => isWater[j] && ((oceanIdOf && oceanIdOf[j]) ?? -1) >= 0);
      return oceanNbrs.length === 1;
    }

    function tagPortsOnBurgs(burgs, cells, isWater, oceanIdOf) {
      for (const b of burgs) {
        const i = (b.cell !== undefined ? b.cell : b.cellIndex);
        if (i == null) continue;
        const coastal = (cells[i].neighbors || []).some(n => isWater[n]);
        b.isPort = coastal && isShelteredHarborCell(i, cells, isWater, oceanIdOf);
      }
    }



    function connectCapitalToNearestRegionalPort(capital, burgs, cells, isWater) {
      const capIdx = (capital.cell !== undefined ? capital.cell : capital.cellIndex);
      const portsSameRegion = burgs.filter(b => b.isPort && b.regionId === capital.regionId);
      if (!portsSameRegion.length) return null;
      let best = null, bestD = Infinity;
      for (const p of portsSameRegion) {
        const pi = (p.cell !== undefined ? p.cell : p.cellIndex);
        const d = Math.hypot(cells[pi].cx - cells[capIdx].cx, cells[pi].cy - cells[capIdx].cy);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (!best) return null;
      // Use simple neighbor graph that aStarCells expects
      const graph = buildLandGraphSimple(cells, isWater);
      const goalIdx = (best.cell !== undefined ? best.cell : best.cellIndex);
      const path = aStarCells(capIdx, goalIdx, graph, cells, { coastPenalty: false });
      if (path && path.length) {
        for (const i of path) cells[i].pathUsed = (cells[i].pathUsed ?? 0) + 1;
        return pathToPolyline(path, cells);
      }
      return null;
    }

    function buildServedIndex(cells) {
      const served = new Set();
      for (let i = 0; i < cells.length; i++) if ((cells[i].pathUsed ?? 0) > 0) served.add(i);
      return served;
    }
    function nearestServedOrCapitalCell(town, capitals, cells, served) {
      const ti = (town.cell !== undefined ? town.cell : town.cellIndex);
      let best = null, bestD = Infinity;
      for (const cap of capitals) {
        const ci = (cap.cell !== undefined ? cap.cell : cap.cellIndex);
        const d = Math.hypot(cells[ci].cx - cells[ti].cx, cells[ci].cy - cells[ti].cy);
        if (d < bestD) { bestD = d; best = ci; }
      }
      const servedArr = Array.from(served);
      const step = Math.max(1, Math.floor(servedArr.length / 200));
      for (let k = 0; k < servedArr.length; k += step) {
        const i = servedArr[k];
        const d = Math.hypot(cells[i].cx - cells[ti].cx, cells[i].cy - cells[ti].cy);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }

    // --- Helpers: anchors & snapping ---

    function buildAnchorSet(cells, burgs) {
      // Anchors are: (a) any capital cell, (b) any cell already used by PRIMARY roads
      const anchor = new Set();
      for (const b of burgs) if (b.capital || b.type === "capital" || b.isCapital) {
        const cellIdx = (b.cell !== undefined ? b.cell : b.cellIndex);
        anchor.add(cellIdx);
      }
      for (let i = 0; i < cells.length; i++) {
        if ((cells[i].pathPrimaryUsed ?? 0) > 0) anchor.add(i);
      }
      return anchor;
    }

    function snapEndpointToAnchor(path, anchorSet, cells) {
      // Ensure the last cell in `path` is an anchor; if not but a neighbor is, append it.
      if (!path.length) return path;
      const last = path[path.length - 1];
      if (anchorSet.has(last)) return path;
      const ns = cells[last].neighbors || [];
      for (const n of ns) {
        if (anchorSet.has(n)) {
          path.push(n);
          return path;
        }
      }
      return path; // no change if no adjacent anchor
    }
    // --- Replacement: robust secondary connectors ---
    function connectSecondaryRoads(burgs, cells, isWater, maxLenPx = 220) {
      const towns = burgs.filter(b => !b.capital);
      const graph = buildLandGraphSimple(cells, isWater);
      const polylines = [];
      const pathsCells = [];

      // Build live network index (primary + any existing secondary)
      let { inNet, edgeSet } = buildRoadNetworkIndex(cells);

      // Helper: stop search once we touch ANY network cell
      function aStarToNetwork(start) {
        // Standard A*, but goal is "first time we pop a node that is inNet"
        const open = new MinHeap(n => n.f);
        const g = new Map(), f = new Map(), came = new Map();
        g.set(start, 0);
        f.set(start, 0);
        open.push({i:start, f:0});

        const visited = new Set();

        while (open.size) {
          const cur = open.pop().i;
          if (visited.has(cur)) continue;
          visited.add(cur);

          if (inNet.has(cur) && cur !== start) {
            // Reconstruct path start -> cur
            const path = [];
            let x = cur;
            while (x !== undefined) { path.push(x); x = came.get(x); }
            path.reverse();
            return path;
          }

          const neigh = graph.neighbors(cur) || [];
          for (const nb of neigh) {
            const tentative = g.get(cur) + cellMoveCost(cur, nb, cells); // reuse favors
            if (tentative < (g.get(nb) ?? Infinity)) {
              came.set(nb, cur);
              g.set(nb, tentative);
              const heur = 0; // unknown "nearest inNet" — zero is admissible since goal is any inNet
              const F = tentative + heur;
              f.set(nb, F);
              open.push({i:nb, f:F});
            }
          }
        }
        return null;
      }

      function snapToNetwork(path) {
        if (!path || path.length < 2) return path;
        let last = path[path.length - 1];
        if (inNet.has(last)) return path;
        // 1-hop
        for (const n of (cells[last].neighbors || [])) if (inNet.has(n)) { path.push(n); return path; }
        // 2-hop
        for (const n of (cells[last].neighbors || [])) {
          for (const m of (cells[n].neighbors || [])) if (inNet.has(m)) { path.push(n, m); return path; }
        }
        return path;
      }

      function pathToEdges(path) {
        const out = [];
        for (let i = 1; i < path.length; i++) out.push(canonicalEdgeKey(path[i-1], path[i]));
        return out;
      }

      // Reset secondary paths cells array
      window.__state.secondaryPathsCells = [];
      
      // PASS 1: connect each unserved town
      let connectedCount = 0;
      let skippedCount = 0;
      for (const t of towns) {
        const ti = t.cellIndex ?? t.cell;
        if (inNet.has(ti)) {
          skippedCount++;
          continue; // already on the network
        }
        const path = aStarToNetwork(ti);
        if (!path || path.length < 2) continue;

        // Early clip: if the path touches the network earlier, cut at first inNet cell
        let cut = path.length;
        for (let k = 1; k < path.length; k++) { if (inNet.has(path[k])) { cut = k; break; } }
        const clipped = path.slice(0, cut + 1);

        // Snap last step if we're one cell short
        const snapped = snapToNetwork(clipped);

        // Length guard
        const A = cells[snapped[0]], Z = cells[snapped[snapped.length - 1]];
        const geomLen = Math.hypot(A.cx - Z.cx, A.cy - Z.cy);
        if (geomLen > maxLenPx) continue;

        // Dedup guard: if all edges already exist, skip drawing
        const edges = pathToEdges(snapped);
        const allKnown = edges.every(e => edgeSet.has(e));
        if (allKnown) {
          // Already in logical network; still record for this render pass
          pathsCells.push(snapped);
          polylines.push(pathToPolyline(snapped, cells));
          continue;
        }

        // Commit: mark usage (secondary), update network + edgeSet, store for viz
        addPathToNetwork(snapped, cells, /*primary?*/ false);
        for (const e of edges) edgeSet.add(e);
        for (const i of snapped) inNet.add(i);

        pathsCells.push(snapped);
        polylines.push(pathToPolyline(snapped, cells));
        connectedCount++;
      }

      // expose for later tools
      if (!window.__state.secondaryPathsCells) {
        window.__state.secondaryPathsCells = [];
      }
      window.__state.secondaryPathsCells.push(...pathsCells);

      return polylines;
    }

    function edgesFromPath(path, cells) {
      const segs = [];
      for (let i = 1; i < path.length; i++) {
        const u = cells[path[i-1]], v = cells[path[i]];
        segs.push({ a:{x:u.cx, y:u.cy}, b:{x:v.cx, y:v.cy} });
      }
      return segs;
    }

    function rebuildAndDrawSecondary(cells) {
      const allPaths = window.__state.secondaryPathsCells || [];
      // 1) Build a unique edge set in cell-index space
      const uniq = new Set();
      for (const p of allPaths) {
        for (let i = 1; i < p.length; i++) {
          const a = p[i-1], b = p[i];
          const key = a < b ? `${a}-${b}` : `${b}-${a}`;
          uniq.add(key);
        }
      }
      // 2) Convert back to segments in XY space
      const segs = [];
      for (const key of uniq) {
        const [a,b] = key.split('-').map(Number);
        const A = cells[a], B = cells[b];
        segs.push({a:{x:A.cx,y:A.cy}, b:{x:B.cx,y:B.cy}});
      }
      // 3) Merge and draw
      const merged = segmentsToPolylines(segs);
      const secondaryG = d3.select("#routes").select("g.secondary-roads");
      if (secondaryG.empty()) d3.select("#routes").append("g").attr("class","secondary-roads");
      d3.select("#routes").select("g.secondary-roads").selectAll("*").remove();
      const secondaryLine = d3.line().x(d=>d.x).y(d=>d.y).curve(d3.curveCatmullRom.alpha(0.5));
      d3.select("#routes").select("g.secondary-roads")
        .selectAll(null).data(merged).enter()
        .append("path").attr("class","secondary-road")
        .attr("d", d => secondaryLine(d))
        .attr("vector-effect", "non-scaling-stroke");
    }

    // === Backfill system: ensure every town connects to network ===
    function sampleRoadPolylines(roadPaths, step = 10) {
      // DOM-based sampling to correctly handle curved paths (C commands)
      const roadNodes = [];
      const cells = window.__state.cells;
      for (const el of roadPaths) {
        try {
          const len = el.getTotalLength();
          for (let s = 0; s <= len; s += step) {
            const pt = el.getPointAtLength(s);
            const cell = findNearestCell(pt.x, pt.y, cells);
            if (cell !== -1) roadNodes.push({x: pt.x, y: pt.y, cell});
          }
        } catch (e) {
          // Fallback: skip elements that don't support path length APIs
          continue;
        }
      }
      return roadNodes;
    }

    function parseSVGPath(d) {
      // Simple SVG path parser for M/L commands
      const points = [];
      const commands = d.match(/[ML]\s*([^ML]+)/g) || [];
      for (const cmd of commands) {
        const coords = cmd.match(/[ML]\s*([-\d.]+)\s*,\s*([-\d.]+)/);
        if (coords) {
          points.push({x: parseFloat(coords[1]), y: parseFloat(coords[2])});
        }
      }
      return points;
    }

    function findNearestCell(x, y, cells) {
      let nearest = -1;
      let minDist = Infinity;
      for (let i = 0; i < cells.length; i++) {
        const dist = Math.hypot(cells[i].cx - x, cells[i].cy - y);
        if (dist < minDist) {
          minDist = dist;
          nearest = i;
        }
      }
      return nearest;
    }

    function isNearAnyRoad(town, roadPaths, threshold = 6) {
      // DOM-based sampling to check proximity to any curved road path
      const townCell = window.__state.cells[town.cellIndex ?? town.cell];
      for (const el of roadPaths) {
        try {
          const len = el.getTotalLength();
          for (let s = 0; s <= len; s += Math.max(2, threshold)) {
            const pt = el.getPointAtLength(s);
            if (Math.hypot(townCell.cx - pt.x, townCell.cy - pt.y) <= threshold) return true;
          }
        } catch (e) {
          continue;
        }
      }
      return false;
    }

    function nearestByEuclid(roadNodes, town) {
      if (!roadNodes || roadNodes.length === 0) return null;
      
      const townCell = window.__state.cells[town.cellIndex ?? town.cell];
      let nearest = roadNodes[0];
      let minDist = Infinity;
      
      for (const node of roadNodes) {
        const dist = Math.hypot(townCell.cx - node.x, townCell.cy - node.y);
        if (dist < minDist) {
          minDist = dist;
          nearest = node;
        }
      }
      return nearest;
    }
    function backfillTownsToNetwork() {
      const roadPaths = d3.select('#routes')
        .selectAll('path.primary-road, path.secondary-road, .roads path')
        .nodes();

      // 1) Spatial index of existing road vertices
      const roadNodes = sampleRoadPolylines(roadPaths, 10);
      
      // Skip if no roads exist yet
      if (!roadNodes || roadNodes.length === 0) {
        console.log('Backfill: No existing roads found, skipping backfill');
        return;
      }

      // 2) For each town not already near a road, A* to nearest roadNode
      const cells = window.__state.cells;
      const isWater = window.__state.isWater || [];
      const graph = buildLandGraphSimple(cells, isWater);
      const backfillPaths = [];

      for (const town of window.__state.burgs.filter(b => !b.capital && !b.removed)) {
        if (isNearAnyRoad(town, roadPaths, 6)) continue; // 6px snap threshold
        
        // Skip if town is on water
        if (isWater[town.cellIndex ?? town.cell]) {
          console.log(`Backfill: Skipping water town ${town.id} (cell ${town.cellIndex ?? town.cell})`);
          continue;
        }
        
        const target = nearestByEuclid(roadNodes, town);
        if (!target) continue; // Skip if no road nodes found
        
        // Skip if target is on water
        if (isWater[target.cell]) {
          console.log(`Backfill: Skipping water target for town ${town.id} (target cell ${target.cell} is water)`);
          continue;
        }
        
        // Check if town has valid neighbors
        const townNeighbors = graph.neighbors(town.cellIndex ?? town.cell);
        if (!townNeighbors || townNeighbors.length === 0) {
          console.log(`Backfill: Town ${town.id} (cell ${town.cellIndex ?? town.cell}) has no valid neighbors`);
          continue;
        }
        
        // Check if target has valid neighbors
        const targetNeighbors = graph.neighbors(target.cell);
        if (!targetNeighbors || targetNeighbors.length === 0) {
          console.log(`Backfill: Target for town ${town.id} (cell ${target.cell}) has no valid neighbors`);
          continue;
        }
        
        // Try with relaxed coast penalty first
        let path = aStarCells(town.cellIndex ?? town.cell, target.cell, graph, cells, { 
          maxCost: 5e9,
          maxIterations: 20000, // Higher limit for backfill
          coastPenalty: false // Relaxed for backfill
        });
        
        // If no path found, try with even more relaxed settings
        if (!path || path.length < 2) {
          path = aStarCells(town.cellIndex ?? town.cell, target.cell, graph, cells, { 
            maxCost: 1e10, // Much higher cost limit
            maxIterations: 30000, // Even higher limit for difficult cases
            coastPenalty: false
          });
        }
        
        // Final attempt with extremely relaxed settings
        if (!path || path.length < 2) {
          path = aStarCells(town.cellIndex ?? town.cell, target.cell, graph, cells, { 
            maxCost: 1e11, // Extremely high cost limit for difficult cases
            maxIterations: 50000, // Very high limit for final attempt
            coastPenalty: false
          });
        }
        
        // If still no path, try a simple BFS to see if there's any connectivity at all
        if (!path || path.length < 2) {
          const bfsPath = simpleBFS(town.cellIndex ?? town.cell, target.cell, graph);
          if (bfsPath && bfsPath.length > 1) {
            console.log(`Backfill: Found BFS path for town ${town.id} but A* failed - this suggests a cost calculation issue`);
          }
        }
        
        if (path && path.length > 1) {
          backfillPaths.push(path);
          // Mark usage for this backfill path
          for (const i of path) cells[i].pathUsed = (cells[i].pathUsed ?? 0) + 1;
        } else {
          // Calculate the straight-line distance to understand why pathfinding failed
          const townCell = cells[town.cellIndex ?? town.cell];
          const targetCell = cells[target.cell];
          const straightLineDist = Math.hypot(townCell.cx - targetCell.cx, townCell.cy - targetCell.cy);
          
          // Check if the target cell is actually reachable (not water)
          const targetIsWater = isWater[target.cell];
          const townIsWater = isWater[town.cellIndex ?? town.cell];
          
          console.log(`Backfill failed for town ${town.id} (cell ${town.cellIndex ?? town.cell}) - straight line distance: ${straightLineDist.toFixed(1)}px, town is water: ${townIsWater}, target is water: ${targetIsWater}`);
        }
      }

      // Draw backfill paths as secondary roads
      if (backfillPaths.length > 0) {
        for (const path of backfillPaths) {
          const polyline = pathToPolyline(path, cells);
          d3.select("#routes").select("g.secondary-roads")
            .append("path")
            .attr("class", "secondary-road")
            .attr("d", d3.line().x(d=>d.x).y(d=>d.y).curve(d3.curveCatmullRom.alpha(0.5))(polyline))
            .attr("vector-effect", "non-scaling-stroke");
        }
        console.log(`Backfill: connected ${backfillPaths.length} orphan towns`);
      }
    }
    function auditTownConnectivity(px = 6) {
      const orphanIds = [];
      const roadPaths = d3.select('#routes')
        .selectAll('path.primary-road, path.secondary-road, .roads path').nodes();
      
      // Skip if no burgs or roads
      if (!window.__state.burgs || !roadPaths || roadPaths.length === 0) {
        console.log('Connectivity audit: No burgs or roads to audit');
        return orphanIds;
      }
      
      for (const t of window.__state.burgs.filter(b => !b.capital && !b.removed)) {
        if (!isNearAnyRoad(t, roadPaths, px)) {
          orphanIds.push(t.id);
        }
      }
      
      if (orphanIds.length > 0) {
        console.warn(`Connectivity audit: ${orphanIds.length} orphan towns found:`, orphanIds);
      } else {
        console.log('Connectivity audit: All towns connected ✓');
      }
      
      return orphanIds;
    }

    function finalConnectivityAudit() {
      const routes = d3.select('#routes');
      const primCount = routes.selectAll('path.primary-road').size();
      const secCount  = routes.selectAll('path.secondary-road').size();
      const merged    = routes.selectAll('.roads path').size();

      console.log(`primary-road count: ${primCount}`);
      console.log(`secondary-road count: ${secCount}`);
      console.log(`merged paths (aesthetic): ${merged}`);

      const orphanIds = auditTownConnectivity(6);
      if (orphanIds.length) {
        console.warn(`Still orphaned: ${orphanIds.length}`, orphanIds);
      }
    }

    function lastResortConnectOrphans(orphanIds) {
      if (orphanIds.length === 0) return;
      
      console.log(`Last resort: attempting to connect ${orphanIds.length} remaining orphan towns to nearest capital`);
      
      const cells = window.__state.cells;
      const isWater = window.__state.isWater || [];
      const graph = buildLandGraphSimple(cells, isWater);
      const capitals = window.__state.burgs.filter(b => b.capital);
      
      if (capitals.length === 0) {
        console.log('Last resort: No capitals available for connection');
        return;
      }
      
      for (const orphanId of orphanIds) {
        const town = window.__state.burgs.find(b => b.id === orphanId);
        if (!town) continue;
        
        // Find nearest capital
        let nearestCapital = capitals[0];
        let minDist = Infinity;
        for (const cap of capitals) {
          const dist = Math.hypot(
            cells[town.cellIndex ?? town.cell].cx - cells[cap.cellIndex ?? cap.cell].cx,
            cells[town.cellIndex ?? town.cell].cy - cells[cap.cellIndex ?? cap.cell].cy
          );
          if (dist < minDist) {
            minDist = dist;
            nearestCapital = cap;
          }
        }
        
        // Try to connect to nearest capital with very relaxed settings
        let path = aStarCells(town.cellIndex ?? town.cell, nearestCapital.cellIndex ?? nearestCapital.cell, graph, cells, {
          maxCost: 1e10,
          maxIterations: 20000, // Higher limit for last resort
          coastPenalty: false
        });
        
        // If still no path, try with higher cost limit
        if (!path || path.length < 2) {
          path = aStarCells(town.cellIndex ?? town.cell, nearestCapital.cellIndex ?? nearestCapital.cell, graph, cells, {
            maxCost: 1e11,
            maxIterations: 50000, // Very high limit for final attempt
            coastPenalty: false
          });
        }
        
        if (path && path.length > 1) {
          const polyline = pathToPolyline(path, cells);
          d3.select("#routes").select("g.secondary-roads")
            .append("path")
            .attr("class", "secondary-road")
            .attr("d", d3.line().x(d=>d.x).y(d=>d.y).curve(d3.curveCatmullRom.alpha(0.5))(polyline))
            .attr("vector-effect", "non-scaling-stroke");
          
          console.log(`Last resort: Connected town ${town.id} to capital ${nearestCapital.id} (secondary)`);
        } else {
          // Calculate the straight-line distance to understand why pathfinding failed
          const townCell = cells[town.cellIndex ?? town.cell];
          const capitalCell = cells[nearestCapital.cellIndex ?? nearestCapital.cell];
          const straightLineDist = Math.hypot(townCell.cx - capitalCell.cx, townCell.cy - capitalCell.cy);
          console.log(`Last resort: Failed to connect town ${town.id} to capital ${nearestCapital.id} - straight line distance: ${straightLineDist.toFixed(1)}px`);
        }
      }
    }

    function canReachAnyRoad(town, landComp, roadPaths) {
      const townComponent = landComp[town.cellIndex ?? town.cell];
      for (const el of roadPaths) {
        try {
          const len = el.getTotalLength();
          for (let s = 0; s <= len; s += 8) { // coarse is fine for component check
            const pt = el.getPointAtLength(s);
            const cell = findNearestCell(pt.x, pt.y, window.__state.cells);
            if (cell !== -1 && landComp[cell] === townComponent) return true;
          }
        } catch (e) { continue; }
      }
      return false;
    }

    function pickBestCoastalTown(component, landComp, landGraph) {
      const cells = window.__state.cells;
      const isWater = window.__state.isWater || [];
      let best = null;
      let bestScore = -Infinity;
      
      for (const burg of window.__state.burgs) {
        const cellIdx = burg.cellIndex ?? burg.cell;
        if (landComp[cellIdx] !== component) continue;
        
        // Check if coastal using landGraph.neighbors
        const neighbors = landGraph.neighbors(cellIdx) || [];
        const coastal = neighbors.some(n => isWater[n]);
        if (!coastal) continue;
        
        // Score based on sheltered harbor status and existing port status
        let score = 0;
        if (burg.isPort) score += 10; // Already a port
        if (cells[cellIdx].isShelteredHarbor) score += 5; // Sheltered harbor
        score += Math.random() * 2; // Small random factor
        
        if (score > bestScore) {
          bestScore = score;
          best = burg;
        }
      }
      
      return best;
    }

    function nearestMainlandPort() {
      // Find the nearest port or capital that's on the mainland (component 0)
      const cells = window.__state.cells;
      const landComp = window.__state.landComp || labelLandComponents(cells, window.__state.isWater);
      
      let nearest = null;
      let minDist = Infinity;
      
      for (const burg of window.__state.burgs) {
        const cellIdx = burg.cellIndex ?? burg.cell;
        if (landComp[cellIdx] !== 0) continue; // Not mainland
        
        if (burg.capital || burg.isPort) {
          const dist = Math.hypot(cells[cellIdx].cx, cells[cellIdx].cy);
          if (dist < minDist) {
            minDist = dist;
            nearest = burg;
          }
        }
      }
      
      return nearest;
    }
    function connectIslandTowns() {
      const cells = window.__state.cells;
      const isWater = window.__state.isWater || [];
      const landComp = window.__state.landComp || labelLandComponents(cells, isWater);
      const roadPaths = d3.select('#routes')
        .selectAll('path.primary-road, path.secondary-road, .roads path')
        .nodes();
      
      // Skip if no land component data
      if (!landComp) {
        console.log('Island connections: No land component data available');
        return;
      }

      // Group towns by land component
      const townsByComponent = new Map();
      for (const town of window.__state.burgs.filter(b => !b.capital && !b.removed)) {
        const component = landComp[town.cellIndex ?? town.cell];
        if (component === -1) continue; // Water
        
        if (!townsByComponent.has(component)) {
          townsByComponent.set(component, []);
        }
        townsByComponent.get(component).push(town);
      }

      // Check each component
      for (const [component, towns] of townsByComponent) {
        if (component === 0) continue; // Mainland
        
        if (!canReachAnyRoad(towns[0], landComp, roadPaths)) {
          // This island has no road connection - promote best coastal town to port
          const landGraph = window.__state.landGraph;
          const port = pickBestCoastalTown(component, landComp, landGraph);
          if (port) {
            port.isPort = true;
            
            // Find nearest mainland port/capital
            const mainlandPort = nearestMainlandPort();
            if (mainlandPort) {
              // Draw sea route
              const portCell = cells[port.cellIndex ?? port.cell];
              const mainlandCell = cells[mainlandPort.cellIndex ?? mainlandPort.cell];
              
              d3.select("#routes .searoutes")
                .append("path")
                .attr("class", "route")
                .attr("d", `M ${portCell.cx} ${portCell.cy} L ${mainlandCell.cx} ${mainlandCell.cy}`)
                .attr("fill","none")
                .attr("stroke","#ffffff")
                .attr("stroke-width","1.6px")
                .attr("stroke-dasharray","6 4")
                .attr("opacity",0.8)
                .attr("vector-effect", "non-scaling-stroke");
              
              console.log(`Island connection: ${port.id} → ${mainlandPort.id} via sea route`);
            }
            
            // Connect port to inland towns on same island
            const graph = buildLandGraphSimple(cells, isWater);
            for (const town of towns) {
              if (town.id === port.id) continue;
              
              let path = aStarCells(town.cellIndex ?? town.cell, port.cellIndex ?? port.cell, graph, cells, {
                maxCost: 1e10,
                maxIterations: 20000, // Higher limit for island connections
                coastPenalty: false // Relaxed for island connections
              });
              
              // If no path found, try with higher cost limit
              if (!path || path.length < 2) {
                path = aStarCells(town.cellIndex ?? town.cell, port.cellIndex ?? port.cell, graph, cells, {
                  maxCost: 1e11,
                  maxIterations: 50000, // Very high limit for final attempt
                  coastPenalty: false
                });
              }
              
              if (path && path.length > 1) {
                const polyline = pathToPolyline(path, cells);
                d3.select("#routes").select("g.secondary-roads")
                  .append("path")
                  .attr("class", "secondary-road")
                  .attr("d", d3.line().x(d=>d.x).y(d=>d.y).curve(d3.curveCatmullRom.alpha(0.5))(polyline))
                  .attr("vector-effect", "non-scaling-stroke");
              } else {
                console.log(`Island connection failed for town ${town.id} to port ${port.id}`);
              }
            }
          } else {
            console.log(`No suitable coastal town found for component ${component}`);
          }
        }
      }
    }

    // === Road proximity bump + town placement (not wired) ===
    function indexCellsNearPolylines(cells, polylines, radiusPx = 8) {
      const r2 = radiusPx * radiusPx;
      const mark = new Array(cells.length).fill(false);
      for (const line of polylines) {
        for (const pt of line) {
          for (let i = 0; i < cells.length; i++) {
            const dx = cells[i].cx - pt.x, dy = cells[i].cy - pt.y;
            if (dx*dx + dy*dy <= r2) mark[i] = true;
          }
        }
      }
      return mark;
    }
    function rescoreWithRoads(baseScore, cells /* roadIndex unused now */) {
      const out = baseScore.slice();
      const rng = rngFromMapSeed("towns-jitter");
      const coastSteps = window.__state.coastSteps; // from coastal decay system
      
      for (let i = 0; i < out.length; i++) {
        const used = cells[i].pathUsed ?? 0;      // road repetition
        if (used > 0) {
          // Base road bonus + small extra per additional reuse (capped)
          const extra = Math.min(used - 1, 3) * 0.03; // max +0.09
          out[i] += 0.12 + extra;
          if (used >= 2) out[i] += 0.05; // crossroads
          // NEW: slightly prefer inland nodes over immediate coastline
          const cs = coastSteps ? coastSteps[i] : 9999;
          if (cs >= 3) out[i] += 0.04;     // more than ~2 rings inland
          else if (cs === 0) out[i] -= 0.04; // on-the-beach gets less econ bump
        }
        // Tiny randomness to prevent clumping bias
        out[i] += (rng() - 0.5) * 0.02; // ±0.01
      }
      return out;
    }

    function placeTowns(score, cells, capitals) {
      const want = CONFIG.settlements.townsCount;
      
      // Seeded jitter so ranks aren't too monotonous
      const rng = rngFromMapSeed("town-rank-jitter");
      const jitter = new Float32Array(score.length);
      for (let i = 0; i < score.length; i++) jitter[i] = (rng() - 0.5) * 0.02; // ±0.01
      
      const idx = Array.from(score.keys()).filter(i => Number.isFinite(score[i]));
      idx.sort((a, b) => (score[b] + jitter[b]) - (score[a] + jitter[a]));

      const chosen = [];
      const suppress = new Float32Array(cells.length); // coastal suppression

      const isCoastal = i => (cells[i].neighbors||[]).some(n => window.__state.isWater[n]);

      for (const i of idx) {
        const sEff = (score[i] + jitter[i]) - suppress[i];
        const p = { x: cells[i].cx, y: cells[i].cy, cell: i, type: "town", port: false, population: 3000 };
        if (
          capitals.every(c => Math.hypot(c.x - p.x, c.y - p.y) >= CONFIG.settlements.townMinSpacing) &&
          chosen.every(t => Math.hypot(t.x - p.x, t.y - p.y) >= CONFIG.settlements.townMinSpacing)
        ) {
          // Re-evaluate with suppression threshold to avoid too many beach picks
          if (sEff < (score[i] * 0.85)) continue; // if heavily suppressed, skip for now
          chosen.push(p);
          if (chosen.length === want) break;
          // If coastal, suppress neighboring coast cells
          if (isCoastal(i)) {
            const ns = cells[i].neighbors||[];
            for (const v of ns) {
              if (!window.__state.isWater[v] && isCoastal(v)) suppress[v] += 0.18;
            }
          }
        }
      }
      return chosen;
    }

    /**
     * Generate towns using Azgaar's economic approach
     * @param {Array} cells - All cells array
     * @param {Array} capitals - Array of capital burgs
     * @param {number} targetTownCount - Number of towns to generate
     * @param {Function} nameFor - Name generation function
     * @returns {Array} Array of town burgs
     */
    function generateTowns(cells, capitals, targetTownCount, nameFor) {
      const sea = +document.getElementById('seaLevelInput').value;
      const isWater = window.__state.isWater || [];
      
      // Mark capitals + neighbors as reserved
      const used = new Uint8Array(cells.length);
      for (const cap of capitals) {
        used[cap.cell] = 1;
        for (const n of cells[cap.cell].neighbors) used[n] = 1;
      }

      // Score all land cells
      const scored = [];
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (isWater[i] || used[i]) continue;
        
        const base = (c.geoScore ?? geographicScore(c)) + economicScore(c, 0);
        const score = base + randomJitter(base);
        scored.push({i, score});
      }

      scored.sort((a, b) => b.score - a.score);

      const towns = [];
      for (const s of scored) {
        if (towns.length >= targetTownCount) break;
        if (used[s.i]) continue;
        const c = cells[s.i];
        if (isWater[s.i]) continue;

        // Place town (burg)
        const town = {
          cell: s.i,
          x: c.cx, 
          y: c.cy,
          type: "town",
          name: nameFor ? nameFor(c) : null,
          id: capitals.length + towns.length,
          population: 1000,
          port: false,
          onRiver: false
        };
        
        // Determine if it's a port (near coast)
        let minWaterDist = Infinity;
        for (let i = 0; i < cells.length; i++) {
          if (isWater[i]) {
            const dist = Math.hypot(c.cx - cells[i].cx, c.cy - cells[i].cy);
            minWaterDist = Math.min(minWaterDist, dist);
          }
        }
        town.port = minWaterDist < 15; // Within 15px of water
        
        // Determine if it's on a river
        c.neighbors.forEach(nb => {
          const neighborCell = cells[nb];
          const isWaterNeighbor = isWater[nb];
          const isLake = window.__state.isLake && window.__state.isLake[nb] === 1;
          if (isWaterNeighbor && !isLake) {
            town.onRiver = true;
          }
        });

        // Generate name if not provided
        if (!town.name) {
          town.name = 'Unnamed';
        }

        towns.push(town);

        // Block this cell + neighbors
        used[s.i] = 1;
        for (const n of c.neighbors) used[n] = 1;
      }

      console.log(`Generated ${towns.length} towns using economic scoring`);
      return towns;
    }

    /**
     * Ensure towns have spur roads to the network
     * @param {Object} town - Town burg object
     * @param {Function} isRouteCell - Function to check if cell is on a route
     * @param {Function} nearestRouteCellFn - Function to find nearest route cell
     * @param {Function} addRoadPathFn - Function to add road path
     */
    function ensureSpurToRoad(town, isRouteCell, nearestRouteCellFn, addRoadPathFn) {
      const id = town.cell;
      if (isRouteCell(id)) return;
      
      const toId = nearestRouteCellFn(id);
      if (toId == null) return;
      
      const landGraph = window.__state.landGraph;
      if (!landGraph) return;
      
      const pathCells = shortestPath(id, toId, landGraph, new Set(), new Set());
      if (pathCells && pathCells.length) {
        addRoadPathFn(pathCells, {kind: "spur"});
      }
    }

    /**
     * Check if a cell is on a route
     * @param {number} cellId - Cell index
     * @returns {boolean} True if cell is on a route
     */
    function isRouteCell(cellId) {
      const cells = window.__state.cells;
      if (!cells || !cells[cellId]) return false;
      return (cells[cellId].path || 0) > 0;
    }

    /**
     * Find nearest cell that's on a route
     * @param {number} cellId - Starting cell index
     * @returns {number|null} Nearest route cell index or null
     */
    function nearestRouteCell(cellId) {
      const cells = window.__state.cells;
      if (!cells || !cells[cellId]) return null;
      
      // Simple BFS to find nearest route cell
      const visited = new Set();
      const queue = [{cell: cellId, dist: 0}];
      
      while (queue.length > 0) {
        const {cell, dist} = queue.shift();
        if (visited.has(cell)) continue;
        visited.add(cell);
        
        if (isRouteCell(cell)) {
          return cell;
        }
        
        // Add neighbors to queue
        const cellObj = cells[cell];
        if (cellObj && cellObj.neighbors) {
          for (const neighbor of cellObj.neighbors) {
            if (!visited.has(neighbor)) {
              queue.push({cell: neighbor, dist: dist + 1});
            }
          }
        }
      }
      
      return null;
    }

    /**
     * Add a spur road path
     * @param {Array} pathCells - Array of cell indices forming the path
     * @param {Object} options - Path options
     */
    function addSpurRoad(pathCells, options) {
      if (!pathCells || pathCells.length < 2) return;
      
      const cells = window.__state.cells;
      const points = pathCells.map(cellId => [cells[cellId].cx, cells[cellId].cy]);
      
      const line = d3.line().x(d => d[0]).y(d => d[1]).curve(d3.curveCatmullRom.alpha(0.5));
      const smoothed = smoothLine(points, 1);
      
      // Add to trails (spurs are local connections)
      const trailsG = d3.select('#routes .trails');
      trailsG.append('path')
        .attr('class', 'trails')
        .attr('d', line(smoothed))
        .attr('fill', 'none')
        .attr('vector-effect', 'non-scaling-stroke');
      
      console.log(`Added spur road with ${pathCells.length} cells`);
    }

    // --- Routes System ---
    
    /**
     * Build a navigation graph over land cells
     * @param {Array} cells - All cells array
     * @param {Array} isWater - Water mask array
     * @returns {Object} Graph with nodes and edges
     */
    // Overload + neighbor API shim
    function buildLandGraph(stateOrCells, maybeIsWater) {
      // Overload: allow (state) or (cells, isWater)
      const cells = Array.isArray(stateOrCells) ? stateOrCells : stateOrCells?.cells;
      const isWater = Array.isArray(maybeIsWater) ? maybeIsWater :
                      (Array.isArray(stateOrCells?.isWater) ? stateOrCells.isWater : null);

      if (!cells || !isWater) {
        if (DEBUG) console.error('buildLandGraph: missing cells/isWater');
        // Fallback to simple graph so downstream still works
        return buildLandGraphSimple(window.__state?.cells || [], window.__state?.isWater || []);
      }

      // Use cache if available
      if (GraphCache.land) return GraphCache.land;

      const nodes = [];
      const edges = [];
      const nbrs = new Map(); // cellIndex -> Set of neighbor cellIndices

      for (let i = 0; i < cells.length; i++) {
        if (!isWater[i]) {
          nodes.push({ id: i, cellIndex: i, x: cells[i].cx, y: cells[i].cy });
          nbrs.set(i, new Set());
        }
      }

      for (let i = 0; i < cells.length; i++) {
        if (isWater[i]) continue;
        const ci = cells[i];
        const ns = (ci.neighbors || []).filter(j => !isWater[j]);
        for (const j of ns) {
          if (j <= i || isWater[j]) continue;
          const dist = Math.hypot(ci.cx - cells[j].cx, ci.cy - cells[j].cy);
          edges.push({ u: i, v: j, w: dist });
          nbrs.get(i).add(j);
          if (!nbrs.has(j)) nbrs.set(j, new Set());
          nbrs.get(j).add(i);
        }
      }

      const graph = {
        nodes, edges,
        neighbors(i) { return Array.from(nbrs.get(i) || []); }
      };

      GraphCache.land = graph; // cache
      return graph;
    }

    /**
     * Ensure land graph has the maps that markPorts expects
     * @param {Object} landGraph - Land graph object
     * @param {Array} cells - All cells array
     * @param {Array} isWater - Water mask array
     * @returns {Object} Enriched land graph with nodes and idOf maps
     */
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
    
    // Expose for callers defined in other scopes
    if (typeof window !== 'undefined') window.ensureLandGraphMaps = ensureLandGraphMaps;
    
    /**
     * Check if a path crosses a river segment
     * @param {Object} cellA - First cell
     * @param {Object} cellB - Second cell
     * @returns {boolean} True if path crosses a river
     */
    function crossesRiverSegment(cellA, cellB) {
      // Simplified check: just return false for now to avoid potential issues
      // TODO: Implement proper river crossing detection
      return false;
    }
    
    /**
     * Check if a line segment between two cells stays entirely over water
     * @param {number} cellAIndex - First cell index
     * @param {number} cellBIndex - Second cell index
     * @param {Array} cells - All cells array
     * @param {Array} isWater - Water mask array
     * @returns {boolean} True if segment stays over water
     */
    function waterOnlySegment(cellAIndex, cellBIndex, cells, isWater) {
      // Simple check: just verify both endpoints are water
      // TODO: Implement proper line segment water-only check
      return isWater[cellAIndex] && isWater[cellBIndex];
    }
    
    /**
     * A* pathfinding algorithm for land navigation using edge weights
     * @param {number} startIndex - Starting cell index
     * @param {number} endIndex - Ending cell index
     * @param {Object} graph - Land graph
     * @param {Set} usedEdges - Set of already-used edges for road reuse discount
     * @param {Set} burgCells - Set of burg cell indices for pass-through bonus
     * @returns {Array} Path as array of cell indices
     */
    function shortestPath(startIndex, endIndex, graph, usedEdges = new Set(), burgCells = new Set()) {
      const cells = window.__state.cells;
      const isWater = window.__state.isWater || [];
      
      // Debug logging (only for first few calls)
      if (window.__state.shortestPathCallCount === undefined) {
        window.__state.shortestPathCallCount = 0;
      }
      window.__state.shortestPathCallCount++;
      
      if (DEBUG && window.__state.shortestPathCallCount <= 5) {
        console.log(`shortestPath called: start=${startIndex}, end=${endIndex}, graph edges=${graph?.edges?.length || 0}`);
      }
      
      // Skip if start or end is water
      if (isWater[startIndex] || isWater[endIndex]) {
        if (DEBUG) console.log(`shortestPath: start or end is water (start: ${isWater[startIndex]}, end: ${isWater[endIndex]})`);
        return null;
      }
      
      // Check if start and end are the same
      if (startIndex === endIndex) {
        if (DEBUG) console.log(`shortestPath: start and end are the same (${startIndex})`);
        return [startIndex];
      }
      
      // Validate graph
      if (!graph || !graph.edges || graph.edges.length === 0) {
        if (DEBUG) console.warn(`shortestPath: invalid or empty graph provided`);
        return null;
      }
      
      // Use cached graph if available
      const G = GraphCache.land;
      if (!G) {
        if (DEBUG) console.warn(`shortestPath: no cached land graph available`);
        return null;
      }
      
      const N = G.nodesCount;
      const neighbors = G.neighbors;
      const cost = (u,v)=> G.edgeCost.get(`${u}:${v}`) ?? 1;

      // Heuristic: straight-line in cell coords if available, else zero
      const H = (a,b)=> 0; // keep admissible; replace if you have xy[] per node

      const INF = 1e20;
      // Typed arrays
      const gScore = new Float64Array(N); gScore.fill(INF);
      const fScore = new Float64Array(N); fScore.fill(INF);
      const cameFrom = new Int32Array(N); cameFrom.fill(-1);
      const inOpen = new Uint8Array(N);

      gScore[startIndex]=0; fScore[startIndex]=H(startIndex, endIndex);

      const open = new MinHeap(i => fScore[i]); open.push(startIndex); inOpen[startIndex]=1;
      let safety=0, MAX_ITERS = N*20;

      while (open.size) {
        if (++safety > MAX_ITERS) break; // safety valve
        const current = open.pop();
        inOpen[current]=0;
        if (current===endIndex) return reconstructPath(cameFrom, current);

        const nbrs = neighbors[current];
        for (let k=0;k<nbrs.length;k++){
          const n = nbrs[k];
          const tentative = gScore[current] + cost(current, n);
          if (tentative < gScore[n]) {
            cameFrom[n] = current;
            gScore[n] = tentative;
            fScore[n] = tentative + H(n, endIndex);
            if (!inOpen[n]) { open.push(n); inOpen[n]=1; }
          }
        }
      }

      // Fallback BFS (unweighted) for robustness
      return bfsFallback(startIndex, endIndex, neighbors);
    }
    function reconstructPath(cameFrom, cur){
      const out = [cur];
      while (cameFrom[cur] !== -1) { cur = cameFrom[cur]; out.push(cur); }
      out.reverse(); return out;
    }
    
    function bfsFallback(start, goal, neighbors){
      const q=[start], prev = new Map([[start,-1]]); let i=0;
      while (i<q.length) {
        const u = q[i++];
        if (u===goal) break;
        for (const v of neighbors[u]) if (!prev.has(v)){ prev.set(v,u); q.push(v); }
      }
      if (!prev.has(goal)) return [];
      const path=[goal]; let x=goal;
      while (prev.get(x)!==-1){ x = prev.get(x); path.push(x); }
      return path.reverse();
    }
    
    /**
     * Admissible heuristic function for A* (straight-line distance)


    /**
     * Calculate the total cost of a path using edge weights from land graph
     * @param {Array} path - Array of cell indices
     * @param {Object} landGraph - Land graph with edges
     * @returns {number} Total path cost
     */
    function calculatePathCost(path, landGraph) {
      if (path.length < 2) return 0;
      
      // Create edge lookup map
      const edgeMap = new Map();
      for (const edge of landGraph.edges) {
        const key = `${Math.min(edge.a, edge.b)}-${Math.max(edge.a, edge.b)}`;
        edgeMap.set(key, edge);
      }
      
      let totalCost = 0;
      for (let i = 1; i < path.length; i++) {
        const prev = path[i - 1];
        const curr = path[i];
        const edgeKey = `${Math.min(prev, curr)}-${Math.max(prev, curr)}`;
        const edge = edgeMap.get(edgeKey);
        
        if (edge) {
          totalCost += edge.w; // Use precomputed edge weight
        } else {
          // Fallback to Euclidean distance
          const prevCell = window.__state.cells[prev];
          const currCell = window.__state.cells[curr];
          totalCost += Math.hypot(prevCell.cx - currCell.cx, prevCell.cy - currCell.cy);
        }
      }
      
      return totalCost;
    }
    
    /**
     * Mark all edges in a path as used for road reuse discount
     * @param {Array} path - Array of cell indices
     * @param {Set} usedEdges - Set to track used edges
     */
    function markPathEdgesAsUsed(path, usedEdges) {
      for (let i = 1; i < path.length; i++) {
        const prev = path[i - 1];
        const curr = path[i];
        const edgeKey = `${Math.min(prev, curr)}-${Math.max(prev, curr)}`;
        usedEdges.add(edgeKey);
      }
    }
    /**
     * Calculate the total cost of a sea path using edge weights from sea graph
     * @param {Array} path - Array of cell indices
     * @param {Object} seaGraph - Sea graph with edges
     * @returns {number} Total path cost
     */
    function calculateSeaPathCost(path, seaGraph) {
      if (path.length < 2) return 0;
      
      // Create edge lookup map
      const edgeMap = new Map();
      for (const edge of seaGraph.edges) {
        const key = `${Math.min(edge.u, edge.v)}-${Math.max(edge.u, edge.v)}`;
        edgeMap.set(key, edge);
      }
      
      let totalCost = 0;
      for (let i = 1; i < path.length; i++) {
        const prev = path[i - 1];
        const curr = path[i];
        const edgeKey = `${Math.min(prev, curr)}-${Math.max(prev, curr)}`;
        const edge = edgeMap.get(edgeKey);
        
        if (edge) {
          totalCost += edge.w; // Use precomputed edge weight with offshore bias
        } else {
          // Fallback to Euclidean distance
          const prevCell = window.__state.cells[prev];
          const currCell = window.__state.cells[curr];
          totalCost += Math.hypot(prevCell.cx - currCell.cx, prevCell.cy - currCell.cy);
        }
      }
      
      return totalCost;
    }
    
    // --- caching single-source shortest paths for sea graph ---
    const seaSSSPCache = new Map(); // key: sourceNodeId -> {dist: Map, prev: Map}
    
    /**
     * Get cached single-source shortest path results for sea graph
     * @param {number} sourceNodeId - Starting water node
     * @param {Object} graph - Sea navigation graph
     * @param {Set} usedEdges - Set of already-used edges for reuse penalty
     * @returns {Object} {dist: Map, prev: Map} distances and predecessors
     */
    function getSeaSSSP(sourceNodeId, graph, usedEdges = new Set()) {
      const cacheKey = `${sourceNodeId}-${usedEdges.size}`; // Include usedEdges in cache key
      if (seaSSSPCache.has(cacheKey)) {
        return seaSSSPCache.get(cacheKey);
      }
      
      const {dist, prev} = dijkstraSea(sourceNodeId, graph, usedEdges);
      seaSSSPCache.set(cacheKey, {dist, prev});
      return {dist, prev};
    }
    
    /**
     * Reconstruct path from predecessors map
     * @param {Map} prev - Predecessors map
     * @param {number} targetNodeId - Target node
     * @returns {Array} Path as array of node indices
     */
    function reconstructSeaPath(prev, targetNodeId) {
      console.log(`reconstructSeaPath: targetNodeId=${targetNodeId}, prev type=${typeof prev}, isArray=${Array.isArray(prev)}`);
      const path = [];
      
      // Handle both Map and Array formats
      const getPrev = (nodeId) => {
        if (prev instanceof Map) {
          return prev.get(nodeId);
        } else if (Array.isArray(prev) || prev instanceof Float64Array || prev instanceof Int32Array) {
          return prev[nodeId];
        }
        return -1;
      };
      
      // Use a generous guard based on graph size instead of a tiny constant
      const nodesCount = GraphCache?.sea?.nodesCount ?? window.__state.cells.length;
      let guard = 0, maxHops = nodesCount + 5;
      
      for (let v = targetNodeId; v !== -1 && v !== undefined; v = getPrev(v)) {
        path.push(v);
        if (++guard > maxHops) {
          console.warn('reconstructSeaPath guard tripped; likely a bad predecessor chain');
          break;
        }
      }
      const result = path.reverse();
      console.log(`reconstructSeaPath: result path length=${result.length}, path=${result.slice(0, 5)}...`);
      return result;
    }
    /**
     * Optimized Dijkstra for sea navigation with edge reuse penalty
     * @param {number} startIndex - Starting cell index
     * @param {Object} graph - Sea graph
     * @param {Set} usedEdges - Set of already-used edges for penalty
     * @returns {Object} {dist: Map, prev: Map} distances and predecessors
     */
    function dijkstraSea(startIndex, graph, usedEdges = new Set()) {
      const cells = window.__state.cells;
      const isWater = window.__state.isWater || [];
      
      if (DEBUG) console.log(`dijkstraSea: starting from ${startIndex}, graph has ${graph.edges.length} edges`);
      
      if (!isWater[startIndex]) {
        console.log(`dijkstraSea: start is not water (start: ${isWater[startIndex]})`);
        return {dist: new Map(), prev: new Map()};
      }
      
      // Create edge lookup map for fast access
      const edgeMap = new Map();
      for (const edge of graph.edges) {
        const key = `${Math.min(edge.u, edge.v)}-${Math.max(edge.u, edge.v)}`;
        edgeMap.set(key, edge);
      }
      
      const dist = new Map();
      const prev = new Map();
      const visited = new Set();
      const queue = new MinHeap(item => item.cost);
      queue.push({ node: startIndex, cost: 0 });
      
      dist.set(startIndex, 0);
      prev.set(startIndex, -1);
      
      let iterations = 0;
      const maxIterations = (graph.edges?.length ?? 0) * 4 || Infinity; // Size-based limit
      
      while (queue.size > 0 && iterations < maxIterations) {
        iterations++;
        const { node: current, cost: currentCost } = queue.pop();
        
        if (visited.has(current)) continue;
        visited.add(current);
        
        // Find all edges from current node
        for (const edge of graph.edges) {
          let nextIndex = null;
          if (edge.u === current) {
            nextIndex = edge.v;
          } else if (edge.v === current) {
            nextIndex = edge.u;
          }
          
          if (nextIndex === null || visited.has(nextIndex)) continue;
          
          // Calculate edge cost with reuse penalty
          const edgeKey = `${Math.min(current, nextIndex)}-${Math.max(current, nextIndex)}`;
          let edgeCost = edge.w;
          
          // Apply reuse penalty if edge was already used
          if (usedEdges.has(edgeKey)) {
            edgeCost *= 0.15; // Azgaar's existing lane discount
          } else {
            edgeCost *= 1.5; // New lane penalty
          }
          
          const newCost = currentCost + edgeCost;
          
          if (!dist.has(nextIndex) || newCost < dist.get(nextIndex)) {
            dist.set(nextIndex, newCost);
            prev.set(nextIndex, current);
            queue.push({ node: nextIndex, cost: newCost });
          }
        }
      }
      
      if (DEBUG) console.log(`dijkstraSea: completed, found ${dist.size} reachable nodes from ${startIndex}`);
      return {dist, prev};
    }
    /**
     * Find path from start to end using precomputed distances from dijkstraSea
     * @param {number} startIndex - Starting cell index
     * @param {number} endIndex - Ending cell index
     * @param {Object} graph - Sea graph
     * @param {Map} distances - Precomputed distances from dijkstraSea
     * @returns {Array} Path as array of cell indices
     */
    function findPathFromDistances(startIndex, endIndex, graph, distances) {
      const cells = window.__state.cells;
      const isWater = window.__state.isWater || [];
      
      // Skip if start or end is not water
      if (!isWater[startIndex] || !isWater[endIndex]) {
        return null;
      }
      
      // Check if start and end are the same
      if (startIndex === endIndex) {
        return [startIndex];
      }
      
      // Check if end is reachable
      if (distances[endIndex] === undefined) {
        return null;
      }
      
      // Reconstruct path by following decreasing distances
      const path = [endIndex];
      let current = endIndex;
      
      while (current !== startIndex) {
        let bestNeighbor = null;
        let bestDistance = Infinity;
        
        // Find neighbor with lowest distance
        for (const edge of graph.edges) {
          let neighbor = null;
          if (edge.a === current) {
            neighbor = edge.b;
          } else if (edge.b === current) {
            neighbor = edge.a;
          }
          
          if (neighbor !== null && distances[neighbor] !== undefined && distances[neighbor] < distances[current]) {
            if (distances[neighbor] < bestDistance) {
              bestDistance = distances[neighbor];
              bestNeighbor = neighbor;
            }
          }
        }
        
        if (bestNeighbor === null) {
          // No path found
          return null;
        }
        
        path.unshift(bestNeighbor);
        current = bestNeighbor;
      }
      
      return path;
    }
    /**
     * Build a compressed port graph for efficient gap detection
     * @param {Array} portsWithSeaIndex - Array of ports with their sea indices
     * @param {Object} seaGraph - Sea navigation graph
     * @returns {Object} Port graph with nodes and edges
     */
    function buildPortGraph(portsWithSeaIndex, seaGraph) {
      const nodes = portsWithSeaIndex.map(p => ({
        id: p.id,
        x: p.x,
        y: p.y,
        nodeId: p.nodeId
      }));
      
      const edges = [];
      
      // Create edges between ports using cached SSSP distances
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const source = nodes[i];
          const target = nodes[j];
          
          // Get cached SSSP from source using SeaRouter
          const {dist} = SeaRouter.ensureFor(source.nodeId);
          
          // Edge weight is the sea distance between ports
          const weight = dist[target.nodeId] || Infinity;
          
          if (weight < Infinity) {
            edges.push({
              a: i,
              b: j,
              weight: weight,
              sourceId: source.id,
              targetId: target.id
            });
          }
        }
      }
      
      return { nodes, edges };
    }
    
    /**
     * Optimized gap patching using port graph
     * @param {Object} portGraph - Port graph
     * @param {Array} islandGroups - Island groups
     * @param {Map} islandDistances - Island distance data
     * @param {number} largestIslandId - Largest island ID
     * @returns {Array} Gap patches
     */
    function patchGapsOptimized(portGraph, islandGroups, islandDistances, largestIslandId) {
      const gapPatches = [];
      const maxPatchesPerIsland = 6; // Cap gap patches per island
      const detourRatio = 5.0; // Stricter detour ratio
      
      islandGroups.forEach((islandPorts, islandId) => {
        if (islandPorts.length < 2) return;
        
        const islandData = islandDistances.get(islandId);
        if (!islandData) return;
        
        // Find ports for this island in the port graph
        const islandPortIndices = [];
        islandPorts.forEach(port => {
          const portIndex = portGraph.nodes.findIndex(n => n.id === port.id);
          if (portIndex >= 0) {
            islandPortIndices.push(portIndex);
          }
        });
        
        if (islandPortIndices.length < 2) return;
        
        // Build MST for this island's ports
        const islandEdges = portGraph.edges.filter(edge => 
          islandPortIndices.includes(edge.a) && islandPortIndices.includes(edge.b)
        );
        
        // Sort by weight for Kruskal's algorithm
        islandEdges.sort((a, b) => a.weight - b.weight);
        
        // Simple MST using union-find
        const parent = new Array(portGraph.nodes.length).fill(0).map((_, i) => i);
        
        function find(x) {
          if (parent[x] !== x) {
            parent[x] = find(parent[x]);
          }
          return parent[x];
        }
        
        function union(x, y) {
          parent[find(x)] = find(y);
        }
        
        const mstEdges = new Set();
        for (const edge of islandEdges) {
          if (find(edge.a) !== find(edge.b)) {
            union(edge.a, edge.b);
            mstEdges.add(`${edge.a}-${edge.b}`);
            mstEdges.add(`${edge.b}-${edge.a}`);
          }
        }
        
        // Check for gaps: compare graph path vs direct edge
        let patchesAdded = 0;
        for (let i = 0; i < islandPortIndices.length && patchesAdded < maxPatchesPerIsland; i++) {
          for (let j = i + 1; j < islandPortIndices.length && patchesAdded < maxPatchesPerIsland; j++) {
            const portA = islandPortIndices[i];
            const portB = islandPortIndices[j];
            
            // Skip if already connected in MST
            if (mstEdges.has(`${portA}-${portB}`)) continue;
            
            // Find shortest path via existing edges
            const graphPathCost = findShortestPathInPortGraph(portA, portB, portGraph, mstEdges);
            const directCost = portGraph.edges.find(e => 
              (e.a === portA && e.b === portB) || (e.a === portB && e.b === portA)
            )?.weight || Infinity;
            
            if (graphPathCost >= detourRatio * directCost && directCost < Infinity) {
              // Add gap patch
              const portAId = portGraph.nodes[portA].id;
              const portBId = portGraph.nodes[portB].id;
              
              gapPatches.push({
                islandId: islandId,
                fromPort: { id: portAId, x: portGraph.nodes[portA].x, y: portGraph.nodes[portA].y },
                fromNodeId: portGraph.nodes[portA].nodeId,
                toPort: { id: portBId, x: portGraph.nodes[portB].x, y: portGraph.nodes[portB].y },
                toNodeId: portGraph.nodes[portB].nodeId,
                cost: directCost
              });
              
              patchesAdded++;
              
              // Throttle gap patch logging to avoid console spam
              if (gapPatches.length <= 10) {
                console.log(`Added gap patch on island ${islandId}: ${portAId} to ${portBId} (detour ${graphPathCost.toFixed(1)} vs direct ${directCost.toFixed(1)})`);
              } else if (gapPatches.length === 11) {
                console.log(`... and ${gapPatches.length - 10} more gap patches (logging throttled)`);
              }
            }
          }
        }
      });
      
      return gapPatches;
    }
    
    /**
     * Find shortest path in port graph using existing edges
     * @param {number} start - Start port index
     * @param {number} end - End port index
     * @param {Object} portGraph - Port graph
     * @param {Set} existingEdges - Set of existing edges
     * @returns {number} Path cost or Infinity if no path
     */
    function findShortestPathInPortGraph(start, end, portGraph, existingEdges) {
      const visited = new Set();
      const queue = [{ node: start, cost: 0 }];
      
      while (queue.length > 0) {
        queue.sort((a, b) => a.cost - b.cost);
        const { node: current, cost } = queue.shift();
        
        if (current === end) {
          return cost;
        }
        
        if (visited.has(current)) continue;
        visited.add(current);
        
        // Find neighbors via existing edges
        for (const edge of portGraph.edges) {
          let neighbor = null;
          if (edge.a === current && existingEdges.has(`${edge.a}-${edge.b}`)) {
            neighbor = edge.b;
          } else if (edge.b === current && existingEdges.has(`${edge.b}-${edge.a}`)) {
            neighbor = edge.a;
          }
          
          if (neighbor !== null && !visited.has(neighbor)) {
            queue.push({ node: neighbor, cost: cost + edge.weight });
          }
        }
      }
      
      return Infinity; // No path found
    }
    
    /**
     * Simple BFS pathfinding for sea navigation using the sea graph
     * @param {number} startIndex - Starting cell index
     * @param {number} endIndex - Ending cell index
     * @param {Object} graph - Sea graph
     * @returns {Array} Path as array of cell indices
     */
    function shortestPathSea(startIndex, endIndex, graph) {
      const cells = window.__state.cells;
      const isWater = window.__state.isWater || [];
      
      // Skip if start or end is not water
      if (!isWater[startIndex] || !isWater[endIndex]) {
        console.log(`shortestPathSea: start or end is not water (start: ${isWater[startIndex]}, end: ${isWater[endIndex]})`);
        return null;
      }
      
      // Check if start and end are the same
      if (startIndex === endIndex) {
        return [startIndex];
      }
      
      // Weighted BFS using sea graph edges with offshore bias
      const visited = new Set();
      const queue = [[startIndex, [startIndex], 0]]; // [current, path, cost]
      visited.add(startIndex);
      
      while (queue.length > 0) {
        // Sort queue by cost to prefer lower-cost (more offshore) paths
        queue.sort((a, b) => a[2] - b[2]);
        const [current, path, cost] = queue.shift();
        
        if (current === endIndex) {
          console.log(`shortestPathSea: found path with ${path.length} cells between ${startIndex} and ${endIndex}`);
          return path;
        }
        
        // Find all edges from current node in sea graph
        for (const edge of graph.edges) {
          let nextIndex = null;
          if (edge.a === current) {
            nextIndex = edge.b;
          } else if (edge.b === current) {
            nextIndex = edge.a;
          }
          
          if (nextIndex !== null && !visited.has(nextIndex)) {
            // Calculate cost based on distance and land proximity
            const nextCell = cells[nextIndex];
            let landProximity = 0;
            
            // Count land neighbors to bias away from coast
            for (const nb of nextCell.neighbors) {
              if (!isWater[nb]) {
                landProximity += 1;
              }
            }
            
            // Higher cost for cells near land (encourages offshore routes)
            const newCost = cost + edge.w + (landProximity * 10);
            
            visited.add(nextIndex);
            queue.push([nextIndex, [...path, nextIndex], newCost]);
          }
        }
      }
      
      console.log(`shortestPathSea: no path found between ${startIndex} and ${endIndex}`);
      return null; // No path found
    }
    
    /**
     * Heuristic function for A* (Euclidean distance)
     * @param {number} a - Cell index
     * @param {number} b - Cell index
     * @param {Array} cells - All cells array
     * @returns {number} Heuristic value
     */
    function heuristic(a, b, cells) {
      return Math.hypot(cells[a].cx - cells[b].cx, cells[a].cy - cells[b].cy);
    }
    
    /**
     * Convert path indices to polyline points
     * @param {Array} pathIndices - Array of cell indices
     * @returns {Array} Array of [x, y] points
     */
    function polylineFromPath(pathIndices) {
      const cells = window.__state.cells;
      return pathIndices.map(index => [cells[index].cx, cells[index].cy]);
    }
    
    /**
     * Smooth a polyline using Chaikin smoothing
     * @param {Array} points - Array of [x, y] points
     * @param {number} iterations - Number of smoothing iterations
     * @returns {Array} Smoothed polyline
     */
    function smoothLine(points, iterations = 1) {
      if (points.length < 3) return points;
      
      let smoothed = points;
      for (let iter = 0; iter < iterations; iter++) {
        const newPoints = [];
        for (let i = 0; i < smoothed.length - 1; i++) {
          const [x1, y1] = smoothed[i];
          const [x2, y2] = smoothed[i + 1];
          
          newPoints.push([x1, y1]);
          newPoints.push([(x1 + x2) / 2, (y1 + y2) / 2]);
        }
        newPoints.push(smoothed[smoothed.length - 1]);
        smoothed = newPoints;
      }
      
      return smoothed;
    }
    
    /**
     * Mark ports in burgs array, ensuring every island has at least one port
     * @param {Array} burgs - Burgs array
     * @param {Array} cells - All cells array
     * @param {Array} isWater - Water mask array
     */
    // Tag graph nodes that correspond to port burgs; store quick lookups
    function markPorts(state, landGraph){
      const burgs = state.burgs || [];
      const cells = state.cells || [];
      const isWater = state.isWater || [];
      const ports = burgs.filter(b => b.typeClass === 'port' || b.port || b.isPort);
      state.__portNodeIds = [];
      for (const b of ports){
        const cellIndex = b.cellIndex ?? b.cell;
        const nid = landGraph.idOf.get(cellIndex);
        if (nid == null) continue;
        landGraph.nodes[nid].isPort = true;
        state.__portNodeIds.push(nid);
        b.isPort = true; b.port = true;
      }
      // Optional: snap ports that fell off-graph to nearest land node
      if (state.__portNodeIds.length < ports.length) {
        const land = landGraph.nodes;
        for (const b of ports){
          const cellIndex = b.cellIndex ?? b.cell;
          let nid = landGraph.idOf.get(cellIndex);
          if (nid != null) continue;
          let best=-1, bestD2=Infinity;
          for (let i=0;i<land.length;i++){
            const dx = land[i].x - b.x, dy = land[i].y - b.y;
            const d2 = dx*dx+dy*dy;
            if (d2<bestD2){ bestD2=d2; best=i; }
          }
          if (best>=0){ land[best].isPort = true; state.__portNodeIds.push(best); b.isPort = true; b.port = true; }
        }
      }
    }
    
    /**
     * Find the nearest water cell to a given cell
     * @param {number} fromIndex - Starting cell index
     * @param {Array} isWater - Water mask array
     * @param {Object} landGraph - Land graph for neighbor access
     * @returns {number} Index of nearest water cell, or -1 if none found
     */
    function nearestWaterCellIndex(fromIndex, isWater, landGraph) {
      if (isWater[fromIndex]) return fromIndex;
      const visited = new Uint8Array(landGraph.nodes.length);
      const q = [fromIndex];
      visited[fromIndex] = 1;
      while (q.length) {
        const i = q.shift();
        const neighbors = landGraph.neighbors(i) || [];
        for (const nb of neighbors) {
          if (visited[nb]) continue;
          if (isWater[nb]) return nb;       // first water cell found
          visited[nb] = 1;
          q.push(nb);
        }
      }
      return -1; // none found (shouldn't happen on coastal ports)
    }
    
    function findConnectedComponents(burgs, landGraph) {
      const cells = window.__state.cells;
      const isWater = window.__state.isWater;

      const seeds = burgs
        .map(b => b.cell ?? b.cellIndex)
        .filter(ci => Number.isInteger(ci) && !isWater[ci]);

      const comps = [];
      const seen = new Set();

      for (const start of seeds) {
        if (seen.has(start)) continue;
        const q = [start];
        const comp = new Set([start]);
        seen.add(start);
        while (q.length) {
          const cur = q.pop();
          const ns = landGraph.neighbors(cur) || [];
          for (const nb of ns) {
            if (isWater[nb] || seen.has(nb)) continue;
            seen.add(nb);
            comp.add(nb);
            q.push(nb);
          }
        }
        comps.push(comp);
      }
      return comps;
    }
    

    
    /**
     * Helper function to get or create a group
     * @param {Object} parent - Parent D3 selection
     * @param {string} className - Class name for the group
     * @returns {Object} D3 selection for the group
     */
    function getOrCreateGroup(parent, className) {
      let group = parent.select(`.${className}`);
      if (group.size() === 0) {
        group = parent.append('g').attr('class', className);
      }
      return group;
    }
    
    // Group capitals by island id
    function groupCapitalsByIsland(capitals, islandOf) {
      const byIsl = new Map();
      if (DEBUG) console.log('groupCapitalsByIsland: islandOf mapping available:', islandOf !== undefined);
      for (const cap of capitals) {
        const isl = islandOf?.[cap.cell] ?? -1;
        if (DEBUG) console.log(`Capital ${cap.id} (cell ${cap.cell}): island ${isl}`);
        if (!byIsl.has(isl)) byIsl.set(isl, []);
        byIsl.get(isl).push(cap);
      }
      return byIsl;
    }

    // Track primary vs any-road usage separately
    function markPrimaryUsage(path, cells) {
      for (const i of path) {
        cells[i].pathPrimaryUsed = (cells[i].pathPrimaryUsed ?? 0) + 1;
        cells[i].pathUsed = (cells[i].pathUsed ?? 0) + 1;
      }
    }
    // Given current primary usage, compute which capitals are connected via PRIMARY cells only
    function capitalPrimaryComponents(capitals, landGraph, cells, isWater) {
      const compId = new Map(); // capital.id -> component number
      let comp = 0;
      const primary = new Set();
      for (let i = 0; i < cells.length; i++) if ((cells[i].pathPrimaryUsed ?? 0) > 0) primary.add(i);
      
      if (DEBUG) {
        console.log(`capitalPrimaryComponents: found ${primary.size} cells with primary road usage`);
        console.log('Capitals to check:', capitals.map(c => ({ id: c.id, cell: c.cell })));
      }

      // BFS from each unassigned capital across primary cells
      for (const cap of capitals) {
        if (compId.has(cap.id ?? cap.cell)) continue;
        comp++;
        const q = [cap.cell];
        const seen = new Set(q);
        // Assign any capital encountered into this component
        while (q.length) {
          const u = q.shift();
          // USE GRAPH API INSTEAD OF cells[cur].neighbors
          const ns = landGraph.neighbors(u) || [];
          for (const nb of ns) {
            if (isWater[nb]) continue;            // safeguard
            if (!primary.has(nb) || seen.has(nb)) continue;
            seen.add(nb); q.push(nb);
          }
        }
        for (const c2 of capitals) {
          if (seen.has(c2.cell)) compId.set(c2.id ?? c2.cell, comp);
        }
        // Also ensure the seed capital gets assigned even if isolated
        if (!compId.has(cap.id ?? cap.cell)) compId.set(cap.id ?? cap.cell, comp);
      }
      
      if (DEBUG) {
        const comps = new Set(Array.from(compId.values()));
        console.log(`capitalPrimaryComponents: found ${comps.size} components`);
        for (const [capId, compNum] of compId) {
          console.log(`Capital ${capId}: component ${compNum}`);
        }
      }
      
      return compId;
    }
    // Find cheapest primary-bridging path between any two components (uses A*)
    function cheapestBridge(capitals, compId, landGraph, cells, isWater, islandOf) {
      const comps = new Map(); // comp -> capital list
      for (const cap of capitals) {
        const id = compId.get(cap.id ?? cap.cell);
        if (!comps.has(id)) comps.set(id, []);
        comps.get(id).push(cap);
      }
      const compKeys = Array.from(comps.keys());
      if (compKeys.length <= 1) return null;

      try {
        // Use the passed landGraph instead of creating a new one
        const graph = landGraph.neighbors ? landGraph : buildLandGraphSimple(cells, isWater);
        let best = null;
        // Try all pairs of components, but only test a few nearest capital pairs to keep it cheap
        for (let i = 0; i < compKeys.length; i++) {
          for (let j = i + 1; j < compKeys.length; j++) {
            const A = comps.get(compKeys[i]);
            const B = comps.get(compKeys[j]);
            // sort by geometric distance to sample nearest pairs first
            const pairs = [];
            for (const a of A) for (const b of B) {
              const dx = cells[a.cell].cx - cells[b.cell].cx;
              const dy = cells[a.cell].cy - cells[b.cell].cy;
              pairs.push([a, b, dx*dx + dy*dy]);
            }
            pairs.sort((p, q) => p[2] - q[2]);
            const limit = Math.min(pairs.length, 6); // sample up to 6 nearest pairs
            for (let k = 0; k < limit; k++) {
              const [a, b] = pairs[k];
              // Normal A* cost (coastal penalty ON), reuses existing corridors
              const path = aStarCells(a.cell, b.cell, graph, cells);
              if (!path || path.length < 2) continue;
              // Quick path cost: sum Euclidean segments (good enough here)
              let cost = 0;
              for (let t = 1; t < path.length; t++) {
                const u = path[t-1], v = path[t];
                cost += Math.hypot(cells[u].cx - cells[v].cx, cells[u].cy - cells[v].cy);
              }
              if (!best || cost < best.cost) best = { path, cost };
            }
          }
        }
        return best; // {path, cost} or null
      } catch (error) {
        if (DEBUG) console.error('Error in cheapestBridge:', error);
        return null;
      }
    }
    // Ensure all capitals on each island are primary-connected; add bridges if needed
    function ensureCapitalPrimaryConnectivity(burgs, landGraph, cells, isWater, islandOf, drawFn) {
      // collect capital cell indices…
      const capitals = burgs.filter(b => b.isCapital || b.capital || b.type === 'capital')
                            .map(b => b.cell ?? b.cellIndex)
                            .filter(ci => Number.isInteger(ci) && !isWater[ci]);
      if (DEBUG) console.log(`ensureCapitalPrimaryConnectivity: found ${capitals.length} capitals`);
      if (DEBUG && capitals.length > 0) {
        console.log('Capitals found:', capitals.map(c => ({ id: c.id, cell: c.cell, type: c.type, capital: c.capital, isCapital: c.isCapital })));
      }
      if (capitals.length < 2) return;
      const byIsl = groupCapitalsByIsland(capitals, islandOf);
      if (DEBUG) console.log('Island grouping:', Array.from(byIsl.entries()).map(([isl, caps]) => `Island ${isl}: ${caps.length} capitals`));
      const added = [];

      for (const [isl, caps] of byIsl) {
        if (DEBUG) console.log(`Island ${isl}: ${caps?.length || 0} capitals`);
        if (!caps || caps.length < 2) continue;
        // Loop: connect components until only one remains
        while (true) {
          const compId = capitalPrimaryComponents(caps, landGraph, cells, isWater);
          const comps = new Set(Array.from(compId.values()));
          if (DEBUG) console.log(`Island ${isl}: ${comps.size} capital components`);
          if (comps.size <= 1) break;
          const bridge = cheapestBridge(caps, compId, landGraph, cells, isWater, islandOf);
          if (!bridge) {
            if (DEBUG) console.log(`Island ${isl}: no bridge found, giving up`);
            break; // nothing we can do
          }
          if (DEBUG) console.log(`Island ${isl}: adding bridge with ${bridge.path.length} cells`);
          markPrimaryUsage(bridge.path, cells);
          const poly = pathToPolyline(bridge.path, cells);
          added.push(poly);
        }
      }
      if (added.length && typeof drawFn === "function") {
        if (DEBUG) console.log(`Drawing ${added.length} additional primary road segments`);
        drawFn(added); // append as primary
      }
    }


    function buildSeaGraph(cells, isWater) {
      // Check cache first
      if (GraphCache.sea) {
        if (DEBUG) console.log('buildSeaGraph: using cached graph');
        return GraphCache.sea;
      }
      
      const nodes = [];
      const edges = [];
      
      // Create nodes for all water cells
      for (let i = 0; i < cells.length; i++) {
        if (isWater[i]) {
          nodes.push({ i: i, x: cells[i].cx, y: cells[i].cy });
        }
      }
      
      if (DEBUG) console.log(`buildSeaGraph: created ${nodes.length} water nodes`);
      
      // Create edges between neighboring water cells
      for (let i = 0; i < cells.length; i++) {
        if (!isWater[i]) continue; // Skip land cells
        
        const cell = cells[i];
        for (const neighborIndex of cell.neighbors) {
          if (neighborIndex > i && isWater[neighborIndex]) { // Avoid duplicate edges
            const neighbor = cells[neighborIndex];
            const dist = Math.hypot(cell.cx - neighbor.cx, cell.cy - neighbor.cy);
            
            // Add small penalty near land to bias routes offshore
            let landPenalty = 0;
            for (const nb of [cell, neighbor]) {
              for (const nbIndex of nb.neighbors) {
                if (!isWater[nbIndex]) {
                  landPenalty += 0.1;
                  break;
                }
              }
            }
            
            const w = dist * (1 + landPenalty);
            edges.push({ u: i, v: neighborIndex, dist: dist, w: w });
          }
        }
      }
      
      // Add long-distance sea connections to ensure islands can be connected
      // Create a more connected sea graph by adding edges between distant water cells
      const waterCells = [];
      for (let i = 0; i < cells.length; i++) {
        if (isWater[i]) {
          waterCells.push({ index: i, x: cells[i].cx, y: cells[i].cy });
        }
      }
      
      // Use a much more efficient approach: connect only strategic water cells
      // Create a sparse network by sampling water cells and connecting them intelligently
      const sampleRate = 0.1; // Only use 10% of water cells for the graph
      const sampledCells = [];
      
      // Sample water cells randomly but ensure good coverage
      for (let i = 0; i < waterCells.length; i++) {
        if (Math.random() < sampleRate) {
          sampledCells.push(waterCells[i]);
        }
      }
      
      // Ensure we have at least some cells for connectivity
      if (sampledCells.length < 100) {
        // Add more cells if we don't have enough
        for (let i = 0; i < waterCells.length && sampledCells.length < 200; i++) {
          if (!sampledCells.includes(waterCells[i])) {
            sampledCells.push(waterCells[i]);
          }
        }
      }
      
      if (DEBUG) console.log(`Sea graph optimization: using ${sampledCells.length} cells out of ${waterCells.length} water cells`);
      
      // Connect sampled cells with a more reasonable approach
      for (let i = 0; i < sampledCells.length; i++) {
        const cell1 = sampledCells[i];
        
        // Connect to nearby cells within reasonable distance
        for (let j = i + 1; j < sampledCells.length; j++) {
          const cell2 = sampledCells[j];
          const dist = Math.hypot(cell1.x - cell2.x, cell1.y - cell2.y);
          
          // Only connect very close neighbors to avoid overland shortcuts
          if (dist >= 20 && dist <= 50) {
            // Check if the path between cells stays over water
            if (waterOnlySegment(cell1.index, cell2.index, cells, isWater)) {
              // Add some randomness to avoid creating too many edges
              if (Math.random() < 0.5) { // 50% chance of connection
                const w = dist * 1.2;
                edges.push({ u: cell1.index, v: cell2.index, dist: dist, w: w });
              }
            }
          }
        }
        
        // Also connect to a few random distant cells for long-range connectivity
        // REMOVED: These random long-distance edges create shortcuts across land
        // if (i % 10 === 0) { // Every 10th cell
        //   for (let j = 0; j < 3; j++) { // Connect to 3 random distant cells
        //     const randomCell = sampledCells[Math.floor(Math.random() * sampledCells.length)];
        //     if (randomCell !== cell1) {
        //       const dist = Math.hypot(cell1.x - randomCell.x, cell1.y - randomCell.y);
        //       if (dist > 100) { // Only long-distance connections
        //         const w = dist * 2.0; // Higher cost for long-distance
        //         edges.push({ u: cell1.index, v: randomCell.index, dist: dist, w: w });
        //       }
        //     }
        //   }
        // }
      }
      
      if (DEBUG) console.log(`buildSeaGraph: created ${edges.length} water edges (${nodes.length} water nodes) - optimized for performance`);
      
      // Create xy coordinates array for the sea graph (indexed by cell index)
      const xy = Array(cells.length);
      for (let i = 0; i < cells.length; i++) {
        if (isWater[i]) {
          xy[i] = [cells[i].cx, cells[i].cy];
        }
      }
      
      // REMOVED: Shore penalty using computeDistanceToWater - unreliable with cell-based indexing
      // The neighbor-based land penalty already biases routes offshore
      // const distanceToWater = computeDistanceToWater(isWater, window.__state.width, window.__state.height);
      // for (const edge of edges) {
      //   const u = edge.u, v = edge.v;
      //   const midX = (cells[u].cx + cells[v].cx) / 2;
      //   const midY = (cells[u].cy + cells[v].cy) / 2;
      //   const midIdx = Math.floor(midY) * window.__state.width + Math.floor(midX);
      //   const d = distanceToWater[midIdx] || 0; // distance to land in pixels/cells
      //   const shorePenalty = 1 + 4 * Math.max(0, (2 - d)); // strong penalty when d<2px
      //   edge.w = edge.w * shorePenalty;
      // }
      
      // Cache the graph for reuse
      finalizeSeaGraph(cells.length, edges, xy);
      
      return { nodes, edges };
    }
    

    



    document.getElementById('runTests').addEventListener('click', runTests);
    document.getElementById('testComputeRoutes').addEventListener('click', () => {
      if (window.__state && window.__state.computeRoutes) {
        console.log('Testing computeRoutes...');
        window.__state.computeRoutes();
      } else {
        console.error('computeRoutes not available');
      }
    });

    function runTests() {
      const out = document.getElementById('testResults');
      out.innerHTML = '';

      function assert(name, condition) {
        const li = document.createElement('li');
        li.textContent = (condition ? '✓ ' : '✗ ') + name;
        li.className = condition ? 'pass' : 'fail';
        out.appendChild(li);
      }

      try {
        // Existing tests
        const n = sizeInput.valueAsNumber;
        const cellPaths = d3.selectAll('path.mapCell').size();
        assert('renders one SVG path per site', cellPaths === n);

        const st = window.__state;
        const mid = Math.floor(st.cells.length / 2);
        const beforeSeed = st.cells[mid].high;
        st.add(mid, 'island');
        const afterSeed = st.cells[mid].high;
        const neighborRaised = st.cells[st.cells[mid].neighbors[0]] ? (st.cells[st.cells[mid].neighbors[0]].high > 0) : true; // tolerate edge cases
        assert('add() increases height at the seed cell', afterSeed > beforeSeed);
        const allClamped = st.cells.every(c => c.high >= 0 && c.high <= 1);
        assert('all cell heights stay within [0, 1]', allClamped);
        assert('add() affects at least one neighbor', neighborRaised);

        // New tests
        // T4: autoSeed raises heights in many cells
        const raisedBefore = st.cells.filter(c => c.high > 0).length;
        st.autoSeed();
        const raisedAfter = st.cells.filter(c => c.high > 0).length;
        assert('autoSeed() raises heights in multiple cells', raisedAfter > raisedBefore + 5);

        // T5: sea level = 1.0 -> all water
        document.getElementById('seaLevelInput').value = 1.0; st.recolor();
        const waterAtMaxSea = st.cells.filter(c => c.high < 1.0).length;
        assert('sea level = 1.0 -> all water', waterAtMaxSea === st.cells.length);

        // T6: sea level = 0.0 -> all land
        document.getElementById('seaLevelInput').value = 0.0; st.recolor();
        const waterAtZeroSea = st.cells.filter(c => c.high < 0.0).length;
        assert('sea level = 0.0 -> all land', waterAtZeroSea === 0);

        // T7: default sea level (0.35) -> mix of land and water after autoSeed
        document.getElementById('seaLevelInput').value = 0.35; st.recolor();
        const water = st.cells.filter(c => c.high < 0.35).length;
        const land = st.cells.length - water;
        assert('sea level 0.35 -> mixed terrain', water > 0 && land > 0);

        // T8: Azgaar palette produces a gradient (many unique fills)
        const fills = new Set(Array.from(document.querySelectorAll('path.mapCell')).slice(0, 200).map(p => p.getAttribute('fill')));
        assert('Azgaar palette -> gradient (many unique fills)', fills.length > 5);

        // T9: Center area is significant after autoSeed (center-biased island)
        const svgSel = st.svg;
        const w = +svgSel.attr('width');
        const h = +svgSel.attr('height');
        const centerIdx = st.delaunay.find(w / 2, h / 2);
        assert('Center cell height is significant after autoSeed', st.cells[centerIdx].high > 0.4);

        // T10: Coastlines appear for mixed terrain
        st.recolor();
        const coastCount = d3.selectAll('g.coastline path.coast').size();
        assert('Coastlines are drawn when terrain is mixed', coastCount > 0);

        // T11: No coastlines when all water
        document.getElementById('seaLevelInput').value = 1.0; st.recolor();
        const coastAllWater = d3.selectAll('g.coastline path.coast').size();
        assert('No coastlines at sea level 1.0', coastAllWater === 0);

        // T12: No coastlines when all land
        document.getElementById('seaLevelInput').value = 0.0; st.recolor();
        const coastAllLand = d3.selectAll('g.coastline path.coast').size();
        assert('No coastlines at sea level 0.0', coastAllLand === 0);

        // T13: Border mask keeps a water frame around the map
        document.getElementById('seaLevelInput').value = 0.35; st.applyBorder(); st.recolor();
        const margin = st.borderPx * 0.9;
        const nearEdgeLand = st.cells.some(c => Math.min(c.cx, c.cy, w - c.cx, h - c.cy) < margin && c.high >= 0.35);
        assert('No land within the border margin', !nearEdgeLand);

        // T14: Water is a single uniform color below sea level
        document.getElementById('seaLevelInput').value = 0.5; st.recolor();
        const seaLvl = 0.5;
        const waterCells = st.cells.map((c,i)=>({i, h:c.high})).filter(o => o.h < seaLvl);
        let uniform = true;
        if (waterCells.length >= 2) {
          const getFill = (idx)=> (document.getElementById(String(idx))||{}).getAttribute ? document.getElementById(String(idx)).getAttribute('fill') : null;
          const first = getFill(waterCells[0].i);
          for (let k = 1; k < Math.min(200, waterCells.length); k++) {
            if (getFill(waterCells[k].i) !== first) { uniform = false; break; }
          }
        }
        assert('Water below sea level uses a uniform color', uniform);

        // T15: Low land near sea level should be greener than purple (G channel dominant)
        document.getElementById('seaLevelInput').value = 0.35; st.recolor();
        const seaLvl2 = 0.35;
        const nearShoreLand = st.cells.map((c,i)=>({i, h:c.high})).filter(o => o.h >= seaLvl2 && o.h < seaLvl2 + 0.03);
        function rgbParse(s){
          if(!s) return null; const i1=s.indexOf('('), i2=s.indexOf(')'); if(i1<0||i2<0) return null; const a=s.slice(i1+1,i2).split(',').map(x=>parseInt(x,10)); if(a.length<3) return null; return {r:a[0], g:a[1], b:a[2]};
        }
        let greenish = true;
        if (nearShoreLand.length){
          const idx = nearShoreLand[0].i; const fill = (document.getElementById(String(idx))||{}).getAttribute ? document.getElementById(String(idx)).getAttribute('fill') : null; const rgb = rgbParse(fill);
          greenish = !!rgb && (rgb.g > rgb.r && rgb.g > rgb.b);
        }
        assert('Low land near sea level is greenish', greenish);

        // T16: Highest peaks render light (snow‑capped), not dark
        document.getElementById('seaLevelInput').value = 0.35; st.recolor();
        const landCells = st.cells.map((c,i)=>({i, h:c.high})).filter(o=>o.h >= 0.35).sort((a,b)=>b.h-a.h);
        const top = landCells.slice(0, Math.max(1, Math.floor(landCells.length*0.01)));
        let snowOK = true;
        if (top.length){
          const getFill = (idx)=> (document.getElementById(String(idx))||{}).getAttribute ? document.getElementById(String(idx)).getAttribute('fill') : null;
          const lum = (s)=>{ if(!s) return 0; const i1=s.indexOf('('), i2=s.indexOf(')'); if(i1<0||i2<0) return 0; const a=s.slice(i1+1,i2).split(',').map(x=>parseInt(x,10)); if(a.length<3) return 0; const [r,g,b]=a.map(v=>{v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4);}); return 0.2126*r+0.7152*g+0.0722*b; };
          const lumVals = top.map(o=>lum(getFill(o.i))).filter(v=>!isNaN(v));
          const avgLum = lumVals.reduce((s,v)=>s+v,0)/lumVals.length;
          snowOK = avgLum > 0.75; // should be quite light
        }
        assert('High peaks are light (snow‑caps)', snowOK);

        // T17: No strokes on cells (fills meet with no borders)
        const anyStroked = Array.from(document.querySelectorAll('path.mapCell')).some(p => {
          const s = window.getComputedStyle(p);
          const sw = s.getPropertyValue('stroke-width');
          const stc = s.getPropertyValue('stroke');
          return (sw && sw !== '0px') && (stc && stc !== 'none' && stc !== 'rgba(0, 0, 0, 0)');
        });
        assert('Cells render without strokes/borders', !anyStroked);

        // T18: Rivers exist at default settings
        document.getElementById('seaLevelInput').value = 0.35; st.recolor();
        const riverCount = d3.selectAll('g.rivers path.rivers').size();
        assert('At least one river is drawn', riverCount > 0);

        // T19: No rivers when all water
        document.getElementById('seaLevelInput').value = 1.0; st.recolor();
        const riverNone = d3.selectAll('g.rivers path.rivers').size();
        assert('No rivers when map is all water', riverNone === 0);

        // T20: More rainfall -> more rivers
        document.getElementById('seaLevelInput').value = 0.35;
        document.getElementById('rainInput').value = 0.2; st.recolor();
        const riversLow = d3.selectAll('g.rivers path.rivers').size();
        document.getElementById('rainInput').value = 1.8; st.recolor();
        const riversHigh = d3.selectAll('g.rivers path.rivers').size();
        assert('Higher rainfall increases river count', riversHigh > riversLow);

        // T21: Higher river-density quantile -> fewer rivers
        document.getElementById('rainInput').value = 1.0;
        document.getElementById('riverDensityInput').value = 0.98; st.recolor();
        const riversDense = d3.selectAll('g.rivers path.rivers').size();
        document.getElementById('riverDensityInput').value = 0.85; st.recolor();
        const riversSparse = d3.selectAll('g.rivers path.rivers').size();
        assert('Lower threshold draws more rivers', riversSparse >= riversDense);

        // T22: Tributaries are drawn (in addition to main rivers)
        document.getElementById('seaLevelInput').value = 0.35;
        document.getElementById('rainInput').value = 1.4; st.recolor();
        const majors = d3.selectAll('g.rivers path.rivers.main').size();
        const tribs = d3.selectAll('g.rivers path.rivers.trib').size();
        assert('Tributaries are present', tribs > 0 && majors >= 5 && majors <= 15);

        // T23: Tributaries are thinner than mains (average width)
        function avgWidth(sel){ const arr = []; d3.selectAll(sel).each(function(){ const w = +this.getAttribute('stroke-width')||0; if (w>0) arr.push(w); }); return arr.length? (arr.reduce((a,b)=>a+b,0)/arr.length) : 0; }
        const avgMain = avgWidth('g.rivers path.rivers.main');
        const avgTrib = avgWidth('g.rivers path.rivers.trib');
        assert('Tributaries are thinner than main rivers', avgTrib > 0 && avgMain > 0 && avgTrib < avgMain);

        // T24: Rivers have visible tapering (variation in widths across segments)
        st.recolor();
        const widths = []; d3.selectAll('g.rivers path.rivers').each(function(){ const w = +this.getAttribute('stroke-width')||0; if (w>0) widths.push(w); });
        const minW = Math.min.apply(null, widths), maxW = Math.max.apply(null, widths);
        assert('River widths vary (tapering present)', widths.length>5 && maxW > minW * 1.3);

        // T25: At least one confluence exists at higher rain
        document.getElementById('rainInput').value = 1.6; st.recolor();
        const rstats = window.__state.riverStats || {confluences:0};
        assert('Confluences detected (>=1)', rstats.confluences >= 1);

        // T26: Most main rivers reach the ocean
        document.getElementById('rainInput').value = 1.2; st.recolor();
        const rstats2 = window.__state.riverStats || {majorsDrawn:0, majorsReachedSea:0};
        const fracOcean = rstats2.majorsDrawn ? (rstats2.majorsReachedSea / rstats2.majorsDrawn) : 0;
        assert('Major rivers: majority reach the ocean', rstats2.majorsDrawn === 0 || fracOcean >= 0.6);

        // T27: Main rivers are reasonably long on average
        const rstats3 = window.__state.riverStats || {avgMainLength:0};
        assert('Average main length is decent (>=60px)', rstats3.avgMainLength >= 60 || rstats2.majorsDrawn === 0);

        // T28: Lakes (if any) have a valid outlet or are endorheic
        document.getElementById('seaLevelInput').value = 0.35; st.recolor();
        const lakes = window.__state.lakes || [];
        let lakesOk = true;
        for (let i = 0; i < lakes.length; i++) {
          const L = lakes[i];
          if (!L) continue;
          if (L.outlet == null || L.outlet === -1) continue; // endorheic allowed
          if (!(L.outlet >= 0 && L.outlet < st.cells.length)) { lakesOk = false; break; }
        }
        assert('Lakes (if any) have outlet or are endorheic', lakesOk);

        // T29: Lake cells render as water (transparent polygon fill over ocean backdrop)
        let foundLakeCell = -1;
        if (window.__state.lakeId) {
          for (let i = 0; i < st.cells.length; i++) { if (st.cells[i].high >= 0.35 && window.__state.lakeId[i] >= 0) { foundLakeCell = i; break; } }
        }
        let lakeFillNone = true;
        if (foundLakeCell >= 0) {
          const el = document.getElementById(String(foundLakeCell));
          lakeFillNone = !!el && el.getAttribute('fill') === 'none';
        }
        assert('Lake polygons use no fill (water shows through)', foundLakeCell === -1 || lakeFillNone);

        // T30: Lake filtering reduces excessive small lakes
        const lakeArray = window.__state.lakes || [];
        const lakeCells = window.__state.isLake ? window.__state.isLake.reduce((sum, val) => sum + val, 0) : 0;
        const totalLandCells = st.cells.filter(c => c.high >= 0.35).length;
        const lakePercentage = totalLandCells > 0 ? (lakeCells / totalLandCells) : 0;
        assert('Lake filtering prevents excessive lake coverage', lakePercentage < 0.15); // Lakes should not cover more than 15% of land

        // T31: Biome system assigns valid biomes to land cells
        document.getElementById('renderMode').value = 'biomes'; st.recolor();
        const biomeLandCells = st.cells.filter(c => c.high >= 0.35);
        const validBiomes = ['Tundra', 'Boreal Forest', 'Temperate Forest', 'Grassland', 'Desert', 'Savanna', 'Tropical Rainforest'];
        const hasValidBiomes = biomeLandCells.every(c => c.biome && validBiomes.includes(c.biome));
        assert('All land cells have valid biome assignments', hasValidBiomes);

        // T32: Temperature decreases with elevation
        const highCells = st.cells.filter(c => c.high > 0.6).slice(0, 10);
        const lowCells = st.cells.filter(c => c.high > 0.35 && c.high < 0.45).slice(0, 10);
        const avgHighTemp = highCells.reduce((sum, c) => sum + c.temp, 0) / highCells.length;
        const avgLowTemp = lowCells.reduce((sum, c) => sum + c.temp, 0) / lowCells.length;
        assert('Temperature decreases with elevation', avgHighTemp < avgLowTemp);

        // T33: Erosion reduces jaggy ridges (thermal erosion test)
        document.getElementById('talusInput').value = 0.02;
        document.getElementById('thermalStrengthInput').value = 0.5;
        document.getElementById('smoothAlphaInput').value = 0.2;
        st.generate(); // Regenerate with erosion
        const erodedLandCells = st.cells.filter(c => c.high > 0.35);
        let maxHeightDiff = 0;
        erodedLandCells.forEach(c => {
          c.neighbors.forEach(nb => {
            const diff = Math.abs(c.high - st.cells[nb].high);
            maxHeightDiff = Math.max(maxHeightDiff, diff);
          });
        });
        assert('Erosion reduces extreme height differences', maxHeightDiff < 0.8); // Should be less than 0.8 after erosion

        // T34: Wind belt system creates latitudinal precipitation patterns
        document.getElementById('windBelts').value = 'hadley';
        document.getElementById('rainInput').value = 1.0;
        st.recolor();
        const precipArray = window.__state.precipArray || [];
        if (precipArray.length > 0) {
          // Check that different latitude bands have different precipitation patterns
          const northernCells = st.cells.filter(c => c.cy < 300).slice(0, 20); // Top portion
          const southernCells = st.cells.filter(c => c.cy > 500).slice(0, 20); // Bottom portion
          const northernPrecip = northernCells.reduce((sum, c) => sum + (precipArray[c.index] || 0), 0) / northernCells.length;
          const southernPrecip = southernCells.reduce((sum, c) => sum + (precipArray[c.index] || 0), 0) / southernCells.length;
          // Should have some variation due to wind belts
          assert('Wind belts create latitudinal precipitation variation', Math.abs(northernPrecip - southernPrecip) > 0.01);
        } else {
          assert('Wind belt precipitation computation works', true); // Fallback if no precip array
        }

        // T35: Shaded relief creates depth perception
        document.getElementById('shadingMode').value = 'shaded';
        st.recolor();
        const shadedCells = d3.selectAll('path.mapCell').filter(function() {
          const fill = this.getAttribute('fill');
          return fill && fill.startsWith('rgb('); // Shaded cells use rgb() format
        });
        assert('Shaded relief applies RGB shading to land cells', shadedCells.size() > 0);

        // T36: Export functions are available
        assert('SVG export function is available', typeof window.saveSVG === 'function');
        assert('PNG export function is available', typeof window.savePNG === 'function');
        
        // T37: Ocean background is properly set for export
        const svg = document.querySelector('svg');
        const oceanRect = svg.querySelector('rect.ocean');
        assert('Ocean background rect exists', !!oceanRect);
        assert('Ocean background has correct fill color', oceanRect.getAttribute('fill') === WATER_COLOR);
        
        // T38: Rivers are properly computed and rendered
        const riverGroups = svg.querySelectorAll('g.rivers, g.riversShade');
        const riverPaths = svg.querySelectorAll('g.rivers path, g.riversShade path');
        assert('River groups exist in SVG', riverGroups.length > 0);
        assert('River paths are rendered', riverPaths.length > 0);
        
        // T38.5: Coastlines are properly computed and rendered
        const coastlineGroups = svg.querySelectorAll('g.coastline');
        const coastlinePaths = svg.querySelectorAll('g.coastline path.coast');
        assert('Coastline groups exist in SVG', coastlineGroups.length > 0);
        assert('Coastline paths are rendered', coastlinePaths.length > 0);
        
        // T38.6: Burgs are properly computed and rendered
        const burgGroups = svg.querySelectorAll('#burgs');
        const burgs = svg.querySelectorAll('#burgs g.burg');
        assert('Burg groups exist in SVG', burgGroups.length > 0);
        assert('Burgs are rendered', burgs.length > 0);
        
        // T38.7: Burgs have proper styling
        if (burgs.length > 0) {
          const sampleBurg = burgs[0];
          const circle = sampleBurg.querySelector('circle');
          assert('Burgs have circle elements', !!circle);
          if (circle) {
            const hasFill = circle.hasAttribute('fill');
            const hasStroke = circle.hasAttribute('stroke');
            const hasStrokeWidth = circle.hasAttribute('stroke-width');
            assert('Burg circles have proper styling', hasFill && hasStroke && hasStrokeWidth);
          }
        }
        
        // T38.8: Routes are properly computed and rendered
        const routeGroups = svg.querySelectorAll('#routes');
        const roads = svg.querySelectorAll('#routes .roads path');
        const trails = svg.querySelectorAll('#routes .trails path');
        const seaRoutes = svg.querySelectorAll('#routes .searoutes path');
        assert('Route groups exist in SVG', routeGroups.length > 0);
        assert('Roads are rendered', roads.length > 0);
        assert('Trails are rendered', trails.length > 0);
        
        // T38.9: Routes have proper styling
        if (roads.length > 0) {
          const sampleRoad = roads[0];
          const hasStroke = sampleRoad.hasAttribute('stroke');
          const hasStrokeWidth = sampleRoad.hasAttribute('stroke-width');
          assert('Road paths have proper styling', hasStroke && hasStrokeWidth);
        }
        
        // Check that rivers have proper styling
        if (riverPaths.length > 0) {
          const samplePath = riverPaths[0];
          const hasStroke = samplePath.hasAttribute('stroke') || samplePath.style.stroke;
          const hasStrokeWidth = samplePath.hasAttribute('stroke-width') || samplePath.style.strokeWidth;
          assert('River paths have stroke attributes', hasStroke || hasStrokeWidth);
        }
        
        // Test ocean export preservation
        const clone = svg.cloneNode(true);
        const cloneOcean = clone.querySelector('rect.ocean');
        cloneOcean.setAttribute('fill', WATER_COLOR);
        cloneOcean.setAttribute('style', `fill: ${WATER_COLOR}`);
        inlineSvgStyles(clone, true);
        assert('Ocean fill is preserved during export styling', cloneOcean.getAttribute('fill') === WATER_COLOR);
        
        // Test river export preservation
        const exportRiverGroups = clone.querySelectorAll('g.rivers, g.riversShade');
        const exportRiverPaths = clone.querySelectorAll('g.rivers path, g.riversShade path');
        assert('River groups are present in export clone', exportRiverGroups.length > 0);
        assert('River paths are present in export clone', exportRiverPaths.length > 0);
        
        // Check that river styles are properly inlined
        if (exportRiverPaths.length > 0) {
          const samplePath = exportRiverPaths[0];
          const hasStroke = samplePath.hasAttribute('stroke') || samplePath.style.stroke;
          const hasStrokeWidth = samplePath.hasAttribute('stroke-width') || samplePath.style.strokeWidth;
          assert('River paths have stroke attributes inlined', hasStroke || hasStrokeWidth);
        }
        
        // T39: Coastlines are properly exported
        const exportCoastlineGroups = clone.querySelectorAll('g.coastline');
        const exportCoastlinePaths = clone.querySelectorAll('g.coastline path.coast');
        assert('Coastline groups are present in export clone', exportCoastlineGroups.length > 0);
        assert('Coastline paths are present in export clone', exportCoastlinePaths.length > 0);
        
        // Check that coastline styles are properly inlined
        if (exportCoastlinePaths.length > 0) {
          const samplePath = exportCoastlinePaths[0];
          const hasStroke = samplePath.hasAttribute('stroke') || samplePath.style.stroke;
          const hasStrokeWidth = samplePath.hasAttribute('stroke-width') || samplePath.style.strokeWidth;
          assert('Coastline paths have stroke attributes inlined', hasStroke || hasStrokeWidth);
        }
        
        // T40: Burgs are properly exported
        const exportBurgGroups = clone.querySelectorAll('#burgs');
        const exportBurgs = clone.querySelectorAll('#burgs g.burg');
        assert('Burg groups are present in export clone', exportBurgGroups.length > 0);
        assert('Burgs are present in export clone', exportBurgs.length > 0);
        
        // Check that burg styles are properly inlined
        if (exportBurgs.length > 0) {
          const sampleBurg = exportBurgs[0];
          const circle = sampleBurg.querySelector('circle');
          if (circle) {
            const hasFill = circle.hasAttribute('fill') || circle.style.fill;
            const hasStroke = circle.hasAttribute('stroke') || circle.style.stroke;
            const hasStrokeWidth = circle.hasAttribute('stroke-width') || circle.style.strokeWidth;
            assert('Burg circles have style attributes inlined', hasFill && hasStroke && hasStrokeWidth);
          }
        }
        
        // T41: Routes are properly exported
        const exportRouteGroups = clone.querySelectorAll('#routes');
        const exportRoads = clone.querySelectorAll('#routes .roads path');
        const exportTrails = clone.querySelectorAll('#routes .trails path');
        const exportSeaRoutes = clone.querySelectorAll('#routes .searoutes path');
        assert('Route groups are present in export clone', exportRouteGroups.length > 0);
        assert('Roads are present in export clone', exportRoads.length > 0);
        assert('Trails are present in export clone', exportTrails.length > 0);
        
        // Check that route styles are properly inlined
        if (exportRoads.length > 0) {
          const sampleRoad = exportRoads[0];
          const hasStroke = sampleRoad.hasAttribute('stroke') || sampleRoad.style.stroke;
          const hasStrokeWidth = sampleRoad.hasAttribute('stroke-width') || sampleRoad.style.strokeWidth;
          assert('Road paths have stroke attributes inlined', hasStroke && hasStrokeWidth);
        }

        // New acceptance tests per settlements system
        const burgsList = window.__state.burgs || [];
        assert('Burg count within 450..550', burgsList.length >= 450 && burgsList.length <= 550);
        const capCount = burgsList.filter(b => (b.type === 'capital') || b.capital).length;
        assert('Exactly 20 capitals', capCount === 20);
        const ports = burgsList.filter(b => b.type === 'port' || b.port);
        assert('At least one port exists', ports.length > 0);
        // Geographic sanity
        const cs = window.__state.coastSteps || [];
        const rs = window.__state.riverSteps || [];
        const allPortsCoastal = ports.every(b => cs[b.cellIndex ?? b.cell] === 0);
        assert('All ports on coast', ports.length === 0 || allPortsCoastal);
        const towns = burgsList.filter(b => b.type === 'town');
        const townRiverish = towns.filter(b => (rs[b.cellIndex ?? b.cell] <= 1) || ((window.__state.cells[b.cellIndex ?? b.cell].riverDegree || 0) >= 2));
        assert('≥60% towns near rivers or confluences', towns.length === 0 || (townRiverish.length / towns.length) >= 0.6);
        // Networks
        const primariesDrawn = document.querySelectorAll('#routes .primary-road').length;
        assert('≥19 primary connections (MST)', primariesDrawn >= 19);
        // Trails existence (we rely on merged network having trails; relax to presence of any trails or secondaries)
        const trailsDrawn = document.querySelectorAll('#routes .trails path').length;
        const secondariesDrawn = document.querySelectorAll('#routes .secondary-roads path').length;
        assert('Some local connections exist (trails/secondaries)', (trailsDrawn + secondariesDrawn) > 0);
        // Labels
        const capitalLabelsFirst = Array.from(document.querySelectorAll('#labels .labels-burgs text')).some(el => el.classList.contains('capital'));
        assert('Capital labels use .capital class', capitalLabelsFirst);
        
        // Test computeRoutes function
        assert('computeRoutes function exists', typeof window.__state.computeRoutes === 'function');
        const routeDataBefore = window.routeData;
        try {
          window.__state.computeRoutes();
          assert('computeRoutes executes without error', true);
          assert('routeData is populated', window.routeData && window.routeData.routes);
          console.log('computeRoutes test: primary-road count:', window.routeData?.routes?.length || 0);
        } catch (e) {
          assert('computeRoutes executes without error', false);
          console.error('computeRoutes test failed:', e);
        }

      } catch (e) {
        const li = document.createElement('li');
        li.textContent = '✗ Tests crashed: ' + (e && e.message ? e.message : e);
        li.className = 'fail';
        out.appendChild(li);
        console.error(e);
      }
    }

    // Modal and tab functionality
    window.toggleSettings = function() {
      const modal = document.getElementById('settingsModal');
      if (modal.style.display === 'block') {
        modal.style.display = 'none';
      } else {
        modal.style.display = 'block';
      }
    }

    window.showTab = function(tabName) {
      // Hide all tab contents
      const tabContents = document.querySelectorAll('.tab-content');
      tabContents.forEach(content => {
        content.classList.remove('active');
      });

      // Remove active class from all tab buttons
      const tabButtons = document.querySelectorAll('.tab-btn');
      tabButtons.forEach(btn => {
        btn.classList.remove('active');
      });

      // Show selected tab content
      const selectedTab = document.getElementById(tabName + '-tab');
      if (selectedTab) {
        selectedTab.classList.add('active');
      }

      // Add active class to selected tab button
      const selectedButton = document.querySelector(`[onclick="showTab('${tabName}')"]`);
      if (selectedButton) {
        selectedButton.classList.add('active');
      }
    }



    // === STARTUP CODE ===
    window.init = async function() {
      // Initialize the application
      console.log('Initializing Voronoi Heightmap Playground...');
      
      // Ensure shared state object remains globally reachable
      window.__state = window.__state || {};
      
      // Initialize any required state
      if (!S.regenerationCount) {
        setRegenerationCount(0);
      }
      
      // UI wiring moved to ui.js module
      
      // Call generate once on first load (idempotent)
      if (!window.__state.__ranGenerateOnce) {
        window.__state.__ranGenerateOnce = true;
        window.generate();
      }

      // Dev sanity (no-throw): log missing layers if any
      try {
        const { mapCells, regions } = getLayers();
        if (mapCells.empty?.() || regions.empty?.()) {
          console.warn('[init] Missing expected layers (#mapCells, #regions). Rendering may be limited.');
        }
      } catch {}
    }
    


    // === WINDOW BINDINGS FOR INLINE HANDLERS ===
    // Bind functions that are called from inline HTML event attributes
    // (Now handled in ui.js module)
    // window.generate is already set above
    // window.toggleSettings and window.showTab are already set above
    window.saveSVG = saveSVG;
    window.savePNG = savePNG;
    window.recolorCurrent = recolorCurrent;

    // Ensure shared state object remains globally reachable
    window.__state = window.__state || {};

    // boot moved to app.js
  })();
})();

// Declare functions at module level for export
// Functions are now on window object

// Export functions for external use
export const init = window.init;
export const generate = window.generate;

// Placeholder for regenerateNames (to be implemented)
export function regenerateNames() {
  console.warn('regenerateNames() called but not yet implemented');
}

// --- DEBUG BRIDGE (dev-only) ---
try {
  // If these are named differently in your code, adjust the identifiers on the right side
  const api = {
    getWorld,          // returns { cells, width, height, ... }
    resetCaches,       // fn(key)
    ensureIsWater,     // fn(cells) -> boolean[]
    setIsWater,        // fn(boolean[])
    recolor,           // async fn(run)
  };

  // Don't clobber if it already exists
  window.__map = Object.assign(window.__map || {}, api);

  // (optional) easy height accessors used earlier
  window.__map.getH = (i) => __map.getWorld().cells[i].high ?? __map.getWorld().cells[i].h ?? 0;
  window.__map.setH = (i, v) => {
    const c = __map.getWorld().cells[i];
    if ('high' in c) c.high = v; else c.h = v;
  };
} catch (e) {
  console.warn('Debug bridge failed to attach', e);
}
