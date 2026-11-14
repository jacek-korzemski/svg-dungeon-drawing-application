import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { multiPolygonToSvgPath } from '../../../geometry';
import { ConcreteArchetype } from '../model';
import { run } from './helpers';

const enabled = process.env.DUNGEON_GALLERY === '1';

describe.skipIf(!enabled)('dungeon gallery', () => {
  it('writes one preview per archetype', async () => {
    mkdirSync('gallery', { recursive: true });
    const archetypes: ConcreteArchetype[] = ['classic', 'delve', 'hub', 'ring', 'maze', 'cavern'];
    const colors = ['#d9c7a2', '#c9b18a', '#b7a48a', '#8d9a86', '#9aa7b2'];
    for (const archetype of archetypes) {
      for (const size of ['small', 'medium'] as const) {
        const doc = await run({ dungeonArchetype: archetype, size, exterior: false, useTextures: false, maxDungeonLayers: 3 }, 4);
        const parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 6400 5200">', '<rect width="100%" height="100%" fill="#17191d"/>'];
        doc.layers.forEach((layer, index) => {
          parts.push(`<path d="${multiPolygonToSvgPath(layer.geometry)}" fill="${colors[index % colors.length]}" fill-opacity="0.9" stroke="#1b1b1b" stroke-width="3" fill-rule="evenodd"/>`);
        });
        for (const door of doc.doors) parts.push(`<rect x="${door.x - 8}" y="${door.y - 18}" width="16" height="36" fill="#6b3f2a"/>`);
        for (const stair of doc.stairs) parts.push(`<polygon points="${stair.x},${stair.y - 20} ${stair.x + 16},${stair.y + 16} ${stair.x - 16},${stair.y + 16}" fill="#315c86"/>`);
        for (const prop of doc.props) parts.push(`<rect x="${prop.x - prop.widthPx / 2}" y="${prop.y - prop.heightPx / 2}" width="${prop.widthPx}" height="${prop.heightPx}" fill="none" stroke="#d7b15e"/>`);
        for (const label of doc.labels) parts.push(`<text x="${label.x}" y="${label.y}" fill="#fff" font-size="28">${label.badgeNumber ?? ''}</text>`);
        parts.push('</svg>');
        writeFileSync(`gallery/${archetype}-${size}-4.svg`, parts.join(''));
      }
    }
  }, 120000);
});
