import { circleToPolygon, GRID_SIZE, subtractGeometry } from '../../geometry';
import { MultiPolygon2D, Point2D, Polygon2D } from '../../../types/dungeon';
import { classifyHex, fitHex, hexFits, hexVertices } from '../dungeonShape';
import { chance, clamp, randInt, Rng } from '../rng';
import { Rect } from '../types';
import { Occupancy } from './grid';
import { GenRoom, RoomKind } from './model';
import { asMulti, batchUnion, closeRing, rectPoly } from './poly';

const G = GRID_SIZE;

export function cornerOutside(lx: number, ly: number, w: number, h: number, cut: number): boolean {
  if (lx + ly <= cut - 2 && lx < cut && ly < cut) return true;
  if (w - 1 - lx + ly <= cut - 2 && lx >= w - cut && ly < cut) return true;
  if (lx + (h - 1 - ly) <= cut - 2 && lx < cut && ly >= h - cut) return true;
  if (w - 1 - lx + (h - 1 - ly) <= cut - 2 && lx >= w - cut && ly >= h - cut) return true;
  return false;
}

export function cornerPartial(lx: number, ly: number, w: number, h: number, cut: number): boolean {
  const inCorner =
    (lx < cut && ly < cut) ||
    (lx >= w - cut && ly < cut) ||
    (lx < cut && ly >= h - cut) ||
    (lx >= w - cut && ly >= h - cut);
  return inCorner && !cornerOutside(lx, ly, w, h, cut);
}

export function octagonPolygon(rect: Rect, cut: number): Polygon2D {
  const x0 = rect.x * G;
  const y0 = rect.y * G;
  const x1 = (rect.x + rect.w) * G;
  const y1 = (rect.y + rect.h) * G;
  const d = cut * G;
  return closeRing([
    [x0 + d, y0],
    [x1 - d, y0],
    [x1, y0 + d],
    [x1, y1 - d],
    [x1 - d, y1],
    [x0 + d, y1],
    [x0, y1 - d],
    [x0, y0 + d],
  ]);
}

const CLASSIC_WEIGHTS: Partial<Record<RoomKind, number>> = { rect: 40, hall: 15, L: 15, octagon: 15, hexagon: 12, T: 15 };

export function chooseKind(rect: Rect, rng: Rng, weights: Partial<Record<RoomKind, number>> = CLASSIC_WEIGHTS): RoomKind {
  const options: { kind: RoomKind; weight: number }[] = [];
  const add = (kind: RoomKind, allowed: boolean) => {
    const weight = weights[kind] ?? 0;
    if (allowed && weight > 0) options.push({ kind, weight });
  };
  add('rect', true);
  add('hall', rect.w >= 6 && rect.h >= 6);
  add('L', rect.w >= 6 && rect.h >= 6);
  add('octagon', rect.w >= 5 && rect.h >= 5);
  add('hexagon', hexFits(rect));
  add('T', (rect.w >= 7 && rect.h >= 6) || (rect.h >= 7 && rect.w >= 6));
  if (!options.length) return 'rect';
  let roll = rng.next() * options.reduce((sum, option) => sum + option.weight, 0);
  for (const option of options) {
    roll -= option.weight;
    if (roll <= 0) return option.kind;
  }
  return 'rect';
}

export function fillCells(occ: Occupancy, rect: Rect, skip: (x: number, y: number) => boolean): Set<number> {
  const cells = new Set<number>();
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (!occ.in(x, y) || skip(x, y)) continue;
      cells.add(occ.i(x, y));
    }
  }
  return cells;
}

export function subtractCuts(rect: Rect, cuts: Rect[]): MultiPolygon2D {
  let shape = asMulti(rectPoly(rect));
  for (const cut of cuts) {
    const piece = asMulti(rectPoly(cut));
    if (piece.length) shape = subtractGeometry(shape, piece);
  }
  return shape.length ? shape : asMulti(rectPoly(rect));
}

