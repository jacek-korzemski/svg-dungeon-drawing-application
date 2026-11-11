import { BuildingStyle, Point2D, Polygon2D } from '../../../types/dungeon';
import { clipMulti, pointAlong, polylineLength, rotatedRect } from '../curves';
import { chance, clamp, randInt, range } from '../rng';
import { PlacedBuilding, RoadLine } from '../types';
import { ExteriorCtx } from './context';
import { F } from './grid';
import { addWall } from './walls';

type Zone = 'core' | 'suburb' | 'rural';

const BLOCK = F.ROAD | F.PLAZA | F.WATER | F.SHALLOW | F.WALL | F.BUILDING | F.RESERVED | F.FIELD;

function zoneAt(ctx: ExteriorCtx, point: Point2D): Zone {
  const dist = Math.hypot(point[0] - ctx.plan.center[0], point[1] - ctx.plan.center[1]);
  if (ctx.grid.has(point[0], point[1], F.INSIDE_WALL) || dist < ctx.plan.coreRadius) return 'core';
  if (dist < ctx.plan.coreRadius * 1.8) return 'suburb';
  return 'rural';
}

function insideMap(ctx: ExteriorCtx, poly: Polygon2D): boolean {
  const { zone, G } = ctx;
  const minX = zone.x * G + 0.5 * G;
  const maxX = (zone.x + zone.w) * G - 0.5 * G;
  const minY = zone.y * G + 0.5 * G;
  const maxY = (zone.y + zone.h) * G - 0.5 * G;
  return (poly[0] ?? []).every((point) => point[0] > minX && point[0] < maxX && point[1] > minY && point[1] < maxY);
}

function styleFor(ctx: ExteriorCtx, zone: Zone): BuildingStyle {
  const winter = ctx.plan.biome === 'winter';
  const ruinP = zone === 'core' ? 0 : ctx.plan.wallMode === 'ruined' ? 0.08 : 0.03;
  if (chance(ctx.rng, ruinP)) return 'ruined_building';
  const roll = ctx.rng.next();
  if (zone === 'core') return roll < (winter ? 0.5 : 0.35) ? 'roof_slate' : 'roof_tile';
  if (zone === 'suburb') return roll < 0.6 ? 'roof_tile' : 'roof_thatch';
  return roll < (winter ? 0.65 : 0.8) ? 'roof_thatch' : 'roof_tile';
}

function remember(ctx: ExteriorCtx, poly: Polygon2D, style: BuildingStyle, placed: PlacedBuilding) {
  const list = ctx.buildings.get(style) ?? [];
  list.push(poly);
  ctx.buildings.set(style, list);
  ctx.grid.stampPolygon(poly, F.BUILDING, 0.1 * ctx.G);
  ctx.placed.push(placed);
}

function nearCrossing(ctx: ExteriorCtx, point: Point2D): boolean {
  const reach = 1.4 * ctx.G;
  for (const gate of ctx.sites.gates) {
    if (Math.hypot(gate.x - point[0], gate.y - point[1]) < reach + ctx.G) return true;
  }
  for (const crossing of ctx.sites.crossings) {
    if (Math.hypot(crossing[0] - point[0], crossing[1] - point[1]) < reach) return true;
  }
  return false;
}

