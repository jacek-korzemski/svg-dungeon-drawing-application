import { GRID_SIZE } from '../../geometry';
import { DoorItem, MultiPolygon2D } from '../../../types/dungeon';
import { clamp } from '../rng';
import { polylineRibbonMiter } from '../curves';
import { Junction } from '../types';
import { appendJunction } from './features';
import { CORRIDOR, Occupancy, ROOM } from './grid';
import { GenRoom } from './model';

const G = GRID_SIZE;

export function gridJunctionLink(
  occ: Occupancy,
  floor: Uint8Array,
  junction: Junction,
  zone: { x: number; y: number; w: number; h: number },
  rooms: GenRoom[]
): { poly: MultiPolygon2D; door: Omit<DoorItem, 'id'> | null } {
  const y = clamp(junction.yCell, zone.y + 1, zone.y + zone.h - 2);
  const startX = junction.dungeonSign === 1 ? zone.x + 1 : zone.x + zone.w - 2;
  const dx = junction.dungeonSign;
  let x = startX;
  let door: Omit<DoorItem, 'id'> | null = null;
  while (occ.in(x, y)) {
    const nextX = x + dx;
    const next = occ.in(nextX, y) ? occ.i(nextX, y) : -1;
    const room = next >= 0 ? rooms.find((item) => item.alive && item.cells.has(next)) : undefined;
    if (room) {
      door = {
        x: (Math.min(x, nextX) + 1) * G,
        y: (y + 0.5) * G,
        rotation: 90,
        type: 'standard',
        widthCells: 1,
      };
      break;
    }
    if (next >= 0 && floor[next]) break;
    const index = occ.i(x, y);
    if (occ.grid[index] !== ROOM) {
      floor[index] = 1;
      occ.grid[index] = CORRIDOR;
      occ.corridorLayer[index] = 0;
    }
    if (!occ.in(nextX, y)) break;
    x = nextX;
  }
  return {
    poly: polylineRibbonMiter(appendJunction([[(startX + 0.5) * G, (y + 0.5) * G]], junction, 1), G),
    door,
  };
}
