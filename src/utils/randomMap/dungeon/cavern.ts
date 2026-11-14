import { circleToPolygon, GRID_SIZE, hash2D, subtractGeometry } from '../../geometry';
import { DoorItem, WallStyle } from '../../../types/dungeon';
import { pickStyles, FLOOR_BY_STYLE } from './styles';
import { recomputeHalo, computePorts } from './ports';
import { dressDungeon } from './dress';
import { chooseExitEdge } from './layouts/coarseGrid';
import { acceptLayout } from './metrics';
import { floorTextureByPath } from '../../../data/textureLibrary';
import { pick, randInt, deriveRng, weightedPick } from '../rng';
import type { BuildContext } from './archetype';
import { packDraft } from './assemble';
import { placeStairs } from './features';
import { MinHeap, Occupancy } from './grid';
import { fixDiagonals, gridToMultiPolygon, smoothMulti } from './gridGeometry';
import { gridJunctionLink } from './gridLink';
import { GenRoom, Port, DungeonDraft } from './model';
import { asMulti, batchUnion, clipTo } from './poly';
import { makeRoom } from './rooms';
import { markCorridor, routeWidth1 } from './routing';

const G = GRID_SIZE;
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

export async function buildCavern(ctx: BuildContext): Promise<DungeonDraft> {
  const { zone, junction, maxLayers, profile, rngs, id, labels, hooks } = ctx;
  await hooks.label('rooms');
  const variant = weightedPick(rngs.layout, [
    { value: 'grotto' as const, weight: 0.4 },
    { value: 'warrens' as const, weight: 0.35 },
    { value: 'rift' as const, weight: 0.25 },
  ]);
  const params =
    variant === 'grotto'
      ? { wall: 0.42, a: 4, b: 3, min: 20, tunnel: 2 }
      : variant === 'warrens'
        ? { wall: 0.5, a: 3, b: 2, min: 8, tunnel: 1 }
        : { wall: 0.46, a: 3, b: 2, min: 12, tunnel: 2 };
  const exitEdge = chooseExitEdge(junction, rngs.layout);
  let bestFloor: Uint8Array | null = null;
  let bestRatio = -1;
  let entrance = { x: zone.x + 2, y: zone.y + Math.floor(zone.h / 2) };
  for (let attempt = 0; attempt < 4; attempt++) {
    const rng = attempt === 0 ? rngs.layout : deriveRng((rngs.layout.next() * 4294967296) >>> 0, `cavern-${attempt}`);
    const floor = new Uint8Array(zone.w * zone.h);
    const local = (x: number, y: number) => (y - zone.y) * zone.w + (x - zone.x);
    entrance = {
      x: exitEdge === 1 ? zone.x + zone.w - 3 : exitEdge === 3 ? zone.x + 2 : zone.x + 2 + Math.floor(rng.next() * Math.max(1, zone.w - 4)),
      y: exitEdge === 2 ? zone.y + zone.h - 3 : exitEdge === 0 ? zone.y + 2 : junction ? junction.yCell : zone.y + 2 + Math.floor(rng.next() * Math.max(1, zone.h - 4)),
    };
    for (let y = zone.y; y < zone.y + zone.h; y++) {
      for (let x = zone.x; x < zone.x + zone.w; x++) {
        const edge = x === zone.x || y === zone.y || x === zone.x + zone.w - 1 || y === zone.y + zone.h - 1;
        floor[local(x, y)] = edge || rng.next() < params.wall ? 0 : 1;
      }
    }
    for (let y = entrance.y - 1; y <= entrance.y + 1; y++) {
      for (let x = entrance.x - 1; x <= entrance.x + 1; x++) if (inside(zone, x, y)) floor[local(x, y)] = 1;
    }
    let mask: Uint8Array | null = null;
    if (variant === 'rift') {
      const goal = { x: zone.x + zone.w - 1 - (entrance.x - zone.x), y: zone.y + zone.h - 1 - (entrance.y - zone.y) };
      const path = cavePath(zone, floor, entrance, goal, rngs.layout.next());
      mask = new Uint8Array(floor.length);
      for (const cell of path) {
        for (let y = cell.y - 5; y <= cell.y + 5; y++) {
          for (let x = cell.x - 5; x <= cell.x + 5; x++) if (inside(zone, x, y)) mask[local(x, y)] = 1;
        }
        const radius = 1 + (path.indexOf(cell) % 6 === 0 ? 1 : 0);
        for (let y = cell.y - radius; y <= cell.y + radius; y++) {
          for (let x = cell.x - radius; x <= cell.x + radius; x++) if (inside(zone, x, y)) floor[local(x, y)] = 1;
        }
      }
    }
    for (let pass = 0; pass < params.a + params.b; pass++) floor.set(stepCave(zone, floor, pass < params.a, mask));
    keepLargest(zone, floor, entrance, params.min, params.tunnel, rng);
    const open = floor.reduce((sum, value) => sum + value, 0);
    const ratio = open / Math.max(1, (zone.w - 2) * (zone.h - 2));
    if (!bestFloor || Math.abs(ratio - 0.4) < Math.abs(bestRatio - 0.4)) {
      bestFloor = floor;
      bestRatio = ratio;
    }
    if (ratio >= 0.22 && ratio <= 0.65) break;
  }
  const floor = bestFloor ?? new Uint8Array(zone.w * zone.h);
  const local = (x: number, y: number) => (y - zone.y) * zone.w + (x - zone.x);
  fixDiagonals(floor, zone.w, zone.h, (index) => {
    const x = index % zone.w;
    const y = Math.floor(index / zone.w);
    return x === 0 || y === 0 || x === zone.w - 1 || y === zone.h - 1;
  }, rngs.layout);
  const distance = chebyshev(zone, floor);
  const peaks: { x: number; y: number; dist: number }[] = [];
  for (let y = zone.y + 1; y < zone.y + zone.h - 1; y++) {
    for (let x = zone.x + 1; x < zone.x + zone.w - 1; x++) {
      const dist = distance[local(x, y)];
      if (dist < 2) continue;
      let max = true;
      for (let oy = -1; oy <= 1 && max; oy++) for (let ox = -1; ox <= 1; ox++) if (distance[local(x + ox, y + oy)] > dist) max = false;
      if (max) peaks.push({ x, y, dist });
    }
  }
  peaks.sort((a, b) => b.dist - a.dist);
  const chosen: typeof peaks = [];
  const openCount = floor.reduce((sum, value) => sum + value, 0);
  for (const peak of peaks) {
    if (chosen.length >= Math.max(3, Math.min(40, Math.round(openCount / 60)))) break;
    if (chosen.some((item) => Math.max(Math.abs(item.x - peak.x), Math.abs(item.y - peak.y)) < 6)) continue;
    chosen.push(peak);
  }
  if (!chosen.length) chosen.push({ ...entrance, dist: 1 });
  const occ = new Occupancy(zone);
  const rooms: GenRoom[] = chosen.map((peak, index) => {
    const cells = new Set<number>();
    let minX = peak.x;
    let minY = peak.y;
    let maxX = peak.x;
    let maxY = peak.y;
    for (let y = peak.y - peak.dist - 1; y <= peak.y + peak.dist + 1; y++) {
      for (let x = peak.x - peak.dist - 1; x <= peak.x + peak.dist + 1; x++) {
        if (!inside(zone, x, y) || !floor[local(x, y)]) continue;
        if (Math.max(Math.abs(x - peak.x), Math.abs(y - peak.y)) > peak.dist + 1) continue;
        cells.add(occ.i(x, y));
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    return {
      id: index,
      rect: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
      kind: 'cave',
      cells,
      noPort: new Set<number>(),
      pillarCells: [],
      pillars: [],
      islands: [],
      polygon: [],
      ports: [],
      layer: 0,
      role: 'normal',
      group: 0,
      reserved: new Set<number>(),
      alive: cells.size > 0,
    };
  });
  let entranceRoom = rooms.find((room) => room.cells.has(occ.i(entrance.x, entrance.y))) ?? rooms[0];
  entranceRoom.role = 'entrance';
  for (let index = 0; index < floor.length; index++) {
    if (!floor[index]) continue;
    const x = zone.x + (index % zone.w);
    const y = zone.y + Math.floor(index / zone.w);
    occ.grid[occ.i(x, y)] = 3;
    occ.corridorLayer[occ.i(x, y)] = 0;
  }
  const styles = pickStyles(Math.min(maxLayers, 3), profile, rngs.style);
  const worked: GenRoom[] = [];
  if (maxLayers > 1) {
    const limit = Math.min(maxLayers - 1, 2);
    for (let n = 0; n < 30 && worked.length < limit; n++) {
      const w = 6 + Math.floor(rngs.layout.next() * 4);
      const h = 5 + Math.floor(rngs.layout.next() * 3);
      const x = zone.x + 3 + Math.floor(rngs.layout.next() * Math.max(1, zone.w - w - 6));
      const y = zone.y + 3 + Math.floor(rngs.layout.next() * Math.max(1, zone.h - h - 6));
      let clear = true;
      for (let cy = y - 2; cy < y + h + 2 && clear; cy++) {
        for (let cx = x - 2; cx < x + w + 2; cx++) if (!inside(zone, cx, cy) || floor[local(cx, cy)]) clear = false;
      }
      if (!clear) continue;
      const room = makeRoom(occ, rooms.length + worked.length, { x, y, w, h }, rngs.layout, { rect: 50, hall: 25, octagon: 25 });
      if (!room) continue;
      room.layer = 1 + worked.length;
      room.role = rngs.layout.next() < 0.5 ? 'shrine' : 'vault';
      for (const cell of room.cells) occ.grid[cell] = 1;
      for (const cell of room.pillarCells) occ.grid[cell] = 4;
      worked.push(room);
    }
    recomputeHalo(occ, worked);
    for (const room of worked) {
      room.ports = computePorts(room, occ);
      const goals: Port[] = [];
      for (let index = 0; index < floor.length && goals.length < 24; index++) {
        if (!floor[index]) continue;
        const x = zone.x + (index % zone.w);
        const y = zone.y + Math.floor(index / zone.w);
        if (Math.abs(x - (room.rect.x + room.rect.w / 2)) + Math.abs(y - (room.rect.y + room.rect.h / 2)) < 30) goals.push({ x, y, into: 0 });
      }
      const path = routeWidth1(occ, room.ports, goals, 0);
      if (!path) continue;
      markCorridor(occ, path.cells, 0);
      for (const cell of path.cells) if (inside(zone, cell.x, cell.y)) floor[local(cell.x, cell.y)] = 1;
      const end = room.ports.find((port) => port.x === path.cells[0].x && port.y === path.cells[0].y);
      if (!end) continue;
      room.ports = [end];
    }
  }
  const link = junction ? gridJunctionLink(occ, widen(floor, zone, occ), junction, zone, rooms) : null;
  let geometry = smoothMulti(gridToMultiPolygon(floor, zone.w, zone.h, zone.x, zone.y), zone.w * zone.h > 5000 ? 1 : 2, zone.w * zone.h > 5000 ? 6 : 3);
  if (link) geometry = batchUnion([geometry, link.poly]);
  for (const room of rooms) room.polygon = geometry;
  const layers = [
    { style: styles[0] ?? 'rock', geometry, layer: 0 },
    ...worked.map((room) => ({ style: styles[room.layer] ?? 'brick', geometry: room.polygon.length ? room.polygon : [], layer: room.layer })),
  ].filter((layer) => layer.geometry.length);
  const fixed = layers.map((layer) => (layer.layer === 0 ? layer : { ...layer, geometry: worked.find((room) => room.layer === layer.layer)?.polygon ?? layer.geometry }));
  const roomLayers = worked.map((room) => ({ style: styles[Math.min(styles.length - 1, room.layer)] ?? ('brick' as WallStyle), geometry: room.polygon }));
  const caveLayer = { style: (styles[0] ?? 'rock') as WallStyle, geometry };
  const docs = [caveLayer, ...roomLayers.filter((layer) => layer.geometry.length)];
  const stair = placeStairs(entranceRoom, exitEdge, occ, id, null, (x, y) => !inside(zone, x, y) || !floor[local(x, y)]);
  const links = rooms.slice(1).map((room, index) => ({ a: rooms[index].id, b: room.id }));
  const dressed = dressDungeon(rooms.concat(worked), occ, docs.map((layer) => layer.style), links, entranceRoom, [], rngs.dress, id, labels, stair ? [stair] : [], profile);
  const doors: DoorItem[] = [];
  if (link?.door) doors.push({ ...link.door, id: id('dr') });
  for (const room of worked) {
    const port = room.ports[0];
    if (!port) continue;
    doors.push({ id: id('dr'), x: port.x * G, y: port.y * G, rotation: port.into % 2 === 0 ? 0 : 90, type: 'standard', widthCells: 1 });
  }
  const jobs = [];
  const puddle = ['woda-płytka.png', 'błoto.png'].find((path) => floorTextureByPath(path));
  if (puddle && rooms.length) {
    for (const room of [...rooms].sort((a, b) => b.cells.size - a.cells.size).slice(0, randInt(rngs.texture, 1, Math.min(3, rooms.length)))) {
      const circle = circleToPolygon((room.rect.x + room.rect.w / 2) * G, (room.rect.y + room.rect.h / 2) * G, (1 + rngs.texture.next()) * G, 12);
      const region = clipTo(asMulti(circle), geometry);
      if (region.length) jobs.push({ layerId: 'gen-dng-0', path: puddle, softness: 0.3, region, order: 10 });
    }
  }
  const base = FLOOR_BY_STYLE.rock.find((path) => floorTextureByPath(path));
  if (base) jobs.push({ layerId: 'gen-dng-0', path: pick(rngs.texture, FLOOR_BY_STYLE.rock.filter((path) => floorTextureByPath(path))), softness: 0, region: geometry, order: 0 });
  await hooks.finish('rooms');
  await hooks.finish('layers');
  await hooks.label('corridors');
  await hooks.finish('corridors');
  await hooks.label('doors');
  const built = docs.map((layer, index) => ({
    id: `gen-dng-${index}`,
    name: labels.dungeonLayers[layer.style]?.[0] ?? layer.style,
    visible: true,
    locked: false,
    opacity: 1,
    wallStyle: layer.style,
    hatchEnabled: true,
    environment: 'interior' as const,
    geometry: index === 0 ? geometry : subtractGeometry(layer.geometry, []),
    standaloneWalls: [],
    texturePaints: [],
    roads: [],
  }));
  await hooks.finish('doors');
  const draft = packDraft(
    {
      layers: built,
      doors,
      stairs: stair ? [stair] : [],
      jobs,
      props: dressed.props,
      labels: dressed.labels,
      walls: [],
      alive: rooms.filter((room) => room.alive).length,
      target: Math.max(3, rooms.length),
    },
    rooms,
    links,
    profile,
    entranceRoom.id
  );
  draft.metrics.floorCells = openCount;
  draft.metrics.floorRatio = openCount / Math.max(1, (zone.w - 2) * (zone.h - 2));
  draft.metrics.rooms = rooms.filter((room) => room.alive).length;
  draft.metrics.reachable = draft.metrics.rooms;
  const verdict = acceptLayout('cavern', draft.metrics);
  draft.accepted = verdict.ok && built.length > 0;
  draft.score = verdict.score;
  void fixed;
  return draft;
}

function inside(zone: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean {
  return x >= zone.x && y >= zone.y && x < zone.x + zone.w && y < zone.y + zone.h;
}

function stepCave(zone: { x: number; y: number; w: number; h: number }, floor: Uint8Array, openRule: boolean, mask: Uint8Array | null): Uint8Array {
  const next = new Uint8Array(floor.length);
  const local = (x: number, y: number) => (y - zone.y) * zone.w + (x - zone.x);
  for (let y = zone.y; y < zone.y + zone.h; y++) {
    for (let x = zone.x; x < zone.x + zone.w; x++) {
      const index = local(x, y);
      if (x === zone.x || y === zone.y || x === zone.x + zone.w - 1 || y === zone.y + zone.h - 1 || (mask && !mask[index])) {
        next[index] = 0;
        continue;
      }
      let r1 = 0;
      let r2 = 0;
      for (let oy = -2; oy <= 2; oy++) {
        for (let ox = -2; ox <= 2; ox++) {
          const wall = !inside(zone, x + ox, y + oy) || !floor[local(x + ox, y + oy)];
          if (Math.max(Math.abs(ox), Math.abs(oy)) <= 1 && wall) r1 += 1;
          if (wall) r2 += 1;
        }
      }
      const wall = openRule ? r1 >= 5 || r2 <= 2 : r1 >= 5;
      next[index] = wall ? 0 : 1;
    }
  }
  return next;
}

function keepLargest(
  zone: { x: number; y: number; w: number; h: number },
  floor: Uint8Array,
  entrance: { x: number; y: number },
  min: number,
  tunnel: number,
  rng: { next: () => number }
) {
  const local = (x: number, y: number) => (y - zone.y) * zone.w + (x - zone.x);
  const seen = new Uint8Array(floor.length);
  const components: { cells: number[]; hasEntrance: boolean }[] = [];
  for (let index = 0; index < floor.length; index++) {
    if (!floor[index] || seen[index]) continue;
    const cells: number[] = [];
    const stack = [index];
    seen[index] = 1;
    let hasEntrance = false;
    while (stack.length) {
      const current = stack.pop() as number;
      cells.push(current);
      const x = zone.x + (current % zone.w);
      const y = zone.y + Math.floor(current / zone.w);
      if (x === entrance.x && y === entrance.y) hasEntrance = true;
      for (let dir = 0; dir < 4; dir++) {
        const nx = x + DX[dir];
        const ny = y + DY[dir];
        if (!inside(zone, nx, ny)) continue;
        const next = local(nx, ny);
        if (!floor[next] || seen[next]) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    components.push({ cells, hasEntrance });
  }
  const main = components.find((item) => item.hasEntrance) ?? components.sort((a, b) => b.cells.length - a.cells.length)[0];
  if (!main) return;
  for (const component of components) {
    if (component === main) continue;
    if (component.cells.length < min) {
      for (const cell of component.cells) floor[cell] = 0;
      continue;
    }
    const sample = component.cells.slice(0, 200);
    const mainSample = main.cells.slice(0, 200);
    let bestA = sample[0];
    let bestB = mainSample[0];
    let bestDist = Infinity;
    for (const a of sample) {
      for (const b of mainSample) {
        const ax = a % zone.w;
        const ay = Math.floor(a / zone.w);
        const bx = b % zone.w;
        const by = Math.floor(b / zone.w);
        const dist = Math.abs(ax - bx) + Math.abs(ay - by);
        if (dist < bestDist) {
          bestDist = dist;
          bestA = a;
          bestB = b;
        }
      }
    }
    const width = tunnel === 1 || rng.next() < 0.5 ? 1 : 2;
    carveTunnel(zone, floor, { x: zone.x + (bestA % zone.w), y: zone.y + Math.floor(bestA / zone.w) }, { x: zone.x + (bestB % zone.w), y: zone.y + Math.floor(bestB / zone.w) }, width);
    main.cells.push(...component.cells);
  }
}

function carveTunnel(
  zone: { x: number; y: number; w: number; h: number },
  floor: Uint8Array,
  from: { x: number; y: number },
  to: { x: number; y: number },
  width: number
) {
  let x = from.x;
  let y = from.y;
  const local = (cx: number, cy: number) => (cy - zone.y) * zone.w + (cx - zone.x);
  let guard = 0;
  while ((x !== to.x || y !== to.y) && guard++ < zone.w * zone.h) {
    for (let oy = -width + 1; oy < width; oy++) {
      for (let ox = -width + 1; ox < width; ox++) if (inside(zone, x + ox, y + oy)) floor[local(x + ox, y + oy)] = 1;
    }
    if (x !== to.x) x += Math.sign(to.x - x);
    else if (y !== to.y) y += Math.sign(to.y - y);
  }
}

function chebyshev(zone: { x: number; y: number; w: number; h: number }, floor: Uint8Array): Int16Array {
  const dist = new Int16Array(floor.length);
  dist.fill(999);
  const queue: number[] = [];
  for (let index = 0; index < floor.length; index++) {
    if (floor[index]) continue;
    dist[index] = 0;
    queue.push(index);
  }
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor++];
    const x = zone.x + (current % zone.w);
    const y = zone.y + Math.floor(current / zone.w);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        if (!inside(zone, x + ox, y + oy)) continue;
        const next = (y + oy - zone.y) * zone.w + (x + ox - zone.x);
        if (dist[next] <= dist[current] + 1) continue;
        dist[next] = dist[current] + 1;
        queue.push(next);
      }
    }
  }
  return dist;
}

function cavePath(
  zone: { x: number; y: number; w: number; h: number },
  floor: Uint8Array,
  start: { x: number; y: number },
  goal: { x: number; y: number },
  seed: number
): { x: number; y: number }[] {
  void floor;
  const heap = new MinHeap();
  const startIndex = (start.y - zone.y) * zone.w + (start.x - zone.x);
  const goalIndex = (Math.max(zone.y, Math.min(zone.y + zone.h - 1, goal.y)) - zone.y) * zone.w + (Math.max(zone.x, Math.min(zone.x + zone.w - 1, goal.x)) - zone.x);
  const g = new Float64Array(zone.w * zone.h);
  g.fill(Infinity);
  const parent = new Int32Array(zone.w * zone.h);
  parent.fill(-1);
  g[startIndex] = 0;
  heap.push(startIndex, 0);
  while (heap.size) {
    const item = heap.pop();
    if (!item || item.state === goalIndex) break;
    const x = zone.x + (item.state % zone.w);
    const y = zone.y + Math.floor(item.state / zone.w);
    for (let dir = 0; dir < 4; dir++) {
      const nx = x + DX[dir];
      const ny = y + DY[dir];
      if (!inside(zone, nx, ny)) continue;
      const next = (ny - zone.y) * zone.w + (nx - zone.x);
      const cost = g[item.state] + 1 + 3 * hash2D(nx, ny, Math.floor(seed * 1000));
      if (cost >= g[next]) continue;
      g[next] = cost;
      parent[next] = item.state;
      heap.push(next, cost);
    }
  }
  const path: { x: number; y: number }[] = [];
  let cursor = goalIndex;
  let guard = 0;
  while (cursor >= 0 && guard++ < zone.w * zone.h) {
    path.push({ x: zone.x + (cursor % zone.w), y: zone.y + Math.floor(cursor / zone.w) });
    if (cursor === startIndex) break;
    cursor = parent[cursor];
  }
  return path.reverse();
}

function widen(floor: Uint8Array, zone: { x: number; y: number; w: number; h: number }, occ: Occupancy): Uint8Array {
  const out = new Uint8Array(occ.grid.length);
  for (let y = 0; y < zone.h; y++) {
    for (let x = 0; x < zone.w; x++) if (floor[y * zone.w + x]) out[occ.i(zone.x + x, zone.y + y)] = 1;
  }
  return out;
}
