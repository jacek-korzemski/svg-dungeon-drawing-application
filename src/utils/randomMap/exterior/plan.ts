import { floorTextureByPath } from '../../../data/textureLibrary';
import { Point2D, Polygon2D } from '../../../types/dungeon';
import { disk } from '../curves';
import { chance, clamp, jitter, randInt, range, Rng, weightedPick } from '../rng';
import { Archetype, Biome, BiomePalette, ExteriorPlan, Rect, RoadEntry, WallMode } from '../types';
import { F } from './grid';
import { ExteriorCtx } from './context';

function tex(name: string, fallback: string): string {
  const file = `${name}.png`;
  const fb = `${fallback}.png`;
  if (floorTextureByPath(file)) return file;
  return floorTextureByPath(fb) ? fb : fb;
}

function paletteFor(biome: Biome, rng: Rng): BiomePalette {
  const temperate: BiomePalette = {
    base: tex('trawa', 'trawa'),
    patches: [tex('trawa-łąka', 'trawa'), tex('trawa-krótka', 'trawa'), tex('trawa-łachy', 'trawa')],
    field: [tex('uprawa', 'trawa'), tex('siano', 'trawa')],
    fallow: tex('trawa-krótka', 'trawa'),
    yard: tex('ziemia', 'trawa'),
    bar: tex('piasek', 'ziemia'),
    shallow: tex('woda-płytka', 'woda'),
    deep: tex('woda', 'woda'),
    frozen: false,
    rock: tex('skała-omszona', 'skała'),
    urban: [tex('bruk', 'droga'), tex('kostka', 'bruk')],
    track: tex('droga', 'ziemia'),
    path: [tex('ziemia', 'droga'), tex('żwir', 'ziemia')],
    litter: tex('liście', 'trawa'),
    bog: [tex('bagno', 'błoto'), tex('błoto', 'ziemia')],
  };
  if (biome === 'autumn') return { ...temperate, patches: [tex('liście', 'trawa'), tex('trawa-łachy', 'trawa'), tex('liście', 'trawa')] };
  if (biome === 'winter') {
    const frozen = chance(rng, 0.6);
    return {
      ...temperate,
      base: tex('śnieg', 'trawa'),
      patches: [tex('trawa-łachy', 'śnieg')],
      field: [],
      bar: tex('śnieg', 'piasek'),
      deep: frozen ? tex('lód', 'woda') : tex('woda', 'woda'),
      shallow: frozen ? tex('lód', 'woda-płytka') : tex('woda-płytka', 'woda'),
      frozen,
      rock: tex('skała', 'skała'),
    };
  }
  if (biome === 'wetland') {
    return {
      ...temperate,
      base: tex('trawa-łąka', 'trawa'),
      patches: [tex('bagno', 'błoto'), tex('błoto', 'ziemia'), tex('trawa', 'trawa')],
      bar: tex('błoto', 'piasek'),
    };
  }
  if (biome === 'dry') {
    return {
      ...temperate,
      base: tex('trawa-krótka', 'trawa'),
      patches: [tex('piasek', 'ziemia'), tex('spękana-ziemia', 'ziemia'), tex('ziemia', 'trawa')],
      field: [tex('siano', 'trawa')],
    };
  }
  return temperate;
}

function edgePoint(zone: Rect, G: number, edge: RoadEntry['edge'], t: number): Point2D {
  const x0 = zone.x * G;
  const y0 = zone.y * G;
  const x1 = (zone.x + zone.w) * G;
  const y1 = (zone.y + zone.h) * G;
  const u = clamp(t, 0.08, 0.92);
  if (edge === 'n') return [x0 + (x1 - x0) * u, y0];
  if (edge === 's') return [x0 + (x1 - x0) * u, y1];
  if (edge === 'w') return [x0, y0 + (y1 - y0) * u];
  return [x1, y0 + (y1 - y0) * u];
}

function perimeterAt(zone: Rect, G: number, edge: RoadEntry['edge'], point: Point2D): number {
  const width = zone.w * G;
  const height = zone.h * G;
  const x = point[0] - zone.x * G;
  const y = point[1] - zone.y * G;
  if (edge === 'n') return x;
  if (edge === 'e') return width + y;
  if (edge === 's') return width + height + (width - x);
  return width * 2 + height + (height - y);
}

