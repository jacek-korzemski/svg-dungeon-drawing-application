import { weightedPick, Rng } from '../rng';
import { IdFactory, Junction, RandomMapLabels, Rect } from '../types';
import { buildClassic } from './classic';
import { buildCavern } from './cavern';
import { buildMaze } from './maze';
import { planDelve } from './layouts/delve';
import { planHub } from './layouts/hub';
import { planRing } from './layouts/ring';
import { realizeRoomGraph } from './realizeGraph';

export async function buildDungeonDraftForTest(config: Partial<import('../../randomMapGenerator').RandomMapConfig>, seed: number) {
  const generator = await import('../../randomMapGenerator');
  return generator.debugDungeonDraft(config, seed);
}
import { coarseFeasible } from './layouts/coarseGrid';
import { acceptLayout, blankMetrics } from './metrics';
import { ConcreteArchetype, DungeonArchetype, DungeonDraft, DungeonRngs, Hooks } from './model';
import { DungeonProfile, PROFILES } from './profiles';

const AUTO_WEIGHTS: Record<'small' | 'medium' | 'large' | 'mega', Record<ConcreteArchetype, number>> = {
  small: { classic: 3, delve: 3, hub: 1, ring: 1, maze: 2, cavern: 3 },
  medium: { classic: 2, delve: 2, hub: 2, ring: 2, maze: 1.5, cavern: 2 },
  large: { classic: 1.5, delve: 1.5, hub: 2, ring: 2, maze: 1.5, cavern: 2 },
  mega: { classic: 1.5, delve: 1.5, hub: 2, ring: 2, maze: 1.5, cavern: 2 },
};

export interface BuildContext {
  zone: Rect;
  junction: Junction | null;
  maxLayers: number;
  profile: DungeonProfile;
  rngs: DungeonRngs;
  id: IdFactory;
  labels: RandomMapLabels;
  hooks: Hooks;
}

export function resolveArchetype(
  choice: DungeonArchetype,
  size: 'small' | 'medium' | 'large' | 'mega',
  zone: Rect,
  rng: Rng
): ConcreteArchetype {
  if (choice !== 'auto') return choice;
  const items = (Object.keys(AUTO_WEIGHTS[size]) as ConcreteArchetype[])
    .filter((archetype) => coarseFeasible(archetype, zone))
    .map((archetype) => ({ value: archetype, weight: AUTO_WEIGHTS[size][archetype] }));
  if (!items.length) return 'classic';
  return weightedPick(rng, items);
}

export function failedDraft(archetype: ConcreteArchetype, target = 0): DungeonDraft {
  const metrics = blankMetrics(target);
  return {
    layers: [],
    doors: [],
    stairs: [],
    jobs: [],
    props: [],
    labels: [],
    walls: [],
    alive: 0,
    target,
    archetype,
    sections: [archetype],
    metrics,
    accepted: false,
    score: acceptLayout(archetype, metrics).score,
  };
}

export async function buildByArchetype(archetype: ConcreteArchetype, ctx: BuildContext): Promise<DungeonDraft> {
  try {
    const profile = ctx.profile.archetype === archetype ? ctx.profile : PROFILES[archetype];
    const scoped = { ...ctx, profile };
    if (archetype === 'cavern') return await buildCavern(scoped);
    if (archetype === 'maze') return await buildMaze(scoped);
    if (archetype === 'delve' || archetype === 'hub' || archetype === 'ring') {
      const input = {
        zone: ctx.zone,
        junction: ctx.junction,
        maxLayers: ctx.maxLayers,
        profile,
        rng: ctx.rngs.layout,
        large: ctx.zone.w * ctx.zone.h >= 68 * 52,
      };
      const plan = archetype === 'delve' ? planDelve(input) : archetype === 'hub' ? planHub(input) : planRing(input);
      return await realizeRoomGraph(plan, scoped);
    }
    return await buildClassic(ctx.zone, ctx.junction, ctx.maxLayers, ctx.rngs, ctx.id, ctx.labels, ctx.hooks, profile);
  } catch (error) {
    if (import.meta.env.DEV) console.warn('[random-map] builder failed', archetype, error);
    return failedDraft(archetype);
  }
}
