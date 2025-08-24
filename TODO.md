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

# TODO: UI Wiring Extraction

## ✅ Completed

### 1. Created js/ui.js
- [x] Created new ES module `js/ui.js` that exports `wireUI()` and `readUIParams()`
- [x] Implemented safe event binding with `bind()` helper function
- [x] Added handlers for all UI controls:
  - [x] Generate button (`generateBtn`)
  - [x] View toggle button (`viewToggleBtn`) 
  - [x] Settings button (`settingsBtn`)
  - [x] Seed input (`seedInput`) with Enter key support
  - [x] Sea level input (`seaLevelInput`) with auto-recolor
  - [x] World type select (`worldType`)
  - [x] Region count apply (`applyRegionCount`)
  - [x] Regenerate names (`regenNamesBtn`)
  - [x] Export buttons (SVG/PNG)
  - [x] Close button and modal controls
  - [x] Tab buttons
  - [x] Range inputs with output updates
  - [x] Select inputs (river style, wind belts, render mode, shading mode)
  - [x] Checkbox inputs (debug operations)
- [x] Added safe guards for missing elements and functions
- [x] Exposed `recolorCurrent` globally in legacy-main.js

### 2. Updated js/app.js
- [x] Added import for `wireUI` from `./ui.js`
- [x] Called `wireUI()` before `init()` in DOMContentLoaded
- [x] Removed duplicate UI event listeners:
  - [x] Removed regenerate names button listener
  - [x] Removed apply region count button listener  
  - [x] Removed view toggle button listener

### 3. Updated js/legacy-main.js
- [x] Removed `setupEventListeners()` function call from `init()`
- [x] Deleted entire `setupEventListeners()` function
- [x] Removed duplicate modal event listeners (window.onclick, keydown)
- [x] Exposed `recolorCurrent` function globally
- [x] Kept all underlying functions intact (generate, toggleSettings, etc.)

## 🔄 In Progress

### 4. Testing & Verification
- [ ] Test that UI controls still work:
  - [ ] Generate button runs full pipeline
  - [ ] Sea level changes immediately recolor terrain
  - [ ] View toggle works (terrain ↔ regions)
  - [ ] Settings modal opens/closes
  - [ ] Tab switching works
  - [ ] Export buttons work
  - [ ] All range inputs update outputs and trigger appropriate actions
  - [ ] Select inputs trigger correct actions (generate vs recolor)
- [ ] Verify no new console errors
- [ ] Test with missing elements (safe guards work)
- [ ] Test with missing functions (safe guards work)

## 📋 Acceptance Criteria

- [x] `js/ui.js` exists; `wireUI()` attaches handlers with no errors even if some controls are absent
- [x] `app.js` calls `wireUI()` before `init()`; no duplicate listeners remain in `app.js` or `legacy-main.js`
- [ ] Clicking Generate still runs the full pipeline
- [ ] Sea level changes immediately recolor terrain (no heavy recompute)
- [ ] View toggle works (terrain ↔ regions)
- [ ] No new console errors

## 🔍 Search Anchors (for future reference)

- **app.js**: Removed lines adding listeners to `viewToggleBtn`, `generateBtn`, etc.
- **legacy-main.js**: Removed `document.getElementById('...')?.addEventListener(...)` blocks
- **Element IDs covered**: `generateBtn`, `viewToggleBtn`, `settingsBtn`, `seedInput`, `seaLevelInput`, `worldType`, `regionCount`, `applyRegionCount`, `regenNamesBtn`

## 🚀 Next Steps

1. Test the application in browser
2. Verify all UI controls work as expected
3. Check for any console errors
4. Document any issues found
5. Consider further modularization of remaining functions

# TODO: Step 2 - Elevation templates + sea-level autotune

## Phase 1: Core Infrastructure
- [x] Create js/noise.js with deterministic hash-based 2D noise
- [x] Add fbm2() and warp2() helper functions
- [x] Test noise determinism and performance

## Phase 2: Elevation Generation
- [x] Create js/elevation.js with generateElevation() function
- [x] Implement template functions: radialIsland, continentalGradient, twinContinents
- [x] Add elevation pipeline: template → domain warp → fbm noise → normalize
- [x] Implement auto-sea-level tuning via percentile search
- [x] Compute derivatives: isLand, isCoast, slope, distToCoast

## Phase 3: Integration
- [x] Update js/state.js with elevation/template controls
- [x] Wire generateElevation() into app.js orchestrator
- [x] Add logging and stats output

## Phase 4: Testing
- [x] Add determinism test to js/selftest.js
- [x] Add target land fraction validation test
- [x] Verify all exports and imports work correctly

## Acceptance Criteria
- [x] Deterministic elevation generation with same seed
- [x] Auto-tune sea level to hit targetLandFrac (e.g., 35%)
- [x] All template types working (radialIsland, continentalGradient, twinContinents)
- [x] Proper derivatives computed (isLand, isCoast, slope, distToCoast)
- [x] Clean integration with existing mesh system

## Summary
✅ **Step 2 Complete!** 

Successfully implemented:
- Deterministic hash-based 2D noise system (`js/noise.js`)
- Elevation generation with templates and auto sea-level tuning (`js/elevation.js`)
- Integration with existing state management and mesh system
- Comprehensive self-tests for determinism and land fraction targeting
- All three template types: radialIsland, continentalGradient, twinContinents
- Complete derivative computation: isLand, isCoast, slope, distToCoast

The system now generates elevation data with proper sea-level autotuning to hit target land percentages, and all data is deterministic for the same seed.
