import { GRID_SIZE } from '../../geometry';
import { fitHex, hexVertices, octagonVertices, skewPorts } from '../dungeonShape';
import { Rect } from '../types';
import { DX, DY, Dir, EMPTY, HALO, Occupancy, PILLAR, ROOM, opposite } from './grid';
import { GenRoom, Port } from './model';

const G = GRID_SIZE;

export function stampRooms(occ: Occupancy, rooms: GenRoom[]) {
  occ.grid.fill(EMPTY);
  occ.corridorLayer.fill(-1);
  for (const room of rooms) {
    if (!room.alive) continue;
    for (const cell of room.cells) {
      occ.grid[cell] = ROOM;
    }
    for (const cell of room.pillarCells) {
      occ.grid[cell] = PILLAR;
    }
  }
  recomputeHalo(occ, rooms);
}

export function recomputeHalo(occ: Occupancy, rooms: GenRoom[]) {
  for (let i = 0; i < occ.grid.length; i++) {
    if (occ.grid[i] === HALO) occ.grid[i] = EMPTY;
  }
  for (const room of rooms) {
    if (!room.alive) continue;
    for (const cell of room.cells) {
      if (occ.grid[cell] !== ROOM) continue;
      const x = occ.xOf(cell);
      const y = occ.yOf(cell);
      for (let dir = 0; dir < 4; dir++) {
        const nx = x + DX[dir];
        const ny = y + DY[dir];
        if (!occ.in(nx, ny)) continue;
        const index = occ.i(nx, ny);
        if (occ.grid[index] === EMPTY) occ.grid[index] = HALO;
      }
    }
  }
}

export function wallContinues(room: GenRoom, occ: Occupancy, x: number, y: number, out: number, side: number): boolean {
  const sx = x + DX[side];
  const sy = y + DY[side];
  if (!occ.in(sx, sy)) return false;
  const index = occ.i(sx, sy);
  if (!room.cells.has(index) || room.noPort.has(index)) return false;
  const ox = sx + DX[out];
  const oy = sy + DY[out];
  if (!occ.in(ox, oy)) return false;
  const state = occ.grid[occ.i(ox, oy)];
  return state !== ROOM && state !== PILLAR;
}

export function cavePorts(rect: Rect, occ: Occupancy): Port[] {
  const cx = rect.x + Math.floor((rect.w - 1) / 2);
  const cy = rect.y + Math.floor((rect.h - 1) / 2);
  const ports: Port[] = [
    { x: cx, y: rect.y - 1, into: 2 },
    { x: rect.x + rect.w, y: cy, into: 3 },
    { x: cx, y: rect.y + rect.h, into: 0 },
    { x: rect.x - 1, y: cy, into: 1 },
  ];
  return ports.filter((port) => occ.in(port.x, port.y) && !occ.frame(port.x, port.y));
}

export function computePorts(room: GenRoom, occ: Occupancy): Port[] {
  if (room.kind === 'cave') return cavePorts(room.rect, occ);
  const ports: Port[] = [];
  const seen = new Set<string>();
  for (const cell of room.cells) {
    if (room.noPort.has(cell)) continue;
    const x = occ.xOf(cell);
    const y = occ.yOf(cell);
    for (let out = 0; out < 4; out++) {
      const px = x + DX[out];
      const py = y + DY[out];
      if (!occ.in(px, py) || occ.frame(px, py)) continue;
      const state = occ.grid[occ.i(px, py)];
      if (state === ROOM || state === PILLAR) continue;
      if (!wallContinues(room, occ, x, y, out, (out + 1) % 4)) continue;
      if (!wallContinues(room, occ, x, y, out, (out + 3) % 4)) continue;
      const key = `${px},${py}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ports.push({ x: px, y: py, into: opposite(out as Dir) });
    }
  }
  if (room.kind === 'hexagon' || room.kind === 'octagon') ports.push(...skewRoomPorts(room, occ));
  return ports;
}

export function skewRoomPorts(room: GenRoom, occ: Occupancy): Port[] {
  const fit = room.kind === 'hexagon' ? fitHex(room.rect) : null;
  const vertices =
    room.kind === 'hexagon' && fit
      ? hexVertices(fit.rect, fit.flat)
      : octagonVertices(room.rect, room.rect.w >= 7 && room.rect.h >= 7 ? 2 : 1);
  const cuts = [...room.noPort].map((index) => ({ x: occ.xOf(index), y: occ.yOf(index) }));
  const built = skewPorts(vertices, cuts, G);
  const ports: Port[] = [];
  for (const skew of built) {
    if (!occ.in(skew.cell.x, skew.cell.y) || occ.frame(skew.cell.x, skew.cell.y)) continue;
    const state = occ.grid[occ.i(skew.cell.x, skew.cell.y)];
    if (state === ROOM || state === PILLAR) continue;
    const unlock = skew.unlock.filter((cell) => occ.in(cell.x, cell.y) && !occ.frame(cell.x, cell.y));
    if (skew.unlock.length && unlock.length < skew.unlock.length) continue;
    if (unlock.some((cell) => occ.grid[occ.i(cell.x, cell.y)] === ROOM || occ.grid[occ.i(cell.x, cell.y)] === PILLAR)) continue;
    ports.push({
      x: skew.cell.x,
      y: skew.cell.y,
      into: 0,
      skew: { out: skew.out, wall: skew.wall, angleDeg: skew.angleDeg, unlock },
    });
  }
  return ports;
}
