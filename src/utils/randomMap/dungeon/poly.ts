import polygonClipping from 'polygon-clipping';
import { circleToPolygon, GRID_SIZE, rectToPolygon, unionGeometry } from '../../geometry';
import { MultiPolygon2D, Point2D, Polygon2D } from '../../../types/dungeon';
import { clamp, pickFresh, Rng } from '../rng';
import { Rect } from '../types';

const G = GRID_SIZE;

export function pickName(rng: Rng, list: string[], used: Set<string>): string {
  return pickFresh(rng, list, used);
}

export function closeRing(points: Point2D[]): Polygon2D {
  if (points.length < 3) return [];
  const ring = points.map((point) => [point[0], point[1]] as Point2D);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return [ring];
}

export function rectPoly(rect: Rect): Polygon2D {
  return rectToPolygon(rect.x * G, rect.y * G, (rect.x + rect.w) * G, (rect.y + rect.h) * G);
}

export function asMulti(poly: Polygon2D): MultiPolygon2D {
  return poly.length ? [poly] : [];
}

export function batchUnion(parts: MultiPolygon2D[]): MultiPolygon2D {
  const list = parts.filter((part) => part && part.length > 0);
  if (!list.length) return [];
  let level = list;
  while (level.length > 1) {
    const next: MultiPolygon2D[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 >= level.length) next.push(level[i]);
      else next.push(unionGeometry(level[i], level[i + 1]));
    }
    level = next;
  }
  return level[0];
}

export function clipTo(region: MultiPolygon2D, mask: MultiPolygon2D): MultiPolygon2D {
  if (!region.length || !mask.length) return [];
  try {
    return polygonClipping.intersection(
      region as unknown as polygonClipping.Geom,
      mask as unknown as polygonClipping.Geom
    ) as unknown as MultiPolygon2D;
  } catch {
    return [];
  }
}

export function distToSeg(x: number, y: number, a: Point2D, b: Point2D): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  if (len < 1e-6) return Math.hypot(x - a[0], y - a[1]);
  const t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / len, 0, 1);
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

export function distToMulti(mp: MultiPolygon2D, x: number, y: number): number {
  let best = Infinity;
  for (const poly of mp) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length - 1; i++) {
        const dist = distToSeg(x, y, ring[i], ring[i + 1]);
        if (dist < best) best = dist;
      }
    }
  }
  return best;
}

export function simplify(points: Point2D[]): Point2D[] {
  const cleaned: Point2D[] = [];
  for (const point of points) {
    const last = cleaned[cleaned.length - 1];
    if (!last || Math.hypot(last[0] - point[0], last[1] - point[1]) > 0.75) cleaned.push(point);
  }
  if (cleaned.length <= 2) return cleaned;
  const out: Point2D[] = [cleaned[0]];
  for (let i = 1; i < cleaned.length - 1; i++) {
    const a = out[out.length - 1];
    const b = cleaned[i];
    const c = cleaned[i + 1];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(cross) > 0.5) out.push(b);
  }
  out.push(cleaned[cleaned.length - 1]);
  return out;
}

export function splitTail(points: Point2D[], length: number): { head: Point2D[]; tail: Point2D[] } {
  let remain = length;
  for (let i = points.length - 1; i > 0; i--) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (seg >= remain && seg > 0.1) {
      const t = remain / seg;
      const split: Point2D = [b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t];
      return { head: [...points.slice(0, i), split], tail: [split, ...points.slice(i)] };
    }
    remain -= seg;
  }
  return { head: [points[0]], tail: points.slice() };
}

export function circlesAlong(points: Point2D[], rng: Rng): MultiPolygon2D {
  if (points.length < 2) {
    const poly = circleToPolygon(points[0][0], points[0][1], 0.55 * G, 12);
    return asMulti(poly);
  }
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  const step = Math.max(0.5 * G, total / 36);
  const samples: Point2D[] = [];
  let pending = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 0.1) continue;
    const ux = dx / len;
    const uy = dy / len;
    let dist = step - pending;
    while (dist <= len) {
      const off = (rng.next() - 0.5) * 0.3 * G;
      samples.push([a[0] + ux * dist - uy * off, a[1] + uy * dist + ux * off]);
      dist += step;
    }
    pending = len - (dist - step);
    if (pending < 0) pending = 0;
  }
  if (!samples.length) samples.push(points[0], points[points.length - 1]);
  return batchUnion(samples.map((sample) => asMulti(circleToPolygon(sample[0], sample[1], 0.55 * G, 12))));
}
