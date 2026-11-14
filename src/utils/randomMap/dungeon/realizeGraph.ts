import { Junction, Rect } from '../types';
import type { BuildContext } from './archetype';
import { finalizeDungeon } from './assemble';
import { linkJunction } from './features';
import { joinComponents } from './graph';
import { Occupancy } from './grid';
import { DungeonDraft, GenRoom, RoomKind, Route } from './model';
import { GraphPlan, PlanEdgeKind, PlannedEdge } from './plan';
import { DungeonProfile, RoomRole } from './profiles';
import { applyAlcovesAndChasms } from './roomFeatures';
import { makeRoom } from './rooms';
import { ConnectOpts, connectRooms } from './routing';
import { assignLayersByGroups, becomeCaves } from './styles';
import { computePorts, stampRooms } from './ports';
import { roomInBlock } from './layouts/coarseGrid';

const EDGE_RANK: Record<PlanEdgeKind, number> = { spine: 5, ring: 4, hub: 3, branch: 2, chord: 1 };
const ROUTE_ORDER: PlanEdgeKind[] = ['spine', 'ring', 'hub', 'branch', 'chord'];

function deadRoom(id: number, rect: Rect, role: RoomRole, group: number): GenRoom {
  return {
    id,
    rect,
    kind: 'rect',
    cells: new Set(),
    noPort: new Set(),
    pillarCells: [],
    pillars: [],
    islands: [],
    polygon: [],
    ports: [],
    layer: 0,
    role,
    group,
    reserved: new Set(),
    alive: false,
  };
}

function rewire(plan: GraphPlan, rooms: GenRoom[]) {
  const alive = new Set(rooms.filter((room) => room.alive).map((room) => room.id));
  const next: PlannedEdge[] = [];
  for (const edge of plan.edges) {
    if (alive.has(edge.a) && alive.has(edge.b)) next.push(edge);
  }
  for (const room of rooms) {
    if (room.alive) continue;
    const neighbors = plan.edges
      .map((edge) => (edge.a === room.id ? { id: edge.b, kind: edge.kind } : edge.b === room.id ? { id: edge.a, kind: edge.kind } : null))
      .filter((item): item is { id: number; kind: PlanEdgeKind } => Boolean(item && alive.has(item.id)));
    for (let i = 0; i < neighbors.length; i++) {
      for (let j = i + 1; j < neighbors.length; j++) {
        const left = neighbors[i];
        const right = neighbors[j];
        const kind = EDGE_RANK[left.kind] >= EDGE_RANK[right.kind] ? left.kind : right.kind;
        if (!next.some((edge) => (edge.a === left.id && edge.b === right.id) || (edge.a === right.id && edge.b === left.id))) {
          next.push({ a: left.id, b: right.id, kind });
        }
      }
    }
  }
  plan.edges = next;
  if (!rooms[plan.entrance]?.alive) {
    const edge = plan.exitEdge;
    let best = rooms.find((room) => room.alive);
    let bestDist = Infinity;
    for (const room of rooms) {
      if (!room.alive) continue;
      const dist =
        edge === 0 ? room.rect.y : edge === 2 ? -(room.rect.y + room.rect.h) : edge === 1 ? -(room.rect.x + room.rect.w) : room.rect.x;
      if (dist < bestDist) {
        bestDist = dist;
        best = room;
      }
    }
    if (best) plan.entrance = best.id;
  }
}

