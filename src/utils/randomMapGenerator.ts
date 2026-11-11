import polygonClipping from 'polygon-clipping';
import { createEmptyLayer } from '../data/presets';
import { floorTextureByPath } from '../data/textureLibrary';
import { SVG_PROP_CATALOG } from '../data/presets';
import {
  DoorItem,
  DoorType,
  DungeonDocument,
  DungeonLayer,
  LabelItem,
  MapThemeId,
  MultiPolygon2D,
  Point2D,
  Polygon2D,
  PropItem,
  StairItem,
  SvgPropId,
  TexturePaint,
  WallStyle,
} from '../types/dungeon';
import {
  GRID_SIZE,
  circleToPolygon,
  rectToPolygon,
  subtractGeometry,
  unionGeometry,
} from './geometry';
import { pointInMultiPolygon } from './texturePaint';
import { polylineRibbonMiter } from './randomMap/curves';
import { DX8, DY8, classifyHex, dirDelta, fitHex, hexFits, hexVertices, octagonVertices, skewPorts } from './randomMap/dungeonShape';
import { buildExterior } from './randomMap/exterior';
import { chance, clamp, mulberry32, pick, pickFresh, randInt, Rng, shuffle } from './randomMap/rng';
import { IdFactory, Junction, RandomMapLabels, Rect, TextureJob } from './randomMap/types';

export type { RandomMapLabels } from './randomMap/types';

const G = GRID_SIZE;

const EMPTY = 0;
const ROOM = 1;
const HALO = 2;
const CORRIDOR = 3;
const PILLAR = 4;

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

type Dir = 0 | 1 | 2 | 3;
type RoomKind = 'rect' | 'hall' | 'octagon' | 'hexagon' | 'L' | 'T' | 'cave';

export type RandomMapSize = 'small' | 'medium' | 'large' | 'mega';

export interface RandomMapConfig {
  dungeon: boolean;
  exterior: boolean;
  maxDungeonLayers: number;
  maxExteriorLayers: number;
  useTextures: boolean;
  size: RandomMapSize;
}

export const DEFAULT_RANDOM_MAP_CONFIG: RandomMapConfig = {
  dungeon: true,
  exterior: false,
  maxDungeonLayers: 2,
  maxExteriorLayers: 3,
  useTextures: true,
  size: 'medium',
};

export const RANDOM_MAP_SIZE_CELLS: Record<RandomMapSize, { w: number; h: number }> = {
  small: { w: 28, h: 22 },
  medium: { w: 44, h: 34 },
  large: { w: 68, h: 52 },
  mega: { w: 100, h: 76 },
};

export type RandomMapStage =
  | 'layout'
  | 'rooms'
  | 'layers'
  | 'corridors'
  | 'doors'
  | 'exterior'
  | 'textures'
  | 'finish';

export interface GenerateOptions {
  themeId: MapThemeId;
  labels: RandomMapLabels;
  onProgress: (stage: RandomMapStage, pct: number) => void;
  seed?: number;
}

interface Port {
  x: number;
  y: number;
  into: Dir;
  skew?: {
    out: number;
    wall: Point2D;
    angleDeg: number;
    unlock: { x: number; y: number }[];
  };
}

interface GenRoom {
  id: number;
  rect: Rect;
  kind: RoomKind;
  cells: Set<number>;
  noPort: Set<number>;
  pillarCells: number[];
  pillars: Polygon2D[];
  islands: Polygon2D[];
  polygon: MultiPolygon2D;
  ports: Port[];
  layer: number;
  alive: boolean;
}

interface EndInfo {
  room: GenRoom | null;
  into: Dir;
  x: number;
  y: number;
  cross: boolean;
  cave: boolean;
  secret: boolean;
  angleDeg?: number;
}

interface Route {
  width: 1 | 2;
  layer: number;
  kind: 'tree' | 'loop' | 'link';
  endA: EndInfo;
  endB: EndInfo | null;
  axis: Point2D[];
  poly: MultiPolygon2D;
}


interface World {
  dungeon: Rect | null;
  exterior: Rect | null;
  junction: Junction | null;
}

const FLOOR_BY_STYLE: Record<WallStyle, string[]> = {
  straight: ['posadzka.png', 'płyty.png'],
  brick: ['kamień.png', 'płyty.png'],
  double: ['marmur.png', 'kostka.png'],
  rock: ['skała.png', 'skała-ciemna.png', 'skała-omszona.png'],
  ruins: ['bruk-mech.png', 'spękana-ziemia.png'],
};

const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function pickName(rng: Rng, list: string[], used: Set<string>): string {
  return pickFresh(rng, list, used);
}

function opposite(dir: Dir): Dir {
  return ((dir + 2) % 4) as Dir;
}

function makeId(seed: number): (kind: string) => string {
  const prefix = seed.toString(36);
  const counts = new Map<string, number>();
  return (kind: string) => {
    const n = counts.get(kind) ?? 0;
    counts.set(kind, n + 1);
    return `gen-${prefix}-${kind}-${n}`;
  };
}

class Occupancy {
  readonly cols: number;
  readonly rows: number;
  readonly ox: number;
  readonly oy: number;
  readonly grid: Uint8Array;
  readonly corridorLayer: Int8Array;

  constructor(zone: Rect) {
    this.ox = zone.x;
    this.oy = zone.y;
    this.cols = zone.w;
    this.rows = zone.h;
    this.grid = new Uint8Array(zone.w * zone.h);
    this.corridorLayer = new Int8Array(zone.w * zone.h);
    this.corridorLayer.fill(-1);
  }

  in(x: number, y: number): boolean {
    return x >= this.ox && y >= this.oy && x < this.ox + this.cols && y < this.oy + this.rows;
  }

  frame(x: number, y: number): boolean {
    return x === this.ox || y === this.oy || x === this.ox + this.cols - 1 || y === this.oy + this.rows - 1;
  }

  i(x: number, y: number): number {
    return (y - this.oy) * this.cols + (x - this.ox);
  }

  xOf(index: number): number {
    return this.ox + (index % this.cols);
  }

  yOf(index: number): number {
    return this.oy + Math.floor(index / this.cols);
  }
}

class MinHeap {
  private states: number[] = [];
  private prios: number[] = [];

  get size(): number {
    return this.states.length;
  }

  push(state: number, prio: number) {
    this.states.push(state);
    this.prios.push(prio);
    let i = this.states.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prios[parent] <= this.prios[i]) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  pop(): { state: number; prio: number } | null {
    if (!this.states.length) return null;
    const out = { state: this.states[0], prio: this.prios[0] };
    const lastState = this.states.pop() as number;
    const lastPrio = this.prios.pop() as number;
    if (this.states.length) {
      this.states[0] = lastState;
      this.prios[0] = lastPrio;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let best = i;
        if (left < this.states.length && this.prios[left] < this.prios[best]) best = left;
        if (right < this.states.length && this.prios[right] < this.prios[best]) best = right;
        if (best === i) break;
        this.swap(i, best);
        i = best;
      }
    }
    return out;
  }

  private swap(a: number, b: number) {
    const state = this.states[a];
    this.states[a] = this.states[b];
    this.states[b] = state;
    const prio = this.prios[a];
    this.prios[a] = this.prios[b];
    this.prios[b] = prio;
  }
}

function closeRing(points: Point2D[]): Polygon2D {
  if (points.length < 3) return [];
  const ring = points.map((point) => [point[0], point[1]] as Point2D);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return [ring];
}

function rectPoly(rect: Rect): Polygon2D {
  return rectToPolygon(rect.x * G, rect.y * G, (rect.x + rect.w) * G, (rect.y + rect.h) * G);
}

