// js/selftest.js — lightweight ESM self-test (runs in-browser)
// TODO: Add browser self-test harness for module validation
// Search anchors: ~1-100 (selftest module)

// Usage: add ?selftest=1 to URL or include this script manually on a test page.

(async () => {
  const results = [];
  const pass = (name) => results.push({ name, ok: true });
  const fail = (name, e) => results.push({ name, ok: false, err: e });

  function logSummary() {
    const ok = results.filter(r => r.ok).length;
    const bad = results.length - ok;
    console.groupCollapsed(`🧪 Self-test: ${ok} passed, ${bad} failed`);
    for (const r of results) {
      if (r.ok) console.log('✅', r.name);
      else console.warn('❌', r.name, r.err ?? '');
    }
    console.groupEnd();
  }

  try {
    const state = await import('./state.js');
    if (state?.S && typeof state.getWorld === 'function') pass('state exports');
    else throw new Error('Missing S or getWorld');
  } catch (e) { fail('state exports', e); }

  try {
    const render = await import('./render.js');
    const layers = render?.getLayers?.();
    if (layers && 'mapCells' in layers && typeof render.setViewMode === 'function') pass('render exports + getLayers');
    else throw new Error('Missing getLayers / setViewMode');
  } catch (e) { fail('render exports', e); }

  try {
    const recolor = await import('./recolor.js');
    if (typeof recolor.recolor === 'function') pass('recolor.recolor');
    else throw new Error('Missing recolor()');
  } catch (e) { fail('recolor exports', e); }

  try {
    const terrain = await import('./terrain.js');
    if (typeof terrain.applyTemplate === 'function') pass('terrain.applyTemplate');
    else throw new Error('Missing applyTemplate()');
  } catch (e) { fail('terrain exports', e); }

  try {
    const rivers = await import('./rivers.js');
    if (typeof rivers.computeRivers === 'function') pass('rivers.computeRivers');
    else throw new Error('Missing computeRivers()');
  } catch (e) { fail('rivers exports', e); }

  try {
    const regions = await import('./regions.js');
    if (typeof regions.computeAndDrawRegions === 'function') pass('regions.computeAndDrawRegions');
    else throw new Error('Missing computeAndDrawRegions()');
  } catch (e) { fail('regions exports', e); }

  try {
    const routes = await import('./routes.js');
    if (typeof routes.computeRoutes === 'function') pass('routes.computeRoutes');
    else throw new Error('Missing computeRoutes()');
  } catch (e) { fail('routes exports', e); }

  try {
    const ui = await import('./ui.js');
    if (typeof ui.wireUI === 'function') pass('ui.wireUI');
    else throw new Error('Missing wireUI()');
  } catch (e) { fail('ui exports', e); }

  try {
    const overlays = await import('./ui-overlays.js');
    if (typeof overlays.toggleSettings === 'function' && overlays.ProgressManager) pass('ui-overlays exports');
    else throw new Error('Missing toggleSettings/ProgressManager');
  } catch (e) { fail('ui-overlays exports', e); }

  // TODO: Test new mesh generation system
  try {
    const rng = await import('./rng.js');
    if (typeof rng.makeRng === 'function') pass('rng.makeRng');
    else throw new Error('Missing makeRng()');
  } catch (e) { fail('rng exports', e); }

  try {
    const poisson = await import('./mesh/poisson.js');
    if (typeof poisson.samplePoints === 'function') pass('poisson.samplePoints');
    else throw new Error('Missing samplePoints()');
  } catch (e) { fail('poisson exports', e); }

  try {
    const mesh = await import('./mesh/mesh.js');
    if (typeof mesh.buildMesh === 'function') pass('mesh.buildMesh');
    else throw new Error('Missing buildMesh()');
  } catch (e) { fail('mesh exports', e); }

  try {
    const terrain = await import('./terrain.js');
    if (typeof terrain.buildBaseMesh === 'function') pass('terrain.buildBaseMesh');
    else throw new Error('Missing buildBaseMesh()');
  } catch (e) { fail('terrain.buildBaseMesh', e); }

  // TODO: Test Step 2 elevation generation
  try {
    const noise = await import('./noise.js');
    if (typeof noise.makeNoise2D === 'function') pass('noise.makeNoise2D');
    else throw new Error('Missing makeNoise2D()');
  } catch (e) { fail('noise exports', e); }

  try {
    const elevation = await import('./elevation.js');
    if (typeof elevation.generateElevation === 'function') pass('elevation.generateElevation');
    else throw new Error('Missing generateElevation()');
  } catch (e) { fail('elevation exports', e); }

  // TODO: Test Step 2.5 water classification
  try {
    const water = await import('./water.js');
    if (typeof water.classifyWater === 'function') pass('water.classifyWater');
    else throw new Error('Missing classifyWater()');
  } catch (e) { fail('water exports', e); }

  logSummary();
})();

