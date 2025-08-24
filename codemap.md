# CodeMap: Voronoi Heightmap Generator (ES Module Architecture)

## Project Overview

This is an interactive, client-side fantasy map generator inspired by Azgaar's Fantasy Map Generator. The application creates procedural terrain using Voronoi diagrams with advanced features including climate simulation, biome generation, and realistic river systems.

**Key Features:**
- **Azgaar-style blob growth** terrain generation with BFS queue expansion
- Multiple terrain templates (Volcanic Island, Continental Islands, Archipelago, Low Island)
- Climate simulation with temperature and precipitation modeling
- Biome classification using Whittaker diagram principles
- Advanced river generation with polygonal rendering
- Lake detection and simulation with proper outlet rivers
- Interactive controls for real-time parameter adjustment
- **ES Module Architecture** - No bundler required, runs natively in modern browsers

## File Structure

```
probable-parakeet/
├── index.html              # Main HTML entry point with ES module script
├── js/
│   ├── app.js              # Entry point: wires UI and calls init() (cleaned imports)
│   ├── legacy-main.js      # Pipeline orchestration (9,356 lines, Azgaar-style generation)
│   ├── state.js            # Central app state (S), getters/setters, caches
│   ├── utils.js            # Pure helpers (RNG, math, geometry)
│   ├── render.js           # Layer plumbing (getLayers, ensureRasterImage)
│   ├── recolor.js          # Terrain painting (canvas raster + SVG per-cell)
│   ├── terrain.js          # Azgaar-style blob templates & operations
│   ├── climate.js          # Precipitation provider
│   ├── rivers.js           # Precip recompute, BFS/flow steps, river rendering
│   ├── regions.js          # Region assignment + rendering (with timing fallbacks)
│   ├── routes.js           # Roads/paths rendering and logs
│   ├── ui.js               # DOM event wiring for controls
│   ├── ui-overlays.js      # Settings modal + overlay/progress controls
│   └── selftest.js         # Browser self-test harness (validates module exports)
├── css/
│   ├── base.css           # Base styles
│   ├── layout.css         # Layout and positioning
│   ├── map.css            # Map-specific styles
│   └── ui.css             # UI component styles
├── manifest.json          # PWA manifest
├── sw.js                  # Service worker
├── README.md              # Project documentation with module structure
├── TODO.md                # Development tasks and progress
├── codemap.md             # This file - comprehensive code documentation
├── YIELD_HYGIENE_SUMMARY.md # Performance optimization documentation
└── test_*.html           # Various test files
```

## Architecture Overview

### ES Module Architecture
- **No-bundler design**: Uses native ES modules with relative imports
- **Browser-native**: Runs entirely in the browser without build tools
- **Modular organization**: Each major feature has its own module
- **Clean imports/exports**: All modules use relative paths with .js extensions

### Core Architecture
- **Pure client-side**: No server required, runs entirely in the browser
- **D3.js integration**: Uses D3 for Voronoi generation and SVG rendering
- **State management**: Centralized state in `state.js` with getters/setters
- **Layer management**: Unified layer access via `render.js` getLayers()

### Key Design Patterns
- **Single-flight orchestration**: Prevents duplicate generation runs
- **Async/await with yielding**: Prevents UI blocking during heavy operations
- **Timeout protection**: Robust error recovery with fallbacks
- **Performance monitoring**: Built-in performance tracking and long task detection
- **Module boundaries**: Clear separation of concerns across modules

## Module Architecture

### Entry Point (`js/app.js`)
```javascript
// Entry point that wires UI and initializes the application
// Cleaned up - removed unused imports (mulberry32, setViewMode)
import { init } from './legacy-main.js';
import { wireUI } from './ui.js';
import { ProgressManager } from './ui-overlays.js';

// DOM ready handler
window.addEventListener('DOMContentLoaded', () => {
  ProgressManager.init();
  wireUI();
  init(); // Fixed: use imported init() instead of window.init()
});
```

