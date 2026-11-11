import { SVG_PROP_CATALOG } from '../../../data/presets';
import { Point2D, Polygon2D, SvgPropId } from '../../../types/dungeon';
import { containsPoint, pointAlong } from '../curves';
import { fbm2D } from '../noise';
import { chance, randInt, range } from '../rng';
import { ExteriorCtx } from './context';
import { F } from './grid';

function propSize(id: SvgPropId): { widthPx: number; heightPx: number } {
  const found = SVG_PROP_CATALOG.find((item) => item.id === id);
  return { widthPx: found?.widthPx ?? 64, heightPx: found?.heightPx ?? 64 };
}

function budgetFor(ctx: ExteriorCtx): number {
  const cells = ctx.zone.w * ctx.zone.h;
  if (cells < 800) return 60;
  if (cells < 1800) return 110;
  if (cells < 4000) return 170;
  return 240;
}

function blocked(ctx: ExteriorCtx, x: number, y: number, allowShallow = false): boolean {
  const mask = F.BUILDING | F.ROAD | F.WALL | F.WATER | F.PROP | (allowShallow ? 0 : F.SHALLOW);
  return ctx.grid.has(x, y, mask);
}

function put(ctx: ExteriorCtx, id: SvgPropId, x: number, y: number, rotation: number, scale: number, allowShallow = false): boolean {
  if (ctx.props.length >= budgetFor(ctx)) return false;
  if (blocked(ctx, x, y, allowShallow)) return false;
  const size = propSize(id);
  ctx.props.push({
    id: ctx.id('pr'),
    x,
    y,
    rotation,
    scale,
    kind: 'svg',
    svgPropId: id,
    label: ctx.labels.props[id],
    widthPx: size.widthPx,
    heightPx: size.heightPx,
  });
  ctx.grid.stampDisk(x, y, Math.max(10, size.widthPx * scale * 0.28), F.PROP);
  return true;
}

function bounds(poly: Polygon2D) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of poly[0] ?? []) {
    if (point[0] < minX) minX = point[0];
    if (point[1] < minY) minY = point[1];
    if (point[0] > maxX) maxX = point[0];
    if (point[1] > maxY) maxY = point[1];
  }
  return { minX, minY, maxX, maxY };
}

function poisson(ctx: ExteriorCtx, poly: Polygon2D, spacing: number, scale: [number, number], max = 14) {
  const box = bounds(poly);
  const taken: Point2D[] = [];
  for (let i = 0; i < 80 && taken.length < max && ctx.props.length < budgetFor(ctx); i++) {
    const point: Point2D = [box.minX + ctx.rng.next() * (box.maxX - box.minX), box.minY + ctx.rng.next() * (box.maxY - box.minY)];
    if (!containsPoint(poly, point[0], point[1])) continue;
    if (taken.some((other) => Math.hypot(other[0] - point[0], other[1] - point[1]) < spacing)) continue;
    if (put(ctx, 'tree', point[0], point[1], ctx.rng.next() * 360, range(ctx.rng, scale[0], scale[1]), true)) taken.push(point);
  }
}

