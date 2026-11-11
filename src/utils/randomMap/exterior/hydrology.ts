import { MultiPolygon2D, Point2D, Polygon2D } from '../../../types/dungeon';
import { unionGeometry } from '../../geometry';
import {
  blobPolygon,
  clipMulti,
  cumulative,
  frames,
  pointAlong,
  polylineLength,
  resample,
  ribbonPolygon,
  simplifyPolyline,
  smoothPath,
} from '../curves';
import { createNoise1D, fbm1D } from '../noise';
import { chance, clamp, range, Rng } from '../rng';
import { Channel, Rect, RibbonSample, RoadEntry, Water } from '../types';
import { ExteriorCtx } from './context';
import { F } from './grid';

type Edge = RoadEntry['edge'];

function edgePoint(zone: Rect, G: number, edge: Edge, t: number): Point2D {
  const x0 = zone.x * G;
  const y0 = zone.y * G;
  const x1 = (zone.x + zone.w) * G;
  const y1 = (zone.y + zone.h) * G;
  const u = clamp(t, 0.12, 0.88);
  if (edge === 'n') return [x0 + (x1 - x0) * u, y0];
  if (edge === 's') return [x0 + (x1 - x0) * u, y1];
  if (edge === 'w') return [x0, y0 + (y1 - y0) * u];
  return [x1, y0 + (y1 - y0) * u];
}

function opposite(edge: Edge): Edge {
  if (edge === 'n') return 's';
  if (edge === 's') return 'n';
  if (edge === 'w') return 'e';
  return 'w';
}

function displace(points: Point2D[], amp: number, rng: Rng, zone: Rect, G: number, iterations: number): Point2D[] {
  let current = points.map((point) => [point[0], point[1]] as Point2D);
  let scale = amp;
  const minX = zone.x * G + 1.5 * G;
  const maxX = (zone.x + zone.w) * G - 1.5 * G;
  const minY = zone.y * G + 1.5 * G;
  const maxY = (zone.y + zone.h) * G - 1.5 * G;
  for (let iter = 0; iter < iterations; iter++) {
    const next: Point2D[] = [[current[0][0], current[0][1]]];
    for (let i = 0; i < current.length - 1; i++) {
      const a = current[i];
      const b = current[i + 1];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const shift = range(rng, -1, 1) * scale * len;
      next.push(
        [
          clamp((a[0] + b[0]) / 2 + (-dy / len) * shift, minX, maxX),
          clamp((a[1] + b[1]) / 2 + (dx / len) * shift, minY, maxY),
        ],
        [b[0], b[1]]
      );
    }
    current = next;
    scale *= 0.55;
  }
  return current;
}

function extendEnds(points: Point2D[], distance: number): Point2D[] {
  if (points.length < 2) return points;
  const out = points.map((point) => [point[0], point[1]] as Point2D);
  const a = out[0];
  const b = out[1];
  const len0 = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  out[0] = [a[0] - ((b[0] - a[0]) / len0) * distance, a[1] - ((b[1] - a[1]) / len0) * distance];
  const c = out[out.length - 2];
  const d = out[out.length - 1];
  const len1 = Math.hypot(d[0] - c[0], d[1] - c[1]) || 1;
  out[out.length - 1] = [d[0] + ((d[0] - c[0]) / len1) * distance, d[1] + ((d[1] - c[1]) / len1) * distance];
  return out;
}

function nearJunction(point: Point2D, ctx: ExteriorCtx): boolean {
  const junction = ctx.plan.junction;
  if (!junction) return false;
  return Math.hypot(point[0] - junction.point[0], point[1] - junction.point[1]) < 6 * ctx.G;
}

function usableEdges(ctx: ExteriorCtx): Edge[] {
  return (['n', 'e', 's', 'w'] as Edge[]).filter((edge) => edge !== ctx.plan.blockedEdge);
}

