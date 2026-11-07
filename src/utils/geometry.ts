import polygonClipping from 'polygon-clipping';
import {
  BuildingStyle,
  DistrictAngleMode,
  DistrictSizePreset,
  DungeonLayer,
  ExteriorWallStyle,
  MultiPolygon2D,
  Point2D,
  Polygon2D,
  Ring2D,
  WallStyle,
} from '../types/dungeon';

/** Previous cell size. Ink, brick ticks and prop strokes are authored against it. */
export const LEGACY_GRID = 32;
/** 1 cell = 64px. Custom PNG assets are drawn to this standard (1 image px = 1 world px). */
export const GRID_SIZE = 64;

export function inkScale(gridSize = GRID_SIZE): number {
  return gridSize / LEGACY_GRID;
}

// Deterministic hash for procedural rock/brick/ruin synthesis (no jitter on re-render)
export function hash2D(x: number, y: number, seed = 1337): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

export function snapToGrid(val: number, gridSize = GRID_SIZE, subDiv = 1): number {
  const step = gridSize / subDiv;
  return Math.round(val / step) * step;
}

export function rectToPolygon(x1: number, y1: number, x2: number, y2: number): Polygon2D {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  if (maxX - minX < 2 || maxY - minY < 2) return [];
  return [
    [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
      [minX, minY],
    ],
  ];
}

export function circleToPolygon(
  cx: number,
  cy: number,
  radius: number,
  segments = 16
): Polygon2D {
  const ring: Ring2D = [];
  const ink = inkScale();
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    // Slight deterministic organic wobble for cave brush
    const wobble =
      0.92 + 0.16 * hash2D(Math.cos(angle) * 10 + cx / ink, Math.sin(angle) * 10 + cy / ink, 99);
    const r = radius * wobble;
    ring.push([
      Math.round((cx + Math.cos(angle) * r) * 10) / 10,
      Math.round((cy + Math.sin(angle) * r) * 10) / 10,
    ]);
  }
  ring.push([...ring[0]]);
  return [ring];
}

export function segmentToRibbonPolygon(
  p1: Point2D,
  p2: Point2D,
  width: number
): Polygon2D {
  const half = width / 2;
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const len = Math.hypot(dx, dy);

  if (len < 0.5) {
    return rectToPolygon(p1[0] - half, p1[1] - half, p1[0] + half, p1[1] + half);
  }

  // Orthogonal optimization: crisp grid-aligned rectangles
  if (Math.abs(dx) < 0.01) {
    return rectToPolygon(
      p1[0] - half,
      Math.min(p1[1], p2[1]) - half,
      p1[0] + half,
      Math.max(p1[1], p2[1]) + half
    );
  }
  if (Math.abs(dy) < 0.01) {
    return rectToPolygon(
      Math.min(p1[0], p2[0]) - half,
      p1[1] - half,
      Math.max(p1[0], p2[0]) + half,
      p1[1] + half
    );
  }

  // Angled segment with square endcaps
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy * half;
  const ny = ux * half;
  const ex = ux * half;
  const ey = uy * half;

  const a: Point2D = [p1[0] - ex + nx, p1[1] - ey + ny];
  const b: Point2D = [p2[0] + ex + nx, p2[1] + ey + ny];
  const c: Point2D = [p2[0] + ex - nx, p2[1] + ey - ny];
  const d: Point2D = [p1[0] - ex - nx, p1[1] - ey - ny];

  return [[a, b, c, d, [...a]]];
}

export function corridorPathToMultiPolygon(
  points: Point2D[],
  width: number
): MultiPolygon2D {
  if (points.length === 0) return [];
  if (points.length === 1) {
    const p = segmentToRibbonPolygon(points[0], points[0], width);
    return p.length ? [p] : [];
  }
  let acc: MultiPolygon2D = [];
  for (let i = 0; i < points.length - 1; i++) {
    const seg = segmentToRibbonPolygon(points[i], points[i + 1], width);
    if (seg.length) {
      acc = unionGeometry(acc, [seg]);
    }
  }
  return acc;
}

export function unionGeometry(
  base: MultiPolygon2D,
  addition: MultiPolygon2D
): MultiPolygon2D {
  if (!addition || addition.length === 0) return base;
  if (!base || base.length === 0) return addition;
  try {
    const res = polygonClipping.union(
      base as polygonClipping.Geom,
      addition as polygonClipping.Geom
    );
    return res as unknown as MultiPolygon2D;
  } catch {
    return [...base, ...addition];
  }
}

export function subtractGeometry(
  base: MultiPolygon2D,
  cutout: MultiPolygon2D
): MultiPolygon2D {
  if (!base || base.length === 0) return [];
  if (!cutout || cutout.length === 0) return base;
  try {
    const res = polygonClipping.difference(
      base as polygonClipping.Geom,
      cutout as polygonClipping.Geom
    );
    return res as unknown as MultiPolygon2D;
  } catch {
    return base;
  }
}

export function ringToSvgPath(ring: Ring2D): string {
  if (!ring || ring.length === 0) return '';
  let d = `M ${ring[0][0].toFixed(1)} ${ring[0][1].toFixed(1)}`;
  for (let i = 1; i < ring.length; i++) {
    d += ` L ${ring[i][0].toFixed(1)} ${ring[i][1].toFixed(1)}`;
  }
  d += ' Z';
  return d;
}

export function multiPolygonToSvgPath(mp: MultiPolygon2D): string {
  if (!mp || mp.length === 0) return '';
  const parts: string[] = [];
  for (const poly of mp) {
    for (const ring of poly) {
      const p = ringToSvgPath(ring);
      if (p) parts.push(p);
    }
  }
  return parts.join(' ');
}

export interface StylizedWallData {
  mainWallPath: string;
  secondaryDetailPath: string;
  brickTicksPath: string;
  rubblePolygons: string[];
  stippleDots: { x: number; y: number; r: number }[];
}

/**
 * Generates procedural SVG paths for each of the 5 Jinkline wall types:
 * - straight (Proste)
 * - rock (Skalne / Jaskiniowe)
 * - brick (Ceglane)
 * - double (Podwójne / Fortyfikacyjne)
 * - ruins (Zrujnowane)
 */