### State Management (`js/state.js`)
```javascript
// Central state bag with getters/setters
export const S = {
  // Geometry / graph
  width: 1024, height: 768,
  cells: [], edges: [], vertices: [],
  
  // RNG / seed
  seed: 12345, rng: mulberry32(12345),
  
  // Tunables / params
  params: { seaLevel: 0.2, worldType: 'continents', regionCountK: 3 },
  
  // Derived data / caches
  caches: { isWater: null, landPaths: null, precip: null, /* ... */ },
  
  // Burgs and regions
  burgs: [], macroCapitals: null, regenerationCount: 0,
  
  // View state
  currentViewMode: 'terrain'
};

// Getters/setters for state access
export function getWorld() { /* ... */ }
export function ensureIsWater(cells) { /* ... */ }
export function resetCaches(...keys) { /* ... */ }
```

### Utility Functions (`js/utils.js`)
```javascript
// Pure helper functions
export function mulberry32(seed) { /* ... */ }
export function rngFromSeed(seed) { /* ... */ }
export function randRange(min, max, rng) { /* ... */ }
export function shuffleInPlace(array, rng) { /* ... */ }
export function choice(array, rng) { /* ... */ }
export function clamp(value, min, max) { /* ... */ }
export function lerp(a, b, t) { /* ... */ }
export function distance(a, b) { /* ... */ }
// ... additional utility functions
```

### Render Management (`js/render.js`)
```javascript
// Layer plumbing and view mode management
export function getLayers() {
  // Returns { svg, zoomRoot, mapCells, regions, routes, burgs }
}

export function ensureMapCellsId() {
  // Ensures #mapCells group id for selectors
}

export function ensureRasterImage({width, height}) {
  // Ensures raster <image> exists inside #mapCells
}

export function setViewMode(mode) {
  // Toggles between terrain and regions view modes
}

export function repaintCellsForMode(mode) {
  // Repaints cells based on current view mode
}
```

### Terrain System (`js/terrain.js`) - **AZGAAR-STYLE BLOB GROWTH**
```javascript
// Azgaar-style blob growth system with BFS queue expansion

// Core blob operations
function growBlob({ startIndex, peak = 1, radius = 0.94, sharpness = 0.12, stop = 0.01 }) {
  // BFS queue expansion: children height = parentHeight * radius * modifier
}

function opMountain({ peak = 1, radius = 0.95, sharpness = 0.12 } = {}) {
  // Single peak blob growth
}

function opHill({ peak = 0.5, radius = 0.95, sharpness = 0.10 } = {}) {
  // Smaller hill blobs
}

function opRange({ peak = 0.8, steps = 6, stepRadius = 0.93, sharpness = 0.10 } = {}) {
  // Chain of mountains along a path
}

function opTrough(args = {}) {
  // Negative linear features (valleys)
}

function opPit({ depth = 0.35, radius = 0.94, sharpness = 0.10 } = {}) {
  // Negative circular blobs (depressions)
}

// Azgaar-style templates
export function volcanicIsland() {
  // "High Island": mountain + 15 hills + 2 ranges + 2 troughs + 3 pits
}

export function lowIsland() {
  // volcanicIsland rescaled to 0.3 modifier
}

export function archipelago() {
  // mountain + 15 hills + 2 troughs + 8 pits
}

export function continentalIslands() {
  // mountain + 5 troughs (long linear features)
}

// Template registry and application
export function registerDefaultTemplates() {
  // Registers blob-based templates, maps "continents" to continentalIslands
}

export function applyTemplate(tplKey, uiVals = {}) {
  // Applies Azgaar-style blob templates
}

export function ensureHeightsCleared() {
  // Clears height data for new generation
}

// Post-processing utilities
export function normalizeHeightsIfNeeded({ minMax = 0.3, maxTarget = 0.85 } = {}) {
  // Only if template ends up too flat (max<0.3)
}

export function sinkOuterMargin(pct = 0.04, amount = 0.15) {
  // Gentle post-pass to avoid border spill
}
```

### Climate System (`js/climate.js`)
```javascript
// Precipitation and climate simulation
export function computePrecipArray() {
  // Computes precipitation array for climate simulation
}
```

### River System (`js/rivers.js`)
```javascript
// River generation and flow simulation
export function recomputePrecipIfNeeded() {
  // Recomputes precipitation cache if missing
}

export function computeRiverSteps() {
  // Computes river steps using BFS
}

export function computeRivers(run = 0) {
  // Main river computation and rendering with higher flux thresholds
  // River threshold: 35% of max flux (increased from 25% for fewer rivers)
}
```