function pickCourse(ctx: ExteriorCtx): Point2D[] {
  const { zone, G, rng, plan } = ctx;
  const edges = usableEdges(ctx);
  const roll = rng.next();
  const kind = roll < 0.45 ? 'across' : roll < 0.65 ? 'diagonal' : roll < 0.85 ? 'arc' : 'meander';
  let startE = edges[0];
  let endE = edges[Math.min(1, edges.length - 1)];
  const vertical = edges.includes('n') && edges.includes('s');
  const horizontal = edges.includes('w') && edges.includes('e');
  if (kind === 'across' || kind === 'meander') {
    if (vertical && (!horizontal || chance(rng, 0.5))) {
      startE = 'n';
      endE = 's';
    } else if (horizontal) {
      startE = 'w';
      endE = 'e';
    }
  } else {
    const pairs = [
      ['n', 'e'],
      ['e', 's'],
      ['s', 'w'],
      ['w', 'n'],
    ].filter((pair) => edges.includes(pair[0] as Edge) && edges.includes(pair[1] as Edge));
    const pair = pairs.length ? pairs[Math.floor(rng.next() * pairs.length)] : [startE, endE];
    startE = pair[0] as Edge;
    endE = pair[1] as Edge;
  }
  if (!edges.includes(endE)) endE = opposite(startE);
  let start = edgePoint(zone, G, startE, range(rng, 0.25, 0.75));
  let end = edgePoint(zone, G, endE, range(rng, 0.25, 0.75));
  for (let guard = 0; guard < 6 && (nearJunction(start, ctx) || nearJunction(end, ctx)); guard++) {
    start = edgePoint(zone, G, startE, range(rng, 0.2, 0.8));
    end = edgePoint(zone, G, endE, range(rng, 0.2, 0.8));
  }
  if (kind === 'arc') {
    const north = startE === 'n' || endE === 'n';
    const west = startE === 'w' || endE === 'w';
    const corner: Point2D = [
      (west ? zone.x : zone.x + zone.w) * G,
      (north ? zone.y : zone.y + zone.h) * G,
    ];
    const dx = plan.center[0] - corner[0];
    const dy = plan.center[1] - corner[1];
    const len = Math.hypot(dx, dy) || 1;
    const control: Point2D = [
      clamp(corner[0] + (dx / len) * plan.coreRadius * 1.6, zone.x * G + 2 * G, (zone.x + zone.w) * G - 2 * G),
      clamp(corner[1] + (dy / len) * plan.coreRadius * 1.6, zone.y * G + 2 * G, (zone.y + zone.h) * G - 2 * G),
    ];
    return displace([start, control, end], 0.16, rng, zone, G, 4);
  }
  return displace([start, end], kind === 'meander' ? 0.48 : 0.36, rng, zone, G, 5);
}

function profile(points: Point2D[], G: number, noise: (x: number) => number, rng: Rng): RibbonSample[] {
  const cum = cumulative(points);
  const total = cum[cum.length - 1] || 1;
  const halves = points.map((_, index) => {
    const t = cum[index] / total;
    const wave = 1 + 0.35 * fbm1D(noise, cum[index] / (6 * G));
    return clamp(G * (0.55 + 0.4 * t) * wave, 0.35 * G, 1.3 * G);
  });
  const framed = frames(points);
  const spots: number[] = [];
  for (let n = 0; n < 2; n++) {
    let best = -1;
    let bestScore = Infinity;
    for (let i = 2; i < points.length - 2; i++) {
      const t = cum[i] / total;
      if (t < 0.22 || t > 0.78) continue;
      if (spots.some((spot) => Math.abs(cum[spot] - cum[i]) < 8 * G)) continue;
      const score = halves[i] + Math.abs(framed[i].k) * 30 * G;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best >= 0 && (n === 0 || chance(rng, 0.55))) spots.push(best);
  }
  for (const spot of spots) {
    for (let i = 0; i < halves.length; i++) {
      const dist = Math.abs(cum[i] - cum[spot]);
      if (dist > 1.5 * G) continue;
      const u = dist / (1.5 * G);
      halves[i] *= 1 - 0.2 * (0.5 + 0.5 * Math.cos(Math.PI * u));
    }
  }
  return points.map((point, index) => ({ p: point, left: halves[index], right: halves[index] }));
}