export function buildStylizedWallData(
  mp: MultiPolygon2D,
  style: WallStyle,
  gridSize = GRID_SIZE
): StylizedWallData {
  const ink = inkScale(gridSize);
  const hashAt = (x: number, y: number, seed: number) =>
    hash2D(Math.round(x / ink), Math.round(y / ink), seed);
  if (!mp || mp.length === 0) {
    return {
      mainWallPath: '',
      secondaryDetailPath: '',
      brickTicksPath: '',
      rubblePolygons: [],
      stippleDots: [],
    };
  }

  if (style === 'straight' || style === 'double') {
    const path = multiPolygonToSvgPath(mp);
    return {
      mainWallPath: path,
      secondaryDetailPath: path,
      brickTicksPath: '',
      rubblePolygons: [],
      stippleDots: [],
    };
  }

  if (style === 'brick') {
    const mainPath = multiPolygonToSvgPath(mp);
    const ticks: string[] = [];
    const brickSpacing = 14 * ink;

    for (const poly of mp) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) {
          const p1 = ring[i];
          const p2 = ring[i + 1];
          const dx = p2[0] - p1[0];
          const dy = p2[1] - p1[1];
          const len = Math.hypot(dx, dy);
          if (len < 6 * ink) continue;
          const ux = dx / len;
          const uy = dy / len;
          // Normal pointing outward/inward
          const nx = -uy;
          const ny = ux;
          const steps = Math.floor(len / brickSpacing);
          for (let s = 1; s < steps; s++) {
            const dist = s * brickSpacing;
            const bx = p1[0] + ux * dist;
            const by = p1[1] + uy * dist;
            const halfTick = 3.8 * ink;
            ticks.push(
              `M ${(bx - nx * halfTick).toFixed(1)} ${(by - ny * halfTick).toFixed(1)} L ${(bx + nx * halfTick).toFixed(1)} ${(by + ny * halfTick).toFixed(1)}`
            );
          }
        }
      }
    }

    return {
      mainWallPath: mainPath,
      secondaryDetailPath: mainPath,
      brickTicksPath: ticks.join(' '),
      rubblePolygons: [],
      stippleDots: [],
    };
  }

  if (style === 'rock') {
    const rockyRings: string[] = [];
    const fissurePaths: string[] = [];
    const stippleDots: { x: number; y: number; r: number }[] = [];
    const segStep = 10 * ink;

    for (const poly of mp) {
      for (const ring of poly) {
        if (ring.length < 3) continue;
        const pts: Point2D[] = [];

        for (let i = 0; i < ring.length - 1; i++) {
          const p1 = ring[i];
          const p2 = ring[i + 1];
          const dx = p2[0] - p1[0];
          const dy = p2[1] - p1[1];
          const len = Math.hypot(dx, dy);
          if (len < 1) continue;

          const ux = dx / len;
          const uy = dy / len;
          const nx = -uy;
          const ny = ux;

          const count = Math.max(1, Math.round(len / segStep));
          for (let k = 0; k < count; k++) {
            const t = k / count;
            const bx = p1[0] + dx * t;
            const by = p1[1] + dy * t;
            // Keep corner anchor close to original vertex so corners stay connected
            const cornerDamp = k === 0 ? 0.35 : 1.0;
            const n1 = hashAt(bx, by, 41) - 0.5;
            const n2 = hashAt(bx * 0.5, by * 0.5, 73) - 0.5;
            const offset = (n1 * 6.5 + n2 * 4.5) * cornerDamp * ink;
            const rx = bx + nx * offset;
            const ry = by + ny * offset;
            pts.push([rx, ry]);

            // Occasional rock fissure & stipple dot outside wall
            const hDetail = hashAt(bx, by, 211);
            if (hDetail > 0.72) {
              const outDir = n1 >= 0 ? 1 : -1;
              const fStartX = rx + nx * outDir * 3 * ink;
              const fStartY = ry + ny * outDir * 3 * ink;
              const fEndX = fStartX + (ux * 6 + nx * outDir * 5) * ink;
              const fEndY = fStartY + (uy * 6 + ny * outDir * 5) * ink;
              fissurePaths.push(
                `M ${fStartX.toFixed(1)} ${fStartY.toFixed(1)} L ${fEndX.toFixed(1)} ${fEndY.toFixed(1)}`
              );
            } else if (hDetail < 0.22) {
              stippleDots.push({
                x: Math.round((rx + nx * 6.5 * ink) * 10) / 10,
                y: Math.round((ry + ny * 6.5 * ink) * 10) / 10,
                r: (hDetail < 0.1 ? 1.4 : 0.9) * ink,
              });
            }
          }
        }

        if (pts.length > 2) {
          pts.push([...pts[0]]);
          rockyRings.push(ringToSvgPath(pts));
        }
      }
    }

    return {
      mainWallPath: rockyRings.join(' '),
      secondaryDetailPath: fissurePaths.join(' '),
      brickTicksPath: '',
      rubblePolygons: [],
      stippleDots,
    };
  }

  // style === 'ruins'
  const ruinSegments: string[] = [];
  const rubblePolygons: string[] = [];
  const step = 14 * ink;

  for (const poly of mp) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length - 1; i++) {
        const p1 = ring[i];
        const p2 = ring[i + 1];
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const len = Math.hypot(dx, dy);
        if (len < 2) continue;
        const ux = dx / len;
        const uy = dy / len;
        const nx = -uy;
        const ny = ux;
        const count = Math.max(1, Math.round(len / step));

        for (let k = 0; k < count; k++) {
          const t0 = k / count;
          const t1 = (k + 1) / count;
          const mx = p1[0] + dx * ((t0 + t1) * 0.5);
          const my = p1[1] + dy * ((t0 + t1) * 0.5);
          const h = hashAt(mx, my, 509);

          if (h > 0.28) {
            // Intact weathered stone block segment
            const jitter1 = (hashAt(mx, my, 12) - 0.5) * 2.4 * ink;
            const jitter2 = (hashAt(mx, my, 88) - 0.5) * 2.4 * ink;
            const sx = p1[0] + dx * t0 + nx * jitter1;
            const sy = p1[1] + dy * t0 + ny * jitter1;
            const ex = p1[0] + dx * t1 + nx * jitter2;
            const ey = p1[1] + dy * t1 + ny * jitter2;
            ruinSegments.push(
              `M ${sx.toFixed(1)} ${sy.toFixed(1)} L ${ex.toFixed(1)} ${ey.toFixed(1)}`
            );
          } else {
            // Broken gap: scatter 2 rubble stones nearby
            const rx = mx + nx * ((h - 0.14) * 26 * ink);
            const ry = my + ny * ((h - 0.14) * 26 * ink);
            const sz = (2.4 + h * 6) * ink;
            rubblePolygons.push(
              `M ${(rx - sz).toFixed(1)} ${(ry - sz * 0.6).toFixed(1)} L ${(rx + sz * 0.8).toFixed(1)} ${(ry - sz).toFixed(1)} L ${(rx + sz).toFixed(1)} ${(ry + sz * 0.7).toFixed(1)} L ${(rx - sz * 0.6).toFixed(1)} ${(ry + sz * 0.8).toFixed(1)} Z`
            );
          }
        }
      }
    }
  }

  return {
    mainWallPath: ruinSegments.join(' '),
    secondaryDetailPath: '',
    brickTicksPath: '',
    rubblePolygons,
    stippleDots: [],
  };
}

