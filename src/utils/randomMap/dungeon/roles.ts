import { Rng } from '../rng';
import { GenRoom } from './model';
import { DungeonProfile, RoomRole } from './profiles';

function neighbors(rooms: GenRoom[], links: { a: number; b: number }[]): Map<number, number[]> {
  const adj = new Map<number, number[]>();
  for (const room of rooms) if (room.alive) adj.set(room.id, []);
  for (const link of links) {
    if (!adj.has(link.a) || !adj.has(link.b)) continue;
    adj.get(link.a)?.push(link.b);
    adj.get(link.b)?.push(link.a);
  }
  return adj;
}

function distances(adj: Map<number, number[]>, start: number): Map<number, number> {
  const dist = new Map<number, number>([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift() as number;
    for (const next of adj.get(current) ?? []) {
      if (dist.has(next)) continue;
      dist.set(next, (dist.get(current) ?? 0) + 1);
      queue.push(next);
    }
  }
  return dist;
}

export function assignRoles(
  rooms: GenRoom[],
  links: { a: number; b: number }[],
  entrance: GenRoom,
  rng: Rng,
  profile: DungeonProfile,
  preset?: Map<number, RoomRole>
): void {
  if (preset) {
    for (const [id, role] of preset) {
      const room = rooms[id];
      if (room?.alive) room.role = role;
    }
  }
  if (entrance.alive) entrance.role = 'entrance';
  const alive = rooms.filter((room) => room.alive);
  const adj = neighbors(rooms, links);
  const dist = distances(adj, entrance.id);
  if (!alive.some((room) => room.role === 'boss')) {
    let farthest = -1;
    for (const room of alive) {
      if (room.id === entrance.id) continue;
      farthest = Math.max(farthest, dist.get(room.id) ?? -1);
    }
    const candidates = alive
      .filter((room) => room.id !== entrance.id && room.role === 'normal' && (dist.get(room.id) ?? -1) === farthest)
      .sort((a, b) => b.cells.size - a.cells.size);
    if (candidates[0]) candidates[0].role = 'boss';
  }
  const boss = alive.find((room) => room.role === 'boss');
  if (!alive.some((room) => room.role === 'vault')) {
    let vault: GenRoom | null = null;
    let vaultDist = -1;
    for (const room of alive) {
      if (room.role !== 'normal' || (adj.get(room.id)?.length ?? 0) !== 1) continue;
      const step = dist.get(room.id) ?? -1;
      if (step > vaultDist) {
        vaultDist = step;
        vault = room;
      }
    }
    if (vault) vault.role = 'vault';
  }
  const guards: GenRoom[] = [];
  for (const id of adj.get(entrance.id) ?? []) {
    const room = rooms[id];
    if (room?.alive && room.role === 'normal') guards.push(room);
  }
  if (boss) {
    const parent = new Map<number, number>();
    const queue = [entrance.id];
    const seen = new Set<number>([entrance.id]);
    while (queue.length) {
      const current = queue.shift() as number;
      if (current === boss.id) break;
      for (const next of adj.get(current) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        parent.set(next, current);
        queue.push(next);
      }
    }
    const before = parent.get(boss.id);
    if (before !== undefined) {
      const room = rooms[before];
      if (room?.alive && room.role === 'normal' && !guards.includes(room)) guards.push(room);
    }
  }
  for (const room of guards.slice(0, 2)) room.role = 'guard';
  const shaped = alive.filter((room) => room.role === 'normal' && (room.kind === 'octagon' || room.kind === 'hexagon'));
  const shrinePool = shaped.length ? shaped : alive.filter((room) => room.role === 'normal');
  if (shrinePool.length) {
    const count = Math.min(shrinePool.length, 1 + (rng.next() < 0.5 ? 1 : 0));
    const order = shrinePool.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }
    for (const room of order.slice(0, count)) room.role = 'shrine';
  }
  for (const room of alive) {
    if (room.role !== 'normal') continue;
    if (room.rect.w >= 6 && room.rect.h >= 5 && rng.next() < profile.features.partition) room.role = 'prison';
    else if (room.cells.size <= 20 && rng.next() < 0.4) room.role = 'storage';
    else if (room.cells.size >= 24 && rng.next() < 0.2) room.role = 'library';
    else if (room.cells.size >= 24 && rng.next() < 0.2) room.role = 'barracks';
  }
}
