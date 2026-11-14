import {
  BuildingStyle,
  DoorItem,
  DoorType,
  DungeonDocument,
  ExteriorWallStyle,
  Point2D,
  Polygon2D,
  WallStyle,
  layerEnvironment,
} from '../types/dungeon';
import { hash2D, inkScale } from './geometry';
import {
  ISO_K,
  IsoQuarter,
  facingOfNormal,
  projectIso,
  rotateQuarter,
  shadeByFacing,
} from './isoProjection';

type Pt = [number, number];

export interface IsoFaceDraw {
  kind: 'face';
  id: string;
  points: Array<[number, number, number]>;
  fill: string;
  opacity: number;
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  closed: boolean;
}

export interface IsoRoofDraw {
  kind: 'roof';
  id: string;
  polygon: Polygon2D;
  style: BuildingStyle;
  z: number;
  opacity: number;
}

export interface IsoDrawable {
  sxMin: number;
  sxMax: number;
  zMin: number;
  zMax: number;
  depthAt: (sx: number) => number;
  tie: number;
  draw: IsoFaceDraw | IsoRoofDraw;
}

/** Interior curbs of one colour, joined into a single path. */
export interface IsoBatch {
  id: string;
  d: string;
  fill: string;
  opacity: number;
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
}

export interface IsoModel {
  curbs: IsoBatch[];
  volumes: IsoDrawable[];
}

interface BatchBucket {
  fill: string;
  opacity: number;
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  order: number;
  parts: string[];
}

export interface IsoPalette {
  wallFill: string;
  floorFill: string;
  ink: string;
}

const PORTALS = new Set<DoorType>([
  'standard',
  'double',
  'portcullis',
  'archway',
  'gatehouse',
  'wood_gate',
]);

const ROOF_STYLES = new Set<BuildingStyle>(['roof_tile', 'roof_thatch', 'roof_slate']);

const ROOF_COLOR: Record<'roof_tile' | 'roof_thatch' | 'roof_slate', string> = {
  roof_tile: '#b4533a',
  roof_thatch: '#c4a15a',
  roof_slate: '#4b5563',
};

interface EdgeCut {
  t0: number;
  t1: number;
  type: DoorType;
}

interface Builder {
  quarter: IsoQuarter;
  opacity: number;
  inkColor: string;
  items: IsoDrawable[];
  serial: number;
  /** Interior curbs share one path per fill instead of a node per face. */
  batch: boolean;
  batches: Map<string, BatchBucket>;
}

export function buildIsoModel(
  doc: DungeonDocument,
  quarter: IsoQuarter,
  wallHeightPx: number,
  palette: IsoPalette
): IsoModel {
  const grid = doc.gridSize || 64;
  const ink = inkScale(grid);
  const items: IsoDrawable[] = [];
  const builder: Builder = {
    quarter,
    opacity: 1,
    inkColor: palette.ink,
    items,
    serial: 1,
    batch: false,
    batches: new Map(),
  };
  const doors = doc.doors;
  const curbHeight = grid * 0.25;

  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    builder.opacity = layer.opacity;
    const exterior = layerEnvironment(layer) === 'exterior';
    if (!exterior) {
      const wallFill = layer.wallFillOverride || palette.wallFill;
      const previousInk = builder.inkColor;
      builder.inkColor = layer.inkStrokeOverride || palette.ink;
      builder.batch = true;
      for (const polygon of layer.geometry) {
        polygon.forEach((ring, ringIndex) => {
          extrudeLoop(builder, ring, {
            thickness: layer.wallStyle === 'brick' || layer.wallStyle === 'double' ? 7.5 * ink : 5 * ink,
            height: curbHeight,
            color: wallFill,
            doors,
            grid,
            ink,
            lowCurb: true,
            ringIndex,
            wallStyle: layer.wallStyle,
            ruin: layer.wallStyle === 'ruins' ? 'interior' : null,
            rock: layer.wallStyle === 'rock',
            brick: layer.wallStyle === 'brick',
            crenels: false,
            towers: false,
          });
        });
      }
      for (const wall of layer.standaloneWalls) {
        extrudeRibbon(builder, wall.points, {
          thickness: wall.thickness * ink * 0.5,
          height: curbHeight,
          color: wallFill,
          doors,
          grid,
          ink,
          lowCurb: true,
          wallStyle: wall.wallStyle,
          ruin: wall.wallStyle === 'ruins' ? 'interior' : null,
          rock: wall.wallStyle === 'rock',
          brick: wall.wallStyle === 'brick',
          crenels: false,
          towers: false,
          towerRadius: 0,
          towerHeight: 0,
        });
      }
      builder.batch = false;
      builder.inkColor = previousInk;
      continue;
    }

    const style = layer.buildingStyle ?? 'roof_tile';
    const ringHeight =
      style === 'castle_wall' ? 1.25 * wallHeightPx : style === 'palisade' ? 0.85 * wallHeightPx : wallHeightPx;
    const ringColor = style === 'palisade' ? '#a56b3c' : palette.wallFill;
    for (const polygon of layer.geometry) {
      const outer = openRing(polygon[0] ?? []);
      if (ROOF_STYLES.has(style)) {
        polygon.forEach((ring, ringIndex) => {
          extrudeLoop(builder, ring, {
            thickness: 5 * ink,
            height: wallHeightPx,
            color: palette.wallFill,
            doors,
            grid,
            ink,
            lowCurb: false,
            ringIndex,
            wallStyle: 'straight',
            ruin: null,
            rock: false,
            brick: false,
            crenels: false,
            towers: false,
          });
        });
        if (!emitHipRoof(builder, outer, wallHeightPx, style as 'roof_tile' | 'roof_thatch' | 'roof_slate', palette.ink)) {
          emitLiftedRoof(builder, polygon, wallHeightPx, style);
        }
      } else {
        polygon.forEach((ring, ringIndex) => {
          extrudeLoop(builder, ring, {
            thickness: style === 'castle_wall' ? 12 * ink : 6 * ink,
            height: ringHeight,
            color: ringColor,
            doors,
            grid,
            ink,
            lowCurb: false,
            ringIndex,
            wallStyle: 'straight',
            ruin: style === 'ruined_building' ? 'exterior' : null,
            rock: false,
            brick: false,
            crenels: style === 'castle_wall',
            towers: style === 'castle_wall' && ringIndex === 0,
            towerRadius: 11 * ink,
            towerHeight: 1.5 * wallHeightPx,
          });
        });
      }
    }

    for (const wall of layer.standaloneWalls) {
      const look = exteriorLook(wall.exteriorWallStyle ?? 'stone_wall', wallHeightPx, palette.wallFill);
      extrudeRibbon(builder, wall.points, {
        thickness: look.thickness * ink,
        height: look.height,
        color: look.color,
        doors,
        grid,
        ink,
        wallStyle: 'straight',
        ruin: null,
        rock: false,
        brick: false,
        crenels: look.crenels,
        towers: Boolean(wall.hasTowers),
        towerRadius: look.towerRadius * ink,
        towerHeight: look.towerHeight,
        lowCurb: false,
      });
    }
  }

  emitNature(builder, doc);

  const curbs: IsoBatch[] = [];
  let batchIndex = 0;
  const buckets = [...builder.batches.values()].sort((a, b) => a.order - b.order);
  for (const bucket of buckets) {
    if (!bucket.parts.length) continue;
    curbs.push({
      id: `iso-curb-${batchIndex++}`,
      d: bucket.parts.join(''),
      fill: bucket.fill,
      opacity: bucket.opacity,
      stroke: bucket.stroke,
      strokeWidth: bucket.strokeWidth,
      strokeOpacity: bucket.strokeOpacity,
    });
  }
  items.sort((a, b) => a.tie - b.tie);
  return { curbs, volumes: items };
}

