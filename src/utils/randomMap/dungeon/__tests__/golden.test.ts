import { describe, expect, it } from 'vitest';
import { RandomMapConfig, RandomMapSize } from '../../../randomMapGenerator';
import { fingerprint, run } from './helpers';

const SEEDS = [1, 7, 42, 1337, 20261114];

const CASES: { key: string; size: RandomMapSize; exterior: boolean }[] = [
  { key: 'small-dungeon', size: 'small', exterior: false },
  { key: 'small-mixed', size: 'small', exterior: true },
  { key: 'medium-dungeon', size: 'medium', exterior: false },
  { key: 'medium-mixed', size: 'medium', exterior: true },
];

function configFor(item: (typeof CASES)[number]): Partial<RandomMapConfig> {
  return { size: item.size, dungeon: true, exterior: item.exterior, maxDungeonLayers: 3 };
}

export const GOLDEN: Record<string, string> = {
  'small-dungeon:1': '856ca42e',
  'small-dungeon:7': 'bed537f9',
  'small-dungeon:42': '06c00256',
  'small-dungeon:1337': '90d94899',
  'small-dungeon:20261114': 'fb9d038a',
  'small-mixed:1': 'cd3e467a',
  'small-mixed:7': '9bb483c3',
  'small-mixed:42': '29798e1b',
  'small-mixed:1337': '19ffe275',
  'small-mixed:20261114': 'b61ca4e9',
  'medium-dungeon:1': 'ed1699b1',
  'medium-dungeon:7': 'bd5f8fe8',
  'medium-dungeon:42': '2f3bc8f4',
  'medium-dungeon:1337': '83aba527',
  'medium-dungeon:20261114': '5e71e59e',
  'medium-mixed:1': '8d59738a',
  'medium-mixed:7': '825a3688',
  'medium-mixed:42': '9ee07060',
  'medium-mixed:1337': '86719458',
  'medium-mixed:20261114': '53ac5b9c',
};

describe('golden seeds', () => {
  it('matches the frozen fingerprints', async () => {
    const found: Record<string, string> = {};
    for (const item of CASES) {
      for (const seed of SEEDS) {
        const doc = await run(configFor(item), seed);
        found[`${item.key}:${seed}`] = fingerprint(doc);
      }
    }
    if (process.env.DUMP_GOLDEN === '1') console.info(JSON.stringify(found, null, 2));
    expect(found).toEqual(GOLDEN);
  }, 120000);

  it('is deterministic for every archetype', async () => {
    for (const dungeonArchetype of ['classic', 'delve', 'hub', 'ring', 'maze', 'cavern'] as const) {
      const first = fingerprint(await run({ size: 'small', dungeonArchetype, exterior: false }, 5));
      const second = fingerprint(await run({ size: 'small', dungeonArchetype, exterior: false }, 5));
      expect(second).toBe(first);
    }
  }, 120000);
});
