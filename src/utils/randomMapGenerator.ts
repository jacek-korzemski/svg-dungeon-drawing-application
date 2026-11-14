import { floorTextureByPath } from '../data/textureLibrary';
import { DoorItem, DungeonDocument, DungeonLayer, MapThemeId, TexturePaint } from '../types/dungeon';
import { GRID_SIZE } from './geometry';
import { pointInMultiPolygon } from './texturePaint';
import { buildByArchetype, resolveArchetype } from './randomMap/dungeon/archetype';
import { buildMix, packSections } from './randomMap/dungeon/mix';
import { buildClassic } from './randomMap/dungeon/classic';
import { delay } from './randomMap/dungeon/grid';
import type { ConcreteArchetype, DungeonArchetype, DungeonDraft, Hooks, RandomMapStage } from './randomMap/dungeon/model';
import { PROFILES } from './randomMap/dungeon/profiles';
import { batchUnion, distToMulti, distToSeg } from './randomMap/dungeon/poly';
import { buildExterior } from './randomMap/exterior';
import { chance, clamp, deriveRng, makeDungeonRngs, mulberry32, pick, randInt, Rng } from './randomMap/rng';
import { IdFactory, Junction, RandomMapLabels, Rect, TextureJob } from './randomMap/types';

export type { RandomMapLabels } from './randomMap/types';
export type { DungeonArchetype, RandomMapStage };

export const DUNGEON_ARCHETYPES: DungeonArchetype[] = ['auto', 'classic', 'delve', 'hub', 'ring', 'maze', 'cavern'];
export const CONCRETE_ARCHETYPES: ConcreteArchetype[] = ['classic', 'delve', 'hub', 'ring', 'maze', 'cavern'];

const G = GRID_SIZE;

export type RandomMapSize = 'small' | 'medium' | 'large' | 'mega';

export interface RandomMapConfig {
  dungeon: boolean;
  exterior: boolean;
  maxDungeonLayers: number;
  maxExteriorLayers: number;
  useTextures: boolean;
  size: RandomMapSize;
  dungeonArchetype: DungeonArchetype;
  /** Two or more entries mix those layouts. Empty defers to dungeonArchetype. */
  dungeonArchetypes: ConcreteArchetype[];
}

export const DEFAULT_RANDOM_MAP_CONFIG: RandomMapConfig = {
  dungeon: true,
  exterior: false,
  maxDungeonLayers: 2,
  maxExteriorLayers: 3,
  useTextures: true,
  size: 'medium',
  dungeonArchetype: 'auto',
  dungeonArchetypes: [],
};

export const RANDOM_MAP_SIZE_CELLS: Record<RandomMapSize, { w: number; h: number }> = {
  small: { w: 28, h: 22 },
  medium: { w: 44, h: 34 },
  large: { w: 68, h: 52 },
  mega: { w: 100, h: 76 },
};

export interface GenerateOptions {
  themeId: MapThemeId;
  labels: RandomMapLabels;
  onProgress: (stage: RandomMapStage, pct: number) => void;
  seed?: number;
}

interface World {
  dungeon: Rect | null;
  exterior: Rect | null;
  junction: Junction | null;
}

function makeId(seed: number): (kind: string) => string {
  const prefix = seed.toString(36);
  const counts = new Map<string, number>();
  return (kind: string) => {
    const n = counts.get(kind) ?? 0;
    counts.set(kind, n + 1);
    return `gen-${prefix}-${kind}-${n}`;
  };
}

function stagePlan(config: RandomMapConfig): { stage: RandomMapStage; end: number }[] {
  const items: { stage: RandomMapStage; w: number }[] = [{ stage: 'layout', w: 5 }];
  if (config.dungeon) {
    items.push(
      { stage: 'rooms', w: 20 },
      { stage: 'layers', w: 10 },
      { stage: 'corridors', w: 25 },
      { stage: 'doors', w: 10 }
    );
  }
  if (config.exterior) items.push({ stage: 'exterior', w: 18 });
  if (config.useTextures) items.push({ stage: 'textures', w: 7 });
  items.push({ stage: 'finish', w: 5 });
  const sum = items.reduce((total, item) => total + item.w, 0);
  let acc = 0;
  return items.map((item, index) => {
    acc += item.w;
    const end = index === items.length - 1 ? 100 : Math.round((acc / sum) * 100);
    return { stage: item.stage, end };
  });
}

