# Enhanced Voronoi Heightmap Generator

An interactive, client-side fantasy map generator inspired by Azgaar's Fantasy Map Generator. This tool creates procedural terrain using Voronoi diagrams with advanced features including climate simulation, biome generation, and realistic river systems.

## Features

### Core Generation
- **Voronoi-based heightmap** with Lloyd relaxation for natural cell distribution
- **Multiple terrain templates**: Volcanic Island, Lowland Island, Archipelago, Continental, and Atoll
- **Procedural terrain generation** with customizable parameters
- **Water border masking** for realistic coastlines

### Climate & Biomes
- **Temperature simulation** based on elevation and base temperature
- **Precipitation modeling** with wind direction and orographic effects
- **Biome classification** using Whittaker diagram principles
- **Three rendering modes**: Heightmap, Biomes, and Hybrid (biomes with elevation blending)

### Water Systems
- **Lake detection and simulation** with proper outlet rivers
- **Advanced river generation** using flux-based drainage patterns
- **Polygonal river rendering** with variable width from source to mouth
- **Coastline detail enhancement** with noise-based perturbation

### Interactive Controls
- **Terrain Template**: Choose from 5 different world types
- **Graph Size**: Adjust the number of Voronoi cells (100-10,000)
- **Elevation Controls**: Max height, radius, and sharpness for terrain generation
- **Climate Settings**: Base temperature and rainfall intensity
- **River Options**: Line vs polygonal rendering styles
- **Coastline Detail**: Add natural roughness to coastlines
- **Render Mode**: Switch between heightmap, biome, and hybrid views

## Usage

1. Start a local server (required for ES modules): `python3 -m http.server 8000`
2. Open `http://localhost:8000/` in a web browser
3. Click "Generate Map" to create a new world
4. Adjust the various sliders and dropdowns to customize your map
5. Use the "Show Tests" section to verify functionality
6. Add `?selftest=1` to the URL to run module validation tests

## Technical Details

### Architecture
- **Pure client-side**: No server required, runs entirely in the browser
- **D3.js integration**: Uses D3 for Voronoi generation and SVG rendering
- **Modular design**: Separate functions for terrain, climate, rivers, and rendering
- **Efficient algorithms**: Optimized for real-time generation and updates

### Key Algorithms
- **Voronoi cell generation** with Lloyd relaxation for natural spacing
- **Flood-fill lake detection** with spill level calculation
- **BFS distance-to-coast** for realistic river flow direction
- **Wind-biased precipitation** with orographic lift simulation
- **Biome classification** based on temperature and precipitation thresholds

### Performance
- **Typed arrays** for efficient data storage (Float32Array, Int32Array)
- **Cached computations** to avoid redundant calculations
- **Optimized rendering** with selective updates based on parameter changes

## Development Roadmap

This implementation builds on the original Voronoi heightmap demo with several Azgaar-inspired enhancements:

1. ✅ **Terrain Templates** - Multiple world generation patterns
2. ✅ **Climate Simulation** - Temperature and precipitation modeling
3. ✅ **Biome System** - Ecological zone classification and coloring
4. ✅ **Enhanced Rivers** - Polygonal rendering with variable width
5. ✅ **Lake Systems** - Depression detection and outlet simulation
6. ✅ **Coastline Detail** - Noise-based coastline perturbation

Future enhancements could include:
- **Cultural features** (cities, roads, borders)
- **Advanced climate** (seasons, weather patterns)
- **Terrain features** (caves, canyons, plateaus)
- **Export options** (PNG, SVG, data formats)

## Browser Compatibility

Tested and working in:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

Requires ES6+ features and modern browser APIs for optimal performance.

## Module Structure (No-Bundler ES Modules)

This project runs entirely in the browser using native ES modules:

```
index.html
js/
├── app.js                    # Entry: wires UI and calls init() (no unused imports)
├── legacy-main.js            # Pipeline orchestration (ensureIsWater → recolor → rivers → regions → routes), exports init(), generate()
├── state.js                  # Central app state (S), getters/setters, caches (isWater, landPaths, precip)
├── utils.js                  # Pure helpers (RNG, math, geometry)
├── render.js                 # Layer plumbing (getLayers, ensureRasterImage), view-mode toggles, light repaints
├── recolor.js                # Terrain painting (canvas raster + SVG per-cell)
├── terrain.js                # Template registry & executor (function/steps), height clear, cache invalidation
├── climate.js                # Precipitation provider (shim until full climate)
├── rivers.js                 # Precip recompute, BFS/flow steps, river rendering
├── regions.js                # Region assignment + rendering (fallback drawn under #regions > .overlay)
├── routes.js                 # Roads/paths rendering and logs
├── ui.js                     # DOM event wiring for controls (generate, view toggle, seed, sea level, etc.)
├── ui-overlays.js            # Settings modal + overlay/progress controls
└── selftest.js               # Browser self-test harness (validates module exports)
```

**Dev server:** open via a simple static server (modules don't load on `file://`). Examples:
- Python: `python3 -m http.server` → http://localhost:8000
- VS Code: "Live Server" extension

**Scripts in HTML:**
```html
<!-- If using CDN D3 -->
<script defer src="https://d3js.org/d3.v7.min.js"></script>
<script type="module" src="js/app.js"></script>

<!-- Self-test harness (opt-in via ?selftest=1) -->
<script type="module">
  if (new URL(location.href).searchParams.get('selftest') === '1') {
    import('./js/selftest.js');
  }
</script>
```

**View modes & layers:**

Cells group must have `id="mapCells"`. Regions group is `#regions`. Fallback land path uses class `fallback-land`.

In "Terrain" mode, CSS hides `#regions path.fallback-land` so terrain shading remains visible.

**Pipeline:**
`ensureIsWater` → `recolor` → `recomputePrecipIfNeeded` → `computeRiverSteps` → `computeRivers` → `computeAndDrawRegions` → `computeRoutes`