function asMulti(poly: Polygon2D): MultiPolygon2D {
  return poly.length ? [poly] : [];
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

function clipTo(region: MultiPolygon2D, mask: MultiPolygon2D): MultiPolygon2D {
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

function distToSeg(x: number, y: number, a: Point2D, b: Point2D): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  if (len < 1e-6) return Math.hypot(x - a[0], y - a[1]);
  const t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / len, 0, 1);
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

function distToMulti(mp: MultiPolygon2D, x: number, y: number): number {
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

function simplify(points: Point2D[]): Point2D[] {
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

function splitTail(points: Point2D[], length: number): { head: Point2D[]; tail: Point2D[] } {
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

function circlesAlong(points: Point2D[], rng: Rng): MultiPolygon2D {
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

function stagePlan(config: RandomMapConfig): { stage: RandomMapStage; end: number }[] {
  const items: { stage: RandomMapStage; w: number }[] = [{ stage: 'layout', w: 5 }];
  if (config.dungeon) {
    items.push(
      { stage: 'rooms', w: 20 },
      { stage: 'layers', w: 10 },
      { stage: 'corridors', w: 25 },
      { stage: 'doors', w: 10 }
    );
  }
  if (config.exterior) items.push({ stage: 'exterior', w: 18 });
  if (config.useTextures) items.push({ stage: 'textures', w: 7 });
  items.push({ stage: 'finish', w: 5 });
  const sum = items.reduce((total, item) => total + item.w, 0);
  let acc = 0;
  return items.map((item, index) => {
    acc += item.w;
    const end = index === items.length - 1 ? 100 : Math.round((acc / sum) * 100);
    return { stage: item.stage, end };
  });
}

function makeWorld(config: RandomMapConfig, rng: Rng): World {
  const base = RANDOM_MAP_SIZE_CELLS[config.size];
  if (config.dungeon && config.exterior) {
    const totalW = Math.round(base.w * 1.6);
    const totalH = base.h;
    const buffer = 4;
    let exteriorW = Math.max(16, Math.round(totalW * 0.55));
    let dungeonW = totalW - buffer - exteriorW;
    if (dungeonW < 16) {
      dungeonW = 16;
      exteriorW = Math.max(16, totalW - buffer - dungeonW);
    }
    const yCell = clamp(randInt(rng, Math.floor(totalH * 0.32), Math.ceil(totalH * 0.68)), 4, totalH - 5);
    if (chance(rng, 0.5)) {
      return {
        exterior: { x: 0, y: 0, w: exteriorW, h: totalH },
        dungeon: { x: exteriorW + buffer, y: 0, w: totalW - exteriorW - buffer, h: totalH },
        junction: {
          xLine: exteriorW,
          yCell,
          point: [exteriorW * G, (yCell + 0.5) * G],
          dungeonSign: 1,
        },
      };
    }
    const dungeonX = 0;
    const exteriorX = dungeonW + buffer;
    return {
      dungeon: { x: dungeonX, y: 0, w: dungeonW, h: totalH },
      exterior: { x: exteriorX, y: 0, w: totalW - exteriorX, h: totalH },
      junction: {
        xLine: exteriorX,
        yCell,
        point: [exteriorX * G, (yCell + 0.5) * G],
        dungeonSign: -1,
      },
    };
  }
  const zone = { x: 0, y: 0, w: base.w, h: base.h };
  return {
    dungeon: config.dungeon ? zone : null,
    exterior: config.exterior ? zone : null,
    junction: null,
  };
}

function splitBsp(rect: Rect, leafSize: number, rng: Rng): Rect[] {
  const leaves: Rect[] = [];
  const stack: Rect[] = [rect];
  while (stack.length) {
    const current = stack.pop() as Rect;
    const canVertical = current.w >= leafSize * 2;
    const canHorizontal = current.h >= leafSize * 2;
    if (!canVertical && !canHorizontal) {
      leaves.push(current);
      continue;
    }
    let vertical = canVertical;
    if (canVertical && canHorizontal) {
      if (current.w > current.h * 1.15) vertical = true;
      else if (current.h > current.w * 1.15) vertical = false;
      else vertical = chance(rng, 0.5);
    }
    if (vertical) {
      const cut = clamp(Math.round(current.w * (0.4 + rng.next() * 0.2)), leafSize, current.w - leafSize);
      stack.push({ x: current.x, y: current.y, w: cut, h: current.h });
      stack.push({ x: current.x + cut, y: current.y, w: current.w - cut, h: current.h });
    } else {
      const cut = clamp(Math.round(current.h * (0.4 + rng.next() * 0.2)), leafSize, current.h - leafSize);
      stack.push({ x: current.x, y: current.y, w: current.w, h: cut });
      stack.push({ x: current.x, y: current.y + cut, w: current.w, h: current.h - cut });
    }
  }
  return leaves;
}

function cornerOutside(lx: number, ly: number, w: number, h: number, cut: number): boolean {
  if (lx + ly <= cut - 2 && lx < cut && ly < cut) return true;
  if (w - 1 - lx + ly <= cut - 2 && lx >= w - cut && ly < cut) return true;
  if (lx + (h - 1 - ly) <= cut - 2 && lx < cut && ly >= h - cut) return true;
  if (w - 1 - lx + (h - 1 - ly) <= cut - 2 && lx >= w - cut && ly >= h - cut) return true;
  return false;
}

function cornerPartial(lx: number, ly: number, w: number, h: number, cut: number): boolean {
  const inCorner =
    (lx < cut && ly < cut) ||
    (lx >= w - cut && ly < cut) ||
    (lx < cut && ly >= h - cut) ||
    (lx >= w - cut && ly >= h - cut);
  return inCorner && !cornerOutside(lx, ly, w, h, cut);
}

function octagonPolygon(rect: Rect, cut: number): Polygon2D {
  const x0 = rect.x * G;
  const y0 = rect.y * G;
  const x1 = (rect.x + rect.w) * G;
  const y1 = (rect.y + rect.h) * G;
  const d = cut * G;
  return closeRing([
    [x0 + d, y0],
    [x1 - d, y0],
    [x1, y0 + d],
    [x1, y1 - d],
    [x1 - d, y1],
    [x0 + d, y1],
    [x0, y1 - d],
    [x0, y0 + d],
  ]);
}

function chooseKind(rect: Rect, rng: Rng): RoomKind {
  const options: { kind: RoomKind; weight: number }[] = [{ kind: 'rect', weight: 40 }];
  if (rect.w >= 6 && rect.h >= 6) options.push({ kind: 'hall', weight: 15 }, { kind: 'L', weight: 15 });
  if (rect.w >= 5 && rect.h >= 5) options.push({ kind: 'octagon', weight: 15 });
  if (hexFits(rect)) options.push({ kind: 'hexagon', weight: 12 });
  if ((rect.w >= 7 && rect.h >= 6) || (rect.h >= 7 && rect.w >= 6)) options.push({ kind: 'T', weight: 15 });
  let roll = rng.next() * options.reduce((sum, option) => sum + option.weight, 0);
  for (const option of options) {
    roll -= option.weight;
    if (roll <= 0) return option.kind;
  }
  return 'rect';
}

function fillCells(occ: Occupancy, rect: Rect, skip: (x: number, y: number) => boolean): Set<number> {
  const cells = new Set<number>();
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (!occ.in(x, y) || skip(x, y)) continue;
      cells.add(occ.i(x, y));
    }
  }
  return cells;
}

function subtractCuts(rect: Rect, cuts: Rect[]): MultiPolygon2D {
  let shape = asMulti(rectPoly(rect));
  for (const cut of cuts) {
    const piece = asMulti(rectPoly(cut));
    if (piece.length) shape = subtractGeometry(shape, piece);
  }
  return shape.length ? shape : asMulti(rectPoly(rect));
}

function buildCave(rect: Rect, rng: Rng): { polygon: MultiPolygon2D; islands: Polygon2D[] } {
  const minX = (rect.x + 0.5) * G;
  const maxX = (rect.x + rect.w - 0.5) * G;
  const minY = (rect.y + 0.5) * G;
  const maxY = (rect.y + rect.h - 0.5) * G;
  const cx = (rect.x + rect.w / 2) * G;
  const cy = (rect.y + rect.h / 2) * G;
  const parts: MultiPolygon2D[] = [];
  const pushCircle = (x: number, y: number, radius: number) => {
    const poly = circleToPolygon(x, y, radius, 12);
    if (poly.length) parts.push([poly]);
  };
  pushCircle(cx, cy, Math.min(G, (maxX - minX) / 2, (maxY - minY) / 2));
  const steps = Math.min(48, Math.max(8, Math.round((6 + rng.next() * 8) * ((rect.w * rect.h) / 16))));
  let x = cx;
  let y = cy;
  for (let i = 0; i < steps; i++) {
    const maxR = Math.max(G * 0.45, Math.min(maxX - minX, maxY - minY) / 2);
    const radius = Math.min(maxR * 0.92, (0.9 + rng.next() * 0.7) * G);
    const angle = rng.next() * Math.PI * 2;
    x = clamp(x + Math.cos(angle) * 0.6 * G, minX + radius, maxX - radius);
    y = clamp(y + Math.sin(angle) * 0.6 * G, minY + radius, maxY - radius);
    pushCircle(x, y, radius);
  }
  const mids: Point2D[] = [
    [cx, rect.y * G],
    [(rect.x + rect.w) * G, cy],
    [cx, (rect.y + rect.h) * G],
    [rect.x * G, cy],
  ];
  for (const mid of mids) {
    const dist = Math.hypot(mid[0] - cx, mid[1] - cy);
    const count = Math.max(1, Math.ceil(dist / (0.55 * G)));
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      pushCircle(cx + (mid[0] - cx) * t, cy + (mid[1] - cy) * t, 0.48 * G);
    }
  }
  let polygon = batchUnion(parts);
  if (!polygon.length) polygon = asMulti(rectPoly(rect));
  const islands: Polygon2D[] = [];
  if (rect.w >= 7 && rect.h >= 7 && chance(rng, 0.7)) {
    const angle = rng.next() * Math.PI * 2;
    const dist = (1.3 + rng.next() * 0.6) * G;
    const ix = clamp(cx + Math.cos(angle) * dist, (rect.x + 1.5) * G, (rect.x + rect.w - 1.5) * G);
    const iy = clamp(cy + Math.sin(angle) * dist, (rect.y + 1.5) * G, (rect.y + rect.h - 1.5) * G);
    const island = circleToPolygon(ix, iy, 0.5 * G, 10);
    if (island.length) islands.push(island);
  }
  return { polygon, islands };
}

function makeRoom(occ: Occupancy, id: number, rect: Rect, rng: Rng): GenRoom | null {
  if (rect.w < 4 || rect.h < 4) return null;
  const kind = chooseKind(rect, rng);
  const room: GenRoom = {
    id,
    rect,
    kind,
    cells: new Set<number>(),
    noPort: new Set<number>(),
    pillarCells: [],
    pillars: [],
    islands: [],
    polygon: [],
    ports: [],
    layer: 0,
    alive: true,
  };
  if (kind === 'octagon') {
    const cut = rect.w >= 7 && rect.h >= 7 ? 2 : 1;
    room.cells = fillCells(occ, rect, (x, y) => cornerOutside(x - rect.x, y - rect.y, rect.w, rect.h, cut));
    for (const cell of room.cells) {
      const lx = occ.xOf(cell) - rect.x;
      const ly = occ.yOf(cell) - rect.y;
      if (cornerPartial(lx, ly, rect.w, rect.h, cut)) room.noPort.add(cell);
    }
    room.polygon = asMulti(octagonPolygon(rect, cut));
  } else if (kind === 'hexagon') {
    const fit = fitHex(rect);
    if (!fit) return null;
    room.rect = fit.rect;
    const classified = classifyHex(fit.rect, fit.flat);
    for (const cell of classified.full) room.cells.add(occ.i(cell.x, cell.y));
    for (const cell of classified.cut) {
      const index = occ.i(cell.x, cell.y);
      room.cells.add(index);
      room.noPort.add(index);
    }
    room.polygon = asMulti(closeRing(hexVertices(fit.rect, fit.flat).map((point) => [point[0] * G, point[1] * G])));
    if (fit.rect.w >= 10) {
      const midY = fit.rect.y + Math.floor(fit.rect.h / 2);
      const left = fit.rect.x + 3;
      const right = fit.rect.x + fit.rect.w - 4;
      for (const x of [left, right]) {
        const index = occ.i(x, midY);
        if (!room.cells.has(index) || room.noPort.has(index)) continue;
        room.cells.delete(index);
        room.pillarCells.push(index);
        const pillar = rectPoly({ x, y: midY, w: 1, h: 1 });
        if (pillar.length) room.pillars.push(pillar);
      }
    }
  } else if (kind === 'L' || kind === 'T') {
    const cuts: Rect[] = [];
    if (kind === 'L') {
      const cw = clamp(Math.max(2, Math.ceil(rect.w / 2 - 1)), 2, rect.w - 3);
      const ch = clamp(Math.max(2, Math.ceil(rect.h / 2 - 1)), 2, rect.h - 3);
      const corner = randInt(rng, 0, 3);
      cuts.push({
        x: corner % 2 === 0 ? rect.x : rect.x + rect.w - cw,
        y: corner < 2 ? rect.y : rect.y + rect.h - ch,
        w: cw,
        h: ch,
      });
    } else if (rect.w >= 7 && rect.h >= 6 && (rect.w >= rect.h || rect.h < 7)) {
      const notch = Math.max(2, Math.floor((rect.w - 3) / 2));
      const depth = clamp(Math.max(2, Math.floor(rect.h / 2) - 1), 2, rect.h - 3);
      const top = chance(rng, 0.5);
      const y = top ? rect.y : rect.y + rect.h - depth;
      cuts.push({ x: rect.x, y, w: notch, h: depth }, { x: rect.x + rect.w - notch, y, w: notch, h: depth });
    } else {
      const notch = Math.max(2, Math.floor((rect.h - 3) / 2));
      const depth = clamp(Math.max(2, Math.floor(rect.w / 2) - 1), 2, rect.w - 3);
      const left = chance(rng, 0.5);
      const x = left ? rect.x : rect.x + rect.w - depth;
      cuts.push({ x, y: rect.y, w: depth, h: notch }, { x, y: rect.y + rect.h - notch, w: depth, h: notch });
    }
    const blocked = new Set<number>();
    for (const cut of cuts) {
      for (let y = cut.y; y < cut.y + cut.h; y++) {
        for (let x = cut.x; x < cut.x + cut.w; x++) {
          if (occ.in(x, y)) blocked.add(occ.i(x, y));
        }
      }
    }
    room.cells = fillCells(occ, rect, (x, y) => blocked.has(occ.i(x, y)));
    room.polygon = subtractCuts(rect, cuts);
  } else {
    room.cells = fillCells(occ, rect, () => false);
    room.polygon = asMulti(rectPoly(rect));
    if (kind === 'hall') {
      for (let x = rect.x + 2; x <= rect.x + rect.w - 3; x += 3) {
        for (let y = rect.y + 2; y <= rect.y + rect.h - 3; y += 3) {
          const index = occ.i(x, y);
          room.cells.delete(index);
          room.pillarCells.push(index);
          const pillar = rectPoly({ x, y, w: 1, h: 1 });
          if (pillar.length) room.pillars.push(pillar);
        }
      }
    }
  }
  if (room.cells.size < 8 || !room.polygon.length) return null;
  return room;
}

function placeRooms(zone: Rect, rng: Rng): { rooms: GenRoom[]; occ: Occupancy; target: number } {
  const zoneCells = zone.w * zone.h;
  const target = clamp(Math.round((zoneCells / 140) * (0.85 + rng.next() * 0.3)), 4, 60);
  let leafSize = Math.max(9, Math.floor(Math.sqrt(zoneCells / target)));
  const inner: Rect = { x: zone.x + 1, y: zone.y + 1, w: Math.max(0, zone.w - 2), h: Math.max(0, zone.h - 2) };
  const occ = new Occupancy(zone);
  if (inner.w < 8 || inner.h < 8) return { rooms: [], occ, target };
  let leaves = splitBsp(inner, leafSize, rng);
  const wanted = Math.max(4, Math.round(target * 0.9));
  while (leaves.length < wanted && leafSize > 8) {
    leafSize -= 1;
    leaves = splitBsp(inner, leafSize, rng);
  }
  shuffle(rng, leaves);
  if (leaves.length > target) leaves = leaves.slice(0, target);
  const drop = Math.round(leaves.length * 0.1);
  if (drop > 0 && leaves.length - drop >= 4) leaves = leaves.slice(drop);
  const rooms: GenRoom[] = [];
  for (const leaf of leaves) {
    const availW = leaf.w - 4;
    const availH = leaf.h - 4;
    if (availW < 4 || availH < 4) continue;
    const rw = randInt(rng, 4, availW);
    const rh = randInt(rng, 4, availH);
    const rect = {
      x: leaf.x + 2 + randInt(rng, 0, availW - rw),
      y: leaf.y + 2 + randInt(rng, 0, availH - rh),
      w: rw,
      h: rh,
    };
    const room = makeRoom(occ, rooms.length, rect, rng);
    if (room) rooms.push(room);
  }
  return { rooms, occ, target };
}

function roomCenter(room: GenRoom): { x: number; y: number } {
  return { x: room.rect.x + room.rect.w / 2, y: room.rect.y + room.rect.h / 2 };
}

function roomDistance(a: GenRoom, b: GenRoom): number {
  const ca = roomCenter(a);
  const cb = roomCenter(b);
  return Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
}

function neighborEdges(rooms: GenRoom[]): { a: number; b: number; dist: number }[] {
  const seen = new Set<string>();
  const edges: { a: number; b: number; dist: number }[] = [];
  for (let i = 0; i < rooms.length; i++) {
    const order = rooms
      .map((room, index) => ({ index, dist: index === i ? Infinity : roomDistance(rooms[i], room) }))
      .sort((left, right) => left.dist - right.dist)
      .slice(0, 4);
    for (const next of order) {
      const a = Math.min(i, next.index);
      const b = Math.max(i, next.index);
      const key = `${a}:${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b, dist: next.dist });
    }
  }
  edges.sort((left, right) => left.dist - right.dist);
  return edges;
}

function stampRooms(occ: Occupancy, rooms: GenRoom[]) {
  occ.grid.fill(EMPTY);
  occ.corridorLayer.fill(-1);
  for (const room of rooms) {
    if (!room.alive) continue;
    for (const cell of room.cells) {
      occ.grid[cell] = ROOM;
    }
    for (const cell of room.pillarCells) {
      occ.grid[cell] = PILLAR;
    }
  }
  recomputeHalo(occ, rooms);
}

function recomputeHalo(occ: Occupancy, rooms: GenRoom[]) {
  for (let i = 0; i < occ.grid.length; i++) {
    if (occ.grid[i] === HALO) occ.grid[i] = EMPTY;
  }
  for (const room of rooms) {
    if (!room.alive) continue;
    for (const cell of room.cells) {
      if (occ.grid[cell] !== ROOM) continue;
      const x = occ.xOf(cell);
      const y = occ.yOf(cell);
      for (let dir = 0; dir < 4; dir++) {
        const nx = x + DX[dir];
        const ny = y + DY[dir];
        if (!occ.in(nx, ny)) continue;
        const index = occ.i(nx, ny);
        if (occ.grid[index] === EMPTY) occ.grid[index] = HALO;
      }
    }
  }
}

function wallContinues(room: GenRoom, occ: Occupancy, x: number, y: number, out: number, side: number): boolean {
  const sx = x + DX[side];
  const sy = y + DY[side];
  if (!occ.in(sx, sy)) return false;
  const index = occ.i(sx, sy);
  if (!room.cells.has(index) || room.noPort.has(index)) return false;
  const ox = sx + DX[out];
  const oy = sy + DY[out];
  if (!occ.in(ox, oy)) return false;
  const state = occ.grid[occ.i(ox, oy)];
  return state !== ROOM && state !== PILLAR;
}

function cavePorts(rect: Rect, occ: Occupancy): Port[] {
  const cx = rect.x + Math.floor((rect.w - 1) / 2);
  const cy = rect.y + Math.floor((rect.h - 1) / 2);
  const ports: Port[] = [
    { x: cx, y: rect.y - 1, into: 2 },
    { x: rect.x + rect.w, y: cy, into: 3 },
    { x: cx, y: rect.y + rect.h, into: 0 },
    { x: rect.x - 1, y: cy, into: 1 },
  ];
  return ports.filter((port) => occ.in(port.x, port.y) && !occ.frame(port.x, port.y));
}

function computePorts(room: GenRoom, occ: Occupancy): Port[] {
  if (room.kind === 'cave') return cavePorts(room.rect, occ);
  const ports: Port[] = [];
  const seen = new Set<string>();
  for (const cell of room.cells) {
    if (room.noPort.has(cell)) continue;
    const x = occ.xOf(cell);
    const y = occ.yOf(cell);
    for (let out = 0; out < 4; out++) {
      const px = x + DX[out];
      const py = y + DY[out];
      if (!occ.in(px, py) || occ.frame(px, py)) continue;
      const state = occ.grid[occ.i(px, py)];
      if (state === ROOM || state === PILLAR) continue;
      if (!wallContinues(room, occ, x, y, out, (out + 1) % 4)) continue;
      if (!wallContinues(room, occ, x, y, out, (out + 3) % 4)) continue;
      const key = `${px},${py}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ports.push({ x: px, y: py, into: opposite(out as Dir) });
    }
  }
  if (room.kind === 'hexagon' || room.kind === 'octagon') ports.push(...skewRoomPorts(room, occ));
  return ports;
}

function skewRoomPorts(room: GenRoom, occ: Occupancy): Port[] {
  const fit = room.kind === 'hexagon' ? fitHex(room.rect) : null;
  const vertices =
    room.kind === 'hexagon' && fit
      ? hexVertices(fit.rect, fit.flat)
      : octagonVertices(room.rect, room.rect.w >= 7 && room.rect.h >= 7 ? 2 : 1);
  const cuts = [...room.noPort].map((index) => ({ x: occ.xOf(index), y: occ.yOf(index) }));
  const built = skewPorts(vertices, cuts, G);
  const ports: Port[] = [];
  for (const skew of built) {
    if (!occ.in(skew.cell.x, skew.cell.y) || occ.frame(skew.cell.x, skew.cell.y)) continue;
    const state = occ.grid[occ.i(skew.cell.x, skew.cell.y)];
    if (state === ROOM || state === PILLAR) continue;
    const unlock = skew.unlock.filter((cell) => occ.in(cell.x, cell.y) && !occ.frame(cell.x, cell.y));
    if (skew.unlock.length && unlock.length < skew.unlock.length) continue;
    if (unlock.some((cell) => occ.grid[occ.i(cell.x, cell.y)] === ROOM || occ.grid[occ.i(cell.x, cell.y)] === PILLAR)) continue;
    ports.push({
      x: skew.cell.x,
      y: skew.cell.y,
      into: 0,
      skew: { out: skew.out, wall: skew.wall, angleDeg: skew.angleDeg, unlock },
    });
  }
  return ports;
}

function assignLayers(rooms: GenRoom[], entrance: GenRoom, edges: { a: number; b: number }[], maxLayers: number, rng: Rng): WallStyle[] {
  const alive = rooms.filter((room) => room.alive);
  let count = Math.min(maxLayers, Math.max(1, Math.floor(alive.length / 3)));
  if (count > 1 && chance(rng, 0.35)) count -= 1;
  count = Math.min(count, Math.max(1, alive.length));
  const neighbors = new Map<number, number[]>();
  for (const room of rooms) neighbors.set(room.id, []);
  for (const edge of edges) {
    neighbors.get(edge.a)?.push(edge.b);
    neighbors.get(edge.b)?.push(edge.a);
  }
  const seeds: GenRoom[] = [entrance];
  entrance.layer = 0;
  while (seeds.length < count) {
    let best: GenRoom | null = null;
    let bestDist = -1;
    for (const room of alive) {
      if (seeds.includes(room)) continue;
      let nearest = Infinity;
      for (const seed of seeds) nearest = Math.min(nearest, roomDistance(room, seed));
      if (nearest > bestDist) {
        bestDist = nearest;
        best = room;
      }
    }
    if (!best) break;
    best.layer = seeds.length;
    seeds.push(best);
  }
  const info = new Map<number, { dist: number; seed: GenRoom }>();
  const queue: GenRoom[] = [];
  for (const seed of seeds) {
    info.set(seed.id, { dist: 0, seed });
    queue.push(seed);
  }
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor++];
    const currentInfo = info.get(current.id);
    if (!currentInfo) continue;
    for (const nextId of neighbors.get(current.id) ?? []) {
      const next = rooms[nextId];
      if (!next?.alive) continue;
      const dist = currentInfo.dist + 1;
      const prev = info.get(next.id);
      if (!prev || dist < prev.dist || (dist === prev.dist && roomDistance(next, currentInfo.seed) < roomDistance(next, prev.seed))) {
        info.set(next.id, { dist, seed: currentInfo.seed });
        next.layer = currentInfo.seed.layer;
        queue.push(next);
      }
    }
  }
  for (const room of alive) {
    if (info.has(room.id)) continue;
    let best = seeds[0];
    let bestDist = Infinity;
    for (const seed of seeds) {
      const dist = roomDistance(room, seed);
      if (dist < bestDist) {
        bestDist = dist;
        best = seed;
      }
    }
    room.layer = best.layer;
  }
  let guard = 0;
  while (guard++ < 8) {
    const groups = new Map<number, GenRoom[]>();
    for (const room of rooms) {
      if (!room.alive) continue;
      const list = groups.get(room.layer) ?? [];
      list.push(room);
      groups.set(room.layer, list);
    }
    if (groups.size <= 1) break;
    let small: number | null = null;
    for (const [layer, list] of groups) {
      if (list.length < 2) {
        small = layer;
        break;
      }
    }
    if (small === null) break;
    const counts = new Map<number, number>();
    for (const edge of edges) {
      const left = rooms[edge.a];
      const right = rooms[edge.b];
      if (!left?.alive || !right?.alive) continue;
      if (left.layer === small && right.layer !== small) counts.set(right.layer, (counts.get(right.layer) ?? 0) + 1);
      if (right.layer === small && left.layer !== small) counts.set(left.layer, (counts.get(left.layer) ?? 0) + 1);
    }
    let target = -1;
    let bestCount = -1;
    for (const [layer, value] of counts) {
      if (value > bestCount) {
        bestCount = value;
        target = layer;
      }
    }
    if (target < 0) {
      for (const layer of groups.keys()) {
        if (layer !== small) {
          target = layer;
          break;
        }
      }
    }
    for (const room of groups.get(small) ?? []) room.layer = target;
  }
  if (entrance.layer !== 0) {
    const swapped = entrance.layer;
    for (const room of rooms) {
      if (!room.alive) continue;
      if (room.layer === 0) room.layer = swapped;
      else if (room.layer === swapped) room.layer = 0;
    }
  }
  const used = [...new Set(rooms.filter((room) => room.alive).map((room) => room.layer))].sort((a, b) => a - b);
  const remap = new Map(used.map((layer, index) => [layer, index]));
  for (const room of rooms) {
    if (room.alive) room.layer = remap.get(room.layer) ?? 0;
  }
  const layerCount = used.length;
  const pool = shuffle(rng, ['brick', 'double', 'rock', 'ruins'] as WallStyle[]);
  const styles: WallStyle[] = ['straight'];
  for (let index = 1; index < layerCount; index++) styles.push(pool[index - 1] ?? 'brick');
  return styles;
}

