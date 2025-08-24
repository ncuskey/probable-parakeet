# Azgaar-Lite: Analytic Safe-Zone Seeding Implementation

## Overview

This implementation adds analytic safe-zone seeding to the Azgaar-Lite terrain generator, ensuring that high-energy features (islands, hills) are placed far enough from the map edges to prevent unwanted edge contact.

## What This Adds

1. **Compute cell distance to frame once** (BFS on Voronoi adjacency)
2. **Closed-form influence radius** in cells from seed height & falloff
3. **New `pickCellInWindowSafe(...)`** used for big island, optional 2nd blob, and hills
4. **Fallback behavior**: If no valid cell after N tries, picks the farthest-in-window cell (no edge contact)

## Implementation Details

### 1. Helper Functions Added (`js/generators/azgaar-lite.js`)

#### `cellTouchesFrame(poly, W, H, eps = 1e-6)`
- Checks if a cell's polygon touches the frame boundaries
- Uses epsilon tolerance for floating-point comparisons

#### `distToFrame(world)`
- BFS graph distance (in cells) from each cell to the frame
- Returns `Int32Array` with distance values for each cell
- Frame-touching cells have distance 0, others have positive distances

#### `meanFalloff(radius, sharpness)`
- Expected multiplicative falloff per ring
- Models the fiddle's random modification: `mod ~ U[1.1 - sharpness, 1.1]`
- Returns `E[mod] = 1.1 - 0.5*sharpness`

#### `influenceSteps(height0, radius, sharpness, sea, safetySteps = null)`
- Calculates how many neighbor rings until a value drops below sea level
- Uses formula: `k = ceil( log(sea/height0) / log(f) ) + safetySteps`
- Uses state parameters: `state.safeZone?.safetySteps ?? 2`

### 2. Safe Cell Picker

#### `pickCellInWindowSafe(world, rng, win, minDistSteps, opts = {})`
- Replaces the old `pickCellInWindow` function
- Ensures selected cells are at least `minDistSteps` away from frame
- Options:
  - `maxTries`: Uses `state.safeZone?.maxTries ?? state.seedSafeZoneRetries ?? 80`
  - `maxHeightAllowed`: Skip cells above this height (for hills)
  - `Hfield`: Current height field for height constraints
- Fallback: Returns farthest-in-window cell if no valid cell found

### 3. Updated Voronoi Construction

#### `buildVoronoi(points, width, height)`
- Now computes and stores `distFrame` array
- Added line: `world.distFrame = distToFrame(world);`

### 4. Updated Main Generator

#### `generateAzgaarLite(opts = {})`
- **Big Island**: Uses `influenceSteps()` to calculate safe distance, then `pickCellInWindowSafe()`
- **2nd Blob**: Same safe-zone logic with scaled height
- **Small Hills**: Each hill gets its own influence calculation and safe placement

### 5. State Parameters

#### Added to `js/state.js`:
```javascript
safeZone: {
  safetySteps: 2,     // extra rings beyond analytic radius
  maxTries: 80        // per seed
}
```

#### Uses existing parameters:
- `state.seedSafeZoneRetries` (fallback for maxTries)
- `state.enforceSeedSafeZones` (existing safe zone enforcement)

## Key Features

### Analytic Influence Calculation
- **No trial-and-error**: Uses mathematical formula to determine safe distance
- **Height-aware**: Different features get different safe distances based on their height
- **Falloff-aware**: Accounts for the blob's radius and sharpness parameters

### Robust Fallback
- If no cell meets the strict criteria after N tries, picks the best available
- "Best available" = farthest from frame while still in window
- Never returns a frame-touching cell

### Performance Optimized
- Distance to frame computed once per world generation
- BFS algorithm efficiently calculates all distances
- No repeated distance calculations during seeding

## Usage

The implementation is automatically active when using the Azgaar-Lite generator. The safe zone parameters can be tuned via:

```javascript
// In state.js or via UI
state.safeZone.safetySteps = 3;  // More conservative
state.safeZone.maxTries = 100;   // More attempts
```

## Testing

Use the existing test file: `test_safe_zone_seeding.html`

This test demonstrates:
- Safe zone analysis
- Edge contact prevention
- Influence radius visualization
- Multiple seed testing

## Benefits

1. **No Edge Contact**: Islands and hills never touch the map edges
2. **Predictable Placement**: Analytic calculation ensures consistent behavior
3. **Performance**: Single BFS pass vs. repeated distance checks
4. **Configurable**: Safety parameters can be tuned per use case
5. **Robust**: Fallback behavior ensures generation always succeeds
