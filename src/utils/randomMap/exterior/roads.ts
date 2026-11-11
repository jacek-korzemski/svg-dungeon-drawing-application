import { Point2D } from '../../../types/dungeon';
import {
  blobPolygon,
  clipMulti,
  containsPoint,
  cumulative,
  disk,
  pointAlong,
  polylineLength,
  resample,
  ribbonPolygon,
  simplifyPolyline,
  smoothPath,
  subtractMulti,
} from '../curves';
import { fbm1D, fbm2D } from '../noise';
import { chance, clamp, range } from '../rng';
import { RibbonSample, RoadClass, RoadEntry, RoadLine } from '../types';
import { ExteriorCtx } from './context';
import { F } from './grid';
import { castleApproach } from './walls';

const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

class Heap {
  private states: number[] = [];
  private prios: number[] = [];
  get size() {
    return this.states.length;
  }
  push(state: number, prio: number) {
    this.states.push(state);
    this.prios.push(prio);
    let i = this.states.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prios[parent] <= this.prios[i]) break;
      this.swap(parent, i);
      i = parent;
    }
  }
  pop(): number | null {
    if (!this.states.length) return null;
    const out = this.states[0];
    const lastS = this.states.pop() as number;
    const lastP = this.prios.pop() as number;
    if (this.states.length) {
      this.states[0] = lastS;
      this.prios[0] = lastP;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let best = i;
        if (left < this.states.length && this.prios[left] < this.prios[best]) best = left;
        if (right < this.states.length && this.prios[right] < this.prios[best]) best = right;
        if (best === i) break;
        this.swap(i, best);
        i = best;
      }
    }
    return out;
  }
  private swap(a: number, b: number) {
    const s = this.states[a];
    this.states[a] = this.states[b];
    this.states[b] = s;
    const p = this.prios[a];
    this.prios[a] = this.prios[b];
    this.prios[b] = p;
  }
}

function worldIndex(ctx: ExteriorCtx, x: number, y: number): number {
  const cx = clamp(Math.floor(x / ctx.G) - ctx.zone.x, 0, ctx.zone.w - 1);
  const cy = clamp(Math.floor(y / ctx.G) - ctx.zone.y, 0, ctx.zone.h - 1);
  return cy * ctx.zone.w + cx;
}

function centerOf(ctx: ExteriorCtx, index: number): Point2D {
  const cx = index % ctx.zone.w;
  const cy = Math.floor(index / ctx.zone.w);
  return [(ctx.zone.x + cx + 0.5) * ctx.G, (ctx.zone.y + cy + 0.5) * ctx.G];
}

function makeCost(ctx: ExteriorCtx, paved: Uint8Array, waterMul: number): Float64Array {
  const { zone, G, grid, noise2 } = ctx;
  const cost = new Float64Array(zone.w * zone.h);
  for (let cy = 0; cy < zone.h; cy++) {
    for (let cx = 0; cx < zone.w; cx++) {
      const index = cy * zone.w + cx;
      const x = (zone.x + cx + 0.5) * G;
      const y = (zone.y + cy + 0.5) * G;
      let value = 1 + 0.6 * (fbm2D(noise2, cx / 5, cy / 5) * 0.5 + 0.5);
      if (ctx.water?.blocked.some((poly) => containsPoint(poly, x, y))) value = Infinity;
      else if (grid.has(x, y, F.WATER)) value += 30 * waterMul;
      else if (grid.has(x, y, F.SHALLOW)) value += 8;
      if (grid.has(x, y, F.BUILDING)) value = Infinity;
      if (cx <= 1 || cy <= 1 || cx >= zone.w - 2 || cy >= zone.h - 2) value += 2;
      if (paved[index] && Number.isFinite(value)) value *= 0.3;
      cost[index] = value;
    }
  }
  return cost;
}