function frontage(ctx: ExteriorCtx, road: RoadLine) {
  const G = ctx.G;
  for (const side of [1, -1]) {
    let s = range(ctx.rng, 0.5, 1.5) * G;
    let steps = 0;
    const limit = Math.ceil((road.length / (0.5 * G)) * 2);
    while (s < road.length - G && steps++ < limit) {
      const at = pointAlong(road.points, s);
      if (!at || nearCrossing(ctx, at.p)) {
        s += 0.5 * G;
        continue;
      }
      const zone = zoneAt(ctx, at.p);
      if (zone === 'rural' && chance(ctx.rng, 0.55)) {
        s += range(ctx.rng, 3, 7) * G;
        continue;
      }
      const front = (zone === 'core' ? range(ctx.rng, 1.4, 2.4) : zone === 'suburb' ? range(ctx.rng, 2, 3.4) : range(ctx.rng, 2.2, 3.6)) * G;
      const depth = (zone === 'core' ? range(ctx.rng, 2.6, 4) : zone === 'suburb' ? range(ctx.rng, 1.8, 2.6) : range(ctx.rng, 1.8, 2.8)) * G;
      const setback = (zone === 'core' ? range(ctx.rng, 0.1, 0.25) : zone === 'suburb' ? range(ctx.rng, 0.3, 0.8) : range(ctx.rng, 0.8, 2)) * G;
      const jitter = ((zone === 'core' ? 2 : zone === 'suburb' ? 5 : 12) * Math.PI) / 180;
      const angle = Math.atan2(at.tangent[1], at.tangent[0]) + range(ctx.rng, -jitter, jitter);
      const away: Point2D = [at.normal[0] * side, at.normal[1] * side];
      const cx = at.p[0] + away[0] * (road.halfWidth + setback + depth / 2);
      const cy = at.p[1] + away[1] * (road.halfWidth + setback + depth / 2);
      const poly = rotatedRect(cx, cy, front, depth, angle);
      const pad = (zone === 'core' ? 0.08 : zone === 'suburb' ? 0.35 : 0.6) * G;
      const wing = front >= 2.6 * G && zone !== 'core' && chance(ctx.rng, 0.2) ? wingOf(ctx, cx, cy, front, depth, angle, away) : null;
      const free = ctx.grid.areaFree(poly, BLOCK, pad) && insideMap(ctx, poly) && (!wing || (ctx.grid.areaFree(wing, BLOCK, pad) && insideMap(ctx, wing)));
      if (!free) {
        s += 0.5 * G;
        continue;
      }
      const style = styleFor(ctx, zone);
      const placed: PlacedBuilding = { poly, center: [cx, cy], angle, front, depth, away, zone, style };
      remember(ctx, poly, style, placed);
      if (wing) remember(ctx, wing, style, { ...placed, poly: wing, center: [cx + away[0] * (depth / 2), cy + away[1] * (depth / 2)] });
      if (zone !== 'rural' && chance(ctx.rng, 0.35)) {
        const ox = cx + away[0] * (depth / 2 + range(ctx.rng, 0.8, 1.6) * G);
        const oy = cy + away[1] * (depth / 2 + range(ctx.rng, 0.8, 1.6) * G);
        const outbuilding = rotatedRect(ox, oy, range(ctx.rng, 1.2, 2.2) * G, range(ctx.rng, 1.2, 2) * G, angle);
        if (ctx.grid.areaFree(outbuilding, BLOCK, 0.3 * G) && insideMap(ctx, outbuilding)) {
          const outStyle = chance(ctx.rng, 0.5) ? style : 'roof_thatch';
          remember(ctx, outbuilding, outStyle, { ...placed, poly: outbuilding, center: [ox, oy], style: outStyle });
        }
      }
      const gap = zone === 'core' ? range(ctx.rng, 0, 0.12) : zone === 'suburb' ? range(ctx.rng, 0.4, 1.2) : range(ctx.rng, 2, 6);
      s += front + gap * G;
    }
  }
}

function wingOf(ctx: ExteriorCtx, cx: number, cy: number, front: number, depth: number, angle: number, away: Point2D): Polygon2D {
  const wingFront = front * range(ctx.rng, 0.45, 0.6);
  const wingDepth = range(ctx.rng, 1, 2) * ctx.G;
  const along = chance(ctx.rng, 0.5) ? 0 : (chance(ctx.rng, 0.5) ? 1 : -1) * (front / 2 - wingFront / 2);
  const tx = Math.cos(angle);
  const ty = Math.sin(angle);
  const x = cx + tx * along + away[0] * (depth / 2 + wingDepth / 2);
  const y = cy + ty * along + away[1] * (depth / 2 + wingDepth / 2);
  return rotatedRect(x, y, wingFront, wingDepth, angle);
}

function farm(ctx: ExteriorCtx) {
  const roads = ctx.roads.filter((road) => road.klass !== 'main');
  if (!roads.length) return;
  const road = roads[Math.floor(ctx.rng.next() * roads.length)];
  const at = pointAlong(road.points, road.length * range(ctx.rng, 0.25, 0.8));
  if (!at) return;
  const side = chance(ctx.rng, 0.5) ? 1 : -1;
  const yard = range(ctx.rng, 3, 5) * ctx.G;
  const cx = at.p[0] + at.normal[0] * side * (road.halfWidth + yard);
  const cy = at.p[1] + at.normal[1] * side * (road.halfWidth + yard);
  if (zoneAt(ctx, [cx, cy]) === 'core') return;
  const yardPoly = rotatedRect(cx, cy, yard, yard, Math.atan2(at.tangent[1], at.tangent[0]));
  if (!ctx.grid.areaFree(yardPoly, BLOCK, 0.3 * ctx.G) || !insideMap(ctx, yardPoly)) return;
  ctx.grid.stampPolygon(yardPoly, F.YARD);
  ctx.jobs.push({
    layerId: ctx.terrainId,
    path: ctx.plan.palette.yard,
    softness: 0.35,
    region: clipMulti([yardPoly], ctx.zonePoly),
    order: 30,
  });
  const angle = Math.atan2(at.tangent[1], at.tangent[0]);
  const house = rotatedRect(cx - at.normal[0] * side * yard * 0.28, cy - at.normal[1] * side * yard * 0.28, range(ctx.rng, 2, 3) * ctx.G, range(ctx.rng, 1.6, 2.4) * ctx.G, angle);
  const barn = rotatedRect(cx + at.tangent[0] * yard * 0.28, cy + at.tangent[1] * yard * 0.28, range(ctx.rng, 4, 5) * ctx.G, range(ctx.rng, 2.5, 3.5) * ctx.G, angle + Math.PI / 2);
  if (ctx.grid.areaFree(house, BLOCK, 0.15 * ctx.G)) remember(ctx, house, chance(ctx.rng, 0.7) ? 'roof_thatch' : 'roof_tile', blank(house, angle, 'rural'));
  if (ctx.grid.areaFree(barn, BLOCK, 0.15 * ctx.G)) remember(ctx, barn, 'roof_thatch', blank(barn, angle, 'rural'));
  const style = chance(ctx.rng, 0.6) ? 'wood_fence' : 'hedge';
  const ring = yardPoly[0];
  if (ring && ring.length > 3) {
    const gap = 1.2 * ctx.G;
    addWall(ctx, ring.slice(0, Math.max(2, ring.length - 2)), style, style === 'hedge' ? 10 : 8, false);
    void gap;
  }
  if (chance(ctx.rng, 0.4)) ctx.sites.orchards.push([cx + at.tangent[0] * yard * 0.2, cy + at.tangent[1] * yard * 0.2]);
}

