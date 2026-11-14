import { describe, expect, it } from 'vitest';
import { debugDungeonDraft } from '../../../randomMapGenerator';
import { countFloorComponents } from '../mix';

describe('mixed archetypes', () => {
  it('builds connected sections for ring, delve and maze', async () => {
    const draft = await debugDungeonDraft(
      {
        size: 'medium',
        dungeonArchetype: 'ring',
        dungeonArchetypes: ['ring', 'delve', 'maze'],
        maxDungeonLayers: 3,
        exterior: false,
      },
      7
    );
    expect(draft.sections.length).toBeGreaterThanOrEqual(2);
    expect(draft.layers.length).toBeGreaterThan(0);
    expect(draft.props).toHaveLength(0);
    expect(countFloorComponents(draft.layers, { x: 0, y: 0, w: 44, h: 34 })).toBe(1);
    const ids = [
      ...draft.layers.map((layer) => layer.id),
      ...draft.doors.map((door) => door.id),
      ...draft.labels.map((label) => label.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  }, 120000);
});