function becomeCaves(rooms: GenRoom[], styles: WallStyle[], occ: Occupancy, rng: Rng) {
  for (const room of rooms) {
    if (!room.alive || styles[room.layer] !== 'rock') continue;
    const built = buildCave(room.rect, rng);
    room.kind = 'cave';
    room.polygon = built.polygon;
    room.islands = built.islands;
    room.pillars = [];
    room.pillarCells = [];
    room.noPort = new Set();
    room.cells = fillCells(occ, room.rect, () => false);
  }
}

function touchesCorridor(occ: Occupancy, x: number, y: number, layer: number, same: boolean): boolean {
  for (let dir = 0; dir < 4; dir++) {
    const nx = x + DX[dir];
    const ny = y + DY[dir];
    if (!occ.in(nx, ny)) continue;
    const index = occ.i(nx, ny);
    if (occ.grid[index] !== CORRIDOR) continue;
    const matches = occ.corridorLayer[index] === layer;
    if (matches === same) return true;
  }
  return false;
}

function stepCost(occ: Occupancy, x: number, y: number, layer: number, unlocked: Set<number>): number | null {
  if (!occ.in(x, y) || occ.frame(x, y)) return null;
  const index = occ.i(x, y);
  const state = occ.grid[index];
  if (state === ROOM || state === PILLAR) return null;
  if (state === HALO && !unlocked.has(index)) return null;
  if (state === CORRIDOR) {
    if (occ.corridorLayer[index] !== layer) return null;
    return 0.4;
  }
  if (touchesCorridor(occ, x, y, layer, false)) return null;
  return touchesCorridor(occ, x, y, layer, true) ? 4 : 1;
}