function blank(poly: Polygon2D, angle: number, zone: Zone): PlacedBuilding {
  const ring = poly[0];
  const center: Point2D = [0, 0];
  const n = Math.max(1, ring.length - 1);
  for (let i = 0; i < n; i++) {
    center[0] += ring[i][0];
    center[1] += ring[i][1];
  }
  center[0] /= n;
  center[1] /= n;
  return { poly, center, angle, front: 2, depth: 2, away: [Math.cos(angle + Math.PI / 2), Math.sin(angle + Math.PI / 2)], zone, style: 'roof_thatch' };
}

function specials(ctx: ExteriorCtx) {
  const { plan, rng, G } = ctx;
  if (plan.hasRiver && ctx.water && chance(rng, 0.7)) {
    const channel = ctx.water.channels.find((item) => item.kind === 'main');
    const sample = channel?.samples[Math.floor((channel.samples.length - 1) * range(rng, 0.3, 0.7))];
    if (sample) {
      const frame = pointAlong(channel.samples.map((item) => item.p), polylineLength(channel.samples.map((item) => item.p)) * 0.5);
      if (frame) {
        const mill = rotatedRect(
          sample.p[0] + frame.normal[0] * (sample.left + 1.6 * G),
          sample.p[1] + frame.normal[1] * (sample.left + 1.6 * G),
          3 * G,
          2.5 * G,
          Math.atan2(frame.tangent[1], frame.tangent[0])
        );
        if (ctx.grid.areaFree(mill, BLOCK, 0.2 * G) && insideMap(ctx, mill)) {
          remember(ctx, mill, chance(rng, 0.5) ? 'roof_tile' : 'roof_thatch', blank(mill, 0, 'rural'));
          const dock = rotatedRect(
            sample.p[0] + frame.normal[0] * sample.left * 0.3,
            sample.p[1] + frame.normal[1] * sample.left * 0.3,
            2.5 * G,
            G,
            Math.atan2(frame.normal[1], frame.normal[0])
          );
          ctx.jobs.push({ layerId: ctx.terrainId, path: 'deski.png', softness: 0, region: clipMulti([dock], ctx.zonePoly), order: 56 });
        }
      }
    }
  }
  if ((plan.archetype === 'market_town' || plan.archetype === 'river_crossing') && ctx.sites.plaza) {
    const center = plan.center;
    const temple = rotatedRect(center[0] + plan.coreRadius * 0.35, center[1], range(rng, 5.5, 7) * G, range(rng, 3, 3.5) * G, 0);
    if (ctx.grid.areaFree(temple, BLOCK, 0.3 * G) && insideMap(ctx, temple)) {
      remember(ctx, temple, 'roof_slate', blank(temple, 0, 'core'));
      const yard = rotatedRect(center[0] + plan.coreRadius * 0.35, center[1] + 5 * G, range(rng, 4, 6) * G, range(rng, 3, 5) * G, 0);
      if (insideMap(ctx, yard)) {
        ctx.sites.cemetery = yard;
        ctx.jobs.push({ layerId: ctx.terrainId, path: plan.palette.fallow, softness: 0.2, region: clipMulti([yard], ctx.zonePoly), order: 20 });
        const ring = yard[0];
        if (ring) addWall(ctx, ring.slice(0, ring.length - 1), 'stone_wall', 10, false);
        ctx.doors.push({
          id: ctx.id('dr'),
          x: center[0] + plan.coreRadius * 0.35,
          y: center[1] + 5 * G - (range(rng, 3, 5) * G) / 2,
          rotation: 0,
          type: 'archway',
          widthCells: 1,
        });
      }
    }
  }
  const gate = ctx.sites.gates[0];
  if (gate) {
    const tavern = rotatedRect(gate.inside[0], gate.inside[1], 4.5 * G, 3 * G, (gate.angle * Math.PI) / 180);
    if (ctx.grid.areaFree(tavern, BLOCK, 0.25 * G) && insideMap(ctx, tavern)) {
      remember(ctx, tavern, 'roof_tile', blank(tavern, (gate.angle * Math.PI) / 180, 'suburb'));
      ctx.sites.tavern = { center: [gate.inside[0], gate.inside[1]], angle: (gate.angle * Math.PI) / 180 };
      const yard = rotatedRect(gate.x, gate.y, 2.2 * G, 2.2 * G, 0);
      ctx.jobs.push({ layerId: ctx.terrainId, path: plan.palette.yard, softness: 0.4, region: clipMulti([yard], ctx.zonePoly), order: 30 });
    }
  }
  if ((plan.wallMode === 'none' || plan.wallMode === 'ruined') && chance(rng, 0.7)) {
    const road = ctx.roads.find((item) => item.klass === 'main');
    const at = road ? pointAlong(road.points, road.length * 0.75) : null;
    if (at) {
      const tower = rotatedRect(at.p[0] + at.normal[0] * 3 * G, at.p[1] + at.normal[1] * 3 * G, 2 * G, 2 * G, 0);
      if (ctx.grid.areaFree(tower, BLOCK, 0.4 * G) && insideMap(ctx, tower)) {
        remember(ctx, tower, 'roof_slate', blank(tower, 0, 'rural'));
        const ring = rotatedRect(at.p[0] + at.normal[0] * 3 * G, at.p[1] + at.normal[1] * 3 * G, 3.4 * G, 3.4 * G, 0)[0];
        if (ring) addWall(ctx, ring.slice(0, ring.length - 1), 'palisade_logs', 12, true);
      }
    }
  }
  if (plan.archetype === 'crossroads_hamlets' && chance(rng, 0.4)) {
    const road = ctx.roads[0];
    const at = road ? pointAlong(road.points, road.length * range(rng, 0.4, 0.7)) : null;
    if (at) {
      ctx.sites.camp = [at.p[0] + at.normal[0] * 2 * G, at.p[1] + at.normal[1] * 2 * G];
      const clearing = rotatedRect(ctx.sites.camp[0], ctx.sites.camp[1], 3 * G, 3 * G, 0);
      ctx.jobs.push({ layerId: ctx.terrainId, path: plan.palette.yard, softness: 0.4, region: clipMulti([clearing], ctx.zonePoly), order: 30 });
      for (let i = 0; i < randInt(rng, 2, 3); i++) {
        const tent = rotatedRect(ctx.sites.camp[0] + range(rng, -G, G), ctx.sites.camp[1] + range(rng, -G, G), 1.6 * G, 1.2 * G, rng.next() * Math.PI);
        if (ctx.grid.areaFree(tent, BLOCK, 0.1 * G)) remember(ctx, tent, 'roof_thatch', blank(tent, 0, 'rural'));
      }
    }
  }
}