### Region System (`js/regions.js`)
```javascript
// Region assignment and rendering
export async function computeAndDrawRegions(run = 0) {
  // Region assignment + rendering with fallback behavior
  // Fallback land path drawn under #regions > .overlay with class fallback-land
}
```

### Route System (`js/routes.js`)
```javascript
// Road and path generation
export function computeRoutes(run = 0) {
  // Main route generation pipeline with logging
}
```

### UI System (`js/ui.js`)
```javascript
// DOM event wiring for controls
export function wireUI() {
  // Wires all UI event listeners
  // generate, view toggle, seed, sea level, etc.
}
```

### UI Overlays (`js/ui-overlays.js`)
```javascript
// Settings modal and progress controls
export class ProgressManager {
  static init() { /* ... */ }
  static show() { /* ... */ }
  static hide() { /* ... */ }
  static update(progress, text) { /* ... */ }
}

export function toggleSettings() {
  // Settings modal toggle functionality
}
```

### Self-Test Module (`js/selftest.js`)
```javascript
// Browser self-test harness for module validation
// Usage: add ?selftest=1 to URL to run tests

(async () => {
  const results = [];
  const pass = (name) => results.push({ name, ok: true });
  const fail = (name, e) => results.push({ name, ok: false, err: e });

  // Test all major module exports
  // - state.js: S object and getWorld function
  // - render.js: getLayers and setViewMode functions
  // - recolor.js: recolor function
  // - terrain.js: applyTemplate function
  // - rivers.js: computeRivers function
  // - regions.js: computeAndDrawRegions function
  // - routes.js: computeRoutes function
  // - ui.js: wireUI function
  // - ui-overlays.js: toggleSettings function and ProgressManager class

  // Logs summary: "🧪 Self-test: X passed, Y failed"
})();
```

## Main Application Logic (`js/legacy-main.js`)

### Module Structure (9,356 lines - Azgaar-style generation)

#### 1. Imports and Dependencies (Lines 1-60)
```javascript
import { mulberry32, rngFromSeed, /* ... */ } from './utils.js';
import { S, getWorld, setSize, /* ... */, ensureIsWater } from './state.js';
import { ensureHeightsCleared, applyTemplate, registerDefaultTemplates, normalizeHeightsIfNeeded, sinkOuterMargin } from './terrain.js';
import { computeRiverSteps, recomputePrecipIfNeeded, computeRivers } from './rivers.js';
import { computeAndDrawRegions } from './regions.js';
import { computeRoutes } from './routes.js';
import { getLayers, ensureMapCellsId, ensureRasterImage, setViewMode, repaintCellsForMode } from './render.js';
import { recolor, ensureTerrainCanvas } from './recolor.js';
import { computePrecipArray } from './climate.js';
import { ProgressManager } from './ui-overlays.js';
```

#### 2. Initialization & State Management (Lines 61-116)
```javascript
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
```

#### 3. Configuration System (Lines 140-235)
```javascript
// === CONFIG REGISTRY ===
function getConfig() {
  const s = (window.__state = window.__state || {});
  const cfg = (s.config = s.config || {});
  // One-time default templates if missing
  if (!cfg.templates) {
    cfg.templates = { default: (burg) => burg };
  }
  // Initialize other config defaults
  cfg.palette ??= { land:'#888', water:'#68a', coast:'#ccc' };
  cfg.themes ??= { default: {} };
  return cfg;
}
```

#### 4. Utility Functions (Lines 235-727)
```javascript
// === utils/svg-path helpers ===
function polylineToPathD(points) { /* ... */ }
function segmentsToPolylines(segments) { /* ... */ }

// === graph cache ===
const GraphCache = {
  land: null, sea: null,
  invalidate(type) { /* ... */ }
};

// === LABEL HELPERS ===
function toScreen([x,y], t=window.currentTransform) { /* ... */ }
```

#### 5. Terrain Generation (Lines 727-1893)
```javascript
// === Azgaar-style cell suitability scoring ===
function computeCellSuitability(cells, isWater, width, height) { /* ... */ }

// === Capital placement with min spacing ===
function placeCapitals(cells, isWater, width, height, K) { /* ... */ }

// === Coastline detection and ring building ===
function buildCoastlineRings(cells, isWater) { /* ... */ }

// === Harbor suitability scoring ===
function computeHarborScores(cells, isWater, coastSteps) { /* ... */ }
```

