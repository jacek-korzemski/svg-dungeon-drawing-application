import polygonClipping from 'polygon-clipping';
import { MultiPolygon2D, Point2D, Polygon2D, Ring2D } from '../../types/dungeon';
import { unionGeometry } from '../geometry';
import { createNoise1D } from './noise';
import { Rng } from './rng';
import { RibbonSample } from './types';

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function hypot(dx: number, dy: number): number {
  return Math.hypot(dx, dy);
}

export function polylineLength(points: Point2D[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return total;
}

export function cumulative(points: Point2D[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    out.push(out[i - 1] + hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  return out;
}

export function resample(points: Point2D[], step: number): Point2D[] {
  if (points.length < 2 || step <= 0) return points.map((p) => [p[0], p[1]] as Point2D);
  const total = polylineLength(points);
  if (total < step) return [[points[0][0], points[0][1]], [points[points.length - 1][0], points[points.length - 1][1]]];
  const out: Point2D[] = [[points[0][0], points[0][1]]];
  let cursor = step;
  let seg = 0;
  let base = 0;
  while (cursor < total - step * 0.25 && seg < points.length - 1) {
    const a = points[seg];
    const b = points[seg + 1];
    const len = hypot(b[0] - a[0], b[1] - a[1]);
    if (base + len >= cursor && len > 1e-6) {
      const t = (cursor - base) / len;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      cursor += step;
    } else {
      base += len;
      seg += 1;
    }
  }
  const last = points[points.length - 1];
  out.push([last[0], last[1]]);
  return out;
}

export function chaikin(points: Point2D[], iterations: number, keepEnds = true): Point2D[] {
  let current = points;
  for (let k = 0; k < iterations; k++) {
    if (current.length < 3) break;
    const next: Point2D[] = keepEnds ? [[current[0][0], current[0][1]]] : [];
    for (let i = 0; i < current.length - 1; i++) {
      const a = current[i];
      const b = current[i + 1];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (keepEnds) {
      const end = current[current.length - 1];
      next.push([end[0], end[1]]);
    }
    current = next;
  }
  return current;
}

function knot(ti: number, a: Point2D, b: Point2D): number {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return ti + Math.sqrt(Math.max(d, 1e-6));
}

function mix(a: Point2D, b: Point2D, ta: number, tb: number, t: number): Point2D {
  const span = tb - ta;
  if (Math.abs(span) < 1e-8) return [a[0], a[1]];
  const u = (t - ta) / span;
  return [a[0] * (1 - u) + b[0] * u, a[1] * (1 - u) + b[1] * u];
}

function crPoint(p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D, t: number): Point2D {
  const t0 = 0;
  const t1 = knot(t0, p0, p1);
  const t2 = knot(t1, p1, p2);
  const t3 = knot(t2, p2, p3);
  const u = t1 + (t2 - t1) * t;
  const a1 = mix(p0, p1, t0, t1, u);
  const a2 = mix(p1, p2, t1, t2, u);
  const a3 = mix(p2, p3, t2, t3, u);
  const b1 = mix(a1, a2, t0, t2, u);
  const b2 = mix(a2, a3, t1, t3, u);
  return mix(b1, b2, t1, t2, u);
}

export function catmullRomCentripetal(points: Point2D[], step: number, closed = false): Point2D[] {
  if (points.length < 2) return points.map((p) => [p[0], p[1]] as Point2D);
  const src = points;
  const n = src.length;
  const out: Point2D[] = [];
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const i0 = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
    const i1 = closed ? i % n : i;
    const i2 = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    const i3 = closed ? (i + 2) % n : Math.min(n - 1, i + 2);
    let p0 = src[i0];
    let p3 = src[i3];
    const p1 = src[i1];
    const p2 = src[i2];
    if (!closed && i === 0) p0 = [p1[0] * 2 - p2[0], p1[1] * 2 - p2[1]];
    if (!closed && i === spans - 1) p3 = [p2[0] * 2 - p1[0], p2[1] * 2 - p1[1]];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const pieces = Math.max(1, Math.ceil(len / Math.max(step, 1)));
    for (let s = 0; s < pieces; s++) out.push(crPoint(p0, p1, p2, p3, s / pieces));
  }
  const end = src[closed ? 0 : n - 1];
  out.push([end[0], end[1]]);
  return out;
}

export function smoothPath(points: Point2D[], step: number): Point2D[] {
  if (points.length < 2) return points.map((p) => [p[0], p[1]] as Point2D);
  return catmullRomCentripetal(chaikin(points, 2, true), step, false);
}

export interface Frame {
  p: Point2D;
  t: Point2D;
  n: Point2D;
  k: number;
}

export function frames(points: Point2D[]): Frame[] {
  const out: Frame[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const cur = points[i];
    let tx = 0;
    let ty = 0;
    if (i > 0) {
      const dx = cur[0] - prev[0];
      const dy = cur[1] - prev[1];
      const len = Math.hypot(dx, dy) || 1;
      tx += dx / len;
      ty += dy / len;
    }
    if (i < points.length - 1) {
      const dx = next[0] - cur[0];
      const dy = next[1] - cur[1];
      const len = Math.hypot(dx, dy) || 1;
      tx += dx / len;
      ty += dy / len;
    }
    const tlen = Math.hypot(tx, ty) || 1;
    tx /= tlen;
    ty /= tlen;
    const nx = -ty;
    const ny = tx;
    let k = 0;
    if (i > 0 && i < points.length - 1) {
      const inX = cur[0] - prev[0];
      const inY = cur[1] - prev[1];
      const outX = next[0] - cur[0];
      const outY = next[1] - cur[1];
      const inLen = Math.hypot(inX, inY);
      const outLen = Math.hypot(outX, outY);
      const cross = inX * outY - inY * outX;
      const dot = inX * outX + inY * outY;
      const angle = Math.atan2(cross, dot);
      const avg = (inLen + outLen) / 2 || 1;
      k = angle / avg;
    }
    out.push({ p: cur, t: [tx, ty], n: [nx, ny], k });
  }
  return out;
}

function close(points: Point2D[]): Ring2D {
  if (points.length < 3) return [];
  const ring = points.map((p) => [p[0], p[1]] as Point2D);
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) ring.push([a[0], a[1]]);
  return ring;
}

function capArc(p: Point2D, n: Point2D, t: Point2D, left: number, right: number): Point2D[] {
  const pts: Point2D[] = [];
  const bulge = (left + right) * 0.5;
  const steps = 6;
  for (let i = 1; i < steps; i++) {
    const theta = (Math.PI * i) / steps;
    const radial = lerp(left, right, theta / Math.PI);
    pts.push([
      p[0] + n[0] * Math.cos(theta) * radial + t[0] * Math.sin(theta) * bulge,
      p[1] + n[1] * Math.cos(theta) * radial + t[1] * Math.sin(theta) * bulge,
    ]);
  }
  return pts;
}

function ringSelfIntersects(ring: Point2D[]): boolean {
  const n = ring.length - 1;
  const hits = (a: Point2D, b: Point2D, c: Point2D, d: Point2D) => {
    const rx = b[0] - a[0];
    const ry = b[1] - a[1];
    const qx = d[0] - c[0];
    const qy = d[1] - c[1];
    const denom = rx * qy - ry * qx;
    if (Math.abs(denom) < 1e-8) return false;
    const t = ((c[0] - a[0]) * qy - (c[1] - a[1]) * qx) / denom;
    const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / denom;
    return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (hits(ring[i], ring[i + 1], ring[j], ring[j + 1])) return true;
    }
  }
  return false;
}

function batchUnion(parts: MultiPolygon2D[]): MultiPolygon2D {
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

function quadsFromOffsets(left: Point2D[], right: Point2D[]): MultiPolygon2D {
  const quads: MultiPolygon2D[] = [];
  for (let i = 0; i < left.length - 1; i++) {
    const ring = close([left[i], left[i + 1], right[i + 1], right[i]]);
    if (ring.length) quads.push([[ring]]);
  }
  const groups: MultiPolygon2D[] = [];
  for (let i = 0; i < quads.length; i += 16) groups.push(batchUnion(quads.slice(i, i + 16)));
  return batchUnion(groups);
}

function simplifyOffsets(samples: RibbonSample[], framed: Frame[]): { left: Point2D[]; right: Point2D[] } {
  const left: Point2D[] = [];
  const right: Point2D[] = [];
  for (let i = 0; i < samples.length; i++) {
    const frame = framed[i];
    let l = Math.max(0.5, samples[i].left);
    let r = Math.max(0.5, samples[i].right);
    const radius = Math.abs(frame.k) > 1e-4 ? 1 / Math.abs(frame.k) : Infinity;
    if (frame.k > 0) l = Math.min(l, radius * 0.85);
    else if (frame.k < 0) r = Math.min(r, radius * 0.85);
    left.push([frame.p[0] + frame.n[0] * l, frame.p[1] + frame.n[1] * l]);
    right.push([frame.p[0] - frame.n[0] * r, frame.p[1] - frame.n[1] * r]);
  }
  return { left, right };
}

export function ribbonPolygon(
  samples: RibbonSample[],
  opts?: { capStart?: 'flat' | 'round'; capEnd?: 'flat' | 'round' }
): MultiPolygon2D {
  if (samples.length < 2) return [];
  const framed = frames(samples.map((sample) => sample.p));
  const { left, right } = simplifyOffsets(samples, framed);
  const capStart = opts?.capStart ?? 'flat';
  const capEnd = opts?.capEnd ?? 'flat';
  const ringPts: Point2D[] = [...left];
  if (capEnd === 'round') {
    const last = samples.length - 1;
    ringPts.push(...capArc(framed[last].p, framed[last].n, framed[last].t, samples[last].left, samples[last].right));
  }
  for (let i = right.length - 1; i >= 0; i--) ringPts.push(right[i]);
  if (capStart === 'round') {
    const arc = capArc(framed[0].p, framed[0].n, [-framed[0].t[0], -framed[0].t[1]], samples[0].left, samples[0].right);
    arc.reverse();
    ringPts.push(...arc);
  }
  const ring = close(ringPts);
  if (ring.length < 4) return [];
  if (!ringSelfIntersects(ring)) {
    try {
      const unified = polygonClipping.union([ring] as unknown as polygonClipping.Geom) as unknown as MultiPolygon2D;
      if (unified?.length) return simplifyMulti(unified, 0.45);
    } catch {
      // Fall through to the quad union.
    }
  }
  return simplifyMulti(quadsFromOffsets(left, right), 0.45);
}

function perp(dx: number, dy: number): Point2D {
  const len = Math.hypot(dx, dy) || 1;
  return [-dy / len, dx / len];
}

export function polylineRibbonMiter(points: Point2D[], width: number): MultiPolygon2D {
  if (points.length < 2 || width <= 1) return [];
  const h = width / 2;
  const parts: MultiPolygon2D[] = [];
  const pushPoly = (pts: Point2D[]) => {
    const ring = close(pts);
    if (ring.length >= 4) parts.push([[ring]]);
  };
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 0.5) continue;
    const ux = dx / len;
    const uy = dy / len;
    const n = perp(dx, dy);
    const startExtra = i === 0 ? h : 0;
    const endExtra = i === points.length - 2 ? h : 0;
    const a0: Point2D = [a[0] - ux * startExtra, a[1] - uy * startExtra];
    const b0: Point2D = [b[0] + ux * endExtra, b[1] + uy * endExtra];
    pushPoly([
      [a0[0] + n[0] * h, a0[1] + n[1] * h],
      [b0[0] + n[0] * h, b0[1] + n[1] * h],
      [b0[0] - n[0] * h, b0[1] - n[1] * h],
      [a0[0] - n[0] * h, a0[1] - n[1] * h],
    ]);
  }
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const v = points[i];
    const next = points[i + 1];
    const ax = v[0] - prev[0];
    const ay = v[1] - prev[1];
    const bx = next[0] - v[0];
    const by = next[1] - v[1];
    const al = Math.hypot(ax, ay);
    const bl = Math.hypot(bx, by);
    if (al < 0.5 || bl < 0.5) continue;
    const na = perp(ax, ay);
    const nb = perp(bx, by);
    const cross = (ax / al) * (by / bl) - (ay / al) * (bx / bl);
    if (Math.abs(cross) < 1e-4) continue;
    const side = -Math.sign(cross);
    const dot = na[0] * nb[0] + na[1] * nb[1];
    const denom = 1 + dot;
    if (denom < 0.25) {
      pushPoly([
        v,
        [v[0] + na[0] * h * side, v[1] + na[1] * h * side],
        [v[0] + nb[0] * h * side, v[1] + nb[1] * h * side],
      ]);
      continue;
    }
    const m: Point2D = [
      v[0] + ((na[0] + nb[0]) / denom) * h * side,
      v[1] + ((na[1] + nb[1]) / denom) * h * side,
    ];
    pushPoly([
      v,
      [v[0] + na[0] * h * side, v[1] + na[1] * h * side],
      m,
      [v[0] + nb[0] * h * side, v[1] + nb[1] * h * side],
    ]);
  }
  return simplifyMulti(batchUnion(parts), 1.5);
}

