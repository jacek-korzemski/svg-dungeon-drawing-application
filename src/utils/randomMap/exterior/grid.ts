import { Point2D, Polygon2D } from '../../../types/dungeon';
import { distToSegment } from '../curves';
import { Rect, RibbonSample } from '../types';

export const F = {
  WATER: 1,
  SHALLOW: 2,
  ROAD: 4,
  PLAZA: 8,
  WALL: 16,
  BUILDING: 32,
  FIELD: 64,
  YARD: 128,
  RESERVED: 256,
  INSIDE_WALL: 512,
  PROP: 1024,
  ROCK: 2048,
  BOG: 4096,
} as const;

function pointInPoly(x: number, y: number, poly: Polygon2D): boolean {
  let inside = false;
  for (const ring of poly) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ring[i][1];
      const yj = ring[j][1];
      if (yi > y !== yj > y) {
        const xHit = ((ring[j][0] - ring[i][0]) * (y - yi)) / (yj - yi || 1e-9) + ring[i][0];
        if (x < xHit) inside = !inside;
      }
    }
  }
  return inside;
}

function distToPoly(x: number, y: number, poly: Polygon2D): number {
  let best = Infinity;
  for (const ring of poly) {
    for (let i = 0; i < ring.length - 1; i++) {
      const dist = distToSegment(x, y, ring[i], ring[i + 1]);
      if (dist < best) best = dist;
    }
  }
  return best;
}

function boundsOf(poly: Polygon2D, pad: number) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of poly) {
    for (const point of ring) {
      if (point[0] < minX) minX = point[0];
      if (point[1] < minY) minY = point[1];
      if (point[0] > maxX) maxX = point[0];
      if (point[1] > maxY) maxY = point[1];
    }
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export class ExteriorGrid {
  readonly cols: number;
  readonly rows: number;
  readonly r: number;
  readonly ox: number;
  readonly oy: number;
  readonly flags: Uint16Array;

  constructor(zone: Rect, G: number) {
    this.r = G / 2;
    this.ox = zone.x * G;
    this.oy = zone.y * G;
    this.cols = Math.max(1, Math.ceil((zone.w * G) / this.r));
    this.rows = Math.max(1, Math.ceil((zone.h * G) / this.r));
    this.flags = new Uint16Array(this.cols * this.rows);
  }

  cellOf(x: number, y: number): number {
    const c = Math.floor((x - this.ox) / this.r);
    const row = Math.floor((y - this.oy) / this.r);
    if (c < 0 || row < 0 || c >= this.cols || row >= this.rows) return -1;
    return row * this.cols + c;
  }

  has(x: number, y: number, mask: number): boolean {
    const index = this.cellOf(x, y);
    if (index < 0) return false;
    return (this.flags[index] & mask) !== 0;
  }

  private stampIndex(index: number, flag: number) {
    if (index >= 0 && index < this.flags.length) this.flags[index] |= flag;
  }

  stampDisk(cx: number, cy: number, radius: number, flag: number) {
    const rad = Math.max(this.r, radius);
    const c0 = Math.floor((cx - rad - this.ox) / this.r);
    const c1 = Math.floor((cx + rad - this.ox) / this.r);
    const r0 = Math.floor((cy - rad - this.oy) / this.r);
    const r1 = Math.floor((cy + rad - this.oy) / this.r);
    const r2 = radius * radius;
    for (let row = r0; row <= r1; row++) {
      if (row < 0 || row >= this.rows) continue;
      for (let col = c0; col <= c1; col++) {
        if (col < 0 || col >= this.cols) continue;
        const x = this.ox + (col + 0.5) * this.r;
        const y = this.oy + (row + 0.5) * this.r;
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2) this.flags[row * this.cols + col] |= flag;
      }
    }
  }

  stampCapsule(a: Point2D, b: Point2D, radius: number, flag: number) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(len / (this.r * 0.8)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.stampDisk(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, radius, flag);
    }
  }

  stampRibbon(samples: RibbonSample[], flag: number) {
    for (let i = 0; i < samples.length; i++) {
      const radius = Math.max(samples[i].left, samples[i].right);
      this.stampDisk(samples[i].p[0], samples[i].p[1], radius, flag);
      if (i > 0) this.stampCapsule(samples[i - 1].p, samples[i].p, radius, flag);
    }
  }

  private dilated(poly: Polygon2D, x: number, y: number, pad: number): boolean {
    if (pointInPoly(x, y, poly)) return true;
    return pad > 0 && distToPoly(x, y, poly) < pad;
  }

  stampPolygon(poly: Polygon2D, flag: number, pad = 0) {
    if (!poly[0]?.length) return;
    const box = boundsOf(poly, pad);
    const c0 = Math.max(0, Math.floor((box.minX - this.ox) / this.r));
    const c1 = Math.min(this.cols - 1, Math.floor((box.maxX - this.ox) / this.r));
    const r0 = Math.max(0, Math.floor((box.minY - this.oy) / this.r));
    const r1 = Math.min(this.rows - 1, Math.floor((box.maxY - this.oy) / this.r));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const x = this.ox + (col + 0.5) * this.r;
        const y = this.oy + (row + 0.5) * this.r;
        if (this.dilated(poly, x, y, pad)) this.stampIndex(row * this.cols + col, flag);
      }
    }
  }

  areaFree(poly: Polygon2D, blockMask: number, pad: number): boolean {
    if (!poly[0]?.length) return false;
    const box = boundsOf(poly, pad);
    const c0 = Math.floor((box.minX - this.ox) / this.r);
    const c1 = Math.floor((box.maxX - this.ox) / this.r);
    const r0 = Math.floor((box.minY - this.oy) / this.r);
    const r1 = Math.floor((box.maxY - this.oy) / this.r);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const x = this.ox + (col + 0.5) * this.r;
        const y = this.oy + (row + 0.5) * this.r;
        if (!this.dilated(poly, x, y, pad)) continue;
        if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return false;
        if (this.flags[row * this.cols + col] & blockMask) return false;
      }
    }
    return true;
  }

  distanceTo(mask: number): Float32Array {
    const dist = new Float32Array(this.flags.length);
    dist.fill(1e9);
    for (let i = 0; i < this.flags.length; i++) if (this.flags[i] & mask) dist[i] = 0;
    const cols = this.cols;
    const relax = (index: number, other: number, step: number) => {
      if (other < 0 || other >= dist.length) return;
      const next = dist[other] + step;
      if (next < dist[index]) dist[index] = next;
    };
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < cols; col++) {
        const index = row * cols + col;
        if (col > 0) relax(index, index - 1, 3);
        if (row > 0) relax(index, index - cols, 3);
        if (col > 0 && row > 0) relax(index, index - cols - 1, 4);
        if (col + 1 < cols && row > 0) relax(index, index - cols + 1, 4);
      }
    }
    for (let row = this.rows - 1; row >= 0; row--) {
      for (let col = cols - 1; col >= 0; col--) {
        const index = row * cols + col;
        if (col + 1 < cols) relax(index, index + 1, 3);
        if (row + 1 < this.rows) relax(index, index + cols, 3);
        if (col + 1 < cols && row + 1 < this.rows) relax(index, index + cols + 1, 4);
        if (col > 0 && row + 1 < this.rows) relax(index, index + cols - 1, 4);
      }
    }
    const scale = this.r / 3;
    for (let i = 0; i < dist.length; i++) dist[i] *= scale;
    return dist;
  }
}