// TODO: Determinism test for mesh generation
export async function testMeshDeterminism() {
  console.group('🧪 Testing mesh determinism...');
  
  try {
    const { S, setSeed, getRng } = await import('./state.js');
    const { buildBaseMesh } = await import('./terrain.js');
    
    const seed = 'test-determinism-123';
    setSeed(seed);
    
    // First run
    const run1 = buildBaseMesh();
    const points1 = run1.points;
    
    // Reset and run again
    setSeed(seed);
    const run2 = buildBaseMesh();
    const points2 = run2.points;
    
    // Compare results
    if (points1.length !== points2.length) {
      throw new Error(`Point count differs: ${points1.length} vs ${points2.length}`);
    }
    
    for (let i = 0; i < points1.length; i++) {
      if (points1[i] !== points2[i]) {
        throw new Error(`Points differ at index ${i}: ${points1[i]} vs ${points2[i]}`);
      }
    }
    
    console.log('✅ Mesh determinism test passed');
    console.log(`   Generated ${points1.length/2} points`);
    console.log(`   Cell count: ${run1.cellCount}`);
    console.log(`   Edge count: ${run1.edgeCount}`);
    
  } catch (e) {
    console.error('❌ Mesh determinism test failed:', e);
  }
  
  console.groupEnd();
}

// TODO: Step 2 elevation determinism test
export async function testElevationDeterminism() {
  console.group('🧪 Testing elevation determinism...');
  
  try {
    const { S, setSeed } = await import('./state.js');
    const { buildBaseMesh } = await import('./terrain.js');
    const { generateElevation } = await import('./elevation.js');
    
    const seed = 'step2-seed';
    setSeed(seed);
    const mesh1 = buildBaseMesh();
    const a = generateElevation(mesh1, S);

    setSeed(seed);
    const mesh2 = buildBaseMesh();
    const b = generateElevation(mesh2, S);

    if (a.seaLevel !== b.seaLevel) throw new Error('Elevation determinism: seaLevel differs');
    for (let i = 0; i < a.height.length; i++) {
      if (a.height[i] !== b.height[i]) throw new Error(`Elevation determinism: height differs at ${i}`);
    }
    console.log('✅ Elevation determinism OK');
    
  } catch (e) {
    console.error('❌ Elevation determinism test failed:', e);
  }
  
  console.groupEnd();
}

// TODO: Step 2 target land fraction test
export async function testTargetLandFraction(tolerance = 0.02) {
  console.group('🧪 Testing target land fraction...');
  
  try {
    const { S, setSeed } = await import('./state.js');
    const { buildBaseMesh } = await import('./terrain.js');
    const { generateElevation } = await import('./elevation.js');
    
    setSeed('step2-landfrac');
    S.targetLandFrac = 0.40;
    const mesh = buildBaseMesh();
    const e = generateElevation(mesh, S);
    const frac = e.isLand.reduce((s,v)=>s+v,0) / e.isLand.length;
    
    if (Math.abs(frac - S.targetLandFrac) > tolerance) {
      throw new Error(`Target land fraction off: got ${frac.toFixed(3)}, want ${S.targetLandFrac}`);
    }
    console.log('✅ Target land fraction near target');
    console.log(`   Target: ${(S.targetLandFrac*100).toFixed(1)}%`);
    console.log(`   Actual: ${(frac*100).toFixed(1)}%`);
    console.log(`   Sea level: ${e.seaLevel.toFixed(3)}`);
    
  } catch (e) {
    console.error('❌ Target land fraction test failed:', e);
  }
  
  console.groupEnd();
}

