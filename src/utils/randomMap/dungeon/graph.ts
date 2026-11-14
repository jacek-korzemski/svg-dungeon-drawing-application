import { WallStyle } from '../../../types/dungeon';
import { Rng } from '../rng';
import { CORRIDOR, DX, DY, EMPTY, Occupancy, PILLAR, ROOM } from './grid';
import { GenRoom, Route } from './model';
import { computePorts, recomputeHalo } from './ports';
import { RoutePolicy } from './profiles';
import { roomDistance } from './rooms';
import { connectRooms } from './routing';

export function killRoom(room: GenRoom, occ: Occupancy) {
  room.alive = false;
  for (const cell of room.cells) {
    if (occ.grid[cell] === ROOM) occ.grid[cell] = EMPTY;
  }
  for (const cell of room.pillarCells) {
    if (occ.grid[cell] === PILLAR) occ.grid[cell] = EMPTY;
  }
}

export function componentsOf(rooms: GenRoom[], links: { a: number; b: number }[]): number[][] {
  const adj = new Map<number, number[]>();
  for (const room of rooms) {
    if (room.alive) adj.set(room.id, []);
  }
  for (const link of links) {
    if (!rooms[link.a]?.alive || !rooms[link.b]?.alive) continue;
    adj.get(link.a)?.push(link.b);
    adj.get(link.b)?.push(link.a);
  }
  const seen = new Set<number>();
  const groups: number[][] = [];
  for (const room of rooms) {
    if (!room.alive || seen.has(room.id)) continue;
    const group: number[] = [];
    const stack = [room.id];
    seen.add(room.id);
    while (stack.length) {
      const id = stack.pop() as number;
      group.push(id);
      for (const next of adj.get(id) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    groups.push(group);
  }
  return groups;
}

export function hopDistance(rooms: GenRoom[], links: { a: number; b: number }[], from: number, to: number): number {
  if (from === to) return 0;
  const adj = new Map<number, number[]>();
  for (const link of links) {
    if (!rooms[link.a]?.alive || !rooms[link.b]?.alive) continue;
    const left = adj.get(link.a) ?? [];
    left.push(link.b);
    adj.set(link.a, left);
    const right = adj.get(link.b) ?? [];
    right.push(link.a);
    adj.set(link.b, right);
  }
  const dist = new Map<number, number>([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const id = queue.shift() as number;
    if (id === to) return dist.get(id) ?? Infinity;
    for (const next of adj.get(id) ?? []) {
      if (dist.has(next)) continue;
      dist.set(next, (dist.get(id) ?? 0) + 1);
      queue.push(next);
    }
  }
  return Infinity;
}

export function reachableIds(occ: Occupancy, rooms: GenRoom[], entrance: GenRoom): Set<number> {
  const seen = new Uint8Array(occ.grid.length);
  const stack: number[] = [];
  for (const cell of entrance.cells) {
    if (occ.grid[cell] === ROOM || occ.grid[cell] === CORRIDOR) {
      seen[cell] = 1;
      stack.push(cell);
    }
  }
  while (stack.length) {
    const index = stack.pop() as number;
    const x = occ.xOf(index);
    const y = occ.yOf(index);
    for (let dir = 0; dir < 4; dir++) {
      const nx = x + DX[dir];
      const ny = y + DY[dir];
      if (!occ.in(nx, ny)) continue;
      const next = occ.i(nx, ny);
      if (seen[next]) continue;
      const state = occ.grid[next];
      if (state !== ROOM && state !== CORRIDOR) continue;
      seen[next] = 1;
      stack.push(next);
    }
  }
  const ids = new Set<number>();
  for (const room of rooms) {
    if (!room.alive) continue;
    for (const cell of room.cells) {
      if ((occ.grid[cell] === ROOM || occ.grid[cell] === CORRIDOR) && seen[cell]) {
        ids.add(room.id);
        break;
      }
    }
  }
  return ids;
}

export function joinComponents(
  rooms: GenRoom[],
  occ: Occupancy,
  links: { a: number; b: number }[],
  routes: Route[],
  entrance: GenRoom,
  styles: WallStyle[],
  rng: Rng,
  policy: RoutePolicy
): void {
  let guard = 0;
  while (guard++ < rooms.length) {
    const groups = componentsOf(rooms, links);
    if (groups.length <= 1) break;
    const home = groups.find((group) => group.includes(entrance.id)) ?? groups[0];
    const other = groups.find((group) => group !== home) ?? groups[1];
    const pairs: { a: number; b: number; dist: number }[] = [];
    for (const a of home) {
      for (const b of other) pairs.push({ a, b, dist: roomDistance(rooms[a], rooms[b]) });
    }
    pairs.sort((left, right) => left.dist - right.dist);
    let joined = false;
    for (const pair of pairs.slice(0, 10)) {
      const route = connectRooms(occ, rooms[pair.a], rooms[pair.b], styles, 'tree', rng, policy);
      if (!route) continue;
      routes.push(route);
      links.push({ a: pair.a, b: pair.b });
      joined = true;
      break;
    }
    if (!joined) {
      for (const roomId of other) {
        if (roomId !== entrance.id) killRoom(rooms[roomId], occ);
      }
      recomputeHalo(occ, rooms);
      for (const room of rooms) if (room.alive) room.ports = computePorts(room, occ);
    }
  }
}