export function buildCave(rect: Rect, rng: Rng): { polygon: MultiPolygon2D; islands: Polygon2D[] } {
  const minX = (rect.x + 0.5) * G;
  const maxX = (rect.x + rect.w - 0.5) * G;
  const minY = (rect.y + 0.5) * G;
  const maxY = (rect.y + rect.h - 0.5) * G;
  const cx = (rect.x + rect.w / 2) * G;
  const cy = (rect.y + rect.h / 2) * G;
  const parts: MultiPolygon2D[] = [];
  const pushCircle = (x: number, y: number, radius: number) => {
    const poly = circleToPolygon(x, y, radius, 12);
    if (poly.length) parts.push([poly]);
  };
  pushCircle(cx, cy, Math.min(G, (maxX - minX) / 2, (maxY - minY) / 2));
  const steps = Math.min(48, Math.max(8, Math.round((6 + rng.next() * 8) * ((rect.w * rect.h) / 16))));
  let x = cx;
  let y = cy;
  for (let i = 0; i < steps; i++) {
    const maxR = Math.max(G * 0.45, Math.min(maxX - minX, maxY - minY) / 2);
    const radius = Math.min(maxR * 0.92, (0.9 + rng.next() * 0.7) * G);
    const angle = rng.next() * Math.PI * 2;
    x = clamp(x + Math.cos(angle) * 0.6 * G, minX + radius, maxX - radius);
    y = clamp(y + Math.sin(angle) * 0.6 * G, minY + radius, maxY - radius);
    pushCircle(x, y, radius);
  }
  const mids: Point2D[] = [
    [cx, rect.y * G],
    [(rect.x + rect.w) * G, cy],
    [cx, (rect.y + rect.h) * G],
    [rect.x * G, cy],
  ];
  for (const mid of mids) {
    const dist = Math.hypot(mid[0] - cx, mid[1] - cy);
    const count = Math.max(1, Math.ceil(dist / (0.55 * G)));
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      pushCircle(cx + (mid[0] - cx) * t, cy + (mid[1] - cy) * t, 0.48 * G);
    }
  }
  let polygon = batchUnion(parts);
  if (!polygon.length) polygon = asMulti(rectPoly(rect));
  const islands: Polygon2D[] = [];
  if (rect.w >= 7 && rect.h >= 7 && chance(rng, 0.7)) {
    const angle = rng.next() * Math.PI * 2;
    const dist = (1.3 + rng.next() * 0.6) * G;
    const ix = clamp(cx + Math.cos(angle) * dist, (rect.x + 1.5) * G, (rect.x + rect.w - 1.5) * G);
    const iy = clamp(cy + Math.sin(angle) * dist, (rect.y + 1.5) * G, (rect.y + rect.h - 1.5) * G);
    const island = circleToPolygon(ix, iy, 0.5 * G, 10);
    if (island.length) islands.push(island);
  }
  return { polygon, islands };
}

