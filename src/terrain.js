/* Terrain sampling and helpers (extracted from original main.js) */
import { Simplex } from './noise.js';
const simplex = new Simplex(Date.now() & 65535);

export const NOISE_SCALE = 0.002;
export const OCTAVES = 4;
export const HEIGHT_SCALE = 36;

export function sampleTerrain(x, z){
  let amp = 1, freq = NOISE_SCALE;
  let sum = 0, max=0;
  for(let o=0;o<OCTAVES;o++){
    const n = simplex.noise2d(x*freq, z*freq);
    const val = 1 - Math.abs(n);
    sum += val * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2;
  }
  const h = (sum / max) * HEIGHT_SCALE;
  const baseline = simplex.noise2d(x*0.0006, z*0.0006) * 6;
  return h + baseline;
}

export function sampleNormal(x, z, eps = 0.5){
  const hL = sampleTerrain(x - eps, z);
  const hR = sampleTerrain(x + eps, z);
  const hD = sampleTerrain(x, z - eps);
  const hU = sampleTerrain(x, z + eps);
  const dx = (hR - hL) / (2*eps);
  const dz = (hU - hD) / (2*eps);
  const nx = -dx, ny = 1, nz = -dz;
  const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
  return new THREE.Vector3(nx/len, ny/len, nz/len);
}

export function colorForHeight(h){
  if(h < 6){
    const t = Math.max(0, Math.min(1, (h+4)/10));
    return {r: 0.09 + 0.2*t, g: 0.5 + 0.3*t, b: 0.05};
  } else if(h < 16){
    const t = (h-6)/10;
    return {r: 0.34 + 0.2*t, g: 0.28, b: 0.12};
  } else {
    const t = Math.min(1, (h-16)/12);
    return {r: 0.9*t + 0.6*(1-t), g:0.9*t + 0.6*(1-t), b:0.9*t + 0.6*(1-t)};
  }
}