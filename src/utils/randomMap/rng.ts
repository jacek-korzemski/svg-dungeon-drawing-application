export interface Rng {
  next: () => number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: Rng, a: number, b: number): number {
  if (b <= a) return a;
  return a + Math.floor(rng.next() * (b - a + 1));
}

export function chance(rng: Rng, p: number): boolean {
  return rng.next() < p;
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng.next() * arr.length)];
}

export function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function range(rng: Rng, a: number, b: number): number {
  return a + rng.next() * (b - a);
}

export function jitter(rng: Rng, amount: number): number {
  return (rng.next() - 0.5) * 2 * amount;
}

export function weightedPick<T>(rng: Rng, items: readonly { value: T; weight: number }[]): T {
  let total = 0;
  for (const item of items) total += Math.max(0, item.weight);
  if (total <= 0) return items[0].value;
  let roll = rng.next() * total;
  for (const item of items) {
    roll -= Math.max(0, item.weight);
    if (roll <= 0) return item.value;
  }
  return items[items.length - 1].value;
}

export function deriveSeed(seed: number, label: string): number {
  let h = (0x811c9dc5 ^ (seed >>> 0)) >>> 0;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (mulberry32(h)() * 4294967296) >>> 0;
}

export function deriveRng(seed: number, label: string): Rng {
  return { next: mulberry32(deriveSeed(seed, label)) };
}

export function makeDungeonRngs(seed: number, attempt: number): import('./dungeon/model').DungeonRngs {
  const stream = (name: string) => deriveRng(seed, `a${attempt}:${name}`);
  return {
    layout: stream('layout'),
    route: stream('route'),
    style: stream('style'),
    geometry: stream('geometry'),
    doors: stream('doors'),
    dress: stream('dress'),
    texture: stream('texture'),
    names: stream('names'),
  };
}

export function pickFresh(rng: Rng, list: string[], used: Set<string>): string {
  const fresh = list.filter((name) => !used.has(name));
  const pool = fresh.length ? fresh : list;
  const name = pool.length ? pick(rng, pool) : 'Mapa';
  used.add(name);
  return name;
}
