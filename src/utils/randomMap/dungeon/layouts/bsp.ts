import { DungeonProfile } from '../profiles';
import { chance, clamp, range, randInt, Rng, shuffle } from '../../rng';
import { Rect } from '../../types';
import { Occupancy } from '../grid';
import { GenRoom } from '../model';
import { makeRoom, roomDistance } from '../rooms';

export function splitBsp(rect: Rect, leafSize: number, rng: Rng, splitRange: [number, number] = [0.4, 0.6]): Rect[] {
  const leaves: Rect[] = [];
  const stack: Rect[] = [rect];
  while (stack.length) {
    const current = stack.pop() as Rect;
    const canVertical = current.w >= leafSize * 2;
    const canHorizontal = current.h >= leafSize * 2;
    if (!canVertical && !canHorizontal) {
      leaves.push(current);
      continue;
    }
    let vertical = canVertical;
    if (canVertical && canHorizontal) {
      if (current.w > current.h * 1.15) vertical = true;
      else if (current.h > current.w * 1.15) vertical = false;
      else vertical = chance(rng, 0.5);
    }
    if (vertical) {
      const span = splitRange[1] - splitRange[0];
      const cut = clamp(Math.round(current.w * (splitRange[0] + rng.next() * span)), leafSize, current.w - leafSize);
      stack.push({ x: current.x, y: current.y, w: cut, h: current.h });
      stack.push({ x: current.x + cut, y: current.y, w: current.w - cut, h: current.h });
    } else {
      const span = splitRange[1] - splitRange[0];
      const cut = clamp(Math.round(current.h * (splitRange[0] + rng.next() * span)), leafSize, current.h - leafSize);
      stack.push({ x: current.x, y: current.y, w: current.w, h: cut });
      stack.push({ x: current.x, y: current.y + cut, w: current.w, h: current.h - cut });
    }
  }
  return leaves;
}

export function placeRooms(
  zone: Rect,
  rng: Rng,
  profile: DungeonProfile,
  splitRange: [number, number] = [0.4, 0.6]
): { rooms: GenRoom[]; occ: Occupancy; target: number } {
  const zoneCells = zone.w * zone.h;
  const target = clamp(Math.round((zoneCells / 140) * range(rng, profile.roomDensity[0], profile.roomDensity[1])), 4, 60);
  let leafSize = Math.max(9, Math.floor(Math.sqrt(zoneCells / target)));
  const inner: Rect = { x: zone.x + 1, y: zone.y + 1, w: Math.max(0, zone.w - 2), h: Math.max(0, zone.h - 2) };
  const occ = new Occupancy(zone);
  if (inner.w < 8 || inner.h < 8) return { rooms: [], occ, target };
  let leaves = splitBsp(inner, leafSize, rng, splitRange);
  const wanted = Math.max(4, Math.round(target * 0.9));
  while (leaves.length < wanted && leafSize > 8) {
    leafSize -= 1;
    leaves = splitBsp(inner, leafSize, rng, splitRange);
  }
  shuffle(rng, leaves);
  if (leaves.length > target) leaves = leaves.slice(0, target);
  const drop = Math.round(leaves.length * range(rng, 0.08, 0.22));
  if (drop > 0 && leaves.length - drop >= 4) leaves = leaves.slice(drop);
  const rooms: GenRoom[] = [];
  for (const leaf of leaves) {
    const availW = leaf.w - 4;
    const availH = leaf.h - 4;
    if (availW < 4 || availH < 4) continue;
    const rw = randInt(rng, 4, availW);
    const rh = randInt(rng, 4, availH);
    const rect = {
      x: leaf.x + 2 + randInt(rng, 0, availW - rw),
      y: leaf.y + 2 + randInt(rng, 0, availH - rh),
      w: rw,
      h: rh,
    };
    const room = makeRoom(occ, rooms.length, rect, rng, profile.kindWeights);
    if (room) rooms.push(room);
  }
  return { rooms, occ, target };
}

export function neighborEdges(rooms: GenRoom[]): { a: number; b: number; dist: number }[] {
  const seen = new Set<string>();
  const edges: { a: number; b: number; dist: number }[] = [];
  for (let i = 0; i < rooms.length; i++) {
    const order = rooms
      .map((room, index) => ({ index, dist: index === i ? Infinity : roomDistance(rooms[i], room) }))
      .sort((left, right) => left.dist - right.dist)
      .slice(0, 4);
    for (const next of order) {
      const a = Math.min(i, next.index);
      const b = Math.max(i, next.index);
      const key = `${a}:${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b, dist: next.dist });
    }
  }
  edges.sort((left, right) => left.dist - right.dist);
  return edges;
}