/**
 * Finds nearest wall segment to snap Doors cleanly onto walls & align angle
 */
export function findNearestWallSnap(
  x: number,
  y: number,
  layers: DungeonLayer[],
  maxDist = GRID_SIZE * 0.9
): { x: number; y: number; rotation: number; snapped: boolean } {
  let bestDist = maxDist;
  let bestPoint: Point2D = [x, y];
  let bestAngle = 0;
  let snapped = false;

  const checkSegment = (a: Point2D, b: Point2D) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1) return;
    let t = ((x - a[0]) * dx + (y - a[1]) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const px = a[0] + t * dx;
    const py = a[1] + t * dy;
    const dist = Math.hypot(x - px, y - py);
    if (dist < bestDist) {
      bestDist = dist;
      // Snap position along the wall to half-grid increments so doors sit centered on tiles!
      const len = Math.sqrt(lenSq);
      const rawDistAlong = t * len;
      const halfGrid = GRID_SIZE / 2;
      const snappedDistAlong = Math.round(rawDistAlong / halfGrid) * halfGrid;
      const clampedDist = Math.max(0, Math.min(len, snappedDistAlong));
      const ux = dx / len;
      const uy = dy / len;
      bestPoint = [a[0] + ux * clampedDist, a[1] + uy * clampedDist];
      bestAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
      snapped = true;
    }
  };

  for (const layer of layers) {
    if (!layer.visible) continue;
    for (const poly of layer.geometry) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) {
          checkSegment(ring[i], ring[i + 1]);
        }
      }
    }
    for (const sw of layer.standaloneWalls) {
      for (let i = 0; i < sw.points.length - 1; i++) {
        checkSegment(sw.points[i], sw.points[i + 1]);
      }
    }
  }

  return {
    x: bestPoint[0],
    y: bestPoint[1],
    rotation: bestAngle,
    snapped,
  };
}

/**
 * Computes orthogonal L-elbow path between start and end points
 */
export function computeElbowPath(
  start: Point2D,
  end: Point2D,
  horizontalFirst: boolean
): Point2D[] {
  if (Math.abs(start[0] - end[0]) < 1 || Math.abs(start[1] - end[1]) < 1) {
    return [start, end];
  }
  const mid: Point2D = horizontalFirst ? [end[0], start[1]] : [start[0], end[1]];
  return [start, mid, end];
}

export interface ExteriorBuildingData {
  ridgePath: string;
  hipPath: string;
  shadedSlopePath: string;
  roofDetailPath: string;
  raggedPath: string;
  crenellationsPath: string;
  brokenPath: string;
  palisadePosts: { x: number; y: number; r: number }[];
  rubblePaths: string[];
  cornerTowers: { x: number; y: number; r: number }[];
}

export interface ExteriorWallSvgData {
  linePath: string;
  railPath: string;
  hedgePath: string;
  crenellationsPath: string;
  posts: { x: number; y: number; r: number }[];
  towers: { x: number; y: number; r: number }[];
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface HipRoof {
  horizontal: boolean;
  bounds: Bounds;
  ridgeA: Point2D;
  ridgeB: Point2D;
}

interface StrokeSample {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

function emptyBuildingData(): ExteriorBuildingData {
  return {
    ridgePath: '',
    hipPath: '',
    shadedSlopePath: '',
    roofDetailPath: '',
    raggedPath: '',
    crenellationsPath: '',
    brokenPath: '',
    palisadePosts: [],
    rubblePaths: [],
    cornerTowers: [],
  };
}

function ringBounds(ring: Ring2D): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of ring) {
    if (point[0] < minX) minX = point[0];
    if (point[1] < minY) minY = point[1];
    if (point[0] > maxX) maxX = point[0];
    if (point[1] > maxY) maxY = point[1];
  }
  return { minX, minY, maxX, maxY };
}

function uniqueRingPoints(ring: Ring2D): Point2D[] {
  const points: Point2D[] = [];
  for (const point of ring) {
    const last = points[points.length - 1];
    if (last && Math.hypot(last[0] - point[0], last[1] - point[1]) < 0.6) continue;
    points.push(point);
  }
  if (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.6) points.pop();
  }
  return points;
}

function ringCentroid(ring: Ring2D): Point2D {
  const points = uniqueRingPoints(ring);
  if (!points.length) return [0, 0];
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point[0];
    y += point[1];
  }
  return [x / points.length, y / points.length];
}

function axisAlignedRect(ring: Ring2D): Bounds | null {
  const points = uniqueRingPoints(ring);
  if (points.length !== 4) return null;
  const bounds = ringBounds(points);
  if (bounds.maxX - bounds.minX < 2 || bounds.maxY - bounds.minY < 2) return null;
  const corners: Point2D[] = [
    [bounds.minX, bounds.minY],
    [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY],
    [bounds.minX, bounds.maxY],
  ];
  for (const corner of corners) {
    if (!points.some((point) => Math.hypot(point[0] - corner[0], point[1] - corner[1]) <= 1.5)) {
      return null;
    }
  }
  return bounds;
}

function hipRoofOfRect(bounds: Bounds): HipRoof {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (width >= height) {
    const y = (bounds.minY + bounds.maxY) / 2;
    const inset = height / 2;
    return {
      horizontal: true,
      bounds,
      ridgeA: [bounds.minX + inset, y],
      ridgeB: [bounds.maxX - inset, y],
    };
  }
  const x = (bounds.minX + bounds.maxX) / 2;
  const inset = width / 2;
  return {
    horizontal: false,
    bounds,
    ridgeA: [x, bounds.minY + inset],
    ridgeB: [x, bounds.maxY - inset],
  };
}

