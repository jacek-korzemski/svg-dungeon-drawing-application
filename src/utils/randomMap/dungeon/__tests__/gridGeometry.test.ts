import { describe, expect, it } from 'vitest';
import { GRID_SIZE } from '../../../geometry';
import { mulberry32 } from '../../rng';
import { fixDiagonals, gridToMultiPolygon } from '../gridGeometry';

function areaOf(mp: ReturnType<typeof gridToMultiPolygon>): number {
  const ringArea = (ring: [number, number][]) => {
    let sum = 0;
    for (let i = 0; i < ring.length - 1; i++) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    return sum / 2;
  };
  return mp.reduce((sum, poly) => sum + poly.reduce((inner, ring, index) => inner + (index === 0 ? 1 : -1) * Math.abs(ringArea(ring)), 0), 0);
}

describe('grid geometry', () => {
  it('traces a single cell', () => {
    const floor = new Uint8Array([1]);
    const poly = gridToMultiPolygon(floor, 1, 1, 0, 0);
    expect(poly).toHaveLength(1);
    expect(poly[0]).toHaveLength(1);
    expect(poly[0][0]).toHaveLength(5);
    expect(Math.abs(areaOf(poly) - GRID_SIZE * GRID_SIZE)).toBeLessThan(1);
  });

  it('keeps the center of a ring as a hole', () => {
    const floor = new Uint8Array(9);
    floor.fill(1);
    floor[4] = 0;
    const poly = gridToMultiPolygon(floor, 3, 3, 0, 0);
    expect(poly).toHaveLength(1);
    expect(poly[0].length).toBe(2);
  });

  it('separates disjoint blobs', () => {
    const floor = new Uint8Array(16);
    floor[0] = 1;
    floor[15] = 1;
    const poly = gridToMultiPolygon(floor, 4, 4, 0, 0);
    expect(poly).toHaveLength(2);
  });

  it('keeps the six corners of an L', () => {
    const floor = new Uint8Array([1, 0, 1, 1]);
    const poly = gridToMultiPolygon(floor, 2, 2, 0, 0);
    expect(poly[0][0]).toHaveLength(7);
  });

  it('preserves floor area after diagonal repair', () => {
    const cols = 30;
    const rows = 20;
    const rng = { next: mulberry32(7) };
    const floor = new Uint8Array(cols * rows);
    for (let i = 0; i < floor.length; i++) floor[i] = rng.next() < 0.55 ? 1 : 0;
    fixDiagonals(floor, cols, rows, (index) => {
      const x = index % cols;
      const y = Math.floor(index / cols);
      return x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
    }, rng);
    const count = floor.reduce((sum, value) => sum + value, 0);
    const poly = gridToMultiPolygon(floor, cols, rows, 2, 3);
    expect(Math.abs(areaOf(poly) - count * GRID_SIZE * GRID_SIZE)).toBeLessThan(1);
  });
});
