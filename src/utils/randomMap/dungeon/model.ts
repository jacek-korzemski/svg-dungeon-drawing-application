import type {
  DoorItem,
  DungeonLayer,
  LabelItem,
  MultiPolygon2D,
  Point2D,
  Polygon2D,
  PropItem,
  StairItem,
  StandaloneWall,
} from '../../../types/dungeon';
import type { Rect, TextureJob } from '../types';
import type { Rng } from '../rng';
import type { Dir } from './grid';
import type { RoomRole } from './profiles';

export type RandomMapStage =
  | 'layout'
  | 'rooms'
  | 'layers'
  | 'corridors'
  | 'doors'
  | 'exterior'
  | 'textures'
  | 'finish';

export type RoomKind = 'rect' | 'hall' | 'octagon' | 'hexagon' | 'L' | 'T' | 'cave';

export type DungeonArchetype = 'auto' | 'classic' | 'delve' | 'hub' | 'ring' | 'maze' | 'cavern';
export type ConcreteArchetype = Exclude<DungeonArchetype, 'auto'>;

export interface DungeonRngs {
  layout: Rng;
  route: Rng;
  style: Rng;
  geometry: Rng;
  doors: Rng;
  dress: Rng;
  texture: Rng;
  names: Rng;
}

export interface LayoutMetrics {
  rooms: number;
  target: number;
  reachable: number;
  links: number;
  cycles: number;
  deadEnds: number;
  diameter: number;
  maxDegree: number;
  hubDegree: number;
  ringRooms: number;
  floorCells: number;
  corridorCells: number;
  floorRatio: number;
}

export interface Port {
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

export interface GenRoom {
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
  role: RoomRole;
  group: number;
  reserved: Set<number>;
  alive: boolean;
}

export interface EndInfo {
  room: GenRoom | null;
  into: Dir;
  x: number;
  y: number;
  cross: boolean;
  cave: boolean;
  secret: boolean;
  angleDeg?: number;
}

export interface Route {
  width: 1 | 2;
  layer: number;
  kind: 'tree' | 'loop' | 'link';
  endA: EndInfo;
  endB: EndInfo | null;
  axis: Point2D[];
  poly: MultiPolygon2D;
}

export interface DungeonDraft {
  layers: DungeonLayer[];
  doors: DoorItem[];
  stairs: StairItem[];
  jobs: TextureJob[];
  props: PropItem[];
  labels: LabelItem[];
  walls: { layer: number; wall: Omit<StandaloneWall, 'id'> }[];
  alive: number;
  target: number;
  archetype: ConcreteArchetype;
  /** Archetypes that actually landed. A pure map is a one-element list. */
  sections: ConcreteArchetype[];
  metrics: LayoutMetrics;
  accepted: boolean;
  score: number;
}

export interface Hooks {
  label: (stage: RandomMapStage) => Promise<void>;
  finish: (stage: RandomMapStage) => Promise<void>;
}