export function scatterProps(ctx: ExteriorCtx) {
  const { rng, G, plan } = ctx;
  if (ctx.sites.plaza) {
    put(ctx, chance(rng, 0.6) ? 'well' : 'statue', plan.center[0], plan.center[1], rng.next() * 40 - 20, 1);
    for (let i = 0; i < randInt(rng, 1, 3); i++) {
      const angle = rng.next() * Math.PI * 2;
      const dist = plan.coreRadius * 0.18 + range(rng, 0.4, 1.2) * G;
      const id = chance(rng, 0.5) ? 'crate' : 'barrel';
      put(ctx, id, plan.center[0] + Math.cos(angle) * dist, plan.center[1] + Math.sin(angle) * dist, rng.next() * 360, range(rng, 0.8, 1));
    }
  }
  for (const gate of ctx.sites.gates.slice(0, 4)) {
    put(ctx, chance(rng, 0.5) ? 'barrel' : 'crate', gate.inside[0], gate.inside[1], rng.next() * 30, 0.9);
  }
  if (ctx.sites.tavern) {
    for (let i = 0; i < randInt(rng, 3, 5); i++) {
      put(
        ctx,
        'barrel',
        ctx.sites.tavern.center[0] + Math.cos(ctx.sites.tavern.angle) * range(rng, 0.4, 1.3) * G,
        ctx.sites.tavern.center[1] + Math.sin(ctx.sites.tavern.angle) * range(rng, 0.4, 1.3) * G,
        ctx.sites.tavern.angle,
        range(rng, 0.85, 1.05)
      );
    }
  }
  if (plan.junction) {
    for (let i = 0; i < randInt(rng, 3, 6); i++) {
      const angle = rng.next() * Math.PI * 2;
      const dist = range(rng, 1.2, 3.2) * G;
      put(ctx, 'boulder', plan.junction.point[0] + Math.cos(angle) * dist, plan.junction.point[1] + Math.sin(angle) * dist, rng.next() * 360, range(rng, 0.6, 1.2));
    }
  }
  for (const grove of ctx.sites.groves) poisson(ctx, grove, 1.1 * G, [0.8, 1.3]);
  const ruralTrees = Math.round(8 * plan.scale);
  for (let i = 0; i < ruralTrees; i++) {
    const point: Point2D = [
      (ctx.zone.x + range(rng, 0.05, 0.95) * ctx.zone.w) * G,
      (ctx.zone.y + range(rng, 0.05, 0.95) * ctx.zone.h) * G,
    ];
    if (fbm2D(ctx.noise2, point[0] / (10 * G), point[1] / (10 * G)) < 0.15) continue;
    if (Math.hypot(point[0] - plan.center[0], point[1] - plan.center[1]) < plan.coreRadius) continue;
    put(ctx, 'tree', point[0], point[1], rng.next() * 360, range(rng, 0.75, 1.15), true);
  }
  if (chance(rng, 0.15)) {
    const road = ctx.roads.find((item) => item.klass === 'main');
    if (road) {
      for (let s = G; s < road.length - G; s += 2.5 * G) {
        const at = pointAlong(road.points, s);
        if (!at) continue;
        if (ctx.grid.has(at.p[0], at.p[1], F.INSIDE_WALL)) continue;
        for (const side of [1, -1]) {
          put(
            ctx,
            'tree',
            at.p[0] + at.normal[0] * side * (road.halfWidth + 0.8 * G),
            at.p[1] + at.normal[1] * side * (road.halfWidth + 0.8 * G),
            rng.next() * 360,
            range(rng, 0.7, 0.85),
            true
          );
        }
      }
    }
  }
  for (const orchard of ctx.sites.orchards) {
    for (let row = -1; row <= 1; row++) {
      for (let col = -1; col <= 1; col++) {
        put(ctx, 'tree', orchard[0] + col * 1.6 * G, orchard[1] + row * 1.6 * G, rng.next() * 360, range(rng, 0.55, 0.7));
      }
    }
  }
  const channel = ctx.water?.channels.find((item) => item.kind === 'main');
  if (channel) {
    for (let i = 2; i < channel.samples.length - 2; i += randInt(rng, 2, 4)) {
      if (!chance(rng, 0.5)) continue;
      const sample = channel.samples[i];
      const prev = channel.samples[i - 1].p;
      const dx = sample.p[0] - prev[0];
      const dy = sample.p[1] - prev[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      put(ctx, 'bush', sample.p[0] + nx * (sample.left + 0.35 * G), sample.p[1] + ny * (sample.left + 0.35 * G), rng.next() * 360, range(rng, 0.8, 1.2), true);
    }
  }
  for (let i = 0; i < randInt(rng, 2, 5); i++) {
    const point: Point2D = [(ctx.zone.x + range(rng, 0.1, 0.9) * ctx.zone.w) * G, (ctx.zone.y + range(rng, 0.1, 0.9) * ctx.zone.h) * G];
    if (Math.hypot(point[0] - plan.center[0], point[1] - plan.center[1]) < plan.coreRadius * 1.4) continue;
    put(ctx, 'boulder', point[0], point[1], rng.next() * 360, range(rng, 0.7, 1.2));
  }
  const fireP = plan.biome === 'winter' ? 0.6 : 0.3;
  if (chance(rng, fireP)) {
    const road = ctx.roads.find((item) => item.klass !== 'main') ?? ctx.roads[0];
    const at = road ? pointAlong(road.points, road.length * range(rng, 0.55, 0.9)) : null;
    if (at && Math.hypot(at.p[0] - plan.center[0], at.p[1] - plan.center[1]) > plan.coreRadius) {
      const x = at.p[0] + at.normal[0] * (road.halfWidth + G);
      const y = at.p[1] + at.normal[1] * (road.halfWidth + G);
      if (put(ctx, 'campfire', x, y, 0, 1)) {
        put(ctx, 'crate', x + 0.6 * G, y + 0.2 * G, rng.next() * 40, 0.85);
      }
    }
  }
  if (ctx.sites.cemetery) {
    const ring = ctx.sites.cemetery[0] ?? [];
    let cx = 0;
    let cy = 0;
    const n = Math.max(1, ring.length - 1);
    for (let i = 0; i < n; i++) {
      cx += ring[i][0];
      cy += ring[i][1];
    }
    cx /= n;
    cy /= n;
    for (let i = 0; i < randInt(rng, 6, 12); i++) {
      const id = chance(rng, 0.25) ? 'statue' : 'pillar';
      put(ctx, id, cx + range(rng, -1.6, 1.6) * G, cy + range(rng, -1.2, 1.2) * G, rng.next() * 20, id === 'statue' ? 0.4 : range(rng, 0.35, 0.45));
    }
  }
}
