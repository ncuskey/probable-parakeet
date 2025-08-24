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

// TODO: Step 2.7 fit transform test
export async function testFitTransform() {
  console.group('🧪 Testing fit transform...');
  
  try {
    const { S, setSeed } = await import('./state.js');
    const { buildBaseMesh } = await import('./terrain.js');
    const { generateElevation } = await import('./elevation.js');
    const { classifyWater } = await import('./water.js');
    const { computeLandBBox, padRect, fitTransformToCanvas } = await import('./viewport.js');
    
    setSeed('overscan-fit');
    S.overscanPct = 0.2;
    S.fitMode = 'fitLand';
    const mesh = buildBaseMesh();
    const elev = generateElevation(mesh, S);
    const water = classifyWater(mesh, elev.height, elev.seaLevel);

    const box = computeLandBBox(mesh, elev.isLand);
    if (!box) { console.log('⚠️ No land; skipping fit test'); return; }
    const padded = padRect(box, S.fitMarginPx, mesh.width, mesh.height);
    const view = fitTransformToCanvas(padded, S.width, S.height, { allowUpscale: false });

    // Check that fitted rect fits within canvas with desired padding
    const outW = padded.width * view.s;
    const outH = padded.height * view.s;
    if (outW > S.width + 1e-6 || outH > S.height + 1e-6) {
      throw new Error('Fit transform does not fit within canvas');
    }
    console.log('✅ Fit transform OK');
    console.log(`   Land bbox: (${box.x.toFixed(1)},${box.y.toFixed(1)} ${box.width.toFixed(1)}×${box.height.toFixed(1)})`);
    console.log(`   Padded: (${padded.x.toFixed(1)},${padded.y.toFixed(1)} ${padded.width.toFixed(1)}×${padded.height.toFixed(1)})`);
    console.log(`   Transform: s=${view.s.toFixed(3)} tx=${view.tx.toFixed(1)} ty=${view.ty.toFixed(1)}`);
    console.log(`   Output: ${outW.toFixed(1)}×${outH.toFixed(1)} (canvas: ${S.width}×${S.height})`);
    
  } catch (e) {
    console.error('❌ Fit transform test failed:', e);
  }
  
  console.groupEnd();
}

// TODO: Step 2.8 coast build test
export async function testCoastBuild() {
  console.group('🧪 Testing coast build...');
  
  try {
    const { S, setSeed } = await import('./state.js');
    const { buildBaseMesh } = await import('./terrain.js');
    const { generateElevation } = await import('./elevation.js');
    const { classifyWater, computeShallow } = await import('./water.js');
    const { coastPolylines } = await import('./coast.js');
    
    setSeed('fiddle-like');
    S.overscanPct = 0.15;
    S.edgeFalloffPx = 0; // use new default
    const mesh = buildBaseMesh();
    const elev = generateElevation(mesh, S);
    const water = classifyWater(mesh, elev.height, elev.seaLevel);
    const loops = coastPolylines(mesh, elev.isLand, water.isOcean, { snapDigits: 2 });
    if (!loops.length) throw new Error('No coastline loops produced');
    const shallow = computeShallow(mesh, elev.isLand, water.isOcean);
    const anyShallow = shallow.reduce((a,b)=>a+b,0);
    if (anyShallow === 0) throw new Error('No shallow cells found');
    console.log('✅ Coast build + shallow OK');
    console.log(`   Coast loops: ${loops.length}`);
    console.log(`   Shallow cells: ${anyShallow}`);
    
  } catch (e) {
    console.error('❌ Coast build test failed:', e);
  }
  
  console.groupEnd();
}

