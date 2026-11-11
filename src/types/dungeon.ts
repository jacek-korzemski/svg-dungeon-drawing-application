export type WallStyle = 'straight' | 'rock' | 'brick' | 'double' | 'ruins';

export type LayerEnvironment = 'interior' | 'exterior';

export type BuildingStyle =
  | 'roof_tile'
  | 'roof_thatch'
  | 'roof_slate'
  | 'castle_wall'
  | 'palisade'
  | 'ruined_building';

export type RoadStyle = 'cobble' | 'dirt' | 'gravel' | 'wood_planks';

export type ExteriorWallStyle =
  | 'castle_crenellated'
  | 'palisade_logs'
  | 'stone_wall'
  | 'wood_fence'
  | 'hedge';

export type MapThemeId = 'classic' | 'parchment' | 'blueprint' | 'dark_vtt';

export interface MapTheme {
  id: MapThemeId;
  bgVoid: string;
  gridMajor: string;
  gridMinor: string;
  floorFill: string;
  floorGrid: string;
  inkStroke: string;
  hatchStroke: string;
  wallFill: string;
  accentLabel: string;
}

export type ToolType =
  | 'select'
  | 'room'
  | 'corridor'
  | 'cave'
  | 'polygon'
  | 'eraser'
  | 'wall'
  | 'door'
  | 'stairs'
  | 'prop'
  | 'label'
  | 'texture'
  | 'district'
  | 'pan';

export type EraserShape = 'rect' | 'polygon' | 'stroke';

export type DistrictDensity = 'sparse' | 'medium' | 'dense';

export type DistrictSizePreset = 'small' | 'medium' | 'large' | 'mixed';

export type DistrictAngleMode = 'random' | 'jitter' | 'aligned';

export type DistrictAreaShape = 'rect' | 'polygon';

export type DoorType =
  | 'standard'
  | 'double'
  | 'secret'
  | 'portcullis'
  | 'archway'
  | 'gatehouse'
  | 'wood_gate'
  | 'bridge_stone'
  | 'bridge_wood';

export type StairType = 'straight' | 'spiral' | 'wide';

export type SvgPropId =
  | 'barrel'
  | 'crate'
  | 'table'
  | 'throne'
  | 'chest'
  | 'bed'
  | 'bookshelf'
  | 'brazier'
  | 'altar'
  | 'sarcophagus'
  | 'pillar'
  | 'statue'
  | 'weapon_rack'
  | 'boulder'
  | 'campfire'
  | 'tree'
  | 'bush'
  | 'well';

export type PropCategoryId = 'furniture' | 'treasure' | 'nature';

// [polygonIdx][ringIdx][pointIdx] -> [x, y] in world pixels (GRID_SIZE = 64px = 1 square)
export type Point2D = [number, number];
export type Ring2D = Point2D[];
export type Polygon2D = Ring2D[];
export type MultiPolygon2D = Polygon2D[];

export interface StandaloneWall {
  id: string;
  points: Point2D[];
  wallStyle: WallStyle;
  thickness: number;
  /** Set on exterior layers: curtain wall, palisade, fence, or hedge. */
  exteriorWallStyle?: ExteriorWallStyle;
  /** Round towers or heavier posts on the vertices. */
  hasTowers?: boolean;
}

export interface ExteriorRoad {
  id: string;
  points: Point2D[];
  /** Ribbon width in world pixels. */
  width: number;
  style: RoadStyle;
  /** Buffered ribbon. The eraser trims this polygon. */
  polygon: MultiPolygon2D;
}

export type TextureBrushShape = 'round' | 'square' | 'spray';

export interface TextureDab {
  x: number;
  y: number;
  r: number;
}

/** One brush stroke or bucket fill. Later paints cover earlier ones. */
export interface TexturePaint {
  id: string;
  /** File name inside src/assets-textures, e.g. "trawa.png". */
  texturePath: string;
  /** 0 = hard edge, 1 = wide feather. */
  softness: number;
  kind: 'dabs' | 'fill';
  shape: TextureBrushShape | 'bucket';
  dabs: TextureDab[];
  /** Bucket result, or what remains after the eraser. */
  region: MultiPolygon2D;
}

export interface DungeonLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  wallStyle: WallStyle;
  hatchEnabled: boolean;
  floorColorOverride?: string;
  geometry: MultiPolygon2D;
  standaloneWalls: StandaloneWall[];
  texturePaints: TexturePaint[];
  /** Missing on older saves. Treat as a dungeon interior. */
  environment?: LayerEnvironment;
  /** Roof or fortification look used when environment is exterior. */
  buildingStyle?: BuildingStyle;
  roads?: ExteriorRoad[];
}

export interface DoorItem {
  id: string;
  x: number;
  y: number;
  rotation: number; // degrees
  type: DoorType;
  widthCells: number; // 1 or 2
  flipped?: boolean;
}

export interface StairItem {
  id: string;
  x: number;
  y: number;
  rotation: number; // degrees
  type: StairType;
  widthCells: number;
  lengthCells: number;
}

export interface PropItem {
  id: string;
  x: number;
  y: number;
  rotation: number; // degrees
  scale: number; // multiplier around baseSize
  flipX?: boolean;
  kind: 'svg' | 'png';
  svgPropId?: SvgPropId;
  /** Embedded pixels for a file the user uploaded. Library art uses assetPath instead. */
  pngDataUrl?: string;
  /** Path inside src/assets, e.g. "Domy/chata.png". Resolved to a URL at render time. */
  assetPath?: string;
  label: string;
  widthPx: number;
  heightPx: number;
}

export interface PropBrush {
  kind: 'svg' | 'png';
  svgPropId?: SvgPropId;
  pngDataUrl?: string;
  assetPath?: string;
  label: string;
  widthPx: number;
  heightPx: number;
}

export interface LabelItem {
  id: string;
  x: number;
  y: number;
  text: string;
  badgeNumber?: string; // e.g., "1", "2", "A"
  fontSize: number;
  rotation: number;
}

export type SelectedEntity =
  | { kind: 'door'; id: string }
  | { kind: 'stair'; id: string }
  | { kind: 'prop'; id: string }
  | { kind: 'label'; id: string }
  | { kind: 'wall'; layerId: string; id: string }
  | { kind: 'road'; layerId: string; id: string }
  | { kind: 'building'; layerId: string; polyIndex: number }
  | null;

export interface DungeonDocument {
  title: string;
  gridSize: number; // default 64px = 5ft
  feetPerCell: number; // default 5
  themeId: MapThemeId;
  showGrid: boolean;
  layers: DungeonLayer[];
  activeLayerId: string;
  doors: DoorItem[];
  stairs: StairItem[];
  props: PropItem[];
  labels: LabelItem[];
}

/** Older projects omit the field and stay dungeon interiors. */
export function layerEnvironment(layer: { environment?: LayerEnvironment }): LayerEnvironment {
  return layer.environment === 'exterior' ? 'exterior' : 'interior';
}

export function doorWidthCells(type: DoorType): number {
  switch (type) {
    case 'double':
    case 'gatehouse':
      return 2;
    case 'wood_gate':
      return 1.5;
    case 'bridge_stone':
    case 'bridge_wood':
      return 3;
    default:
      return 1;
  }
}