function portAnchor(port: Port): { x: number; y: number } {
  if (port.skew) return { x: port.skew.wall[0] / G, y: port.skew.wall[1] / G };
  return { x: port.x, y: port.y };
}

function nearestPorts(room: GenRoom, x: number, y: number, limit: number, diagonal = true): Port[] {
  const ports = diagonal ? room.ports : room.ports.filter((port) => !port.skew);
  return [...ports]
    .sort((a, b) => {
      const aa = portAnchor(a);
      const bb = portAnchor(b);
      return Math.abs(aa.x - x) + Math.abs(aa.y - y) - (Math.abs(bb.x - x) + Math.abs(bb.y - y));
    })
    .slice(0, limit);
}

const STRIDE = 5;

function routeWidth1(
  occ: Occupancy,
  starts: Port[],
  goals: Port[],
  layer: number
): { cells: { x: number; y: number }[]; axis?: { x: number; y: number }[] } | null {
  if (!starts.length || !goals.length) return null;
  const unlocked = new Set<number>();
  for (const port of [...starts, ...goals]) {
    if (occ.in(port.x, port.y)) unlocked.add(occ.i(port.x, port.y));
  }
  const goalSet = new Set<number>();
  for (const goal of goals) {
    if (occ.in(goal.x, goal.y)) goalSet.add(occ.i(goal.x, goal.y));
  }
  if (!goalSet.size) return null;
  const count = occ.grid.length * STRIDE;
  const gScore = new Float64Array(count);
  gScore.fill(Number.POSITIVE_INFINITY);
  const parent = new Int32Array(count);
  parent.fill(-1);
  const heap = new MinHeap();
  const heur = (x: number, y: number) => {
    let best = Infinity;
    for (const goal of goals) best = Math.min(best, Math.abs(goal.x - x) + Math.abs(goal.y - y));
    return best * 0.4;
  };
  for (const start of starts) {
    if (!occ.in(start.x, start.y)) continue;
    const state = occ.i(start.x, start.y) * STRIDE + 4;
    gScore[state] = 0;
    heap.push(state, heur(start.x, start.y));
  }
  let expansions = 0;
  const cap = occ.grid.length * 8;
  while (heap.size) {
    const item = heap.pop();
    if (!item) break;
    const cell = Math.floor(item.state / STRIDE);
    const dir = item.state % STRIDE;
    const x = occ.xOf(cell);
    const y = occ.yOf(cell);
    if (item.prio > gScore[item.state] + heur(x, y) + 1e-6) continue;
    if (goalSet.has(cell)) {
      const cells: { x: number; y: number }[] = [];
      let state = item.state;
      let guard = 0;
      while (state >= 0 && guard++ < count) {
        const index = Math.floor(state / STRIDE);
        cells.push({ x: occ.xOf(index), y: occ.yOf(index) });
        state = parent[state];
      }
      cells.reverse();
      return { cells };
    }
    if (++expansions > cap) return null;
    for (let nextDir = 0; nextDir < 4; nextDir++) {
      const nx = x + DX[nextDir];
      const ny = y + DY[nextDir];
      const cost = stepCost(occ, nx, ny, layer, unlocked);
      if (cost === null) continue;
      const turn = dir !== 4 && dir !== nextDir ? 0.5 : 0;
      const nextState = occ.i(nx, ny) * STRIDE + nextDir;
      const nextG = gScore[item.state] + cost + turn;
      if (nextG + 1e-9 < gScore[nextState]) {
        gScore[nextState] = nextG;
        parent[nextState] = item.state;
        heap.push(nextState, nextG + heur(nx, ny));
      }
    }
  }
  return null;
}

function blockCells(origin: { x: number; y: number }): { x: number; y: number }[] {
  return [
    { x: origin.x, y: origin.y },
    { x: origin.x + 1, y: origin.y },
    { x: origin.x, y: origin.y + 1 },
    { x: origin.x + 1, y: origin.y + 1 },
  ];
}

function blockOrigin(a: Port, b: Port): { x: number; y: number } {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  if (a.into === 2) return { x: minX, y: minY - 1 };
  if (a.into === 1) return { x: minX - 1, y: minY };
  return { x: minX, y: minY };
}

function portPairs(room: GenRoom, occ: Occupancy): [Port, Port][] {
  const pairs: [Port, Port][] = [];
  for (let i = 0; i < room.ports.length; i++) {
    for (let j = i + 1; j < room.ports.length; j++) {
      const a = room.ports[i];
      const b = room.ports[j];
      if (a.skew || b.skew) continue;
      if (a.into !== b.into) continue;
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) continue;
      const dx = Math.sign(b.x - a.x);
      const dy = Math.sign(b.y - a.y);
      let margin = true;
      for (const [x, y] of [
        [a.x - dx, a.y - dy],
        [b.x + dx, b.y + dy],
      ]) {
        const rx = x + DX[a.into];
        const ry = y + DY[a.into];
        if (!occ.in(x, y) || !occ.in(rx, ry) || !room.cells.has(occ.i(rx, ry))) {
          margin = false;
          break;
        }
        const state = occ.grid[occ.i(x, y)];
        if (state === ROOM || state === PILLAR) {
          margin = false;
          break;
        }
      }
      if (!margin) continue;
      const origin = blockOrigin(a, b);
      const covered = blockCells(origin);
      if (!covered.some((cell) => cell.x === a.x && cell.y === a.y)) continue;
      if (!covered.some((cell) => cell.x === b.x && cell.y === b.y)) continue;
      pairs.push([a, b]);
    }
  }
  return pairs;
}

function blockCost(occ: Occupancy, origin: { x: number; y: number }, layer: number, unlocked: Set<number>): number | null {
  let cost = 0;
  for (const cell of blockCells(origin)) {
    const step = stepCost(occ, cell.x, cell.y, layer, unlocked);
    if (step === null) return null;
    cost = Math.max(cost, step);
  }
  return cost;
}