interface Bands {
  deep: RibbonSample[];
  shallow: RibbonSample[];
  bars: RibbonSample[];
}

function asymmetric(samples: RibbonSample[], G: number): Bands {
  const framed = frames(samples.map((sample) => sample.p));
  const deep: RibbonSample[] = [];
  const shallow: RibbonSample[] = [];
  const bars: RibbonSample[] = [];
  for (let i = 0; i < samples.length; i++) {
    const half = (samples[i].left + samples[i].right) / 2;
    const turn = Math.min(1, Math.abs(framed[i].k) * 3 * G);
    const inner = half + 0.35 * G + 0.9 * G * turn;
    const outer = half + 0.15 * G;
    const leftInner = framed[i].k > 0;
    deep.push({ p: samples[i].p, left: half, right: half });
    shallow.push({ p: samples[i].p, left: leftInner ? inner : outer, right: leftInner ? outer : inner });
    bars.push(
      turn > 0.35
        ? { p: samples[i].p, left: leftInner ? inner + 0.5 * G : half, right: leftInner ? half : inner + 0.5 * G }
        : { p: samples[i].p, left: half, right: half }
    );
  }
  return { deep, shallow, bars };
}

function hitsReserved(ctx: ExteriorCtx, samples: RibbonSample[]): boolean {
  const junction = ctx.plan.junction;
  if (!junction) return false;
  return samples.some((sample) => {
    if (ctx.grid.has(sample.p[0], sample.p[1], F.RESERVED)) return true;
    return Math.hypot(sample.p[0] - junction.point[0], sample.p[1] - junction.point[1]) < sample.left + 2.2 * ctx.G;
  });
}

function maybeIsland(samples: RibbonSample[], G: number, rng: Rng): { main: RibbonSample[]; branches: RibbonSample[][]; island: Point2D | null } {
  const framed = frames(samples.map((sample) => sample.p));
  const cum = cumulative(samples.map((sample) => sample.p));
  let runStart = -1;
  for (let i = 2; i < samples.length - 2; i++) {
    const straight = Math.abs(framed[i].k) * 3 * G < 0.22;
    if (straight && runStart < 0) runStart = i;
    if ((!straight || i === samples.length - 3) && runStart >= 0) {
      const runEnd = straight ? i : i - 1;
      const longEnough = cum[runEnd] - cum[runStart] >= 7 * G;
      if (longEnough && chance(rng, 0.25)) {
        const span = samples.slice(runStart, runEnd + 1);
        const local = frames(span.map((sample) => sample.p));
        const amp = G * range(rng, 0.9, 1.3);
        const left: RibbonSample[] = [];
        const right: RibbonSample[] = [];
        for (let k = 0; k < span.length; k++) {
          const u = k / Math.max(1, span.length - 1);
          const off = amp * Math.sin(Math.PI * u);
          const half = span[k].left * 0.55;
          left.push({ p: [span[k].p[0] + local[k].n[0] * off, span[k].p[1] + local[k].n[1] * off], left: half, right: half });
          right.push({ p: [span[k].p[0] - local[k].n[0] * off, span[k].p[1] - local[k].n[1] * off], left: half, right: half });
        }
        return {
          main: [...samples.slice(0, runStart + 1), samples[runEnd]],
          branches: [left, right],
          island: span[Math.floor(span.length / 2)].p,
        };
      }
      runStart = -1;
    }
  }
  return { main: samples, branches: [], island: null };
}

