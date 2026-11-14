import { range } from '../../rng';
import { blockRect, cellKey, chooseExitEdge, edgeCell, makeCoarseGrid, orthogonal, roomTarget } from './coarseGrid';
import { PlanInput } from './delve';
import { GraphPlan, PlannedRoom } from '../plan';

function manhattan(a: { c: number; r: number }, b: { c: number; r: number }): number {
  return Math.abs(a.c - b.c) + Math.abs(a.r - b.r);
}

export function planHub(input: PlanInput): GraphPlan {
  const { zone, junction, profile, rng } = input;
  const exitEdge = chooseExitEdge(junction, rng);
  let grid = makeCoarseGrid(zone, roomTarget(zone, profile, rng), rng);
  if (grid.cols < 3 || grid.rows < 2) grid = makeCoarseGrid(zone, Math.max(12, roomTarget(zone, profile, rng)), rng);
  const exit = exitEdge;
  if (grid.cols < 2 || grid.rows < 2) return { rooms: [], edges: [], entrance: 0, exitEdge: exit };
  const big = (grid.cols >= 4 && grid.rows >= 3) || (grid.cols >= 3 && grid.rows >= 4);
  const hubC = big ? Math.max(0, Math.min(grid.cols - 2, Math.floor((grid.cols - 2) / 2))) : Math.floor((grid.cols - 1) / 2);
  const hubR = big ? Math.max(0, Math.min(grid.rows - 2, Math.floor((grid.rows - 2) / 2))) : Math.floor((grid.rows - 1) / 2);
  const hubW = big ? 2 : 1;
  const hubH = big ? 2 : 1;
  const used = new Set<string>();
  for (let c = hubC; c < hubC + hubW; c++) {
    for (let r = hubR; r < hubR + hubH; r++) used.add(cellKey(c, r));
  }
  const hubCenter = { c: hubC + (hubW - 1) / 2, r: hubR + (hubH - 1) / 2 };
  const adjacent: { c: number; r: number; dir: number }[] = [];
  for (let c = hubC; c < hubC + hubW; c++) {
    for (let r = hubR; r < hubR + hubH; r++) {
      for (const next of orthogonal(c, r, grid.cols, grid.rows)) {
        if (used.has(cellKey(next.c, next.r)) || adjacent.some((item) => item.c === next.c && item.r === next.r)) continue;
        adjacent.push(next);
      }
    }
  }
  const freeCount = grid.cols * grid.rows - hubW * hubH;
  const k = Math.min(adjacent.length, 6);
  const starts: { c: number; r: number; dir: number }[] = [];
  const pool = adjacent.slice();
  while (starts.length < k && pool.length) {
    pool.sort((a, b) => {
      const sideA = starts.some((item) => item.dir === a.dir) ? 1 : 0;
      const sideB = starts.some((item) => item.dir === b.dir) ? 1 : 0;
      const farA = starts.length ? Math.min(...starts.map((item) => manhattan(item, a))) : manhattan(hubCenter, a);
      const farB = starts.length ? Math.min(...starts.map((item) => manhattan(item, b))) : manhattan(hubCenter, b);
      return sideA - sideB || farB - farA;
    });
    starts.push(pool.shift() as { c: number; r: number; dir: number });
  }
  const rooms: PlannedRoom[] = [
    { block: blockRect(grid, hubC, hubR, hubW, hubH), role: 'hub', group: 1, sizeFraction: [0.85, 1] },
  ];
  const edges: GraphPlan['edges'] = [];
  const wings: { cells: { c: number; r: number; id: number }[] }[] = starts.map((start) => {
    used.add(cellKey(start.c, start.r));
    const id = rooms.length;
    rooms.push({ block: blockRect(grid, start.c, start.r), role: 'normal', group: 2, sizeFraction: [0.5, 1] });
    edges.push({ a: 0, b: id, kind: 'hub' });
    return { cells: [{ ...start, id }] };
  });
  const share = range(rng, 0.55, 0.75);
  let quota = Math.max(1, Math.round((freeCount * share) / Math.max(1, wings.length)));
  if (wings.length && 1 + wings.length * quota < 5) quota = Math.ceil(4 / wings.length);
  let guard = 0;
  while (wings.some((wing) => wing.cells.length < quota) && guard++ < freeCount) {
    let grew = false;
    for (const wing of wings) {
      if (wing.cells.length >= quota) continue;
      const options: { c: number; r: number; weight: number; parent: number }[] = [];
      for (const cell of wing.cells) {
        for (const next of orthogonal(cell.c, cell.r, grid.cols, grid.rows)) {
          if (used.has(cellKey(next.c, next.r))) continue;
          options.push({ c: next.c, r: next.r, weight: 1 + manhattan(next, hubCenter), parent: cell.id });
        }
      }
      if (!options.length) continue;
      let roll = rng.next() * options.reduce((sum, item) => sum + item.weight, 0);
      let chosen = options[0];
      for (const option of options) {
        roll -= option.weight;
        if (roll <= 0) {
          chosen = option;
          break;
        }
      }
      used.add(cellKey(chosen.c, chosen.r));
      const id = rooms.length;
      rooms.push({ block: blockRect(grid, chosen.c, chosen.r), role: 'normal', group: 2, sizeFraction: [0.5, 1] });
      edges.push({ a: chosen.parent, b: id, kind: 'branch' });
      wing.cells.push({ c: chosen.c, r: chosen.r, id });
      grew = true;
    }
    if (!grew) break;
  }
  const entranceCell = edgeCell(grid, exitEdge, rng, junction);
  let entrance = 1;
  let best = Infinity;
  wings.forEach((wing, wingIndex) => {
    for (const cell of wing.cells) {
      const dist = Math.abs(cell.c - entranceCell.c) + Math.abs(cell.r - entranceCell.r);
      if (dist < best) {
        best = dist;
        entrance = cell.id;
        void wingIndex;
      }
    }
  });
  const entranceWing = wings.findIndex((wing) => wing.cells.some((cell) => cell.id === entrance));
  wings.forEach((wing, index) => {
    const group = index === entranceWing ? 0 : index + 2;
    for (const cell of wing.cells) rooms[cell.id].group = group;
  });
  const longest = wings
    .map((wing, index) => ({ index, length: wing.cells.length }))
    .filter((wing) => wing.index !== entranceWing)
    .sort((a, b) => b.length - a.length)[0];
  if (longest) {
    const leaf = wings[longest.index].cells[wings[longest.index].cells.length - 1];
    rooms[leaf.id].role = 'boss';
    rooms[leaf.id].sizeFraction = [0.85, 1];
  }
  let chords = 0;
  if (grid.cols * grid.rows > 8) {
  const seenChord = new Set<string>();
  for (let left = 0; left < wings.length; left++) {
    for (let right = left + 1; right < wings.length; right++) {
      for (const a of wings[left].cells) {
        for (const b of wings[right].cells) {
          if (chords >= 2 || Math.abs(a.c - b.c) + Math.abs(a.r - b.r) !== 1) continue;
          const key = `${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`;
          if (seenChord.has(key) || rng.next() >= 0.25) continue;
          seenChord.add(key);
          edges.push({ a: a.id, b: b.id, kind: 'chord' });
          chords += 1;
        }
      }
    }
  }
  }
  if (rooms.length < 2) return { rooms: [], edges: [], entrance: 0, exitEdge };
  return { rooms, edges, entrance, exitEdge };
}