function emitNature(builder: Builder, doc: DungeonDocument) {
  const wasBatch = builder.batch;
  builder.batch = false;
  builder.opacity = 1;
  for (const prop of doc.props) {
    if (prop.kind !== 'svg') continue;
    const size = prop.widthPx * prop.scale;
    if (size < 4) continue;
    if (prop.artwork === 'upright') continue;
    if (prop.svgPropId === 'tree') emitTree(builder, prop.x, prop.y, size);
    else if (prop.svgPropId === 'boulder') emitBoulder(builder, prop.x, prop.y, size);
  }
  builder.batch = wasBatch;
}

function emitTree(builder: Builder, x: number, y: number, size: number) {
  extrudePrism(builder, x, y, size * 0.07, size * 0.48, '#5c3b22');
  emitCone(builder, x, y, size * 0.36, size * 0.72, size * 0.36, '#4d7c3a');
  emitCone(builder, x, y, size * 0.58, size * 0.96, size * 0.24, '#6b9c4b');
}

function emitBoulder(builder: Builder, x: number, y: number, size: number) {
  const sides = 7;
  const height = size * 0.34;
  const color = '#94a3b8';
  const ring = (z: number, radius: number): Array<[number, number, number]> => {
    const points: Array<[number, number, number]> = [];
    for (let index = 0; index < sides; index++) {
      const angle = (index / sides) * Math.PI * 2;
      points.push([x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, z]);
    }
    return points;
  };
  const bottom = ring(0, size * 0.42);
  const mid = ring(height * 0.62, size * 0.28);
  for (let index = 0; index < sides; index++) {
    const next = (index + 1) % sides;
    const normal = normalize(bottom[index][0] + bottom[next][0] - 2 * x, bottom[index][1] + bottom[next][1] - 2 * y);
    const shade = shadeByFacing(color, facingOfNormal(normal[0], normal[1], builder.quarter), 'side');
    pushFace(
      builder,
      [bottom[index], bottom[next], mid[next], mid[index]],
      shade,
      { x0: bottom[index][0], y0: bottom[index][1], x1: bottom[next][0], y1: bottom[next][1] }
    );
    pushFace(
      builder,
      [mid[index], mid[next], [x, y, height]],
      shadeByFacing(color, facingOfNormal(normal[0], normal[1], builder.quarter), 'top'),
      { x0: mid[index][0], y0: mid[index][1], x1: mid[next][0], y1: mid[next][1] }
    );
  }
}