function dp(points: Point2D[], tol: number): Point2D[] {
  if (points.length < 3) return points.map((p) => [p[0], p[1]] as Point2D);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    let best = -1;
    let bestDist = tol2;
    const ax = points[a][0];
    const ay = points[a][1];
    const bx = points[b][0];
    const by = points[b][1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      let dist = 0;
      if (len2 < 1e-8) dist = (points[i][0] - ax) ** 2 + (points[i][1] - ay) ** 2;
      else {
        const t = Math.max(0, Math.min(1, ((points[i][0] - ax) * dx + (points[i][1] - ay) * dy) / len2));
        const px = ax + t * dx;
        const py = ay + t * dy;
        dist = (points[i][0] - px) ** 2 + (points[i][1] - py) ** 2;
      }
      if (dist > bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const out: Point2D[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push([points[i][0], points[i][1]]);
  return out;
}

export function simplifyPolyline(points: Point2D[], tol: number): Point2D[] {
  return dp(points, tol);
}

export function simplifyRing(ring: Ring2D, tol: number): Ring2D {
  if (ring.length < 5) return ring.map((p) => [p[0], p[1]] as Point2D);
  const open = ring.slice(0, -1);
  const simplified = dp(open, tol);
  if (simplified.length < 3) return ring.map((p) => [p[0], p[1]] as Point2D);
  simplified.push([simplified[0][0], simplified[0][1]]);
  return simplified;
}

export function simplifyMulti(mp: MultiPolygon2D, tol: number): MultiPolygon2D {
  const out: MultiPolygon2D = [];
  for (const poly of mp) {
    const rings = poly.map((ring) => simplifyRing(ring, tol)).filter((ring) => ring.length >= 4);
    if (rings.length) out.push(rings);
  }
  return out;
}

export function disk(cx: number, cy: number, radius: number, segments = 20): Polygon2D {
  const ring: Ring2D = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    ring.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
  }
  ring.push([ring[0][0], ring[0][1]]);
  return [ring];
}

export function blobPolygon(
  rng: Rng,
  center: Point2D,
  radius: number,
  opts?: { points?: number; roughness?: number }
): Polygon2D {
  const count = Math.max(8, Math.min(14, opts?.points ?? 10));
  const roughness = opts?.roughness ?? 0.22;
  const noise = createNoise1D(rng);
  const radii: number[] = [];
  for (let i = 0; i < count; i++) radii.push(radius * (1 + roughness * noise(i * 0.85)));
  const smoothR = radii.map((value, i) => {
    const prev = radii[(i - 1 + count) % count];
    const next = radii[(i + 1) % count];
    return prev * 0.25 + value * 0.5 + next * 0.25;
  });
  const raw: Point2D[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2;
    raw.push([center[0] + Math.cos(a) * smoothR[i], center[1] + Math.sin(a) * smoothR[i]]);
  }
  const sampled = catmullRomCentripetal(raw, Math.max(6, radius / 6), true);
  const ring = close(sampled);
  return ring.length ? [ring] : disk(center[0], center[1], radius, 12);
}

export function rotatedRect(cx: number, cy: number, length: number, width: number, angle: number): Polygon2D {
  const hl = length / 2;
  const hw = width / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const local: Point2D[] = [
    [-hl, -hw],
    [hl, -hw],
    [hl, hw],
    [-hl, hw],
  ];
  return [
    close(local.map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos] as Point2D)),
  ];
}

