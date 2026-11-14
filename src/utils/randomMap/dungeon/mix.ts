import { GRID_SIZE } from '../../geometry';
import { DoorItem, DungeonLayer, MultiPolygon2D, WallStyle } from '../../../types/dungeon';
import { pointInMultiPolygon } from '../../texturePaint';
import { clamp, deriveRng, deriveSeed, makeDungeonRngs, randInt, range, Rng, shuffle } from '../rng';
import { IdFactory, Junction, RandomMapLabels, Rect, TextureJob } from '../types';
import { buildByArchetype, failedDraft } from './archetype';
import { coarseFeasible } from './layouts/coarseGrid';
import { blankMetrics } from './metrics';
import { ConcreteArchetype, DungeonDraft, Hooks } from './model';
import { asMulti, batchUnion, rectPoly } from './poly';
import { PROFILES } from './profiles';

const G = GRID_SIZE;

const PREFERRED: Record<ConcreteArchetype, number> = {
  classic: 1,
  delve: 1.15,
  hub: 1.2,
  ring: 1.15,
  maze: 1.1,
  cavern: 1.2,
};

export interface PackedSection {
  archetype: ConcreteArchetype;
  rect: Rect;
  gate: boolean;
}

interface Cell {
  x: number;
  y: number;
}

export function sectionFits(archetype: ConcreteArchetype, rect: Rect): boolean {
  if (rect.w < 1 || rect.h < 1) return false;
  if (archetype === 'classic') return (rect.w >= 16 && rect.h >= 12) || (rect.w >= 12 && rect.h >= 16);
  if (archetype === 'maze' || archetype === 'cavern') return (rect.w >= 14 && rect.h >= 12) || (rect.w >= 12 && rect.h >= 14);
  return coarseFeasible(archetype, rect);
}

function minSpan(archetype: ConcreteArchetype, alongWidth: boolean, cross: number): number {
  const limit = 160;
  for (let span = 1; span <= limit; span++) {
    const w = alongWidth ? span : cross;
    const h = alongWidth ? cross : span;
    if (sectionFits(archetype, { x: 0, y: 0, w, h })) return span;
  }
  return limit + 1;
}

function groupMin(items: ConcreteArchetype[], alongWidth: boolean, cross: number): number {
  let best = Infinity;
  for (const archetype of items) {
    const span = minSpan(archetype, alongWidth, cross);
    if (span < best) best = span;
  }
  return best;
}

function weightOf(items: ConcreteArchetype[], weights: Map<ConcreteArchetype, number>): number {
  return items.reduce((sum, archetype) => sum + (weights.get(archetype) ?? 1), 0);
}

function covers(zone: Rect, sections: PackedSection[]): boolean {
  if (!sections.length) return false;
  let area = 0;
  for (let i = 0; i < sections.length; i++) {
    const rect = sections[i].rect;
    if (rect.x < zone.x || rect.y < zone.y || rect.x + rect.w > zone.x + zone.w || rect.y + rect.h > zone.y + zone.h) return false;
    if (rect.w < 1 || rect.h < 1) return false;
    area += rect.w * rect.h;
    for (let j = i + 1; j < sections.length; j++) {
      const other = sections[j].rect;
      const w = Math.min(rect.x + rect.w, other.x + other.w) - Math.max(rect.x, other.x);
      const h = Math.min(rect.y + rect.h, other.y + other.h) - Math.max(rect.y, other.y);
      if (w > 0 && h > 0) return false;
    }
  }
  return area === zone.w * zone.h;
}

function carve(rect: Rect, items: ConcreteArchetype[], weights: Map<ConcreteArchetype, number>, rng: Rng): PackedSection[] {
  if (!items.length || rect.w < 1 || rect.h < 1) return [];
  if (items.length === 1) {
    return sectionFits(items[0], rect) ? [{ archetype: items[0], rect: { ...rect }, gate: false }] : [];
  }
  const splits = candidateSplits(items, rng);
  const alongFirst = rect.w >= rect.h ? rng.next() < 0.75 : rng.next() < 0.25;
  const axes = alongFirst ? [true, false] : [false, true];
  for (const alongWidth of axes) {
    for (const [sideA, sideB] of splits) {
      const placed = splitPlace(rect, sideA, sideB, weights, rng, alongWidth);
      if (placed.length) return placed;
    }
  }
  const keeper = items.find((archetype) => sectionFits(archetype, rect));
  return keeper ? [{ archetype: keeper, rect: { ...rect }, gate: false }] : [];
}