function emitCone(
  builder: Builder,
  x: number,
  y: number,
  zBase: number,
  zApex: number,
  radius: number,
  color: string
) {
  const sides = 8;
  const base: Pt[] = [];
  for (let index = 0; index < sides; index++) {
    const angle = (index / sides) * Math.PI * 2;
    base.push([x + Math.cos(angle) * radius, y + Math.sin(angle) * radius]);
  }
  for (let index = 0; index < sides; index++) {
    const a = base[index];
    const b = base[(index + 1) % sides];
    const normal = normalize(a[0] + b[0] - 2 * x, a[1] + b[1] - 2 * y);
    pushFace(
      builder,
      [
        [a[0], a[1], zBase],
        [b[0], b[1], zBase],
        [x, y, zApex],
      ],
      shadeByFacing(color, facingOfNormal(normal[0], normal[1], builder.quarter), 'side'),
      { x0: a[0], y0: a[1], x1: b[0], y1: b[1] }
    );
  }
}

function exteriorLook(style: ExteriorWallStyle, wallHeight: number, stone: string) {
  switch (style) {
    case 'castle_crenellated':
      return { height: 1.25 * wallHeight, thickness: 12, color: stone, crenels: true, towerRadius: 11, towerHeight: 1.45 * wallHeight };
    case 'stone_wall':
      return { height: 0.9 * wallHeight, thickness: 8, color: stone, crenels: false, towerRadius: 8, towerHeight: 1.15 * wallHeight };
    case 'palisade_logs':
      return { height: 0.85 * wallHeight, thickness: 6, color: '#a56b3c', crenels: false, towerRadius: 7.5, towerHeight: 1.05 * wallHeight };
    case 'wood_fence':
      return { height: 0.42 * wallHeight, thickness: 3, color: '#8a5a32', crenels: false, towerRadius: 3.4, towerHeight: 0.55 * wallHeight };
    default:
      return { height: 0.52 * wallHeight, thickness: 8, color: '#2f6b3a', crenels: false, towerRadius: 6, towerHeight: 0.62 * wallHeight };
  }
}

interface LoopOptions {
  thickness: number;
  height: number;
  color: string;
  doors: DoorItem[];
  grid: number;
  ink: number;
  /** Quarter-cell interior curb: no subdivision, no lintel. */
  lowCurb: boolean;
  ringIndex: number;
  wallStyle: WallStyle;
  ruin: 'interior' | 'exterior' | null;
  rock: boolean;
  brick: boolean;
  crenels: boolean;
  towers: boolean;
  towerRadius?: number;
  towerHeight?: number;
}

function extrudeLoop(builder: Builder, ring: Point2D[], options: LoopOptions) {
  let pts = openRing(ring);
  if (pts.length < 3) return;
  const wantPositive = options.ringIndex === 0;
  if (signedArea(pts) > 0 !== wantPositive) pts = [...pts].reverse();
  const width = Math.max(1, options.thickness);
  const segments: SegmentOffset[] = [];
  for (let index = 0; index < pts.length; index++) {
    const next = (index + 1) % pts.length;
    const start = pts[index];
    const end = pts[next];
    const normal = outsideNormal(start, end);
    const outerA: Pt = [start[0] + normal[0] * width, start[1] + normal[1] * width];
    const outerB: Pt = [end[0] + normal[0] * width, end[1] + normal[1] * width];
    segments.push({ start, end, outerA, outerB, normal });
    extrudeSegment(builder, start, end, outerA, outerB, options, true);
  }
  for (let index = 0; index < segments.length; index++) {
    const previous = segments[(index + segments.length - 1) % segments.length];
    const current = segments[index];
    emitCorner(builder, current.start, previous.outerB, current.outerA, options);
  }
  if (options.towers && options.towerRadius && options.towerHeight) {
    for (const point of pts) {
      extrudePrism(builder, point[0], point[1], options.towerRadius, options.towerHeight, options.color);
    }
  }
}

interface SegmentOffset {
  start: Pt;
  end: Pt;
  outerA: Pt;
  outerB: Pt;
  normal: Pt;
}

interface RibbonOptions {
  thickness: number;
  height: number;
  color: string;
  doors: DoorItem[];
  grid: number;
  ink: number;
  lowCurb: boolean;
  wallStyle: WallStyle;
  ruin: 'interior' | 'exterior' | null;
  rock: boolean;
  brick: boolean;
  crenels: boolean;
  towers: boolean;
  towerRadius: number;
  towerHeight: number;
}