export function segmentHit(a: Point2D, b: Point2D, c: Point2D, d: Point2D): Point2D | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const qx = d[0] - c[0];
  const qy = d[1] - c[1];
  const denom = rx * qy - ry * qx;
  if (Math.abs(denom) < 1e-6) return null;
  const t = ((c[0] - a[0]) * qy - (c[1] - a[1]) * qx) / denom;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / denom;
  if (t < -0.001 || t > 1.001 || u < -0.001 || u > 1.001) return null;
  return [a[0] + t * rx, a[1] + t * ry];
}

export function pointAlong(points: Point2D[], distance: number): { p: Point2D; tangent: Point2D; normal: Point2D } | null {
  if (points.length < 2) return null;
  let remain = Math.max(0, distance);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    if (remain <= len) {
      const t = remain / len;
      const p: Point2D = [a[0] + dx * t, a[1] + dy * t];
      const tangent: Point2D = [dx / len, dy / len];
      return { p, tangent, normal: [-tangent[1], tangent[0]] };
    }
    remain -= len;
  }
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const tangent: Point2D = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  return { p: [b[0], b[1]], tangent, normal: [-tangent[1], tangent[0]] };
}

export function clipMulti(region: MultiPolygon2D, mask: Polygon2D): MultiPolygon2D {
  if (!region.length || !mask.length) return [];
  try {
    return polygonClipping.intersection(
      region as unknown as polygonClipping.Geom,
      [mask] as unknown as polygonClipping.Geom
    ) as unknown as MultiPolygon2D;
  } catch {
    return [];
  }
}