function candidateSplits(items: ConcreteArchetype[], rng: Rng): [ConcreteArchetype[], ConcreteArchetype[]][] {
  const found: [ConcreteArchetype[], ConcreteArchetype[]][] = [
    [items.slice(0, 1), items.slice(1)],
    [items.slice(0, -1), items.slice(-1)],
  ];
  for (let attempt = 0; attempt < 3; attempt++) {
    const take = items.map(() => rng.next() < 0.5);
    if (take.every(Boolean)) take[randInt(rng, 0, items.length - 1)] = false;
    if (take.every((bit) => !bit)) take[randInt(rng, 0, items.length - 1)] = true;
    const left = items.filter((_, index) => take[index]);
    const right = items.filter((_, index) => !take[index]);
    if (left.length && right.length) found.push([left, right]);
  }
  return found;
}

function splitPlace(
  rect: Rect,
  sideA: ConcreteArchetype[],
  sideB: ConcreteArchetype[],
  weights: Map<ConcreteArchetype, number>,
  rng: Rng,
  alongWidth: boolean
): PackedSection[] {
  const total = alongWidth ? rect.w : rect.h;
  const cross = alongWidth ? rect.h : rect.w;
  const minA = groupMin(sideA, alongWidth, cross);
  const minB = groupMin(sideB, alongWidth, cross);
  if (minA + minB > total || minA < 1 || minB < 1) return [];
  const share = weightOf(sideA, weights) / Math.max(0.001, weightOf(sideA, weights) + weightOf(sideB, weights));
  const fraction = clamp(share + (rng.next() * 0.24 - 0.12), minA / total, (total - minB) / total);
  const cut = clamp(Math.round(total * fraction), minA, total - minB);
  if (cut < 1 || cut >= total) return [];
  const rectA = alongWidth
    ? { x: rect.x, y: rect.y, w: cut, h: rect.h }
    : { x: rect.x, y: rect.y, w: rect.w, h: cut };
  const rectB = alongWidth
    ? { x: rect.x + cut, y: rect.y, w: rect.w - cut, h: rect.h }
    : { x: rect.x, y: rect.y + cut, w: rect.w, h: rect.h - cut };
  const placedA = carve(rectA, sideA, weights, rng);
  const placedB = carve(rectB, sideB, weights, rng);
  if (!placedA.length || !placedB.length) return [];
  return [...placedA, ...placedB];
}

function cutGate(
  zone: Rect,
  items: ConcreteArchetype[],
  weights: Map<ConcreteArchetype, number>,
  junction: Junction,
  rng: Rng
): PackedSection[] {
  const maxW = Math.max(1, Math.floor(zone.w * 0.6));
  const candidates = items.filter((archetype) => minSpan(archetype, true, zone.h) <= maxW);
  if (!candidates.length) return [];
  const archetype = candidates[randInt(rng, 0, candidates.length - 1)];
  const minW = minSpan(archetype, true, zone.h);
  const rest = items.filter((item) => item !== archetype);
  let maxCut = maxW;
  if (rest.length) {
    const leave = Math.min(...rest.map((item) => minSpan(item, true, zone.h)));
    if (leave <= zone.w) maxCut = Math.min(maxCut, zone.w - leave);
  }
  if (maxCut < minW) return [];
  const thickness = randInt(rng, minW, maxCut);
  const onLeft = junction.dungeonSign === 1;
  const gateRect = onLeft
    ? { x: zone.x, y: zone.y, w: thickness, h: zone.h }
    : { x: zone.x + zone.w - thickness, y: zone.y, w: thickness, h: zone.h };
  const restRect = onLeft
    ? { x: zone.x + thickness, y: zone.y, w: zone.w - thickness, h: zone.h }
    : { x: zone.x, y: zone.y, w: zone.w - thickness, h: zone.h };
  if (!sectionFits(archetype, gateRect)) return [];
  const gate: PackedSection = { archetype, rect: gateRect, gate: true };
  if (!rest.length) return [gate];
  const others = carve(restRect, rest, weights, rng);
  return others.length ? [gate, ...others] : [];
}

