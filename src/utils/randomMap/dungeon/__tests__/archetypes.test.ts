import { describe, expect, it } from 'vitest';
import { ConcreteArchetype } from '../model';
import { buildDungeonDraftForTest } from '../archetype';
import { assertDocumentInvariants, run } from './helpers';
import { RandomMapConfig, RandomMapSize } from '../../../randomMapGenerator';
import { layerEnvironment } from '../../../../types/dungeon';
import { pointInMultiPolygon } from '../../../texturePaint';
import { distToMulti } from '../poly';

const ARCHETYPES: ConcreteArchetype[] = ['classic', 'delve', 'hub', 'ring', 'maze', 'cavern'];
const SIZES: RandomMapSize[] = ['small', 'medium', 'large'];

describe('archetype signatures', () => {
  it('accepts most seeds for every archetype and mode', async () => {
    for (const archetype of ARCHETYPES) {
      for (const size of SIZES) {
        for (const exterior of [false, true]) {
          let accepted = 0;
          for (let seed = 1; seed <= 12; seed++) {
            const config: RandomMapConfig = {
              dungeon: true,
              exterior,
              maxDungeonLayers: 3,
              maxExteriorLayers: 3,
              useTextures: false,
              size,
              dungeonArchetype: archetype,
              dungeonArchetypes: [],
            };
            const draft = await buildDungeonDraftForTest(config, seed);
            const doc = await run(config, seed);
            expect(() => assertDocumentInvariants(doc, config)).not.toThrow();
            if (draft.accepted) accepted += 1;
            const interior = doc.layers.find((layer) => layerEnvironment(layer) === 'interior');
            expect(interior?.id).toBe(doc.activeLayerId);
            for (const stair of doc.stairs) {
              const inside = doc.layers.some(
                (layer) =>
                  layerEnvironment(layer) === 'interior' &&
                  (pointInMultiPolygon(stair.x, stair.y, layer.geometry) || distToMulti(layer.geometry, stair.x, stair.y) <= 8)
              );
              expect(inside, `${archetype} ${size} exterior=${exterior} seed=${seed}`).toBe(true);
            }
          }
          expect(accepted / 12, `${archetype} ${size} exterior=${exterior} accepted ${accepted}/12`).toBeGreaterThanOrEqual(0.85);
        }
      }
    }
  }, 600000);

  it('keeps the archetypes measurably different', async () => {
    const means: Record<string, { diameter: number; rooms: number; degree: number; cycles: number; corridor: number; vertices: number }> = {};
    for (const archetype of ARCHETYPES) {
      let diameter = 0;
      let rooms = 0;
      let degree = 0;
      let cycles = 0;
      let corridor = 0;
      let vertices = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const draft = await buildDungeonDraftForTest({ dungeonArchetype: archetype, size: 'medium', exterior: false, maxDungeonLayers: 3 }, seed);
        const doc = await run({ dungeonArchetype: archetype, size: 'medium', exterior: false, maxDungeonLayers: 3, useTextures: false }, seed);
        diameter += draft.metrics.rooms ? draft.metrics.diameter / draft.metrics.rooms : 0;
        rooms += draft.metrics.rooms;
        degree += draft.metrics.maxDegree;
        cycles += draft.metrics.cycles;
        corridor += draft.metrics.floorCells ? draft.metrics.corridorCells / draft.metrics.floorCells : 0;
        const layer = doc.layers.find((item) => layerEnvironment(item) === 'interior');
        const count = layer?.geometry.reduce((sum, poly) => sum + poly.reduce((rings, ring) => rings + ring.length, 0), 0) ?? 0;
        const rings = layer?.geometry.reduce((sum, poly) => sum + poly.length, 0) ?? 1;
        vertices += count / Math.max(1, rings);
      }
      means[archetype] = { diameter: diameter / 10, rooms: rooms / 10, degree: degree / 10, cycles: cycles / 10, corridor: corridor / 10, vertices: vertices / 10 };
    }
    expect(means.delve.diameter).toBeGreaterThanOrEqual(means.classic.diameter + 0.15);
    expect(means.hub.degree).toBeGreaterThanOrEqual(means.classic.degree + 1.5);
    expect(means.ring.cycles).toBeGreaterThanOrEqual(1);
    expect(means.maze.corridor).toBeGreaterThanOrEqual(0.5);
    expect(means.cavern.vertices).toBeGreaterThanOrEqual(means.classic.vertices * 3);
  }, 300000);

  it('stays responsive on mega maps', async () => {
    for (const archetype of ['maze', 'cavern'] as const) {
      const started = performance.now();
      await buildDungeonDraftForTest({ dungeonArchetype: archetype, size: 'mega', exterior: false, maxDungeonLayers: 2 }, 3);
      const elapsed = performance.now() - started;
      console.info(`[random-map] mega ${archetype} ${Math.round(elapsed)}ms`);
      expect(elapsed).toBeLessThan(10000);
    }
  }, 30000);
});