function generalRidge(ring: Ring2D): HipRoof {
  const bounds = ringBounds(ring);
  const [cx, cy] = ringCentroid(ring);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (width >= height) {
    const half = width * 0.28;
    return { horizontal: true, bounds, ridgeA: [cx - half, cy], ridgeB: [cx + half, cy] };
  }
  const half = height * 0.28;
  return { horizontal: false, bounds, ridgeA: [cx, cy - half], ridgeB: [cx, cy + half] };
}

function pointsToPolygon(pts: Point2D[]): Polygon2D {
  const ring: Ring2D = [];
  for (const point of pts) {
    const last = ring[ring.length - 1];
    if (last && Math.hypot(last[0] - point[0], last[1] - point[1]) < 0.4) continue;
    ring.push([point[0], point[1]]);
  }
  if (ring.length < 3) return [];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return [ring];
}

function clipToPolygon(poly: Polygon2D, piece: Polygon2D): string {
  if (!poly.length || !piece.length) return '';
  try {
    const hit = polygonClipping.intersection(
      poly as unknown as polygonClipping.Geom,
      piece as unknown as polygonClipping.Geom
    );
    return multiPolygonToSvgPath(hit as unknown as MultiPolygon2D);
  } catch {
    return '';
  }
}

function linePath(a: Point2D, b: Point2D): string {
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1.2) return '';
  return `M ${a[0].toFixed(1)} ${a[1].toFixed(1)} L ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
}

function polylinePath(points: Point2D[]): string {
  if (points.length < 2) return '';
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point[0].toFixed(1)} ${point[1].toFixed(1)}`)
    .join(' ');
}

function shadePiece(roof: HipRoof): Polygon2D {
  const { minX, minY, maxX, maxY } = roof.bounds;
  if (roof.horizontal) {
    return pointsToPolygon([
      [minX, maxY],
      [maxX, maxY],
      roof.ridgeB,
      roof.ridgeA,
    ]);
  }
  return pointsToPolygon([
    [maxX, minY],
    [maxX, maxY],
    roof.ridgeB,
    roof.ridgeA,
  ]);
}

function hipLines(corners: Point2D[], roof: HipRoof): string {
  return corners
    .map((corner) => {
      const distA = Math.hypot(corner[0] - roof.ridgeA[0], corner[1] - roof.ridgeA[1]);
      const distB = Math.hypot(corner[0] - roof.ridgeB[0], corner[1] - roof.ridgeB[1]);
      return linePath(corner, distA <= distB ? roof.ridgeA : roof.ridgeB);
    })
    .filter(Boolean)
    .join(' ');
}

function addCourse(
  parts: string[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  style: BuildingStyle,
  ink: number,
  seed: number
) {
  if (Math.hypot(x2 - x1, y2 - y1) < 4 * ink) return;
  if (style !== 'roof_thatch') {
    parts.push(`M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)}`);
    return;
  }
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const jitter = (hash2D(x1 / ink, y1 / ink, seed) - 0.5) * 4 * ink;
  const mx = (x1 + x2) / 2 + (-dy / len) * jitter;
  const my = (y1 + y2) / 2 + (dx / len) * jitter;
  parts.push(
    `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`
  );
}

function emitSlopeCourses(
  parts: string[],
  eaveA: Point2D,
  eaveB: Point2D,
  ridgeA: Point2D,
  ridgeB: Point2D,
  depth: number,
  spacing: number,
  style: BuildingStyle,
  ink: number,
  seed: number
) {
  if (depth < spacing * 0.8) return;
  const steps = Math.max(2, Math.floor(depth / spacing));
  for (let step = 1; step < steps; step++) {
    const t = step / steps;
    addCourse(
      parts,
      eaveA[0] + (ridgeA[0] - eaveA[0]) * t,
      eaveA[1] + (ridgeA[1] - eaveA[1]) * t,
      eaveB[0] + (ridgeB[0] - eaveB[0]) * t,
      eaveB[1] + (ridgeB[1] - eaveB[1]) * t,
      style,
      ink,
      seed + step
    );
  }
}

function rectRoofCourses(roof: HipRoof, style: BuildingStyle, ink: number): string {
  const parts: string[] = [];
  const spacing = style === 'roof_slate' ? 6 * ink : style === 'roof_thatch' ? 12 * ink : 8 * ink;
  const { minX, minY, maxX, maxY } = roof.bounds;
  if (roof.horizontal) {
    const depth = (maxY - minY) / 2;
    emitSlopeCourses(parts, [minX, maxY], [maxX, maxY], roof.ridgeA, roof.ridgeB, depth, spacing, style, ink, 11);
    emitSlopeCourses(parts, [minX, minY], [maxX, minY], roof.ridgeA, roof.ridgeB, depth, spacing, style, ink, 29);
    emitSlopeCourses(
      parts,
      [minX, minY],
      [minX, maxY],
      roof.ridgeA,
      roof.ridgeA,
      roof.ridgeA[0] - minX,
      spacing,
      style,
      ink,
      47
    );
    emitSlopeCourses(
      parts,
      [maxX, minY],
      [maxX, maxY],
      roof.ridgeB,
      roof.ridgeB,
      maxX - roof.ridgeB[0],
      spacing,
      style,
      ink,
      67
    );
  } else {
    const depth = (maxX - minX) / 2;
    emitSlopeCourses(parts, [maxX, minY], [maxX, maxY], roof.ridgeA, roof.ridgeB, depth, spacing, style, ink, 11);
    emitSlopeCourses(parts, [minX, minY], [minX, maxY], roof.ridgeA, roof.ridgeB, depth, spacing, style, ink, 29);
    emitSlopeCourses(
      parts,
      [minX, minY],
      [maxX, minY],
      roof.ridgeA,
      roof.ridgeA,
      roof.ridgeA[1] - minY,
      spacing,
      style,
      ink,
      47
    );
    emitSlopeCourses(
      parts,
      [minX, maxY],
      [maxX, maxY],
      roof.ridgeB,
      roof.ridgeB,
      maxY - roof.ridgeB[1],
      spacing,
      style,
      ink,
      67
    );
  }
  return parts.join(' ');
}

interface PolySegment {
  a: Point2D;
  b: Point2D;
  len: number;
  ux: number;
  uy: number;
  nx: number;
  ny: number;
}

function segmentsOf(points: Point2D[]): PolySegment[] {
  const segments: PolySegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 0.4) continue;
    segments.push({ a, b, len, ux: dx / len, uy: dy / len, nx: -dy / len, ny: dx / len });
  }
  return segments;
}