function markGate(sections: PackedSection[], zone: Rect, junction: Junction | null): PackedSection[] {
  if (!junction || !sections.length) return sections;
  let best = -1;
  let bestScore = -Infinity;
  sections.forEach((section, index) => {
    const rect = section.rect;
    const touches = junction.dungeonSign === 1 ? rect.x === zone.x : rect.x + rect.w === zone.x + zone.w;
    if (!touches) return;
    const coversRow = rect.y <= junction.yCell && junction.yCell < rect.y + rect.h;
    const distance = coversRow ? 0 : Math.min(Math.abs(junction.yCell - rect.y), Math.abs(junction.yCell - (rect.y + rect.h - 1)));
    const score = (coversRow ? 1000 : 0) + rect.h - distance;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return sections.map((section, index) => ({ ...section, gate: index === best }));
}

function packAttempt(
  zone: Rect,
  items: ConcreteArchetype[],
  weights: Map<ConcreteArchetype, number>,
  junction: Junction | null,
  rng: Rng
): PackedSection[] {
  if (junction) {
    const gated = cutGate(zone, items, weights, junction, rng);
    if (gated.length && covers(zone, gated) && gated.every((section) => sectionFits(section.archetype, section.rect))) return gated;
  }
  const placed = carve(zone, items, weights, rng);
  if (!covers(zone, placed) || placed.some((section) => !sectionFits(section.archetype, section.rect))) return [];
  return markGate(placed, zone, junction);
}

export function packSections(
  zone: Rect,
  requested: ConcreteArchetype[],
  junction: Junction | null,
  rng: Rng
): PackedSection[] {
  const unique: ConcreteArchetype[] = [];
  for (const archetype of requested) if (!unique.includes(archetype)) unique.push(archetype);
  if (!unique.length || zone.w < 1 || zone.h < 1) return [];
  let best: PackedSection[] | null = null;
  for (let attempt = 0; attempt < 32; attempt++) {
    const priority = shuffle(rng, unique.slice());
    const weights = new Map<ConcreteArchetype, number>();
    for (const archetype of priority) weights.set(archetype, range(rng, 0.7, 1.4) * PREFERRED[archetype]);
    const placed = packAttempt(zone, priority, weights, junction, rng);
    if (!placed.length) continue;
    if (!best || placed.length > best.length || (placed.length === best.length && rng.next() < 0.5)) {
      best = placed.map((section) => ({ ...section, rect: { ...section.rect } }));
    }
  }
  if (best) return best;
  const fallback = unique.find((archetype) => sectionFits(archetype, zone)) ?? 'classic';
  const archetype = sectionFits(fallback, zone) ? fallback : 'classic';
  return [{ archetype, rect: { ...zone }, gate: Boolean(junction) }];
}

function claimLayerIds(draft: DungeonDraft, id: IdFactory) {
  for (const layer of draft.layers) {
    const next = id('ly');
    const prev = layer.id;
    layer.id = next;
    for (const job of draft.jobs) if (job.layerId === prev) job.layerId = next;
  }
}

function geomSize(geometry: MultiPolygon2D): number {
  let size = 0;
  for (const poly of geometry) {
    for (const ring of poly) {
      let sum = 0;
      for (let i = 0; i < ring.length - 1; i++) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      size += Math.abs(sum);
    }
  }
  return size;
}

function largestLayer(layers: DungeonLayer[]): DungeonLayer | null {
  let best: DungeonLayer | null = null;
  let bestSize = -1;
  for (const layer of layers) {
    const size = geomSize(layer.geometry);
    if (size > bestSize) {
      bestSize = size;
      best = layer;
    }
  }
  return best;
}

function absorb(keeper: DungeonLayer, extras: DungeonLayer[], jobs: TextureJob[]) {
  if (!extras.length) return;
  keeper.geometry = batchUnion([keeper.geometry, ...extras.map((layer) => layer.geometry)]);
  keeper.standaloneWalls = [...keeper.standaloneWalls, ...extras.flatMap((layer) => layer.standaloneWalls)];
  const dropped = new Set(extras.map((layer) => layer.id));
  for (const job of jobs) if (dropped.has(job.layerId)) job.layerId = keeper.id;
}

function capLayers(layers: DungeonLayer[], jobs: TextureJob[], maxLayers: number): DungeonLayer[] {
  const groups = new Map<WallStyle, DungeonLayer[]>();
  for (const layer of layers) {
    const list = groups.get(layer.wallStyle) ?? [];
    list.push(layer);
    groups.set(layer.wallStyle, list);
  }
  let merged: DungeonLayer[] = [];
  for (const group of groups.values()) {
    const keeper = largestLayer(group);
    if (!keeper) continue;
    absorb(keeper, group.filter((layer) => layer !== keeper), jobs);
    merged.push(keeper);
  }
  while (merged.length > Math.max(1, maxLayers)) {
    merged.sort((a, b) => geomSize(a.geometry) - geomSize(b.geometry));
    const small = merged[0];
    const large = merged[merged.length - 1];
    if (!small || !large || small === large) break;
    absorb(large, [small], jobs);
    merged = merged.filter((layer) => layer !== small);
  }
  return merged;
}

function sectionFloor(draft: DungeonDraft): MultiPolygon2D {
  return batchUnion(draft.layers.map((layer) => layer.geometry));
}

interface Touch {
  axis: 'h' | 'v';
  edge: number;
  start: number;
  end: number;
}

function touchOf(a: Rect, b: Rect): Touch | null {
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if ((a.x + a.w === b.x || b.x + b.w === a.x) && overlapY >= 2) {
    return { axis: 'h', edge: a.x + a.w === b.x ? a.x + a.w : b.x + b.w, start: Math.max(a.y, b.y), end: Math.min(a.y + a.h, b.y + b.h) };
  }
  if ((a.y + a.h === b.y || b.y + b.h === a.y) && overlapX >= 2) {
    return { axis: 'v', edge: a.y + a.h === b.y ? a.y + a.h : b.y + b.h, start: Math.max(a.x, b.x), end: Math.min(a.x + a.w, b.x + b.w) };
  }
  return null;
}

function onFloor(cell: Cell, floor: MultiPolygon2D): boolean {
  return pointInMultiPolygon((cell.x + 0.5) * G, (cell.y + 0.5) * G, floor);
}

function mouthCandidates(rect: Rect, floor: MultiPolygon2D, touch: Touch): { cell: Cell; dist: number }[] {
  const found: { cell: Cell; dist: number }[] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const along = touch.axis === 'h' ? y : x;
      if (along < touch.start || along >= touch.end) continue;
      const cell = { x, y };
      if (!onFloor(cell, floor)) continue;
      const dist = touch.axis === 'h' ? Math.abs(x - (touch.edge - (x < touch.edge ? 1 : 0))) : Math.abs(y - (touch.edge - (y < touch.edge ? 1 : 0)));
      const edgeDist = touch.axis === 'h' ? Math.min(Math.abs(x + 1 - touch.edge), Math.abs(x - touch.edge)) : Math.min(Math.abs(y + 1 - touch.edge), Math.abs(y - touch.edge));
      found.push({ cell, dist: edgeDist === 0 ? dist : edgeDist });
    }
  }
  found.sort((a, b) => a.dist - b.dist || a.cell.y - b.cell.y || a.cell.x - b.cell.x);
  return found;
}

