import {
  BuildingStyle,
  DoorType,
  ExteriorWallStyle,
  MultiPolygon2D,
  Point2D,
  Polygon2D,
  SvgPropId,
  WallStyle,
} from '../../types/dungeon';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Junction {
  point: Point2D;
  xLine: number;
  yCell: number;
  /** +1 when the dungeon sits at a greater x than the junction. */
  dungeonSign: 1 | -1;
}

export interface TextureJob {
  layerId: string;
  path: string;
  softness: number;
  region: MultiPolygon2D;
  /** Lower paints first. Same path at different orders must not collapse together. */
  order: number;
}

export type IdFactory = (kind: string) => string;

export interface RandomMapLabels {
  titlesDungeon: string[];
  titlesExterior: string[];
  titlesMixed: string[];
  dungeonLayers: Record<WallStyle, string[]>;
  exteriorLayers: {
    terrain: string[];
    roads: string[];
    castle_wall: string[];
    roof_tile: string[];
    roof_slate: string[];
    roof_thatch: string[];
    walls: string[];
    ruined_building: string[];
  };
  props: Record<SvgPropId, string>;
}

export type Biome = 'temperate' | 'autumn' | 'winter' | 'wetland' | 'dry';
export type Archetype = 'market_town' | 'river_crossing' | 'castle_bailey' | 'crossroads_hamlets';
export type WallMode = 'none' | 'core' | 'partial' | 'ruined' | 'full';
export type RoadClass = 'main' | 'secondary' | 'lane';

export interface BiomePalette {
  base: string;
  patches: string[];
  field: string[];
  fallow: string;
  yard: string;
  bar: string;
  shallow: string;
  deep: string;
  frozen: boolean;
  rock: string;
  urban: string[];
  track: string;
  path: string[];
  litter: string;
  bog: string[];
}

export interface RoadEntry {
  point: Point2D;
  kind: 'edge' | 'junction';
  edge: 'n' | 'e' | 's' | 'w';
}

export interface ExteriorPlan {
  biome: Biome;
  palette: BiomePalette;
  archetype: Archetype;
  wallMode: WallMode;
  hasRiver: boolean;
  center: Point2D;
  coreRadius: number;
  entries: RoadEntry[];
  junction: Junction | null;
  scale: number;
  /** Dungeon-facing edge. Rivers and extra road entries stay off it. */
  blockedEdge: 'n' | 'e' | 's' | 'w' | null;
  castleAt: Point2D | null;
  wantCastle: boolean;
}

export interface RibbonSample {
  p: Point2D;
  left: number;
  right: number;
}

export interface Channel {
  samples: RibbonSample[];
  kind: 'main' | 'tributary' | 'branch';
}

export interface Water {
  channels: Channel[];
  ponds: Polygon2D[];
  pondShallow: Polygon2D[];
  deep: MultiPolygon2D;
  shallow: MultiPolygon2D;
  bars: MultiPolygon2D;
  blocked: Polygon2D[];
  /** Narrow, straight places where a bridge fits. */
  crossings: Point2D[];
  island: Point2D | null;
}

export interface RoadLine {
  id: string;
  klass: RoadClass;
  points: Point2D[];
  polygon: MultiPolygon2D;
  length: number;
  halfWidth: number;
}

export interface GateSite {
  x: number;
  y: number;
  inside: Point2D;
  angle: number;
}

export interface PlacedBuilding {
  poly: Polygon2D;
  center: Point2D;
  angle: number;
  front: number;
  depth: number;
  away: Point2D;
  zone: 'core' | 'suburb' | 'rural';
  style: BuildingStyle;
}

export interface ExteriorSites {
  plaza: Polygon2D | null;
  gates: GateSite[];
  crossings: Point2D[];
  tavern: { center: Point2D; angle: number } | null;
  groves: Polygon2D[];
  orchards: Point2D[];
  bogs: Polygon2D[];
  rocks: Polygon2D[];
  camp: Point2D | null;
  cemetery: Polygon2D | null;
}

export interface WallChain {
  points: Point2D[];
  style: ExteriorWallStyle;
  thickness: number;
  towers: boolean;
}

export type { BuildingStyle, DoorType, Point2D, Polygon2D, MultiPolygon2D };
