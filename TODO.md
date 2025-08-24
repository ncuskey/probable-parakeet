# TODO List

## ✅ COMPLETED: Azgaar-Lite Baseline Refactor

**Goal**: Create a minimal generator that matches the JSFiddle behavior 1:1 so we can lock terrain fundamentals before layering features.

### Phase 1: State Configuration ✅
- [x] Added terrainMode switch to js/state.js ('azgaar-lite' | 'current')
- [x] Added Azgaar-lite parameters (poissonRadius, blob settings, seaLevel, etc.)
- [x] Set default terrainMode to 'azgaar-lite'
- [x] Updated canvas dimensions to 1200x800

### Phase 2: Azgaar-Lite Generator ✅
- [x] Created js/generators/azgaar-lite.js with minimal, JSFiddle-faithful terrain
- [x] Implemented Poisson disc sampling (ported from fiddle)
- [x] Implemented Voronoi via d3-delaunay
- [x] Implemented blob growth (BFS over neighbors)
- [x] Implemented feature marking (border flood like fiddle)
- [x] Implemented coastlines (land↔water edges)
- [x] Implemented edge chaining and Chaikin smoothing
- [x] No overscan, no falloff, no moat, no erosion, no tuning

### Phase 3: Minimal Renderer ✅
- [x] Created js/render/azgaar-lite-svg.js
- [x] Implemented ocean mask with island clipping
- [x] Implemented spectral color mapping for land cells
- [x] Implemented coastline rendering
- [x] Implemented shallow hatch pattern
- [x] Matches JSFiddle visual behavior

### Phase 4: Pipeline Integration ✅
- [x] Updated js/app.js with terrain mode switch
- [x] Added imports for Azgaar-Lite generator and renderer
- [x] Wired generateWorld() to use Azgaar-Lite when terrainMode === 'azgaar-lite'
- [x] Preserved existing pipeline for terrainMode === 'current'

### Phase 5: UI Integration ✅
- [x] Added random map button to js/ui.js
- [x] Added random map button to index.html
- [x] Implemented one-button "random map" with 11 hills
- [x] Added mode switching functionality

### Phase 6: Testing ✅
- [x] Created test_azgaar_lite.html for standalone testing
- [x] Verified syntax of all new files
- [x] Tested Azgaar-Lite generation and rendering
- [x] Tested random map functionality

### Acceptance Criteria ✅
- [x] Azgaar-Lite generator matches JSFiddle behavior 1:1
- [x] Minimal implementation with no extras (no overscan, falloff, moat, erosion, tuning)
- [x] Proper terrain mode switching (azgaar-lite vs current)
- [x] One-button "random map" functionality
- [x] Clean integration with existing codebase
- [x] All parameters configurable via state
- [x] Comprehensive testing validates functionality

### Summary ✅
**Azgaar-Lite Baseline Complete!** 

Successfully implemented:
- Minimal, JSFiddle-faithful terrain generator (`js/generators/azgaar-lite.js`)
- Poisson disc sampling with Voronoi tessellation
- Blob growth height generation with central island + random hills
- Border-flood ocean classification
- Coastline detection and Chaikin smoothing
- Minimal SVG renderer with ocean masking (`js/render/azgaar-lite-svg.js`)
- Terrain mode switching in app pipeline (`js/app.js`)
- UI integration with random map button (`js/ui.js`, `index.html`)
- Standalone test page (`test_azgaar_lite.html`)

The system now provides a clean baseline for terrain fundamentals that matches the JSFiddle behavior exactly, allowing for feature layering on top of this stable foundation.

---

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

---

# TODO: Step 2.5 - Replace oval mask with border-flood oceans (FMG style)

