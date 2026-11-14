import { clamp, range, randInt, Rng } from '../../rng';
import { Junction, Rect } from '../../types';
import type { Dir } from '../grid';
import type { ConcreteArchetype } from '../model';
import { DungeonProfile } from '../profiles';

export interface CoarseGrid {
  cols: number;
  rows: number;
  colX: number[];
  colW: number[];
  rowY: number[];
  rowH: number[];
}

export function coarseCells(zone: Rect, targetRooms: number): { cols: number; rows: number; cs: number } {
  const innerW = Math.max(0, zone.w - 2);
  const innerH = Math.max(0, zone.h - 2);
  const target = Math.max(1, targetRooms);
  const cs = clamp(Math.floor(Math.sqrt((innerW * innerH) / (target * 1.6))), 8, 12);
  return { cols: Math.floor(innerW / cs), rows: Math.floor(innerH / cs), cs };
}

export function coarseFeasible(arch: ConcreteArchetype, zone: Rect): boolean {
  if (arch === 'classic' || arch === 'maze' || arch === 'cavern') return true;
  const nominal = Math.max(4, Math.round(((zone.w - 2) * (zone.h - 2)) / 140));
  const { cols, rows } = coarseCells(zone, nominal);
  if (arch === 'delve') return cols * rows >= 4;
  if (arch === 'hub') return (cols >= 3 && rows >= 2) || (cols >= 2 && rows >= 3);
  return cols >= 2 && rows >= 2;
}

export function roomTarget(zone: Rect, profile: DungeonProfile, rng: Rng): number {
  return clamp(Math.round(((zone.w * zone.h) / 140) * range(rng, profile.roomDensity[0], profile.roomDensity[1])), 4, 60);
}

export function chooseExitEdge(junction: Junction | null, rng: Rng): Dir {
  if (!junction) return randInt(rng, 0, 3) as Dir;
  return junction.dungeonSign === 1 ? 3 : 1;
}

export function makeCoarseGrid(zone: Rect, targetRooms: number, rng: Rng): CoarseGrid {
  const innerW = Math.max(0, zone.w - 2);
  const innerH = Math.max(0, zone.h - 2);
  const sized = coarseCells(zone, Math.max(1, targetRooms));
  let cols = sized.cols;
  let rows = sized.rows;
  let cs = sized.cs;
  if (cols < 1 || rows < 1) {
    cols = innerW >= 8 ? 1 : 0;
    rows = innerH >= 8 ? 1 : 0;
    cs = Math.max(8, Math.min(innerW, innerH));
  }
  const colW = Array.from({ length: cols }, () => (cols === 1 && sized.cols < 1 ? innerW : cs));
  const rowH = Array.from({ length: rows }, () => (rows === 1 && sized.rows < 1 ? innerH : cs));
  const extraW = Math.max(0, innerW - colW.reduce((sum, value) => sum + value, 0));
  const extraH = Math.max(0, innerH - rowH.reduce((sum, value) => sum + value, 0));
  for (let i = 0; i < extraW && colW.length; i++) colW[randInt(rng, 0, colW.length - 1)] += 1;
  for (let i = 0; i < extraH && rowH.length; i++) rowH[randInt(rng, 0, rowH.length - 1)] += 1;
  const colX: number[] = [];
  const rowY: number[] = [];
  let x = zone.x + 1;
  for (const width of colW) {
    colX.push(x);
    x += width;
  }
  let y = zone.y + 1;
  for (const height of rowH) {
    rowY.push(y);
    y += height;
  }
  return { cols: colW.length, rows: rowH.length, colX, colW, rowY, rowH };
}

export function blockRect(grid: CoarseGrid, c: number, r: number, cw = 1, ch = 1): Rect {
  let w = 0;
  let h = 0;
  for (let i = 0; i < cw; i++) w += grid.colW[c + i] ?? 0;
  for (let i = 0; i < ch; i++) h += grid.rowH[r + i] ?? 0;
  return { x: grid.colX[c] ?? 0, y: grid.rowY[r] ?? 0, w, h };
}

export function roomInBlock(block: Rect, sizeFraction: [number, number], rng: Rng): Rect | null {
  let margin = rng.next() < 0.5 ? 2 : 1;
  if (block.w - margin * 2 < 4 || block.h - margin * 2 < 4) margin = 1;
  const availW = block.w - margin * 2;
  const availH = block.h - margin * 2;
  if (availW < 4 || availH < 4) return null;
  const w = clamp(Math.round(4 + (availW - 4) * range(rng, sizeFraction[0], sizeFraction[1])), 4, availW);
  const h = clamp(Math.round(4 + (availH - 4) * range(rng, sizeFraction[0], sizeFraction[1])), 4, availH);
  return {
    x: block.x + margin + randInt(rng, 0, availW - w),
    y: block.y + margin + randInt(rng, 0, availH - h),
    w,
    h,
  };
}

export function edgeCell(grid: CoarseGrid, exitEdge: Dir, rng: Rng, junction: Junction | null): { c: number; r: number } {
  if (!grid.cols || !grid.rows) return { c: 0, r: 0 };
  if (junction) {
    const c = junction.dungeonSign === 1 ? 0 : grid.cols - 1;
    let best = 0;
    let bestDist = Infinity;
    for (let r = 0; r < grid.rows; r++) {
      const mid = grid.rowY[r] + grid.rowH[r] / 2;
      const dist = Math.abs(mid - (junction.yCell + 0.5));
      if (dist < bestDist) {
        bestDist = dist;
        best = r;
      }
    }
    return { c, r: best };
  }
  if (exitEdge === 0) return { c: randInt(rng, 0, grid.cols - 1), r: 0 };
  if (exitEdge === 2) return { c: randInt(rng, 0, grid.cols - 1), r: grid.rows - 1 };
  if (exitEdge === 1) return { c: grid.cols - 1, r: randInt(rng, 0, grid.rows - 1) };
  return { c: 0, r: randInt(rng, 0, grid.rows - 1) };
}

export function cellKey(c: number, r: number): string {
  return `${c},${r}`;
}

export function orthogonal(c: number, r: number, cols: number, rows: number): { c: number; r: number; dir: Dir }[] {
  const found: { c: number; r: number; dir: Dir }[] = [];
  if (r > 0) found.push({ c, r: r - 1, dir: 0 });
  if (c + 1 < cols) found.push({ c: c + 1, r, dir: 1 });
  if (r + 1 < rows) found.push({ c, r: r + 1, dir: 2 });
  if (c > 0) found.push({ c: c - 1, r, dir: 3 });
  return found;
}