function extrudeRibbon(builder: Builder, points: Point2D[], options: RibbonOptions) {
  const pts = openRing(points);
  if (pts.length < 2) return;
  const half = Math.max(0.6, options.thickness / 2);
  const loopLike: LoopOptions = {
    ...options,
    ringIndex: 0,
    towers: false,
  };
  const sides: Array<{ outerA: Pt; outerB: Pt; innerA: Pt; innerB: Pt }> = [];
  for (let index = 0; index < pts.length - 1; index++) {
    const start = pts[index];
    const end = pts[index + 1];
    const normal = sideNormal(start, end);
    const leftA: Pt = [start[0] + normal[0] * half, start[1] + normal[1] * half];
    const leftB: Pt = [end[0] + normal[0] * half, end[1] + normal[1] * half];
    const rightA: Pt = [start[0] - normal[0] * half, start[1] - normal[1] * half];
    const rightB: Pt = [end[0] - normal[0] * half, end[1] - normal[1] * half];
    sides.push({ outerA: leftA, outerB: leftB, innerA: rightA, innerB: rightB });
    extrudeSegment(builder, start, end, leftA, leftB, loopLike, false);
    extrudeSegment(builder, start, end, rightA, rightB, loopLike, false);
  }
  for (let index = 1; index < sides.length; index++) {
    const previous = sides[index - 1];
    const current = sides[index];
    emitCap(builder, previous.outerB, current.outerA, options.height, options.color);
    emitCap(builder, current.innerA, previous.innerB, options.height, options.color);
  }
  const first = sides[0];
  const last = sides[sides.length - 1];
  if (first && last) {
    emitCap(builder, first.innerA, first.outerA, options.height, options.color);
    emitCap(builder, last.outerB, last.innerB, options.height, options.color);
  }
  if (options.towers) {
    for (const point of pts) {
      extrudePrism(builder, point[0], point[1], options.towerRadius, options.towerHeight, options.color);
    }
  }
}

function extrudeSegment(
  builder: Builder,
  innerA: Pt,
  innerB: Pt,
  outerA: Pt,
  outerB: Pt,
  options: LoopOptions,
  useInnerFace: boolean
) {
  const dx = innerB[0] - innerA[0];
  const dy = innerB[1] - innerA[1];
  const len = Math.hypot(dx, dy);
  if (len < 0.4) return;
  const nOut = normalize(outerA[0] - innerA[0], outerA[1] - innerA[1]);
  const baseHeight = options.height;
  const cuts = matchDoors(options.doors, innerA, innerB, len, options.grid);
  const secrets = matchSecrets(options.doors, innerA, innerB, len, options.grid);
  const spans = subtractCuts(len, cuts);
  const step = options.lowCurb ? Number.POSITIVE_INFINITY : options.grid;

  for (const span of spans) {
    const pieces = Math.max(1, Math.ceil((span.t1 - span.t0) / step));
    for (let piece = 0; piece < pieces; piece++) {
      const t0 = span.t0 + ((span.t1 - span.t0) * piece) / pieces;
      const t1 = span.t0 + ((span.t1 - span.t0) * (piece + 1)) / pieces;
      const a = sample(innerA, innerB, outerA, outerB, t0 / len);
      const b = sample(innerA, innerB, outerA, outerB, t1 / len);
      const midX = (a.inner[0] + b.inner[0]) / 2;
      const midY = (a.inner[1] + b.inner[1]) / 2;
      let height = baseHeight;
      if (options.ruin === 'interior') height *= 0.12 + hash2D(midX, midY, 509) * 0.8;
      else if (options.ruin === 'exterior') height *= 0.2 + hash2D(midX, midY, 509) * 0.55;
      else if (options.rock) height *= 0.88 + hash2D(midX, midY, 41) * 0.18;
      if (height < 0.8) continue;

      if (span.opening === 'door') {
        emitJamb(builder, a, height, options.color, innerA, innerB);
        emitJamb(builder, b, height, options.color, innerB, innerA);
        if (!options.lowCurb && span.type !== 'wood_gate') {
          const openingTop = height * 0.72;
          if (height - openingTop > 1) {
            emitWallPiece(builder, a, b, openingTop, height, options, nOut, useInnerFace);
          }
        }
        continue;
      }

      emitWallPiece(builder, a, b, 0, height, options, nOut, useInnerFace);
      if (options.crenels && piece % 2 === 0) {
        const merlon = options.height * 0.18;
        emitWallPiece(builder, a, b, height, height + merlon, { ...options, brick: false }, nOut, false);
      }
    }
  }

  for (const secret of secrets) {
    const center = sample(innerA, innerB, outerA, outerB, secret / len);
    const along = normalize(dx, dy);
    const half = Math.max(1.2, options.ink);
    const p0 = sample(innerA, innerB, outerA, outerB, Math.max(0, secret - half) / len);
    const p1 = sample(innerA, innerB, outerA, outerB, Math.min(len, secret + half) / len);
    const z0 = baseHeight * 0.18;
    const z1 = baseHeight * 0.68;
    pushFace(builder, [
      [p0.outer[0] + nOut[0] * 0.4, p0.outer[1] + nOut[1] * 0.4, z0],
      [p1.outer[0] + nOut[0] * 0.4, p1.outer[1] + nOut[1] * 0.4, z0],
      [p1.outer[0] + nOut[0] * 0.4, p1.outer[1] + nOut[1] * 0.4, z1],
      [p0.outer[0] + nOut[0] * 0.4, p0.outer[1] + nOut[1] * 0.4, z1],
    ], shadeByFacing(options.color, facingOfNormal(nOut[0], nOut[1], builder.quarter) + 1, 'side'), {
      x0: center.outer[0],
      y0: center.outer[1],
      x1: center.outer[0] + along[0],
      y1: center.outer[1] + along[1],
    });
  }
}

