import type { ConcreteArchetype, GenRoom, LayoutMetrics } from './model';

export function blankMetrics(target = 0): LayoutMetrics {
  return {
    rooms: 0,
    target,
    reachable: 0,
    links: 0,
    cycles: 0,
    deadEnds: 0,
    diameter: 0,
    maxDegree: 0,
    hubDegree: 0,
    ringRooms: 0,
    floorCells: 0,
    corridorCells: 0,
    floorRatio: 0,
  };
}

export function roomGraphMetrics(
  rooms: GenRoom[],
  links: { a: number; b: number }[],
  target: number,
  entranceId?: number
): LayoutMetrics {
  const alive = rooms.filter((room) => room.alive);
  const ids = new Set(alive.map((room) => room.id));
  const adj = new Map<number, number[]>();
  for (const id of ids) adj.set(id, []);
  let linkCount = 0;
  for (const link of links) {
    if (!ids.has(link.a) || !ids.has(link.b) || link.a === link.b) continue;
    adj.get(link.a)?.push(link.b);
    adj.get(link.b)?.push(link.a);
    linkCount += 1;
  }
  let components = 0;
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    components += 1;
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const current = stack.pop() as number;
      for (const next of adj.get(current) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
  }
  let diameter = 0;
  for (const start of ids) {
    const dist = new Map<number, number>([[start, 0]]);
    const queue = [start];
    while (queue.length) {
      const current = queue.shift() as number;
      const step = dist.get(current) ?? 0;
      if (step > diameter) diameter = step;
      for (const next of adj.get(current) ?? []) {
        if (dist.has(next)) continue;
        dist.set(next, step + 1);
        queue.push(next);
      }
    }
  }
  let deadEnds = 0;
  let maxDegree = 0;
  for (const [id, next] of adj) {
    if (next.length > maxDegree) maxDegree = next.length;
    if (next.length === 1 && id !== entranceId) deadEnds += 1;
  }
  return {
    ...blankMetrics(target),
    rooms: alive.length,
    reachable: alive.length,
    links: linkCount,
    cycles: Math.max(0, linkCount - alive.length + components),
    deadEnds,
    diameter,
    maxDegree,
  };
}

export function acceptLayout(arch: ConcreteArchetype, metrics: LayoutMetrics): { ok: boolean; score: number } {
  const checks: boolean[] = [];
  if (arch === 'classic') checks.push(metrics.rooms >= Math.max(1, metrics.target * 0.6));
  else if (arch === 'delve') {
    checks.push(metrics.rooms >= 4);
    checks.push(metrics.rooms > 0 && metrics.diameter >= 0.45 * metrics.rooms);
    checks.push(metrics.cycles <= 2);
  } else if (arch === 'hub') {
    checks.push(metrics.rooms >= 5);
    checks.push(metrics.hubDegree >= 3);
    checks.push(metrics.hubDegree === metrics.maxDegree);
  } else if (arch === 'ring') {
    checks.push(metrics.ringRooms >= 4);
    checks.push(metrics.cycles >= 1);
  } else if (arch === 'maze') {
    checks.push(metrics.corridorCells >= 1.2 * (metrics.floorCells - metrics.corridorCells));
    checks.push(metrics.rooms >= 2);
  } else {
    checks.push(metrics.floorRatio >= 0.22 && metrics.floorRatio <= 0.65);
    checks.push(metrics.rooms >= 3);
  }
  const passed = checks.filter(Boolean).length;
  const ratio = metrics.rooms > 0 ? metrics.reachable / metrics.rooms : 0;
  return { ok: checks.every(Boolean), score: passed + ratio };
}
