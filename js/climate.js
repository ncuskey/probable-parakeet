// js/climate.js — precipitation provider (shim until real climate module exists)
import { getWorld } from './state.js';

export function computePrecipArray() {
  const { cells, isWater } = getWorld();
  const base = +(document.getElementById('rainInput')?.value ?? 0.5); // keep legacy UI linkage
  const out = new Float32Array(cells.length);
  for (let i = 0; i < cells.length; i++) out[i] = isWater && isWater[i] ? 0 : base;
  return out;
}