function routeWidth2(
  occ: Occupancy,
  roomA: GenRoom,
  roomB: GenRoom,
  layer: number
): { cells: { x: number; y: number }[]; blocks: { x: number; y: number }[] } | null {
  const centerB = roomCenter(roomB);
  const centerA = roomCenter(roomA);
  const starts = portPairs(roomA, occ)
    .sort((a, b) => Math.abs(a[0].x - centerB.x) + Math.abs(a[0].y - centerB.y) - (Math.abs(b[0].x - centerB.x) + Math.abs(b[0].y - centerB.y)))
    .slice(0, 3);
  const goals = portPairs(roomB, occ)
    .sort((a, b) => Math.abs(a[0].x - centerA.x) + Math.abs(a[0].y - centerA.y) - (Math.abs(b[0].x - centerA.x) + Math.abs(b[0].y - centerA.y)))
    .slice(0, 3);
  if (!starts.length || !goals.length) return null;
  const bw = occ.cols - 1;
  if (bw < 1 || occ.rows < 2) return null;
  const unlocked = new Set<number>();
  for (const pair of [...starts, ...goals]) {
    for (const port of pair) {
      if (occ.in(port.x, port.y)) unlocked.add(occ.i(port.x, port.y));
    }
  }
  const bIndex = (x: number, y: number) => (y - occ.oy) * bw + (x - occ.ox);
  const inBlock = (x: number, y: number) => x >= occ.ox && y >= occ.oy && x < occ.ox + bw && y < occ.oy + occ.rows - 1;
  const goalSet = new Set<number>();
  for (const pair of goals) {
    const origin = blockOrigin(pair[0], pair[1]);
    if (inBlock(origin.x, origin.y)) goalSet.add(bIndex(origin.x, origin.y));
  }
  if (!goalSet.size) return null;
  const stateCount = bw * (occ.rows - 1) * STRIDE;
  const gScore = new Float64Array(stateCount);
  gScore.fill(Number.POSITIVE_INFINITY);
  const parent = new Int32Array(stateCount);
  parent.fill(-1);
  const heap = new MinHeap();
  const heur = (x: number, y: number) => {
    let best = Infinity;
    for (const pair of goals) {
      const origin = blockOrigin(pair[0], pair[1]);
      best = Math.min(best, Math.abs(origin.x - x) + Math.abs(origin.y - y));
    }
    return best * 0.4;
  };
  for (const pair of starts) {
    const origin = blockOrigin(pair[0], pair[1]);
    if (!inBlock(origin.x, origin.y) || blockCost(occ, origin, layer, unlocked) === null) continue;
    const state = bIndex(origin.x, origin.y) * STRIDE + 4;
    gScore[state] = 0;
    heap.push(state, heur(origin.x, origin.y));
  }
  let expansions = 0;
  while (heap.size) {
    const item = heap.pop();
    if (!item) break;
    const block = Math.floor(item.state / STRIDE);
    const dir = item.state % STRIDE;
    const x = occ.ox + (block % bw);
    const y = occ.oy + Math.floor(block / bw);
    if (item.prio > gScore[item.state] + heur(x, y) + 1e-6) continue;
    if (goalSet.has(block) && dir !== 4) {
      const blocks: { x: number; y: number }[] = [];
      let state = item.state;
      let guard = 0;
      while (state >= 0 && guard++ < stateCount) {
        const index = Math.floor(state / STRIDE);
        blocks.push({ x: occ.ox + (index % bw), y: occ.oy + Math.floor(index / bw) });
        state = parent[state];
      }
      blocks.reverse();
      if (blocks.length < 2) return null;
      return { blocks, cells: blocks.flatMap((origin) => blockCells(origin)) };
    }
    if (goalSet.has(block) && dir === 4) continue;
    if (++expansions > occ.grid.length * 6) return null;
    for (let nextDir = 0; nextDir < 4; nextDir++) {
      const nx = x + DX[nextDir];
      const ny = y + DY[nextDir];
      if (!inBlock(nx, ny)) continue;
      const cost = blockCost(occ, { x: nx, y: ny }, layer, unlocked);
      if (cost === null) continue;
      const turn = dir !== 4 && dir !== nextDir ? 0.5 : 0;
      const nextState = bIndex(nx, ny) * STRIDE + nextDir;
      const nextG = gScore[item.state] + cost + turn;
      if (nextG + 1e-9 < gScore[nextState]) {
        gScore[nextState] = nextG;
        parent[nextState] = item.state;
        heap.push(nextState, nextG + heur(nx, ny));
      }
    }
  }
  return null;
}

function markCorridor(occ: Occupancy, cells: { x: number; y: number }[], layer: number) {
  for (const cell of cells) {
    if (!occ.in(cell.x, cell.y)) continue;
    const index = occ.i(cell.x, cell.y);
    const state = occ.grid[index];
    if (state === ROOM || state === PILLAR) continue;
    if (state !== CORRIDOR) occ.corridorLayer[index] = layer;
    occ.grid[index] = CORRIDOR;
  }
}

function wallPoint(port: Port): Point2D {
  if (port.skew) return port.skew.wall;
  if (port.into === 2) return [(port.x + 0.5) * G, (port.y + 1) * G];
  if (port.into === 0) return [(port.x + 0.5) * G, port.y * G];
  if (port.into === 1) return [(port.x + 1) * G, (port.y + 0.5) * G];
  return [port.x * G, (port.y + 0.5) * G];
}

function averagePoint(points: Point2D[]): Point2D {
  const x = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const y = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  return [x, y];
}

function portsOnCells(room: GenRoom, cells: { x: number; y: number }[]): Port[] {
  return room.ports.filter((port) => cells.some((cell) => cell.x === port.x && cell.y === port.y));
}

function makeEnd(room: GenRoom, ports: Port[], corridorLayer: number): EndInfo | null {
  if (!ports.length) return null;
  const point = averagePoint(ports.map(wallPoint));
  const cross = room.layer !== corridorLayer;
  return {
    room,
    into: ports[0].into,
    x: point[0],
    y: point[1],
    angleDeg: ports.find((port) => port.skew)?.skew?.angleDeg,
    cross,
    cave: room.kind === 'cave' && !cross,
    secret: false,
  };
}

function corridorOwner(a: GenRoom, b: GenRoom, styles: WallStyle[]): number {
  if (a.layer === b.layer) return a.layer;
  if (a.kind === 'cave' || styles[a.layer] === 'rock') return a.layer;
  if (b.kind === 'cave' || styles[b.layer] === 'rock') return b.layer;
  return Math.min(a.layer, b.layer);
}

function routeWidth8(
  occ: Occupancy,
  starts: Port[],
  goals: Port[],
  layer: number
): { cells: { x: number; y: number }[]; axis: { x: number; y: number }[] } | null {
  if (!starts.length || !goals.length) return null;
  const unlocked = new Set<number>();
  for (const port of [...starts, ...goals]) {
    if (occ.in(port.x, port.y)) unlocked.add(occ.i(port.x, port.y));
    for (const cell of port.skew?.unlock ?? []) {
      if (occ.in(cell.x, cell.y)) unlocked.add(occ.i(cell.x, cell.y));
    }
  }
  const stride = 9;
  const count = occ.grid.length * stride;
  const gScore = new Float64Array(count);
  gScore.fill(Number.POSITIVE_INFINITY);
  const parent = new Int32Array(count);
  parent.fill(-1);
  const heap = new MinHeap();
  const heur = (x: number, y: number) => {
    let best = Infinity;
    for (const goal of goals) {
      const dx = Math.abs(goal.x - x);
      const dy = Math.abs(goal.y - y);
      best = Math.min(best, Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy));
    }
    return best * 0.4;
  };
  const startStates = new Set<number>();
  for (const start of starts) {
    if (!occ.in(start.x, start.y)) continue;
    const dir = start.skew ? start.skew.out : 8;
    const state = occ.i(start.x, start.y) * stride + dir;
    gScore[state] = 0;
    startStates.add(state);
    heap.push(state, heur(start.x, start.y));
  }
  const goalAt = new Map<number, Port[]>();
  for (const goal of goals) {
    if (!occ.in(goal.x, goal.y)) continue;
    const index = occ.i(goal.x, goal.y);
    const list = goalAt.get(index) ?? [];
    list.push(goal);
    goalAt.set(index, list);
  }
  if (!goalAt.size) return null;
  let expansions = 0;
  while (heap.size) {
    const item = heap.pop();
    if (!item) break;
    const cell = Math.floor(item.state / stride);
    const dir = item.state % stride;
    const x = occ.xOf(cell);
    const y = occ.yOf(cell);
    if (item.prio > gScore[item.state] + heur(x, y) + 1e-6) continue;
    const arrived = goalAt.get(cell);
    const aimed =
      arrived &&
      dir !== 8 &&
      arrived.some((goal) => !goal.skew || dirDelta(dir, (goal.skew.out + 4) % 8) <= 1);
    if (aimed) {
      const axis: { x: number; y: number }[] = [];
      const cells: { x: number; y: number }[] = [];
      let state = item.state;
      let guard = 0;
      while (state >= 0 && guard++ < count) {
        const index = Math.floor(state / stride);
        const stepDir = state % stride;
        const cx = occ.xOf(index);
        const cy = occ.yOf(index);
        axis.push({ x: cx, y: cy });
        cells.push({ x: cx, y: cy });
        const prev = parent[state];
        if (prev >= 0 && stepDir < 8 && stepDir % 2 === 1) {
          const px = occ.xOf(Math.floor(prev / stride));
          const py = occ.yOf(Math.floor(prev / stride));
          cells.push({ x: px, y: cy }, { x: cx, y: py });
        }
        state = prev;
      }
      axis.reverse();
      cells.reverse();
      return { cells, axis };
    }
    if (++expansions > occ.grid.length * 12) return null;
    for (let nextDir = 0; nextDir < 8; nextDir++) {
      if (startStates.has(item.state) && dir !== 8 && dirDelta(dir, nextDir) > 1) continue;
      const nx = x + DX8[nextDir];
      const ny = y + DY8[nextDir];
      const diagonal = nextDir % 2 === 1;
      let step: number | null;
      if (!diagonal) step = stepCost(occ, nx, ny, layer, unlocked);
      else {
        const center = stepCost(occ, nx, ny, layer, unlocked);
        const sideA = stepCost(occ, x + DX8[nextDir], y, layer, unlocked);
        const sideB = stepCost(occ, x, y + DY8[nextDir], layer, unlocked);
        step = center === null || sideA === null || sideB === null ? null : Math.max(center, sideA, sideB) * Math.SQRT2;
      }
      if (step === null) continue;
      let turn = 0;
      if (dir !== 8) {
        const delta = dirDelta(dir, nextDir);
        if (delta >= 3) continue;
        if (delta === 1) turn = 0.35;
        else if (delta === 2) turn = 0.6;
      }
      const nextState = occ.i(nx, ny) * stride + nextDir;
      const nextG = gScore[item.state] + step + turn;
      if (nextG + 1e-9 < gScore[nextState]) {
        gScore[nextState] = nextG;
        parent[nextState] = item.state;
        heap.push(nextState, nextG + heur(nx, ny));
      }
    }
  }
  return null;
}

