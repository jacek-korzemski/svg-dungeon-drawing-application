import { GRID_SIZE } from '../../geometry';
import { Point2D, WallStyle } from '../../../types/dungeon';
import { polylineRibbonMiter } from '../curves';
import { DX8, DY8, dirDelta } from '../dungeonShape';
import { chance, Rng } from '../rng';
import { CORRIDOR, DX, DY, HALO, MinHeap, Occupancy, PILLAR, ROOM } from './grid';
import { EndInfo, GenRoom, Port, Route } from './model';
import { batchUnion, circlesAlong, simplify, splitTail } from './poly';
import { RoutePolicy } from './profiles';
import { roomCenter } from './rooms';

const G = GRID_SIZE;

export function touchesCorridor(occ: Occupancy, x: number, y: number, layer: number, same: boolean): boolean {
  for (let dir = 0; dir < 4; dir++) {
    const nx = x + DX[dir];
    const ny = y + DY[dir];
    if (!occ.in(nx, ny)) continue;
    const index = occ.i(nx, ny);
    if (occ.grid[index] !== CORRIDOR) continue;
    const matches = occ.corridorLayer[index] === layer;
    if (matches === same) return true;
  }
  return false;
}

export function stepCost(occ: Occupancy, x: number, y: number, layer: number, unlocked: Set<number>): number | null {
  if (!occ.in(x, y) || occ.frame(x, y)) return null;
  const index = occ.i(x, y);
  const state = occ.grid[index];
  if (state === ROOM || state === PILLAR) return null;
  if (state === HALO && !unlocked.has(index)) return null;
  if (state === CORRIDOR) {
    if (occ.corridorLayer[index] !== layer) return null;
    return 0.4;
  }
  if (touchesCorridor(occ, x, y, layer, false)) return null;
  return touchesCorridor(occ, x, y, layer, true) ? 4 : 1;
}

export function portAnchor(port: Port): { x: number; y: number } {
  if (port.skew) return { x: port.skew.wall[0] / G, y: port.skew.wall[1] / G };
  return { x: port.x, y: port.y };
}

export function nearestPorts(room: GenRoom, x: number, y: number, limit: number, diagonal = true): Port[] {
  const ports = diagonal ? room.ports : room.ports.filter((port) => !port.skew);
  return [...ports]
    .sort((a, b) => {
      const aa = portAnchor(a);
      const bb = portAnchor(b);
      return Math.abs(aa.x - x) + Math.abs(aa.y - y) - (Math.abs(bb.x - x) + Math.abs(bb.y - y));
    })
    .slice(0, limit);
}

export const STRIDE = 5;