function unionBands(bands: RibbonSample[][], zonePoly: Polygon2D): MultiPolygon2D {
  let acc: MultiPolygon2D = [];
  for (const band of bands) {
    if (band.length < 2) continue;
    const ribbon = ribbonPolygon(band);
    if (!ribbon.length) continue;
    acc = acc.length ? unionGeometry(acc, ribbon) : ribbon;
  }
  return clipMulti(acc, zonePoly);
}

function stampAll(ctx: ExteriorCtx, mp: MultiPolygon2D, flag: number) {
  for (const poly of mp) ctx.grid.stampPolygon(poly, flag);
}

function ruralPoint(ctx: ExteriorCtx): Point2D {
  const { zone, G, plan, rng } = ctx;
  for (let i = 0; i < 8; i++) {
    const point: Point2D = [(zone.x + range(rng, 0.14, 0.86) * zone.w) * G, (zone.y + range(rng, 0.14, 0.86) * zone.h) * G];
    if (Math.hypot(point[0] - plan.center[0], point[1] - plan.center[1]) > plan.coreRadius) return point;
  }
  return [(zone.x + zone.w * 0.2) * G, (zone.y + zone.h * 0.2) * G];
}

function addPond(ctx: ExteriorCtx, ponds: Polygon2D[], skirts: Polygon2D[], blocked: Polygon2D[], radius: number) {
  const center = ruralPoint(ctx);
  const body = blobPolygon(ctx.rng, center, radius, { points: 10, roughness: 0.28 });
  const skirt = blobPolygon(ctx.rng, center, radius + 0.6 * ctx.G, { points: 10, roughness: 0.22 });
  ponds.push(body);
  skirts.push(skirt);
  blocked.push(body);
  ctx.grid.stampPolygon(skirt, F.SHALLOW);
  ctx.grid.stampPolygon(body, F.WATER);
}

function emptyWater(ponds: Polygon2D[], skirts: Polygon2D[], blocked: Polygon2D[]): Water {
  return { channels: [], ponds, pondShallow: skirts, deep: ponds, shallow: skirts, bars: [], blocked, crossings: [], island: null };
}

