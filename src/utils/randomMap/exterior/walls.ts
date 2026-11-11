import { Point2D, Polygon2D } from '../../../types/dungeon';
import { DoorType, ExteriorWallStyle } from '../../../types/dungeon';
import { containsPoint, polygonCentroid, rotatedRect, segmentHit } from '../curves';
import { chance, clamp, randInt, range, Rng } from '../rng';
import { RoadLine, WallChain } from '../types';
import { ExteriorCtx } from './context';
import { F } from './grid';

function ringOf(center: Point2D, radii: number[], rotation: number): Point2D[] {
  return radii.map((radius, index) => {
    const angle = rotation + (index / radii.length) * Math.PI * 2;
    return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius] as Point2D;
  });
}

function smoothRadii(radii: number[]): number[] {
  return radii.map((value, index) => {
    const prev = radii[(index - 1 + radii.length) % radii.length];
    const next = radii[(index + 1) % radii.length];
    return prev * 0.25 + value * 0.5 + next * 0.25;
  });
}

function almostConvex(center: Point2D, points: Point2D[]): Point2D[] {
  const out = points.map((point) => [point[0], point[1]] as Point2D);
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (let i = 0; i < out.length; i++) {
      const prev = out[(i - 1 + out.length) % out.length];
      const cur = out[i];
      const next = out[(i + 1) % out.length];
      const ax = cur[0] - prev[0];
      const ay = cur[1] - prev[1];
      const bx = next[0] - cur[0];
      const by = next[1] - cur[1];
      const cross = ax * by - ay * bx;
      const wind = (cur[0] - center[0]) * (next[1] - cur[1]) - (cur[1] - center[1]) * (next[0] - cur[0]);
      if (cross * wind < 0) {
        out[i] = [center[0] + (cur[0] - center[0]) * 1.1, center[1] + (cur[1] - center[1]) * 1.1];
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

function clampRing(points: Point2D[], ctx: ExteriorCtx): Point2D[] {
  const { zone, G } = ctx;
  const minX = zone.x * G + 2 * G;
  const maxX = (zone.x + zone.w) * G - 2 * G;
  const minY = zone.y * G + 2 * G;
  const maxY = (zone.y + zone.h) * G - 2 * G;
  return points.map((point) => [clamp(point[0], minX, maxX), clamp(point[1], minY, maxY)]);
}

function hitsBlocked(points: Point2D[], ctx: ExteriorCtx): boolean {
  for (const point of points) {
    if (ctx.grid.has(point[0], point[1], F.RESERVED | F.WATER)) return true;
    if (ctx.water?.blocked.some((poly) => containsPoint(poly, point[0], point[1]))) return true;
  }
  return false;
}

export function irregularPolygon(rng: Rng, center: Point2D, radius: number, count: number): Point2D[] {
  const rotation = rng.next() * Math.PI * 2;
  let radii = Array.from({ length: count }, () => radius * range(rng, 0.85, 1.15));
  radii = smoothRadii(radii);
  return almostConvex(center, ringOf(center, radii, rotation));
}

function closePoly(points: Point2D[]): Polygon2D {
  const ring = points.map((point) => [point[0], point[1]] as Point2D);
  ring.push([ring[0][0], ring[0][1]]);
  return [ring];
}

function scaleAbout(points: Point2D[], center: Point2D, factor: number): Point2D[] {
  return points.map((point) => [center[0] + (point[0] - center[0]) * factor, center[1] + (point[1] - center[1]) * factor]);
}

export function placeCastle(ctx: ExteriorCtx) {
  if (!ctx.plan.wantCastle || !ctx.plan.castleAt) return;
  const { rng, G } = ctx;
  const center = ctx.plan.castleAt;
  const radius = range(rng, 3, 4.5) * G;
  let points = irregularPolygon(rng, center, radius, randInt(rng, 5, 7));
  points = clampRing(points, ctx);
  if (hitsBlocked(points, ctx)) return;
  const centroid = polygonCentroid(closePoly(points));
  const factor = Math.max(0.35, (radius - 1.4 * G) / radius);
  const hole = scaleAbout(points, centroid, factor);
  const outer = closePoly(points);
  const holePoly = closePoly(hole);
  const footprint: Polygon2D = [outer[0], holePoly[0]];
  const list = ctx.buildings.get('castle_wall') ?? [];
  list.push(footprint);
  ctx.buildings.set('castle_wall', list);
  ctx.grid.stampPolygon(footprint, F.BUILDING, 0.2 * G);
  let gate = points[0];
  let gateAngle = 0;
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const mid: Point2D = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const dist = Math.hypot(mid[0] - ctx.plan.center[0], mid[1] - ctx.plan.center[1]);
    if (dist < best) {
      best = dist;
      gate = mid;
      gateAngle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    }
  }
  ctx.castle = { outer, courtyard: holePoly, gate, center: centroid };
  ctx.doors.push({
    id: ctx.id('dr'),
    x: gate[0],
    y: gate[1],
    rotation: gateAngle,
    type: 'gatehouse',
    widthCells: 2,
  });
  const dx = gate[0] - centroid[0];
  const dy = gate[1] - centroid[1];
  const len = Math.hypot(dx, dy) || 1;
  const keepCenter: Point2D = [centroid[0] - (dx / len) * radius * 0.15, centroid[1] - (dy / len) * radius * 0.15];
  const keep = rotatedRect(keepCenter[0], keepCenter[1], range(rng, 2, 3) * G, range(rng, 2.5, 3.5) * G, Math.atan2(dy, dx));
  if (containsPoint(holePoly, keepCenter[0], keepCenter[1]) && ctx.grid.areaFree(keep, F.BUILDING | F.WATER | F.ROAD, 0.2 * G)) {
    const keeps = ctx.buildings.get('roof_slate') ?? [];
    keeps.push(keep);
    ctx.buildings.set('roof_slate', keeps);
    ctx.grid.stampPolygon(keep, F.BUILDING, 0.1 * G);
  }
}

export function castleApproach(ctx: ExteriorCtx): Point2D | null {
  if (!ctx.castle) return null;
  const gate = ctx.castle.gate;
  const center = ctx.castle.center;
  const dx = gate[0] - center[0];
  const dy = gate[1] - center[1];
  const len = Math.hypot(dx, dy) || 1;
  return [gate[0] + (dx / len) * 0.8 * ctx.G, gate[1] + (dy / len) * 0.8 * ctx.G];
}

function wallStyle(ctx: ExteriorCtx): { style: ExteriorWallStyle; thickness: number } {
  const { rng, plan } = ctx;
  if (plan.biome === 'wetland' || plan.archetype === 'castle_bailey') {
    return chance(rng, plan.archetype === 'castle_bailey' ? 0.7 : 0.65)
      ? { style: 'palisade_logs', thickness: 12 }
      : { style: 'stone_wall', thickness: 10 };
  }
  if (plan.wallMode === 'ruined') {
    return chance(rng, 0.6) ? { style: 'stone_wall', thickness: 10 } : { style: 'castle_crenellated', thickness: 14 };
  }
  return chance(rng, 0.6) ? { style: 'castle_crenellated', thickness: 14 } : { style: 'stone_wall', thickness: 10 };
}

function gateType(style: ExteriorWallStyle): { type: DoorType; width: number } {
  if (style === 'castle_crenellated') return { type: 'gatehouse', width: 2 };
  if (style === 'palisade_logs') return { type: 'wood_gate', width: 1.5 };
  return { type: 'wood_gate', width: 1.5 };
}

function pointInWater(ctx: ExteriorCtx, x: number, y: number): boolean {
  if (ctx.grid.has(x, y, F.WATER | F.SHALLOW)) return true;
  return false;
}

function splitByWater(points: Point2D[], ctx: ExteriorCtx, partial: boolean): Point2D[][] {
  if (!partial) return [points.concat([points[0]])];
  const chains: Point2D[][] = [];
  let current: Point2D[] = [];
  const samples: { p: Point2D; wet: boolean }[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(len / (0.1 * ctx.G)));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const p: Point2D = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      samples.push({ p, wet: pointInWater(ctx, p[0], p[1]) });
    }
  }
  for (const sample of samples) {
    if (sample.wet) {
      if (current.length > 1) chains.push(current);
      current = [];
    } else current.push(sample.p);
  }
  if (current.length > 1) chains.push(current);
  return chains.sort((a, b) => polyline(b) - polyline(a)).slice(0, 2);
}

