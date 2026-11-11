import { createEmptyLayer } from '../../../data/presets';
import { BuildingStyle, DungeonLayer } from '../../../types/dungeon';
import { zonePolygon } from '../curves';
import { createNoise1D, createNoise2D } from '../noise';
import { clamp, pickFresh, randInt, Rng } from '../rng';
import { IdFactory, Junction, RandomMapLabels, Rect } from '../types';
import { emptySites, ExteriorCtx } from './context';
import { ExteriorGrid } from './grid';
import { buildWater } from './hydrology';
import { reserveJunction, rollPlan } from './plan';
import { scatterProps } from './props';
import { buildRoads, paveUrban } from './roads';
import { buildSettlement } from './settlement';
import { buildTerrain, seedBogs } from './terrain';
import { buildTownWalls, placeCastle } from './walls';

const PRIORITY: BuildingStyle[] = ['roof_tile', 'roof_thatch', 'castle_wall', 'roof_slate', 'ruined_building'];
const RENDER: BuildingStyle[] = ['castle_wall', 'roof_tile', 'roof_slate', 'roof_thatch', 'ruined_building'];

export function buildExterior(
  zone: Rect,
  junction: Junction | null,
  maxLayers: number,
  useTextures: boolean,
  rng: Rng,
  id: IdFactory,
  labels: RandomMapLabels
) {
  const G = 64;
  const ctx: ExteriorCtx = {
    zone,
    G,
    rng,
    id,
    labels,
    useTextures,
    maxLayers,
    grid: new ExteriorGrid(zone, G),
    plan: null as unknown as ExteriorCtx['plan'],
    jobs: [],
    doors: [],
    walls: [],
    buildings: new Map(),
    placed: [],
    props: [],
    water: null,
    roads: [],
    fallbackRoads: [],
    sites: emptySites(),
    zonePoly: zonePolygon(zone.x * G, zone.y * G, zone.w * G, zone.h * G),
    noise1: createNoise1D(rng),
    noise2: createNoise2D(rng),
    castle: null,
    insideWall: null,
    layers: [],
    terrainId: id('terrain'),
  };
  ctx.plan = rollPlan({ zone, G, rng, useTextures }, junction);
  reserveJunction(ctx);
  if (useTextures) buildWater(ctx);
  seedBogs(ctx);
  placeCastle(ctx);
  buildRoads(ctx);
  buildTownWalls(ctx);
  paveUrban(ctx);
  buildSettlement(ctx);
  if (useTextures) buildTerrain(ctx);
  scatterProps(ctx);
  if (ctx.water && useTextures) {
    const paint = (key: 'bars' | 'shallow' | 'deep', order: number, softness: number, path: string) => {
      const region = ctx.water?.[key] ?? [];
      if (!region.length || !path) return;
      ctx.jobs.push({ layerId: ctx.terrainId, path, softness, region, order });
    };
    paint('bars', 50, 0.35, ctx.plan.palette.bar);
    paint('shallow', 51, 0.25, ctx.plan.palette.shallow);
    paint('deep', 52, 0.12, ctx.plan.palette.deep);
  }
  return assemble(ctx);
}

function assemble(ctx: ExteriorCtx) {
  const used = new Set<string>();
  const budget = randInt(ctx.rng, Math.max(1, ctx.maxLayers - 2), clamp(Math.round(ctx.maxLayers), 1, 8));
  let slots = budget - 1;
  let separateWalls = false;
  let separateRoads = false;
  if (slots > PRIORITY.length) {
    separateWalls = true;
    slots -= 1;
  }
  if (!ctx.useTextures && slots > PRIORITY.length) {
    separateRoads = true;
    slots -= 1;
  }
  const kept = new Set(PRIORITY.slice(0, Math.max(0, slots)));
  const own = slots > 0 ? RENDER.filter((style) => kept.has(style)) : [];
  const terrainStyles: BuildingStyle[] = slots > 0 ? [] : ['roof_tile'];
  const layers: DungeonLayer[] = [];
  const add = (
    key: keyof RandomMapLabels['exteriorLayers'],
    style: BuildingStyle,
    geometry: DungeonLayer['geometry'],
    roads: DungeonLayer['roads'],
    walls: DungeonLayer['standaloneWalls'],
    fixedId?: string
  ) => {
    const has = geometry.length > 0 || (roads?.length ?? 0) > 0 || walls.length > 0 || key === 'terrain';
    if (!has) return null;
    const layer = createEmptyLayer(fixedId ?? `gen-ext-${layers.length}`, pickFresh(ctx.rng, ctx.labels.exteriorLayers[key] ?? [key], used), 'exterior');
    layer.buildingStyle = style;
    layer.geometry = geometry;
    layer.roads = roads ?? [];
    layer.standaloneWalls = walls;
    layer.hatchEnabled = true;
    layers.push(layer);
    return layer;
  };
  const terrainGeometry = terrainStyles.flatMap((style) => ctx.buildings.get(style) ?? []);
  add('terrain', terrainStyles[0] ?? 'roof_tile', terrainGeometry, separateRoads ? [] : ctx.fallbackRoads, separateWalls ? [] : ctx.walls, ctx.terrainId);
  if (separateRoads && ctx.fallbackRoads.length) add('roads', 'roof_tile', [], ctx.fallbackRoads, []);
  for (const style of own) {
    const geometry = ctx.buildings.get(style) ?? [];
    if (!geometry.length) continue;
    const key: keyof RandomMapLabels['exteriorLayers'] =
      style === 'castle_wall' || style === 'ruined_building' || style === 'roof_slate' || style === 'roof_thatch' || style === 'roof_tile'
        ? style
        : 'roof_tile';
    add(key, style, geometry, [], []);
  }
  if (separateWalls && ctx.walls.length) add('walls', 'roof_tile', [], [], ctx.walls);
  for (const job of ctx.jobs) {
    if (!job.layerId) job.layerId = ctx.terrainId;
  }
  return { layers, doors: ctx.doors, jobs: ctx.jobs, props: ctx.props };
}
