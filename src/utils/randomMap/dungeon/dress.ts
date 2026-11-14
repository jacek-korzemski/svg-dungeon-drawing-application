import { GRID_SIZE } from '../../geometry';
import { LabelItem, PropItem, StairItem, WallStyle } from '../../../types/dungeon';
import { IdFactory, RandomMapLabels } from '../types';
import { Rng } from '../rng';
import { DX, DY, Dir, Occupancy, opposite } from './grid';
import { GenRoom, Route } from './model';
import { DungeonProfile } from './profiles';

const G = GRID_SIZE;

function besidePort(room: GenRoom, x: number, y: number): boolean {
  for (let dir = 0; dir < 4; dir++) {
    const nx = x + DX[dir];
    const ny = y + DY[dir];
    if (room.ports.some((port) => port.x === nx && port.y === ny)) return true;
  }
  return false;
}

function openFloor(room: GenRoom, occ: Occupancy): { x: number; y: number }[] {
  const spots: { x: number; y: number }[] = [];
  for (const cell of room.cells) {
    if (room.noPort.has(cell) || room.pillarCells.includes(cell) || room.reserved.has(cell)) continue;
    const x = occ.xOf(cell);
    const y = occ.yOf(cell);
    if (besidePort(room, x, y)) continue;
    spots.push({ x, y });
  }
  return spots;
}

function reserveStairs(stairs: StairItem[], occ: Occupancy, reserved: Set<number>) {
  for (const stair of stairs) {
    const x = Math.round(stair.x / G - 0.5);
    const y = Math.round(stair.y / G - 0.5);
    const exit = Math.round(stair.rotation / 90) % 4;
    const inward = opposite(exit as Dir);
    const cells = [{ x, y }];
    if (stair.lengthCells >= 2) cells.push({ x: x + DX[inward], y: y + DY[inward] });
    const wide = stair.widthCells >= 2;
    const side = exit % 2 === 0 ? 1 : 0;
    const all = wide
      ? cells.flatMap((cell) => [
          cell,
          { x: cell.x + DX[side], y: cell.y + DY[side] },
          { x: cell.x - DX[side], y: cell.y - DY[side] },
        ])
      : cells;
    for (const cell of all) if (occ.in(cell.x, cell.y)) reserved.add(occ.i(cell.x, cell.y));
  }
}

export function dressDungeon(
  rooms: GenRoom[],
  occ: Occupancy,
  styles: WallStyle[],
  links: { a: number; b: number }[],
  entrance: GenRoom,
  routes: Route[],
  rng: Rng,
  id: IdFactory,
  labels: RandomMapLabels,
  stairs: StairItem[],
  profile: DungeonProfile
): { props: PropItem[]; labels: LabelItem[] } {
  void styles;
  void routes;
  void rng;
  void labels;
  void profile;
  const roomLabels: LabelItem[] = [];
  const reserved = new Set<number>();
  reserveStairs(stairs, occ, reserved);
  const adj = new Map<number, number[]>();
  for (const room of rooms) if (room.alive) adj.set(room.id, []);
  for (const link of links) {
    if (!adj.has(link.a) || !adj.has(link.b)) continue;
    adj.get(link.a)?.push(link.b);
    adj.get(link.b)?.push(link.a);
  }
  const seen = new Set<number>([entrance.id]);
  const queue = entrance.alive ? [entrance.id] : [];
  const order: number[] = [];
  while (queue.length) {
    const current = queue.shift() as number;
    order.push(current);
    for (const next of adj.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  order.forEach((roomId, index) => {
    const room = rooms[roomId];
    if (!room?.alive) return;
    const centerX = room.rect.x + room.rect.w / 2;
    const centerY = room.rect.y + room.rect.h / 2;
    const spots = openFloor(room, occ).filter((spot) => !reserved.has(occ.i(spot.x, spot.y)));
    spots.sort((a, b) => Math.abs(a.x + 0.5 - centerX) + Math.abs(a.y + 0.5 - centerY) - (Math.abs(b.x + 0.5 - centerX) + Math.abs(b.y + 0.5 - centerY)));
    const spot = spots[0] ?? { x: centerX, y: centerY };
    if (spots[0]) reserved.add(occ.i(spot.x, spot.y));
    roomLabels.push({
      id: id('lb'),
      x: (spot.x + 0.5) * G,
      y: (spot.y + 0.5) * G,
      text: '',
      badgeNumber: String(index + 1),
      fontSize: 22,
      rotation: 0,
    });
  });
  return { props: [], labels: roomLabels };
}