function emitCorner(builder: Builder, inner: Pt, outerA: Pt, outerB: Pt, options: LoopOptions) {
  if (Math.hypot(outerA[0] - outerB[0], outerA[1] - outerB[1]) < 0.8) return;
  const height = options.height;
  const normal = normalize(outerA[0] + outerB[0] - 2 * inner[0], outerA[1] + outerB[1] - 2 * inner[1]);
  pushFace(
    builder,
    [
      [outerA[0], outerA[1], 0],
      [outerB[0], outerB[1], 0],
      [outerB[0], outerB[1], height],
      [outerA[0], outerA[1], height],
    ],
    shadeByFacing(options.color, facingOfNormal(normal[0], normal[1], builder.quarter), 'side'),
    { x0: outerA[0], y0: outerA[1], x1: outerB[0], y1: outerB[1] },
    0,
    'corner'
  );
  pushFace(
    builder,
    [
      [inner[0], inner[1], height],
      [outerA[0], outerA[1], height],
      [outerB[0], outerB[1], height],
    ],
    shadeByFacing(options.color, 1, 'top'),
    { x0: outerA[0], y0: outerA[1], x1: outerB[0], y1: outerB[1] },
    0,
    'top'
  );
}

interface Sample {
  inner: Pt;
  outer: Pt;
}

function emitWallPiece(
  builder: Builder,
  a: Sample,
  b: Sample,
  z0: number,
  z1: number,
  options: LoopOptions,
  nOut: Pt,
  useInnerFace: boolean
) {
  const color = options.color;
  pushFace(
    builder,
    [
      [a.outer[0], a.outer[1], z0],
      [b.outer[0], b.outer[1], z0],
      [b.outer[0], b.outer[1], z1],
      [a.outer[0], a.outer[1], z1],
    ],
    shadeByFacing(color, facingOfNormal(nOut[0], nOut[1], builder.quarter), 'side'),
    { x0: a.outer[0], y0: a.outer[1], x1: b.outer[0], y1: b.outer[1] },
    0,
    'outer'
  );
  if (useInnerFace) {
    const nIn: Pt = [-nOut[0], -nOut[1]];
    pushFace(
      builder,
      [
        [b.inner[0], b.inner[1], z0],
        [a.inner[0], a.inner[1], z0],
        [a.inner[0], a.inner[1], z1],
        [b.inner[0], b.inner[1], z1],
      ],
      shadeByFacing(color, facingOfNormal(nIn[0], nIn[1], builder.quarter), 'side'),
      { x0: a.inner[0], y0: a.inner[1], x1: b.inner[0], y1: b.inner[1] },
      0,
      'inner'
    );
  }
  pushFace(
    builder,
    [
      [a.inner[0], a.inner[1], z1],
      [b.inner[0], b.inner[1], z1],
      [b.outer[0], b.outer[1], z1],
      [a.outer[0], a.outer[1], z1],
    ],
    shadeByFacing(color, 1, 'top'),
    { x0: a.outer[0], y0: a.outer[1], x1: b.outer[0], y1: b.outer[1] },
    0,
    'top'
  );
  if (options.brick && z1 - z0 > options.ink * 4) {
    const z = (z0 + z1) / 2;
    pushLine(
      builder,
      [a.outer[0] + nOut[0] * 0.3, a.outer[1] + nOut[1] * 0.3, z],
      [b.outer[0] + nOut[0] * 0.3, b.outer[1] + nOut[1] * 0.3, z],
      builder.inkColor,
      Math.max(0.8, options.ink * 0.7)
    );
  }
}

function emitJamb(builder: Builder, samplePoint: Sample, height: number, color: string, from: Pt, toward: Pt) {
  const dir = normalize(toward[0] - from[0], toward[1] - from[1]);
  pushFace(
    builder,
    [
      [samplePoint.inner[0], samplePoint.inner[1], 0],
      [samplePoint.outer[0], samplePoint.outer[1], 0],
      [samplePoint.outer[0], samplePoint.outer[1], height],
      [samplePoint.inner[0], samplePoint.inner[1], height],
    ],
    shadeByFacing(color, facingOfNormal(dir[0], dir[1], builder.quarter), 'side'),
    {
      x0: samplePoint.inner[0],
      y0: samplePoint.inner[1],
      x1: samplePoint.outer[0],
      y1: samplePoint.outer[1],
    }
  );
}

function emitCap(builder: Builder, a: Pt, b: Pt, height: number, color: string) {
  const normal = normalize(b[0] - a[0], b[1] - a[1]);
  pushFace(
    builder,
    [
      [a[0], a[1], 0],
      [b[0], b[1], 0],
      [b[0], b[1], height],
      [a[0], a[1], height],
    ],
    shadeByFacing(color, facingOfNormal(normal[0], normal[1], builder.quarter), 'side'),
    { x0: a[0], y0: a[1], x1: b[0], y1: b[1] }
  );
}

function extrudePrism(builder: Builder, cx: number, cy: number, radius: number, height: number, color: string) {
  const sides = 8;
  const pts: Pt[] = [];
  for (let index = 0; index < sides; index++) {
    const angle = (index / sides) * Math.PI * 2;
    pts.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }
  for (let index = 0; index < sides; index++) {
    const a = pts[index];
    const b = pts[(index + 1) % sides];
    const normal = normalize(a[0] + b[0] - 2 * cx, a[1] + b[1] - 2 * cy);
    pushFace(
      builder,
      [
        [a[0], a[1], 0],
        [b[0], b[1], 0],
        [b[0], b[1], height],
        [a[0], a[1], height],
      ],
      shadeByFacing(color, facingOfNormal(normal[0], normal[1], builder.quarter), 'side'),
      { x0: a[0], y0: a[1], x1: b[0], y1: b[1] }
    );
  }
  pushFace(
    builder,
    pts.map((point) => [point[0], point[1], height]),
    shadeByFacing(color, 1, 'top'),
    { x0: cx - radius, y0: cy, x1: cx + radius, y1: cy },
    0
  );
}