function samplesAlong(points: Point2D[], step: number): StrokeSample[] {
  if (step <= 0) return [];
  const out: StrokeSample[] = [];
  let nextAt = 0;
  let traveled = 0;
  for (const seg of segmentsOf(points)) {
    while (traveled + seg.len >= nextAt - 0.01) {
      const t = Math.max(0, Math.min(1, (nextAt - traveled) / seg.len));
      out.push({
        x: seg.a[0] + seg.ux * seg.len * t,
        y: seg.a[1] + seg.uy * seg.len * t,
        nx: seg.nx,
        ny: seg.ny,
      });
      nextAt += step;
      if (out.length > 4000) return out;
    }
    traveled += seg.len;
  }
  return out;
}

function orientNormal(
  nx: number,
  ny: number,
  mx: number,
  my: number,
  cx: number,
  cy: number,
  outward: boolean
): [number, number] {
  const dot = nx * (mx - cx) + ny * (my - cy);
  if ((dot >= 0) !== outward) return [-nx, -ny];
  return [nx, ny];
}

function merlonPaths(
  points: Point2D[],
  ink: number,
  centroid: Point2D | null,
  baseOffset: number,
  outward = true
): string[] {
  const paths: string[] = [];
  const spacing = 18 * ink;
  const merlonW = 8 * ink;
  const depth = 7 * ink;
  for (const seg of segmentsOf(points)) {
    if (seg.len < merlonW * 1.6) continue;
    const count = Math.max(1, Math.round(seg.len / spacing));
    for (let k = 0; k < count; k++) {
      const dist = ((k + 0.5) * seg.len) / count;
      if (dist < merlonW * 0.65 || dist > seg.len - merlonW * 0.65) continue;
      const cx = seg.a[0] + seg.ux * dist;
      const cy = seg.a[1] + seg.uy * dist;
      let nx = seg.nx;
      let ny = seg.ny;
      if (centroid) {
        [nx, ny] = orientNormal(nx, ny, cx, cy, centroid[0], centroid[1], outward);
      }
      const half = merlonW / 2;
      const b1x = cx - seg.ux * half + nx * baseOffset;
      const b1y = cy - seg.uy * half + ny * baseOffset;
      const b2x = cx + seg.ux * half + nx * baseOffset;
      const b2y = cy + seg.uy * half + ny * baseOffset;
      paths.push(
        `M ${b1x.toFixed(1)} ${b1y.toFixed(1)} L ${b2x.toFixed(1)} ${b2y.toFixed(1)} L ${(b2x + nx * depth).toFixed(1)} ${(b2y + ny * depth).toFixed(1)} L ${(b1x + nx * depth).toFixed(1)} ${(b1y + ny * depth).toFixed(1)} Z`
      );
    }
  }
  return paths;
}

function dedupedMarkers(points: Point2D[], radius: number): { x: number; y: number; r: number }[] {
  const markers: { x: number; y: number; r: number }[] = [];
  for (const point of points) {
    if (markers.some((marker) => Math.hypot(marker.x - point[0], marker.y - point[1]) < radius * 0.75)) {
      continue;
    }
    markers.push({ x: point[0], y: point[1], r: radius });
  }
  return markers;
}

function postsAlong(points: Point2D[], spacing: number, radius: number): { x: number; y: number; r: number }[] {
  return samplesAlong(points, spacing).map((sample) => ({ x: sample.x, y: sample.y, r: radius }));
}

function raggedOutline(ring: Ring2D, ink: number): string {
  const samples = samplesAlong(ring, 12 * ink);
  if (samples.length < 3) return '';
  const points: Point2D[] = samples.map((sample) => {
    const jitter = (hash2D(sample.x / ink, sample.y / ink, 17) - 0.5) * 6 * ink;
    return [sample.x + sample.nx * jitter, sample.y + sample.ny * jitter];
  });
  points.push([points[0][0], points[0][1]]);
  return ringToSvgPath(points);
}

function ruinPerimeter(ring: Ring2D, ink: number): { broken: string; rubble: string[] } {
  const segments: string[] = [];
  const rubble: string[] = [];
  const step = 16 * ink;
  for (const seg of segmentsOf(ring)) {
    const count = Math.max(1, Math.round(seg.len / step));
    for (let k = 0; k < count; k++) {
      const t0 = k / count;
      const t1 = (k + 1) / count;
      const mx = seg.a[0] + (seg.b[0] - seg.a[0]) * ((t0 + t1) * 0.5);
      const my = seg.a[1] + (seg.b[1] - seg.a[1]) * ((t0 + t1) * 0.5);
      const roll = hash2D(mx / ink, my / ink, 509);
      if (roll > 0.3) {
        const j1 = (hash2D(mx / ink, my / ink, 12) - 0.5) * 2.4 * ink;
        const j2 = (hash2D(mx / ink, my / ink, 88) - 0.5) * 2.4 * ink;
        const sx = seg.a[0] + (seg.b[0] - seg.a[0]) * t0 + seg.nx * j1;
        const sy = seg.a[1] + (seg.b[1] - seg.a[1]) * t0 + seg.ny * j1;
        const ex = seg.a[0] + (seg.b[0] - seg.a[0]) * t1 + seg.nx * j2;
        const ey = seg.a[1] + (seg.b[1] - seg.a[1]) * t1 + seg.ny * j2;
        segments.push(`M ${sx.toFixed(1)} ${sy.toFixed(1)} L ${ex.toFixed(1)} ${ey.toFixed(1)}`);
      } else {
        const rx = mx + seg.nx * ((roll - 0.14) * 28 * ink);
        const ry = my + seg.ny * ((roll - 0.14) * 28 * ink);
        const size = (2.6 + roll * 6) * ink;
        rubble.push(
          `M ${(rx - size).toFixed(1)} ${(ry - size * 0.6).toFixed(1)} L ${(rx + size * 0.8).toFixed(1)} ${(ry - size).toFixed(1)} L ${(rx + size).toFixed(1)} ${(ry + size * 0.7).toFixed(1)} L ${(rx - size * 0.6).toFixed(1)} ${(ry + size * 0.8).toFixed(1)} Z`
        );
      }
    }
  }
  return { broken: segments.join(' '), rubble };
}

