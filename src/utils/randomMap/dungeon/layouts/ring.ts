import { blockRect, chooseExitEdge, makeCoarseGrid, roomTarget } from './coarseGrid';
import { PlanInput } from './delve';
import { GraphPlan, PlannedRoom } from '../plan';

function perimeter(cols: number, rows: number): { c: number; r: number }[] {
  const cells: { c: number; r: number }[] = [];
  for (let c = 0; c < cols; c++) cells.push({ c, r: 0 });
  for (let r = 1; r < rows; r++) cells.push({ c: cols - 1, r });
  if (rows > 1) for (let c = cols - 2; c >= 0; c--) cells.push({ c, r: rows - 1 });
  if (cols > 1) for (let r = rows - 2; r > 0; r--) cells.push({ c: 0, r });
  return cells;
}

function isCorner(cell: { c: number; r: number }, cols: number, rows: number): boolean {
  return (cell.c === 0 || cell.c === cols - 1) && (cell.r === 0 || cell.r === rows - 1);
}

export function planRing(input: PlanInput): GraphPlan {
  const { zone, junction, maxLayers, profile, rng } = input;
  const exitEdge = chooseExitEdge(junction, rng);
  const grid = makeCoarseGrid(zone, roomTarget(zone, profile, rng), rng);
  if (grid.cols < 2 || grid.rows < 2) return { rooms: [], edges: [], entrance: 0, exitEdge };
  let loop = perimeter(grid.cols, grid.rows);
  const anchor =
    exitEdge === 0
      ? { c: Math.floor((grid.cols - 1) / 2), r: 0 }
      : exitEdge === 2
        ? { c: Math.floor((grid.cols - 1) / 2), r: grid.rows - 1 }
        : exitEdge === 1
          ? { c: grid.cols - 1, r: Math.floor((grid.rows - 1) / 2) }
          : { c: 0, r: Math.floor((grid.rows - 1) / 2) };
  let startAt = 0;
  let best = Infinity;
  loop.forEach((cell, index) => {
    const dist = Math.abs(cell.c - anchor.c) + Math.abs(cell.r - anchor.r);
    if (dist < best) {
      best = dist;
      startAt = index;
    }
  });
  loop = [...loop.slice(startAt), ...loop.slice(0, startAt)];
  const selected = loop.map((cell, index) => index === 0 || isCorner(cell, grid.cols, grid.rows) || rng.next() < 0.75);
  while (selected.filter(Boolean).length < 4) {
    const missing = selected.findIndex((on) => !on);
    if (missing < 0) break;
    selected[missing] = true;
  }
  const rooms: PlannedRoom[] = [];
  const ringIds: number[] = [];
  loop.forEach((cell, index) => {
    if (!selected[index]) return;
    const corner = isCorner(cell, grid.cols, grid.rows);
    ringIds.push(rooms.length);
    rooms.push({
      block: blockRect(grid, cell.c, cell.r),
      role: corner ? 'guard' : 'normal',
      group: 0,
      sizeFraction: corner ? [0.7, 1] : [0.5, 1],
      weights: corner ? { octagon: 60, rect: 40 } : undefined,
    });
  });
  const edges: GraphPlan['edges'] = [];
  for (let i = 0; i < ringIds.length; i++) edges.push({ a: ringIds[i], b: ringIds[(i + 1) % ringIds.length], kind: 'ring' });
  const interior: { c: number; r: number }[] = [];
  for (let c = 1; c < grid.cols - 1; c++) {
    for (let r = 1; r < grid.rows - 1; r++) interior.push({ c, r });
  }
  let sanctum = -1;
  if (interior.length && rng.next() < 0.55) {
    const minC = Math.min(...interior.map((cell) => cell.c));
    const maxC = Math.max(...interior.map((cell) => cell.c));
    const minR = Math.min(...interior.map((cell) => cell.r));
    const maxR = Math.max(...interior.map((cell) => cell.r));
    const w = Math.min(3, maxC - minC + 1);
    const h = Math.min(2, maxR - minR + 1);
    const c = minC + Math.floor((maxC - minC + 1 - w) / 2);
    const r = minR + Math.floor((maxR - minR + 1 - h) / 2);
    sanctum = rooms.length;
    rooms.push({ block: blockRect(grid, c, r, w, h), role: 'sanctum', group: 1, sizeFraction: [0.85, 1] });
    const gates = rng.next() < 0.5 ? 4 : 2;
    const mids = [
      { c: c + w / 2, r },
      { c: c + w, r: r + h / 2 },
      { c: c + w / 2, r: r + h },
      { c, r: r + h / 2 },
    ];
    const used = new Set<number>();
    for (const mid of mids.slice(0, gates)) {
      let bestId = ringIds[0];
      let bestDist = Infinity;
      for (const id of ringIds) {
        if (used.has(id)) continue;
        const block = rooms[id].block;
        const dist = Math.abs(block.x + block.w / 2 - (grid.colX[0] + mid.c)) + Math.abs(block.y + block.h / 2 - (grid.rowY[0] + mid.r));
        if (dist < bestDist) {
          bestDist = dist;
          bestId = id;
        }
      }
      used.add(bestId);
      edges.push({ a: sanctum, b: bestId, kind: 'chord' });
    }
  } else if (ringIds.length >= 4 && rng.next() < 0.5) {
    edges.push({ a: ringIds[0], b: ringIds[Math.floor(ringIds.length / 2)], kind: 'chord' });
  }
  if (maxLayers >= 3 && ringIds.length > 1) {
    ringIds.forEach((id, index) => {
      const distance = Math.min(index, ringIds.length - index);
      if (distance > ringIds.length / 4) rooms[id].group = 2;
    });
  }
  if (sanctum < 0 && ringIds.length > 1) rooms[ringIds[Math.floor(ringIds.length / 2)]].role = 'boss';
  return { rooms, edges, entrance: ringIds[0] ?? 0, exitEdge };
}