export function routeWidth1(
  occ: Occupancy,
  starts: Port[],
  goals: Port[],
  layer: number
): { cells: { x: number; y: number }[]; axis?: { x: number; y: number }[] } | null {
  if (!starts.length || !goals.length) return null;
  const unlocked = new Set<number>();
  for (const port of [...starts, ...goals]) {
    if (occ.in(port.x, port.y)) unlocked.add(occ.i(port.x, port.y));
  }
  const goalSet = new Set<number>();
  for (const goal of goals) {
    if (occ.in(goal.x, goal.y)) goalSet.add(occ.i(goal.x, goal.y));
  }
  if (!goalSet.size) return null;
  const count = occ.grid.length * STRIDE;
  const gScore = new Float64Array(count);
  gScore.fill(Number.POSITIVE_INFINITY);
  const parent = new Int32Array(count);
  parent.fill(-1);
  const heap = new MinHeap();
  const heur = (x: number, y: number) => {
    let best = Infinity;
    for (const goal of goals) best = Math.min(best, Math.abs(goal.x - x) + Math.abs(goal.y - y));
    return best * 0.4;
  };
  for (const start of starts) {
    if (!occ.in(start.x, start.y)) continue;
    const state = occ.i(start.x, start.y) * STRIDE + 4;
    gScore[state] = 0;
    heap.push(state, heur(start.x, start.y));
  }
  let expansions = 0;
  const cap = occ.grid.length * 8;
  while (heap.size) {
    const item = heap.pop();
    if (!item) break;
    const cell = Math.floor(item.state / STRIDE);
    const dir = item.state % STRIDE;
    const x = occ.xOf(cell);
    const y = occ.yOf(cell);
    if (item.prio > gScore[item.state] + heur(x, y) + 1e-6) continue;
    if (goalSet.has(cell)) {
      const cells: { x: number; y: number }[] = [];
      let state = item.state;
      let guard = 0;
      while (state >= 0 && guard++ < count) {
        const index = Math.floor(state / STRIDE);
        cells.push({ x: occ.xOf(index), y: occ.yOf(index) });
        state = parent[state];
      }
      cells.reverse();
      return { cells };
    }
    if (++expansions > cap) return null;
    for (let nextDir = 0; nextDir < 4; nextDir++) {
      const nx = x + DX[nextDir];
      const ny = y + DY[nextDir];
      const cost = stepCost(occ, nx, ny, layer, unlocked);
      if (cost === null) continue;
      const turn = dir !== 4 && dir !== nextDir ? 0.5 : 0;
      const nextState = occ.i(nx, ny) * STRIDE + nextDir;
      const nextG = gScore[item.state] + cost + turn;
      if (nextG + 1e-9 < gScore[nextState]) {
        gScore[nextState] = nextG;
        parent[nextState] = item.state;
        heap.push(nextState, nextG + heur(nx, ny));
      }
    }
  }
  return null;
}

export function blockCells(origin: { x: number; y: number }): { x: number; y: number }[] {
  return [
    { x: origin.x, y: origin.y },
    { x: origin.x + 1, y: origin.y },
    { x: origin.x, y: origin.y + 1 },
    { x: origin.x + 1, y: origin.y + 1 },
  ];
}

export function blockOrigin(a: Port, b: Port): { x: number; y: number } {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  if (a.into === 2) return { x: minX, y: minY - 1 };
  if (a.into === 1) return { x: minX - 1, y: minY };
  return { x: minX, y: minY };
}

export function portPairs(room: GenRoom, occ: Occupancy): [Port, Port][] {
  const pairs: [Port, Port][] = [];
  for (let i = 0; i < room.ports.length; i++) {
    for (let j = i + 1; j < room.ports.length; j++) {
      const a = room.ports[i];
      const b = room.ports[j];
      if (a.skew || b.skew) continue;
      if (a.into !== b.into) continue;
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) continue;
      const dx = Math.sign(b.x - a.x);
      const dy = Math.sign(b.y - a.y);
      let margin = true;
      for (const [x, y] of [
        [a.x - dx, a.y - dy],
        [b.x + dx, b.y + dy],
      ]) {
        const rx = x + DX[a.into];
        const ry = y + DY[a.into];
        if (!occ.in(x, y) || !occ.in(rx, ry) || !room.cells.has(occ.i(rx, ry))) {
          margin = false;
          break;
        }
        const state = occ.grid[occ.i(x, y)];
        if (state === ROOM || state === PILLAR) {
          margin = false;
          break;
        }
      }
      if (!margin) continue;
      const origin = blockOrigin(a, b);
      const covered = blockCells(origin);
      if (!covered.some((cell) => cell.x === a.x && cell.y === a.y)) continue;
      if (!covered.some((cell) => cell.x === b.x && cell.y === b.y)) continue;
      pairs.push([a, b]);
    }
  }
  return pairs;
}

export function blockCost(occ: Occupancy, origin: { x: number; y: number }, layer: number, unlocked: Set<number>): number | null {
  let cost = 0;
  for (const cell of blockCells(origin)) {
    const step = stepCost(occ, cell.x, cell.y, layer, unlocked);
    if (step === null) return null;
    cost = Math.max(cost, step);
  }
  return cost;
}

