import { describe, expect, it } from 'vitest';
import type { DungeonDocument } from '../../types/dungeon';
import { snapToGrid } from '../geometry';
import { scaleDocument } from '../scaleDocument';

function sampleDocument(): DungeonDocument {
  return {
    title: 'Scale',
    gridSize: 64,
    feetPerCell: 5,
    themeId: 'classic',
    showGrid: true,
    activeLayerId: 'layer',
    layers: [
      {
        id: 'layer',
        name: 'Layer',
        visible: true,
        locked: false,
        opacity: 1,
        wallStyle: 'straight',
        hatchEnabled: false,
        geometry: [
          [
            [
              [0, 0],
              [64, 0],
              [64, 64],
              [0, 0],
            ],
          ],
        ],
        standaloneWalls: [
          { id: 'wall', points: [[0, 0], [128, 0]], wallStyle: 'straight', thickness: 12 },
        ],
        texturePaints: [
          {
            id: 'paint',
            texturePath: 'trawa.png',
            softness: 0,
            kind: 'dabs',
            shape: 'round',
            dabs: [{ x: 32, y: 32, r: 8 }],
            region: [],
          },
        ],
        roads: [
          {
            id: 'road',
            points: [[0, 0], [64, 0]],
            width: 20,
            style: 'dirt',
            polygon: [],
          },
        ],
      },
    ],
    doors: [{ id: 'door', x: 128, y: 64, rotation: 90, type: 'standard', widthCells: 1 }],
    stairs: [],
    props: [
      {
        id: 'jug',
        x: 32,
        y: 32,
        rotation: 0,
        scale: 0.5,
        kind: 'png',
        label: 'jug',
        widthPx: 80,
        heightPx: 80,
      },
    ],
    labels: [{ id: 'label', x: 10, y: 20, text: 'A', fontSize: 13, rotation: 0 }],
  };
}

describe('snapToGrid', () => {
  it('snaps to a full cell, a half, a quarter, and a third', () => {
    expect(snapToGrid(70, 64, 1)).toBe(64);
    expect(snapToGrid(100, 64, 1)).toBe(128);
    expect(snapToGrid(40, 64, 2)).toBe(32);
    expect(snapToGrid(50, 64, 2)).toBe(64);
    expect(snapToGrid(20, 64, 4)).toBe(16);
    expect(snapToGrid(10, 64, 3)).toBe(0);
    expect(snapToGrid(21.4, 64, 3)).toBe(21.333);
    expect(snapToGrid(42.6, 64, 3)).toBe(42.667);
    expect(snapToGrid(64, 64, 3)).toBe(64);
  });

  it('leaves the value alone when snap is off', () => {
    expect(snapToGrid(21.4, 64, 0)).toBe(21.4);
  });
});

describe('scaleDocument', () => {
  it('keeps cell counts while the pixel size changes', () => {
    const original = sampleDocument();
    const next = scaleDocument(original, 0.5, 32);

    expect(next.gridSize).toBe(32);
    expect(next.layers[0].geometry[0][0][1]).toEqual([32, 0]);
    expect(next.layers[0].standaloneWalls[0].thickness).toBe(6);
    expect(next.layers[0].texturePaints[0].dabs[0]).toEqual({ x: 16, y: 16, r: 4 });
    expect(next.layers[0].roads?.[0].width).toBe(10);
    expect(next.doors[0]).toMatchObject({ x: 64, y: 32, widthCells: 1, rotation: 90 });
    expect(next.props[0]).toMatchObject({ x: 16, y: 16, scale: 0.25, widthPx: 80 });
    expect(next.labels[0].fontSize).toBe(6.5);
    expect(original.doors[0].x).toBe(128);
    expect(original.gridSize).toBe(64);
  });
});