function search(ctx: ExteriorCtx, cost: Float64Array, goals: Uint8Array, start: number): number[] | null {
  const cols = ctx.zone.w;
  const rows = ctx.zone.h;
  const count = cols * rows;
  const stride = 9;
  const gScore = new Float64Array(count * stride);
  gScore.fill(Infinity);
  const parent = new Int32Array(count * stride);
  parent.fill(-1);
  const dist = new Float32Array(count);
  dist.fill(1e6);
  const queue = new Heap();
  for (let i = 0; i < count; i++) if (goals[i]) queue.push(i, 0), (dist[i] = 0);
  while (queue.size) {
    const index = queue.pop() as number;
    const cx = index % cols;
    const cy = (index / cols) | 0;
    const base = dist[index];
    for (let dir = 0; dir < 8; dir++) {
      const nx = cx + DX[dir];
      const ny = cy + DY[dir];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const next = ny * cols + nx;
      const step = dir % 2 === 1 ? 1.4 : 1;
      if (base + step < dist[next]) {
        dist[next] = base + step;
        queue.push(next, dist[next]);
      }
    }
  }
  const heap = new Heap();
  const startState = start * stride + 8;
  gScore[startState] = 0;
  heap.push(startState, dist[start] * 0.25);
  const closed = new Uint8Array(count * stride);
  let guard = 0;
  const cap = count * 12;
  while (heap.size && guard++ < cap) {
    const state = heap.pop() as number;
    if (closed[state]) continue;
    closed[state] = 1;
    const index = (state / stride) | 0;
    const dir = state % stride;
    if (goals[index] && dir !== 8) {
      const cells: number[] = [];
      let cursor = state;
      while (cursor >= 0) {
        cells.push((cursor / stride) | 0);
        cursor = parent[cursor];
      }
      cells.reverse();
      return cells;
    }
    const cx = index % cols;
    const cy = (index / cols) | 0;
    for (let nextDir = 0; nextDir < 8; nextDir++) {
      const nx = cx + DX[nextDir];
      const ny = cy + DY[nextDir];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const next = ny * cols + nx;
      if (!Number.isFinite(cost[next])) continue;
      let turn = 0;
      if (dir !== 8) {
        let delta = Math.abs(nextDir - dir);
        if (delta > 4) delta = 8 - delta;
        if (delta >= 3) continue;
        if (delta === 1) turn = 0.4;
        else if (delta === 2) turn = 1.2;
      }
      const step = cost[next] * (nextDir % 2 === 1 ? Math.SQRT2 : 1) + turn;
      const nextState = next * stride + nextDir;
      const nextG = gScore[state] + step;
      if (nextG + 1e-6 < gScore[nextState]) {
        gScore[nextState] = nextG;
        parent[nextState] = state;
        heap.push(nextState, nextG + dist[next] * 0.25);
      }
    }
  }
  return null;
}