function buildHedgePath(points: Point2D[], ink: number): string {
  const samples = samplesAlong(points, 7 * ink);
  if (samples.length < 2) return polylinePath(points);
  return samples
    .map((sample, index) => {
      const jitter = (hash2D(sample.x / ink, sample.y / ink, 23) - 0.5) * 5 * ink;
      const x = sample.x + sample.nx * jitter;
      const y = sample.y + sample.ny * jitter;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

function offsetPolylinePath(points: Point2D[], distance: number): string {
  if (points.length < 2) return '';
  const offsets: Point2D[] = points.map((point, index) => {
    let nx = 0;
    let ny = 0;
    if (index > 0) {
      const prev = points[index - 1];
      const len = Math.hypot(point[0] - prev[0], point[1] - prev[1]) || 1;
      nx += -(point[1] - prev[1]) / len;
      ny += (point[0] - prev[0]) / len;
    }
    if (index < points.length - 1) {
      const next = points[index + 1];
      const len = Math.hypot(next[0] - point[0], next[1] - point[1]) || 1;
      nx += -(next[1] - point[1]) / len;
      ny += (next[0] - point[0]) / len;
    }
    const len = Math.hypot(nx, ny) || 1;
    return [point[0] + (nx / len) * distance, point[1] + (ny / len) * distance];
  });
  return polylinePath(offsets);
}

interface OrientedRect {
  /** c0 -> c1 is a long side, c1 -> c2 a short side. */
  corners: [Point2D, Point2D, Point2D, Point2D];
  length: number;
  width: number;
  center: Point2D;
  ux: number;
  uy: number;
}

function detectOrientedRect(ring: Ring2D): OrientedRect | null {
  const pts = uniqueRingPoints(ring);
  if (pts.length !== 4) return null;
  const edges = [0, 1, 2, 3].map((index) => {
    const a = pts[index];
    const b = pts[(index + 1) % 4];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    return { len: Math.hypot(dx, dy), dx, dy };
  });
  if (edges.some((edge) => edge.len < 4)) return null;
  const similar = (a: number, b: number) => Math.abs(a - b) <= Math.max(3, a * 0.08);
  if (!similar(edges[0].len, edges[2].len) || !similar(edges[1].len, edges[3].len)) return null;
  const adjacent = Math.abs(edges[0].dx * edges[1].dx + edges[0].dy * edges[1].dy) / (edges[0].len * edges[1].len);
  if (adjacent > 0.16) return null;
  const ordered = edges[0].len >= edges[1].len ? pts : [pts[1], pts[2], pts[3], pts[0]];
  const c0 = ordered[0];
  const c1 = ordered[1];
  const c2 = ordered[2];
  const c3 = ordered[3];
  const length = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
  const width = Math.hypot(c2[0] - c1[0], c2[1] - c1[1]);
  if (length < 4 || width < 4) return null;
  return {
    corners: [c0, c1, c2, c3],
    length,
    width,
    center: [(c0[0] + c1[0] + c2[0] + c3[0]) / 4, (c0[1] + c1[1] + c2[1] + c3[1]) / 4],
    ux: (c1[0] - c0[0]) / length,
    uy: (c1[1] - c0[1]) / length,
  };
}

function pushOrientedRoof(
  poly: Polygon2D,
  ring: Ring2D,
  oriented: OrientedRect,
  style: BuildingStyle,
  ink: number,
  ridges: string[],
  hips: string[],
  shades: string[],
  details: string[],
  ragged: string[]
) {
  const [c0, c1, c2, c3] = oriented.corners;
  const ridgeHalf = Math.max(0, (oriented.length - oriented.width) / 2);
  const ridgeA: Point2D = [
    oriented.center[0] - oriented.ux * ridgeHalf,
    oriented.center[1] - oriented.uy * ridgeHalf,
  ];
  const ridgeB: Point2D = [
    oriented.center[0] + oriented.ux * ridgeHalf,
    oriented.center[1] + oriented.uy * ridgeHalf,
  ];
  const ridge = linePath(ridgeA, ridgeB);
  if (ridge) ridges.push(ridge);
  const hip = [c0, c1, c2, c3]
    .map((corner) => {
      const distA = Math.hypot(corner[0] - ridgeA[0], corner[1] - ridgeA[1]);
      const distB = Math.hypot(corner[0] - ridgeB[0], corner[1] - ridgeB[1]);
      return linePath(corner, distA <= distB ? ridgeA : ridgeB);
    })
    .filter(Boolean)
    .join(' ');
  if (hip) hips.push(hip);
  const southFirst = (c0[1] + c1[1]) / 2 >= (c2[1] + c3[1]) / 2;
  const shadePoly = southFirst
    ? pointsToPolygon([c0, c1, ridgeB, ridgeA])
    : pointsToPolygon([c3, c2, ridgeB, ridgeA]);
  const shade = clipToPolygon(poly, shadePoly);
  if (shade) shades.push(shade);
  const spacing = style === 'roof_slate' ? 6 * ink : style === 'roof_thatch' ? 12 * ink : 8 * ink;
  const depth = oriented.width / 2;
  const parts: string[] = [];
  emitSlopeCourses(parts, c0, c1, ridgeA, ridgeB, depth, spacing, style, ink, 11);
  emitSlopeCourses(parts, c3, c2, ridgeA, ridgeB, depth, spacing, style, ink, 29);
  emitSlopeCourses(parts, c1, c2, ridgeB, ridgeB, depth, spacing, style, ink, 47);
  emitSlopeCourses(parts, c0, c3, ridgeA, ridgeA, depth, spacing, style, ink, 67);
  const courses = parts.join(' ');
  if (courses) details.push(courses);
  if (style === 'roof_thatch') {
    const outline = raggedOutline(ring, ink);
    if (outline) ragged.push(outline);
  }
}

function pushRoof(
  poly: Polygon2D,
  ring: Ring2D,
  style: BuildingStyle,
  ink: number,
  ridges: string[],
  hips: string[],
  shades: string[],
  details: string[],
  ragged: string[]
) {
  const oriented = detectOrientedRect(ring);
  if (oriented) {
    pushOrientedRoof(poly, ring, oriented, style, ink, ridges, hips, shades, details, ragged);
    return;
  }
  const rect = axisAlignedRect(ring);
  const roof = rect ? hipRoofOfRect(rect) : generalRidge(ring);
  const ridge = linePath(roof.ridgeA, roof.ridgeB);
  if (ridge) ridges.push(ridge);
  const corners = rect
    ? ([
        [rect.minX, rect.minY],
        [rect.maxX, rect.minY],
        [rect.maxX, rect.maxY],
        [rect.minX, rect.maxY],
      ] as Point2D[])
    : samplesAlong(ring, 28 * ink).map((sample) => [sample.x, sample.y] as Point2D);
  const hip = hipLines(corners, roof);
  if (hip) hips.push(hip);
  const shade = clipToPolygon(poly, shadePiece(roof));
  if (shade) shades.push(shade);
  if (rect) {
    const courses = rectRoofCourses(roof, style, ink);
    if (courses) details.push(courses);
  }
  if (style === 'roof_thatch') {
    const outline = raggedOutline(ring, ink);
    if (outline) ragged.push(outline);
  }
}

/**
 * Roof planes, crenellations, palisade posts and ruin strokes for one exterior footprint.
 */
export function buildExteriorBuildingData(
  mp: MultiPolygon2D,
  style: BuildingStyle,
  gridSize = GRID_SIZE
): ExteriorBuildingData {
  const data = emptyBuildingData();
  if (!mp || mp.length === 0) return data;
  const ink = inkScale(gridSize);
  const isRoof = style === 'roof_tile' || style === 'roof_thatch' || style === 'roof_slate';
  const ridges: string[] = [];
  const hips: string[] = [];
  const shades: string[] = [];
  const details: string[] = [];
  const ragged: string[] = [];
  const merlons: string[] = [];
  const broken: string[] = [];

  for (const poly of mp) {
    if (!poly.length) continue;
    poly.forEach((ring, ringIndex) => {
      if (ring.length < 4) return;
      if (isRoof && ringIndex === 0) {
        pushRoof(poly, ring, style, ink, ridges, hips, shades, details, ragged);
      }
      if (style === 'castle_wall') {
        merlons.push(...merlonPaths(ring, ink, ringCentroid(ring), 8 * ink, ringIndex === 0));
        if (ringIndex === 0) data.cornerTowers.push(...dedupedMarkers(uniqueRingPoints(ring), 12 * ink));
      }
      if (style === 'palisade') {
        data.palisadePosts.push(...postsAlong(ring, 11 * ink, 4.8 * ink));
      }
      if (style === 'ruined_building') {
        const ruin = ruinPerimeter(ring, ink);
        if (ruin.broken) broken.push(ruin.broken);
        data.rubblePaths.push(...ruin.rubble);
        if (ringIndex === 0) {
          const rect = axisAlignedRect(ring);
          const roof = rect ? hipRoofOfRect(rect) : generalRidge(ring);
          const remnantA: Point2D = [
            roof.ridgeA[0] + (roof.ridgeB[0] - roof.ridgeA[0]) * 0.28,
            roof.ridgeA[1] + (roof.ridgeB[1] - roof.ridgeA[1]) * 0.28,
          ];
          const remnantB: Point2D = [
            roof.ridgeA[0] + (roof.ridgeB[0] - roof.ridgeA[0]) * 0.72,
            roof.ridgeA[1] + (roof.ridgeB[1] - roof.ridgeA[1]) * 0.72,
          ];
          const remnant = linePath(remnantA, remnantB);
          if (remnant) ridges.push(remnant);
        }
      }
    });
  }

  data.ridgePath = ridges.join(' ');
  data.hipPath = hips.join(' ');
  data.shadedSlopePath = shades.join(' ');
  data.roofDetailPath = details.join(' ');
  data.raggedPath = ragged.join(' ');
  data.crenellationsPath = merlons.join(' ');
  data.brokenPath = broken.join(' ');
  return data;
}

/** Curtain walls, palisades, fences and hedges drawn as open polylines. */
export function buildExteriorWallSvgData(
  points: Point2D[],
  style: ExteriorWallStyle,
  gridSize = GRID_SIZE,
  hasTowers = false
): ExteriorWallSvgData {
  const empty: ExteriorWallSvgData = {
    linePath: '',
    railPath: '',
    hedgePath: '',
    crenellationsPath: '',
    posts: [],
    towers: [],
  };
  if (!points || points.length < 2) return empty;
  const ink = inkScale(gridSize);
  const linePathValue = polylinePath(points);
  const towerRadius = style === 'palisade_logs' ? 7.5 * ink : style === 'wood_fence' ? 3.4 * ink : 11 * ink;
  const towers = hasTowers ? dedupedMarkers(points, towerRadius) : [];

  if (style === 'castle_crenellated') {
    return {
      ...empty,
      linePath: linePathValue,
      crenellationsPath: merlonPaths(points, ink, null, 7 * ink).join(' '),
      towers,
    };
  }
  if (style === 'palisade_logs') {
    return {
      ...empty,
      linePath: linePathValue,
      posts: postsAlong(points, 10 * ink, 4.4 * ink),
      towers,
    };
  }
  if (style === 'wood_fence') {
    return {
      ...empty,
      linePath: linePathValue,
      railPath: `${offsetPolylinePath(points, 2.6 * ink)} ${offsetPolylinePath(points, -2.6 * ink)}`,
      posts: postsAlong(points, 18 * ink, 2.3 * ink),
      towers,
    };
  }
  if (style === 'hedge') {
    return { ...empty, linePath: linePathValue, hedgePath: buildHedgePath(points, ink) };
  }
  return { ...empty, linePath: linePathValue, towers };
}

function pointInRingLocal(x: number, y: number, ring: Ring2D): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > y !== yj > y) {
      const xHit = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (x < xHit) inside = !inside;
    }
  }
  return inside;
}