function emitHipRoof(
  builder: Builder,
  corners: Pt[],
  wallHeight: number,
  style: 'roof_tile' | 'roof_thatch' | 'roof_slate',
  ink: string
): boolean {
  if (corners.length !== 4) return false;
  const lengths = corners.map((point, index) => Math.hypot(corners[(index + 1) % 4][0] - point[0], corners[(index + 1) % 4][1] - point[1]));
  const longFirst = lengths[0] + lengths[2] >= lengths[1] + lengths[3];
  const longA = longFirst ? 0 : 1;
  const shortLen = longFirst ? (lengths[1] + lengths[3]) / 2 : (lengths[0] + lengths[2]) / 2;
  const p0 = corners[longA];
  const p1 = corners[(longA + 1) % 4];
  const p2 = corners[(longA + 2) % 4];
  const p3 = corners[(longA + 3) % 4];
  const longDir = normalize(p1[0] - p0[0], p1[1] - p0[1]);
  const inset = shortLen / 2;
  const west = midpoint(p3, p0);
  const east = midpoint(p1, p2);
  let ridgeA: Pt = [west[0] + longDir[0] * inset, west[1] + longDir[1] * inset];
  let ridgeB: Pt = [east[0] - longDir[0] * inset, east[1] - longDir[1] * inset];
  if (Math.hypot(ridgeB[0] - ridgeA[0], ridgeB[1] - ridgeA[1]) < shortLen * 0.08) {
    const center = midpoint(ridgeA, ridgeB);
    ridgeA = center;
    ridgeB = center;
  }
  const rise = Math.min(0.6 * wallHeight, 0.45 * inset);
  const eaves = wallHeight;
  const peak = wallHeight + rise;
  const base = ROOF_COLOR[style];
  const slopes: Array<{ pts: Array<[number, number, number]>; normal: Pt }> = [
    { pts: quad3(p0, p1, ridgeB, ridgeA, eaves, peak), normal: normalAway(p0, p1, midpoint(ridgeA, ridgeB)) },
    { pts: tri3(p1, p2, ridgeB, eaves, peak), normal: normalAway(p1, p2, ridgeB) },
    { pts: quad3(p2, p3, ridgeA, ridgeB, eaves, peak), normal: normalAway(p2, p3, midpoint(ridgeA, ridgeB)) },
    { pts: tri3(p3, p0, ridgeA, eaves, peak), normal: normalAway(p3, p0, ridgeA) },
  ];
  for (const slope of slopes) {
    const unique = dedupe3(slope.pts);
    if (unique.length < 3) continue;
    pushFace(
      builder,
      unique,
      shadeByFacing(base, facingOfNormal(slope.normal[0], slope.normal[1], builder.quarter), 'side'),
      edgeOf(unique),
      0
    );
    if (unique.length === 4) {
      for (const step of [0.4, 0.7]) {
        pushLine(builder, lerp3(unique[0], unique[3], step), lerp3(unique[1], unique[2], step), ink, 0.8);
      }
    }
  }
  if (Math.hypot(ridgeA[0] - ridgeB[0], ridgeA[1] - ridgeB[1]) > 1.5) {
    pushLine(builder, [ridgeA[0], ridgeA[1], peak], [ridgeB[0], ridgeB[1], peak], ink, 1.4);
  }
  return true;
}

function emitLiftedRoof(builder: Builder, polygon: Polygon2D, z: number, style: BuildingStyle) {
  const ring = openRing(polygon[0] ?? []);
  if (ring.length < 3) return;
  let sxMin = Infinity;
  let sxMax = -Infinity;
  for (const point of ring) {
    const [sx] = projectIso(point[0], point[1], z, builder.quarter);
    sxMin = Math.min(sxMin, sx);
    sxMax = Math.max(sxMax, sx);
  }
  const edges = ring.map((point, index) => {
    const next = ring[(index + 1) % ring.length];
    return [point[0], point[1], next[0], next[1]] as [number, number, number, number];
  });
  const depthAt = depthAtEdges(edges, builder.quarter);
  const [u, v] = rotateQuarter(ring[0][0], ring[0][1], builder.quarter);
  builder.items.push({
    sxMin,
    sxMax,
    zMin: z,
    zMax: z + 1,
    depthAt,
    tie: u + v + (z + 1) / ISO_K,
    draw: { kind: 'roof', id: `iso-roof-${builder.serial++}`, polygon, style, z, opacity: builder.opacity },
  });
}