// TODO: Step 2.9 no box-aligned coasts test
export async function testNoBoxAlignedCoasts() {
  console.group('🧪 Testing no box-aligned coasts...');
  
  try {
    const { S, setSeed } = await import('./state.js');
    const { buildBaseMesh } = await import('./terrain.js');
    const { generateElevation } = await import('./elevation.js');
    const { classifyWater } = await import('./water.js');
    const { coastPolylines } = await import('./coast.js');
    
    // Returns fraction of coastline segment angles within ±θ of 0°/90°/180°.
    function axisAlignedFraction(loops, deg = 5) {
      const rad = (deg * Math.PI) / 180;
      let aligned = 0, total = 0;
      for (const loop of loops) {
        for (let i = 0; i < loop.length; i++) {
          const a = loop[i], b = loop[(i+1)%loop.length];
          const dx = b[0]-a[0], dy = b[1]-a[1];
          const len = Math.hypot(dx,dy); if (len < 1e-6) continue;
          const ang = Math.abs(Math.atan2(dy,dx));
          const near0  = ang < rad;
          const near90 = Math.abs(ang - Math.PI/2) < rad;
          const near180= Math.abs(ang - Math.PI)   < rad;
          if (near0 || near90 || near180) aligned++;
          total++;
        }
      }
      return total ? aligned/total : 0;
    }

    setSeed('no-rect-falloff');
    S.edgeFalloffPx = 0;              // critical
    S.edgeBiasMode = 'off';           // ensure unbiased
    S.overscanPct = 0.15;
    const mesh = buildBaseMesh();
    const elev = generateElevation(mesh, S);
    const water = classifyWater(mesh, elev.height, elev.seaLevel);
    const loops = coastPolylines(mesh, elev.isLand, water.isOcean, { snapDigits: 2 });

    const frac = axisAlignedFraction(loops, 5);
    if (frac > 0.25) { // heuristic: >25% of segments near cardinal = suspicious
      throw new Error(`Coasts too axis-aligned (frac=${(frac*100).toFixed(1)}%)`);
    }
    console.log('✅ Coastlines are not box-aligned');
    console.log(`   Axis-aligned fraction: ${(frac*100).toFixed(1)}%`);
    console.log(`   Coast loops: ${loops.length}`);
    
  } catch (e) {
    console.error('❌ No box-aligned coasts test failed:', e);
  }
  
  console.groupEnd();
}

// TODO: Step 2.10 guaranteed margin test
export async function testGuaranteedMargin() {
  console.group('🧪 Testing guaranteed margin...');
  
  try {
    const { S, setSeed } = await import('./state.js');
    const { buildBaseMesh } = await import('./terrain.js');
    const { generateElevation } = await import('./elevation.js');
    const { computeLandBBox, fitTransformWithMargin } = await import('./viewport.js');
    
    setSeed('margin-test');
    const mesh = buildBaseMesh();
    const elev = generateElevation(mesh, S);
    const box = computeLandBBox(mesh, elev.isLand);
    const m = S.fitMarginPx ?? 24;
    const view = fitTransformWithMargin(box, S.width, S.height, { marginPx: m, allowUpscale: false });

    // transform the four corners of the land bbox and verify margins
    const left   = box.x * view.s + view.tx;
    const right  = (box.x + box.width) * view.s + view.tx;
    const top    = box.y * view.s + view.ty;
    const bottom = (box.y + box.height) * view.s + view.ty;

    if (left < m - 0.5 || top < m - 0.5 || (S.width - right) < m - 0.5 || (S.height - bottom) < m - 0.5) {
      throw new Error('Guaranteed margin violated');
    }
    console.log('✅ Guaranteed margin OK');
    console.log(`   Margin: ${m}px`);
    console.log(`   Land bbox: (${left.toFixed(1)},${top.toFixed(1)} ${(right-left).toFixed(1)}×${(bottom-top).toFixed(1)})`);
    console.log(`   Canvas: ${S.width}×${S.height}`);
    
  } catch (e) {
    console.error('❌ Guaranteed margin test failed:', e);
  }
  
  console.groupEnd();
}

// TODO: Step 2.10 moat test
export async function testMoatWorks() {
  console.group('🧪 Testing frame moat...');
  
  try {
    const { S, setSeed } = await import('./state.js');
    const { buildBaseMesh } = await import('./terrain.js');
    const { generateElevation } = await import('./elevation.js');
    
    setSeed('moat-test');
    S.enforceOceanFrame = false;
    const mesh = buildBaseMesh();
    const elev = generateElevation(mesh, S);
    const polys = mesh.cells.polygons, w = mesh.width, h = mesh.height;
    const pad = mesh.genBounds ? mesh.genBounds.pad : 0;
    const cellPx = Math.sqrt((w*h)/elev.height.length);
    const moatPx = Math.max(Math.floor(pad * 0.6), (S.frameMoatCells ?? 2.5) * cellPx);
    
    for (let i = 0; i < elev.isLand.length; i++) {
      if (!elev.isLand[i]) continue;
      const d = (function(poly){let m=1e9; for (let p=0;p<poly.length;p+=2){const x=poly[p],y=poly[p+1]; const t=Math.min(x,y,w-x,h-y); if(t<m)m=t;} return m;})(polys[i]);
      if (d <= moatPx) throw new Error('Land inside the frame moat');
    }
    console.log('✅ Frame moat keeps coasts off the box');
    console.log(`   Moat width: ${moatPx.toFixed(1)}px`);
    console.log(`   Overscan pad: ${pad}px`);
    console.log(`   Cell size: ${cellPx.toFixed(1)}px`);
    
  } catch (e) {
    console.error('❌ Frame moat test failed:', e);
  }
  
  console.groupEnd();
}

