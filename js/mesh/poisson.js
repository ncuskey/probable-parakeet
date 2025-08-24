// TODO: Bridson Poisson-disc sampling for blue-noise point generation
// Search anchors: ~1-50 (core algorithm), ~51-100 (grid helpers), ~101-150 (packing)

/**
 * Poisson-disc sampling implementation (Bridson algorithm)
 * Generates blue-noise point clouds for even cell distribution
 */

/**
 * Generate Poisson-disc sampled points
 * @param {Object} params - Sampling parameters
 * @param {number} params.width - Map width
 * @param {number} params.height - Map height  
 * @param {number} params.minDist - Minimum distance between points
 * @param {number} params.k - Number of attempts per active point (default: 30)
 * @param {Object} rng - Random number generator
 * @returns {Float32Array} Packed [x0,y0,x1,y1,...] coordinates
 */
export function samplePoints({ width, height, minDist, k = 30 }, rng) {
  // TODO: Performance optimization - use grid for spatial queries
  const cellSize = minDist / Math.SQRT2;
  const gridW = Math.ceil(width / cellSize);
  const gridH = Math.ceil(height / cellSize);
  const grid = new Int32Array(gridW * gridH).fill(-1);
  const points = [];
  const active = [];

  // TODO: Grid index helper
  function gridIndex(x, y) { 
    return (y * gridW + x) | 0; 
  }

  // TODO: Insert point into grid
  function insert(p, idx) {
    const gx = Math.floor(p[0] / cellSize);
    const gy = Math.floor(p[1] / cellSize);
    grid[gridIndex(gx, gy)] = idx;
  }

  // TODO: Check if point is within bounds
  function inRange(p) { 
    return p[0] >= 0 && p[0] < width && p[1] >= 0 && p[1] < height; 
  }

  // TODO: Check if point is far enough from existing points
  function isFar(p) {
    const gx = Math.floor(p[0] / cellSize);
    const gy = Math.floor(p[1] / cellSize);
    
    // Check 5x5 grid neighborhood
    for (let y = Math.max(0, gy - 2); y <= Math.min(gridH - 1, gy + 2); y++) {
      for (let x = Math.max(0, gx - 2); x <= Math.min(gridW - 1, gx + 2); x++) {
        const gi = gridIndex(x, y);
        if (grid[gi] !== -1) {
          const q = points[grid[gi]];
          const dx = q[0] - p[0], dy = q[1] - p[1];
          if (dx * dx + dy * dy < minDist * minDist) return false;
        }
      }
    }
    return true;
  }

  // TODO: Seed with initial point
  const p0 = [rng.float() * width, rng.float() * height];
  points.push(p0); 
  active.push(0); 
  insert(p0, 0);

  // TODO: Main sampling loop
  while (active.length) {
    const i = active[(active.length * rng.float()) | 0];
    let found = false;
    
    // Try k times to find a valid new point
    for (let n = 0; n < k; n++) {
      const r = minDist * (1 + rng.float());
      const theta = 2 * Math.PI * rng.float();
      const p = [
        points[i][0] + r * Math.cos(theta), 
        points[i][1] + r * Math.sin(theta)
      ];
      
      if (inRange(p) && isFar(p)) {
        points.push(p);
        insert(p, points.length - 1);
        active.push(points.length - 1);
        found = true; 
        break;
      }
    }
    
    if (!found) {
      // Remove i from active list
      const last = active.pop();
      if (last !== i) {
        const idx = active.indexOf(i);
        if (idx !== -1) active[idx] = last;
      }
    }
  }

  // TODO: Pack into flat Float32Array for performance
  const flat = new Float32Array(points.length * 2);
  for (let i = 0; i < points.length; i++) { 
    flat[2*i] = points[i][0]; 
    flat[2*i+1] = points[i][1]; 
  }
  
  return flat;
}

// Insert here: Additional sampling utilities
// - Adaptive density sampling
// - Constrained sampling (avoiding certain areas)
// - Multi-scale sampling
