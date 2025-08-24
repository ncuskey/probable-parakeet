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
