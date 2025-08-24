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

  logSummary();
})();
