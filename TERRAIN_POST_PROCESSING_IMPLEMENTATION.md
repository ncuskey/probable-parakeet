# Terrain Post-Processing Flag Implementation

## Overview

This implementation adds a feature flag to make noise elevation authoritative while gating legacy post-elevation transforms. The goal is to ensure that the elevation data produced by `elevation.js` is the source of truth, with legacy terrain post-processing (templates/erosion/masks) available behind a feature flag for quick rollback.

## Changes Made

### 1. Feature Flag Addition (`js/state.js`)

**Added:**
```javascript
/**
 * Terrain post-processing (legacy)
 */
export const TerrainFlags = {
  useLegacyTerrainPost: false, // default off - noise elevation is authoritative
  // you can add more switches here later if needed
};
```

**Added to global state object:**
```javascript
// Terrain post-processing (legacy)
useLegacyTerrainPost: false, // default off - noise elevation is authoritative
```

### 2. Legacy Post-Processing Gating (`js/legacy-main.js`)

**Import addition:**
```javascript
import {
  S,
  TerrainFlags,  // ← NEW
  // ... existing imports
} from './state.js';
```

**Console markers added after elevation generation:**
```javascript
// Console markers for verification
console.log('[terrain] elevation.js complete', {
  seaLevel: S.elevation?.seaLevel,
  landFrac: landFrac
});

console.log('[terrain] legacy post-processing:',
  TerrainFlags.useLegacyTerrainPost ? 'ENABLED' : 'DISABLED'
);
```

**Legacy transforms gated:**
```javascript
// Gate legacy post-elevation transforms
if (TerrainFlags.useLegacyTerrainPost === true) {
  // Legacy terrain post-processing (template/erosion/masks)
  applyTemplate(tplKey, uiVals);
  normalizeHeights({ maxTarget: 0.9 });
  thermalErode(talus, thermalStrength, 1);
  smoothLand(smoothAlpha);
  _debugHeights('post-template');
  applyBorderMask();
  _debugHeights('post-erosion');
  applyBorderMask();
  // ... sea level tuning, sinkSmallIslands, etc.
} else {
  // Skip legacy transforms; elevation from elevation.js is authoritative
  console.log('[terrain] skipping legacy post-processing - using noise elevation as authoritative');
}
```

## Functions Gated

The following legacy terrain post-processing functions are now gated behind the flag:

- `applyTemplate(tplKey, uiVals)` - Template application
- `normalizeHeights({ maxTarget: 0.9 })` - Height normalization
- `thermalErode(talus, thermalStrength, 1)` - Thermal erosion
- `smoothLand(smoothAlpha)` - Land smoothing
- `applyBorderMask()` - Border mask application (called twice)
- `tuneSeaLevelToTarget()` - Sea level auto-tuning
- `sinkSmallIslands()` - Small island removal

## Behavior

### Default (Flag = false)
- Noise elevation from `elevation.js` is authoritative
- No legacy post-processing transforms are applied
- Console shows: `[terrain] legacy post-processing: DISABLED`
- Elevation data structure remains unchanged from `generateElevation()`

### Legacy Mode (Flag = true)
- All legacy terrain post-processing transforms are applied
- Console shows: `[terrain] legacy post-processing: ENABLED`
- Behavior matches previous implementation

## Console Output

The implementation adds clear console markers for verification:

```
[terrain] elevation.js complete { seaLevel: 0.234, landFrac: 0.35 }
[terrain] legacy post-processing: DISABLED
[terrain] skipping legacy post-processing - using noise elevation as authoritative
```

## Testing

### Automated Tests
A test file `test_terrain_post_processing.html` has been created to verify:

1. Default flag state (disabled)
2. Flag toggle functionality
3. Console marker presence
4. Elevation data structure consistency
5. Module import functionality

**To run the test:**
```bash
# Start a local server
python3 -m http.server 8000

# Open the test in your browser
open http://localhost:8000/test_terrain_post_processing.html
```

### Manual Testing
A manual test script `manual_test_terrain_flag.js` is provided for browser console testing:

1. Load the main application: `http://localhost:8000/index.html`
2. Open browser console (F12)
3. Copy and paste the contents of `manual_test_terrain_flag.js`
4. Follow the console instructions to test the feature flag

### Console Verification
When the flag is working correctly, you should see these console messages:

**Default mode (flag = false):**
```
[terrain] elevation.js complete { seaLevel: 0.234, landFrac: 0.35 }
[terrain] legacy post-processing: DISABLED
[terrain] skipping legacy post-processing - using noise elevation as authoritative
```

**Legacy mode (flag = true):**
```
[terrain] elevation.js complete { seaLevel: 0.234, landFrac: 0.35 }
[terrain] legacy post-processing: ENABLED
```

## Acceptance Criteria Met

✅ **Default behavior**: With `useLegacyTerrainPost = false`, the heightmap/sea level produced by `elevation.js` is not modified by template/erosion steps.

✅ **Legacy restoration**: Toggling the flag to `true` restores the prior behavior (legacy transforms run).

✅ **Console verification**: Console shows appropriate markers for both states.

✅ **No UI regressions**: View toggles, render, and coastline build should still run (no changes to public APIs).

✅ **Non-functional guardrails**: Legacy code is gated, not removed.

## Usage

### Enable Legacy Mode
```javascript
import { TerrainFlags, state } from './js/state.js';

// Enable legacy terrain post-processing
TerrainFlags.useLegacyTerrainPost = true;
state.useLegacyTerrainPost = true;
```

### Disable Legacy Mode (Default)
```javascript
// Disable legacy terrain post-processing
TerrainFlags.useLegacyTerrainPost = false;
state.useLegacyTerrainPost = false;
```

## Files Modified

1. `js/state.js` - Added TerrainFlags export and state property
2. `js/legacy-main.js` - Added import, console markers, and gated legacy transforms
3. `test_terrain_post_processing.html` - Created test file for verification

## Sanity Test Steps

1. Run "Generate Map" twice with default flag: land fraction & coast outline should be stable between runs (modulo noise seed)
2. Flip `TerrainFlags.useLegacyTerrainPost = true` and re-run: observe visibly different shapes consistent with previous legacy behavior
3. Flip back to `false` and confirm we're back to noise-authoritative output

## Downstream Impact

No downstream code modifications were required. The elevation data structure returned by `generateElevation()` remains unchanged, and all downstream consumers (water classification, coast computation, etc.) continue to work with the same interface.

The implementation ensures that when the flag is disabled, the elevation data from `elevation.js` is used directly without any post-processing modifications.
