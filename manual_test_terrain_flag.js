// Manual Test Script for Terrain Post-Processing Flag
// Run this in the browser console after loading the main application

console.log('🧪 Manual Terrain Post-Processing Flag Test');
console.log('==========================================');

// Test 1: Check if the flag is available
console.log('\n1. Checking flag availability...');
try {
    // Try to access the flag from the global state
    const state = window.__state?.S || window.__state?.state;
    const TerrainFlags = window.__state?.TerrainFlags;
    
    if (state && 'useLegacyTerrainPost' in state) {
        console.log('✅ state.useLegacyTerrainPost is available');
        console.log(`   Current value: ${state.useLegacyTerrainPost}`);
    } else {
        console.log('❌ state.useLegacyTerrainPost not found');
    }
    
    if (TerrainFlags && 'useLegacyTerrainPost' in TerrainFlags) {
        console.log('✅ TerrainFlags.useLegacyTerrainPost is available');
        console.log(`   Current value: ${TerrainFlags.useLegacyTerrainPost}`);
    } else {
        console.log('❌ TerrainFlags.useLegacyTerrainPost not found');
    }
} catch (error) {
    console.log('❌ Error accessing flags:', error.message);
}

// Test 2: Test flag toggle functionality
console.log('\n2. Testing flag toggle...');
try {
    const state = window.__state?.S || window.__state?.state;
    const TerrainFlags = window.__state?.TerrainFlags;
    
    if (state && TerrainFlags) {
        // Test setting to true
        const originalState = state.useLegacyTerrainPost;
        const originalFlags = TerrainFlags.useLegacyTerrainPost;
        
        state.useLegacyTerrainPost = true;
        TerrainFlags.useLegacyTerrainPost = true;
        
        if (state.useLegacyTerrainPost === true && TerrainFlags.useLegacyTerrainPost === true) {
            console.log('✅ Flags can be set to true');
        } else {
            console.log('❌ Failed to set flags to true');
        }
        
        // Test setting to false
        state.useLegacyTerrainPost = false;
        TerrainFlags.useLegacyTerrainPost = false;
        
        if (state.useLegacyTerrainPost === false && TerrainFlags.useLegacyTerrainPost === false) {
            console.log('✅ Flags can be set to false');
        } else {
            console.log('❌ Failed to set flags to false');
        }
        
        // Restore original values
        state.useLegacyTerrainPost = originalState;
        TerrainFlags.useLegacyTerrainPost = originalFlags;
        console.log('✅ Original flag values restored');
    }
} catch (error) {
    console.log('❌ Error testing flag toggle:', error.message);
}

// Test 3: Check if generate function is available
console.log('\n3. Checking generate function...');
if (typeof window.generate === 'function') {
    console.log('✅ window.generate function is available');
} else {
    console.log('❌ window.generate function not found');
}

// Test 4: Instructions for manual testing
console.log('\n4. Manual Testing Instructions:');
console.log('   a) Set TerrainFlags.useLegacyTerrainPost = false (default)');
console.log('   b) Click "Generate Map" and check console for:');
console.log('      - "[terrain] elevation.js complete"');
console.log('      - "[terrain] legacy post-processing: DISABLED"');
console.log('      - "[terrain] skipping legacy post-processing"');
console.log('   c) Set TerrainFlags.useLegacyTerrainPost = true');
console.log('   d) Click "Generate Map" again and check console for:');
console.log('      - "[terrain] legacy post-processing: ENABLED"');
console.log('   e) Compare the generated maps visually');

console.log('\n🎉 Manual test script completed!');
console.log('Follow the instructions above to test the feature flag functionality.');