#### 6. Settlement System (Lines 1893-2361)
```javascript
// === Compute population ranks & stash type class ===
async function seedBurgCandidates(cells, isWater, width, height, K) { /* ... */ }

function assignBurgTypes(burgs, cells, isWater) { /* ... */ }

function scaleBurgPopulations(burgs, cells, isWater) { /* ... */ }

function generateRegionalNames(burgs, cells, isWater) { /* ... */ }
```

#### 7. Route Generation (Lines 2361-4622)
```javascript
// === SeaRouter with cache ===
function buildSeaGraph(cells, isWater, ports) { /* ... */ }

// === Layers: ensure #routes and expected subgroups exist ===
function ensureRouteLayers() { /* ... */ }

// === Routes: primary / merge / sea (resilient scaffold) ===
function buildBackboneRoads(burgs, landGraph, cells, isWater, islandOf, null) { /* ... */ }
```

#### 8. Region Rendering (Lines 4622-7428)
```javascript
// === Settlements pipeline (Azgaar-style) ===
// computeAndDrawRegions moved to regions.js module
```

#### 9. Graph Building & Pathfinding (Lines 7428-10399)
```javascript
// === Graph building & pathfinding scaffolds ===
function buildLandGraph(cells, isWater, burgs) { /* ... */ }

// === Backfill system: ensure every town connects to network ===
function ensureConnectivity(burgs, landGraph, cells, isWater) { /* ... */ }

// === Road proximity bump + town placement ===
function adjustBurgPositions(burgs, cells, isWater) { /* ... */ }
```

#### 10. Application Startup (Lines 10399-10544)
```javascript
// === STARTUP CODE ===
window.init = async function() {
  console.log('Initializing Voronoi Heightmap Playground...');
  
  // Ensure shared state object remains globally reachable
  window.__state = window.__state || {};
  
  // Initialize any required state
  if (!S.regenerationCount) {
    setRegenerationCount(0);
  }
  
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
};

// === WINDOW BINDINGS FOR INLINE HANDLERS ===
window.generate = async function() {
  // Main generation pipeline with Azgaar-style blob growth:
  // ensureHeightsCleared → applyTemplate → normalizeHeightsIfNeeded → thermalErode → smoothLand → sinkOuterMargin → classify → recolor
};
```

## Generation Pipeline

### **AZGAAR-STYLE BLOB GROWTH PIPELINE**
The main generation pipeline follows this exact order with Azgaar-style blob growth:

1. **ensureHeightsCleared** - Clear height data for new generation
2. **applyTemplate** - Apply Azgaar-style blob templates (volcanicIsland, continentalIslands, etc.)
3. **normalizeHeightsIfNeeded** - Only if template ends up too flat (max<0.3)
4. **thermalErode** - Thermal erosion simulation
5. **smoothLand** - Land smoothing
6. **sinkOuterMargin** - Gentle post-pass to avoid border spill
7. **Fixed coastline** - Set seaLevel = 0.20 (slider overrides)
8. **recolor** - Terrain painting (logs "Land fraction ~ ...")
9. **recomputePrecipIfNeeded** - Precipitation computation
10. **computeRiverSteps** - River steps computation (logs "⏱ Compute river steps (BFS): ...")
11. **computeRivers** - River generation with higher flux thresholds (logs "⏱ Compute rivers: ...")
12. **computeAndDrawRegions** - Region assignment and rendering
13. **computeRoutes** - Route generation (logs "computeRoutes() vKNN", "primary-road count:", etc.)

### Error Handling
Each stage is wrapped in try/catch blocks with specific error messages:
```javascript
try { 
  ensureHeightsCleared();
  applyTemplate(tplKey, uiVals);
  normalizeHeightsIfNeeded();
  thermalErode(talus, thermalStrength, 2);
  smoothLand(smoothAlpha);
  sinkOuterMargin(0.04, 0.15);
} catch (e) { console.warn('[generate] terrain generation failed', e); }

try { 
  await recolor(run);
} catch (e) { console.warn('[generate] recolor failed', e); }

// ... and so on for each stage
```

## Layer Management

### Unified Layer Access
All layer access is now unified through `getLayers()`:

```javascript
// Before (inconsistent):
d3.select('#mapCells')
d3.select('g.mapCells')
document.getElementById('mapCells')

// After (unified):
const { mapCells, regions, routes, burgs } = getLayers();
```

### Layer Structure
- **#mapCells** - Terrain cells with id="mapCells"
- **#regions** - Region overlays with fallback land paths
- **#routes** - Road and path networks
- **#burgs** - Settlement markers and labels

### CSS Integration
```css
/* Hide coarse fallback land fill in terrain view so height shading is visible */
body.view-mode-terrain #regions path.fallback-land { 
  display: none; 
}
```

## Key Algorithms

### 1. Voronoi Generation
- **Lloyd relaxation** for natural cell distribution
- **Spatial indexing** for efficient neighbor lookups
- **Cell polygon generation** with proper edge handling

### 2. **AZGAAR-STYLE TERRAIN GENERATION**
- **Blob growth with BFS queue** - children height = parentHeight * radius * modifier
- **Template composition** - mountains, hills, ranges, troughs, pits combined
- **Interior cell seeding** - keeps seeds off borders for coherent landmasses
- **Sharpness modifiers** - random variation around ~1 for natural appearance
- **Fixed coastline ≈ 0.2** - with slider override capability
- **Thermal erosion** simulation
- **Water border masking** for realistic coastlines
- **Lake detection** with spill level calculation

### 3. Climate Simulation
- **Temperature modeling** based on elevation and base temperature
- **Precipitation simulation** with wind direction and orographic effects
- **Biome classification** using Whittaker diagram principles

### 4. River Generation
- **Flux-based drainage** patterns
- **Polygonal river rendering** with variable width
- **Higher flux thresholds** - 35% of max flux for fewer, larger rivers
- **Coastline detail enhancement** with noise-based perturbation

### 5. Settlement Placement
- **Suitability scoring** for optimal placement
- **Capital placement** with minimum spacing constraints
- **Adaptive quotas** for different settlement types
- **Region assignment** with power-based distribution

## Performance Optimizations

### 1. Yielding System
- **Async operations** with `requestAnimationFrame` yields
- **8ms budget** for UI responsiveness
- **Comprehensive yield points** in all major loops

### 2. Timeout Protection
- **5-second timeout** for burg seeding
- **10-second timeout** for entire pipeline
- **Graceful degradation** with fallback behaviors

### 3. Error Recovery
- **Individual error handling** for name generation
- **Try/catch blocks** around critical operations
- **Pipeline continuation** despite individual failures

### 4. Caching
- **Graph caching** for repeated operations
- **Spatial indexing** for efficient lookups
- **Computed value caching** to avoid redundant calculations

## User Interface

### Main Controls
- **Generate Map** - Triggers new world generation with Azgaar-style blob growth
- **Settings** - Opens configuration modal
- **Regenerate Names** - Updates settlement names
- **Show Regions** - Toggles region visibility
- **Export SVG/PNG** - Saves generated maps

### Settings Categories
1. **Terrain** - Graph size, elevation, water levels, world type (continents, volcanicIsland, archipelago, lowIsland)
2. **Climate** - Temperature, rainfall, wind belts, river density
3. **Settlements** - Region count and distribution
4. **Routes** - Road network configuration

### Rendering Modes
- **Heightmap** - Elevation-based coloring
- **Biomes** - Ecological zone coloring
- **Hybrid** - Biomes with elevation blending

## Development Status

### Completed Features ✅
- **ES Module Architecture** - Complete refactor to native ES modules
- **Module Cleanup** - Removed dead code and unified selectors
- **Entrypoint Fixes** - app.js calls imported init(), removed unused imports
- **Global Bridge Cleanup** - Removed leftover window.* assignments from test files
- **Self-Test Harness** - Browser-based module validation via ?selftest=1
- **State Management** - Centralized state in state.js
- **Layer Management** - Unified layer access via getLayers()
- **Pipeline Sequencing** - Proper generation pipeline with error handling
- **Error Recovery** - Fixed syntax and runtime errors with proper fallbacks
- **AZGAAR-STYLE BLOB GROWTH** - Complete implementation of Azgaar's proven terrain algorithm
- **Template Composition** - volcanicIsland, continentalIslands, archipelago, lowIsland templates
- **Fixed Coastline** - Default seaLevel = 0.20 with slider override
- **Coherent Landmasses** - No more speckled blobs, produces realistic continents/islands
- **Higher River Thresholds** - 35% flux threshold for fewer, larger rivers
- Core terrain generation with multiple templates
- Climate simulation and biome classification
- River generation with polygonal rendering
- Settlement placement and naming
- Route generation and road networks
- Performance optimizations with yielding
- Timeout protection and graceful degradation

