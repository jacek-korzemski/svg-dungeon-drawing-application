import { chance, clamp, randInt, shuffle } from '../rng';
import { Junction, RandomMapLabels, Rect } from '../types';
import { finalizeDungeon, packDraft } from './assemble';
import { linkJunction } from './features';
import { componentsOf, hopDistance, joinComponents } from './graph';
import { delay, Dir } from './grid';
import { DungeonDraft, DungeonRngs, Hooks, Route } from './model';
import { computePorts, stampRooms } from './ports';
import { DungeonProfile } from './profiles';
import { applyAlcovesAndChasms } from './roomFeatures';
import { roomCenter } from './rooms';
import { connectRooms } from './routing';
import { assignLayers, becomeCaves } from './styles';
import { neighborEdges, placeRooms } from './layouts/bsp';

export async function buildClassic(
  zone: Rect,
  junction: Junction | null,
  maxLayers: number,
  rngs: DungeonRngs,
  id: (kind: string) => string,
  labels: RandomMapLabels,
  hooks: Hooks,
  profile: DungeonProfile
): Promise<DungeonDraft> {
  await hooks.label('rooms');
  const splitRange: [number, number] = chance(rngs.layout, 0.5) ? [0.4, 0.6] : [0.28, 0.72];
  const placed = placeRooms(zone, rngs.layout, profile, splitRange);
  const { rooms, occ, target } = placed;
  await hooks.finish('rooms');
  await hooks.label('layers');
  if (!rooms.length) {
    await hooks.finish('layers');
    await hooks.label('corridors');
    await hooks.finish('corridors');
    await hooks.label('doors');
    await hooks.finish('doors');
    return packDraft({ layers: [], doors: [], stairs: [], jobs: [], props: [], labels: [], walls: [], alive: 0, target }, [], [], profile);
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
    exitEdge = randInt(rngs.layout, 0, 3) as Dir;
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
  const styles = assignLayers(rooms, entrance, edges, clamp(Math.round(maxLayers), 1, 4), rngs.style, profile);
  becomeCaves(rooms, styles, occ, rngs.style, profile);
  applyAlcovesAndChasms(rooms, occ, styles, rngs.style, profile);
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
    const route = connectRooms(occ, left, right, styles, 'tree', rngs.route, profile.route);
    if (route) {
      routes.push(route);
      links.push({ a: left.id, b: right.id });
    }
    if (++routed % 4 === 0) await delay();
  }
  joinComponents(rooms, occ, links, routes, entrance, styles, rngs.route, profile.route);
  const loopTarget = Math.round(profile.loopRate * rooms.filter((room) => room.alive).length);
  const loopEdges = shuffle(
    rngs.route,
    edges.filter((edge) => rooms[edge.a].alive && rooms[edge.b].alive && hopDistance(rooms, links, edge.a, edge.b) >= profile.loopMinHops)
  );
  let loops = 0;
  for (const edge of loopEdges) {
    if (loops >= loopTarget) break;
    if (hopDistance(rooms, links, edge.a, edge.b) < profile.loopMinHops) continue;
    const route = connectRooms(occ, rooms[edge.a], rooms[edge.b], styles, 'loop', rngs.route, profile.route);
    if (!route) continue;
    routes.push(route);
    links.push({ a: edge.a, b: edge.b });
    loops += 1;
  }
  if (junction && entrance.alive) {
    const linked = linkJunction(occ, entrance, junction, zone);
    if (linked) routes.push(linked);
  }
  return finalizeDungeon({ zone, junction, rooms, occ, styles, routes, links, entrance, exitEdge, target, profile, rngs, id, labels, hooks });
}
