import { WallStyle } from '../../../types/dungeon';
import { chance, pick, Rng, shuffle } from '../rng';
import { Occupancy } from './grid';
import { GenRoom } from './model';
import { DungeonProfile } from './profiles';
import { buildCave, fillCells, roomDistance } from './rooms';

export const FLOOR_BY_STYLE: Record<WallStyle, string[]> = {
  straight: ['posadzka.png', 'płyty.png'],
  brick: ['kamień.png', 'płyty.png'],
  double: ['marmur.png', 'kostka.png'],
  rock: ['skała.png', 'skała-ciemna.png', 'skała-omszona.png'],
  ruins: ['bruk-mech.png', 'spękana-ziemia.png'],
};

export function pickStyles(count: number, profile: DungeonProfile, rng: Rng): WallStyle[] {
  const all: WallStyle[] = ['straight', 'rock', 'brick', 'double', 'ruins'];
  const styles: WallStyle[] = [pick(rng, profile.primaryStyles.length ? profile.primaryStyles : ['straight'])];
  const pool = shuffle(
    rng,
    profile.stylePool.filter((style) => !styles.includes(style))
  );
  while (styles.length < count) {
    const next = pool.shift();
    if (next && !styles.includes(next)) {
      styles.push(next);
      continue;
    }
    const fallback = all.find((style) => !styles.includes(style));
    if (!fallback) break;
    styles.push(fallback);
  }
  return styles;
}

export function assignLayers(
  rooms: GenRoom[],
  entrance: GenRoom,
  edges: { a: number; b: number }[],
  maxLayers: number,
  rng: Rng,
  profile: DungeonProfile
): WallStyle[] {
  const alive = rooms.filter((room) => room.alive);
  let count = Math.min(maxLayers, Math.max(1, Math.floor(alive.length / 3)));
  if (count > 1 && chance(rng, profile.layerDropChance)) count -= 1;
  count = Math.min(count, Math.max(1, alive.length));
  const neighbors = new Map<number, number[]>();
  for (const room of rooms) neighbors.set(room.id, []);
  for (const edge of edges) {
    neighbors.get(edge.a)?.push(edge.b);
    neighbors.get(edge.b)?.push(edge.a);
  }
  const seeds: GenRoom[] = [entrance];
  entrance.layer = 0;
  while (seeds.length < count) {
    let best: GenRoom | null = null;
    let bestDist = -1;
    for (const room of alive) {
      if (seeds.includes(room)) continue;
      let nearest = Infinity;
      for (const seed of seeds) nearest = Math.min(nearest, roomDistance(room, seed));
      if (nearest > bestDist) {
        bestDist = nearest;
        best = room;
      }
    }
    if (!best) break;
    best.layer = seeds.length;
    seeds.push(best);
  }
  const info = new Map<number, { dist: number; seed: GenRoom }>();
  const queue: GenRoom[] = [];
  for (const seed of seeds) {
    info.set(seed.id, { dist: 0, seed });
    queue.push(seed);
  }
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor++];
    const currentInfo = info.get(current.id);
    if (!currentInfo) continue;
    for (const nextId of neighbors.get(current.id) ?? []) {
      const next = rooms[nextId];
      if (!next?.alive) continue;
      const dist = currentInfo.dist + 1;
      const prev = info.get(next.id);
      if (!prev || dist < prev.dist || (dist === prev.dist && roomDistance(next, currentInfo.seed) < roomDistance(next, prev.seed))) {
        info.set(next.id, { dist, seed: currentInfo.seed });
        next.layer = currentInfo.seed.layer;
        queue.push(next);
      }
    }
  }
  for (const room of alive) {
    if (info.has(room.id)) continue;
    let best = seeds[0];
    let bestDist = Infinity;
    for (const seed of seeds) {
      const dist = roomDistance(room, seed);
      if (dist < bestDist) {
        bestDist = dist;
        best = seed;
      }
    }
    room.layer = best.layer;
  }
  let guard = 0;
  while (guard++ < 8) {
    const groups = new Map<number, GenRoom[]>();
    for (const room of rooms) {
      if (!room.alive) continue;
      const list = groups.get(room.layer) ?? [];
      list.push(room);
      groups.set(room.layer, list);
    }
    if (groups.size <= 1) break;
    let small: number | null = null;
    for (const [layer, list] of groups) {
      if (list.length < 2) {
        small = layer;
        break;
      }
    }
    if (small === null) break;
    const counts = new Map<number, number>();
    for (const edge of edges) {
      const left = rooms[edge.a];
      const right = rooms[edge.b];
      if (!left?.alive || !right?.alive) continue;
      if (left.layer === small && right.layer !== small) counts.set(right.layer, (counts.get(right.layer) ?? 0) + 1);
      if (right.layer === small && left.layer !== small) counts.set(left.layer, (counts.get(left.layer) ?? 0) + 1);
    }
    let target = -1;
    let bestCount = -1;
    for (const [layer, value] of counts) {
      if (value > bestCount) {
        bestCount = value;
        target = layer;
      }
    }
    if (target < 0) {
      for (const layer of groups.keys()) {
        if (layer !== small) {
          target = layer;
          break;
        }
      }
    }
    for (const room of groups.get(small) ?? []) room.layer = target;
  }
  if (entrance.layer !== 0) {
    const swapped = entrance.layer;
    for (const room of rooms) {
      if (!room.alive) continue;
      if (room.layer === 0) room.layer = swapped;
      else if (room.layer === swapped) room.layer = 0;
    }
  }
  const used = [...new Set(rooms.filter((room) => room.alive).map((room) => room.layer))].sort((a, b) => a - b);
  const remap = new Map(used.map((layer, index) => [layer, index]));
  for (const room of rooms) {
    if (room.alive) room.layer = remap.get(room.layer) ?? 0;
  }
  const layerCount = used.length;
  return pickStyles(layerCount, profile, rng);
}

