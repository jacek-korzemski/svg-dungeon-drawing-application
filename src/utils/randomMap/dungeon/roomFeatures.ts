import { GRID_SIZE } from '../../geometry';
import { blobPolygon } from '../curves';
import { DoorItem, Point2D, StandaloneWall, WallStyle } from '../../../types/dungeon';
import { chance, randInt, Rng } from '../rng';
import { DX, DY, Occupancy } from './grid';
import { GenRoom } from './model';
import { DungeonProfile } from './profiles';
import { asMulti, batchUnion, clipTo, rectPoly } from './poly';

const G = GRID_SIZE;

function occupiedByOther(rooms: GenRoom[], index: number, self: GenRoom): boolean {
  for (const room of rooms) {
    if (room === self || !room.alive) continue;
    if (room.cells.has(index) || room.pillarCells.includes(index)) return true;
  }
  return false;
}

function expandRect(room: GenRoom, cells: { x: number; y: number }[]) {
  let minX = room.rect.x;
  let minY = room.rect.y;
  let maxX = room.rect.x + room.rect.w;
  let maxY = room.rect.y + room.rect.h;
  for (const cell of cells) {
    minX = Math.min(minX, cell.x);
    minY = Math.min(minY, cell.y);
    maxX = Math.max(maxX, cell.x + 1);
    maxY = Math.max(maxY, cell.y + 1);
  }
  room.rect = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function tryAlcove(room: GenRoom, rooms: GenRoom[], occ: Occupancy, rng: Rng): boolean {
  const options: { cells: { x: number; y: number }[] }[] = [];
  for (const index of room.cells) {
    const x = occ.xOf(index);
    const y = occ.yOf(index);
    for (let out = 0; out < 4; out++) {
      const along = (out + 1) % 4;
      for (const length of [1, 2]) {
        const cells: { x: number; y: number }[] = [];
        let ok = true;
        for (let step = 0; step < length; step++) {
          const sx = x + DX[along] * step;
          const sy = y + DY[along] * step;
          const host = occ.in(sx, sy) ? occ.i(sx, sy) : -1;
          if (host < 0 || !room.cells.has(host)) {
            ok = false;
            break;
          }
          const nearCorner =
            (sx <= room.rect.x || sx >= room.rect.x + room.rect.w - 1) &&
            (sy <= room.rect.y || sy >= room.rect.y + room.rect.h - 1);
          if (nearCorner) {
            ok = false;
            break;
          }
          const ax = sx + DX[out];
          const ay = sy + DY[out];
          if (!occ.in(ax, ay) || occ.frame(ax, ay)) {
            ok = false;
            break;
          }
          const alcove = occ.i(ax, ay);
          if (room.cells.has(alcove) || occupiedByOther(rooms, alcove, room)) {
            ok = false;
            break;
          }
          for (let oy = -2; oy <= 2 && ok; oy++) {
            for (let ox = -2; ox <= 2; ox++) {
              const nx = ax + ox;
              const ny = ay + oy;
              if (!occ.in(nx, ny) || occ.frame(nx, ny)) {
                ok = false;
                break;
              }
              const neighbor = occ.i(nx, ny);
              if (room.cells.has(neighbor)) continue;
              if (occupiedByOther(rooms, neighbor, room)) {
                ok = false;
                break;
              }
            }
          }
          cells.push({ x: ax, y: ay });
        }
        if (ok && cells.length === length) options.push({ cells });
      }
    }
  }
  if (!options.length) return false;
  const chosen = options[Math.floor(rng.next() * options.length)];
  const indexes = chosen.cells.map((cell) => occ.i(cell.x, cell.y));
  for (const index of indexes) {
    room.cells.add(index);
    room.noPort.add(index);
  }
  const minX = Math.min(...chosen.cells.map((cell) => cell.x));
  const minY = Math.min(...chosen.cells.map((cell) => cell.y));
  const maxX = Math.max(...chosen.cells.map((cell) => cell.x)) + 1;
  const maxY = Math.max(...chosen.cells.map((cell) => cell.y)) + 1;
  const added = asMulti(rectPoly({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }));
  room.polygon = batchUnion([room.polygon, added]);
  expandRect(room, chosen.cells);
  return true;
}

function applyChasm(room: GenRoom, occ: Occupancy, rng: Rng) {
  const w = Math.min(4, room.rect.w - 4);
  const h = Math.min(3, room.rect.h - 4);
  if (w < 1 || h < 1) return;
  const x = room.rect.x + Math.floor((room.rect.w - w) / 2);
  const y = room.rect.y + Math.floor((room.rect.h - h) / 2);
  const hole = { x, y, w, h };
  const radius = (Math.min(w, h) / 2) * G * 0.9;
  const blob = blobPolygon(rng, [(x + w / 2) * G, (y + h / 2) * G], radius);
  const clipped = clipTo(asMulti(blob), asMulti(rectPoly(hole)));
  if (!clipped.length) return;
  room.islands.push(...clipped);
  for (let cy = y; cy < y + h; cy++) {
    for (let cx = x; cx < x + w; cx++) {
      if (!occ.in(cx, cy)) continue;
      const index = occ.i(cx, cy);
      if (!room.cells.has(index)) continue;
      room.cells.delete(index);
      room.pillarCells.push(index);
    }
  }
}

export function applyAlcovesAndChasms(rooms: GenRoom[], occ: Occupancy, styles: WallStyle[], rng: Rng, profile: DungeonProfile) {
  for (const room of rooms) {
    if (!room.alive || room.kind === 'cave' || room.kind === 'hexagon') continue;
    if ((room.kind === 'rect' || room.kind === 'hall' || room.kind === 'L' || room.kind === 'T') && chance(rng, profile.features.alcove)) {
      const count = randInt(rng, 1, 3);
      for (let i = 0; i < count; i++) {
        if (!tryAlcove(room, rooms, occ, rng)) break;
      }
    }
    const style = styles[room.layer];
    const large = room.rect.w >= 8 && room.rect.h >= 6;
    if (large && (style === 'ruins' || style === 'rock' || room.role === 'boss') && chance(rng, profile.features.chasm)) {
      applyChasm(room, occ, rng);
    }
  }
}

function segments(width: number): number[] {
  const parts: number[] = [];
  let left = width;
  while (left > 0) {
    if (left <= 3) {
      if (left === 1 && parts.length) parts[parts.length - 1] += 1;
      else parts.push(left);
      break;
    }
    parts.push(2);
    left -= 2;
  }
  return parts;
}

export function applyPartitions(
  rooms: GenRoom[],
  occ: Occupancy,
  styles: WallStyle[],
  rng: Rng
): { walls: { layer: number; wall: Omit<StandaloneWall, 'id'> }[]; doors: Omit<DoorItem, 'id'>[] } {
  const walls: { layer: number; wall: Omit<StandaloneWall, 'id'> }[] = [];
  const doors: Omit<DoorItem, 'id'>[] = [];
  for (const room of rooms) {
    if (!room.alive || room.role !== 'prison' || room.rect.w < 6 || room.rect.h < 5) continue;
    const horizontal = room.rect.w >= room.rect.h;
    const span = horizontal ? room.rect.w : room.rect.h;
    const parts = segments(span);
    if (!parts.length) continue;
    const atStart = chance(rng, 0.5);
    let cursor = horizontal ? room.rect.x : room.rect.y;
    const depthStart = horizontal
      ? atStart
        ? room.rect.y
        : room.rect.y + room.rect.h - 2
      : atStart
        ? room.rect.x
        : room.rect.x + room.rect.w - 2;
    const front = depthStart + (atStart ? 2 : 0);
    let fitted = true;
    const blocks: { a: number; b: number }[] = [];
    for (const part of parts) {
      for (let step = 0; step < part; step++) {
        for (let depth = 0; depth < 2; depth++) {
          const x = horizontal ? cursor + step : depthStart + depth;
          const y = horizontal ? depthStart + depth : cursor + step;
          if (!occ.in(x, y) || !room.cells.has(occ.i(x, y))) fitted = false;
        }
      }
      blocks.push({ a: cursor, b: cursor + part });
      cursor += part;
    }
    if (!fitted) continue;
    const style = styles[room.layer] ?? 'straight';
    for (const block of blocks) {
      for (let step = block.a; step < block.b; step++) {
        for (let depth = 0; depth < 2; depth++) {
          const x = horizontal ? step : depthStart + depth;
          const y = horizontal ? depthStart + depth : step;
          room.reserved.add(occ.i(x, y));
        }
      }
      const gap = block.a + Math.floor((block.b - block.a) / 2);
      const frontA: Point2D = horizontal ? [block.a * G, front * G] : [front * G, block.a * G];
      const gapA: Point2D = horizontal ? [gap * G, front * G] : [front * G, gap * G];
      const gapB: Point2D = horizontal ? [(gap + 1) * G, front * G] : [front * G, (gap + 1) * G];
      const frontB: Point2D = horizontal ? [block.b * G, front * G] : [front * G, block.b * G];
      if (gap > block.a) walls.push({ layer: room.layer, wall: { points: [frontA, gapA], wallStyle: style, thickness: 8 } });
      if (gap + 1 < block.b) walls.push({ layer: room.layer, wall: { points: [gapB, frontB], wallStyle: style, thickness: 8 } });
      doors.push({
        x: horizontal ? (gap + 0.5) * G : front * G,
        y: horizontal ? front * G : (gap + 0.5) * G,
        rotation: horizontal ? 0 : 90,
        type: 'standard',
        widthCells: 1,
      });
    }
    for (let i = 0; i < blocks.length - 1; i++) {
      const edge = blocks[i].b;
      const a: Point2D = horizontal ? [edge * G, depthStart * G] : [depthStart * G, edge * G];
      const b: Point2D = horizontal ? [edge * G, (depthStart + 2) * G] : [(depthStart + 2) * G, edge * G];
      walls.push({ layer: room.layer, wall: { points: [a, b], wallStyle: style, thickness: 8 } });
    }
  }
  return { walls, doors };
}
