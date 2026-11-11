import { Rng } from './rng';

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export function createNoise1D(rng: Rng): (x: number) => number {
  const values = new Float64Array(256);
  for (let i = 0; i < 256; i++) values[i] = rng.next() * 2 - 1;
  return (x: number) => {
    const x0 = Math.floor(x);
    const t = smooth(x - x0);
    const i0 = ((x0 % 256) + 256) % 256;
    const i1 = (i0 + 1) % 256;
    return values[i0] * (1 - t) + values[i1] * t;
  };
}

export function createNoise2D(rng: Rng): (x: number, y: number) => number {
  const values = new Float64Array(256);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    values[i] = rng.next() * 2 - 1;
    perm[i] = i;
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const tmp = perm[i];
    perm[i] = perm[j];
    perm[j] = tmp;
  }
  const at = (ix: number, iy: number) => {
    const x = ((ix % 256) + 256) % 256;
    const y = ((iy % 256) + 256) % 256;
    return values[perm[(perm[x] + y) % 256]];
  };
  return (x: number, y: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smooth(x - x0);
    const ty = smooth(y - y0);
    const a = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
    const b = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
    return a * (1 - ty) + b * ty;
  };
}

export function fbm1D(
  noise: (x: number) => number,
  x: number,
  octaves = 3,
  lacunarity = 2,
  gain = 0.5
): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

export function fbm2D(
  noise: (x: number, y: number) => number,
  x: number,
  y: number,
  octaves = 3,
  lacunarity = 2,
  gain = 0.5
): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}