export function subtractMulti(base: MultiPolygon2D, cut: MultiPolygon2D): MultiPolygon2D {
  if (!base.length || !cut.length) return base;
  try {
    return polygonClipping.difference(
      base as unknown as polygonClipping.Geom,
      cut as unknown as polygonClipping.Geom
    ) as unknown as MultiPolygon2D;
  } catch {
    return base;
  }
}

export function intersectMulti(a: MultiPolygon2D, b: MultiPolygon2D): MultiPolygon2D {
  if (!a.length || !b.length) return [];
  try {
    return polygonClipping.intersection(
      a as unknown as polygonClipping.Geom,
      b as unknown as polygonClipping.Geom
    ) as unknown as MultiPolygon2D;
  } catch {
    return [];
  }
}

export function zonePolygon(x: number, y: number, w: number, h: number): Polygon2D {
  return [
    close([
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ]),
  ];
}

export function containsPoint(poly: Polygon2D, x: number, y: number): boolean {
  let inside = false;
  for (const ring of poly) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ring[i][1];
      const yj = ring[j][1];
      if (yi > y !== yj > y) {
        const xHit = ((ring[j][0] - ring[i][0]) * (y - yi)) / (yj - yi) + ring[i][0];
        if (x < xHit) inside = !inside;
      }
    }
  }
  return inside;
}

export function polygonCentroid(poly: Polygon2D): Point2D {
  const ring = poly[0] ?? [];
  if (ring.length < 2) return [0, 0];
  let x = 0;
  let y = 0;
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [x / Math.max(1, n), y / Math.max(1, n)];
}

export function distToSegment(x: number, y: number, a: Point2D, b: Point2D): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  if (len < 1e-6) return Math.hypot(x - a[0], y - a[1]);
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len));
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}