function makeWorld(config: RandomMapConfig, rng: Rng): World {
  const base = RANDOM_MAP_SIZE_CELLS[config.size];
  if (config.dungeon && config.exterior) {
    const totalW = Math.round(base.w * 1.6);
    const totalH = base.h;
    const buffer = 4;
    let exteriorW = Math.max(16, Math.round(totalW * 0.55));
    let dungeonW = totalW - buffer - exteriorW;
    if (dungeonW < 16) {
      dungeonW = 16;
      exteriorW = Math.max(16, totalW - buffer - dungeonW);
    }
    const yCell = clamp(randInt(rng, Math.floor(totalH * 0.32), Math.ceil(totalH * 0.68)), 4, totalH - 5);
    if (chance(rng, 0.5)) {
      return {
        exterior: { x: 0, y: 0, w: exteriorW, h: totalH },
        dungeon: { x: exteriorW + buffer, y: 0, w: totalW - exteriorW - buffer, h: totalH },
        junction: {
          xLine: exteriorW,
          yCell,
          point: [exteriorW * G, (yCell + 0.5) * G],
          dungeonSign: 1,
        },
      };
    }
    const dungeonX = 0;
    const exteriorX = dungeonW + buffer;
    return {
      dungeon: { x: dungeonX, y: 0, w: dungeonW, h: totalH },
      exterior: { x: exteriorX, y: 0, w: totalW - exteriorX, h: totalH },
      junction: {
        xLine: exteriorX,
        yCell,
        point: [exteriorX * G, (yCell + 0.5) * G],
        dungeonSign: -1,
      },
    };
  }
  const zone = { x: 0, y: 0, w: base.w, h: base.h };
  return {
    dungeon: config.dungeon ? zone : null,
    exterior: config.exterior ? zone : null,
    junction: null,
  };
}

function applyJobs(layers: DungeonLayer[], jobs: TextureJob[], id: (kind: string) => string) {
  const grouped = new Map<string, TextureJob[]>();
  const ordered = [...jobs].sort((a, b) => a.order - b.order);
  for (const job of ordered) {
    if (!job.region.length || !floorTextureByPath(job.path)) continue;
    const key = `${job.layerId}|${job.order}|${job.path}|${job.softness}`;
    const list = grouped.get(key) ?? [];
    list.push(job);
    grouped.set(key, list);
  }
  const paints = new Map<string, TexturePaint[]>();
  for (const list of grouped.values()) {
    const region = batchUnion(list.map((job) => job.region));
    if (!region.length) continue;
    const paint: TexturePaint = {
      id: id('tp'),
      texturePath: list[0].path,
      softness: list[0].softness,
      kind: 'fill',
      shape: 'bucket',
      dabs: [],
      region,
    };
    const layerPaints = paints.get(list[0].layerId) ?? [];
    layerPaints.push(paint);
    paints.set(list[0].layerId, layerPaints);
  }
  for (const layer of layers) layer.texturePaints = paints.get(layer.id) ?? [];
}

function keepDoors(doors: DoorItem[], layers: DungeonLayer[]): DoorItem[] {
  return doors.filter((door) => {
    for (const layer of layers) {
      if (pointInMultiPolygon(door.x, door.y, layer.geometry) || distToMulti(layer.geometry, door.x, door.y) <= 48) return true;
      for (const road of layer.roads ?? []) {
        if (pointInMultiPolygon(door.x, door.y, road.polygon) || distToMulti(road.polygon, door.x, door.y) <= 48) return true;
      }
      for (const wall of layer.standaloneWalls) {
        for (let i = 0; i < wall.points.length - 1; i++) {
          if (distToSeg(door.x, door.y, wall.points[i], wall.points[i + 1]) <= 48) return true;
        }
      }
    }
    return false;
  });
}