export async function realizeRoomGraph(plan: GraphPlan, ctx: BuildContext): Promise<DungeonDraft> {
  const { zone, junction, maxLayers, profile, rngs, id, labels, hooks } = ctx;
  await hooks.label('rooms');
  if (!plan.rooms.length) {
    await hooks.finish('rooms');
    return finalizeDungeon(emptyState(zone, junction, profile, rngs, id, labels, hooks, plan.exitEdge));
  }
  const occ = new Occupancy(zone);
  const rooms: GenRoom[] = [];
  const preset = new Map<number, RoomRole>();
  for (const planned of plan.rooms) {
    const weights = planned.weights ?? profile.roleKindWeights[planned.role] ?? profile.kindWeights;
    const rect = roomInBlock(planned.block, planned.sizeFraction, rngs.layout);
    const made = rect ? makeRoom(occ, rooms.length, rect, rngs.layout, weights as Partial<Record<RoomKind, number>>) : null;
    if (!made) rooms.push(deadRoom(rooms.length, rect ?? planned.block, planned.role, planned.group));
    else {
      made.role = planned.role;
      made.group = planned.group;
      rooms.push(made);
      if (planned.role !== 'normal') preset.set(made.id, planned.role);
    }
  }
  rewire(plan, rooms);
  const entrance = rooms[plan.entrance] ?? rooms.find((room) => room.alive) ?? rooms[0];
  if (!entrance) return finalizeDungeon(emptyState(zone, junction, profile, rngs, id, labels, hooks, plan.exitEdge));
  const styles = assignLayersByGroups(rooms, entrance, plan.edges.map((edge) => ({ a: edge.a, b: edge.b })), maxLayers, profile, rngs.style);
  becomeCaves(rooms, styles, occ, rngs.style, profile);
  applyAlcovesAndChasms(rooms, occ, styles, rngs.style, profile);
  stampRooms(occ, rooms);
  for (const room of rooms) room.ports = room.alive ? computePorts(room, occ) : [];
  await hooks.finish('rooms');
  await hooks.finish('layers');
  await hooks.label('corridors');
  const routes: Route[] = [];
  const links: { a: number; b: number }[] = [];
  const ringRooms = new Set<number>();
  for (const kind of ROUTE_ORDER) {
    for (const edge of plan.edges.filter((item) => item.kind === kind)) {
      const left = rooms[edge.a];
      const right = rooms[edge.b];
      if (!left?.alive || !right?.alive) continue;
      const required = kind !== 'chord';
      let route = connectRooms(occ, left, right, styles, required ? 'tree' : 'loop', rngs.route, profile.route, { required });
      if (!route) {
        const retry: ConnectOpts = { required, forceDiagonal: true, forceWidth: 1 };
        route = connectRooms(occ, left, right, styles, required ? 'tree' : 'loop', rngs.route, profile.route, retry);
      }
      if (!route) continue;
      routes.push(route);
      links.push({ a: left.id, b: right.id });
      if (kind === 'ring') {
        ringRooms.add(left.id);
        ringRooms.add(right.id);
      }
    }
  }
  joinComponents(rooms, occ, links, routes, entrance, styles, rngs.route, profile.route);
  if (junction && entrance.alive) {
    const linked = linkJunction(occ, entrance, junction, zone);
    if (linked) routes.push(linked);
  }
  const hub = rooms.find((room) => room.alive && room.role === 'hub');
  return finalizeDungeon({
    zone,
    junction,
    rooms,
    occ,
    styles,
    routes,
    links,
    entrance,
    exitEdge: plan.exitEdge,
    target: Math.max(plan.rooms.length, 1),
    profile,
    rngs,
    id,
    labels,
    hooks,
    preset,
    patchMetrics: (metrics) => {
      if (hub) {
        const degree = links.filter((link) => rooms[link.a]?.alive && rooms[link.b]?.alive && (link.a === hub.id || link.b === hub.id)).length;
        metrics.hubDegree = degree;
      }
      metrics.ringRooms = [...ringRooms].filter((roomId) => rooms[roomId]?.alive).length;
    },
  });
}

function emptyState(
  zone: Rect,
  junction: Junction | null,
  profile: DungeonProfile,
  rngs: BuildContext['rngs'],
  id: BuildContext['id'],
  labels: BuildContext['labels'],
  hooks: BuildContext['hooks'],
  exitEdge: GraphPlan['exitEdge']
) {
  const occ = new Occupancy(zone);
  const entrance = deadRoom(0, zone, 'entrance', 0);
  return {
    zone,
    junction,
    rooms: [entrance],
    occ,
    styles: assignLayersByGroups([entrance], entrance, [], 1, profile, rngs.style),
    routes: [],
    links: [],
    entrance,
    exitEdge,
    target: 1,
    profile,
    rngs,
    id,
    labels,
    hooks,
  };
}