export function routeWidth2(
  occ: Occupancy,
  roomA: GenRoom,
  roomB: GenRoom,
  layer: number
): { cells: { x: number; y: number }[]; blocks: { x: number; y: number }[] } | null {
  const centerB = roomCenter(roomB);
  const centerA = roomCenter(roomA);
  const starts = portPairs(roomA, occ)
    .sort((a, b) => Math.abs(a[0].x - centerB.x) + Math.abs(a[0].y - centerB.y) - (Math.abs(b[0].x - centerB.x) + Math.abs(b[0].y - centerB.y)))
    .slice(0, 3);
  const goals = portPairs(roomB, occ)
    .sort((a, b) => Math.abs(a[0].x - centerA.x) + Math.abs(a[0].y - centerA.y) - (Math.abs(b[0].x - centerA.x) + Math.abs(b[0].y - centerA.y)))
    .slice(0, 3);
  if (!starts.length || !goals.length) return null;
  const bw = occ.cols - 1;
  if (bw < 1 || occ.rows < 2) return null;
  const unlocked = new Set<number>();
  for (const pair of [...starts, ...goals]) {
    for (const port of pair) {
      if (occ.in(port.x, port.y)) unlocked.add(occ.i(port.x, port.y));
    }
  }
  const bIndex = (x: number, y: number) => (y - occ.oy) * bw + (x - occ.ox);
  const inBlock = (x: number, y: number) => x >= occ.ox && y >= occ.oy && x < occ.ox + bw && y < occ.oy + occ.rows - 1;
  const goalSet = new Set<number>();
  for (const pair of goals) {
    const origin = blockOrigin(pair[0], pair[1]);
    if (inBlock(origin.x, origin.y)) goalSet.add(bIndex(origin.x, origin.y));
  }
  if (!goalSet.size) return null;
  const stateCount = bw * (occ.rows - 1) * STRIDE;
  const gScore = new Float64Array(stateCount);
  gScore.fill(Number.POSITIVE_INFINITY);
  const parent = new Int32Array(stateCount);
  parent.fill(-1);
  const heap = new MinHeap();
  const heur = (x: number, y: number) => {
    let best = Infinity;
    for (const pair of goals) {
      const origin = blockOrigin(pair[0], pair[1]);
      best = Math.min(best, Math.abs(origin.x - x) + Math.abs(origin.y - y));
    }
    return best * 0.4;
  };
  for (const pair of starts) {
    const origin = blockOrigin(pair[0], pair[1]);
    if (!inBlock(origin.x, origin.y) || blockCost(occ, origin, layer, unlocked) === null) continue;
    const state = bIndex(origin.x, origin.y) * STRIDE + 4;
    gScore[state] = 0;
    heap.push(state, heur(origin.x, origin.y));
  }
  let expansions = 0;
  while (heap.size) {
    const item = heap.pop();
    if (!item) break;
    const block = Math.floor(item.state / STRIDE);
    const dir = item.state % STRIDE;
    const x = occ.ox + (block % bw);
    const y = occ.oy + Math.floor(block / bw);
    if (item.prio > gScore[item.state] + heur(x, y) + 1e-6) continue;
    if (goalSet.has(block) && dir !== 4) {
      const blocks: { x: number; y: number }[] = [];
      let state = item.state;
      let guard = 0;
      while (state >= 0 && guard++ < stateCount) {
        const index = Math.floor(state / STRIDE);
        blocks.push({ x: occ.ox + (index % bw), y: occ.oy + Math.floor(index / bw) });
        state = parent[state];
      }
      blocks.reverse();
      if (blocks.length < 2) return null;
      return { blocks, cells: blocks.flatMap((origin) => blockCells(origin)) };
    }
    if (goalSet.has(block) && dir === 4) continue;
    if (++expansions > occ.grid.length * 6) return null;
    for (let nextDir = 0; nextDir < 4; nextDir++) {
      const nx = x + DX[nextDir];
      const ny = y + DY[nextDir];
      if (!inBlock(nx, ny)) continue;
      const cost = blockCost(occ, { x: nx, y: ny }, layer, unlocked);
      if (cost === null) continue;
      const turn = dir !== 4 && dir !== nextDir ? 0.5 : 0;
      const nextState = bIndex(nx, ny) * STRIDE + nextDir;
      const nextG = gScore[item.state] + cost + turn;
      if (nextG + 1e-9 < gScore[nextState]) {
        gScore[nextState] = nextG;
        parent[nextState] = item.state;
        heap.push(nextState, nextG + heur(nx, ny));
      }
    }
  }
  return null;
}

