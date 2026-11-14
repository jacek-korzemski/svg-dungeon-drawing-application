import polygonClipping from 'polygon-clipping';
import { GRID_SIZE } from '../../geometry';
import { MultiPolygon2D, Point2D, Ring2D } from '../../../types/dungeon';
import { simplifyRing } from '../curves';
import { Rng } from '../rng';

const G = GRID_SIZE;

export function fixDiagonals(floor: Uint8Array, cols: number, rows: number, isFrame: (index: number) => boolean, rng: Rng): void {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= cols || y >= rows ? 0 : floor[y * cols + x]);
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols - 1; x++) {
        const cells = [
          { x, y, on: at(x, y) },
          { x: x + 1, y, on: at(x + 1, y) },
          { x, y: y + 1, on: at(x, y + 1) },
          { x: x + 1, y: y + 1, on: at(x + 1, y + 1) },
        ];
        const a = cells[0].on && cells[3].on && !cells[1].on && !cells[2].on;
        const b = cells[1].on && cells[2].on && !cells[0].on && !cells[3].on;
        if (!a && !b) continue;
        const rock = cells.filter((cell) => !cell.on);
        if (rock.length === 2 && rock.every((cell) => isFrame(cell.y * cols + cell.x))) {
          const floors = cells.filter((cell) => cell.on);
          const chosen = floors[Math.floor(rng.next() * floors.length)];
          floor[chosen.y * cols + chosen.x] = 0;
        } else {
          const chosen = rock[Math.floor(rng.next() * rock.length)];
          floor[chosen.y * cols + chosen.x] = 1;
        }
        changed = true;
      }
    }
    if (!changed) break;
  }
}

function signedArea(points: Point2D[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    sum += points[i][0] * next[1] - next[0] * points[i][1];
  }
  return sum / 2;
}

function simplifyOpen(points: Point2D[]): Point2D[] {
  const out: Point2D[] = [];
  for (const point of points) {
    const prev = out[out.length - 1];
    if (prev && prev[0] === point[0] && prev[1] === point[1]) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      const collinear = (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]) === 0;
      if (collinear) out.pop();
    }
    out.push(point);
  }
  let guard = 0;
  while (out.length >= 4 && guard++ < out.length) {
    const a = out[out.length - 2];
    const b = out[out.length - 1];
    const c = out[0];
    const collinear = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) === 0;
    if (!collinear) break;
    out.pop();
  }
  return out;
}

function contains(outer: Point2D[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    const yi = outer[i][1];
    const yj = outer[j][1];
    const xi = outer[i][0];
    const xj = outer[j][0];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function gridToMultiPolygon(floor: Uint8Array, cols: number, rows: number, ox: number, oy: number): MultiPolygon2D {
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && floor[y * cols + x] > 0;
  const stride = cols + 1;
  const outgoing = new Map<number, { x: number; y: number; nx: number; ny: number }[]>();
  const add = (x: number, y: number, nx: number, ny: number) => {
    const key = y * stride + x;
    const list = outgoing.get(key) ?? [];
    list.push({ x, y, nx, ny });
    outgoing.set(key, list);
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!on(x, y)) continue;
      if (!on(x, y - 1)) add(x, y, x + 1, y);
      if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!on(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const used = new Set<string>();
  const loops: Point2D[][] = [];
  const edgeKey = (edge: { x: number; y: number; nx: number; ny: number }) => `${edge.x},${edge.y}>${edge.nx},${edge.ny}`;
  for (const edges of outgoing.values()) {
    for (const start of edges) {
      if (used.has(edgeKey(start))) continue;
      const loop: Point2D[] = [[start.x, start.y]];
      let current = start;
      for (let guard = 0; guard < cols * rows * 8; guard++) {
        used.add(edgeKey(current));
        if (current.nx === loop[0][0] && current.ny === loop[0][1]) break;
        loop.push([current.nx, current.ny]);
        const options = (outgoing.get(current.ny * stride + current.nx) ?? []).filter((edge) => !used.has(edgeKey(edge)));
        if (!options.length) break;
        if (options.length === 1) current = options[0];
        else {
          const incoming = { x: current.nx - current.x, y: current.ny - current.y };
          current = options.slice().sort((left, right) => turnRank(incoming, left) - turnRank(incoming, right))[0];
        }
      }
      const cleaned = simplifyOpen(loop);
      if (cleaned.length >= 3) loops.push(cleaned);
    }
  }
  const outers: { points: Point2D[]; area: number }[] = [];
  const holes: { points: Point2D[]; area: number }[] = [];
  for (const loop of loops) {
    const area = signedArea(loop);
    if (Math.abs(area) < 0.5) continue;
    if (area > 0) outers.push({ points: loop, area });
    else holes.push({ points: loop, area });
  }
  const polygons: { outer: Point2D[]; holes: Point2D[][] }[] = outers.map((outer) => ({ outer: outer.points, holes: [] }));
  for (const hole of holes) {
    const probe = hole.points[0];
    let best = -1;
    let bestArea = Infinity;
    polygons.forEach((poly, index) => {
      const area = Math.abs(signedArea(poly.outer));
      if (area < bestArea && contains(poly.outer, probe[0], probe[1])) {
        bestArea = area;
        best = index;
      }
    });
    if (best >= 0) polygons[best].holes.push(hole.points);
  }
  return polygons.map((poly) => {
    const rings = [poly.outer, ...poly.holes].map((points) => {
      const ring: Ring2D = points.map((point) => [(ox + point[0]) * G, (oy + point[1]) * G]);
      ring.push([ring[0][0], ring[0][1]]);
      return ring;
    });
    return rings;
  });
}

function turnRank(incoming: { x: number; y: number }, edge: { nx: number; ny: number; x: number; y: number }): number {
  const dx = edge.nx - edge.x;
  const dy = edge.ny - edge.y;
  const cross = incoming.x * dy - incoming.y * dx;
  const dot = incoming.x * dx + incoming.y * dy;
  if (cross > 0) return 0;
  if (dot < 0) return 1;
  if (cross < 0) return 2;
  return 3;
}

export function smoothMulti(mp: MultiPolygon2D, iterations: number, tolerance: number): MultiPolygon2D {
  const smoothed: MultiPolygon2D = mp.map((poly) =>
    poly.map((ring) => {
      let open = ring.slice(0, -1);
      for (let pass = 0; pass < iterations; pass++) {
        if (open.length < 3) break;
        const next: Point2D[] = [];
        for (let i = 0; i < open.length; i++) {
          const a = open[i];
          const b = open[(i + 1) % open.length];
          next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
          next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
        }
        open = next;
      }
      const closed: Ring2D = open.map((point) => [point[0], point[1]]);
      closed.push([closed[0][0], closed[0][1]]);
      return simplifyRing(closed, tolerance);
    })
  );
  try {
    return polygonClipping.union(smoothed as unknown as polygonClipping.Geom) as unknown as MultiPolygon2D;
  } catch {
    return mp;
  }
}
