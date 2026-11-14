import { describe, expect, it } from 'vitest';
import { GRID_SIZE } from '../../../geometry';
import { layerEnvironment, PropItem, StairItem } from '../../../../types/dungeon';
import { pointInMultiPolygon } from '../../../texturePaint';
import { run } from './helpers';

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 - 0.5 && a.x1 > b.x0 + 0.5 && a.y0 < b.y1 - 0.5 && a.y1 > b.y0 + 0.5;
}

function propBox(prop: PropItem): Box {
  const swap = prop.rotation % 180 !== 0;
  const width = swap ? prop.heightPx : prop.widthPx;
  const height = swap ? prop.widthPx : prop.heightPx;
  return { x0: prop.x - width / 2, y0: prop.y - height / 2, x1: prop.x + width / 2, y1: prop.y + height / 2 };
}

function stairBox(stair: StairItem): Box {
  const exit = ((Math.round(stair.rotation / 90) % 4) + 4) % 4;
  const inward = [(exit + 2) % 4];
  const dir = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];
  const step = dir[inward[0]];
  const side = exit % 2 === 0 ? dir[1] : dir[0];
  const cells = [{ x: 0, y: 0 }];
  if (stair.lengthCells >= 2) cells.push({ x: step[0], y: step[1] });
  const covered = stair.widthCells >= 2
    ? cells.flatMap((cell) => [
        cell,
        { x: cell.x + side[0], y: cell.y + side[1] },
        { x: cell.x - side[0], y: cell.y - side[1] },
      ])
    : cells;
  const originX = stair.x - GRID_SIZE / 2;
  const originY = stair.y - GRID_SIZE / 2;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const cell of covered) {
    x0 = Math.min(x0, originX + cell.x * GRID_SIZE);
    y0 = Math.min(y0, originY + cell.y * GRID_SIZE);
    x1 = Math.max(x1, originX + (cell.x + 1) * GRID_SIZE);
    y1 = Math.max(y1, originY + (cell.y + 1) * GRID_SIZE);
  }
  return { x0, y0, x1, y1 };
}

describe('dungeon dressing', () => {
  it('does not place svg props inside a dungeon', async () => {
    let placed = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const doc = await run({ size: 'small', dungeon: true, exterior: false, dungeonArchetype: 'classic', maxDungeonLayers: 3 }, seed);
      const boxes = doc.props.filter((prop) => prop.kind === 'svg').map(propBox);
      const stairs = doc.stairs.map(stairBox);
      placed += boxes.length;
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j])).toBe(false);
        for (const stair of stairs) expect(overlaps(boxes[i], stair)).toBe(false);
        const box = boxes[i];
        const corners = [
          [box.x0 + 6, box.y0 + 6],
          [box.x1 - 6, box.y0 + 6],
          [box.x0 + 6, box.y1 - 6],
          [box.x1 - 6, box.y1 - 6],
        ];
        for (const [x, y] of corners) {
          const inside = doc.layers.some((layer) => layerEnvironment(layer) === 'interior' && pointInMultiPolygon(x, y, layer.geometry));
          expect(inside).toBe(true);
        }
      }
    }
    expect(placed).toBe(0);
  }, 120000);

  it('still places svg props on the exterior', async () => {
    const doc = await run({ size: 'small', dungeon: false, exterior: true, maxExteriorLayers: 4 }, 4);
    expect(doc.props.filter((prop) => prop.kind === 'svg').length).toBeGreaterThan(0);
  }, 120000);
});