export function markCorridor(occ: Occupancy, cells: { x: number; y: number }[], layer: number) {
  for (const cell of cells) {
    if (!occ.in(cell.x, cell.y)) continue;
    const index = occ.i(cell.x, cell.y);
    const state = occ.grid[index];
    if (state === ROOM || state === PILLAR) continue;
    if (state !== CORRIDOR) occ.corridorLayer[index] = layer;
    occ.grid[index] = CORRIDOR;
  }
}

export function wallPoint(port: Port): Point2D {
  if (port.skew) return port.skew.wall;
  if (port.into === 2) return [(port.x + 0.5) * G, (port.y + 1) * G];
  if (port.into === 0) return [(port.x + 0.5) * G, port.y * G];
  if (port.into === 1) return [(port.x + 1) * G, (port.y + 0.5) * G];
  return [port.x * G, (port.y + 0.5) * G];
}

export function averagePoint(points: Point2D[]): Point2D {
  const x = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const y = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  return [x, y];
}

export function portsOnCells(room: GenRoom, cells: { x: number; y: number }[]): Port[] {
  return room.ports.filter((port) => cells.some((cell) => cell.x === port.x && cell.y === port.y));
}

export function makeEnd(room: GenRoom, ports: Port[], corridorLayer: number): EndInfo | null {
  if (!ports.length) return null;
  const point = averagePoint(ports.map(wallPoint));
  const cross = room.layer !== corridorLayer;
  return {
    room,
    into: ports[0].into,
    x: point[0],
    y: point[1],
    angleDeg: ports.find((port) => port.skew)?.skew?.angleDeg,
    cross,
    cave: room.kind === 'cave' && !cross,
    secret: false,
  };
}

export function corridorOwner(a: GenRoom, b: GenRoom, styles: WallStyle[]): number {
  if (a.layer === b.layer) return a.layer;
  if (a.kind === 'cave' || styles[a.layer] === 'rock') return a.layer;
  if (b.kind === 'cave' || styles[b.layer] === 'rock') return b.layer;
  return Math.min(a.layer, b.layer);
}