function pickMouths(a: { cell: Cell; dist: number }[], b: { cell: Cell; dist: number }[], touch: Touch, rng: Rng): [Cell, Cell][] {
  if (!a.length || !b.length) return [];
  const band = Math.max(a[0].dist, b[0].dist) + 1;
  const inset = touch.end - touch.start >= 4 ? 1 : 0;
  const near = (list: { cell: Cell; dist: number }[]) =>
    list.filter((item) => {
      if (item.dist > band) return false;
      const along = touch.axis === 'h' ? item.cell.y : item.cell.x;
      return along >= touch.start + inset && along < touch.end - inset;
    });
  let poolA = near(a);
  let poolB = near(b);
  if (!poolA.length) poolA = a.filter((item) => item.dist <= band);
  if (!poolB.length) poolB = b.filter((item) => item.dist <= band);
  if (!poolA.length || !poolB.length) return [];
  const pairs: [Cell, Cell][] = [];
  const limit = Math.min(6, poolA.length * poolB.length);
  const used = new Set<string>();
  for (let i = 0; i < limit * 3 && pairs.length < limit; i++) {
    const left = poolA[randInt(rng, 0, poolA.length - 1)].cell;
    const right = poolB[randInt(rng, 0, poolB.length - 1)].cell;
    const key = `${left.x},${left.y}:${right.x},${right.y}`;
    if (used.has(key)) continue;
    used.add(key);
    pairs.push([left, right]);
  }
  return pairs;
}