export async function generateRandomMap(config: RandomMapConfig, options: GenerateOptions): Promise<DungeonDocument> {
  const safe = normalizeConfig(config);
  const seed = options.seed ?? ((Math.random() * 4294967296) >>> 0);
  if (import.meta.env.DEV) console.info('[random-map] seed', seed);
  const id = makeId(seed);
  const plan = stagePlan(safe);
  const ends = new Map(plan.map((item) => [item.stage, item.end]));
  let pct = 0;
  const label = async (stage: RandomMapStage) => {
    if (!ends.has(stage)) return;
    options.onProgress(stage, pct);
    await delay();
  };
  const finish = async (stage: RandomMapStage) => {
    const end = ends.get(stage);
    if (end === undefined) return;
    pct = Math.max(pct, end);
    options.onProgress(stage, pct);
    await delay();
  };

  await label('layout');
  const world = makeWorld(safe, { next: mulberry32(seed) });
  await finish('layout');

  let dungeon: DungeonDraft | null = null;
  if (safe.dungeon && world.dungeon) {
    const archetypes = selectedArchetypes(safe, world.dungeon, deriveRng(seed, 'archetype'));
    if (import.meta.env.DEV) console.info('[random-map] archetype', archetypes.join('+'));
    dungeon = await buildDungeonAttempts(
      archetypes,
      world.dungeon,
      world.junction,
      safe.maxDungeonLayers,
      seed,
      id,
      options.labels,
      { label, finish }
    );
    if (!dungeon.layers.length) throw new Error('dungeon generation failed');
  }

  let exterior: ReturnType<typeof buildExterior> | null = null;
  if (safe.exterior && world.exterior) {
    await label('exterior');
    exterior = buildExterior(
      world.exterior,
      world.junction,
      safe.maxExteriorLayers,
      safe.useTextures,
      deriveRng(seed, 'exterior'),
      id,
      options.labels
    );
    await finish('exterior');
  }

  const layers = [...(exterior?.layers ?? []), ...(dungeon?.layers ?? [])];
  const jobs = [...(dungeon?.jobs ?? []), ...(exterior?.jobs ?? [])];
  if (safe.useTextures) {
    await label('textures');
    applyJobs(layers, jobs, id);
    await finish('textures');
  }
  await label('finish');
  if (!layers.length) throw new Error('empty map');
  const titleRng = deriveRng(seed, 'title');
  let titlePool = safe.dungeon && safe.exterior ? options.labels.titlesMixed : safe.dungeon ? options.labels.titlesDungeon : options.labels.titlesExterior;
  if (safe.dungeon && !safe.exterior && dungeon && dungeon.sections.length < 2) {
    const specific = options.labels.titlesByArchetype?.[dungeon.archetype] ?? [];
    if (specific.length && titleRng.next() < 0.7) titlePool = specific;
  }
  const doc: DungeonDocument = {
    title: titlePool.length ? pick(titleRng, titlePool) : 'Mapa',
    gridSize: G,
    feetPerCell: 5,
    themeId: options.themeId,
    showGrid: true,
    layers,
    activeLayerId: dungeon?.layers[0]?.id ?? exterior?.layers[0]?.id ?? layers[0].id,
    doors: [...(exterior?.doors ?? []), ...keepDoors(dungeon?.doors ?? [], dungeon?.layers ?? [])],
    stairs: dungeon?.stairs ?? [],
    props: [...(exterior?.props ?? []), ...(dungeon?.props ?? [])],
    labels: dungeon?.labels ?? [],
  };
  await finish('finish');
  return doc;
}