function connectRooms(
  occ: Occupancy,
  a: GenRoom,
  b: GenRoom,
  styles: WallStyle[],
  kind: 'tree' | 'loop',
  rng: Rng
): Route | null {
  if (!a.ports.length || !b.ports.length) return null;
  const layer = corridorOwner(a, b, styles);
  const skew = a.ports.some((port) => port.skew) || b.ports.some((port) => port.skew);
  const diagonal = skew || (styles[layer] !== 'double' && chance(rng, styles[layer] === 'rock' ? 0.6 : 0.35));
  const wide = !diagonal && kind === 'tree' && styles[layer] !== 'rock' && chance(rng, 0.25);
  if (wide) {
    const path = routeWidth2(occ, a, b, layer);
    if (path) {
      const startPorts = portsOnCells(a, blockCells(path.blocks[0])).filter((port, index, list) => list.findIndex((item) => item.x === port.x && item.y === port.y) === index);
      const endPorts = portsOnCells(b, blockCells(path.blocks[path.blocks.length - 1]));
      const endA = makeEnd(a, startPorts.slice(0, 2), layer);
      const endB = makeEnd(b, endPorts.slice(0, 2), layer);
      if (endA && endB && startPorts.length >= 2 && endPorts.length >= 2) {
        markCorridor(occ, path.cells, layer);
        return {
          width: 2,
          layer,
          kind,
          endA,
          endB,
          axis: path.blocks.map((block) => [(block.x + 1) * G, (block.y + 1) * G]),
          poly: [],
        };
      }
    }
  }
  const centerA = roomCenter(a);
  const centerB = roomCenter(b);
  const starts = nearestPorts(a, centerB.x, centerB.y, 4, diagonal);
  const goals = nearestPorts(b, centerA.x, centerA.y, 4, diagonal);
  const path = diagonal ? routeWidth8(occ, starts, goals, layer) : routeWidth1(occ, starts, goals, layer);
  if (!path || !path.cells.length) return null;
  const spine = path.axis ?? path.cells;
  const first = spine[0];
  const last = spine[spine.length - 1];
  const start = a.ports.find((port) => port.x === first.x && port.y === first.y);
  const goal = b.ports.find((port) => port.x === last.x && port.y === last.y);
  if (!start || !goal) return null;
  const endA = makeEnd(a, [start], layer);
  const endB = makeEnd(b, [goal], layer);
  if (!endA || !endB) return null;
  markCorridor(occ, path.cells, layer);
  return {
    width: 1,
    layer,
    kind,
    endA,
    endB,
    axis: spine.map((cell) => [(cell.x + 0.5) * G, (cell.y + 0.5) * G]),
    poly: [],
  };
}

function extensions(end: EndInfo | null, atStart: boolean): Point2D[] {
  if (!end?.room || end.cross) return [];
  const wall: Point2D = [end.x, end.y];
  if (end.cave) {
    const center: Point2D = [(end.room.rect.x + end.room.rect.w / 2) * G, (end.room.rect.y + end.room.rect.h / 2) * G];
    return atStart ? [center, wall] : [wall, center];
  }
  return [wall];
}

function buildRoutePoly(route: Route, styles: WallStyle[], rng: Rng) {
  const points = simplify([...extensions(route.endA, true), ...route.axis, ...extensions(route.endB, false)]);
  if (!points.length) {
    route.poly = [];
    return;
  }
  const width = route.width * G;
  if (styles[route.layer] !== 'rock') {
    route.poly = polylineRibbonMiter(points, width);
    return;
  }
  const crossStart = route.endA.cross;
  const crossEnd = Boolean(route.endB?.cross);
  if (!crossStart && !crossEnd) {
    route.poly = circlesAlong(points, rng);
    return;
  }
  if (crossEnd) {
    const parts = splitTail(points, width);
    route.poly = batchUnion([
      parts.head.length > 1 ? circlesAlong(parts.head, rng) : [],
      polylineRibbonMiter(parts.tail, width),
    ]);
    return;
  }
  const reversed = splitTail([...points].reverse(), width);
  route.poly = batchUnion([
    polylineRibbonMiter([...reversed.tail].reverse(), width),
    reversed.head.length > 1 ? circlesAlong([...reversed.head].reverse(), rng) : [],
  ]);
}

function killRoom(room: GenRoom, occ: Occupancy) {
  room.alive = false;
  for (const cell of room.cells) {
    if (occ.grid[cell] === ROOM) occ.grid[cell] = EMPTY;
  }
  for (const cell of room.pillarCells) {
    if (occ.grid[cell] === PILLAR) occ.grid[cell] = EMPTY;
  }
}

