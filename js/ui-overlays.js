// js/ui-overlays.js — settings modal + overlay/progress controls

/** Lookups with graceful fallback */
function byId(id) { return document.getElementById(id); }
function ensureOverlayRoot() {
  // Try existing container, else create a minimal one
  let root = byId('overlay');
  if (!root) {
    root = document.createElement('div');
    root.id = 'overlay';
    root.className = 'overlay hidden';
    root.innerHTML = `
      <div class="overlay-content">
        <div id="overlayMessage"></div>
        <div class="overlay-bar"><div id="overlayBar"></div></div>
      </div>`;
    document.body.appendChild(root);
  }
  return root;
}

/* ================= Settings Modal ================= */

export function openSettings() {
  const modal = byId('settingsModal');
  if (modal) {
    modal.style.display = 'block';
  }
}

export function closeSettings() {
  const modal = byId('settingsModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

export function toggleSettings() {
  const modal = byId('settingsModal');
  if (modal) {
    if (modal.style.display === 'block') {
      modal.style.display = 'none';
    } else {
      modal.style.display = 'block';
    }
  }
}

/* ================= Overlay / Progress ================= */

export function showOverlay(label) {
  const root = ensureOverlayRoot();
  root.classList.remove('hidden');
  if (label) setOverlayMessage(label);
}

export function hideOverlay() {
  const root = ensureOverlayRoot();
  root.classList.add('hidden');
}

export function setOverlayMessage(msg) {
  const m = byId('overlayMessage');
  if (m) m.textContent = msg ?? '';
}

export function setOverlayProgress(pct) {
  const bar = byId('overlayBar');
  if (!bar) return;
  const clamped = Math.max(0, Math.min(100, +pct || 0));
  bar.style.width = clamped + '%';
}

/** ProgressManager facade - moved from legacy-main.js */
export const ProgressManager = {
  overlay: null,
  fill: null,
  text: null,
  detail: null,
  isVisible: false,
  lastUpdate: 0,
  updateThrottle: 100, // Only update every 100ms
  _throttledUpdate: null, // Will hold throttled version
  
  init() {
    this.overlay = byId('progressOverlay');
    this.fill = byId('progressFill');
    this.text = byId('progressText');
    this.detail = byId('progressDetail');
    
    // Create throttled version of update that preserves 'this' context
    this._throttledUpdate = rafThrottle((percent, text, detail) => {
      this._update(percent, text, detail);
    });
  },
  
  show() {
    if (this.overlay) {
      this.overlay.style.display = 'flex';
      this.isVisible = true;
      // Force a repaint to ensure visibility
      this.overlay.offsetHeight;
    }
  },
  
  hide() {
    if (this.overlay) {
      this.overlay.style.display = 'none';
      this.isVisible = false;
    }
  },
  
  update(percent, text, detail = '') {
    // Use throttled version if available, otherwise direct update
    if (this._throttledUpdate) {
      this._throttledUpdate(percent, text, detail);
    } else {
      this._update(percent, text, detail);
    }
  },
  
  _update(percent, text, detail = '') {
    // Throttle updates to reduce spam, but allow final completion updates
    const now = Date.now();
    const isFinalUpdate = percent >= 100;
    if (!isFinalUpdate && now - this.lastUpdate < this.updateThrottle) {
      return;
    }
    this.lastUpdate = now;
    
    // Ensure overlay is visible before updating
    if (!this.isVisible) {
      this.show();
    }
    
    if (this.fill) {
      this.fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    }
    if (this.text) {
      this.text.textContent = text;
    }
    if (this.detail) {
      this.detail.textContent = detail;
    }
    
    // Force a repaint to ensure updates are visible
    if (this.overlay) {
      this.overlay.offsetHeight;
    }
  },
  
  setPhase(phase, percent) {
    const phases = {
      'init': { text: 'Initializing map generation...', percent: 5 },
      'voronoi': { text: 'Building Voronoi diagram...', percent: 15 },
      'terrain': { text: 'Generating terrain...', percent: 30 },
      'erosion': { text: 'Applying erosion...', percent: 45 },
      'rivers': { text: 'Computing rivers...', percent: 60 },
      'coastlines': { text: 'Drawing coastlines...', percent: 70 },
      'burgs': { text: 'Placing settlements...', percent: 80 },
      'routes': { text: 'Building routes...', percent: 90 },
      'final': { text: 'Finalizing...', percent: 95 }
    };
    
    const phaseInfo = phases[phase] || { text: phase, percent: percent || 50 };
    this.update(phaseInfo.percent, phaseInfo.text);
  },

  // Single-flight extensions
  attach(run) { this._run = run; },
  safeUpdate(run, ...args) {
    if (this._run === run) this.update?.(...args);
  },
  safeHide(run) {
    if (this._run === run) {
      console.log(`[RUN ${run}] overlay hide`);
      this.hide?.();
    }
  }
};

// Helper functions for throttling and debouncing (moved from legacy-main.js)
function rafThrottle(fn) {
  let ticking = false;
  return function(...args) {
    if (!ticking) {
      requestAnimationFrame(() => {
        fn.apply(this, args);
        ticking = false;
      });
      ticking = true;
    }
  };
}

function rafDebounce(fn) {
  let ticking = false;
  return function(...args) {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      fn.apply(this, args);
      ticking = false;
    });
  };
}

function heavyDebounce(fn, delay = 150) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), delay);
  };
}
