import { describe, expect, it } from 'vitest';
import { deriveRng } from '../../rng';
import { ConcreteArchetype } from '../model';
import { packSections, sectionFits } from '../mix';
import { Rect } from '../../types';

const ALL: ConcreteArchetype[] = ['classic', 'delve', 'hub', 'ring', 'maze', 'cavern'];

function area(rect: Rect): number {
  return rect.w * rect.h;
}

function assertTiling(zone: Rect, packed: ReturnType<typeof packSections>) {
  expect(packed.length).toBeGreaterThan(0);
  let covered = 0;
  for (let i = 0; i < packed.length; i++) {
    const rect = packed[i].rect;
    expect(sectionFits(packed[i].archetype, rect)).toBe(true);
    expect(rect.x).toBeGreaterThanOrEqual(zone.x);
    expect(rect.y).toBeGreaterThanOrEqual(zone.y);
    expect(rect.x + rect.w).toBeLessThanOrEqual(zone.x + zone.w);
    expect(rect.y + rect.h).toBeLessThanOrEqual(zone.y + zone.h);
    covered += area(rect);
    for (let j = i + 1; j < packed.length; j++) {
      const other = packed[j].rect;
      const w = Math.min(rect.x + rect.w, other.x + other.w) - Math.max(rect.x, other.x);
      const h = Math.min(rect.y + rect.h, other.y + other.h) - Math.max(rect.y, other.y);
      expect(w > 0 && h > 0).toBe(false);
    }
  }
  expect(covered).toBe(area(zone));
}

describe('section packer', () => {
  it('tiles the zone with archetypes that fit', () => {
    const zone = { x: 0, y: 0, w: 68, h: 52 };
    const packed = packSections(zone, ['ring', 'delve', 'maze'], null, deriveRng(4, 'pack'));
    assertTiling(zone, packed);
    expect(packed.length).toBeGreaterThanOrEqual(2);
  });

  it('drops archetypes that cannot fit a small map', () => {
    const zone = { x: 0, y: 0, w: 28, h: 22 };
    for (let seed = 1; seed <= 8; seed++) {
      const packed = packSections(zone, ALL, null, deriveRng(seed, 'pack'));
      assertTiling(zone, packed);
      expect(packed.length).toBeLessThan(ALL.length);
    }
  });

  it('is deterministic for the same seed', () => {
    const zone = { x: 2, y: 0, w: 44, h: 34 };
    const first = packSections(zone, ['ring', 'delve', 'maze', 'cavern'], null, deriveRng(11, 'pack'));
    const second = packSections(zone, ['ring', 'delve', 'maze', 'cavern'], null, deriveRng(11, 'pack'));
    expect(second).toEqual(first);
  });

  it('puts the exterior gate on the dungeon edge', () => {
    const zone = { x: 10, y: 0, w: 68, h: 52 };
    const junction = { point: [10 * 64, 20 * 64] as [number, number], xLine: 10, yCell: 20, dungeonSign: 1 as const };
    const packed = packSections(zone, ['ring', 'delve', 'maze'], junction, deriveRng(6, 'pack'));
    assertTiling(zone, packed);
    const gate = packed.find((section) => section.gate);
    expect(gate).toBeTruthy();
    expect(gate?.rect.x).toBe(zone.x);
    if (packed.length >= 2) expect(gate?.rect.h).toBe(zone.h);
  });
});
