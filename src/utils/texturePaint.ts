import polygonClipping from 'polygon-clipping';
import {
  DungeonLayer,
  ExteriorRoad,
  MultiPolygon2D,
  Point2D,
  Polygon2D,
  Ring2D,
  TextureBrushShape,
  TextureDab,
  TexturePaint,
} from '../types/dungeon';
import { rectToPolygon, subtractGeometry, unionGeometry } from './geometry';

export function newTexturePaintId(): string {
  return `tp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function textureBlurPx(paint: Pick<TexturePaint, 'kind' | 'shape' | 'softness' | 'dabs'>): number {
  if (paint.softness <= 0.02) return 0;
  if (paint.kind === 'fill' || paint.shape === 'bucket') {
    return Math.max(2, Math.round(paint.softness * 14));
  }
  let radius = 8;
  for (const dab of paint.dabs) radius = Math.max(radius, dab.r);
  return Math.max(1, Math.round(paint.softness * radius * 0.45));
}

export function paintWorldRect(
  paint: Pick<TexturePaint, 'kind' | 'dabs' | 'region'>,
  pad: number
): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const expand = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  if (paint.kind === 'fill') {
    for (const poly of paint.region) {
      for (const ring of poly) {
        for (const pt of ring) expand(pt[0], pt[1]);
      }
    }
  } else {
    for (const dab of paint.dabs) {
      expand(dab.x - dab.r, dab.y - dab.r);
      expand(dab.x + dab.r, dab.y + dab.r);
    }
  }

  if (!isFinite(minX)) return null;
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

function circlePolygon(cx: number, cy: number, radius: number, segments: number): Polygon2D {
  if (radius < 0.4) return [];
  const ring: Ring2D = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    ring.push([
      Math.round((cx + Math.cos(angle) * radius) * 10) / 10,
      Math.round((cy + Math.sin(angle) * radius) * 10) / 10,
    ]);
  }
  ring.push([...ring[0]]);
  return [ring];
}

function hashUnit(index: number, salt: number): number {
  const n = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

/** Specks for one spray sample. Positions are stored, so a reload does not reshuffle them. */
export function sprayDabs(x: number, y: number, radius: number, sampleIndex: number): TextureDab[] {
  const count = 14;
  const dabs: TextureDab[] = [];
  for (let i = 0; i < count; i++) {
    const seed = sampleIndex * 32 + i;
    const angle = hashUnit(seed, 1) * Math.PI * 2;
    const dist = Math.sqrt(hashUnit(seed, 2)) * radius;
    const speck = radius * (0.12 + 0.1 * hashUnit(seed, 3));
    dabs.push({
      x: Math.round((x + Math.cos(angle) * dist) * 10) / 10,
      y: Math.round((y + Math.sin(angle) * dist) * 10) / 10,
      r: Math.max(1.5, Math.round(speck * 10) / 10),
    });
  }
  return dabs;
}

export function stampDabs(
  x: number,
  y: number,
  radius: number,
  shape: TextureBrushShape,
  sampleIndex: number
): TextureDab[] {
  if (shape === 'spray') return sprayDabs(x, y, radius, sampleIndex);
  return [{ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, r: radius }];
}

export function dabsToMultiPolygon(dabs: TextureDab[], shape: TextureBrushShape | 'bucket'): MultiPolygon2D {
  let acc: MultiPolygon2D = [];
  const square = shape === 'square';
  for (const dab of dabs) {
    const poly = square
      ? rectToPolygon(dab.x - dab.r, dab.y - dab.r, dab.x + dab.r, dab.y + dab.r)
      : circlePolygon(dab.x, dab.y, dab.r, shape === 'spray' ? 8 : 18);
    if (poly.length > 0) acc = unionGeometry(acc, [poly]);
  }
  return acc;
}

function paintToMultiPolygon(paint: TexturePaint): MultiPolygon2D {
  if (paint.kind === 'fill') return paint.region;
  return dabsToMultiPolygon(paint.dabs, paint.shape);
}

function boundsOf(mp: MultiPolygon2D): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of mp) {
    for (const ring of poly) {
      for (const pt of ring) {
        if (pt[0] < minX) minX = pt[0];
        if (pt[1] < minY) minY = pt[1];
        if (pt[0] > maxX) maxX = pt[0];
        if (pt[1] > maxY) maxY = pt[1];
      }
    }
  }
  if (!isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function boxesOverlap(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number }
): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** Trims road ribbons with the eraser. Returns the same array when nothing changed. */
export function eraseRoadPolygons(roads: ExteriorRoad[], cut: MultiPolygon2D): ExteriorRoad[] {
  if (!cut.length || !roads.length) return roads;
  const cutBounds = boundsOf(cut);
  if (!cutBounds) return roads;
  let changed = false;
  const next = roads.flatMap((road) => {
    const roadBounds = boundsOf(road.polygon);
    if (!roadBounds || !boxesOverlap(roadBounds, cutBounds)) return [road];
    const diff = subtractGeometry(road.polygon, cut);
    if (diff === road.polygon) return [road];
    changed = true;
    if (!diff.length) return [];
    return [{ ...road, polygon: diff }];
  });
  return changed ? next : roads;
}

/** Returns the same array when nothing was removed, so undo can skip a no-op. */
export function eraseTexturePaints(paints: TexturePaint[], cut: MultiPolygon2D): TexturePaint[] {
  if (!cut.length || !paints.length) return paints;
  const cutBounds = boundsOf(cut);
  if (!cutBounds) return paints;
  let changed = false;
  const next = paints.flatMap((paint) => {
    const base = paintToMultiPolygon(paint);
    const baseBounds = boundsOf(base);
    if (!baseBounds || !boxesOverlap(baseBounds, cutBounds)) return [paint];
    const diff = subtractGeometry(base, cut);
    if (diff === base) return [paint];
    if (!diff.length) {
      changed = true;
      return [];
    }
    changed = true;
    return [{ ...paint, kind: 'fill' as const, dabs: [], region: diff }];
  });
  return changed ? next : paints;
}

export function pointInRing(x: number, y: number, ring: Ring2D): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const crosses = yi > y !== yj > y;
    if (crosses) {
      const xHit = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (x < xHit) inside = !inside;
    }
  }
  return inside;
}

export function pointInMultiPolygon(x: number, y: number, mp: MultiPolygon2D): boolean {
  let inside = false;
  for (const poly of mp) {
    for (const ring of poly) {
      if (pointInRing(x, y, ring)) inside = !inside;
    }
  }
  return inside;
}

function nearFloor(x: number, y: number, geometry: MultiPolygon2D): boolean {
  if (pointInMultiPolygon(x, y, geometry)) return true;
  const nudge = 6;
  return (
    pointInMultiPolygon(x + nudge, y, geometry) ||
    pointInMultiPolygon(x - nudge, y, geometry) ||
    pointInMultiPolygon(x, y + nudge, geometry) ||
    pointInMultiPolygon(x, y - nudge, geometry)
  );
}

function stampDisk(
  grid: Uint8Array,
  cols: number,
  rows: number,
  cx: number,
  cy: number,
  radius: number
) {
  const r = Math.ceil(radius);
  const r2 = radius * radius;
  for (let y = -r; y <= r; y++) {
    const py = cy + y;
    if (py < 0 || py >= rows) continue;
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y > r2) continue;
      const px = cx + x;
      if (px < 0 || px >= cols) continue;
      grid[py * cols + px] = 1;
    }
  }
}

function strokeBarrier(
  grid: Uint8Array,
  cols: number,
  rows: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number
) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    stampDisk(grid, cols, rows, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), radius);
  }
}

function parseKey(key: string): [number, number] {
  const comma = key.indexOf(',');
  return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))];
}

function turnAngle(inDx: number, inDy: number, outDx: number, outDy: number): number {
  const cross = inDx * outDy - inDy * outDx;
  const dot = inDx * outDx + inDy * outDy;
  let angle = Math.atan2(cross, dot);
  if (angle < 0) angle += Math.PI * 2;
  return angle;
}

function traceLoops(filled: Uint8Array, cols: number, rows: number): [number, number][][] {
  const outgoing = new Map<string, string[]>();
  const addEdge = (x0: number, y0: number, x1: number, y1: number) => {
    const from = `${x0},${y0}`;
    const to = `${x1},${y1}`;
    const list = outgoing.get(from);
    if (list) list.push(to);
    else outgoing.set(from, [to]);
  };
  const filledAt = (c: number, r: number) =>
    c >= 0 && r >= 0 && c < cols && r < rows && filled[r * cols + c] === 2;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!filledAt(c, r)) continue;
      if (!filledAt(c - 1, r)) addEdge(c, r, c, r + 1);
      if (!filledAt(c + 1, r)) addEdge(c + 1, r + 1, c + 1, r);
      if (!filledAt(c, r - 1)) addEdge(c + 1, r, c, r);
      if (!filledAt(c, r + 1)) addEdge(c, r + 1, c + 1, r + 1);
    }
  }

  const takeNext = (cur: string, prev: string | null): string | null => {
    const options = outgoing.get(cur);
    if (!options || options.length === 0) return null;
    if (options.length === 1 || !prev) return options.pop() ?? null;
    const [px, py] = parseKey(prev);
    const [cx, cy] = parseKey(cur);
    const inDx = cx - px;
    const inDy = cy - py;
    let best = 0;
    let bestAngle = Infinity;
    for (let i = 0; i < options.length; i++) {
      const [nx, ny] = parseKey(options[i]);
      const angle = turnAngle(inDx, inDy, nx - cx, ny - cy);
      if (angle < bestAngle) {
        bestAngle = angle;
        best = i;
      }
    }
    return options.splice(best, 1)[0] ?? null;
  };

  const loops: [number, number][][] = [];
  const sources = [...outgoing.keys()];
  for (const source of sources) {
    while ((outgoing.get(source)?.length ?? 0) > 0) {
      const loop: [number, number][] = [parseKey(source)];
      let prev: string | null = null;
      let cur = source;
      let guard = 0;
      let closed = false;
      while (guard++ < cols * rows * 8) {
        const next = takeNext(cur, prev);
        if (!next) break;
        if (next === source) {
          loop.push(parseKey(source));
          closed = true;
          break;
        }
        loop.push(parseKey(next));
        prev = cur;
        cur = next;
      }
      if (closed && loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

function simplifyRing(points: Point2D[]): Point2D[] {
  if (points.length < 4) return points;
  const open = points.slice(0, -1);
  const kept: Point2D[] = [];
  for (let i = 0; i < open.length; i++) {
    const prev = open[(i + open.length - 1) % open.length];
    const cur = open[i];
    const next = open[(i + 1) % open.length];
    const cross = (cur[0] - prev[0]) * (next[1] - cur[1]) - (cur[1] - prev[1]) * (next[0] - cur[0]);
    if (Math.abs(cross) > 0.01) kept.push(cur);
  }
  if (kept.length < 3) return points;
  kept.push([...kept[0]]);
  return kept;
}

function signedArea(ring: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return area / 2;
}

function centroid(ring: Point2D[]): Point2D {
  let x = 0;
  let y = 0;
  const n = Math.max(1, ring.length - 1);
  for (let i = 0; i < ring.length - 1; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [x / n, y / n];
}

function reverseRing(ring: Point2D[]): Point2D[] {
  const copy = [...ring];
  copy.reverse();
  if (copy.length > 1) {
    const first = copy[0];
    const last = copy[copy.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) copy.push([...copy[0]]);
  }
  return copy;
}

function loopsToMultiPolygon(loops: Point2D[][]): MultiPolygon2D {
  if (!loops.length) return [];
  const info = loops.map((ring) => ({
    ring,
    area: signedArea(ring),
    center: centroid(ring),
  }));
  const depth = info.map((item, index) => {
    let containers = 0;
    for (let other = 0; other < info.length; other++) {
      if (other === index) continue;
      if (Math.abs(info[other].area) <= Math.abs(item.area)) continue;
      if (pointInRing(item.center[0], item.center[1], info[other].ring)) containers += 1;
    }
    return containers;
  });

  const polygons: Polygon2D[] = [];
  for (let i = 0; i < info.length; i++) {
    if (depth[i] % 2 !== 0) continue;
    const holes: Ring2D[] = [];
    for (let h = 0; h < info.length; h++) {
      if (depth[h] !== depth[i] + 1) continue;
      if (!pointInRing(info[h].center[0], info[h].center[1], info[i].ring)) continue;
      let smallest = true;
      for (let mid = 0; mid < info.length; mid++) {
        if (mid === i || mid === h) continue;
        if (depth[mid] !== depth[i]) continue;
        if (Math.abs(info[mid].area) >= Math.abs(info[i].area)) continue;
        if (pointInRing(info[h].center[0], info[h].center[1], info[mid].ring)) smallest = false;
      }
      if (!smallest) continue;
      const hole = info[h].ring;
      holes.push(Math.sign(signedArea(hole)) === Math.sign(info[i].area) ? reverseRing(hole) : hole);
    }
    polygons.push([info[i].ring, ...holes]);
  }
  return polygons;
}

function intersectFloor(region: MultiPolygon2D, floor: MultiPolygon2D): MultiPolygon2D {
  if (!region.length || !floor.length) return [];
  try {
    const hit = polygonClipping.intersection(
      region as unknown as polygonClipping.MultiPolygon,
      floor as unknown as polygonClipping.MultiPolygon
    );
    return hit as unknown as MultiPolygon2D;
  } catch {
    return region;
  }
}

/**
 * Fill the room under the cursor. Walls are the floor outline and standalone walls.
 * Returns null when the click is on the background or the paint would escape the room.
 */
export function fillEnclosedRoom(layer: DungeonLayer, x: number, y: number): MultiPolygon2D | null {
  const floor = layer.geometry;
  if (!floor?.length || !nearFloor(x, y, floor)) return null;

  const bounds = boundsOf(floor);
  if (!bounds) return null;

  const pad = 24;
  const spanX = bounds.maxX - bounds.minX + pad * 2;
  const spanY = bounds.maxY - bounds.minY + pad * 2;
  let cell = 2;
  while ((spanX / cell) * (spanY / cell) > 450_000 && cell < 6) cell += 1;

  const originX = bounds.minX - pad;
  const originY = bounds.minY - pad;
  const cols = Math.ceil(spanX / cell) + 1;
  const rows = Math.ceil(spanY / cell) + 1;
  if (cols < 3 || rows < 3 || cols * rows > 800_000) return null;

  const grid = new Uint8Array(cols * rows);
  const radius = Math.max(1.15, 4 / cell);
  const toGrid = (wx: number, wy: number) => [(wx - originX) / cell, (wy - originY) / cell];

  const strokeRing = (ring: Ring2D) => {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = toGrid(ring[i][0], ring[i][1]);
      const [x1, y1] = toGrid(ring[i + 1][0], ring[i + 1][1]);
      strokeBarrier(grid, cols, rows, x0, y0, x1, y1, radius);
    }
  };

  for (const poly of floor) {
    for (const ring of poly) strokeRing(ring);
  }
  for (const wall of layer.standaloneWalls) {
    const pts = wall.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = toGrid(pts[i][0], pts[i][1]);
      const [x1, y1] = toGrid(pts[i + 1][0], pts[i + 1][1]);
      const wallRadius = Math.max(radius, (wall.thickness || 8) / 2 / cell);
      strokeBarrier(grid, cols, rows, x0, y0, x1, y1, wallRadius);
    }
  }

  const indexAt = (c: number, r: number) => r * cols + c;
  const inGrid = (c: number, r: number) => c > 0 && r > 0 && c < cols - 1 && r < rows - 1;
  let startC = Math.floor((x - originX) / cell);
  let startR = Math.floor((y - originY) / cell);
  const startInside =
    inGrid(startC, startR) &&
    grid[indexAt(startC, startR)] !== 1 &&
    pointInMultiPolygon(originX + (startC + 0.5) * cell, originY + (startR + 0.5) * cell, floor);
  if (!startInside) {
    let found = false;
    for (let rad = 1; rad <= 8 && !found; rad++) {
      for (let dy = -rad; dy <= rad && !found; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const c = startC + dx;
          const r = startR + dy;
          if (c <= 0 || r <= 0 || c >= cols - 1 || r >= rows - 1) continue;
          if (grid[indexAt(c, r)] === 1) continue;
          const wx = originX + (c + 0.5) * cell;
          const wy = originY + (r + 0.5) * cell;
          if (!pointInMultiPolygon(wx, wy, floor)) continue;
          startC = c;
          startR = r;
          found = true;
          break;
        }
      }
    }
    if (!found) return null;
  }

  const stack: number[] = [indexAt(startC, startR)];
  let leaked = false;
  while (stack.length > 0) {
    const index = stack.pop() as number;
    if (grid[index] !== 0) continue;
    const c = index % cols;
    const r = (index / cols) | 0;
    if (c === 0 || r === 0 || c === cols - 1 || r === rows - 1) {
      leaked = true;
      break;
    }
    const wx = originX + (c + 0.5) * cell;
    const wy = originY + (r + 0.5) * cell;
    if (!pointInMultiPolygon(wx, wy, floor)) {
      leaked = true;
      break;
    }
    grid[index] = 2;
    stack.push(index - 1, index + 1, index - cols, index + cols);
  }
  if (leaked) return null;

  const loops = traceLoops(grid, cols, rows);
  const worldLoops = loops.map((loop) =>
    simplifyRing(
      loop.map(([c, r]) => [originX + c * cell, originY + r * cell] as Point2D)
    )
  );
  const region = intersectFloor(loopsToMultiPolygon(worldLoops), floor);
  if (!region.length) return null;
  const area = Math.abs(region.reduce((sum, poly) => sum + signedArea(poly[0] ?? []), 0));
  if (area < cell * cell * 4) return null;
  return region;
}

function collectExteriorBarriers(layer: DungeonLayer): { rings: Ring2D[]; walls: { points: Point2D[]; thickness: number }[] } {
  const rings: Ring2D[] = [];
  const walls: { points: Point2D[]; thickness: number }[] = [];
  for (const poly of layer.geometry ?? []) {
    for (const ring of poly) {
      if (ring.length > 1) rings.push(ring);
    }
  }
  for (const road of layer.roads ?? []) {
    for (const poly of road.polygon ?? []) {
      for (const ring of poly) {
        if (ring.length > 1) rings.push(ring);
      }
    }
  }
  for (const wall of layer.standaloneWalls ?? []) {
    if (wall.points.length > 1) walls.push({ points: wall.points, thickness: wall.thickness || 10 });
  }
  return { rings, walls };
}

/**
 * Fill a patch of open ground or a courtyard. Walls, roads and building outlines are the barriers.
 * Returns null when the paint would run off into unbounded terrain.
 */
export function fillExteriorArea(layer: DungeonLayer, x: number, y: number): MultiPolygon2D | null {
  const { rings, walls } = collectExteriorBarriers(layer);
  if (!rings.length && !walls.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (px: number, py: number) => {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  };
  for (const ring of rings) {
    for (const point of ring) grow(point[0], point[1]);
  }
  for (const wall of walls) {
    for (const point of wall.points) grow(point[0], point[1]);
  }
  if (!isFinite(minX)) return null;

  const reach = 96;
  if (x < minX - reach || x > maxX + reach || y < minY - reach || y > maxY + reach) return null;

  const pad = 36;
  const originX = Math.min(minX, x) - pad;
  const originY = Math.min(minY, y) - pad;
  const farX = Math.max(maxX, x) + pad;
  const farY = Math.max(maxY, y) + pad;
  const spanX = farX - originX;
  const spanY = farY - originY;
  let cell = 3;
  while ((spanX / cell) * (spanY / cell) > 450_000 && cell < 8) cell += 1;

  const cols = Math.ceil(spanX / cell) + 1;
  const rows = Math.ceil(spanY / cell) + 1;
  if (cols < 3 || rows < 3 || cols * rows > 800_000) return null;

  const grid = new Uint8Array(cols * rows);
  const radius = Math.max(1.2, 6 / cell);
  const toGrid = (wx: number, wy: number) => [(wx - originX) / cell, (wy - originY) / cell];
  const strokeRing = (ring: Ring2D, rad: number) => {
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = toGrid(ring[i][0], ring[i][1]);
      const [x1, y1] = toGrid(ring[i + 1][0], ring[i + 1][1]);
      strokeBarrier(grid, cols, rows, x0, y0, x1, y1, rad);
    }
  };
  for (const ring of rings) strokeRing(ring, radius);
  for (const wall of walls) {
    const rad = Math.max(radius, wall.thickness / 2 / cell);
    for (let i = 0; i < wall.points.length - 1; i++) {
      const [x0, y0] = toGrid(wall.points[i][0], wall.points[i][1]);
      const [x1, y1] = toGrid(wall.points[i + 1][0], wall.points[i + 1][1]);
      strokeBarrier(grid, cols, rows, x0, y0, x1, y1, rad);
    }
  }

  const indexAt = (c: number, r: number) => r * cols + c;
  const inGrid = (c: number, r: number) => c > 0 && r > 0 && c < cols - 1 && r < rows - 1;
  let startC = Math.floor((x - originX) / cell);
  let startR = Math.floor((y - originY) / cell);
  const openAt = (c: number, r: number) => inGrid(c, r) && grid[indexAt(c, r)] !== 1;
  if (!openAt(startC, startR)) {
    let found = false;
    for (let rad = 1; rad <= 8 && !found; rad++) {
      for (let dy = -rad; dy <= rad && !found; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (!openAt(startC + dx, startR + dy)) continue;
          startC += dx;
          startR += dy;
          found = true;
          break;
        }
      }
    }
    if (!found) return null;
  }

  const stack: number[] = [indexAt(startC, startR)];
  let leaked = false;
  while (stack.length > 0) {
    const index = stack.pop() as number;
    if (grid[index] !== 0) continue;
    const c = index % cols;
    const r = (index / cols) | 0;
    if (c === 0 || r === 0 || c === cols - 1 || r === rows - 1) {
      leaked = true;
      break;
    }
    grid[index] = 2;
    stack.push(index - 1, index + 1, index - cols, index + cols);
  }
  if (leaked) return null;

  const loops = traceLoops(grid, cols, rows);
  const worldLoops = loops.map((loop) =>
    simplifyRing(loop.map(([c, r]) => [originX + c * cell, originY + r * cell] as Point2D))
  );
  const region = loopsToMultiPolygon(worldLoops);
  if (!region.length) return null;
  const area = Math.abs(region.reduce((sum, poly) => sum + signedArea(poly[0] ?? []), 0));
  if (area < cell * cell * 4) return null;
  return region;
}
