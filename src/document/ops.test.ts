import { describe, expect, it } from 'vitest';
import type { DungeonDocument } from '../types/dungeon';
import { GRID_SIZE } from '../utils/geometry';
import {
  addDoors,
  addRooms,
  buildMap,
  DocumentOpError,
  listCatalog,
  parseDocument,
  setMapMeta,
  summarizeMap,
  type IdFactory,
} from './ops';

function sequentialIds(): IdFactory {
  const counts = new Map<string, number>();
  return (kind) => {
    const next = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, next);
    return `${kind}-${next}`;
  };
}

describe('buildMap', () => {
  it('joins touching rooms, a corridor, a door, a label and a floor texture', () => {
    const { doc, summary } = buildMap(
      {
        title: 'Krypta',
        themeId: 'parchment',
        rooms: [
          { id: 'hall', x: 0, y: 0, w: 6, h: 4, name: 'Sala', number: '1', floorTexture: 'kamien.png' },
          { id: 'vault', x: 6, y: 0, w: 4, h: 4, name: 'Skarbiec', number: '2' },
          { id: 'cell', x: 0, y: 4, w: 4, h: 4, name: 'Cela' },
        ],
        corridors: [{ from: 'hall', to: 'vault', widthCells: 1 }],
        doors: [
          { between: ['hall', 'vault'], type: 'standard' },
          { between: ['hall', 'cell'], type: 'secret' },
        ],
        stairs: [{ x: 1, y: 1, type: 'straight' }],
        props: [{ propId: 'barrel', x: 2, y: 2 }],
      },
      { ids: sequentialIds(), knownTextures: ['kamien.png', 'trawa.png'] }
    );

    expect(doc.title).toBe('Krypta');
    expect(doc.themeId).toBe('parchment');
    expect(doc.gridSize).toBe(GRID_SIZE);
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0].geometry.length).toBeGreaterThan(0);
    expect(doc.layers[0].texturePaints).toEqual([
      expect.objectContaining({
        texturePath: 'kamien.png',
        kind: 'fill',
        shape: 'bucket',
      }),
    ]);

    const sharedDoor = doc.doors.find((door) => door.id === 'dr-1');
    expect(sharedDoor).toMatchObject({
      x: 6 * GRID_SIZE,
      y: 2 * GRID_SIZE,
      rotation: 90,
      type: 'standard',
      widthCells: 1,
    });
    const lowerDoor = doc.doors.find((door) => door.id === 'dr-2');
    expect(lowerDoor).toMatchObject({
      x: 2 * GRID_SIZE,
      y: 4 * GRID_SIZE,
      rotation: 0,
      type: 'secret',
    });

    expect(doc.labels.map((label) => label.badgeNumber)).toEqual(['1', '2', undefined]);
    expect(doc.labels[0]).toMatchObject({
      text: 'Sala',
      x: 3 * GRID_SIZE,
      y: 2 * GRID_SIZE,
      fontSize: 26,
    });
    expect(doc.stairs[0]).toMatchObject({ widthCells: 1, lengthCells: 2, x: GRID_SIZE, y: GRID_SIZE });
    expect(doc.props[0]).toMatchObject({
      svgPropId: 'barrel',
      label: 'Beczka',
      kind: 'svg',
      artwork: 'plane',
      x: 2 * GRID_SIZE,
      y: 2 * GRID_SIZE,
    });
    expect(summary.warnings).toEqual([]);
    expect(summary.doors[0].between).toEqual(['hall', 'vault']);

    const restored = parseDocument(JSON.parse(JSON.stringify(doc)) as DungeonDocument);
    expect(summarizeMap(restored).rooms.map((room) => room.id)).toEqual(['hall', 'vault', 'cell']);
    expect(restored.layers[0].id).toBe('layer-main');
  });

  it('puts a door on the corridor when rooms do not touch and warns about overlaps', () => {
    const { doc, summary } = buildMap(
      {
        title: 'Rozdzielone',
        rooms: [
          { id: 'a', x: 0, y: 0, w: 4, h: 4 },
          { id: 'b', x: 10, y: 0, w: 4, h: 4 },
          { id: 'overlap', x: 2, y: 0, w: 4, h: 4 },
        ],
        corridors: [{ from: 'a', to: 'b', widthCells: 1 }],
        doors: [{ between: ['a', 'b'] }],
      },
      { ids: sequentialIds() }
    );

    expect(doc.doors[0]).toMatchObject({
      x: 7 * GRID_SIZE,
      y: 2 * GRID_SIZE,
      rotation: 0,
    });
    expect(summary.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['rooms-overlap', 'door-on-corridor'])
    );
  });

  it('rejects an unknown door type before writing geometry', () => {
    expect(() =>
      buildMap({
        title: 'Zła',
        rooms: [{ id: 'a', x: 0, y: 0, w: 2, h: 2 }],
        doors: [{ x: 1, y: 1, type: 'portal' as 'standard' }],
      })
    ).toThrow(DocumentOpError);
  });
});

describe('partial edits', () => {
  it('appends a room and can rename the map', () => {
    const first = buildMap({ title: 'Start', rooms: [{ id: 'a', x: 0, y: 0, w: 3, h: 3, name: 'A' }] }, { ids: sequentialIds() });
    const added = addRooms(first.doc, [{ id: 'b', x: 3, y: 0, w: 3, h: 3, name: 'B' }], { ids: sequentialIds() });
    expect(added.summary.rooms.map((room) => room.id)).toEqual(['a', 'b']);
    expect(added.doc.labels).toHaveLength(2);
    const renamed = setMapMeta(added.doc, { title: 'Dalej', themeId: 'dark_vtt' });
    expect(renamed.doc.title).toBe('Dalej');
    expect(renamed.doc.themeId).toBe('dark_vtt');
  });

  it('adds a door between rooms that were created earlier', () => {
    const first = buildMap(
      {
        title: 'Start',
        rooms: [
          { id: 'a', x: 0, y: 0, w: 4, h: 4 },
          { id: 'b', x: 8, y: 0, w: 4, h: 4 },
        ],
        corridors: [{ from: 'a', to: 'b' }],
      },
      { ids: sequentialIds() }
    );
    const withDoor = addDoors(first.doc, [{ between: ['b', 'a'], type: 'portcullis' }], { ids: sequentialIds() });
    expect(withDoor.doc.doors[0].type).toBe('portcullis');
    expect(withDoor.summary.warnings.some((warning) => warning.code === 'door-on-corridor')).toBe(true);
  });
});

describe('listCatalog', () => {
  it('lists themes, doors and props the agent can use', () => {
    const catalog = listCatalog(['trawa.png']);
    expect(catalog.themes).toContain('classic');
    expect(catalog.doorTypes).toContain('standard');
    expect(catalog.props.some((prop) => prop.id === 'barrel' && prop.label === 'Beczka')).toBe(true);
    expect(catalog.textures).toEqual(['trawa.png']);
  });
});