export async function debugDungeonDraft(config: Partial<RandomMapConfig>, seed: number): Promise<DungeonDraft> {
  const safe = normalizeConfig({ ...DEFAULT_RANDOM_MAP_CONFIG, ...config, dungeon: true, exterior: false });
  const world = makeWorld(safe, { next: mulberry32(seed) });
  if (!world.dungeon) throw new Error('dungeon generation failed');
  const archetypes = selectedArchetypes(safe, world.dungeon, deriveRng(seed, 'archetype'));
  const labels = {
    titlesDungeon: ['Dungeon'],
    titlesExterior: ['Exterior'],
    titlesMixed: ['Mixed'],
    titlesByArchetype: { classic: ['Classic'], delve: ['Delve'], hub: ['Hub'], ring: ['Ring'], maze: ['Maze'], cavern: ['Cavern'] },
    dungeonLayers: { straight: ['Straight'], rock: ['Rock'], brick: ['Brick'], double: ['Double'], ruins: ['Ruins'] },
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
    props: {} as RandomMapLabels['props'],
  };
  const hooks = { label: async () => {}, finish: async () => {} };
  const id = makeId(seed);
  return buildDungeonAttempts(archetypes, world.dungeon, world.junction, safe.maxDungeonLayers, seed, id, labels, hooks);
}

function concreteList(value: unknown): ConcreteArchetype[] {
  if (!Array.isArray(value)) return [];
  const list: ConcreteArchetype[] = [];
  for (const item of value) {
    if (CONCRETE_ARCHETYPES.includes(item as ConcreteArchetype) && !list.includes(item as ConcreteArchetype)) {
      list.push(item as ConcreteArchetype);
    }
  }
  return list;
}

function selectedArchetypes(config: RandomMapConfig, zone: Rect, rng: Rng): ConcreteArchetype[] {
  const list = concreteList(config.dungeonArchetypes);
  if (list.length >= 1) return list;
  if (config.dungeonArchetype !== 'auto') return [config.dungeonArchetype];
  return [resolveArchetype('auto', config.size, zone, rng)];
}

async function buildDungeonAttempts(
  archetypes: ConcreteArchetype[],
  zone: Rect,
  junction: Junction | null,
  maxLayers: number,
  seed: number,
  id: IdFactory,
  labels: RandomMapLabels,
  hooks: Hooks
): Promise<DungeonDraft> {
  let best: DungeonDraft | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let built: DungeonDraft;
    if (archetypes.length >= 2) {
      const packed = packSections(zone, archetypes, junction, deriveRng(seed, `mixpack:${attempt}`));
      if (packed.length >= 2) {
        built = await buildMix(packed, zone, junction, maxLayers, seed, attempt, id, labels, hooks);
      } else {
        const arch = packed[0]?.archetype ?? archetypes[0];
        built = await buildByArchetype(arch, {
          zone,
          junction,
          maxLayers,
          profile: PROFILES[arch],
          rngs: makeDungeonRngs(seed, attempt),
          id,
          labels,
          hooks,
        });
      }
    } else {
      const arch = archetypes[0];
      built = await buildByArchetype(arch, {
        zone,
        junction,
        maxLayers,
        profile: PROFILES[arch],
        rngs: makeDungeonRngs(seed, attempt),
        id,
        labels,
        hooks,
      });
    }
    if (!best || built.score > best.score) best = built;
    if (built.accepted && built.layers.length) break;
  }
  if (!best || best.layers.length === 0) {
    if (import.meta.env.DEV) console.warn('[random-map] fallback to classic from', archetypes.join('+'));
    best = await buildClassic(zone, junction, maxLayers, makeDungeonRngs(seed, 9), id, labels, hooks, PROFILES.classic);
  }
  if (!best) throw new Error('dungeon generation failed');
  return best;
}

function normalizeConfig(config: RandomMapConfig): RandomMapConfig {
  const safe: RandomMapConfig = {
    dungeon: config.dungeon || !config.exterior,
    exterior: config.exterior || !config.dungeon,
    maxDungeonLayers: clamp(Math.round(config.maxDungeonLayers || 1), 1, 4),
    maxExteriorLayers: clamp(Math.round(config.maxExteriorLayers || 1), 1, 8),
    useTextures: config.useTextures,
    size: RANDOM_MAP_SIZE_CELLS[config.size] ? config.size : 'medium',
    dungeonArchetype: DUNGEON_ARCHETYPES.includes(config.dungeonArchetype) ? config.dungeonArchetype : 'auto',
    dungeonArchetypes: concreteList(config.dungeonArchetypes),
  };
  if (!safe.dungeon && !safe.exterior) safe.dungeon = true;
  return safe;
}

