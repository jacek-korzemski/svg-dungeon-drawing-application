import { Point2D } from '../../types/dungeon';
import { Rect } from './types';

export type Dir8 = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const DX8 = [0, 1, 1, 1, 0, -1, -1, -1];
export const DY8 = [-1, -1, 0, 1, 1, 1, 0, -1];

export interface SkewPort {
  out: Dir8;
  wall: Point2D;
  angleDeg: number;
  unlock: { x: number; y: number }[];
  cell: { x: number; y: number };
}

export function hexFits(rect: Rect): boolean {
  return fitHex(rect) !== null;
}

export function fitHex(rect: Rect): { rect: Rect; flat: boolean } | null {
  const flatH = rect.h % 2 === 0 ? rect.h : rect.h - 1;
  const flat = flatH >= 4 && rect.w >= flatH + 2;
  const pointyW = rect.w % 2 === 0 ? rect.w : rect.w - 1;
  const pointy = pointyW >= 4 && rect.h >= pointyW + 2;
  if (!flat && !pointy) return null;
  if (flat && !pointy) return { rect: { ...rect, h: flatH }, flat: true };
  if (pointy && !flat) return { rect: { ...rect, w: pointyW }, flat: false };
  return { rect, flat: rect.w >= rect.h };
}

export function hexVertices(rect: Rect, flat: boolean): Point2D[] {
  const x0 = rect.x;
  const y0 = rect.y;
  const x1 = rect.x + rect.w;
  const y1 = rect.y + rect.h;
  if (flat) {
    const d = rect.h / 2;
    return [
      [x0 + d, y0],
      [x1 - d, y0],
      [x1, y0 + d],
      [x1 - d, y1],
      [x0 + d, y1],
      [x0, y0 + d],
    ];
  }
  const d = rect.w / 2;
  return [
    [x0 + d, y0],
    [x1, y0 + d],
    [x1, y1 - d],
    [x0 + d, y1],
    [x0, y1 - d],
    [x0, y0 + d],
  ];
}

export function octagonVertices(rect: Rect, cut: number): Point2D[] {
  const x0 = rect.x;
  const y0 = rect.y;
  const x1 = rect.x + rect.w;
  const y1 = rect.y + rect.h;
  return [
    [x0 + cut, y0],
    [x1 - cut, y0],
    [x1, y0 + cut],
    [x1, y1 - cut],
    [x1 - cut, y1],
    [x0 + cut, y1],
    [x0, y1 - cut],
    [x0, y0 + cut],
  ];
}

function onInside(poly: Point2D[], x: number, y: number): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (cross < -1e-6) return false;
  }
  return true;
}

export function classifyHex(rect: Rect, flat: boolean): { full: { x: number; y: number }[]; cut: { x: number; y: number }[] } {
  const poly = hexVertices(rect, flat);
  const full: { x: number; y: number }[] = [];
  const cut: { x: number; y: number }[] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const corners: Point2D[] = [
        [x, y],
        [x + 1, y],
        [x + 1, y + 1],
        [x, y + 1],
      ];
      const inside = corners.filter((corner) => onInside(poly, corner[0], corner[1])).length;
      if (inside === 4) full.push({ x, y });
      else if (inside === 3) cut.push({ x, y });
    }
  }
  return { full, cut };
}

function outward(a: Point2D, b: Point2D): { x: number; y: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dy, -dx) || 1;
  return { x: Math.round(dy / len), y: Math.round(-dx / len) };
}

export function skewPorts(vertices: Point2D[], cuts: { x: number; y: number }[], grid: number): SkewPort[] {
  const ports: SkewPort[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (Math.abs(dx) < 0.5 || Math.abs(dy) < 0.5) continue;
    const step = outward(a, b);
    const cells = cuts
      .map((cell) => {
        const cx = cell.x + 0.5;
        const cy = cell.y + 0.5;
        const len2 = dx * dx + dy * dy;
        const t = len2 < 1e-6 ? 0 : ((cx - a[0]) * dx + (cy - a[1]) * dy) / len2;
        const px = a[0] + dx * Math.max(0, Math.min(1, t));
        const py = a[1] + dy * Math.max(0, Math.min(1, t));
        return { cell, t, dist: Math.hypot(cx - px, cy - py) };
      })
      .filter((item) => item.t > -0.05 && item.t < 1.05 && item.dist < 0.8)
      .sort((left, right) => left.t - right.t);
    if (!cells.length) continue;
    const unique: typeof cells = [];
    for (const item of cells) {
      if (!unique.some((have) => have.cell.x === item.cell.x && have.cell.y === item.cell.y)) unique.push(item);
    }
    const m = unique.length;
    const mid = unique[Math.floor((m - 1) / 2)].cell;
    const odd = m % 2 === 1;
    const wall: Point2D = odd
      ? [(mid.x + 0.5) * grid, (mid.y + 0.5) * grid]
      : [((unique[m / 2 - 1].cell.x + unique[m / 2].cell.x + 1) / 2) * grid, ((unique[m / 2 - 1].cell.y + unique[m / 2].cell.y + 1) / 2) * grid];
    const cell = odd
      ? { x: mid.x + step.x, y: mid.y + step.y }
      : { x: Math.floor(wall[0] / grid + step.x * 0.5), y: Math.floor(wall[1] / grid + step.y * 0.5) };
    const unlock = odd
      ? [
          { x: mid.x + step.x, y: mid.y },
          { x: mid.x, y: mid.y + step.y },
        ]
      : [];
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const out = dirFrom(step.x, step.y);
    if (out === null) continue;
    ports.push({ out, wall, angleDeg: angle, unlock, cell });
  }
  return ports;
}

function dirFrom(sx: number, sy: number): Dir8 | null {
  for (let dir = 0; dir < 8; dir++) {
    if (DX8[dir] === Math.sign(sx) && DY8[dir] === Math.sign(sy)) return dir as Dir8;
  }
  return null;
}

export function opposite8(dir: Dir8): Dir8 {
  return ((dir + 4) % 8) as Dir8;
}

export function dirDelta(a: number, b: number): number {
  let delta = Math.abs(a - b);
  if (delta > 4) delta = 8 - delta;
  return delta;
}