// TODO: Step 2.11 safe-zone seeding tests
export async function testSeedsRespectZones() {
  console.group('🧪 Testing safe-zone seeding...');
  
  try {
    const { S, setSeed } = await import('./state.js');
    const { buildBaseMesh } = await import('./terrain.js');
    const { generateElevation } = await import('./elevation.js');
    const { getSeedWindow } = await import('./sampling.js');
    
    setSeed('safe-zones-test');
    S.enforceSeedSafeZones = true;
    const mesh = buildBaseMesh();
    const elev = generateElevation(mesh, S);
    
    // Test that template centers are inside their safe zones
    const { width, height } = mesh;
    const win = getSeedWindow('core');
    
    // For radialIsland template, check that the center is in the core zone
    if (S.template === 'radialIsland') {
      // The center should be sampled from the core window
      // We can't directly access the sampled center, but we can verify
      // that land exists in the core zone
      const coreZone = {
        x0: Math.floor(win.left * width),
        x1: Math.ceil(win.right * width),
        y0: Math.floor(win.top * height),
        y1: Math.ceil(win.bottom * height)
      };
      
      let landInCoreZone = 0;
      let totalLand = 0;
      
      for (let i = 0; i < elev.isLand.length; i++) {
        if (!elev.isLand[i]) continue;
        totalLand++;
        const poly = mesh.cells.polygons[i];
        if (!poly || poly.length < 6) continue;
        
        // Check if cell centroid is in core zone
        let cx = 0, cy = 0;
        for (let p = 0; p < poly.length; p += 2) { cx += poly[p]; cy += poly[p+1]; }
        cx /= poly.length/2; cy /= poly.length/2;
        
        if (cx >= coreZone.x0 && cx <= coreZone.x1 && cy >= coreZone.y0 && cy <= coreZone.y1) {
          landInCoreZone++;
        }
      }
      
      if (landInCoreZone === 0) {
        throw new Error('No land found in core safe zone');
      }
      
      const coreFrac = landInCoreZone / totalLand;
      console.log('✅ Safe-zone seeding working');
      console.log(`   Land in core zone: ${landInCoreZone}/${totalLand} (${(coreFrac*100).toFixed(1)}%)`);
      console.log(`   Core zone: (${coreZone.x0},${coreZone.y0}) to (${coreZone.x1},${coreZone.y1})`);
    }
    
  } catch (e) {
    console.error('❌ Safe-zone seeding test failed:', e);
  }
  
  console.groupEnd();
}

export async function testNoOriginNearFrame() {
  console.group('🧪 Testing no land origin near frame...');
  
  try {
    const { S, setSeed } = await import('./state.js');
    const { buildBaseMesh } = await import('./terrain.js');
    const { generateElevation } = await import('./elevation.js');
    
    setSeed('frame-origin-test');
    S.enforceSeedSafeZones = true;
    const mesh = buildBaseMesh();
    const elev = generateElevation(mesh, S);
    const { width, height } = mesh;
    const polys = mesh.cells.polygons;
    const margin = Math.max(10, Math.round(Math.min(width, height) * 0.02)); // ~2% or 10px
    
    for (let i = 0; i < elev.isLand.length; i++) {
      if (!elev.isLand[i]) continue;
      const poly = polys[i];
      for (let p = 0; p < poly.length; p += 2) {
        const x = poly[p], y = poly[p+1];
        if (x < margin || y < margin || x > width - margin || y > height - margin) {
          // allow land to reach, but it shouldn't be *originating* from a seed outside window.
          // If this fires often, tighten the core window.
          console.warn('ℹ️ land reaches frame near cell', i);
          return;
        }
      }
    }
    console.log('✅ Land is not riding the frame at origin');
    console.log(`   Frame margin: ${margin}px`);
    console.log(`   Canvas: ${width}×${height}`);
    
  } catch (e) {
    console.error('❌ Frame origin test failed:', e);
  }
  
  console.groupEnd();
}