export function routeWidth8(
  occ: Occupancy,
  starts: Port[],
  goals: Port[],
  layer: number
): { cells: { x: number; y: number }[]; axis: { x: number; y: number }[] } | null {
  if (!starts.length || !goals.length) return null;
  const unlocked = new Set<number>();
  for (const port of [...starts, ...goals]) {
    if (occ.in(port.x, port.y)) unlocked.add(occ.i(port.x, port.y));
    for (const cell of port.skew?.unlock ?? []) {
      if (occ.in(cell.x, cell.y)) unlocked.add(occ.i(cell.x, cell.y));
    }
  }
  const stride = 9;
  const count = occ.grid.length * stride;
  const gScore = new Float64Array(count);
  gScore.fill(Number.POSITIVE_INFINITY);
  const parent = new Int32Array(count);
  parent.fill(-1);
  const heap = new MinHeap();
  const heur = (x: number, y: number) => {
    let best = Infinity;
    for (const goal of goals) {
      const dx = Math.abs(goal.x - x);
      const dy = Math.abs(goal.y - y);
      best = Math.min(best, Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy));
    }
    return best * 0.4;
  };
  const startStates = new Set<number>();
  for (const start of starts) {
    if (!occ.in(start.x, start.y)) continue;
    const dir = start.skew ? start.skew.out : 8;
    const state = occ.i(start.x, start.y) * stride + dir;
    gScore[state] = 0;
    startStates.add(state);
    heap.push(state, heur(start.x, start.y));
  }
  const goalAt = new Map<number, Port[]>();
  for (const goal of goals) {
    if (!occ.in(goal.x, goal.y)) continue;
    const index = occ.i(goal.x, goal.y);
    const list = goalAt.get(index) ?? [];
    list.push(goal);
    goalAt.set(index, list);
  }
  if (!goalAt.size) return null;
  let expansions = 0;
  while (heap.size) {
    const item = heap.pop();
    if (!item) break;
    const cell = Math.floor(item.state / stride);
    const dir = item.state % stride;
    const x = occ.xOf(cell);
    const y = occ.yOf(cell);
    if (item.prio > gScore[item.state] + heur(x, y) + 1e-6) continue;
    const arrived = goalAt.get(cell);
    const aimed =
      arrived &&
      dir !== 8 &&
      arrived.some((goal) => !goal.skew || dirDelta(dir, (goal.skew.out + 4) % 8) <= 1);
    if (aimed) {
      const axis: { x: number; y: number }[] = [];
      const cells: { x: number; y: number }[] = [];
      let state = item.state;
      let guard = 0;
      while (state >= 0 && guard++ < count) {
        const index = Math.floor(state / stride);
        const stepDir = state % stride;
        const cx = occ.xOf(index);
        const cy = occ.yOf(index);
        axis.push({ x: cx, y: cy });
        cells.push({ x: cx, y: cy });
        const prev = parent[state];
        if (prev >= 0 && stepDir < 8 && stepDir % 2 === 1) {
          const px = occ.xOf(Math.floor(prev / stride));
          const py = occ.yOf(Math.floor(prev / stride));
          cells.push({ x: px, y: cy }, { x: cx, y: py });
        }
        state = prev;
      }
      axis.reverse();
      cells.reverse();
      return { cells, axis };
    }
    if (++expansions > occ.grid.length * 12) return null;
    for (let nextDir = 0; nextDir < 8; nextDir++) {
      if (startStates.has(item.state) && dir !== 8 && dirDelta(dir, nextDir) > 1) continue;
      const nx = x + DX8[nextDir];
      const ny = y + DY8[nextDir];
      const diagonal = nextDir % 2 === 1;
      let step: number | null;
      if (!diagonal) step = stepCost(occ, nx, ny, layer, unlocked);
      else {
        const center = stepCost(occ, nx, ny, layer, unlocked);
        const sideA = stepCost(occ, x + DX8[nextDir], y, layer, unlocked);
        const sideB = stepCost(occ, x, y + DY8[nextDir], layer, unlocked);
        step = center === null || sideA === null || sideB === null ? null : Math.max(center, sideA, sideB) * Math.SQRT2;
      }
      if (step === null) continue;
      let turn = 0;
      if (dir !== 8) {
        const delta = dirDelta(dir, nextDir);
        if (delta >= 3) continue;
        if (delta === 1) turn = 0.35;
        else if (delta === 2) turn = 0.6;
      }
      const nextState = occ.i(nx, ny) * stride + nextDir;
      const nextG = gScore[item.state] + step + turn;
      if (nextG + 1e-9 < gScore[nextState]) {
        gScore[nextState] = nextG;
        parent[nextState] = item.state;
        heap.push(nextState, nextG + heur(nx, ny));
      }
    }
  }
  return null;
}

export interface ConnectOpts {
  required?: boolean;
  forceDiagonal?: boolean;
  forceWidth?: 1 | 2;
}

