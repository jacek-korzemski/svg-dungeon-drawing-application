import type { Dir } from './grid';
import type { RoomKind } from './model';
import type { RoomRole } from './profiles';
import type { Rect } from '../types';

export type PlanEdgeKind = 'spine' | 'branch' | 'ring' | 'hub' | 'chord';

export interface PlannedRoom {
  block: Rect;
  role: RoomRole;
  group: number;
  sizeFraction: [number, number];
  weights?: Partial<Record<RoomKind, number>>;
}

export interface PlannedEdge {
  a: number;
  b: number;
  kind: PlanEdgeKind;
  width?: 1 | 2;
}

export interface GraphPlan {
  rooms: PlannedRoom[];
  edges: PlannedEdge[];
  entrance: number;
  exitEdge: Dir;
}