function polyline(points: Point2D[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return total;
}

function cutGaps(chain: Point2D[], gaps: { t: number; half: number }[]): Point2D[][] {
  const length = polyline(chain);
  if (length < 1) return [];
  const marks = gaps
    .map((gap) => ({ lo: clamp(gap.t - gap.half, 0, length), hi: clamp(gap.t + gap.half, 0, length) }))
    .filter((gap) => gap.hi > gap.lo)
    .sort((a, b) => a.lo - b.lo);
  const spans: [number, number][] = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.lo > cursor + 8) spans.push([cursor, mark.lo]);
    cursor = Math.max(cursor, mark.hi);
  }
  if (length > cursor + 8) spans.push([cursor, length]);
  return spans.map(([start, end]) => sliceChain(chain, start, end)).filter((part) => part.length > 1);
}

function sliceChain(chain: Point2D[], start: number, end: number): Point2D[] {
  const out: Point2D[] = [];
  let walked = 0;
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1];
    const b = chain[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const segEnd = walked + len;
    if (segEnd >= start && walked <= end && len > 0.1) {
      const t0 = clamp((start - walked) / len, 0, 1);
      const t1 = clamp((end - walked) / len, 0, 1);
      if (!out.length) out.push([a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0]);
      out.push([a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]);
    }
    walked = segEnd;
  }
  return out;
}