// TODO: Step 2.5 water invariants test
export async function testWaterInvariants() {
  console.group('🧪 Testing water invariants...');
  
  try {
    const { S, setSeed } = await import('./state.js');
    const { buildBaseMesh } = await import('./terrain.js');
    const { generateElevation } = await import('./elevation.js');
    const { classifyWater, computeCoastAndDistance } = await import('./water.js');
    
    setSeed('ocean-flood-ok');
    const mesh = buildBaseMesh();
    const elev = generateElevation(mesh, S);

    const water = classifyWater(mesh, elev.height, elev.seaLevel);
    const coast = computeCoastAndDistance(mesh, elev.isLand, water.isOcean);

    const N = elev.height.length;

    // 1) partition: water == ocean ∪ lake and they don't overlap
    for (let i = 0; i < N; i++) {
      const waterBit = elev.height[i] <= elev.seaLevel ? 1 : 0;
      if (waterBit !== (water.isOcean[i] | water.isLake[i])) {
        throw new Error(`Water partition mismatch at ${i}`);
      }
      if (water.isOcean[i] && water.isLake[i]) {
        throw new Error(`Cell ${i} marked as both ocean and lake`);
      }
    }

    // 2) coast cells are land and have at least one ocean neighbor
    const ns = mesh.cells.neighbors;
    for (let i = 0; i < N; i++) {
      if (!coast.isCoast[i]) continue;
      if (!elev.isLand[i]) throw new Error(`Coast cell ${i} not land`);
      let ok = false;
      for (const j of ns[i]) if (water.isOcean[j]) { ok = true; break; }
      if (!ok) throw new Error(`Coast cell ${i} has no ocean neighbor`);
    }

    console.log('✅ Water invariants OK');
    console.log(`   Total cells: ${N}`);
    console.log(`   Land cells: ${elev.isLand.reduce((a,b)=>a+b,0)}`);
    console.log(`   Ocean cells: ${water.isOcean.reduce((a,b)=>a+b,0)}`);
    console.log(`   Lake cells: ${water.isLake.reduce((a,b)=>a+b,0)}`);
    console.log(`   Coast cells: ${coast.isCoast.reduce((a,b)=>a+b,0)}`);
    
  } catch (e) {
    console.error('❌ Water invariants test failed:', e);
  }
  
  console.groupEnd();
}

// TODO: Step 2.6 frame safety test
export async function testNoLandOnFrame() {
  console.group('🧪 Testing frame safety...');
  
  try {
    const { S, setSeed } = await import('./state.js');
    const { buildBaseMesh } = await import('./terrain.js');
    const { generateElevation } = await import('./elevation.js');
    
    function touchesBorder(poly, w, h, eps=1e-3) {
      for (let i = 0; i < poly.length; i += 2) {
        const x = poly[i], y = poly[i+1];
        if (x <= eps || y <= eps || x >= w - eps || y >= h - eps) return true;
      }
      return false;
    }

    setSeed('frame-guard');
    S.enforceOceanFrame = true;
    const mesh = buildBaseMesh();
    const elev = generateElevation(mesh, S);
    const { width, height } = mesh;
    const polys = mesh.cells.polygons;

    for (let i = 0; i < elev.height.length; i++) {
      if (elev.height[i] > elev.seaLevel && touchesBorder(polys[i], width, height)) {
        throw new Error(`Land touches frame at cell ${i}`);
      }
    }
    console.log('✅ No land on frame when enforceOceanFrame=true');
    console.log(`   Sea level: ${elev.seaLevel.toFixed(3)}`);
    console.log(`   Land cells: ${elev.isLand.reduce((a,b)=>a+b,0)}`);
    
  } catch (e) {
    console.error('❌ Frame safety test failed:', e);
  }
  
  console.groupEnd();
}