export function pointInPolygonShape(x: number, y: number, poly: Polygon2D): boolean {
  let inside = false;
  for (const ring of poly) {
    if (pointInRingLocal(x, y, ring)) inside = !inside;
  }
  return inside;
}

export function polygonCentroid(poly: Polygon2D): Point2D {
  const ring = uniqueRingPoints(poly[0] ?? []);
  if (!ring.length) return [0, 0];
  let x = 0;
  let y = 0;
  for (const point of ring) {
    x += point[0];
    y += point[1];
  }
  return [x / ring.length, y / ring.length];
}

export function polygonEdgeAngle(poly: Polygon2D): number {
  const ring = uniqueRingPoints(poly[0] ?? []);
  if (ring.length < 2) return 0;
  return Math.atan2(ring[1][1] - ring[0][1], ring[1][0] - ring[0][0]);
}

export function translatePolygon(poly: Polygon2D, dx: number, dy: number): Polygon2D {
  return poly.map((ring) => ring.map((point) => [point[0] + dx, point[1] + dy] as Point2D));
}

export function rotatePolygon(poly: Polygon2D, radians: number, center = polygonCentroid(poly)): Polygon2D {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return poly.map((ring) =>
    ring.map((point) => {
      const dx = point[0] - center[0];
      const dy = point[1] - center[1];
      return [center[0] + dx * cos - dy * sin, center[1] + dx * sin + dy * cos] as Point2D;
    })
  );
}