function traceCells(cells: Cell[]): Cell[] {
  const out: Cell[] = [];
  for (const next of cells) {
    const prev = out[out.length - 1];
    if (!prev) {
      out.push(next);
      continue;
    }
    let x = prev.x;
    let y = prev.y;
    while (x !== next.x || y !== next.y) {
      if (x !== next.x) x += Math.sign(next.x - x);
      else y += Math.sign(next.y - y);
      out.push({ x, y });
    }
  }
  return out;
}

function cellsPoly(cells: Cell[], widthCells: 1 | 2): MultiPolygon2D {
  const pad = widthCells === 2 ? 0.5 : 0;
  const unique: Cell[] = [];
  for (const cell of cells) {
    if (unique.some((item) => item.x === cell.x && item.y === cell.y)) continue;
    unique.push(cell);
  }
  if (!unique.length) return [];
  return batchUnion(
    unique.map((cell) => asMulti(rectPoly({ x: cell.x - pad, y: cell.y - pad, w: 1 + pad * 2, h: 1 + pad * 2 })))
  );
}

function unionInto(layer: DungeonLayer, poly: MultiPolygon2D, jobs: TextureJob[]) {
  if (!poly.length) return;
  layer.geometry = batchUnion([layer.geometry, poly]);
  for (const job of jobs) {
    if (job.layerId === layer.id && job.order === 0) job.region = batchUnion([job.region, poly]);
  }
}

function stitchPair(
  left: DungeonDraft,
  right: DungeonDraft,
  leftRect: Rect,
  rightRect: Rect,
  jobs: TextureJob[],
  id: IdFactory,
  rng: Rng
): DoorItem | null {
  const touch = touchOf(leftRect, rightRect);
  if (!touch) return null;
  const leftFloor = sectionFloor(left);
  const rightFloor = sectionFloor(right);
  const pairs = pickMouths(mouthCandidates(leftRect, leftFloor, touch), mouthCandidates(rightRect, rightFloor, touch), touch, rng);
  const widthCells: 1 | 2 = touch.end - touch.start >= 4 && rng.next() < 0.5 ? 2 : 1;
  for (const [a, b] of pairs) {
    const door = layStitch(left, right, a, b, touch, widthCells, jobs, id);
    if (door) return door;
  }
  return null;
}

function layStitch(
  left: DungeonDraft,
  right: DungeonDraft,
  a: Cell,
  b: Cell,
  touch: Touch,
  widthCells: 1 | 2,
  jobs: TextureJob[],
  id: IdFactory
): DoorItem | null {
  const layerA = largestLayer(left.layers);
  const layerB = largestLayer(right.layers);
  if (!layerA || !layerB) return null;
  let longCells: Cell[];
  let inletCells: Cell[];
  let longLayer: DungeonLayer;
  let inletLayer: DungeonLayer;
  let door: Omit<DoorItem, 'id'>;
  if (touch.axis === 'h') {
    const edge = touch.edge;
    const aLeft = a.x < edge;
    const outer = aLeft ? a : b;
    const inner = aLeft ? b : a;
    const approach: Cell = { x: edge - 1, y: outer.y };
    const turn: Cell = { x: edge - 1, y: inner.y };
    const entry: Cell = { x: edge, y: inner.y };
    longCells = [outer, approach, turn, entry];
    inletCells = [turn, entry, inner];
    longLayer = aLeft ? layerA : layerB;
    inletLayer = aLeft ? layerB : layerA;
    door = { x: edge * G, y: (inner.y + 0.5) * G, rotation: 90, type: 'standard', widthCells };
  } else {
    const edge = touch.edge;
    const aAbove = a.y < edge;
    const outer = aAbove ? a : b;
    const inner = aAbove ? b : a;
    const approach: Cell = { x: outer.x, y: edge - 1 };
    const turn: Cell = { x: inner.x, y: edge - 1 };
    const entry: Cell = { x: inner.x, y: edge };
    longCells = [outer, approach, turn, entry];
    inletCells = [turn, entry, inner];
    longLayer = aAbove ? layerA : layerB;
    inletLayer = aAbove ? layerB : layerA;
    door = { x: (inner.x + 0.5) * G, y: edge * G, rotation: 0, type: 'standard', widthCells };
  }
  const polyLong = cellsPoly(traceCells(longCells), widthCells);
  const polyInlet = cellsPoly(traceCells(inletCells), widthCells);
  if (!polyLong.length || !polyInlet.length) return null;
  unionInto(longLayer, polyLong, jobs);
  unionInto(inletLayer, polyInlet, jobs);
  return { ...door, id: id('dr') };
}