function pushFace(
  builder: Builder,
  points: Array<[number, number, number]>,
  fill: string,
  edge: { x0: number; y0: number; x1: number; y1: number },
  strokeWidth = 0,
  group = 'face'
) {
  if (points.length < 3) return;
  if (builder.batch) {
    appendBatch(builder, points, fill, 'none', 0, 1, true, group);
    return;
  }
  const depthAt = depthAtEdges([[edge.x0, edge.y0, edge.x1, edge.y1]], builder.quarter);
  const metrics = measure(points, builder.quarter, depthAt);
  builder.items.push({
    ...metrics,
    draw: {
      kind: 'face',
      id: `iso-face-${builder.serial++}`,
      points,
      fill,
      opacity: builder.opacity,
      stroke: strokeWidth > 0 ? builder.inkColor : 'none',
      strokeWidth,
      strokeOpacity: 0.85,
      closed: true,
    },
  });
}

function pushLine(
  builder: Builder,
  a: [number, number, number],
  b: [number, number, number],
  stroke: string,
  strokeWidth: number
) {
  if (builder.batch) {
    appendBatch(builder, [a, b], 'none', stroke, strokeWidth, 0.7, false, 'line');
    return;
  }
  const depthAt = depthAtEdges([[a[0], a[1], b[0], b[1]]], builder.quarter);
  const metrics = measure([a, b], builder.quarter, depthAt);
  builder.items.push({
    ...metrics,
    tie: metrics.tie + 0.01,
    draw: {
      kind: 'face',
      id: `iso-line-${builder.serial++}`,
      points: [a, b],
      fill: 'none',
      opacity: builder.opacity,
      stroke,
      strokeWidth,
      strokeOpacity: 0.7,
      closed: false,
    },
  });
}

function appendBatch(
  builder: Builder,
  points: Array<[number, number, number]>,
  fill: string,
  stroke: string,
  strokeWidth: number,
  strokeOpacity: number,
  closed: boolean,
  group: string
) {
  const order = group === 'top' ? 2 : group === 'line' ? 3 : 1;
  const key = `${order}|${group}|${fill}|${builder.opacity}|${stroke}|${strokeWidth}|${closed ? 1 : 0}`;
  let bucket = builder.batches.get(key);
  if (!bucket) {
    bucket = { fill, opacity: builder.opacity, stroke, strokeWidth, strokeOpacity, order, parts: [] };
    builder.batches.set(key, bucket);
  }
  bucket.parts.push(projectedPath(points, builder.quarter, closed));
}

