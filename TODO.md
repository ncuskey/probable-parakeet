# TODO List

## P6 — Yielding in burg seeding

- [x] Open seedBurgCandidates and make it async
- [x] Introduce a tiny scheduler helper near the function:
  ```javascript
  const yieldNow = () => new Promise(requestAnimationFrame);
  ```
- [x] In the main placement loop (iterating ranked or similar), add an 8ms budget and await yieldNow() when exceeded:
  ```javascript
  let last = performance.now();
  for (let k = 0; k < ranked.length; k++) {
    // existing selection/placement logic…
    if (performance.now() - last > 8) {
      await yieldNow();
      last = performance.now();
    }
  }
  ```
- [x] Ensure the burgs pipeline awaits seedBurgCandidates(...) (and any function you turned async)
- [ ] Save and run; confirm the progress overlay advances and the UI stays responsive
- [x] (Optional) Update PERF.step to await thenables if it doesn't already

## P7 — Deduplicate generate() pipeline (fix burg hang)

- [x] Find all generate() blocks
- [x] Search for required steps in the pipeline:
  - [x] Build coastline rings timer
  - [x] Compute harbor scores timer  
  - [x] Seed burg candidates (adaptive quotas + per-region)
  - [x] Assign burg types/regions
  - [x] Scale populations
  - [x] Render regions / Render burg symbols / Render labels
- [x] Verify only one generate() function exists with all required steps
- [x] Add breadcrumb logging:
  - [x] console.log('BURG PIPELINE: start') before burg seeding
  - [x] console.log('BURG PIPELINE: end') after rendering burg labels
- [ ] Test and verify console shows proper sequence without hanging

## P8 — Unify seedBurgCandidates to one definition

- [x] Find all definitions
- [x] Search for required characteristics:
  - [x] Accepts (cells, isWater, suitability, capitals, CONFIG)
  - [x] Uses yielding helpers (await in loops)
  - [x] Is async function
- [x] Verify only one definition exists
- [x] Export for debug: window.__state.seedBurgCandidates = seedBurgCandidates
- [ ] Test that await PERF.step('Seed burg candidates…') executes and logs timing

## P9 — Remove lingering duplicate utility blocks

- [x] Find all definitions
- [x] Search for required characteristics:
  - [x] Accepts (cells, isWater, suitability, capitals, CONFIG)
  - [x] Uses yielding helpers (await in loops)
  - [x] Is async function
- [x] Verify only one definition exists
- [x] Export for debug: window.__state.seedBurgCandidates = seedBurgCandidates
- [ ] Test that await PERF.step('Seed burg candidates…') executes and logs timing

## P10 — Burg phase watchdog + progress resilience

- [x] Added 5-second watchdog timer to prevent burg phase from sticking
- [x] Added try/catch for burg pipeline with fallback to empty burg set
- [x] Ensured progress always advances to 'Rendering regions' after burg processing
- [ ] Test that progress never remains at 'Scoring and placing burgs' more than 5s

## P11 — Verify harbor/rings pre-step

- [x] Confirmed correct sequence: Build coastline rings → Compute harbor scores → Seed burg candidates
- [x] Verified no duplicate generate() calls or nested execution

## P12 — Make computeAndDrawRegions properly awaitable (fix rAF loop)

- [x] Wrapped rAF loop in Promise with proper resolve() in finished branch
- [x] Added REGION DRAW: start/end log guards for console visibility
- [x] Verified PERF.step detects AsyncFunction and awaits properly
- [ ] Test that await PERF.step('Render regions', …) truly waits for region drawing to finish

## P13 — Replace burg watchdog with Promise.race (advance pipeline)

- [x] Replaced setTimeout watchdog with Promise.race implementation
- [x] Implemented 5-second timeout with BURG_TIMEOUT = 5000
- [x] Added one-shot guard to prevent timeout from firing twice
- [x] Ensured pipeline continues to computeAndDrawRegions() even if seeding times out
- [x] Maintained UX feedback with ProgressManager.update(90, 'Rendering regions')
- [x] Preserved all existing burg processing when successful
- [ ] Test that "Rendering regions" never stalls due to slow burg seeding

## P19 — Global landGraph maps

- [x] Open index.html
- [x] Jump to ~L8988 (search function ensureLandGraphMaps())
- [x] Immediately after the function's closing brace, add:
  ```javascript
  // Expose for callers defined in other scopes
  if (typeof window !== 'undefined') window.ensureLandGraphMaps = ensureLandGraphMaps;
  ```
- [x] Jump to ~L2715 (search function computeRoutes())
- [x] In computeRoutes, replace the line that calls ensureLandGraphMaps with a global-safe call + fallback:
  ```javascript
  const ensureMaps =
    (typeof window !== 'undefined' && typeof window.ensureLandGraphMaps === 'function')
      ? window.ensureLandGraphMaps
      : function fallbackEnsureLandGraphMaps(landGraph, cells, isWater) {
          // Minimal enrichment so the rest of the pipeline works
          const nodes = [];
          const idOf = new Map();
                      for (let i = 0; i < cells.length; i++) {
              if (!isWater[i]) {
                const idx = nodes.length;
                nodes.push({ id: i, cellIndex: i, x: cells[i].cx, y: cells[i].cy });
                idOf.set(i, idx);
              }
            }
          const neighbors = (i) => (cells[i].neighbors || []).filter(j => !isWater[j]);
          return Object.assign(landGraph, { nodes, idOf, neighbors });
        };

  const landGraph = ensureMaps(landGraphRaw, cells, isWater);
  ```
