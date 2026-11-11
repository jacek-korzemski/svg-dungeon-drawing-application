import {
  DoorItem,
  DungeonLayer,
  ExteriorRoad,
  Point2D,
  Polygon2D,
  PropItem,
  StandaloneWall,
} from '../../../types/dungeon';
import { Rng } from '../rng';
import {
  BuildingStyle,
  ExteriorPlan,
  ExteriorSites,
  IdFactory,
  PlacedBuilding,
  RandomMapLabels,
  Rect,
  RoadLine,
  TextureJob,
  Water,
} from '../types';
import { ExteriorGrid } from './grid';

export interface CastlePlan {
  outer: Polygon2D;
  courtyard: Polygon2D;
  gate: Point2D;
  center: Point2D;
}

export interface ExteriorCtx {
  zone: Rect;
  G: number;
  rng: Rng;
  id: IdFactory;
  labels: RandomMapLabels;
  useTextures: boolean;
  maxLayers: number;
  grid: ExteriorGrid;
  plan: ExteriorPlan;
  jobs: TextureJob[];
  doors: DoorItem[];
  walls: StandaloneWall[];
  buildings: Map<BuildingStyle, Polygon2D[]>;
  placed: PlacedBuilding[];
  props: PropItem[];
  water: Water | null;
  roads: RoadLine[];
  fallbackRoads: ExteriorRoad[];
  sites: ExteriorSites;
  zonePoly: Polygon2D;
  noise1: (x: number) => number;
  noise2: (x: number, y: number) => number;
  castle: CastlePlan | null;
  insideWall: Polygon2D | null;
  layers: DungeonLayer[];
  terrainId: string;
}

export function emptySites(): ExteriorSites {
  return {
    plaza: null,
    gates: [],
    crossings: [],
    tavern: null,
    groves: [],
    orchards: [],
    bogs: [],
    rocks: [],
    camp: null,
    cemetery: null,
  };
}
