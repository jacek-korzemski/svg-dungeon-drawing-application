import { GRID_SIZE, subtractGeometry } from '../../geometry';
import { DoorItem, WallStyle } from '../../../types/dungeon';
import { weightedPick } from '../rng';
import type { BuildContext } from './archetype';
import { packDraft } from './assemble';
import { placeStairs } from './features';
import { Dir, Occupancy } from './grid';
import { gridToMultiPolygon } from './gridGeometry';
import { gridJunctionLink } from './gridLink';
import { DungeonDraft, GenRoom } from './model';
import { asMulti, batchUnion } from './poly';
import { pickStyles } from './styles';
import { makeRoom } from './rooms';
import { assignRoles } from './roles';
import { dressDungeon } from './dress';
import { chooseExitEdge } from './layouts/coarseGrid';
import { acceptLayout } from './metrics';

const G = GRID_SIZE;

interface Variant {
  name: 'catacombs' | 'labyrinth' | 'halls';
  cw: 1 | 2;
  windiness: number;
  roomDivisor: number;
  deadEndPasses: number;
  extraConnector: number;
  braid: number;
}

const VARIANTS: { value: Variant; weight: number }[] = [
  { value: { name: 'catacombs', cw: 1, windiness: 0.5, roomDivisor: 45, deadEndPasses: Number.POSITIVE_INFINITY, extraConnector: 0.04, braid: 0 }, weight: 0.4 },
  { value: { name: 'labyrinth', cw: 1, windiness: 0.9, roomDivisor: 120, deadEndPasses: 0, extraConnector: 0.01, braid: 0.25 }, weight: 0.35 },
  { value: { name: 'halls', cw: 2, windiness: 0.7, roomDivisor: 70, deadEndPasses: 3, extraConnector: 0.03, braid: 0.3 }, weight: 0.25 },
];