function perimeterGap(a: number, b: number, total: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, total - d);
}

export function rollPlan(
  input: { zone: Rect; G: number; rng: Rng; useTextures: boolean },
  junction: ExteriorPlan['junction']
): ExteriorPlan {
  const { zone, G, rng, useTextures } = input;
  const biome = weightedPick<Biome>(rng, [
    { value: 'temperate', weight: 58 },
    { value: 'autumn', weight: 12 },
    { value: 'winter', weight: 12 },
    { value: 'wetland', weight: 10 },
    { value: 'dry', weight: 8 },
  ]);
  const palette = paletteFor(biome, rng);
  let riverP = biome === 'dry' ? 0.45 : biome === 'wetland' ? 0.95 : 0.82;
  if (!useTextures || !floorTextureByPath('woda.png')) riverP = 0;
  const hasRiver = chance(rng, riverP);
  const blockedEdge: ExteriorPlan['blockedEdge'] = junction ? (junction.dungeonSign === 1 ? 'e' : 'w') : null;
  const shortSide = Math.min(zone.w, zone.h);
  const archetypes: { value: Archetype; weight: number }[] = [
    { value: 'market_town', weight: 35 },
    { value: 'river_crossing', weight: hasRiver ? 25 : 0 },
    { value: 'castle_bailey', weight: shortSide < 20 ? 10 : 20 },
    { value: 'crossroads_hamlets', weight: shortSide < 24 ? 40 : 20 },
  ];
  const archetype = weightedPick(rng, archetypes);
  const wallWeights: Record<Archetype, { value: WallMode; weight: number }[]> = {
    market_town: [
      { value: 'core', weight: 40 },
      { value: 'full', weight: 20 },
      { value: 'partial', weight: 15 },
      { value: 'ruined', weight: 10 },
      { value: 'none', weight: 15 },
    ],
    river_crossing: [
      { value: 'partial', weight: 35 },
      { value: 'core', weight: 25 },
      { value: 'none', weight: 25 },
      { value: 'ruined', weight: 15 },
    ],
    castle_bailey: [
      { value: 'core', weight: 50 },
      { value: 'none', weight: 30 },
      { value: 'ruined', weight: 20 },
    ],
    crossroads_hamlets: [
      { value: 'none', weight: 70 },
      { value: 'ruined', weight: 30 },
    ],
  };
  let wallMode = weightedPick(rng, wallWeights[archetype]);
  if (shortSide < 20 && wallMode === 'full') wallMode = 'core';
  const margin = 3 * G;
  const minX = zone.x * G + margin;
  const maxX = (zone.x + zone.w) * G - margin;
  const minY = zone.y * G + margin;
  const maxY = (zone.y + zone.h) * G - margin;
  const candidates: Point2D[] = [];
  for (let i = 0; i < 12; i++) {
    candidates.push([
      (zone.x + zone.w * range(rng, 0.3, 0.7)) * G,
      (zone.y + zone.h * range(rng, 0.3, 0.7)) * G,
    ]);
  }
  const mid: Point2D = [(zone.x + zone.w / 2) * G, (zone.y + zone.h / 2) * G];
  let center = candidates[0];
  let castleAt: Point2D | null = null;
  if (archetype === 'market_town' || archetype === 'river_crossing') {
    let best = Infinity;
    for (const candidate of candidates) {
      const score = Math.hypot(candidate[0] - mid[0], candidate[1] - mid[1]) + Math.abs(jitter(rng, shortSide * G * 0.08));
      if (score < best) {
        best = score;
        center = candidate;
      }
    }
  } else if (archetype === 'castle_bailey') {
    const corners = (
      [
        [(zone.x + zone.w * 0.22) * G, (zone.y + zone.h * 0.22) * G],
        [(zone.x + zone.w * 0.78) * G, (zone.y + zone.h * 0.22) * G],
        [(zone.x + zone.w * 0.22) * G, (zone.y + zone.h * 0.78) * G],
        [(zone.x + zone.w * 0.78) * G, (zone.y + zone.h * 0.78) * G],
      ] as Point2D[]
    ).filter((point) => {
      if (blockedEdge === 'e' && point[0] > (zone.x + zone.w * 0.7) * G) return false;
      if (blockedEdge === 'w' && point[0] < (zone.x + zone.w * 0.3) * G) return false;
      return true;
    });
    castleAt = corners.length ? corners[randInt(rng, 0, corners.length - 1)] : corners[0] ?? candidates[0];
    center = [
      clamp(castleAt[0] + Math.sign(mid[0] - castleAt[0]) * shortSide * G * 0.22, minX, maxX),
      clamp(castleAt[1] + Math.sign(mid[1] - castleAt[1]) * shortSide * G * 0.22, minY, maxY),
    ];
  } else {
    center = candidates[randInt(rng, 0, candidates.length - 1)];
  }
  let coreRadius = clamp(shortSide * G * range(rng, 0.22, 0.32), 4 * G, 12 * G);
  if (wallMode === 'full') coreRadius = clamp(coreRadius * 1.35, 4 * G, shortSide * G * 0.46);
  const wantCastle = archetype === 'castle_bailey' || (archetype === 'market_town' && chance(rng, 0.35));
  if (wantCastle && !castleAt) {
    const angle = rng.next() * Math.PI * 2;
    castleAt = [
      clamp(center[0] + Math.cos(angle) * coreRadius * 0.9, minX, maxX),
      clamp(center[1] + Math.sin(angle) * coreRadius * 0.9, minY, maxY),
    ];
  }
  const perimeter = 2 * (zone.w + zone.h) * G;
  const minGap = perimeter * 0.22;
  const edges: RoadEntry['edge'][] = (['n', 'e', 's', 'w'] as const).filter((edge) => edge !== blockedEdge);
  const pool: RoadEntry[] = [];
  for (const edge of edges) {
    const steps = edge === 'n' || edge === 's' ? zone.w : zone.h;
    const count = Math.max(2, Math.floor((steps - 6) / 3));
    for (let i = 0; i < count; i++) {
      const t = 0.12 + ((i + 0.5) / count) * 0.76;
      const point = edgePoint(zone, G, edge, t);
      pool.push({ point, kind: 'edge', edge });
    }
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  const entryMax = zone.w >= 90 || zone.h >= 70 ? 5 : 4;
  const target = randInt(rng, 2, entryMax);
  const entries: RoadEntry[] = [];
  if (junction && blockedEdge) {
    entries.push({ point: junction.point, kind: 'junction', edge: blockedEdge });
  }
  for (const candidate of pool) {
    if (entries.length >= target) break;
    const at = perimeterAt(zone, G, candidate.edge, candidate.point);
    const spaced = entries.every((entry) => perimeterGap(at, perimeterAt(zone, G, entry.edge, entry.point), perimeter) >= minGap);
    if (spaced) entries.push(candidate);
  }
  if (entries.filter((entry) => entry.kind === 'edge').length < 2) {
    for (const edge of edges) {
      if (entries.some((entry) => entry.edge === edge)) continue;
      entries.push({ point: edgePoint(zone, G, edge, range(rng, 0.35, 0.65)), kind: 'edge', edge });
      if (entries.length >= 2) break;
    }
  }
  return {
    biome,
    palette,
    archetype,
    wallMode,
    hasRiver,
    center,
    coreRadius,
    entries,
    junction,
    scale: Math.sqrt((zone.w * zone.h) / (44 * 34)),
    blockedEdge,
    castleAt,
    wantCastle,
  };
}

export function reserveJunction(ctx: ExteriorCtx) {
  const junction = ctx.plan.junction;
  if (!junction) return;
  ctx.grid.stampDisk(junction.point[0], junction.point[1], 3 * ctx.G, F.RESERVED);
}

export function coreDisk(ctx: ExteriorCtx): Polygon2D {
  return disk(ctx.plan.center[0], ctx.plan.center[1], ctx.plan.coreRadius, 28);
}