function dropCollinear(points: Point2D[]): Point2D[] {
  if (points.length < 3) return points;
  const out: Point2D[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(cross) > 2) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

function extendEntry(points: Point2D[], entry: RoadEntry, G: number): Point2D[] {
  const out = points.map((point) => [point[0], point[1]] as Point2D);
  out[0] = [entry.point[0], entry.point[1]];
  const dir = entry.edge === 'n' ? [0, -1] : entry.edge === 's' ? [0, 1] : entry.edge === 'w' ? [-1, 0] : [1, 0];
  out.unshift([entry.point[0] + dir[0] * G, entry.point[1] + dir[1] * G]);
  return out;
}

function inDeep(ctx: ExteriorCtx, x: number, y: number): boolean {
  return ctx.water?.deep.some((poly) => containsPoint(poly, x, y)) ?? false;
}

function inShallow(ctx: ExteriorCtx, x: number, y: number): boolean {
  return ctx.water?.shallow.some((poly) => containsPoint(poly, x, y)) ?? false;
}

function spans(points: Point2D[], G: number, test: (x: number, y: number) => boolean): { a: number; b: number }[] {
  const total = polylineLength(points);
  const out: { a: number; b: number }[] = [];
  let start = -1;
  const step = 0.1 * G;
  for (let s = 0; s <= total; s += step) {
    const at = pointAlong(points, Math.min(s, total));
    if (!at) continue;
    const wet = test(at.p[0], at.p[1]);
    if (wet && start < 0) start = s;
    if (!wet && start >= 0) {
      out.push({ a: start, b: s });
      start = -1;
    }
  }
  if (start >= 0) out.push({ a: start, b: total });
  return out;
}

function replaceSpan(points: Point2D[], start: number, end: number, a: Point2D, b: Point2D): Point2D[] {
  const cum = cumulative(points);
  const out: Point2D[] = [];
  for (let i = 0; i < points.length; i++) if (cum[i] < start) out.push(points[i]);
  out.push(a, b);
  for (let i = 0; i < points.length; i++) if (cum[i] > end) out.push(points[i]);
  return out.length >= 2 ? out : points;
}

function straightenCrossings(ctx: ExteriorCtx, points: Point2D[]): Point2D[] {
  if (!ctx.water?.deep.length) return points;
  let current = points;
  const deepSpans = spans(current, ctx.G, (x, y) => inDeep(ctx, x, y));
  for (const span of deepSpans) {
    const pad = 0.8 * ctx.G;
    const aAt = pointAlong(current, Math.max(0, span.a - pad));
    const bAt = pointAlong(current, Math.min(polylineLength(current), span.b + pad));
    if (!aAt || !bAt) continue;
    let a = aAt.p;
    let b = bAt.p;
    const road: Point2D = [b[0] - a[0], b[1] - a[1]];
    const rlen = Math.hypot(road[0], road[1]) || 1;
    const mid: Point2D = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let river: Point2D = [1, 0];
    let best = Infinity;
    for (const channel of ctx.water.channels) {
      for (let i = 1; i < channel.samples.length; i++) {
        const p = channel.samples[i].p;
        const dist = Math.hypot(p[0] - mid[0], p[1] - mid[1]);
        if (dist < best) {
          best = dist;
          const q = channel.samples[i - 1].p;
          river = [p[0] - q[0], p[1] - q[1]];
        }
      }
    }
    const rv = Math.hypot(river[0], river[1]) || 1;
    const dot = Math.abs((road[0] / rlen) * (river[0] / rv) + (road[1] / rlen) * (river[1] / rv));
    const angle = (Math.acos(clamp(dot, 0, 1)) * 180) / Math.PI;
    if (angle < 55) {
      const perpA: Point2D = [-river[1] / rv, river[0] / rv];
      const perpB: Point2D = [river[1] / rv, -river[0] / rv];
      const da = Math.abs((road[0] / rlen) * perpA[0] + (road[1] / rlen) * perpA[1]);
      const db = Math.abs((road[0] / rlen) * perpB[0] + (road[1] / rlen) * perpB[1]);
      const perp = da >= db ? perpA : perpB;
      const sign = (road[0] / rlen) * perp[0] + (road[1] / rlen) * perp[1] < 0 ? -1 : 1;
      const turn = (Math.min(25, 55 - angle) * Math.PI) / 180;
      const cs = Math.cos(sign * turn);
      const sn = Math.sin(sign * turn);
      const ux = road[0] / rlen;
      const uy = road[1] / rlen;
      const dir: Point2D = [ux * cs - uy * sn, ux * sn + uy * cs];
      const half = rlen / 2;
      a = [mid[0] - dir[0] * half, mid[1] - dir[1] * half];
      b = [mid[0] + dir[0] * half, mid[1] + dir[1] * half];
    }
    current = replaceSpan(current, Math.max(0, span.a - pad), span.b + pad, a, b);
  }
  return current;
}

function nominalWidth(ctx: ExteriorCtx, klass: RoadClass): number {
  const G = ctx.G;
  if (klass === 'main') return range(ctx.rng, 1.7, 2.1) * G;
  if (klass === 'secondary') return range(ctx.rng, 1.2, 1.5) * G;
  return range(ctx.rng, 0.7, 0.95) * G;
}

function paintRoad(ctx: ExteriorCtx, points: Point2D[], klass: RoadClass, width: number): RoadLine | null {
  const G = ctx.G;
  const step = 0.45 * G;
  const line = resample(points, step);
  if (line.length < 2) return null;
  const samples: RibbonSample[] = line.map((point, index) => {
    const dist = Math.hypot(point[0] - ctx.plan.center[0], point[1] - ctx.plan.center[1]);
    const wave = 1 + 0.12 * fbm1D(ctx.noise1, (index * step) / (4 * G));
    const grown = width * wave * (dist < ctx.plan.coreRadius ? 1.1 : 1);
    return { p: point, left: grown / 2, right: grown / 2 };
  });
  let polygon = ribbonPolygon(samples);
  if (ctx.water?.deep.length) polygon = subtractMulti(polygon, ctx.water.deep);
  polygon = clipMulti(polygon, ctx.zonePoly);
  if (!polygon.length && ctx.useTextures) return null;
  const road: RoadLine = {
    id: ctx.id('rd'),
    klass,
    points,
    polygon,
    length: polylineLength(points),
    halfWidth: width / 2,
  };
  if (ctx.useTextures) {
    const track = klass === 'lane' ? ctx.plan.palette.path[Math.floor(ctx.rng.next() * ctx.plan.palette.path.length)] : ctx.plan.palette.track;
    ctx.jobs.push({
      layerId: ctx.terrainId,
      path: track,
      softness: klass === 'lane' ? 0.38 : 0.3,
      region: polygon,
      order: 40,
    });
    if (ctx.plan.biome === 'wetland' && ctx.sites.bogs.length) {
      const bogSamples = samples.filter((sample) => ctx.sites.bogs.some((bog) => containsPoint(bog, sample.p[0], sample.p[1])));
      if (bogSamples.length > 2) {
        const bogPoly = clipMulti(ribbonPolygon(bogSamples), ctx.zonePoly);
        if (bogPoly.length) {
          ctx.jobs.push({ layerId: ctx.terrainId, path: 'deski.png', softness: 0.1, region: bogPoly, order: 43 });
        }
      }
    }
    const shallowSpans = spans(points, G, (x, y) => inShallow(ctx, x, y) && !inDeep(ctx, x, y));
    for (const span of shallowSpans) {
      if (klass !== 'lane' || span.b - span.a > 1.5 * G) continue;
      const a = pointAlong(points, span.a);
      const b = pointAlong(points, span.b);
      if (!a || !b) continue;
      const ford = clipMulti(ribbonPolygon([{ ...a, p: a.p, left: width / 2, right: width / 2 }, { p: b.p, left: width / 2, right: width / 2 }]), ctx.zonePoly);
      if (ford.length) ctx.jobs.push({ layerId: ctx.terrainId, path: 'żwir.png', softness: 0.3, region: ford, order: 55 });
    }
  } else {
    ctx.fallbackRoads.push({
      id: road.id,
      points: simplifyPolyline(points, 3),
      width,
      style: klass === 'main' ? 'cobble' : klass === 'lane' ? 'gravel' : 'dirt',
      polygon,
    });
  }
  const deepSpans = spans(points, G, (x, y) => inDeep(ctx, x, y));
  const frozenPath = ctx.plan.palette.frozen && klass === 'lane';
  for (const span of deepSpans) {
    const length = span.b - span.a;
    if (frozenPath) continue;
    if (length > 6 * G && klass !== 'main') continue;
    if (klass === 'lane' && length > 1.5 * G) {
      placeBridge(ctx, points, span, 'bridge_wood', length);
      continue;
    }
    if (klass === 'lane') continue;
    const type = ctx.plan.wallMode !== 'none' || chance(ctx.rng, 0.6) ? 'bridge_stone' : 'bridge_wood';
    placeBridge(ctx, points, span, type, length);
  }
  for (let i = 1; i < samples.length; i++) ctx.grid.stampCapsule(samples[i - 1].p, samples[i].p, width / 2 + 0.25 * G, F.ROAD);
  return road;
}

function placeBridge(
  ctx: ExteriorCtx,
  points: Point2D[],
  span: { a: number; b: number },
  type: 'bridge_stone' | 'bridge_wood',
  length: number
) {
  const mid = pointAlong(points, (span.a + span.b) / 2);
  if (!mid) return;
  const cover = Math.max(length, span.b - span.a) + 0.9 * ctx.G;
  ctx.doors.push({
    id: ctx.id('dr'),
    x: mid.p[0],
    y: mid.p[1],
    rotation: (Math.atan2(mid.tangent[1], mid.tangent[0]) * 180) / Math.PI,
    type,
    widthCells: Math.max(2, Math.round((cover / ctx.G) * 2) / 2),
  });
}

function noteCrossings(ctx: ExteriorCtx, points: Point2D[], width: number) {
  for (const road of ctx.roads) {
    const step = Math.max(ctx.G, width);
    const total = polylineLength(points);
    for (let s = step; s < total - step; s += step) {
      const at = pointAlong(points, s);
      if (!at) continue;
      const other = polylineLength(road.points);
      for (let t = 0; t < other; t += step) {
        const bt = pointAlong(road.points, t);
        if (!bt) continue;
        if (Math.hypot(at.p[0] - bt.p[0], at.p[1] - bt.p[1]) < width / 2 + road.halfWidth + 0.4 * ctx.G) {
          ctx.sites.crossings.push(at.p);
          return;
        }
      }
    }
  }
}

function trace(
  ctx: ExteriorCtx,
  from: Point2D,
  goals: Uint8Array,
  klass: RoadClass,
  entry: RoadEntry | null,
  required: boolean
): RoadLine | null {
  const paved = new Uint8Array(ctx.zone.w * ctx.zone.h);
  for (const road of ctx.roads) {
    const total = road.length;
    for (let s = 0; s <= total; s += ctx.G * 0.5) {
      const at = pointAlong(road.points, Math.min(s, total));
      if (at) paved[worldIndex(ctx, at.p[0], at.p[1])] = 1;
    }
  }
  const start = worldIndex(ctx, from[0], from[1]);
  let cells: number[] | null = null;
  let mul = 1;
  for (let attempt = 0; attempt < 3 && !cells; attempt++) {
    const cost = makeCost(ctx, paved, mul);
    cost[start] = Math.min(cost[start], 1);
    for (let i = 0; i < goals.length; i++) if (goals[i]) cost[i] = Math.min(cost[i], 1);
    cells = search(ctx, cost, goals, start);
    mul *= 2;
    if (cells) {
      const points = cells.map((index) => centerOf(ctx, index));
      const deep = spans(points, ctx.G, (x, y) => inDeep(ctx, x, y));
      const longest = deep.reduce((best, span) => Math.max(best, span.b - span.a), 0);
      if (longest > 6 * ctx.G && attempt < 2 && klass === 'main') {
        cells = null;
        continue;
      }
      if (longest > 6 * ctx.G && !required && klass !== 'main') return null;
    }
  }
  if (!cells) {
    if (!required) return null;
    cells = [start, worldIndex(ctx, ctx.plan.center[0], ctx.plan.center[1])];
  }
  let points = simplifyPolyline(dropCollinear(cells.map((index) => centerOf(ctx, index))), 0.85 * ctx.G);
  points = smoothPath(points, 0.32 * ctx.G);
  if (entry) points = extendEntry(points, entry, ctx.G);
  points = straightenCrossings(ctx, points);
  const width = nominalWidth(ctx, klass);
  const road = paintRoad(ctx, points, klass, width);
  if (!road) return null;
  noteCrossings(ctx, points, width);
  ctx.roads.push(road);
  return road;
}

function goalOf(ctx: ExteriorCtx, indexes: number[]): Uint8Array {
  const goals = new Uint8Array(ctx.zone.w * ctx.zone.h);
  for (const index of indexes) if (index >= 0 && index < goals.length) goals[index] = 1;
  return goals;
}

function hubGoals(ctx: ExteriorCtx, join: boolean): Uint8Array {
  const goals = goalOf(ctx, [worldIndex(ctx, ctx.plan.center[0], ctx.plan.center[1])]);
  if (!join) return goals;
  for (const road of ctx.roads) {
    if (road.klass !== 'main') continue;
    for (let s = 0; s <= road.length; s += ctx.G) {
      const at = pointAlong(road.points, Math.min(s, road.length));
      if (!at) continue;
      if (Math.hypot(at.p[0] - ctx.plan.center[0], at.p[1] - ctx.plan.center[1]) > ctx.plan.coreRadius) continue;
      goals[worldIndex(ctx, at.p[0], at.p[1])] = 1;
    }
  }
  return goals;
}

function farFromRoads(ctx: ExteriorCtx): Point2D | null {
  const { zone, G, rng } = ctx;
  for (let i = 0; i < 12; i++) {
    const point: Point2D = [(zone.x + range(rng, 0.15, 0.85) * zone.w) * G, (zone.y + range(rng, 0.15, 0.85) * zone.h) * G];
    if (Math.hypot(point[0] - ctx.plan.center[0], point[1] - ctx.plan.center[1]) < ctx.plan.coreRadius * 1.2) continue;
    const near = ctx.roads.some((road) => {
      const at = pointAlong(road.points, road.length * 0.5);
      return at ? Math.hypot(at.p[0] - point[0], at.p[1] - point[1]) < 5 * G : false;
    });
    if (!near && !ctx.grid.has(point[0], point[1], F.WATER | F.BUILDING | F.RESERVED)) return point;
  }
  return null;
}

export function buildRoads(ctx: ExteriorCtx) {
  const { plan, rng, G } = ctx;
  const urban = plan.archetype === 'market_town' || plan.archetype === 'river_crossing' || plan.archetype === 'castle_bailey';
  if (urban) {
    const radius = (plan.archetype === 'castle_bailey' ? range(rng, 2, 3) : range(rng, 2.5, 4)) * G;
    const plaza = blobPolygon(rng, plan.center, radius, { points: 9, roughness: 0.15 });
    ctx.sites.plaza = plaza;
    ctx.grid.stampPolygon(plaza, F.PLAZA);
    if (ctx.useTextures) {
      ctx.jobs.push({
        layerId: ctx.terrainId,
        path: chance(rng, 0.5) ? plan.palette.urban[0] : 'bruk-mech.png',
        softness: 0.12,
        region: clipMulti([plaza], ctx.zonePoly),
        order: 41,
      });
    }
  }
  const edges = plan.entries.filter((entry) => entry.kind === 'edge');
  edges.forEach((entry, index) => {
    trace(ctx, entry.point, hubGoals(ctx, index > 0), 'main', entry, index === 0);
  });
  const approach = castleApproach(ctx);
  if (approach) trace(ctx, approach, hubGoals(ctx, true), 'secondary', null, false);
  const junction = plan.entries.find((entry) => entry.kind === 'junction');
  if (junction) trace(ctx, junction.point, hubGoals(ctx, true), 'secondary', junction, true);
  if (!ctx.roads.length) {
    const fallback = plan.entries[0];
    if (fallback) trace(ctx, fallback.point, goalOf(ctx, [worldIndex(ctx, plan.center[0], plan.center[1])]), 'main', fallback, true);
  }
  const count = clamp(Math.round(range(rng, 1, 3) * Math.max(0.6, plan.scale)), 1, 4);
  for (let i = 0; i < count; i++) {
    const target = farFromRoads(ctx);
    if (!target) break;
    trace(ctx, target, hubGoals(ctx, true), 'secondary', null, false);
  }
  if (plan.archetype === 'market_town' || plan.archetype === 'river_crossing') {
    const mains = ctx.roads.filter((road) => road.klass === 'main');
    const lanes = randIntSafe(rng, 1, 3);
    for (let i = 0; i < lanes && mains.length >= 2; i++) {
      const a = mains[Math.floor(rng.next() * mains.length)];
      const b = mains[Math.floor(rng.next() * mains.length)];
      if (a === b) continue;
      const sa = pointAlong(a.points, a.length * range(rng, 0.3, 0.7));
      const sb = pointAlong(b.points, b.length * range(rng, 0.3, 0.7));
      if (!sa || !sb) continue;
      if (Math.hypot(sa.p[0] - plan.center[0], sa.p[1] - plan.center[1]) > plan.coreRadius) continue;
      trace(ctx, sa.p, goalOf(ctx, [worldIndex(ctx, sb.p[0], sb.p[1])]), 'lane', null, false);
    }
  }
}

function randIntSafe(rng: { next: () => number }, a: number, b: number): number {
  return a + Math.floor(rng.next() * (b - a + 1));
}

export function paveUrban(ctx: ExteriorCtx) {
  if (!ctx.useTextures) return;
  const mask = ctx.insideWall ?? disk(ctx.plan.center[0], ctx.plan.center[1], ctx.plan.coreRadius, 28);
  const texture = ctx.plan.palette.urban[Math.floor(ctx.rng.next() * ctx.plan.palette.urban.length)] ?? 'bruk.png';
  for (const road of ctx.roads) {
    if (road.klass === 'lane') continue;
    const region = clipMulti(road.polygon, mask);
    if (!region.length) continue;
    ctx.jobs.push({ layerId: ctx.terrainId, path: texture, softness: 0.14, region, order: 42 });
  }
}

export function connectSpur(ctx: ExteriorCtx, from: Point2D, to: Point2D) {
  trace(ctx, from, goalOf(ctx, [worldIndex(ctx, to[0], to[1])]), 'lane', null, false);
}