function projectedPath(points: Array<[number, number, number]>, quarter: IsoQuarter, closed: boolean): string {
  let path = '';
  for (let index = 0; index < points.length; index++) {
    const [x, y] = projectIso(points[index][0], points[index][1], points[index][2], quarter);
    path += `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return closed ? `${path}Z` : path;
}

function measure(
  points: Array<[number, number, number]>,
  quarter: IsoQuarter,
  depthAt: (sx: number) => number
) {
  let sxMin = Infinity;
  let sxMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  let uSum = 0;
  let vSum = 0;
  for (const point of points) {
    const [sx] = projectIso(point[0], point[1], point[2], quarter);
    const [u, v] = rotateQuarter(point[0], point[1], quarter);
    sxMin = Math.min(sxMin, sx);
    sxMax = Math.max(sxMax, sx);
    zMin = Math.min(zMin, point[2]);
    zMax = Math.max(zMax, point[2]);
    uSum += u;
    vSum += v;
  }
  if (sxMax - sxMin < 0.4) {
    sxMin -= 0.2;
    sxMax += 0.2;
  }
  const zMid = (zMin + zMax) / 2;
  return {
    sxMin,
    sxMax,
    zMin,
    zMax,
    depthAt,
    tie: (uSum + vSum) / points.length + zMid / ISO_K,
  };
}

function depthAtEdges(edges: Array<[number, number, number, number]>, quarter: IsoQuarter) {
  const prepared = edges.map(([x0, y0, x1, y1]) => {
    const [u0, v0] = rotateQuarter(x0, y0, quarter);
    const [u1, v1] = rotateQuarter(x1, y1, quarter);
    return { u0, v0, u1, v1, s0: ISO_K * (u0 - v0), s1: ISO_K * (u1 - v1) };
  });
  return (sx: number) => {
    let best = -Infinity;
    let hit = false;
    for (const edge of prepared) {
      const lo = Math.min(edge.s0, edge.s1) - 0.5;
      const hi = Math.max(edge.s0, edge.s1) + 0.5;
      if (sx < lo || sx > hi) continue;
      const delta = edge.s1 - edge.s0;
      const t = Math.abs(delta) < 1e-4 ? 0.5 : Math.max(0, Math.min(1, (sx - edge.s0) / delta));
      best = Math.max(best, edge.u0 + (edge.u1 - edge.u0) * t + (edge.v0 + (edge.v1 - edge.v0) * t));
      hit = true;
    }
    if (!hit) {
      for (const edge of prepared) best = Math.max(best, edge.u0 + edge.v0, edge.u1 + edge.v1);
    }
    return best;
  };
}

function matchDoors(doors: DoorItem[], a: Pt, b: Pt, len: number, grid: number): EdgeCut[] {
  return matchAlong(doors, a, b, len, grid).filter((door) => PORTALS.has(door.type));
}

function matchSecrets(doors: DoorItem[], a: Pt, b: Pt, len: number, grid: number): number[] {
  return matchAlong(doors, a, b, len, grid)
    .filter((door) => door.type === 'secret')
    .map((door) => door.center);
}

function matchAlong(doors: DoorItem[], a: Pt, b: Pt, len: number, grid: number) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const ux = dx / len;
  const uy = dy / len;
  const edgeAngle = Math.atan2(dy, dx);
  const found: Array<{ t0: number; t1: number; type: DoorType; center: number }> = [];
  for (const door of doors) {
    const along = (door.x - a[0]) * ux + (door.y - a[1]) * uy;
    const px = a[0] + ux * along;
    const py = a[1] + uy * along;
    if (Math.hypot(door.x - px, door.y - py) > 0.5 * grid) continue;
    const delta = (door.rotation * Math.PI) / 180 - edgeAngle;
    if (Math.abs(Math.cos(delta)) < 0.85) continue;
    const half = (door.widthCells * grid) / 2;
    const t0 = along - half;
    const t1 = along + half;
    if (t1 <= 0 || t0 >= len) continue;
    found.push({ t0: Math.max(0, t0), t1: Math.min(len, t1), type: door.type, center: Math.max(0, Math.min(len, along)) });
  }
  return found;
}

function subtractCuts(len: number, cuts: EdgeCut[]): Array<{ t0: number; t1: number; opening: 'solid' | 'door'; type?: DoorType }> {
  const merged: EdgeCut[] = [];
  for (const cut of [...cuts].sort((a, b) => a.t0 - b.t0)) {
    if (cut.t1 - cut.t0 < 0.4) continue;
    const last = merged[merged.length - 1];
    if (last && cut.t0 <= last.t1 + 0.4) {
      last.t1 = Math.max(last.t1, cut.t1);
      if (cut.type === 'wood_gate') last.type = 'wood_gate';
    } else {
      merged.push({ ...cut });
    }
  }
  const spans: Array<{ t0: number; t1: number; opening: 'solid' | 'door'; type?: DoorType }> = [];
  let cursor = 0;
  for (const cut of merged) {
    if (cut.t0 > cursor + 0.4) spans.push({ t0: cursor, t1: cut.t0, opening: 'solid' });
    spans.push({ t0: cut.t0, t1: cut.t1, opening: 'door', type: cut.type });
    cursor = cut.t1;
  }
  if (len - cursor > 0.4) spans.push({ t0: cursor, t1: len, opening: 'solid' });
  if (!spans.length) spans.push({ t0: 0, t1: len, opening: 'solid' });
  return spans;
}

/** For a clockwise ring in y-down space this points out of the walkable area. */
function outsideNormal(a: Pt, b: Pt): Pt {
  return normalize(b[1] - a[1], a[0] - b[0]);
}

function normalAway(a: Pt, b: Pt, inside: Pt): Pt {
  const normal = outsideNormal(a, b);
  const mid = midpoint(a, b);
  if (normal[0] * (inside[0] - mid[0]) + normal[1] * (inside[1] - mid[1]) > 0) {
    return [-normal[0], -normal[1]];
  }
  return normal;
}

function sideNormal(a: Pt, b: Pt): Pt {
  return normalize(-(b[1] - a[1]), b[0] - a[0]);
}

function sample(innerA: Pt, innerB: Pt, outerA: Pt, outerB: Pt, t: number): Sample {
  return { inner: lerp(innerA, innerB, t), outer: lerp(outerA, outerB, t) };
}

function openRing(ring: Point2D[]): Pt[] {
  const points: Pt[] = [];
  for (const point of ring) {
    const last = points[points.length - 1];
    if (last && Math.hypot(last[0] - point[0], last[1] - point[1]) < 0.4) continue;
    points.push([point[0], point[1]]);
  }
  if (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.4) points.pop();
  }
  return points;
}

function signedArea(pts: Pt[]): number {
  let area = 0;
  for (let index = 0; index < pts.length; index++) {
    const next = pts[(index + 1) % pts.length];
    area += pts[index][0] * next[1] - next[0] * pts[index][1];
  }
  return area / 2;
}

function normalize(x: number, y: number): Pt {
  const length = Math.hypot(x, y);
  if (length < 1e-6) return [0, 0];
  return [x / length, y / length];
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function midpoint(a: Pt, b: Pt): Pt {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function quad3(a: Pt, b: Pt, c: Pt, d: Pt, zEave: number, zPeak: number): Array<[number, number, number]> {
  return [
    [a[0], a[1], zEave],
    [b[0], b[1], zEave],
    [c[0], c[1], zPeak],
    [d[0], d[1], zPeak],
  ];
}

function tri3(a: Pt, b: Pt, c: Pt, zEave: number, zPeak: number): Array<[number, number, number]> {
  return [
    [a[0], a[1], zEave],
    [b[0], b[1], zEave],
    [c[0], c[1], zPeak],
  ];
}

function dedupe3(points: Array<[number, number, number]>): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(last[0] - point[0], last[1] - point[1]) < 0.4 && Math.abs(last[2] - point[2]) < 0.4) continue;
    out.push(point);
  }
  return out;
}

function lerp3(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function edgeOf(points: Array<[number, number, number]>) {
  return { x0: points[0][0], y0: points[0][1], x1: points[1][0], y1: points[1][1] };
}
