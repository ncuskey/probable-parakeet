// TODO: Step 2 - Deterministic hash-based value noise + FBM + simple domain warp
// No RNG state usage per sample => stable across calls with same seed.

function xorshift32(i) {
  // Robert Jenkins' 32 bit integer hash with xorshift-ish mixing
  i |= 0;
  i = i + 0x7ed55d16 + (i << 12) | 0;
  i = i ^ 0xc761c23c ^ (i >>> 19);
  i = i + 0x165667b1 + (i << 5) | 0;
  i = i + 0xd3a2646c ^ (i << 9);
  i = i + 0xfd7046c5 + (i << 3) | 0;
  i = i ^ 0xb55a4f09 ^ (i >>> 16);
  return i >>> 0;
}

function hash2(seedInt, ix, iy) {
  // Mix seed with integer lattice coords
  let h = seedInt ^ (ix * 374761393) ^ (iy * 668265263);
  return xorshift32(h);
}

function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(t) { return t * t * (3 - 2 * t); }

export function makeNoise2D(seedStr) {
  // convert seed string to 32-bit int
  let s = 2166136261 >>> 0;
  for (let i = 0; i < String(seedStr).length; i++) {
    s ^= String(seedStr).charCodeAt(i);
    s = Math.imul(s, 16777619);
  }
  const seedInt = s >>> 0;

  // Value noise: random values on integer grid, bilinear-smoothed
  return function noise2(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const u = smoothstep(fx), v = smoothstep(fy);

    const h00 = hash2(seedInt, ix,   iy);
    const h10 = hash2(seedInt, ix+1, iy);
    const h01 = hash2(seedInt, ix,   iy+1);
    const h11 = hash2(seedInt, ix+1, iy+1);

    // map uint32 -> [0,1]
    const n00 = (h00 >>> 8) / 0xFFFFFF;
    const n10 = (h10 >>> 8) / 0xFFFFFF;
    const n01 = (h01 >>> 8) / 0xFFFFFF;
    const n11 = (h11 >>> 8) / 0xFFFFFF;

    const nx0 = lerp(n00, n10, u);
    const nx1 = lerp(n01, n11, u);
    const nxy = lerp(nx0, nx1, v);

    // return in [-1, 1]
    return nxy * 2 - 1;
  };
}

export function fbm2(noise2, x, y, { octaves = 5, lacunarity = 2.0, gain = 0.5, scale = 1.0 } = {}) {
  let amp = 0.5, freq = 1.0, sum = 0.0, norm = 0.0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq / scale, y * freq / scale);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / (norm || 1); // [-1,1]
}

export function warp2(noise2, x, y, { scale = 200, amp = 20 } = {}) {
  // compute small vector offset from 2 channels of noise
  const wx = noise2(x / scale, y / scale);
  const wy = noise2((x + 137) / scale, (y - 91) / scale);
  return [x + wx * amp, y + wy * amp];
}