export function buildWater(ctx: ExteriorCtx): Water | null {
  const { zone, G, rng, plan } = ctx;
  const ponds: Polygon2D[] = [];
  const skirts: Polygon2D[] = [];
  const blocked: Polygon2D[] = [];
  if (!plan.hasRiver) {
    if (chance(rng, 0.7)) addPond(ctx, ponds, skirts, blocked, range(rng, 2.5, 5) * G);
    const water = emptyWater(ponds, skirts, blocked);
    ctx.water = water;
    return water;
  }
  const noise = createNoise1D(rng);
  let samples: RibbonSample[] = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    let guide = pickCourse(ctx);
    if (attempt > 0 && plan.junction) guide = displace(guide, 0.2, rng, zone, G, 2).map((point) => {
      const dx = point[0] - plan.junction!.point[0];
      const dy = point[1] - plan.junction!.point[1];
      const len = Math.hypot(dx, dy) || 1;
      return [clamp(point[0] + (dx / len) * 4 * G, zone.x * G + G, (zone.x + zone.w) * G - G), clamp(point[1] + (dy / len) * 4 * G, zone.y * G + G, (zone.y + zone.h) * G - G)] as Point2D;
    });
    const smoothed = smoothPath(extendEnds(simplifyPolyline(guide, 1.6 * G), 1.5 * G), 0.28 * G);
    samples = profile(resample(smoothed, 0.33 * G), G, noise, rng);
    if (!hitsReserved(ctx, samples)) break;
    samples = [];
  }
  if (!samples.length || hitsReserved(ctx, samples)) {
    plan.hasRiver = false;
    if (chance(rng, 0.7)) addPond(ctx, ponds, skirts, blocked, range(rng, 2.5, 4.5) * G);
    const water = emptyWater(ponds, skirts, blocked);
    ctx.water = water;
    return water;
  }
  const island = maybeIsland(samples, G, rng);
  const main = asymmetric(island.main, G);
  const deepBands = [main.deep];
  const shallowBands = [main.shallow];
  const barBands = [main.bars];
  const channels: Channel[] = [{ samples: main.deep, kind: 'main' }];
  for (const branch of island.branches) {
    const shaped = asymmetric(branch, G);
    deepBands.push(shaped.deep);
    shallowBands.push(shaped.shallow);
    channels.push({ samples: shaped.deep, kind: 'branch' });
  }
  if (Math.min(zone.w, zone.h) >= 22 && chance(rng, 0.35)) {
    const line = main.deep.map((sample) => sample.p);
    const mouth = pointAlong(line, polylineLength(line) * range(rng, 0.3, 0.7));
    if (mouth) {
      const edges = usableEdges(ctx);
      const source = edgePoint(zone, G, edges[Math.floor(rng.next() * edges.length)], range(rng, 0.2, 0.8));
      const control: Point2D = [mouth.p[0] - mouth.tangent[0] * 2.5 * G, mouth.p[1] - mouth.tangent[1] * 2.5 * G];
      const tri = resample(
        smoothPath(extendEnds(simplifyPolyline(displace([source, control, mouth.p], 0.18, rng, zone, G, 3), 1.4 * G), G), 0.28 * G),
        0.28 * G
      );
      const triSamples = tri.map((point, index) => {
        const t = index / Math.max(1, tri.length - 1);
        const half = clamp(0.25 * G + (main.deep[0].left * 0.55 - 0.25 * G) * t, 0.22 * G, 0.9 * G);
        return { p: point, left: half, right: half };
      });
      if (!hitsReserved(ctx, triSamples)) {
        const shaped = asymmetric(triSamples, G);
        deepBands.push(shaped.deep);
        shallowBands.push(shaped.shallow);
        channels.push({ samples: shaped.deep, kind: 'tributary' });
      }
    }
  }
  const pondCount = plan.biome === 'wetland' ? 2 + Math.floor(rng.next() * 3) : chance(rng, 0.3) ? 1 : 0;
  for (let i = 0; i < pondCount; i++) addPond(ctx, ponds, skirts, blocked, range(rng, 1.2, 2.2) * G);
  const deep = unionBands(deepBands, ctx.zonePoly);
  const shallow = unionBands(shallowBands, ctx.zonePoly);
  const bars = unionBands(barBands, ctx.zonePoly);
  stampAll(ctx, shallow, F.SHALLOW);
  stampAll(ctx, deep, F.WATER);
  if (plan.archetype === 'river_crossing') {
    const line = main.deep;
    const cum = cumulative(line.map((sample) => sample.p));
    const total = cum[cum.length - 1] || 1;
    let best = line[Math.floor(line.length / 2)];
    for (let i = 0; i < line.length; i++) {
      const t = cum[i] / total;
      if (t > 0.3 && t < 0.7 && line[i].left < best.left) best = line[i];
    }
    const index = Math.max(0, line.indexOf(best));
    const normal = frames(line.map((sample) => sample.p))[index].n;
    const candidate = (side: number): Point2D => [
      best.p[0] + normal[0] * side * (best.left + 2 * G),
      best.p[1] + normal[1] * side * (best.left + 2 * G),
    ];
    const inside = (point: Point2D) =>
      point[0] > zone.x * G + 3 * G &&
      point[0] < (zone.x + zone.w) * G - 3 * G &&
      point[1] > zone.y * G + 3 * G &&
      point[1] < (zone.y + zone.h) * G - 3 * G;
    plan.center = inside(candidate(1)) ? candidate(1) : candidate(-1);
  }
  const crossings = [...main.deep].sort((a, b) => a.left - b.left).slice(0, 2).map((sample) => sample.p);
  const water: Water = { channels, ponds, pondShallow: skirts, deep, shallow, bars, blocked, crossings, island: island.island };
  ctx.water = water;
  return water;
}