function ringAreaAbs(ring: Ring2D): number {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(area) / 2;
}

function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function outwardEdgeNormal(a: Point2D, b: Point2D, center: Point2D): Point2D {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  if (nx * (mx - center[0]) + ny * (my - center[1]) < 0) {
    nx = -nx;
    ny = -ny;
  }
  return [nx, ny];
}

function inflatePolygon(poly: Polygon2D, margin: number): Polygon2D {
  const pts = uniqueRingPoints(poly[0] ?? []);
  if (pts.length < 3 || margin <= 0) return poly;
  const center = polygonCentroid(poly);
  const offset = pts.map((cur, index) => {
    const prev = pts[(index + pts.length - 1) % pts.length];
    const next = pts[(index + 1) % pts.length];
    const n1 = outwardEdgeNormal(prev, cur, center);
    const n2 = outwardEdgeNormal(cur, next, center);
    return [cur[0] + (n1[0] + n2[0]) * margin, cur[1] + (n1[1] + n2[1]) * margin] as Point2D;
  });
  offset.push([offset[0][0], offset[0][1]]);
  return [offset];
}

function rotatedRectPolygon(cx: number, cy: number, length: number, width: number, angle: number): Polygon2D {
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
  const ring = local.map(
    ([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos] as Point2D
  );
  ring.push([ring[0][0], ring[0][1]]);
  return [ring];
}

function polygonsOverlap(a: Polygon2D, b: Polygon2D): boolean {
  const aRing = a[0];
  const bRing = b[0];
  if (!aRing || !bRing) return false;
  if (!boundsOverlap(ringBounds(aRing), ringBounds(bRing))) return false;
  try {
    const hit = polygonClipping.intersection(
      a as unknown as polygonClipping.Geom,
      b as unknown as polygonClipping.Geom
    ) as unknown as MultiPolygon2D;
    if (!hit?.length) return false;
    let area = 0;
    for (const poly of hit) {
      if (poly[0]) area += ringAreaAbs(poly[0]);
    }
    return area > 8;
  } catch {
    return true;
  }
}

function polygonInsideRegion(footprint: Polygon2D, region: Polygon2D): boolean {
  const outside = subtractGeometry([footprint], [region]);
  if (!outside.length) return true;
  let area = 0;
  for (const poly of outside) {
    if (poly[0]) area += ringAreaAbs(poly[0]);
  }
  return area < 8;
}

function randomFootprint(preset: DistrictSizePreset): [number, number] {
  const choice = preset === 'mixed' ? (['small', 'medium', 'large'] as const)[Math.floor(Math.random() * 3)] : preset;
  const ranges = {
    small: [2, 3.2, 2, 4],
    medium: [2.5, 4.2, 3.2, 6],
    large: [4, 6.2, 4.5, 8],
  } as const;
  const [w0, w1, h0, h1] = ranges[choice];
  let width = w0 + Math.random() * (w1 - w0);
  let height = h0 + Math.random() * (h1 - h0);
  if (Math.random() < 0.5) {
    const swap = width;
    width = height;
    height = swap;
  }
  return [width, height];
}

function randomBuildingAngle(mode: DistrictAngleMode): number {
  if (mode === 'aligned') return Math.random() < 0.5 ? 0 : Math.PI / 2;
  if (mode === 'jitter') {
    const base = Math.random() < 0.5 ? 0 : Math.PI / 2;
    return base + ((Math.random() * 40 - 20) * Math.PI) / 180;
  }
  return Math.random() * Math.PI;
}

function collectObstaclePolygons(layers: DungeonLayer[]): Polygon2D[] {
  const obstacles: Polygon2D[] = [];
  for (const layer of layers) {
    if (layer.visible === false) continue;
    for (const poly of layer.geometry ?? []) {
      if (poly[0]?.length) obstacles.push(poly);
    }
    for (const road of layer.roads ?? []) {
      for (const poly of road.polygon ?? []) {
        if (poly[0]?.length) obstacles.push(poly);
      }
    }
    for (const wall of layer.standaloneWalls ?? []) {
      const ribbon = corridorPathToMultiPolygon(wall.points, Math.max(8, wall.thickness || 12));
      for (const poly of ribbon) {
        if (poly[0]?.length) obstacles.push(poly);
      }
    }
  }
  return obstacles;
}

export interface DistrictGenerateResult {
  buildings: Polygon2D[];
  placedCount: number;
  crowded: boolean;
}

/**
 * Scatter sensible building footprints inside a region.
 * Existing buildings, roads and walls on every visible layer stay clear.
 */
export function generateBuildingsInRegion(
  region: Polygon2D,
  layers: DungeonLayer[],
  options: {
    density: number;
    sizePreset: DistrictSizePreset;
    angleMode: DistrictAngleMode;
    gridSize: number;
  }
): DistrictGenerateResult {
  const empty = { buildings: [] as Polygon2D[], placedCount: 0, crowded: true };
  const ring = region[0];
  if (!ring || ring.length < 4) return empty;
  const grid = options.gridSize || GRID_SIZE;
  const bounds = ringBounds(ring);
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  if (spanX < grid * 1.8 || spanY < grid * 1.8) return empty;

  const density = Math.min(1, Math.max(0, options.density));
  const margin = grid * (2 - density * 1.65);
  const obstacles = collectObstaclePolygons(layers);
  const buildings: Polygon2D[] = [];
  const area = ringAreaAbs(ring);
  const attempts = Math.min(640, Math.max(90, Math.round(area / (grid * grid * 2.4))));

  for (let attempt = 0; attempt < attempts; attempt++) {
    const [widthCells, heightCells] = randomFootprint(options.sizePreset);
    const length = Math.max(widthCells, heightCells) * grid;
    const width = Math.min(widthCells, heightCells) * grid;
    const x = bounds.minX + Math.random() * spanX;
    const y = bounds.minY + Math.random() * spanY;
    if (!pointInPolygonShape(x, y, region)) continue;
    const footprint = rotatedRectPolygon(x, y, length, width, randomBuildingAngle(options.angleMode));
    if (!polygonInsideRegion(footprint, region)) continue;
    const padded = inflatePolygon(footprint, margin);
    if (obstacles.some((obstacle) => polygonsOverlap(padded, obstacle))) continue;
    buildings.push(footprint);
    obstacles.push(footprint);
  }

  return {
    buildings,
    placedCount: buildings.length,
    crowded: buildings.length === 0,
  };
}