export function buildSettlement(ctx: ExteriorCtx) {
  const order: RoadLine['klass'][] = ['main', 'secondary', 'lane'];
  for (const klass of order) {
    for (const road of ctx.roads.filter((item) => item.klass === klass)) frontage(ctx, road);
  }
  const farms = clamp(Math.round(range(ctx.rng, 2, 5) * Math.max(0.5, ctx.plan.scale)), 1, 8);
  for (let i = 0; i < farms; i++) farm(ctx);
  specials(ctx);
  if (ctx.plan.archetype === 'market_town') {
    for (let i = 0; i < 6; i++) {
      const point: Point2D = [
        ctx.plan.center[0] + range(ctx.rng, -0.6, 0.6) * ctx.plan.coreRadius,
        ctx.plan.center[1] + range(ctx.rng, -0.6, 0.6) * ctx.plan.coreRadius,
      ];
      if (ctx.grid.has(point[0], point[1], F.BUILDING | F.ROAD | F.PLAZA | F.WATER)) continue;
      const yard = rotatedRect(point[0], point[1], range(ctx.rng, 1.4, 2.4) * ctx.G, range(ctx.rng, 1.4, 2.4) * ctx.G, ctx.rng.next());
      if (!ctx.grid.areaFree(yard, F.BUILDING | F.ROAD | F.WATER, 0.1 * ctx.G)) continue;
      ctx.jobs.push({ layerId: ctx.terrainId, path: ctx.plan.palette.yard, softness: 0.4, region: clipMulti([yard], ctx.zonePoly), order: 30 });
      ctx.grid.stampPolygon(yard, F.YARD);
    }
  }
}
