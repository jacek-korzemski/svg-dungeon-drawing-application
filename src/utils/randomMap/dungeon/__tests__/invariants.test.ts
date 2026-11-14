import { describe, expect, it } from 'vitest';
import { RandomMapConfig, RandomMapSize } from '../../../randomMapGenerator';
import { assertDocumentInvariants, run } from './helpers';

const CASES: { size: RandomMapSize; exterior: boolean; seed: number }[] = [
  { size: 'small', exterior: false, seed: 1 },
  { size: 'small', exterior: true, seed: 7 },
  { size: 'medium', exterior: false, seed: 42 },
  { size: 'medium', exterior: true, seed: 1337 },
  { size: 'large', exterior: false, seed: 11 },
];

describe('document invariants', () => {
  it.each(CASES)('holds for $size exterior=$exterior seed=$seed', async ({ size, exterior, seed }) => {
    const config: RandomMapConfig = {
      dungeon: true,
      exterior,
      maxDungeonLayers: 3,
      maxExteriorLayers: 3,
      useTextures: true,
      size,
      dungeonArchetype: 'auto',
      dungeonArchetypes: [],
    };
    const doc = await run(config, seed);
    expect(() => assertDocumentInvariants(doc, config)).not.toThrow();
  });
});