function componentsOf(rooms: GenRoom[], links: { a: number; b: number }[]): number[][] {
  const adj = new Map<number, number[]>();
  for (const room of rooms) {
    if (room.alive) adj.set(room.id, []);
  }
  for (const link of links) {
    if (!rooms[link.a]?.alive || !rooms[link.b]?.alive) continue;
    adj.get(link.a)?.push(link.b);
    adj.get(link.b)?.push(link.a);
  }
  const seen = new Set<number>();
  const groups: number[][] = [];
  for (const room of rooms) {
    if (!room.alive || seen.has(room.id)) continue;
    const group: number[] = [];
    const stack = [room.id];
    seen.add(room.id);
    while (stack.length) {
      const id = stack.pop() as number;
      group.push(id);
      for (const next of adj.get(id) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    groups.push(group);
  }
  return groups;
}

function hopDistance(rooms: GenRoom[], links: { a: number; b: number }[], from: number, to: number): number {
  if (from === to) return 0;
  const adj = new Map<number, number[]>();
  for (const link of links) {
    if (!rooms[link.a]?.alive || !rooms[link.b]?.alive) continue;
    const left = adj.get(link.a) ?? [];
    left.push(link.b);
    adj.set(link.a, left);
    const right = adj.get(link.b) ?? [];
    right.push(link.a);
    adj.set(link.b, right);
  }
  const dist = new Map<number, number>([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const id = queue.shift() as number;
    if (id === to) return dist.get(id) ?? Infinity;
    for (const next of adj.get(id) ?? []) {
      if (dist.has(next)) continue;
      dist.set(next, (dist.get(id) ?? 0) + 1);
      queue.push(next);
    }
  }
  return Infinity;
}

function reachableIds(occ: Occupancy, rooms: GenRoom[], entrance: GenRoom): Set<number> {
  const seen = new Uint8Array(occ.grid.length);
  const stack: number[] = [];
  for (const cell of entrance.cells) {
    if (occ.grid[cell] === ROOM) {
      seen[cell] = 1;
      stack.push(cell);
    }
  }
  while (stack.length) {
    const index = stack.pop() as number;
    const x = occ.xOf(index);
    const y = occ.yOf(index);
    for (let dir = 0; dir < 4; dir++) {
      const nx = x + DX[dir];
      const ny = y + DY[dir];
      if (!occ.in(nx, ny)) continue;
      const next = occ.i(nx, ny);
      if (seen[next]) continue;
      const state = occ.grid[next];
      if (state !== ROOM && state !== CORRIDOR) continue;
      seen[next] = 1;
      stack.push(next);
    }
  }
  const ids = new Set<number>();
  for (const room of rooms) {
    if (!room.alive) continue;
    for (const cell of room.cells) {
      if (occ.grid[cell] === ROOM && seen[cell]) {
        ids.add(room.id);
        break;
      }
    }
  }
  return ids;
}

function appendJunction(axis: Point2D[], junction: Junction, width: 1 | 2): Point2D[] {
  if (!axis.length) return axis;
  const points = axis.slice();
  const last = points[points.length - 1];
  const half = (width * G) / 2;
  const sign = junction.dungeonSign;
  const railX = junction.point[0] + sign * Math.max(G, half + 8);
  const stopX = junction.point[0] + sign * half;
  const push = (point: Point2D) => {
    const prev = points[points.length - 1];
    if (Math.hypot(prev[0] - point[0], prev[1] - point[1]) > 1) points.push(point);
  };
  push([railX, last[1]]);
  push([railX, junction.point[1]]);
  push([stopX, junction.point[1]]);
  return points;
}

function fortified(style: WallStyle | undefined): boolean {
  return style === 'brick' || style === 'double';
}

function doorTypeFor(route: Route, end: EndInfo, styles: WallStyle[], rng: Rng): DoorType | null {
  if (!end.room) return null;
  if (end.cross) {
    if (route.width === 2) return 'double';
    if (fortified(styles[route.layer]) || fortified(styles[end.room.layer])) return 'portcullis';
    return 'standard';
  }
  if (end.cave) return null;
  if (end.secret) return 'secret';
  const roll = rng.next();
  if (roll < 0.55) return route.width === 2 ? 'double' : 'standard';
  if (roll < 0.75) return 'archway';
  return null;
}

function placeStairs(room: GenRoom, exit: Dir, occ: Occupancy, id: (kind: string) => string, align: { x: number; y: number } | null): StairItem | null {
  const inward = opposite(exit);
  const candidates: { x: number; y: number }[] = [];
  for (const cell of room.cells) {
    if (room.noPort.has(cell)) continue;
    const x = occ.xOf(cell);
    const y = occ.yOf(cell);
    const ox = x + DX[exit];
    const oy = y + DY[exit];
    const outside = !occ.in(ox, oy) || !room.cells.has(occ.i(ox, oy));
    if (outside) candidates.push({ x, y });
  }
  if (!candidates.length) return null;
  const anchor = align ?? { x: room.rect.x + room.rect.w / 2, y: room.rect.y + room.rect.h / 2 };
  candidates.sort((a, b) => Math.abs(a.x - anchor.x) + Math.abs(a.y - anchor.y) - (Math.abs(b.x - anchor.x) + Math.abs(b.y - anchor.y)));
  const along = exit === 0 || exit === 2 ? room.rect.h : room.rect.w;
  const wide = along >= 6;
  for (const wantWide of wide ? [true, false] : [false]) {
    for (const wall of candidates) {
      const dest = { x: wall.x + DX[inward], y: wall.y + DY[inward] };
      if (!occ.in(dest.x, dest.y) || !room.cells.has(occ.i(dest.x, dest.y)) || room.noPort.has(occ.i(dest.x, dest.y))) continue;
      if (wantWide) {
        const side = exit === 0 || exit === 2 ? 1 : 0;
        const left = occ.in(dest.x + DX[side], dest.y + DY[side]) && room.cells.has(occ.i(dest.x + DX[side], dest.y + DY[side]));
        const right = occ.in(dest.x - DX[side], dest.y - DY[side]) && room.cells.has(occ.i(dest.x - DX[side], dest.y - DY[side]));
        if (!left || !right) continue;
      }
      return {
        id: id('st'),
        x: (dest.x + 0.5) * G,
        y: (dest.y + 0.5) * G,
        rotation: [0, 90, 180, 270][exit],
        type: wantWide ? 'wide' : 'straight',
        widthCells: wantWide ? 2 : 1,
        lengthCells: 2,
      };
    }
  }
  return null;
}

interface DungeonDraft {
  layers: DungeonLayer[];
  doors: DoorItem[];
  stairs: StairItem[];
  jobs: TextureJob[];
  props: PropItem[];
  labels: LabelItem[];
  alive: number;
  target: number;
}

async function buildDungeon(
  zone: Rect,
  junction: Junction | null,
  maxLayers: number,
  rng: Rng,
  id: (kind: string) => string,
  labels: RandomMapLabels,
  hooks: { label: (stage: RandomMapStage) => Promise<void>; finish: (stage: RandomMapStage) => Promise<void> }
): Promise<DungeonDraft> {
  await hooks.label('rooms');
  const placed = placeRooms(zone, rng);
  const { rooms, occ, target } = placed;
  await hooks.finish('rooms');
  await hooks.label('layers');
  if (!rooms.length) {
    await hooks.finish('layers');
    await hooks.label('corridors');
    await hooks.finish('corridors');
    await hooks.label('doors');
    await hooks.finish('doors');
    return { layers: [], doors: [], stairs: [], jobs: [], props: [], labels: [], alive: 0, target };
  }
  let entrance = rooms[0];
  let exitEdge: Dir = 2;
  if (junction) {
    let best = Infinity;
    for (const room of rooms) {
      const center = roomCenter(room);
      const dist = Math.abs(center.x - junction.xLine) + Math.abs(center.y - (junction.yCell + 0.5));
      if (dist < best) {
        best = dist;
        entrance = room;
      }
    }
    exitEdge = junction.dungeonSign === 1 ? 3 : 1;
  } else {
    exitEdge = randInt(rng, 0, 3) as Dir;
    let best = Infinity;
    for (const room of rooms) {
      const dist =
        exitEdge === 0
          ? room.rect.y - zone.y
          : exitEdge === 1
            ? zone.x + zone.w - (room.rect.x + room.rect.w)
            : exitEdge === 2
              ? zone.y + zone.h - (room.rect.y + room.rect.h)
              : room.rect.x - zone.x;
      if (dist < best) {
        best = dist;
        entrance = room;
      }
    }
  }
  const edges = neighborEdges(rooms);
  const styles = assignLayers(rooms, entrance, edges, clamp(Math.round(maxLayers), 1, 4), rng);
  becomeCaves(rooms, styles, occ, rng);
  stampRooms(occ, rooms);
  for (const room of rooms) room.ports = room.alive ? computePorts(room, occ) : [];
  await hooks.finish('layers');
  await hooks.label('corridors');
  const routes: Route[] = [];
  const links: { a: number; b: number }[] = [];
  let routed = 0;
  for (const edge of edges) {
    const left = rooms[edge.a];
    const right = rooms[edge.b];
    if (!left.alive || !right.alive) continue;
    if (componentsOf(rooms, links).some((group) => group.includes(left.id) && group.includes(right.id))) continue;
    const route = connectRooms(occ, left, right, styles, 'tree', rng);
    if (route) {
      routes.push(route);
      links.push({ a: left.id, b: right.id });
    }
    if (++routed % 4 === 0) await delay();
  }
  let guard = 0;
  while (guard++ < rooms.length) {
    const groups = componentsOf(rooms, links);
    if (groups.length <= 1) break;
    const home = groups.find((group) => group.includes(entrance.id)) ?? groups[0];
    const other = groups.find((group) => group !== home) ?? groups[1];
    const pairs: { a: number; b: number; dist: number }[] = [];
    for (const a of home) {
      for (const b of other) pairs.push({ a, b, dist: roomDistance(rooms[a], rooms[b]) });
    }
    pairs.sort((left, right) => left.dist - right.dist);
    let joined = false;
    for (const pair of pairs.slice(0, 10)) {
      const route = connectRooms(occ, rooms[pair.a], rooms[pair.b], styles, 'tree', rng);
      if (!route) continue;
      routes.push(route);
      links.push({ a: pair.a, b: pair.b });
      joined = true;
      break;
    }
    if (!joined) {
      for (const roomId of other) {
        if (roomId !== entrance.id) killRoom(rooms[roomId], occ);
      }
      recomputeHalo(occ, rooms);
      for (const room of rooms) if (room.alive) room.ports = computePorts(room, occ);
    }
  }
  const loopTarget = Math.round(0.15 * rooms.filter((room) => room.alive).length);
  const loopEdges = shuffle(
    rng,
    edges.filter((edge) => rooms[edge.a].alive && rooms[edge.b].alive && hopDistance(rooms, links, edge.a, edge.b) >= 3)
  );
  let loops = 0;
  for (const edge of loopEdges) {
    if (loops >= loopTarget) break;
    if (hopDistance(rooms, links, edge.a, edge.b) < 3) continue;
    const route = connectRooms(occ, rooms[edge.a], rooms[edge.b], styles, 'loop', rng);
    if (!route) continue;
    routes.push(route);
    links.push({ a: edge.a, b: edge.b });
    loops += 1;
  }
  if (junction && entrance.alive) {
    const edgeX = junction.dungeonSign === 1 ? zone.x + 1 : zone.x + zone.w - 2;
    const goals: Port[] = [];
    for (let radius = 0; radius < zone.h && goals.length < 3; radius++) {
      for (const y of radius === 0 ? [junction.yCell] : [junction.yCell - radius, junction.yCell + radius]) {
        if (!occ.in(edgeX, y) || occ.frame(edgeX, y)) continue;
        const state = occ.grid[occ.i(edgeX, y)];
        if (state === ROOM || state === PILLAR) continue;
        if (state === CORRIDOR && occ.corridorLayer[occ.i(edgeX, y)] !== 0) continue;
        goals.push({ x: edgeX, y, into: junction.dungeonSign === 1 ? 1 : 3 });
      }
      if (goals.length && radius >= 1) break;
    }
    const facing = nearestPorts(entrance, edgeX, junction.yCell, 4);
    const path = routeWidth1(occ, facing.length ? facing : entrance.ports, goals, 0);
    if (path?.cells.length) {
      const first = path.cells[0];
      const start = entrance.ports.find((port) => port.x === first.x && port.y === first.y) ?? facing[0];
      const endA = start ? makeEnd(entrance, [start], 0) : null;
      if (endA) {
        markCorridor(occ, path.cells, 0);
        routes.push({
          width: 1,
          layer: 0,
          kind: 'link',
          endA,
          endB: null,
          axis: appendJunction(
            path.cells.map((cell) => [(cell.x + 0.5) * G, (cell.y + 0.5) * G]),
            junction,
            1
          ),
          poly: [],
        });
      }
    }
  }
  await hooks.finish('corridors');
  await hooks.label('doors');
  const reached = entrance.alive ? reachableIds(occ, rooms, entrance) : new Set<number>();
  for (const room of rooms) {
    if (room.alive && !reached.has(room.id)) room.alive = false;
  }
  const liveRoutes = routes.filter((route) => route.endA.room?.alive && (route.endB === null || route.endB.room?.alive));
  const degree = new Map<number, number>();
  for (const link of links) {
    if (!rooms[link.a]?.alive || !rooms[link.b]?.alive) continue;
    degree.set(link.a, (degree.get(link.a) ?? 0) + 1);
    degree.set(link.b, (degree.get(link.b) ?? 0) + 1);
  }
  for (const route of liveRoutes) {
    for (const end of [route.endA, route.endB]) {
      if (!end?.room || end.room.id === entrance.id || end.cross || end.cave) continue;
      if ((degree.get(end.room.id) ?? 0) === 1 && chance(rng, 0.4)) end.secret = true;
    }
  }
  for (const route of liveRoutes) {
    if (route.kind === 'loop' && chance(rng, 0.3)) {
      const ends = [route.endA, route.endB].filter((end): end is EndInfo => Boolean(end?.room && !end.cross && !end.cave));
      if (ends.length) pick(rng, ends).secret = true;
    }
    buildRoutePoly(route, styles, rng);
  }
  const usedNames = new Set<string>();
  const layers: DungeonLayer[] = [];
  const layerIds: string[] = [];
  for (let layerIndex = 0; layerIndex < styles.length; layerIndex++) {
    const style = styles[layerIndex];
    const roomPolys = rooms.filter((room) => room.alive && room.layer === layerIndex).map((room) => room.polygon);
    const corridorPolys = liveRoutes.filter((route) => route.layer === layerIndex).map((route) => route.poly);
    if (!roomPolys.length && !corridorPolys.some((poly) => poly.length)) continue;
    let geometry = batchUnion([...roomPolys, ...corridorPolys]);
    const cuts: MultiPolygon2D = [];
    for (const room of rooms) {
      if (!room.alive || room.layer !== layerIndex) continue;
      for (const pillar of room.pillars) cuts.push(pillar);
      for (const island of room.islands) cuts.push(island);
    }
    if (cuts.length && geometry.length) geometry = subtractGeometry(geometry, cuts);
    const layerId = `gen-dng-${layers.length}`;
    layerIds[layerIndex] = layerId;
    const layer = createEmptyLayer(layerId, pickName(rng, labels.dungeonLayers[style] ?? [style], usedNames), 'interior');
    layer.wallStyle = style;
    layer.geometry = geometry;
    layer.hatchEnabled = true;
    layers.push(layer);
  }
  const doors: DoorItem[] = [];
  const seenDoors = new Set<string>();
  const addDoor = (door: Omit<DoorItem, 'id'>) => {
    const key = `${Math.round(door.x)}:${Math.round(door.y)}`;
    if (seenDoors.has(key)) return;
    seenDoors.add(key);
    doors.push({ ...door, id: id('dr') });
  };
  for (const route of liveRoutes) {
    for (const end of [route.endA, route.endB]) {
      if (!end) continue;
      const type = doorTypeFor(route, end, styles, rng);
      if (!type) continue;
      addDoor({
        x: end.x,
        y: end.y,
        rotation: end.angleDeg ?? (end.into === 0 || end.into === 2 ? 0 : 90),
        type,
        widthCells: route.width,
      });
    }
  }
  const link = liveRoutes.find((route) => route.kind === 'link');
  if (junction && link) {
    addDoor({
      x: junction.point[0],
      y: junction.point[1],
      rotation: 90,
      type: 'archway',
      widthCells: link.width,
    });
  }
  const stairs: StairItem[] = [];
  if (entrance.alive) {
    const exit = link ? opposite(link.endA.into) : exitEdge;
    const align = link ? { x: Math.round(link.endA.x / G), y: Math.round(link.endA.y / G) } : null;
    const stair = placeStairs(entrance, exit, occ, id, align);
    if (stair) stairs.push(stair);
  }
  const jobs: TextureJob[] = [];
  for (const layer of layers) {
    const style = layer.wallStyle;
    const options = (FLOOR_BY_STYLE[style] ?? []).filter((path) => floorTextureByPath(path));
    if (options.length && layer.geometry.length) {
      jobs.push({ layerId: layer.id, path: pick(rng, options), softness: 0, region: layer.geometry, order: 0 });
    }
  }
  const rockLayer = layers.find((layer) => layer.wallStyle === 'rock');
  if (rockLayer) {
    const caves = rooms.filter((room) => room.alive && room.kind === 'cave' && layerIds[room.layer] === rockLayer.id);
    const puddlePath = ['woda-płytka.png', 'błoto.png'].find((path) => floorTextureByPath(path));
    if (puddlePath && caves.length) {
      const count = randInt(rng, 1, Math.min(2, caves.length));
      for (const cave of shuffle(rng, caves).slice(0, count)) {
        const radius = (0.8 + rng.next() * 0.4) * G;
        const circle = circleToPolygon((cave.rect.x + cave.rect.w / 2) * G, (cave.rect.y + cave.rect.h / 2) * G, radius, 12);
        const region = clipTo(asMulti(circle), rockLayer.geometry);
        if (region.length) jobs.push({ layerId: rockLayer.id, path: puddlePath, softness: 0.3, region, order: 10 });
      }
    }
  }
  const dressed = dressDungeon(rooms, occ, styles, links, entrance, liveRoutes, rng, id, labels);
  await hooks.finish('doors');
  return {
    layers,
    doors,
    stairs,
    jobs,
    props: dressed.props,
    labels: dressed.labels,
    alive: rooms.filter((room) => room.alive).length,
    target,
  };
}

function propSize(kind: SvgPropId): { widthPx: number; heightPx: number } {
  const found = SVG_PROP_CATALOG.find((item) => item.id === kind);
  return { widthPx: found?.widthPx ?? 64, heightPx: found?.heightPx ?? 64 };
}

function openFloor(room: GenRoom, occ: Occupancy): { x: number; y: number }[] {
  const spots: { x: number; y: number }[] = [];
  for (const cell of room.cells) {
    if (room.noPort.has(cell) || room.pillarCells.includes(cell)) continue;
    const x = occ.xOf(cell);
    const y = occ.yOf(cell);
    let besidePort = false;
    for (let dir = 0; dir < 4; dir++) {
      const nx = x + DX[dir];
      const ny = y + DY[dir];
      if (room.ports.some((port) => port.x === nx && port.y === ny)) besidePort = true;
    }
    if (!besidePort) spots.push({ x, y });
  }
  return spots;
}

function dressDungeon(
  rooms: GenRoom[],
  occ: Occupancy,
  styles: WallStyle[],
  links: { a: number; b: number }[],
  entrance: GenRoom,
  routes: Route[],
  rng: Rng,
  id: IdFactory,
  labels: RandomMapLabels
): { props: PropItem[]; labels: LabelItem[] } {
  const props: PropItem[] = [];
  const roomLabels: LabelItem[] = [];
  const used = new Set<number>([entrance.id]);
  const place = (room: GenRoom, kinds: SvgPropId[]) => {
    const spots = shuffle(rng, openFloor(room, occ));
    kinds.slice(0, Math.min(3, spots.length)).forEach((kind, index) => {
      const spot = spots[index];
      const size = propSize(kind);
      props.push({
        id: id('pr'),
        x: (spot.x + 0.5) * G,
        y: (spot.y + 0.5) * G,
        rotation: randInt(rng, 0, 3) * 90,
        scale: 1,
        kind: 'svg',
        svgPropId: kind,
        label: labels.props[kind],
        widthPx: size.widthPx,
        heightPx: size.heightPx,
      });
    });
    used.add(room.id);
  };
  const alive = rooms.filter((room) => room.alive);
  const straight = alive
    .filter((room) => room.id !== entrance.id && styles[room.layer] === 'straight')
    .sort((a, b) => b.cells.size - a.cells.size);
  if (straight[0]) place(straight[0], chance(rng, 0.5) ? ['throne'] : ['table', 'bookshelf']);
  for (const room of alive) {
    if (used.has(room.id)) continue;
    const style = styles[room.layer];
    if (style === 'brick') place(room, chance(rng, 0.5) ? ['sarcophagus', 'altar'] : ['altar']);
    else if (style === 'double') place(room, ['weapon_rack', 'table', 'bed']);
    else if (style === 'rock' || room.kind === 'cave') place(room, ['campfire', 'boulder']);
  }
  const degree = new Map<number, number>();
  for (const link of links) {
    if (!rooms[link.a]?.alive || !rooms[link.b]?.alive) continue;
    degree.set(link.a, (degree.get(link.a) ?? 0) + 1);
    degree.set(link.b, (degree.get(link.b) ?? 0) + 1);
  }
  for (const room of alive) {
    if (used.has(room.id) || room.id === entrance.id) continue;
    if ((degree.get(room.id) ?? 0) === 1) place(room, ['chest']);
  }
  const small = alive.filter((room) => !used.has(room.id) && room.cells.size <= 20);
  if (small.length) place(pick(rng, small), ['barrel', 'crate']);
  void routes;
  const seen = new Set<number>([entrance.id]);
  const queue = [entrance.id];
  const order: number[] = [];
  const neighbors = new Map<number, number[]>();
  for (const link of links) {
    if (!rooms[link.a]?.alive || !rooms[link.b]?.alive) continue;
    const left = neighbors.get(link.a) ?? [];
    left.push(link.b);
    neighbors.set(link.a, left);
    const right = neighbors.get(link.b) ?? [];
    right.push(link.a);
    neighbors.set(link.b, right);
  }
  while (queue.length) {
    const current = queue.shift() as number;
    order.push(current);
    for (const next of neighbors.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  order.forEach((roomId, index) => {
    const room = rooms[roomId];
    if (!room?.alive) return;
    const spots = openFloor(room, occ);
    const pool = spots.length ? spots : [{ x: room.rect.x + room.rect.w / 2, y: room.rect.y + room.rect.h / 2 }];
    const spot = pool[Math.floor(pool.length / 2)];
    roomLabels.push({
      id: id('lb'),
      x: (spot.x + 0.5) * G,
      y: (spot.y + 0.5) * G,
      text: '',
      badgeNumber: String(index + 1),
      fontSize: 22,
      rotation: 0,
    });
  });
  return { props, labels: roomLabels };
}

function applyJobs(layers: DungeonLayer[], jobs: TextureJob[], id: (kind: string) => string) {
  const grouped = new Map<string, TextureJob[]>();
  const ordered = [...jobs].sort((a, b) => a.order - b.order);
  for (const job of ordered) {
    if (!job.region.length || !floorTextureByPath(job.path)) continue;
    const key = `${job.layerId}|${job.order}|${job.path}|${job.softness}`;
    const list = grouped.get(key) ?? [];
    list.push(job);
    grouped.set(key, list);
  }
  const paints = new Map<string, TexturePaint[]>();
  for (const list of grouped.values()) {
    const region = batchUnion(list.map((job) => job.region));
    if (!region.length) continue;
    const paint: TexturePaint = {
      id: id('tp'),
      texturePath: list[0].path,
      softness: list[0].softness,
      kind: 'fill',
      shape: 'bucket',
      dabs: [],
      region,
    };
    const layerPaints = paints.get(list[0].layerId) ?? [];
    layerPaints.push(paint);
    paints.set(list[0].layerId, layerPaints);
  }
  for (const layer of layers) layer.texturePaints = paints.get(layer.id) ?? [];
}

function keepDoors(doors: DoorItem[], layers: DungeonLayer[]): DoorItem[] {
  return doors.filter((door) => {
    for (const layer of layers) {
      if (pointInMultiPolygon(door.x, door.y, layer.geometry) || distToMulti(layer.geometry, door.x, door.y) <= 48) return true;
      for (const road of layer.roads ?? []) {
        if (pointInMultiPolygon(door.x, door.y, road.polygon) || distToMulti(road.polygon, door.x, door.y) <= 48) return true;
      }
      for (const wall of layer.standaloneWalls) {
        for (let i = 0; i < wall.points.length - 1; i++) {
          if (distToSeg(door.x, door.y, wall.points[i], wall.points[i + 1]) <= 48) return true;
        }
      }
    }
    return false;
  });
}

export async function generateRandomMap(config: RandomMapConfig, options: GenerateOptions): Promise<DungeonDocument> {
  const safe: RandomMapConfig = {
    dungeon: config.dungeon || !config.exterior,
    exterior: config.exterior || !config.dungeon,
    maxDungeonLayers: clamp(Math.round(config.maxDungeonLayers || 1), 1, 4),
    maxExteriorLayers: clamp(Math.round(config.maxExteriorLayers || 1), 1, 8),
    useTextures: config.useTextures,
    size: RANDOM_MAP_SIZE_CELLS[config.size] ? config.size : 'medium',
  };
  if (!safe.dungeon && !safe.exterior) safe.dungeon = true;
  const seed = options.seed ?? ((Math.random() * 4294967296) >>> 0);
  if (import.meta.env.DEV) console.info('[random-map] seed', seed);
  const rng: Rng = { next: mulberry32(seed) };
  const id = makeId(seed);
  const plan = stagePlan(safe);
  const ends = new Map(plan.map((item) => [item.stage, item.end]));
  let pct = 0;
  const label = async (stage: RandomMapStage) => {
    if (!ends.has(stage)) return;
    options.onProgress(stage, pct);
    await delay();
  };
  const finish = async (stage: RandomMapStage) => {
    const end = ends.get(stage);
    if (end === undefined) return;
    pct = Math.max(pct, end);
    options.onProgress(stage, pct);
    await delay();
  };

  await label('layout');
  const world = makeWorld(safe, rng);
  await finish('layout');

  let dungeon: DungeonDraft | null = null;
  if (safe.dungeon && world.dungeon) {
    let best: DungeonDraft | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) rng.next = mulberry32(Math.floor(rng.next() * 4294967296));
      const built = await buildDungeon(world.dungeon, world.junction, safe.maxDungeonLayers, rng, id, options.labels, {
        label,
        finish,
      });
      best = built;
      if (built.alive >= Math.max(1, built.target * 0.6) && built.layers.length) break;
    }
    dungeon = best;
    if (dungeon && dungeon.layers.length === 0 && safe.dungeon) {
      throw new Error('dungeon generation failed');
    }
  }

  let exterior: ReturnType<typeof buildExterior> | null = null;
  if (safe.exterior && world.exterior) {
    await label('exterior');
    exterior = buildExterior(world.exterior, world.junction, safe.maxExteriorLayers, safe.useTextures, rng, id, options.labels);
    await finish('exterior');
  }

  const layers = [...(exterior?.layers ?? []), ...(dungeon?.layers ?? [])];
  const jobs = [...(dungeon?.jobs ?? []), ...(exterior?.jobs ?? [])];
  if (safe.useTextures) {
    await label('textures');
    applyJobs(layers, jobs, id);
    await finish('textures');
  }
  await label('finish');
  if (!layers.length) throw new Error('empty map');
  const titlePool = safe.dungeon && safe.exterior ? options.labels.titlesMixed : safe.dungeon ? options.labels.titlesDungeon : options.labels.titlesExterior;
  const doc: DungeonDocument = {
    title: titlePool.length ? pick(rng, titlePool) : 'Mapa',
    gridSize: G,
    feetPerCell: 5,
    themeId: options.themeId,
    showGrid: true,
    layers,
    activeLayerId: dungeon?.layers[0]?.id ?? exterior?.layers[0]?.id ?? layers[0].id,
    doors: [...(exterior?.doors ?? []), ...keepDoors(dungeon?.doors ?? [], dungeon?.layers ?? [])],
    stairs: dungeon?.stairs ?? [],
    props: [...(exterior?.props ?? []), ...(dungeon?.props ?? [])],
    labels: dungeon?.labels ?? [],
  };
  await finish('finish');
  return doc;
}