export function connectRooms(
  occ: Occupancy,
  a: GenRoom,
  b: GenRoom,
  styles: WallStyle[],
  kind: 'tree' | 'loop',
  rng: Rng,
  policy: RoutePolicy,
  opts?: ConnectOpts
): Route | null {
  if (!a.ports.length || !b.ports.length) return null;
  const layer = corridorOwner(a, b, styles);
  const style = styles[layer];
  const skew = a.ports.some((port) => port.skew) || b.ports.some((port) => port.skew);
  const diagonalChance = style === 'double' ? policy.diagonalDouble : style === 'rock' ? policy.diagonalRock : policy.diagonalOther;
  const diagonal = skew || opts?.forceDiagonal === true || (opts?.forceDiagonal !== false && chance(rng, diagonalChance));
  const wideChance = kind === 'loop' ? policy.wideLoop : opts?.required ? policy.wideRequired : policy.wideTree;
  let wide = false;
  if (!diagonal && style !== 'rock' && opts?.forceWidth !== 1) {
    wide = opts?.forceWidth === 2 || chance(rng, wideChance);
  }
  if (wide) {
    const path = routeWidth2(occ, a, b, layer);
    if (path) {
      const startPorts = portsOnCells(a, blockCells(path.blocks[0])).filter((port, index, list) => list.findIndex((item) => item.x === port.x && item.y === port.y) === index);
      const endPorts = portsOnCells(b, blockCells(path.blocks[path.blocks.length - 1]));
      const endA = makeEnd(a, startPorts.slice(0, 2), layer);
      const endB = makeEnd(b, endPorts.slice(0, 2), layer);
      if (endA && endB && startPorts.length >= 2 && endPorts.length >= 2) {
        markCorridor(occ, path.cells, layer);
        return {
          width: 2,
          layer,
          kind,
          endA,
          endB,
          axis: path.blocks.map((block) => [(block.x + 1) * G, (block.y + 1) * G]),
          poly: [],
        };
      }
    }
  }
  const centerA = roomCenter(a);
  const centerB = roomCenter(b);
  const starts = nearestPorts(a, centerB.x, centerB.y, 4, diagonal);
  const goals = nearestPorts(b, centerA.x, centerA.y, 4, diagonal);
  const path = diagonal ? routeWidth8(occ, starts, goals, layer) : routeWidth1(occ, starts, goals, layer);
  if (!path || !path.cells.length) return null;
  const spine = path.axis ?? path.cells;
  const first = spine[0];
  const last = spine[spine.length - 1];
  const start = a.ports.find((port) => port.x === first.x && port.y === first.y);
  const goal = b.ports.find((port) => port.x === last.x && port.y === last.y);
  if (!start || !goal) return null;
  const endA = makeEnd(a, [start], layer);
  const endB = makeEnd(b, [goal], layer);
  if (!endA || !endB) return null;
  markCorridor(occ, path.cells, layer);
  return {
    width: 1,
    layer,
    kind,
    endA,
    endB,
    axis: spine.map((cell) => [(cell.x + 0.5) * G, (cell.y + 0.5) * G]),
    poly: [],
  };
}

export function extensions(end: EndInfo | null, atStart: boolean): Point2D[] {
  if (!end?.room || end.cross) return [];
  const wall: Point2D = [end.x, end.y];
  if (end.cave) {
    const center: Point2D = [(end.room.rect.x + end.room.rect.w / 2) * G, (end.room.rect.y + end.room.rect.h / 2) * G];
    return atStart ? [center, wall] : [wall, center];
  }
  return [wall];
}

export function buildRoutePoly(route: Route, styles: WallStyle[], rng: Rng) {
  const points = simplify([...extensions(route.endA, true), ...route.axis, ...extensions(route.endB, false)]);
  if (!points.length) {
    route.poly = [];
    return;
  }
  const width = route.width * G;
  if (styles[route.layer] !== 'rock') {
    route.poly = polylineRibbonMiter(points, width);
    return;
  }
  const crossStart = route.endA.cross;
  const crossEnd = Boolean(route.endB?.cross);
  if (!crossStart && !crossEnd) {
    route.poly = circlesAlong(points, rng);
    return;
  }
  if (crossEnd) {
    const parts = splitTail(points, width);
    route.poly = batchUnion([
      parts.head.length > 1 ? circlesAlong(parts.head, rng) : [],
      polylineRibbonMiter(parts.tail, width),
    ]);
    return;
  }
  const reversed = splitTail([...points].reverse(), width);
  route.poly = batchUnion([
    polylineRibbonMiter([...reversed.tail].reverse(), width),
    reversed.head.length > 1 ? circlesAlong([...reversed.head].reverse(), rng) : [],
  ]);
}
