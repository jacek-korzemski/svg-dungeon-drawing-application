import { Point2D, Polygon2D } from '../../../types/dungeon';
import { blobPolygon, clipMulti, pointAlong, rotatedRect, zonePolygon } from '../curves';
import { fbm2D } from '../noise';
import { chance, clamp, randInt, range } from '../rng';
import { ExteriorCtx } from './context';
import { F } from './grid';
import { addWall } from './walls';

function axisAngle(rad: number): number {
  const deg = (rad * 180) / Math.PI;
  const candidates = [0, 90, -90, 180];
  let best = 0;
  let bestAbs = 999;
  let delta = 0;
  for (const candidate of candidates) {
    let d = deg - candidate;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    if (Math.abs(d) < bestAbs) {
      bestAbs = Math.abs(d);
      best = candidate;
      delta = d;
    }
  }
  return ((best + clamp(delta, -12, 12)) * Math.PI) / 180;
}

function nearestRoadAngle(ctx: ExteriorCtx, point: Point2D): number {
  let best = Infinity;
  let angle = 0;
  for (const road of ctx.roads) {
    const steps = Math.max(1, Math.floor(road.length / ctx.G));
    for (let i = 0; i <= steps; i++) {
      const at = pointAlong(road.points, (road.length * i) / steps);
      if (!at) continue;
      const dist = Math.hypot(at.p[0] - point[0], at.p[1] - point[1]);
      if (dist < best) {
        best = dist;
        angle = Math.atan2(at.tangent[1], at.tangent[0]);
      }
    }
  }
  return axisAngle(angle);
}

export function seedBogs(ctx: ExteriorCtx) {
  if (ctx.plan.biome !== 'wetland') return;
  const count = randInt(ctx.rng, 3, 6);
  for (let i = 0; i < count; i++) {
    const point: Point2D = [
      (ctx.zone.x + range(ctx.rng, 0.08, 0.92) * ctx.zone.w) * ctx.G,
      (ctx.zone.y + range(ctx.rng, 0.08, 0.92) * ctx.zone.h) * ctx.G,
    ];
    const bog = blobPolygon(ctx.rng, point, range(ctx.rng, 2, 4.5) * ctx.G, { roughness: 0.3, points: 9 });
    ctx.sites.bogs.push(bog);
    ctx.grid.stampPolygon(bog, F.BOG);
    const path = ctx.plan.palette.bog[i % ctx.plan.palette.bog.length];
    ctx.jobs.push({ layerId: ctx.terrainId, path, softness: 0.55, region: clipMulti([bog], ctx.zonePoly), order: 12 });
  }
}