## Phase 1: Water Classification System
- [x] Create js/water.js with classifyWater() and computeCoastAndDistance()
- [x] Implement border-flood algorithm for ocean classification
- [x] Add lake detection (water that isn't ocean)
- [x] Recompute coast and distance-to-coast from ocean-aware data

## Phase 2: Integration
- [x] Wire water classification into generator after elevation generation
- [x] Override Step 2's coast/distance with ocean-aware versions
- [x] Add logging for water statistics (land, ocean, lakes, coast)

## Phase 3: Remove Oval Mask Logic
- [x] Search codebase for oval mask references
- [x] Remove or stub oval mask logic
- [x] Replace mask conditions with appropriate alternatives
- [x] Clean up any legacy mask-related code

## Phase 4: Testing & Validation
- [x] Add water invariants test to js/selftest.js
- [x] Verify water partition properties (water = ocean ∪ lake)
- [x] Test coast cell validation (land with ocean neighbors)
- [x] Ensure no regression in existing functionality

## Acceptance Criteria
- [x] No more oval masking - pure border-flood ocean classification
- [x] Proper water partitioning: isWater = isOcean ∪ isLake
- [x] Coast cells correctly identified (land touching ocean, not lakes)
- [x] Distance-to-coast computed from ocean-aware coasts
- [x] Clean integration with existing elevation system
- [x] All oval mask references removed or neutralized

## Summary
✅ **Step 2.5 Complete!** 

Successfully implemented:
- FMG-style border-flood ocean classification (`js/water.js`)
- Proper water partitioning: isWater = isOcean ∪ isLake
- Ocean-aware coast detection (land touching ocean, not lakes)
- Distance-to-coast computation from ocean-aware coasts
- Complete removal/stubbing of oval mask logic
- Integration with existing elevation generation pipeline
- Comprehensive water invariants testing

The system now uses pure border-flood ocean classification instead of oval masking, providing more realistic water body separation and proper coast detection.

---

# TODO: Step 2.6 - Never clip land on the frame

## Phase 1: State Configuration
- [x] Add frame safety knobs to js/state.js
- [x] Add edge falloff parameters for soft rectangular falloff
- [x] Set reasonable defaults for frame enforcement

## Phase 2: Frame Safety Implementation
- [x] Add border detection helper function
- [x] Add rectangular edge falloff function
- [x] Add sea level adjustment function to clear frame
- [x] Integrate frame safety into elevation generation pipeline

## Phase 3: Edge Falloff Integration
- [x] Add optional soft rectangular edge falloff to elevation computation
- [x] Ensure edge falloff is applied before sea level computation
- [x] Make edge falloff configurable and off by default

## Phase 4: Testing & Validation
- [x] Add test to verify no land touches frame when enabled
- [x] Test edge falloff functionality
- [x] Verify sea level boosting works correctly
- [x] Ensure integration with existing water classification

## Acceptance Criteria
- [x] No land cells touch map border when enforceOceanFrame=true
- [x] Sea level boosting is capped by maxSeaBoost parameter
- [x] Optional soft rectangular edge falloff works correctly
- [x] Frame safety integrates cleanly with existing elevation system
- [x] All parameters are configurable via state
- [x] Comprehensive testing validates frame safety

## Summary
✅ **Step 2.6 Complete!** 

Successfully implemented:
- Frame safety knobs in state.js (enforceOceanFrame, frameEpsilon, maxSeaBoost)
- Optional soft rectangular edge falloff (edgeFalloffPx, edgeFalloffExp)
- Border detection helper function
- Sea level adjustment to clear frame (capped by maxSeaBoost)
- Integration with elevation generation pipeline
- Comprehensive testing validates no land touches frame when enabled

The system now ensures no land cells touch the map border when frame safety is enabled, providing clean ocean edges and preventing clipped land masses.

---

# TODO: Step 2.7 - Overscan + Fit-to-Canvas (no clipped coasts)

## Phase 1: State Configuration
- [x] Add overscan generation knobs to js/state.js
- [x] Add fit-to-canvas transform parameters
- [x] Set reasonable defaults for overscan and fit behavior

## Phase 2: Overscan Generation
- [x] Update buildBaseMesh in js/terrain.js to use overscan generation box
- [x] Compute overscan size based on percentage or absolute pixels
- [x] Adjust cell spacing to maintain target density in larger area
- [x] Stash generation bounds for later transforms

## Phase 3: Viewport Utilities
- [x] Create js/viewport.js with viewport utilities
- [x] Implement computeLandBBox function
- [x] Implement padRect function for margin handling
- [x] Implement fitTransformToCanvas function
- [x] Implement applySvgGroupTransform function

## Phase 4: Pipeline Integration
- [x] Wire fit-to-canvas transform into app.js orchestrator
- [x] Compute land bounding box after water classification
- [x] Apply padding and fit transform
- [x] Stash view transform in state for renderers
- [x] Apply transform to SVG world group if present

## Phase 5: Testing & Validation
- [x] Add testFitTransform to js/selftest.js
- [x] Verify fit transform keeps land within canvas bounds
- [x] Test overscan generation with different parameters
- [x] Ensure integration with existing water classification

## Acceptance Criteria
- [x] Overscan generation creates larger world box (15% per side by default)
- [x] Fit-to-canvas transform finds land bbox and fits it to canvas with margin
- [x] Transform is applied at render time without data mutation
- [x] No land is clipped at canvas edges when fit mode is enabled
- [x] All parameters are configurable via state
- [x] Comprehensive testing validates fit transform behavior

## Summary
✅ **Step 2.7 Complete!** 

Successfully implemented:
- Overscan generation with configurable padding (percentage or absolute pixels)
- Fit-to-canvas transform that finds land bounding box and fits it to canvas
- Viewport utilities for computing transforms and applying them to SVG groups
- Integration with existing elevation and water classification pipeline
- Comprehensive testing validates transform behavior and canvas bounds
- All parameters configurable via state (overscanPct, fitMode, fitMarginPx, allowUpscale)

The system now generates mesh/elevation on an enlarged generation box and applies a transform to fit all land inside the canvas with a margin, preventing clipped coasts and providing better world composition.

---

# TODO: Step 2.8 - Azgaar-style coastlines: seed window + shallow shelf + coast mask

## Phase 1: State Configuration
- [x] Add knobs and defaults to js/state.js
- [x] Add edge falloff parameters for central bias
- [x] Add seed window configuration for template centers
- [x] Add coast smoothing and rendering toggles

## Phase 2: Template Center Sampling
- [x] Add sampleInWindow function to js/elevation.js
- [x] Update generateElevation to use windowed centers
- [x] Implement deterministic center sampling for radialIsland and twinContinents
- [x] Maintain compatibility with existing continentalGradient template

## Phase 3: Shallow Shelf Ring
- [x] Add computeShallow function to js/water.js
- [x] Implement ocean cells adjacent to land detection
- [x] Return shallow mask for rendering

## Phase 4: Coastline Stitching & Smoothing
- [x] Create js/coast.js with coastline utilities
- [x] Implement coastPolylines function for land↔ocean edge detection
- [x] Implement smoothClosedChaikin function for coastline smoothing
- [x] Chain edges into closed polylines with vertex deduplication

## Phase 5: SVG Rendering Helpers
- [x] Create js/render/svg.js with SVG utilities
- [x] Implement ensureSvgScene for mask and layer setup
- [x] Implement updateOceanMaskWithIslands for ocean masking
- [x] Implement drawCoastlines and drawShallowCells for rendering
- [x] Add shallow hatch pattern for visual distinction

## Phase 6: Pipeline Integration
- [x] Wire coastline processing into app.js orchestrator
- [x] Add shallow shelf computation to pipeline
- [x] Integrate coast polylines generation and smoothing
- [x] Add SVG scene setup and rendering
- [x] Apply world transform to rendered elements

## Phase 7: Testing & Validation
- [x] Add testCoastBuild to js/selftest.js
- [x] Verify coastline loops are produced
- [x] Verify shallow cells are detected
- [x] Test integration with existing pipeline

## Acceptance Criteria
- [x] Template centers sampled from central window (prevents edge riding)
- [x] Shallow shelf ring computed (ocean cells adjacent to land)
- [x] Coastline polylines built from land↔ocean Voronoi edges
- [x] Coastlines smoothed with Chaikin algorithm
- [x] Ocean mask prevents blue overrun of land
- [x] Pretty coastlines drawn with proper styling
- [x] All parameters configurable via state
- [x] Comprehensive testing validates coastline generation

## Summary
✅ **Step 2.8 Complete!** 

Successfully implemented:
- Azgaar-style central bias with seed window sampling
- Shallow shelf ring detection (ocean cells adjacent to land)
- Coastline polylines from land↔ocean Voronoi edges
- Chaikin smoothing for beautiful coastlines
- SVG mask system to prevent ocean overrun
- Comprehensive rendering pipeline with shallow patterns
- Integration with existing overscan and fit-to-canvas system
- All parameters configurable via state (seedWindow, coastSmoothIters, etc.)

The system now generates Azgaar-style coastlines with proper central bias, shallow shelf rings, and beautiful smoothed coastlines that prevent ocean overrun of land masses.

---

# TODO: Step 2.9 - Remove rectangular falloff (no more box-aligned coasts)

## Phase 1: State Configuration
- [x] Update knobs in js/state.js
- [x] Set edgeFalloffPx = 0 to disable rectangular falloff
- [x] Add optional noisy edge bias parameters
- [x] Set edgeBiasMode = 'off' by default

## Phase 2: Elevation Generation Update
- [x] Remove rectangular edge falloff from js/elevation.js
- [x] Add optional noisy edge bias function
- [x] Replace rectEdgeWeight with noisyEdgeWeight when enabled
- [x] Keep overscan + border flood + frame safety

## Phase 3: Testing & Validation
- [x] Add testNoBoxAlignedCoasts to js/selftest.js
- [x] Implement axis-aligned fraction detection
- [x] Verify coastlines are not box-aligned
- [x] Update existing tests to use new defaults

## Acceptance Criteria
- [x] Rectangular falloff disabled by default (edgeFalloffPx = 0)
- [x] No box-parallel iso-lines in coastlines
- [x] Optional noisy edge bias available (edgeBiasMode = 'noisy')
- [x] Overscan + border flood + frame safety preserved
- [x] Comprehensive testing validates no box-aligned coasts
- [x] All parameters configurable via state

## Summary
✅ **Step 2.9 Complete!** 

Successfully implemented:
- Disabled rectangular edge falloff by default (edgeFalloffPx = 0)
- Removed box-parallel iso-lines from coastlines
- Added optional noisy edge bias for subtle edge nudging
- Preserved overscan, border flood, and frame safety functionality
- Comprehensive testing validates no box-aligned coasts
- All parameters configurable via state (edgeBiasMode, edgeBiasMarginPx, etc.)

The system now generates natural coastlines without box-aligned artifacts, while maintaining all the benefits of overscan generation, border flood ocean classification, and frame safety.

---

# TODO: Step 2.10 - Guaranteed margin + cell-aware moat

## Phase 1: Fit Logic Upgrade
- [x] Upgrade fit logic in js/viewport.js
- [x] Add fitTransformWithMargin function with guaranteed canvas-side margin
- [x] Ensure margin is independent of generation bounds
- [x] Keep computeLandBBox as is

## Phase 2: Fit Integration
- [x] Use new fit in js/app.js
- [x] Replace padRect + fitTransformToCanvas with fitTransformWithMargin
- [x] Enforce margin in canvas space, not generation space
- [x] Update imports to use new function

## Phase 3: Cell-Aware Moat
- [x] Add moat helper functions to js/elevation.js
- [x] Implement minDistToFrame, avgCellSizePx, applyFrameMoat
- [x] Add automatic moat width computation
- [x] Apply moat after sea level computation
- [x] Recompute isLand after moat application

## Phase 4: State Configuration
- [x] Update defaults in js/state.js
- [x] Set enforceOceanFrame = false (let moat do the job)
- [x] Increase overscanPct to 0.18 for better framing
- [x] Increase fitMarginPx to 28 for guaranteed margin
- [x] Add frame moat parameters (frameMoatPx, frameMoatCells, frameMoatDrop)

## Phase 5: Testing & Validation
- [x] Add testGuaranteedMargin to js/selftest.js
- [x] Add testMoatWorks to js/selftest.js
- [x] Verify guaranteed margin is enforced
- [x] Verify frame moat keeps coasts off the box

## Acceptance Criteria
- [x] Guaranteed margin ≥ fitMarginPx between land and canvas frame
- [x] Cell-aware ocean moat prevents coastline coincidence with box edges
- [x] Moat width auto-computed from overscan pad or cell size
- [x] Margin enforced by scaling/translating, not clamping
- [x] All parameters configurable via state
- [x] Comprehensive testing validates margin and moat functionality

## Summary
✅ **Step 2.10 Complete!** 

Successfully implemented:
- Guaranteed margin system with fitTransformWithMargin
- Cell-aware ocean moat that prevents coastline coincidence with box edges
- Automatic moat width computation from overscan pad or cell size
- Margin enforcement in canvas space, independent of generation bounds
- Updated defaults for better framing (overscanPct: 0.18, fitMarginPx: 28)
- Comprehensive testing validates margin and moat functionality
- All parameters configurable via state (frameMoatPx, frameMoatCells, etc.)

The system now guarantees breathing room around land masses and prevents coastlines from using the generation box as an edge, even with small overscan values.

---

# TODO: Step 2.11 - Strict Safe-Zone Seeding for High-Energy Features

## Phase 1: State Configuration
- [x] Add safe-zone seeding configuration to js/state.js
- [x] Add enforceSeedSafeZones toggle (default: true)
- [x] Add seedSafeZoneRetries parameter (default: 80)
- [x] Add seedZones configuration for different feature types
- [x] Add showSeedZones debug toggle (default: false)

## Phase 2: Sampling System
- [x] Create js/sampling.js with safe-zone seeding helpers
- [x] Implement windowToPixels function for coordinate conversion
- [x] Implement sampleXYInWindow function for XY sampling
- [x] Implement sampleCellInWindow function for cell sampling
- [x] Implement getSeedWindow function for zone lookup
- [x] Implement seededXY and seededCell main entry functions
- [x] Implement ensureSeedZoneOverlay for debug visualization

## Phase 3: Template Integration
- [x] Update js/terrain.js to use safe-zone seeding
- [x] Replace interiorCellIndex calls with seededCell calls
- [x] Update opMountain, opHill, opRange, opTrough, opPit functions
- [x] Update carveSeas function to use safe-zone seeding
- [x] Update continentalIslands template for core and hill seeding
- [x] Update js/elevation.js to use seededXY for template centers

## Phase 4: Pipeline Integration
- [x] Update js/app.js to call ensureSeedZoneOverlay
- [x] Add seed zone visualization to generateWorld pipeline
- [x] Ensure visualization works with world transform

## Phase 5: Testing & Validation
- [x] Add testSeedsRespectZones to js/selftest.js
- [x] Add testNoOriginNearFrame to js/selftest.js
- [x] Verify seeds respect their safe zones
- [x] Verify land doesn't originate at frame edges

## Acceptance Criteria
- [x] All high-energy seeds (cores, hills, ridges, troughs, seas, volcanos) spawn inside central safe windows
- [x] Safe zones are configurable per feature type via state.seedZones
- [x] Global on/off toggle via state.enforceSeedSafeZones
- [x] Rejection sampling with configurable retry count
- [x] Debug visualization shows safe zones as translucent rectangles
- [x] Comprehensive testing validates safe-zone compliance
- [x] Integration with existing overscan+fit+moat stack

## Summary
✅ **Step 2.11 Complete!** 

Successfully implemented:
- Strict safe-zone seeding system for all high-energy features
- Configurable safe zones per feature type (core, hill, ridge, trough, sea, volcano)
- Rejection sampling with fallback to nearest cell
- Debug visualization with translucent zone rectangles
- Integration with existing terrain templates and elevation generation
- Comprehensive testing validates safe-zone compliance
- All parameters configurable via state (enforceSeedSafeZones, seedSafeZoneRetries, seedZones, showSeedZones)

The system now guarantees that every high-energy seed spawns inside a central safe window, preventing land from originating at the edges while maintaining organic coastlines.
