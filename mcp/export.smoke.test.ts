import { afterAll, expect, it } from 'vitest';
import { createPresetDungeon } from '../src/data/presets';
import { exportDocument, shutdownExportHost } from './exportHost';

afterAll(async () => {
  await shutdownExportHost();
});

it('exports the starter map with layers, doors, labels and a PNG', async () => {
  const doc = createPresetDungeon('starter');
  const result = await exportDocument(doc, { mode: 'flat', quarter: 0, wallHeightCells: 0.85 }, 'both');
  expect(result.svg).toContain('svg-layer-layer-main');
  expect(result.svg).toContain('svg-door-dr-1');
  expect(result.svg).toContain('Wartownia');
  expect(result.svg).toContain('data:font/woff2;base64');
  expect(result.png && result.png.byteLength).toBeGreaterThan(1000);
  expect(result.png?.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
});

it('exports the cavern preset with its label', async () => {
  const doc = createPresetDungeon('caverns');
  const result = await exportDocument(doc, { mode: 'flat', quarter: 0, wallHeightCells: 0.85 }, 'both');
  expect(result.svg).toContain('svg-layer-layer-caves');
  expect(result.svg).toContain('Wejście do Groty');
  expect(result.png && result.png.byteLength).toBeGreaterThan(1000);
});