export function buildTerrain(ctx: ExteriorCtx) {
  const { zone, G, rng, plan } = ctx;
  const base = zonePolygon(zone.x * G, zone.y * G, zone.w * G, zone.h * G);
  if (ctx.useTextures) {
    ctx.jobs.push({ layerId: ctx.terrainId, path: plan.palette.base, softness: 0.04, region: [base], order: 0 });
  }
  const patches = clamp(Math.round(range(rng, 4, 10) * Math.max(0.7, plan.scale)), 3, 16);
  for (let i = 0; i < patches; i++) {
    const point: Point2D = [(zone.x + range(rng, 0.05, 0.95) * zone.w) * G, (zone.y + range(rng, 0.05, 0.95) * zone.h) * G];
    if (fbm2D(ctx.noise2, point[0] / (8 * G), point[1] / (8 * G)) < 0.05) continue;
    if (ctx.grid.has(point[0], point[1], F.PLAZA | F.WATER | F.ROAD)) continue;
    if (Math.hypot(point[0] - plan.center[0], point[1] - plan.center[1]) < plan.coreRadius * 0.65) continue;
    const blob = blobPolygon(rng, point, range(rng, 2, 6) * G, { roughness: 0.32, points: randInt(rng, 8, 12) });
    const path = plan.palette.patches[i % Math.max(1, plan.palette.patches.length)] ?? plan.palette.base;
    ctx.jobs.push({
      layerId: ctx.terrainId,
      path,
      softness: range(rng, 0.6, 0.85),
      region: clipMulti([blob], ctx.zonePoly),
      order: 10,
    });
  }
  const groves = clamp(Math.round(range(rng, 2, 5) * Math.max(0.6, plan.scale)), 1, 8);
  for (let i = 0; i < groves; i++) {
    const edge = chance(rng, 0.5);
    const point: Point2D = edge
      ? [(zone.x + (chance(rng, 0.5) ? range(rng, 0.04, 0.16) : range(rng, 0.84, 0.96)) * zone.w) * G, (zone.y + range(rng, 0.1, 0.9) * zone.h) * G]
      : [(zone.x + range(rng, 0.1, 0.9) * zone.w) * G, (zone.y + (chance(rng, 0.5) ? range(rng, 0.04, 0.14) : range(rng, 0.86, 0.96)) * zone.h) * G];
    if (ctx.grid.has(point[0], point[1], F.WATER | F.BUILDING | F.PLAZA)) continue;
    const grove = blobPolygon(rng, point, range(rng, 2, 4.5) * G, { roughness: 0.28, points: 10 });
    ctx.sites.groves.push(grove);
    ctx.jobs.push({
      layerId: ctx.terrainId,
      path: plan.biome === 'winter' ? plan.palette.patches[0] : plan.palette.litter,
      softness: 0.45,
      region: clipMulti([grove], ctx.zonePoly),
      order: 15,
    });
  }
  if (plan.biome !== 'winter' && plan.palette.field.length) {
    const fields = clamp(Math.round(range(rng, 2, 6) * Math.max(0.5, plan.scale)), 1, 8);
    for (let i = 0; i < fields; i++) {
      const point: Point2D = [
        (zone.x + range(rng, 0.12, 0.88) * zone.w) * G,
        (zone.y + range(rng, 0.12, 0.88) * zone.h) * G,
      ];
      if (Math.hypot(point[0] - plan.center[0], point[1] - plan.center[1]) < plan.coreRadius * 1.05) continue;
      const angle = nearestRoadAngle(ctx, point);
      const length = range(rng, 5, 9) * G;
      const width = range(rng, 4, 7) * G;
      const parcel = rotatedRect(point[0], point[1], length, width, angle);
      if (!ctx.grid.areaFree(parcel, F.WATER | F.SHALLOW | F.ROAD | F.BUILDING | F.WALL | F.YARD | F.RESERVED, 0.4 * G)) continue;
      if (!inside(ctx, parcel)) continue;
      const strips = randInt(rng, 2, 5);
      const textures = [...plan.palette.field, plan.palette.fallow];
      for (let strip = 0; strip < strips; strip++) {
        const span = length / strips;
        const offset = -length / 2 + span * (strip + 0.5);
        const piece = rotatedRect(
          point[0] + Math.cos(angle) * offset,
          point[1] + Math.sin(angle) * offset,
          Math.max(G * 0.4, span - 0.24 * G),
          width * 0.92,
          angle
        );
        ctx.jobs.push({
          layerId: ctx.terrainId,
          path: textures[strip % textures.length],
          softness: 0.08,
          region: clipMulti([piece], ctx.zonePoly),
          order: 20,
        });
      }
      ctx.grid.stampPolygon(parcel, F.FIELD);
      if (chance(rng, 0.8)) {
        const ring = parcel[0];
        if (ring) addWall(ctx, ring.slice(0, Math.max(2, Math.ceil(ring.length / 2))), chance(rng, 0.5) ? 'hedge' : 'wood_fence', 8, false);
      }
    }
  }
  if (plan.junction) {
    const origin = plan.junction.point;
    const rocks = randInt(rng, 2, 4);
    for (let i = 0; i < rocks; i++) {
      const angle = rng.next() * Math.PI * 2;
      const dist = range(rng, 1.5, 3.5) * G;
      const point: Point2D = [origin[0] + Math.cos(angle) * dist, origin[1] + Math.sin(angle) * dist];
      if (ctx.grid.has(point[0], point[1], F.ROAD | F.WATER | F.BUILDING)) continue;
      const rock = blobPolygon(rng, point, range(rng, 0.8, 1.8) * G, { roughness: 0.2, points: 8 });
      ctx.sites.rocks.push(rock);
      ctx.grid.stampPolygon(rock, F.ROCK);
      ctx.jobs.push({
        layerId: ctx.terrainId,
        path: plan.palette.rock,
        softness: 0.2,
        region: clipMulti([rock], ctx.zonePoly),
        order: 60,
      });
    }
  }
}

function inside(ctx: ExteriorCtx, poly: Polygon2D): boolean {
  const { zone, G } = ctx;
  return (poly[0] ?? []).every(
    (point) =>
      point[0] > zone.x * G &&
      point[0] < (zone.x + zone.w) * G &&
      point[1] > zone.y * G &&
      point[1] < (zone.y + zone.h) * G
  );
}
