import { createEmptyLayer } from '../../../data/presets';
import { floorTextureByPath } from '../../../data/textureLibrary';
import { DoorItem, DungeonLayer, MultiPolygon2D, StairItem, WallStyle } from '../../../types/dungeon';
import { circleToPolygon, GRID_SIZE, subtractGeometry } from '../../geometry';
import { chance, pick, randInt, shuffle } from '../rng';
import { Junction, RandomMapLabels, Rect } from '../types';
import { dressDungeon } from './dress';
import { doorTypeFor, placeStairs } from './features';
import { reachableIds } from './graph';
import { Dir, Occupancy, opposite } from './grid';
import { acceptLayout, roomGraphMetrics } from './metrics';
import { ConcreteArchetype, DungeonDraft, DungeonRngs, EndInfo, GenRoom, Hooks, LayoutMetrics, Route } from './model';
import { asMulti, batchUnion, clipTo, pickName } from './poly';
import { DungeonProfile, RoomRole } from './profiles';
import { applyPartitions } from './roomFeatures';
import { assignRoles } from './roles';
import { buildRoutePoly } from './routing';
import { FLOOR_BY_STYLE } from './styles';

const G = GRID_SIZE;

export function packDraft(
  partial: Omit<DungeonDraft, 'archetype' | 'metrics' | 'accepted' | 'score' | 'sections'> & {
    sections?: ConcreteArchetype[];
  },
  rooms: GenRoom[],
  links: { a: number; b: number }[],
  profile: DungeonProfile,
  entranceId?: number
): DungeonDraft {
  const { sections, ...rest } = partial;
  const metrics = roomGraphMetrics(rooms, links, partial.target, entranceId);
  const verdict = acceptLayout(profile.archetype, metrics);
  return {
    ...rest,
    sections: sections?.length ? sections : [profile.archetype],
    archetype: profile.archetype,
    metrics,
    accepted: verdict.ok,
    score: verdict.score,
  };
}

export async function finalizeDungeon(input: {
  zone: Rect;
  junction: Junction | null;
  rooms: GenRoom[];
  occ: Occupancy;
  styles: WallStyle[];
  routes: Route[];
  links: { a: number; b: number }[];
  entrance: GenRoom;
  exitEdge: Dir;
  target: number;
  profile: DungeonProfile;
  rngs: DungeonRngs;
  id: (kind: string) => string;
  labels: RandomMapLabels;
  hooks: Hooks;
  preset?: Map<number, RoomRole>;
  patchMetrics?: (metrics: LayoutMetrics) => void;
}): Promise<DungeonDraft> {
  const { junction, rooms, occ, styles, routes, links, entrance, exitEdge, target, profile, rngs, id, labels, hooks, preset, patchMetrics } = input;
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
      if ((degree.get(end.room.id) ?? 0) === 1 && chance(rngs.doors, 0.4)) end.secret = true;
    }
  }
  for (const route of liveRoutes) {
    if (route.kind === 'loop' && chance(rngs.doors, 0.3)) {
      const ends = [route.endA, route.endB].filter((end): end is EndInfo => Boolean(end?.room && !end.cross && !end.cave));
      if (ends.length) pick(rngs.doors, ends).secret = true;
    }
    buildRoutePoly(route, styles, rngs.geometry);
  }
  assignRoles(rooms, links, entrance, rngs.dress, profile, preset);
  const partitions = applyPartitions(rooms, occ, styles, rngs.style);
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
    const layer = createEmptyLayer(layerId, pickName(rngs.names, labels.dungeonLayers[style] ?? [style], usedNames), 'interior');
    layer.wallStyle = style;
    layer.geometry = geometry;
    layer.hatchEnabled = true;
    layer.standaloneWalls = partitions.walls
      .filter((wall) => wall.layer === layerIndex)
      .map((wall) => ({ ...wall.wall, id: id('sw') }));
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
  for (const door of partitions.doors) addDoor(door);
  for (const route of liveRoutes) {
    for (const end of [route.endA, route.endB]) {
      if (!end) continue;
      const type = doorTypeFor(route, end, styles, rngs.doors);
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
  const jobs = [];
  for (const layer of layers) {
    const style = layer.wallStyle;
    const options = (FLOOR_BY_STYLE[style] ?? []).filter((path) => floorTextureByPath(path));
    if (options.length && layer.geometry.length) {
      jobs.push({ layerId: layer.id, path: pick(rngs.texture, options), softness: 0, region: layer.geometry, order: 0 });
    }
  }
  const rockLayer = layers.find((layer) => layer.wallStyle === 'rock');
  if (rockLayer) {
    const caves = rooms.filter((room) => room.alive && room.kind === 'cave' && layerIds[room.layer] === rockLayer.id);
    const puddlePath = ['woda-płytka.png', 'błoto.png'].find((path) => floorTextureByPath(path));
    if (puddlePath && caves.length) {
      const count = randInt(rngs.texture, 1, Math.min(2, caves.length));
      for (const cave of shuffle(rngs.texture, caves).slice(0, count)) {
        const radius = (0.8 + rngs.texture.next() * 0.4) * G;
        const circle = circleToPolygon((cave.rect.x + cave.rect.w / 2) * G, (cave.rect.y + cave.rect.h / 2) * G, radius, 12);
        const region = clipTo(asMulti(circle), rockLayer.geometry);
        if (region.length) jobs.push({ layerId: rockLayer.id, path: puddlePath, softness: 0.3, region, order: 10 });
      }
    }
  }
  const dressed = dressDungeon(rooms, occ, styles, links, entrance, liveRoutes, rngs.dress, id, labels, stairs, profile);
  await hooks.finish('doors');
  const draft = packDraft(
    {
      layers,
      doors,
      stairs,
      jobs,
      props: dressed.props,
      labels: dressed.labels,
      walls: partitions.walls,
      alive: rooms.filter((room) => room.alive).length,
      target,
    },
    rooms,
    links,
    profile,
    entrance.id
  );
  if (patchMetrics) {
    patchMetrics(draft.metrics);
    const verdict = acceptLayout(profile.archetype, draft.metrics);
    draft.accepted = verdict.ok;
    draft.score = verdict.score;
  }
  return draft;
}