export function makeRoom(
  occ: Occupancy,
  id: number,
  rect: Rect,
  rng: Rng,
  weights?: Partial<Record<RoomKind, number>>
): GenRoom | null {
  if (rect.w < 4 || rect.h < 4) return null;
  const kind = chooseKind(rect, rng, weights);
  const room: GenRoom = {
    id,
    rect,
    kind,
    cells: new Set<number>(),
    noPort: new Set<number>(),
    pillarCells: [],
    pillars: [],
    islands: [],
    polygon: [],
    ports: [],
    layer: 0,
    role: 'normal',
    group: 0,
    reserved: new Set<number>(),
    alive: true,
  };
  if (kind === 'octagon') {
    const cut = rect.w >= 7 && rect.h >= 7 ? 2 : 1;
    room.cells = fillCells(occ, rect, (x, y) => cornerOutside(x - rect.x, y - rect.y, rect.w, rect.h, cut));
    for (const cell of room.cells) {
      const lx = occ.xOf(cell) - rect.x;
      const ly = occ.yOf(cell) - rect.y;
      if (cornerPartial(lx, ly, rect.w, rect.h, cut)) room.noPort.add(cell);
    }
    room.polygon = asMulti(octagonPolygon(rect, cut));
  } else if (kind === 'hexagon') {
    const fit = fitHex(rect);
    if (!fit) return null;
    room.rect = fit.rect;
    const classified = classifyHex(fit.rect, fit.flat);
    for (const cell of classified.full) room.cells.add(occ.i(cell.x, cell.y));
    for (const cell of classified.cut) {
      const index = occ.i(cell.x, cell.y);
      room.cells.add(index);
      room.noPort.add(index);
    }
    room.polygon = asMulti(closeRing(hexVertices(fit.rect, fit.flat).map((point) => [point[0] * G, point[1] * G])));
    if (fit.rect.w >= 10) {
      const midY = fit.rect.y + Math.floor(fit.rect.h / 2);
      const left = fit.rect.x + 3;
      const right = fit.rect.x + fit.rect.w - 4;
      for (const x of [left, right]) {
        const index = occ.i(x, midY);
        if (!room.cells.has(index) || room.noPort.has(index)) continue;
        room.cells.delete(index);
        room.pillarCells.push(index);
        const pillar = rectPoly({ x, y: midY, w: 1, h: 1 });
        if (pillar.length) room.pillars.push(pillar);
      }
    }
  } else if (kind === 'L' || kind === 'T') {
    const cuts: Rect[] = [];
    if (kind === 'L') {
      const cw = clamp(Math.max(2, Math.ceil(rect.w / 2 - 1)), 2, rect.w - 3);
      const ch = clamp(Math.max(2, Math.ceil(rect.h / 2 - 1)), 2, rect.h - 3);
      const corner = randInt(rng, 0, 3);
      cuts.push({
        x: corner % 2 === 0 ? rect.x : rect.x + rect.w - cw,
        y: corner < 2 ? rect.y : rect.y + rect.h - ch,
        w: cw,
        h: ch,
      });
    } else if (rect.w >= 7 && rect.h >= 6 && (rect.w >= rect.h || rect.h < 7)) {
      const notch = Math.max(2, Math.floor((rect.w - 3) / 2));
      const depth = clamp(Math.max(2, Math.floor(rect.h / 2) - 1), 2, rect.h - 3);
      const top = chance(rng, 0.5);
      const y = top ? rect.y : rect.y + rect.h - depth;
      cuts.push({ x: rect.x, y, w: notch, h: depth }, { x: rect.x + rect.w - notch, y, w: notch, h: depth });
    } else {
      const notch = Math.max(2, Math.floor((rect.h - 3) / 2));
      const depth = clamp(Math.max(2, Math.floor(rect.w / 2) - 1), 2, rect.w - 3);
      const left = chance(rng, 0.5);
      const x = left ? rect.x : rect.x + rect.w - depth;
      cuts.push({ x, y: rect.y, w: depth, h: notch }, { x, y: rect.y + rect.h - notch, w: depth, h: notch });
    }
    const blocked = new Set<number>();
    for (const cut of cuts) {
      for (let y = cut.y; y < cut.y + cut.h; y++) {
        for (let x = cut.x; x < cut.x + cut.w; x++) {
          if (occ.in(x, y)) blocked.add(occ.i(x, y));
        }
      }
    }
    room.cells = fillCells(occ, rect, (x, y) => blocked.has(occ.i(x, y)));
    room.polygon = subtractCuts(rect, cuts);
  } else {
    room.cells = fillCells(occ, rect, () => false);
    room.polygon = asMulti(rectPoly(rect));
    if (kind === 'hall') {
      for (let x = rect.x + 2; x <= rect.x + rect.w - 3; x += 3) {
        for (let y = rect.y + 2; y <= rect.y + rect.h - 3; y += 3) {
          const index = occ.i(x, y);
          room.cells.delete(index);
          room.pillarCells.push(index);
          const pillar = rectPoly({ x, y, w: 1, h: 1 });
          if (pillar.length) room.pillars.push(pillar);
        }
      }
    }
  }
  if (room.cells.size < 8 || !room.polygon.length) return null;
  return room;
}

export function roomCenter(room: GenRoom): { x: number; y: number } {
  return { x: room.rect.x + room.rect.w / 2, y: room.rect.y + room.rect.h / 2 };
}

export function roomDistance(a: GenRoom, b: GenRoom): number {
  const ca = roomCenter(a);
  const cb = roomCenter(b);
  return Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
}