### Architecture Improvements ✅
- **No-bundler ES modules** - Runs natively in modern browsers
- **Clean imports/exports** - All modules use relative paths with .js extensions
- **Entrypoint correctness** - app.js uses imported init() directly
- **Unused import removal** - Cleaned up mulberry32 and setViewMode imports
- **Global bridge removal** - Test files no longer pollute global scope
- **Self-test integration** - Comprehensive module export validation
- **Timing fallbacks** - Robust error handling for module dependencies
- **Unified selectors** - All layer access via getLayers()
- **Dev guard rails** - Sanity checks for missing layers
- **CSS integration** - Proper fallback land hiding in terrain mode
- **Documentation updates** - README and codemap reflect all changes
- **Azgaar-style blob growth** - Replaced plate/noise approach with proven BFS algorithm
- **Template mapping** - "continents" maps to continentalIslands()
- **Generation order** - Proper sequencing with normalizeHeightsIfNeeded and sinkOuterMargin
- **River optimization** - Higher thresholds for fewer, larger rivers

### In Progress 🔄
- Route system refinements (per TODO.md)
- Performance monitoring and optimization
- UI responsiveness improvements

### Future Enhancements 🚀
- Cultural features (cities, roads, borders)
- Advanced climate (seasons, weather patterns)
- Terrain features (caves, canyons, plateaus)
- Enhanced export options

## Browser Compatibility

**Tested and working in:**
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

**Requirements:**
- ES6+ features
- ES Module support
- Modern browser APIs
- Canvas/SVG support
- PerformanceObserver API (for monitoring)

**Dev Server Requirements:**
- Must be served via HTTP (not file://)
- Python: `python3 -m http.server` → http://localhost:8000
- VS Code: "Live Server" extension

## Performance Characteristics

### Generation Times
- **Small maps** (1,000 cells): ~1-2 seconds
- **Medium maps** (5,000 cells): ~3-5 seconds
- **Large maps** (10,000+ cells): ~5-10 seconds

### Memory Usage
- **Typed arrays** for efficient data storage
- **Optimized rendering** with selective updates
- **Cached computations** to avoid redundancy

### UI Responsiveness
- **No long tasks >250ms** during generation
- **Yielding every ~8ms** in heavy operations
- **Progress overlay** with real-time updates

## Testing

### Self-Test Harness
- **Usage**: Add `?selftest=1` to URL (e.g., `http://localhost:8000/?selftest=1`)
- **Purpose**: Validates all module exports are properly defined
- **Output**: Console log with pass/fail summary: "🧪 Self-test: X passed, Y failed"
- **Coverage**: Tests state, render, recolor, terrain, rivers, regions, routes, ui, and ui-overlays modules
- **No-bundler design**: Runs entirely in browser without build tools

### Manual Testing
- `test_yield_hygiene.html` - Performance testing
- Browser performance tab monitoring
- Various map sizes and parameter combinations
- Self-test validation before deploying changes

### Automated Testing
- PerformanceObserver integration
- Long task detection
- Timeout simulation
- Error injection testing
- Module export validation via self-test

## Contributing

### Code Style
- **ES6+ syntax** with async/await
- **ES Module imports/exports** with relative paths
- **Modular function organization**
- **Comprehensive error handling**
- **Performance-conscious design**

### Development Workflow
- **Feature branches** for new development
- **Performance testing** for all changes
- **Error recovery** for robust operation
- **Documentation updates** for new features
- **Module boundary respect** - keep concerns separated

### Module Guidelines
- **Single responsibility** - each module has one clear purpose
- **Clean interfaces** - minimal public APIs
- **Relative imports** - always use relative paths with .js extensions
- **State access** - use state.js getters/setters
- **Layer access** - use render.js getLayers()

---

*This codemap provides a comprehensive overview of the Voronoi Heightmap Generator project structure, architecture, and key components after the Azgaar-style blob growth implementation. For detailed implementation specifics, refer to the individual source files and inline documentation.*