- [x] Save & run
- [ ] Acceptance: No more "ensureLandGraphMaps is not defined"
- [ ] Acceptance: computeRoutes() vKNN runs; you see "primary-road count: N" (N may be 0+)
- [ ] Acceptance: Progress continues past routes without freezing

## P20 — Global route functions & defensive usage

- [x] Ensure exactly one global definition of ensureLandGraphMaps and buildBackboneRoads
- [x] Make both accessible as window.ensureLandGraphMaps and window.buildBackboneRoads
- [x] Ensure they are parsed before computeRoutes is called in the pipeline
- [x] Update computeRoutes to call window.ensureLandGraphMaps / window.buildBackboneRoads defensively
- [ ] Acceptance: No more "ensureLandGraphMaps is not defined" or "buildBackboneRoads is not defined" errors
- [ ] Acceptance: computeRoutes() vKNN still logs

## P21 — De-duplicate Routes System

- [x] Find all occurrences of `// --- Routes System ---`
- [x] Keep the most recent block where buildLandGraph has overload support, returns {nodes, edges, neighbors()}, and uses GraphCache.land
- [x] Remove older copies of buildLandGraph, ensureLandGraphMaps, buildBackboneRoads, and any duplicate computeRoutes variants
- [x] Ensure exactly one computeRoutes exists (the version logging `computeRoutes() vKNN` and using ProgressManager.update)
- [x] Acceptance: Global search shows exactly one occurrence of each function
- [x] Acceptance: Console has no "not defined" errors for these functions

## P22 — Patch computeAndDrawRegions

- [x] Remove any call or reference to `functionTimeout` inside computeAndDrawRegions
- [x] Keep the existing Promise wrapper and rAF budgeted loop
- [x] Ensure `resolve()` is called in the finished branch (we already log `REGION DRAW: end`)
- [x] Reset any `inProgress` guard at the end so "Region drawing already in progress" does not persist
- [x] Acceptance: No `functionTimeout is not defined` in console
- [x] Acceptance: We still see REGION DRAW: start → end each run
- [x] Acceptance: No lingering "Region drawing already in progress" unless genuinely re-entered mid-draw

## P23 — Safe exports for route functions

- [x] At the top of the main script (near other globals like GraphCache), add "safe exports":
      `window.ensureLandGraphMaps ||= undefined;`
      `window.buildBackboneRoads ||= undefined;`
- [x] After the actual function declarations (kept by P13/P14), assign:
      `window.ensureLandGraphMaps = ensureLandGraphMaps;`
      `window.buildBackboneRoads = buildBackboneRoads;`
- [x] In computeRoutes, call the helpers via window: 
      `(window.ensureLandGraphMaps || ensureLandGraphMaps)(...)`
      `(window.buildBackboneRoads || buildBackboneRoads)(...)`
- [x] Acceptance: No ReferenceError in routes even if script blocks reorder
- [x] Acceptance: Primary-road step completes (even if it yields zero routes)
- [x] Acceptance: `primary-road count:` logs without throwing

## P24 — Idempotency guard for computeRoutes

- [x] Add `let _routesInFlight = false;` at module scope near other globals
- [x] At the start of computeRoutes, if `_routesInFlight` is true, log and return early
- [x] Otherwise set `_routesInFlight = true;` and clear it in a finally block
- [x] Acceptance: Only one `computeRoutes() vKNN` appears per generation
- [x] Acceptance: No duplicated "Backbone roads failed" lines on a single run

## P25 — Add ensureRouteGroups and wire into computeRoutes

- [x] Add a small ensureRouteGroups() helper near computeRoutes that creates #routes and its sub-groups if missing
- [x] Update the render block in computeRoutes to call ensureRouteGroups() and draw into #routes .roads
- [x] Keep path class route so it inherits existing CSS styles
- [x] Log the rendered path count for quick sanity checking
- [x] Acceptance: No more ReferenceError: ensureRouteGroups is not defined
- [x] Acceptance: Console shows primary-road count: N followed by routes render: drew X paths
- [x] Acceptance: Primary roads appear under #routes .roads path.route and inherit existing styles

## P26 — Make computeRoutes render robust (fallbacks + correct group)

- [x] In computeRoutes, use ensureRouteGroups() and draw into #routes .roads (not .primary-roads)
- [x] Add safe local fallbacks for pathToPolyline and polylineToPathD
- [x] Keep path class route so existing CSS applies
- [x] Log how many paths rendered
- [x] Acceptance: No more ReferenceError: pathToPolyline is not defined
- [x] Acceptance: Console logs: primary-road count: N then routes render: drew X paths
- [x] Acceptance: Primary roads appear under #routes .roads path.route using existing CSS
