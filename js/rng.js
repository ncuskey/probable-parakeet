// TODO: Enhanced deterministic PRNG with string seed support
// Search anchors: ~1-50 (RNG core), ~51-100 (API functions), ~101-150 (tests)

/**
 * Enhanced deterministic PRNG module
 * Builds on existing mulberry32 but adds string seed support and better API
 */

// Hash string to 32-bit integer for seeding
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

// Enhanced mulberry32 with string seed support
function mulberry32(seed) {
  return function() {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Create a seeded RNG instance
 * @param {string|number} seedInput - String or number seed
 * @returns {Object} RNG object with methods
 */
export function makeRng(seedInput) {
  // Convert string seeds to numbers, fallback to default
  const seed = typeof seedInput === 'string' ? hashString(seedInput) : 
               Number.isFinite(+seedInput) ? +seedInput : 12345;
  
  const rng = mulberry32(seed);
  
  return {
    // Core random number generator
    random: rng,
    
    // Convenience methods
    float: rng,
    int(min, max) {
      return Math.floor(rng() * (max - min + 1)) + min;
    },
    
    // Array operations
    shuffle(arr) {
      const result = [...arr];
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
      }
      return result;
    },
    
    choice(array) {
      return array[array.length * rng() | 0];
    },
    
    // Range helpers
    range(min, max) {
      return min + (max - min) * rng();
    },
    
    // Seed info
    seed: seedInput,
    seedNumber: seed
  };
}

/**
 * Create RNG from state seed (convenience)
 * @param {string|number} seed - Seed value
 * @param {number} fallback - Fallback seed if input is invalid
 * @returns {Object} RNG object
 */
export function rngFromSeed(seed, fallback = 12345) {
  return makeRng(seed || fallback);
}

// Insert here: Additional RNG utilities if needed
// - Gaussian/normal distribution
// - Weighted random selection
// - Noise functions
