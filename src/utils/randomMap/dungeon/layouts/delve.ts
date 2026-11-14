import { clamp, range, Rng, shuffle } from '../../rng';
import { Junction, Rect } from '../../types';
import type { Dir } from '../grid';
import { DungeonProfile, RoomRole } from '../profiles';
import { blockRect, cellKey, chooseExitEdge, CoarseGrid, edgeCell, makeCoarseGrid, orthogonal, roomTarget } from './coarseGrid';
import { GraphPlan, PlannedEdge, PlannedRoom } from '../plan';

export interface PlanInput {
  zone: Rect;
  junction: Junction | null;
  maxLayers: number;
  profile: DungeonProfile;
  rng: Rng;
  large: boolean;
}

function fraction(role: RoomRole): [number, number] {
  if (role === 'hub' || role === 'boss' || role === 'sanctum') return [0.85, 1];
  if (role === 'connector' || role === 'storage') return [0, 0.45];
  return [0.5, 1];
}

export function planDelve(input: PlanInput): GraphPlan {
  const { zone, junction, maxLayers, profile, rng, large } = input;
  const exitEdge = chooseExitEdge(junction, rng);
  const target = roomTarget(zone, profile, rng);
  const grid = makeCoarseGrid(zone, target, rng);
  const empty: GraphPlan = { rooms: [], edges: [], entrance: 0, exitEdge };
  if (!grid.cols || !grid.rows) return empty;
  const start = edgeCell(grid, exitEdge, rng, junction);
  const straightBias = range(rng, 0.8, 0.95);
  const targetLen = clamp(Math.round(grid.cols * grid.rows * range(rng, 0.75, 0.95)), 4, grid.cols * grid.rows);
  const spine = longestWalk(grid, start, straightBias, targetLen, rng);
  const rooms: PlannedRoom[] = [];
  const edges: PlannedEdge[] = [];
  const indexOf = new Map<string, number>();
  const groupSize = Math.max(1, Math.ceil(spine.length / Math.min(4, Math.max(1, maxLayers))));
  spine.forEach((cell, index) => {
    indexOf.set(cellKey(cell.c, cell.r), rooms.length);
    const role: RoomRole = index === spine.length - 1 ? 'boss' : index % 2 === 1 && rng.next() < 0.3 ? 'connector' : 'normal';
    rooms.push({
      block: blockRect(grid, cell.c, cell.r),
      role,
      group: Math.floor(index / groupSize),
      sizeFraction: fraction(role),
    });
    if (index > 0) edges.push({ a: index - 1, b: index, kind: 'spine' });
  });
  const used = new Set(spine.map((cell) => cellKey(cell.c, cell.r)));
  const branchFrom = shuffle(rng, spine.map((_, index) => index).filter((index) => index > 0 && index < spine.length - 1));
  let branches = 0;
  const branchCap = large ? 2 : 1;
  for (const index of branchFrom) {
    if (branches >= branchCap || spine.length < 8 || rng.next() >= 0.35) continue;
    let cell = spine[index];
    let previous = indexOf.get(cellKey(cell.c, cell.r)) as number;
    const next = shuffle(rng, orthogonal(cell.c, cell.r, grid.cols, grid.rows).filter((item) => !used.has(cellKey(item.c, item.r))));
    if (!next.length) continue;
    cell = next[0];
    used.add(cellKey(cell.c, cell.r));
    const id = rooms.length;
    rooms.push({
      block: blockRect(grid, cell.c, cell.r),
      role: 'normal',
      group: rooms[previous].group,
      sizeFraction: fraction('normal'),
    });
    edges.push({ a: previous, b: id, kind: 'branch' });
    branches += 1;
  }
  const boss = spine[spine.length - 1];
  const free = orthogonal(boss.c, boss.r, grid.cols, grid.rows).find((item) => !used.has(cellKey(item.c, item.r)));
  if (free && rooms.length) {
    const bossRoom = rooms[indexOf.get(cellKey(boss.c, boss.r)) as number];
    const horizontal = free.dir === 1 || free.dir === 3;
    const c = Math.min(boss.c, free.c);
    const r = Math.min(boss.r, free.r);
    bossRoom.block = blockRect(grid, c, r, horizontal ? 2 : 1, horizontal ? 1 : 2);
    bossRoom.role = 'boss';
    bossRoom.sizeFraction = [0.85, 1];
    used.add(cellKey(free.c, free.r));
  }
  let chords = 0;
  const chordCap = large ? 2 : 1;
  for (let i = 0; i < spine.length; i++) {
    for (let j = i + 4; j < spine.length; j++) {
      if (chords >= chordCap) break;
      const adjacent = orthogonal(spine[i].c, spine[i].r, grid.cols, grid.rows).some((item) => item.c === spine[j].c && item.r === spine[j].r);
      if (!adjacent || rng.next() >= 0.1) continue;
      edges.push({ a: i, b: j, kind: 'chord' });
      chords += 1;
    }
  }
  return { rooms, edges, entrance: 0, exitEdge };
}

function longestWalk(grid: CoarseGrid, start: { c: number; r: number }, straightBias: number, targetLen: number, rng: Rng) {
  const best: { c: number; r: number }[] = [start];
  const seen = new Set<string>([cellKey(start.c, start.r)]);
  let steps = 0;
  const walk = (path: { c: number; r: number }[], dir: Dir | -1) => {
    if (steps++ > 3000 || best.length >= targetLen) return;
    if (path.length > best.length) {
      best.splice(0, best.length, ...path);
    }
    if (best.length >= targetLen) return;
    const here = path[path.length - 1];
    const options = orthogonal(here.c, here.r, grid.cols, grid.rows).filter((item) => !seen.has(cellKey(item.c, item.r)));
    const straight = options.filter((item) => item.dir === dir);
    const rest = shuffle(rng, options.filter((item) => item.dir !== dir));
    const ordered = rng.next() < straightBias ? [...straight, ...rest] : shuffle(rng, options);
    for (const next of ordered) {
      const key = cellKey(next.c, next.r);
      seen.add(key);
      path.push(next);
      walk(path, next.dir);
      if (best.length >= targetLen || steps > 3000) return;
      path.pop();
      seen.delete(key);
    }
  };
  walk([start], -1);
  return best;
}
