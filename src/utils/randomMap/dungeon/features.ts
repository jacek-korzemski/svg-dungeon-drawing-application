import { GRID_SIZE } from '../../geometry';
import { DoorType, Point2D, StairItem, WallStyle } from '../../../types/dungeon';
import { chance, Rng } from '../rng';
import { Junction } from '../types';
import { pointInMultiPolygon } from '../../texturePaint';
import { makeEnd, markCorridor, nearestPorts, routeWidth1 } from './routing';
import { CORRIDOR, DX, DY, Dir, Occupancy, opposite, PILLAR, ROOM } from './grid';
import { EndInfo, GenRoom, Route } from './model';

const G = GRID_SIZE;

export function appendJunction(axis: Point2D[], junction: Junction, width: 1 | 2): Point2D[] {
  if (!axis.length) return axis;
  const points = axis.slice();
  const last = points[points.length - 1];
  const half = (width * G) / 2;
  const sign = junction.dungeonSign;
  const railX = junction.point[0] + sign * Math.max(G, half + 8);
  const stopX = junction.point[0] + sign * half;
  const push = (point: Point2D) => {
    const prev = points[points.length - 1];
    if (Math.hypot(prev[0] - point[0], prev[1] - point[1]) > 1) points.push(point);
  };
  push([railX, last[1]]);
  push([railX, junction.point[1]]);
  push([stopX, junction.point[1]]);
  return points;
}

export function fortified(style: WallStyle | undefined): boolean {
  return style === 'brick' || style === 'double';
}

export function doorTypeFor(route: Route, end: EndInfo, styles: WallStyle[], rng: Rng): DoorType | null {
  if (!end.room) return null;
  if (end.cross) {
    if (route.width === 2) return 'double';
    if (fortified(styles[route.layer]) || fortified(styles[end.room.layer])) return 'portcullis';
    return 'standard';
  }
  if (end.cave) return null;
  if (end.room.role === 'boss') {
    if (route.width === 2) return 'double';
    return chance(rng, 0.5) ? 'portcullis' : 'standard';
  }
  if (end.room.role === 'vault') return chance(rng, 0.4) ? 'secret' : 'standard';
  if (end.room.role === 'shrine') return 'archway';
  if (end.secret) return 'secret';
  const roll = rng.next();
  if (roll < 0.55) return route.width === 2 ? 'double' : 'standard';
  if (roll < 0.75) return 'archway';
  return null;
}

export function placeStairs(
  room: GenRoom,
  exit: Dir,
  occ: Occupancy,
  id: (kind: string) => string,
  align: { x: number; y: number } | null,
  isSolid?: (x: number, y: number) => boolean
): StairItem | null {
  const inward = opposite(exit);
  const candidates: { x: number; y: number }[] = [];
  for (const cell of room.cells) {
    if (room.noPort.has(cell) || room.reserved.has(cell) || room.pillarCells.includes(cell)) continue;
    const x = occ.xOf(cell);
    const y = occ.yOf(cell);
    const ox = x + DX[exit];
    const oy = y + DY[exit];
    const outside = !occ.in(ox, oy) || !room.cells.has(occ.i(ox, oy));
    if (!outside) continue;
    if (isSolid && !isSolid(ox, oy)) continue;
    if (room.polygon.length) {
      const px = (x + 0.5) * G;
      const py = (y + 0.5) * G;
      if (!pointInMultiPolygon(px, py, room.polygon)) continue;
      if (room.islands.some((island) => pointInMultiPolygon(px, py, [island]))) continue;
    }
    candidates.push({ x, y });
  }
  if (!candidates.length) return null;
  const anchor = align ?? { x: room.rect.x + room.rect.w / 2, y: room.rect.y + room.rect.h / 2 };
  candidates.sort((a, b) => Math.abs(a.x - anchor.x) + Math.abs(a.y - anchor.y) - (Math.abs(b.x - anchor.x) + Math.abs(b.y - anchor.y)));
  const along = exit === 0 || exit === 2 ? room.rect.h : room.rect.w;
  const wide = along >= 6;
  for (const wantWide of wide ? [true, false] : [false]) {
    for (const wall of candidates) {
      const dest = { x: wall.x + DX[inward], y: wall.y + DY[inward] };
      if (!occ.in(dest.x, dest.y) || !room.cells.has(occ.i(dest.x, dest.y)) || room.noPort.has(occ.i(dest.x, dest.y))) continue;
      if (room.reserved.has(occ.i(dest.x, dest.y)) || room.pillarCells.includes(occ.i(dest.x, dest.y))) continue;
      if (wantWide) {
        const side = exit === 0 || exit === 2 ? 1 : 0;
        const left = occ.in(dest.x + DX[side], dest.y + DY[side]) && room.cells.has(occ.i(dest.x + DX[side], dest.y + DY[side]));
        const right = occ.in(dest.x - DX[side], dest.y - DY[side]) && room.cells.has(occ.i(dest.x - DX[side], dest.y - DY[side]));
        if (!left || !right) continue;
      }
      return {
        id: id('st'),
        x: (dest.x + 0.5) * G,
        y: (dest.y + 0.5) * G,
        rotation: [0, 90, 180, 270][exit],
        type: wantWide ? 'wide' : 'straight',
        widthCells: wantWide ? 2 : 1,
        lengthCells: 2,
      };
    }
  }
  return null;
}

export function linkJunction(
  occ: Occupancy,
  entrance: GenRoom,
  junction: Junction,
  zone: { x: number; y: number; w: number; h: number }
): Route | null {
  if (!entrance.alive) return null;
  const edgeX = junction.dungeonSign === 1 ? zone.x + 1 : zone.x + zone.w - 2;
  const goals: { x: number; y: number; into: Dir }[] = [];
  for (let radius = 0; radius < zone.h && goals.length < 3; radius++) {
    for (const y of radius === 0 ? [junction.yCell] : [junction.yCell - radius, junction.yCell + radius]) {
      if (!occ.in(edgeX, y) || occ.frame(edgeX, y)) continue;
      const state = occ.grid[occ.i(edgeX, y)];
      if (state === ROOM || state === PILLAR) continue;
      if (state === CORRIDOR && occ.corridorLayer[occ.i(edgeX, y)] !== 0) continue;
      goals.push({ x: edgeX, y, into: junction.dungeonSign === 1 ? 1 : 3 });
    }
    if (goals.length && radius >= 1) break;
  }
  const facing = nearestPorts(entrance, edgeX, junction.yCell, 4);
  const path = routeWidth1(occ, facing.length ? facing : entrance.ports, goals, 0);
  if (!path?.cells.length) return null;
  const first = path.cells[0];
  const start = entrance.ports.find((port) => port.x === first.x && port.y === first.y) ?? facing[0];
  const endA = start ? makeEnd(entrance, [start], 0) : null;
  if (!endA) return null;
  markCorridor(occ, path.cells, 0);
  return {
    width: 1,
    layer: 0,
    kind: 'link',
    endA,
    endB: null,
    axis: appendJunction(
      path.cells.map((cell) => [(cell.x + 0.5) * G, (cell.y + 0.5) * G]),
      junction,
      1
    ),
    poly: [],
  };
}