export function countFloorComponents(layers: DungeonLayer[], zone: Rect): number {
  if (zone.w < 1 || zone.h < 1) return 0;
  const cols = zone.w;
  const rows = zone.h;
  const floor = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px0 = (zone.x + x + 0.5) * G;
      const py0 = (zone.y + y + 0.5) * G;
      if (layers.some((layer) => pointInMultiPolygon(px0, py0, layer.geometry))) floor[y * cols + x] = 1;
    }
  }
  const seen = new Uint8Array(floor.length);
  let components = 0;
  for (let index = 0; index < floor.length; index++) {
    if (!floor[index] || seen[index]) continue;
    components += 1;
    const stack = [index];
    seen[index] = 1;
    while (stack.length) {
      const current = stack.pop() as number;
      const x = current % cols;
      const y = Math.floor(current / cols);
      const next = [x > 0 ? current - 1 : -1, x + 1 < cols ? current + 1 : -1, y > 0 ? current - cols : -1, y + 1 < rows ? current + cols : -1];
      for (const neighbor of next) {
        if (neighbor < 0 || !floor[neighbor] || seen[neighbor]) continue;
        seen[neighbor] = 1;
        stack.push(neighbor);
      }
    }
  }
  return components;
}

export async function buildMix(
  packed: PackedSection[],
  zone: Rect,
  junction: Junction | null,
  maxLayers: number,
  seed: number,
  attempt: number,
  id: IdFactory,
  labels: RandomMapLabels,
  hooks: Hooks
): Promise<DungeonDraft> {
  const built: { packed: PackedSection; draft: DungeonDraft }[] = [];
  for (let index = 0; index < packed.length; index++) {
    const section = packed[index];
    let best: DungeonDraft | null = null;
    for (let tryIndex = 0; tryIndex < 3; tryIndex++) {
      const draft = await buildByArchetype(section.archetype, {
        zone: section.rect,
        junction: section.gate ? junction : null,
        maxLayers,
        profile: PROFILES[section.archetype],
        rngs: makeDungeonRngs(deriveSeed(seed, `mix:${attempt}:${index}:${tryIndex}`), 0),
        id,
        labels,
        hooks,
      });
      if (!best || draft.score > best.score) best = draft;
      if (draft.accepted && draft.layers.length) break;
    }
    if (!best || !best.accepted || !best.layers.length) continue;
    claimLayerIds(best, id);
    built.push({ packed: section, draft: best });
  }
  if (!built.length) return failedDraft(packed[0]?.archetype ?? 'classic');
  const jobs = built.flatMap((part) => part.draft.jobs);
  const stitchRng = deriveRng(seed, `stitch:${attempt}`);
  const doors = built.flatMap((part) => part.draft.doors);
  for (let i = 0; i < built.length; i++) {
    for (let j = i + 1; j < built.length; j++) {
      const door = stitchPair(built[i].draft, built[j].draft, built[i].packed.rect, built[j].packed.rect, jobs, id, stitchRng);
      if (door) doors.push(door);
    }
  }
  const layers = capLayers(built.flatMap((part) => part.draft.layers), jobs, maxLayers);
  const components = countFloorComponents(layers, zone);
  const connected = components <= 1;
  const sections = built.map((part) => part.packed.archetype);
  const gate = built.find((part) => part.packed.gate) ?? built[0];
  const score = built.reduce((sum, part) => sum + part.draft.score, 0) + sections.length * 2 + (connected ? 10 : 0);
  const metrics = blankMetrics(built.reduce((sum, part) => sum + part.draft.target, 0));
  metrics.rooms = built.reduce((sum, part) => sum + part.draft.metrics.rooms, 0);
  metrics.reachable = metrics.rooms;
  return {
    layers,
    doors,
    stairs: built.flatMap((part) => part.draft.stairs),
    jobs,
    props: built.flatMap((part) => part.draft.props),
    labels: built.flatMap((part) => part.draft.labels),
    walls: [],
    alive: built.reduce((sum, part) => sum + part.draft.alive, 0),
    target: metrics.target,
    archetype: gate.packed.archetype,
    sections,
    metrics,
    accepted: connected && sections.length >= 2 && layers.length > 0,
    score,
  };
}