export async function buildMaze(ctx: BuildContext): Promise<DungeonDraft> {
  const { zone, junction, maxLayers, profile, rngs, id, labels, hooks } = ctx;
  await hooks.label('rooms');
  const rng = rngs.layout;
  let variant = weightedPick(rng, VARIANTS);
  if (zone.w * zone.h >= 5000 && variant.name === 'labyrinth') variant = { ...variant, cw: 2 };
  const step = variant.cw + 1;
  const latticeI = Math.max(1, Math.floor((zone.w - 1) / step));
  const latticeJ = Math.max(1, Math.floor((zone.h - 1) / step));
  const occ = new Occupancy(zone);
  const floor = new Uint8Array(occ.grid.length);
  const region = new Int32Array(occ.grid.length);
  let nextRegion = 1;
  const rooms: GenRoom[] = [];
  const reserved = new Set<number>();
  const exitEdge = chooseExitEdge(junction, rng);

  const carve = (x: number, y: number, regionId: number) => {
    if (!occ.in(x, y) || occ.frame(x, y)) return;
    const index = occ.i(x, y);
    floor[index] = 1;
    region[index] = regionId;
  };
  const block = (i: number, j: number) => ({
    x: zone.x + 1 + i * step,
    y: zone.y + 1 + j * step,
  });
  const reserveRect = (x: number, y: number, w: number, h: number) => {
    for (let cy = y; cy < y + h; cy++) {
      for (let cx = x; cx < x + w; cx++) if (occ.in(cx, cy)) reserved.add(occ.i(cx, cy));
    }
  };
  const addRoom = (i: number, j: number, spanI: number, spanJ: number, role: GenRoom['role']) => {
    const origin = block(i, j);
    const rect = { x: origin.x, y: origin.y, w: spanI * step - 1, h: spanJ * step - 1 };
    if (rect.w < 4 || rect.h < 4 || rect.x + rect.w >= zone.x + zone.w || rect.y + rect.h >= zone.y + zone.h) return false;
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) if (reserved.has(occ.i(x, y))) return false;
    }
    const weights = { ...profile.kindWeights, hexagon: 0 };
    const room = makeRoom(occ, rooms.length, rect, rng, weights);
    if (!room) return false;
    room.role = role;
    room.group = 0;
    const regionId = nextRegion++;
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        if (!room.cells.has(occ.i(x, y)) && !room.pillarCells.includes(occ.i(x, y))) continue;
        carve(x, y, regionId);
      }
    }
    reserveRect(rect.x, rect.y, rect.w, rect.h);
    rooms.push(room);
    return true;
  };

  const entranceSpan = variant.cw === 2 ? 2 + Math.floor(rng.next() * 2) : 3 + Math.floor(rng.next() * 2);
  let entranceI = exitEdge === 1 ? Math.max(0, latticeI - entranceSpan - (junction ? 1 : 0)) : junction ? 1 : 0;
  let entranceJ = exitEdge === 2 ? Math.max(0, latticeJ - entranceSpan) : 0;
  if (exitEdge === 0 || exitEdge === 2) entranceI = Math.floor(rng.next() * Math.max(1, latticeI - entranceSpan));
  if (exitEdge === 1 || exitEdge === 3) entranceJ = Math.floor(rng.next() * Math.max(1, latticeJ - entranceSpan));
  if (junction) {
    entranceI = junction.dungeonSign === 1 ? 1 : Math.max(0, latticeI - entranceSpan - 1);
    entranceJ = clampIndex(Math.round((junction.yCell - zone.y) / step) - Math.floor(entranceSpan / 2), 0, Math.max(0, latticeJ - entranceSpan));
  }
  addRoom(entranceI, entranceJ, entranceSpan, entranceSpan, 'entrance');
  const roomTries = Math.max(1, Math.round((latticeI * latticeJ) / variant.roomDivisor));
  for (let n = 0; n < roomTries; n++) {
    const span = 1 + Math.floor(rng.next() * 3);
    const i = Math.floor(rng.next() * Math.max(1, latticeI - span));
    const j = Math.floor(rng.next() * Math.max(1, latticeJ - span));
    addRoom(i, j, span, span, 'normal');
  }
  if (rooms.length < 2) {
    for (let n = 0; n < 30 && rooms.length < 2; n++) {
      const span = Math.min(3, latticeI, latticeJ);
      const i = Math.floor(rng.next() * Math.max(1, latticeI - span));
      const j = Math.floor(rng.next() * Math.max(1, latticeJ - span));
      addRoom(i, j, span, span, 'normal');
    }
  }

  const visited = new Set<string>();
  const key = (i: number, j: number) => `${i},${j}`;
  const freeLattice = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= latticeI || j >= latticeJ) return false;
    const origin = block(i, j);
    for (let y = 0; y < variant.cw; y++) {
      for (let x = 0; x < variant.cw; x++) if (reserved.has(occ.i(origin.x + x, origin.y + y))) return false;
    }
    return true;
  };
  const carveLattice = (i: number, j: number, regionId: number) => {
    const origin = block(i, j);
    for (let y = 0; y < variant.cw; y++) for (let x = 0; x < variant.cw; x++) carve(origin.x + x, origin.y + y, regionId);
  };
  const carveGap = (i: number, j: number, dir: number, regionId: number) => {
    const origin = block(i, j);
    if (dir === 1) for (let y = 0; y < variant.cw; y++) carve(origin.x + variant.cw, origin.y + y, regionId);
    if (dir === 3) for (let y = 0; y < variant.cw; y++) carve(origin.x - 1, origin.y + y, regionId);
    if (dir === 2) for (let x = 0; x < variant.cw; x++) carve(origin.x + x, origin.y + variant.cw, regionId);
    if (dir === 0) for (let x = 0; x < variant.cw; x++) carve(origin.x + x, origin.y - 1, regionId);
  };
  for (let j = 0; j < latticeJ; j++) {
    for (let i = 0; i < latticeI; i++) {
      if (visited.has(key(i, j)) || !freeLattice(i, j)) continue;
      const regionId = nextRegion++;
      const active = [{ i, j, dir: 1 }];
      visited.add(key(i, j));
      carveLattice(i, j, regionId);
      while (active.length) {
        const index = rng.next() < variant.windiness ? active.length - 1 : Math.floor(rng.next() * active.length);
        const current = active[index];
        const options = [
          { i: current.i, j: current.j - 1, dir: 0 },
          { i: current.i + 1, j: current.j, dir: 1 },
          { i: current.i, j: current.j + 1, dir: 2 },
          { i: current.i - 1, j: current.j, dir: 3 },
        ].filter((item) => freeLattice(item.i, item.j) && !visited.has(key(item.i, item.j)));
        if (!options.length) {
          active.splice(index, 1);
          continue;
        }
        options.sort((a, b) => Number(b.dir === current.dir) - Number(a.dir === current.dir));
        const choice = rng.next() < variant.windiness ? options[0] : options[Math.floor(rng.next() * options.length)];
        carveGap(current.i, current.j, choice.dir, regionId);
        carveLattice(choice.i, choice.j, regionId);
        visited.add(key(choice.i, choice.j));
        active.push({ ...choice, dir: choice.dir });
      }
    }
  }

  const parent = new Map<number, number>();
  const find = (value: number): number => {
    const found = parent.get(value) ?? value;
    if (found === value) return value;
    const root = find(found);
    parent.set(value, root);
    return root;
  };
  const unite = (a: number, b: number) => parent.set(find(a), find(b));
  const connectors: { cells: number[]; regions: [number, number] }[] = [];
  for (let y = zone.y + 1; y < zone.y + zone.h - 1; y++) {
    for (let x = zone.x + 1; x < zone.x + zone.w - 1; x++) {
      const index = occ.i(x, y);
      if (floor[index]) continue;
      const horizontal = region[occ.i(x - 1, y)] && region[occ.i(x + 1, y)] && region[occ.i(x - 1, y)] !== region[occ.i(x + 1, y)];
      const vertical = region[occ.i(x, y - 1)] && region[occ.i(x, y + 1)] && region[occ.i(x, y - 1)] !== region[occ.i(x, y + 1)];
      if (!horizontal && !vertical) continue;
      const left = horizontal ? region[occ.i(x - 1, y)] : region[occ.i(x, y - 1)];
      const right = horizontal ? region[occ.i(x + 1, y)] : region[occ.i(x, y + 1)];
      connectors.push({ cells: [index], regions: [left, right] });
    }
  }
  const entranceRegion = rooms[0] ? region[[...rooms[0].cells][0]] : 1;
  const doors: Omit<DoorItem, 'id'>[] = [];
  const openConnector = (connector: { cells: number[]; regions: [number, number] }, recordDoor: boolean) => {
    for (const cell of connector.cells) {
      floor[cell] = 1;
      region[cell] = find(connector.regions[0]);
      if (!recordDoor) continue;
      const x = occ.xOf(cell);
      const y = occ.yOf(cell);
      const room = rooms.find((item) => item.cells.has(occ.i(x - 1, y)) || item.cells.has(occ.i(x + 1, y)) || item.cells.has(occ.i(x, y - 1)) || item.cells.has(occ.i(x, y + 1)));
      if (!room) continue;
      const horizontal = room.cells.has(occ.i(x - 1, y)) || room.cells.has(occ.i(x + 1, y));
      doors.push({
        x: horizontal ? (room.cells.has(occ.i(x - 1, y)) ? x * G : (x + 1) * G) : (x + 0.5) * G,
        y: horizontal ? (y + 0.5) * G : room.cells.has(occ.i(x, y - 1)) ? y * G : (y + 1) * G,
        rotation: horizontal ? 90 : 0,
        type: 'standard',
        widthCells: variant.cw,
      });
    }
    unite(connector.regions[0], connector.regions[1]);
  };
  let guard = 0;
  while (guard++ < connectors.length) {
    const pending = connectors.filter((item) => find(item.regions[0]) !== find(item.regions[1]) && (find(item.regions[0]) === find(entranceRegion) || find(item.regions[1]) === find(entranceRegion)));
    if (!pending.length) break;
    openConnector(pending[Math.floor(rng.next() * pending.length)], true);
  }
  for (const connector of connectors) {
    if (find(connector.regions[0]) !== find(connector.regions[1])) continue;
    if (floor[connector.cells[0]]) continue;
    if (rng.next() < variant.extraConnector) openConnector(connector, false);
  }
  const carvedNeighborCount = (index: number) => {
    const x = occ.xOf(index);
    const y = occ.yOf(index);
    let count = 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      if (occ.in(x + dx, y + dy) && floor[occ.i(x + dx, y + dy)]) count += 1;
    }
    return count;
  };
  const roomCell = new Set<number>();
  for (const room of rooms) for (const cell of room.cells) roomCell.add(cell);
  const passLimit = zone.w * zone.h < 900 && !Number.isFinite(variant.deadEndPasses) ? 2 : variant.deadEndPasses;
  let passes = 0;
  while (passes < passLimit) {
    passes += 1;
    let removed = false;
    for (let index = 0; index < floor.length; index++) {
      if (!floor[index] || roomCell.has(index) || doors.some((door) => Math.abs(door.x - (occ.xOf(index) + 0.5) * G) < 2 && Math.abs(door.y - (occ.yOf(index) + 0.5) * G) < 2)) continue;
      if (carvedNeighborCount(index) === 1) {
        floor[index] = 0;
        removed = true;
      }
    }
    if (!removed) break;
  }
  const deadEnds: number[] = [];
  for (let index = 0; index < floor.length; index++) if (floor[index] && !roomCell.has(index) && carvedNeighborCount(index) === 1) deadEnds.push(index);
  for (const index of deadEnds) {
    if (rng.next() >= variant.braid) continue;
    const x = occ.xOf(index);
    const y = occ.yOf(index);
    const neighbors = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].map(([dx, dy]) => ({ x: x + dx, y: y + dy, on: occ.in(x + dx, y + dy) && floor[occ.i(x + dx, y + dy)] }));
    const open = neighbors.find((item) => item.on);
    if (!open) continue;
    const ahead = { x: x - (open.x - x), y: y - (open.y - y) };
    const beyond = { x: ahead.x - (open.x - x), y: ahead.y - (open.y - y) };
    if (!occ.in(ahead.x, ahead.y) || !occ.in(beyond.x, beyond.y) || floor[occ.i(ahead.x, ahead.y)] || !floor[occ.i(beyond.x, beyond.y)]) continue;
    floor[occ.i(ahead.x, ahead.y)] = 1;
  }

  for (let index = 0; index < floor.length; index++) {
    if (!floor[index] || roomCell.has(index)) continue;
    occ.grid[index] = 3;
    occ.corridorLayer[index] = 0;
  }
  for (const room of rooms) {
    for (const cell of room.cells) occ.grid[cell] = 1;
    for (const cell of room.pillarCells) occ.grid[cell] = 4;
  }
  const styles = pickStyles(Math.min(maxLayers, Math.max(1, rooms.length)), profile, rngs.style);
  if (maxLayers > 1 && rooms.length > 1) {
    const distance = new Map<number, number>([[rooms[0].id, 0]]);
    const queue = [rooms[0].id];
    while (queue.length) {
      const current = queue.shift() as number;
      for (const room of rooms) {
        if (distance.has(room.id)) continue;
        const near = [...room.cells].some((cell) => {
          const x = occ.xOf(cell);
          const y = occ.yOf(cell);
          return [occ.i(x + 1, y), occ.i(x - 1, y), occ.i(x, y + 1), occ.i(x, y - 1)].some((next) => floor[next] && [...rooms[current].cells].some((other) => {
            const ox = occ.xOf(other);
            const oy = occ.yOf(other);
            return Math.abs(ox - occ.xOf(next)) + Math.abs(oy - occ.yOf(next)) <= 2;
          }));
        });
        if (!near) continue;
        distance.set(room.id, (distance.get(current) ?? 0) + 1);
        queue.push(room.id);
      }
    }
    const maxDist = Math.max(1, ...distance.values());
    for (const room of rooms) room.layer = room.id === rooms[0].id ? 0 : Math.min(styles.length - 1, Math.floor((((distance.get(room.id) ?? maxDist) / maxDist) * (styles.length - 1))));
  }
  const link = junction ? gridJunctionLink(occ, floor, junction, zone, rooms) : null;
  if (link?.door) doors.push(link.door);
  const corridorFloor = new Uint8Array(floor.length);
  for (let index = 0; index < floor.length; index++) if (floor[index] && !roomCell.has(index)) corridorFloor[index] = 1;
  const local = corridorFloor;
  let corridorPoly = gridToMultiPolygon(local, occ.cols, occ.rows, occ.ox, occ.oy);
  if (link) corridorPoly = batchUnion([corridorPoly, link.poly]);
  const layers = styles.map((style, layer) => {
    const roomPolys = rooms.filter((room) => room.layer === layer).map((room) => room.polygon);
    let geometry = layer === 0 ? batchUnion([corridorPoly, ...roomPolys]) : batchUnion(roomPolys);
    const cuts = rooms.filter((room) => room.layer === layer).flatMap((room) => [...room.pillars, ...room.islands]);
    if (cuts.length && geometry.length) geometry = subtractGeometry(geometry, cuts.map((cut) => asMulti(cut)).flat());
    return { style, geometry, layer };
  }).filter((layer) => layer.geometry.length);
  await hooks.finish('rooms');
  await hooks.finish('layers');
  await hooks.label('corridors');
  await hooks.finish('corridors');
  await hooks.label('doors');
  assignRoles(rooms, [], rooms[0], rngs.dress, profile, new Map(rooms.filter((room) => room.role !== 'normal').map((room) => [room.id, room.role])));
  const stair = rooms[0] ? placeStairs(rooms[0], exitEdge as Dir, occ, id, null) : null;
  const dressed = rooms[0]
    ? dressDungeon(rooms, occ, layers.map((layer) => layer.style), [], rooms[0], [], rngs.dress, id, labels, stair ? [stair] : [], profile)
    : { props: [], labels: [] };
  const doorItems: DoorItem[] = doors.map((door) => ({ ...door, id: id('dr') }));
  const builtLayers = layers.map((layer, index) => {
    const item = {
      id: `gen-dng-${index}`,
      name: labels.dungeonLayers[layer.style]?.[0] ?? layer.style,
      visible: true,
      locked: false,
      opacity: 1,
      wallStyle: layer.style as WallStyle,
      hatchEnabled: true,
      environment: 'interior' as const,
      geometry: layer.geometry,
      standaloneWalls: [],
      texturePaints: [],
      roads: [],
    };
    return item;
  });
  await hooks.finish('doors');
  const corridorCells = corridorFloor.reduce((sum, value) => sum + value, 0);
  const floorCells = floor.reduce((sum, value) => sum + value, 0);
  const draft = packDraft(
    {
      layers: builtLayers,
      doors: doorItems,
      stairs: stair ? [stair] : [],
      jobs: [],
      props: dressed.props,
      labels: dressed.labels,
      walls: [],
      alive: rooms.length,
      target: Math.max(2, rooms.length),
    },
    rooms,
    [],
    profile,
    rooms[0]?.id
  );
  draft.metrics.corridorCells = corridorCells;
  draft.metrics.floorCells = floorCells;
  draft.metrics.rooms = rooms.length;
  draft.metrics.cycles = Math.max(0, corridorCells - floorCells);
  const verdict = acceptLayout('maze', draft.metrics);
  draft.accepted = verdict.ok;
  draft.score = verdict.score;
  return draft;
}

function clampIndex(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
