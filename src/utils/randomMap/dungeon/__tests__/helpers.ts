import { SVG_PROP_CATALOG } from '../../../../data/presets';
import { DungeonDocument, layerEnvironment, MultiPolygon2D, SvgPropId } from '../../../../types/dungeon';
import { GRID_SIZE } from '../../../geometry';
import {
  DEFAULT_RANDOM_MAP_CONFIG,
  generateRandomMap,
  RANDOM_MAP_SIZE_CELLS,
  RandomMapConfig,
} from '../../../randomMapGenerator';
import { RandomMapLabels } from '../../types';

export function fakeLabels(): RandomMapLabels {
  const props = {} as Record<SvgPropId, string>;
  for (const item of SVG_PROP_CATALOG) props[item.id] = item.id;
  return {
    titlesDungeon: ['Dungeon'],
    titlesExterior: ['Exterior'],
    titlesMixed: ['Mixed'],
    dungeonLayers: {
      straight: ['Straight'],
      rock: ['Rock'],
      brick: ['Brick'],
      double: ['Double'],
      ruins: ['Ruins'],
    },
    exteriorLayers: {
      terrain: ['Terrain'],
      roads: ['Roads'],
      castle_wall: ['Castle'],
      roof_tile: ['Tile'],
      roof_slate: ['Slate'],
      roof_thatch: ['Thatch'],
      walls: ['Walls'],
      ruined_building: ['Ruins'],
    },
    props,
    titlesByArchetype: {
      classic: ['Classic'],
      delve: ['Delve'],
      hub: ['Hub'],
      ring: ['Ring'],
      maze: ['Maze'],
      cavern: ['Cavern'],
    },
  };
}

export function run(config: Partial<RandomMapConfig>, seed: number): Promise<DungeonDocument> {
  return generateRandomMap(
    { ...DEFAULT_RANDOM_MAP_CONFIG, ...config },
    { themeId: 'classic', labels: fakeLabels(), onProgress: () => {}, seed }
  );
}

function roundValue(value: unknown): unknown {
  if (typeof value === 'number') return Math.round(value * 10) / 10;
  if (Array.isArray(value)) return value.map(roundValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) out[key] = roundValue(child);
    return out;
  }
  return value;
}

export function fingerprint(doc: DungeonDocument): string {
  const text = JSON.stringify(roundValue(doc));
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function mapCells(config: Pick<RandomMapConfig, 'size' | 'dungeon' | 'exterior'>): { w: number; h: number } {
  const base = RANDOM_MAP_SIZE_CELLS[config.size];
  if (config.dungeon && config.exterior) return { w: Math.round(base.w * 1.6), h: base.h };
  return { ...base };
}

function ringsOf(doc: DungeonDocument): { layerId: string; ring: [number, number][] }[] {
  const found: { layerId: string; ring: [number, number][] }[] = [];
  const push = (layerId: string, geometry: MultiPolygon2D | undefined) => {
    for (const poly of geometry ?? []) {
      for (const ring of poly) found.push({ layerId, ring });
    }
  };
  for (const layer of doc.layers) {
    push(layer.id, layer.geometry);
    for (const paint of layer.texturePaints) push(layer.id, paint.region);
    for (const road of layer.roads ?? []) push(layer.id, road.polygon);
  }
  return found;
}

export function assertDocumentInvariants(doc: DungeonDocument, config: RandomMapConfig): void {
  if (doc.layers.length < 1) throw new Error('expected at least one layer');
  for (const { layerId, ring } of ringsOf(doc)) {
    if (ring.length < 4) throw new Error(`ring on ${layerId} has ${ring.length} points`);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) throw new Error(`ring on ${layerId} is open`);
  }
  const bounds = mapCells(config);
  const pad = GRID_SIZE;
  for (const layer of doc.layers) {
    if (layerEnvironment(layer) !== 'interior') continue;
    for (const poly of layer.geometry) {
      for (const ring of poly) {
        for (const [x, y] of ring) {
          if (x < -pad || y < -pad || x > bounds.w * GRID_SIZE + pad || y > bounds.h * GRID_SIZE + pad) {
            throw new Error(`dungeon point ${x},${y} is outside ${bounds.w}x${bounds.h}`);
          }
        }
      }
    }
  }
  const ids: string[] = [];
  for (const layer of doc.layers) {
    ids.push(layer.id);
    for (const wall of layer.standaloneWalls) ids.push(wall.id);
    for (const paint of layer.texturePaints) ids.push(paint.id);
    for (const road of layer.roads ?? []) ids.push(road.id);
  }
  for (const door of doc.doors) ids.push(door.id);
  for (const stair of doc.stairs) ids.push(stair.id);
  for (const prop of doc.props) ids.push(prop.id);
  for (const label of doc.labels) ids.push(label.id);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate entity id');
}