function chainDistance(chain: Point2D[], point: Point2D): { t: number; angle: number } | null {
  let walked = 0;
  let best = Infinity;
  let at = 0;
  let angle = 0;
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1];
    const b = chain[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const len = Math.sqrt(len2);
    if (len < 0.1) continue;
    const u = clamp(((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len2, 0, 1);
    const px = a[0] + dx * u;
    const py = a[1] + dy * u;
    const dist = Math.hypot(point[0] - px, point[1] - py);
    if (dist < best) {
      best = dist;
      at = walked + len * u;
      angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    }
    walked += len;
  }
  if (best > 36) return null;
  return { t: at, angle };
}

export function addWall(ctx: ExteriorCtx, points: Point2D[], style: ExteriorWallStyle, thickness: number, towers: boolean) {
  if (points.length < 2) return;
  ctx.walls.push({
    id: ctx.id('sw'),
    points,
    wallStyle: 'straight',
    thickness,
    exteriorWallStyle: style,
    hasTowers: towers,
  });
  for (let i = 1; i < points.length; i++) {
    ctx.grid.stampCapsule(points[i - 1], points[i], thickness / 2 + 0.6 * ctx.G, F.WALL);
  }
}

function ruinGaps(chain: Point2D[], ctx: ExteriorCtx): Point2D[][] {
  const length = polyline(chain);
  const gaps = 3 + Math.floor(ctx.rng.next() * 4);
  const cuts: { t: number; half: number }[] = [];
  for (let i = 0; i < gaps; i++) {
    cuts.push({ t: length * ((i + 0.5) / gaps) + range(ctx.rng, -0.04, 0.04) * length, half: range(ctx.rng, 0.75, 2) * ctx.G });
  }
  const kept = cutGaps(chain.concat(chain.length > 2 && chain[0] !== chain[chain.length - 1] ? [] : []), cuts);
  for (const cut of cuts) {
    const at = sliceChain(chain, cut.t, cut.t);
    if (!at.length) continue;
    for (let n = 0; n < randInt(ctx.rng, 1, 3); n++) {
      const poly = rotatedRect(
        at[0][0] + range(ctx.rng, -0.4, 0.4) * ctx.G,
        at[0][1] + range(ctx.rng, -0.4, 0.4) * ctx.G,
        range(ctx.rng, 0.8, 1.2) * ctx.G,
        range(ctx.rng, 1, 1.6) * ctx.G,
        ctx.rng.next() * Math.PI
      );
      const list = ctx.buildings.get('ruined_building') ?? [];
      list.push(poly);
      ctx.buildings.set('ruined_building', list);
      ctx.grid.stampPolygon(poly, F.BUILDING, 0.05 * ctx.G);
    }
  }
  return kept.length ? kept : [chain];
}

export function buildTownWalls(ctx: ExteriorCtx) {
  const { plan, rng, G } = ctx;
  if (plan.wallMode === 'none') return;
  let radius = plan.coreRadius;
  let center = plan.center;
  let points: Point2D[] | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const raw = clampRing(irregularPolygon(rng, center, radius, randInt(rng, 7, 11)), ctx);
    if (!hitsBlocked(raw, ctx)) {
      points = raw;
      break;
    }
    radius *= 0.9;
    center = [
      clamp(center[0] + range(rng, -G, G), ctx.zone.x * G + 4 * G, (ctx.zone.x + ctx.zone.w) * G - 4 * G),
      clamp(center[1] + range(rng, -G, G), ctx.zone.y * G + 4 * G, (ctx.zone.y + ctx.zone.h) * G - 4 * G),
    ];
  }
  if (!points) {
    plan.wallMode = 'none';
    return;
  }
  const outline = closePoly(points);
  ctx.insideWall = outline;
  ctx.grid.stampPolygon(outline, F.INSIDE_WALL);
  const partial = plan.wallMode === 'partial';
  let chains = splitByWater(points, ctx, partial);
  if (plan.wallMode === 'ruined') chains = chains.flatMap((chain) => ruinGaps(chain[0] === chain[chain.length - 1] ? chain.slice(0, -1) : chain, ctx));
  const look = wallStyle(ctx);
  const closedChains = chains.map((chain) => (chain.length > 2 && (chain[0][0] !== chain[chain.length - 1][0] || chain[0][1] !== chain[chain.length - 1][1]) && !partial && plan.wallMode !== 'ruined' ? chain.concat([[chain[0][0], chain[0][1]]]) : chain));
  const roads = ctx.roads.filter((road) => road.klass !== 'lane');
  const lanes = ctx.roads.filter((road) => road.klass === 'lane');
  const pieces: WallChain[] = [];
  for (const chain of closedChains) {
    const gaps: { t: number; half: number }[] = [];
    const consider = (road: RoadLine, lane: boolean) => {
      for (let i = 1; i < road.points.length && i < chain.length + road.points.length; i++) {
        for (let c = 1; c < chain.length; c++) {
          const hit = segmentHit(road.points[i - 1], road.points[i], chain[c - 1], chain[c]);
          if (!hit) continue;
          const along = chainDistance(chain, hit);
          if (!along) continue;
          const spec = lane ? { type: 'archway' as const, width: 1 } : gateType(look.style);
          gaps.push({ t: along.t, half: (spec.width * G) / 2 + 0.1 * G });
          ctx.doors.push({
            id: ctx.id('dr'),
            x: hit[0],
            y: hit[1],
            rotation: along.angle,
            type: spec.type,
            widthCells: spec.width,
          });
          const dx = chain[c][0] - chain[c - 1][0];
          const dy = chain[c][1] - chain[c - 1][1];
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          const insideSign = (ctx.plan.center[0] - hit[0]) * nx + (ctx.plan.center[1] - hit[1]) * ny > 0 ? 1 : -1;
          ctx.sites.gates.push({
            x: hit[0],
            y: hit[1],
            inside: [hit[0] + nx * insideSign * G, hit[1] + ny * insideSign * G],
            angle: along.angle,
          });
        }
      }
    };
    for (const road of roads) consider(road, false);
    for (const road of lanes) consider(road, true);
    if (!partial && plan.wallMode !== 'ruined' && ctx.water?.deep.length) {
      const length = polyline(chain);
      let walked = 0;
      for (let i = 1; i < chain.length; i++) {
        const a = chain[i - 1];
        const b = chain[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const steps = Math.max(1, Math.ceil(len / (0.1 * G)));
        let wetStart = -1;
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const x = a[0] + (b[0] - a[0]) * t;
          const y = a[1] + (b[1] - a[1]) * t;
          const wet = ctx.grid.has(x, y, F.WATER);
          if (wet && wetStart < 0) wetStart = walked + len * t;
          if ((!wet || s === steps) && wetStart >= 0) {
            const wetEnd = walked + len * t;
            gaps.push({ t: (wetStart + wetEnd) / 2, half: (wetEnd - wetStart) / 2 + 0.3 * G });
            ctx.doors.push({
              id: ctx.id('dr'),
              x: a[0] + (b[0] - a[0]) * ((wetStart + wetEnd) / 2 - walked) / (len || 1),
              y: a[1] + (b[1] - a[1]) * ((wetStart + wetEnd) / 2 - walked) / (len || 1),
              rotation: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI,
              type: 'portcullis',
              widthCells: Math.max(1, (wetEnd - wetStart) / G),
            });
            wetStart = -1;
          }
        }
        walked += len;
        if (walked > length) break;
      }
    }
    const towers = look.style !== 'stone_wall' && (plan.wallMode === 'ruined' ? chance(rng, 0.5) : true);
    for (const part of gaps.length ? cutGaps(chain, gaps) : [chain]) {
      if (polyline(part) < 0.5 * G) continue;
      pieces.push({ points: part, style: look.style, thickness: look.thickness, towers });
    }
  }
  for (const piece of pieces) addWall(ctx, piece.points, piece.style, piece.thickness, piece.towers);
}