export function becomeCaves(rooms: GenRoom[], styles: WallStyle[], occ: Occupancy, rng: Rng, profile: DungeonProfile) {
  for (const room of rooms) {
    if (!room.alive) continue;
    let probability = profile.caveChance[styles[room.layer]] ?? 0;
    if (room.role === 'hub' || room.role === 'sanctum' || room.role === 'boss') probability *= 0.5;
    if (probability <= 0 || (probability < 1 && !chance(rng, probability))) continue;
    const built = buildCave(room.rect, rng);
    room.kind = 'cave';
    room.polygon = built.polygon;
    room.islands = built.islands;
    room.pillars = [];
    room.pillarCells = [];
    room.noPort = new Set();
    room.cells = fillCells(occ, room.rect, () => false);
  }
}

export function assignLayersByGroups(
  rooms: GenRoom[],
  entrance: GenRoom,
  links: { a: number; b: number }[],
  maxLayers: number,
  profile: DungeonProfile,
  rng: Rng
): WallStyle[] {
  const alive = rooms.filter((room) => room.alive);
  const adj = new Map<number, number[]>();
  for (const room of alive) adj.set(room.id, []);
  for (const link of links) {
    if (!adj.has(link.a) || !adj.has(link.b)) continue;
    adj.get(link.a)?.push(link.b);
    adj.get(link.b)?.push(link.a);
  }
  const dist = new Map<number, number>([[entrance.id, 0]]);
  const queue = [entrance.id];
  while (queue.length) {
    const current = queue.shift() as number;
    for (const next of adj.get(current) ?? []) {
      if (dist.has(next)) continue;
      dist.set(next, (dist.get(current) ?? 0) + 1);
      queue.push(next);
    }
  }
  const groupIds = [...new Set(alive.map((room) => room.group))];
  const ranked = groupIds
    .map((group) => ({
      group,
      nearest: Math.min(...alive.filter((room) => room.group === group).map((room) => dist.get(room.id) ?? 9999)),
      ownsEntrance: alive.some((room) => room.group === group && room.id === entrance.id),
    }))
    .sort((a, b) => Number(b.ownsEntrance) - Number(a.ownsEntrance) || a.nearest - b.nearest);
  let count = Math.min(Math.max(1, maxLayers), Math.max(1, ranked.length));
  if (count > 1 && chance(rng, profile.layerDropChance)) count -= 1;
  const rankOf = new Map(ranked.map((item, index) => [item.group, index]));
  for (const room of alive) {
    const rank = rankOf.get(room.group) ?? 0;
    room.layer = Math.floor((rank * count) / Math.max(1, ranked.length));
  }
  if (entrance.alive && entrance.layer !== 0) {
    const swapped = entrance.layer;
    for (const room of alive) {
      if (room.layer === 0) room.layer = swapped;
      else if (room.layer === swapped) room.layer = 0;
    }
  }
  const used = [...new Set(alive.map((room) => room.layer))].sort((a, b) => a - b);
  const remap = new Map(used.map((layer, index) => [layer, index]));
  for (const room of alive) room.layer = remap.get(room.layer) ?? 0;
  return pickStyles(used.length, profile, rng);
}
