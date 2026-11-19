import {
  BUILDING_STYLE_OPTIONS,
  createEmptyLayer,
  DOOR_TYPE_OPTIONS,
  MAP_THEMES,
  STAIR_TYPE_OPTIONS,
  SVG_PROP_CATALOG,
  WALL_STYLE_OPTIONS,
} from '../data/presets';
import { pl } from '../i18n/pl';
import {
  doorWidthCells,
  layerEnvironment,
  type AuthoredCorridor,
  type AuthoredRoom,
  type BuildingStyle,
  type DoorItem,
  type DoorType,
  type DungeonDocument,
  type DungeonLayer,
  type ExteriorWallStyle,
  type LabelItem,
  type LayerEnvironment,
  type MapAuthoring,
  type MapNote,
  type MapThemeId,
  type MultiPolygon2D,
  type Point2D,
  type PropItem,
  type RoadStyle,
  type StairItem,
  type StairType,
  type SvgPropId,
  type TexturePaint,
  type WallStyle,
} from '../types/dungeon';
import { computeDocumentBounds } from '../utils/exportDungeon';
import {
  computeElbowPath,
  corridorPathToMultiPolygon,
  GRID_SIZE,
  inkScale,
  rectToPolygon,
  subtractGeometry,
  unionGeometry,
} from '../utils/geometry';
import { MAX_GRID_SIZE, MIN_GRID_SIZE } from '../utils/scaleDocument';

export class DocumentOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentOpError';
  }
}

export type IdFactory = (kind: string) => string;

export interface OpOptions {
  ids?: IdFactory;
  /** File names from src/assets-textures. Empty skips the check. */
  knownTextures?: string[];
}

export interface RoomInput {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  layer?: string;
  name?: string;
  number?: string | number;
  floorTexture?: string;
}

export interface CorridorInput {
  id?: string;
  layer?: string;
  from?: string;
  to?: string;
  /** Vertices in cells. Used instead of from/to when at least two points are set. */
  points?: Array<[number, number]>;
  widthCells?: number;
  horizontalFirst?: boolean;
}

export interface DoorInput {
  id?: string;
  type?: DoorType;
  x?: number;
  y?: number;
  rotation?: number;
  between?: [string, string];
  flipped?: boolean;
}

export interface StairInput {
  id?: string;
  type?: StairType;
  x: number;
  y: number;
  rotation?: number;
  widthCells?: number;
  lengthCells?: number;
}

export interface PropInput {
  id?: string;
  propId: SvgPropId;
  x: number;
  y: number;
  rotation?: number;
  scale?: number;
}

export interface LabelInput {
  id?: string;
  x: number;
  y: number;
  text?: string;
  number?: string | number;
  fontSize?: number;
  rotation?: number;
}

export interface LayerInput {
  id: string;
  name: string;
  environment?: LayerEnvironment;
  wallStyle?: WallStyle;
  buildingStyle?: BuildingStyle;
}

export interface BuildMapInput {
  title: string;
  themeId?: MapThemeId;
  feetPerCell?: number;
  gridSize?: number;
  showGrid?: boolean;
  layers?: LayerInput[];
  rooms?: RoomInput[];
  corridors?: CorridorInput[];
  doors?: DoorInput[];
  stairs?: StairInput[];
  props?: PropInput[];
  labels?: LabelInput[];
}

export interface MapSummary {
  title: string;
  themeId: MapThemeId;
  gridSize: number;
  feetPerCell: number;
  showGrid: boolean;
  activeLayerId: string;
  boundsCells: { x: number; y: number; w: number; h: number };
  layers: Array<{ id: string; name: string; environment: LayerEnvironment; wallStyle: WallStyle }>;
  rooms: AuthoredRoom[];
  corridors: AuthoredCorridor[];
  doors: Array<{
    id: string;
    x: number;
    y: number;
    rotation: number;
    type: DoorType;
    between?: [string, string];
  }>;
  stairs: Array<{ id: string; x: number; y: number; rotation: number; type: StairType }>;
  props: Array<{ id: string; propId?: SvgPropId; x: number; y: number; rotation: number; label: string }>;
  labels: Array<{ id: string; x: number; y: number; text: string; number?: string }>;
  warnings: MapNote[];
}

export interface MapOpResult {
  doc: DungeonDocument;
  summary: MapSummary;
}

export interface Catalog {
  themes: MapThemeId[];
  doorTypes: DoorType[];
  stairTypes: StairType[];
  wallStyles: WallStyle[];
  buildingStyles: BuildingStyle[];
  props: Array<{ id: SvgPropId; category: string; widthPx: number; heightPx: number; label: string }>;
  textures: string[];
  coordinates: string;
}

const COORDINATES =
  'Komórki: x w prawo, y w dół, lewy górny róg pokoju. Środek rekwizytu i drzwi podaje się w kratkach, nie w pikselach. 1 kratka = gridSize pikseli (domyślnie 64) i feetPerCell stóp (domyślnie 5).';

export function createEntityId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function listCatalog(textures: string[] = []): Catalog {
  return {
    themes: Object.keys(MAP_THEMES) as MapThemeId[],
    doorTypes: [...DOOR_TYPE_OPTIONS],
    stairTypes: [...STAIR_TYPE_OPTIONS],
    wallStyles: [...WALL_STYLE_OPTIONS],
    buildingStyles: BUILDING_STYLE_OPTIONS.map((option) => option.id),
    props: SVG_PROP_CATALOG.map((entry) => ({
      id: entry.id,
      category: entry.category,
      widthPx: entry.widthPx,
      heightPx: entry.heightPx,
      label: pl.props[entry.id],
    })),
    textures: [...textures],
    coordinates: COORDINATES,
  };
}

export function parseDocument(value: unknown): DungeonDocument {
  if (!value || typeof value !== 'object') {
    throw new DocumentOpError('Plik mapy nie jest obiektem JSON.');
  }
  const doc = value as DungeonDocument;
  if (typeof doc.title !== 'string' || !Array.isArray(doc.layers)) {
    throw new DocumentOpError('Plik mapy nie zawiera tytułu i warstw.');
  }
  return doc;
}

export function carveFloor(
  doc: DungeonDocument,
  polygonOrMulti: MultiPolygon2D,
  mode: 'add' | 'subtract',
  layerId = doc.activeLayerId
): DungeonDocument {
  return {
    ...doc,
    layers: doc.layers.map((layer) => {
      if (layer.id !== layerId) return layer;
      const geometry =
        mode === 'add'
          ? unionGeometry(layer.geometry, polygonOrMulti)
          : subtractGeometry(layer.geometry, polygonOrMulti);
      return { ...layer, visible: true, geometry };
    }),
  };
}

export function addStandaloneWall(
  doc: DungeonDocument,
  points: Point2D[],
  options?: {
    exteriorWallStyle?: ExteriorWallStyle;
    hasTowers?: boolean;
    layerId?: string;
    id?: string;
  }
): DungeonDocument {
  const layerId = options?.layerId ?? doc.activeLayerId;
  return {
    ...doc,
    layers: doc.layers.map((layer) => {
      if (layer.id !== layerId) return layer;
      const exterior = layerEnvironment(layer) === 'exterior';
      return {
        ...layer,
        standaloneWalls: [
          ...layer.standaloneWalls,
          {
            id: options?.id ?? createEntityId('sw'),
            points,
            wallStyle: layer.wallStyle,
            thickness: exterior ? 14 : 8,
            ...(exterior
              ? { exteriorWallStyle: options?.exteriorWallStyle, hasTowers: options?.hasTowers }
              : {}),
          },
        ],
      };
    }),
  };
}

export function addRoad(
  doc: DungeonDocument,
  points: Point2D[],
  width: number,
  style: RoadStyle,
  layerId = doc.activeLayerId
): DungeonDocument {
  const polygon = corridorPathToMultiPolygon(points, width);
  if (!polygon.length) return doc;
  return {
    ...doc,
    layers: doc.layers.map((layer) => {
      if (layer.id !== layerId || layerEnvironment(layer) !== 'exterior') return layer;
      return {
        ...layer,
        roads: [
          ...(layer.roads ?? []),
          {
            id: createEntityId('rd'),
            points,
            width,
            style,
            polygon,
          },
        ],
      };
    }),
  };
}

export function placeDoor(
  doc: DungeonDocument,
  door: Omit<DoorItem, 'id'>,
  id = createEntityId('dr')
): DungeonDocument {
  return { ...doc, doors: [...doc.doors, { ...door, id }] };
}

export function placeStair(
  doc: DungeonDocument,
  stair: Omit<StairItem, 'id'>,
  id = createEntityId('st')
): DungeonDocument {
  return { ...doc, stairs: [...doc.stairs, { ...stair, id }] };
}

export function placeProp(
  doc: DungeonDocument,
  prop: Omit<PropItem, 'id'>,
  id = createEntityId('pr')
): DungeonDocument {
  return { ...doc, props: [...doc.props, { ...prop, id }] };
}

export function placeLabel(
  doc: DungeonDocument,
  label: Omit<LabelItem, 'id'>,
  id = createEntityId('lb')
): DungeonDocument {
  return { ...doc, labels: [...doc.labels, { ...label, id }] };
}

export function buildMap(input: BuildMapInput, options?: OpOptions): MapOpResult {
  let doc = blankDocument(input);
  doc = addRooms(doc, input.rooms ?? [], options).doc;
  doc = addCorridors(doc, input.corridors ?? [], options).doc;
  doc = addLabels(doc, input.labels ?? [], options).doc;
  doc = addStairs(doc, input.stairs ?? [], options).doc;
  doc = addProps(doc, input.props ?? [], options).doc;
  doc = addDoors(doc, input.doors ?? [], options).doc;
  return { doc, summary: summarizeMap(doc) };
}

export function addRooms(doc: DungeonDocument, rooms: RoomInput[], options?: OpOptions): MapOpResult {
  let next = ensureAuthoring(doc);
  const notes: MapNote[] = [];
  for (const room of rooms) {
    const placed = placeRoom(next, room, options);
    next = placed.doc;
    notes.push(...placed.notes);
  }
  return finish(next, notes);
}

export function addCorridors(
  doc: DungeonDocument,
  corridors: CorridorInput[],
  options?: OpOptions
): MapOpResult {
  let next = ensureAuthoring(doc);
  const notes: MapNote[] = [];
  for (const corridor of corridors) {
    const placed = placeCorridor(next, corridor, options);
    next = placed.doc;
    notes.push(...placed.notes);
  }
  return finish(next, notes);
}

export function addDoors(doc: DungeonDocument, doors: DoorInput[], options?: OpOptions): MapOpResult {
  let next = ensureAuthoring(doc);
  const notes: MapNote[] = [];
  for (const door of doors) {
    const placed = placeDoorInput(next, door, options);
    next = placed.doc;
    notes.push(...placed.notes);
  }
  return finish(next, notes);
}

export function addStairs(doc: DungeonDocument, stairs: StairInput[], options?: OpOptions): MapOpResult {
  let next = ensureAuthoring(doc);
  for (const stair of stairs) {
    next = placeStairInput(next, stair, options);
  }
  return finish(next, []);
}

export function addProps(doc: DungeonDocument, props: PropInput[], options?: OpOptions): MapOpResult {
  let next = ensureAuthoring(doc);
  const notes: MapNote[] = [];
  for (const prop of props) {
    const placed = placePropInput(next, prop, options);
    next = placed.doc;
    notes.push(...placed.notes);
  }
  return finish(next, notes);
}

export function addLabels(doc: DungeonDocument, labels: LabelInput[], options?: OpOptions): MapOpResult {
  let next = ensureAuthoring(doc);
  for (const label of labels) {
    next = placeLabelInput(next, label, options);
  }
  return finish(next, []);
}

export function setMapMeta(
  doc: DungeonDocument,
  meta: { title?: string; themeId?: MapThemeId; feetPerCell?: number; showGrid?: boolean }
): MapOpResult {
  const next: DungeonDocument = { ...doc };
  if (meta.title !== undefined) {
    const title = meta.title.trim();
    if (!title) throw new DocumentOpError('Tytuł mapy nie może być pusty.');
    next.title = title;
  }
  if (meta.themeId !== undefined) {
    assertTheme(meta.themeId);
    next.themeId = meta.themeId;
  }
  if (meta.feetPerCell !== undefined) {
    if (!Number.isFinite(meta.feetPerCell) || meta.feetPerCell <= 0) {
      throw new DocumentOpError('feetPerCell musi być liczbą większą od zera.');
    }
    next.feetPerCell = meta.feetPerCell;
  }
  if (meta.showGrid !== undefined) next.showGrid = meta.showGrid;
  return finish(next, []);
}

export function withVisibleLayers(doc: DungeonDocument, layerIds: string[]): DungeonDocument {
  if (layerIds.length === 0) throw new DocumentOpError('Lista warstw do eksportu jest pusta.');
  const known = new Set(doc.layers.map((layer) => layer.id));
  for (const id of layerIds) {
    if (!known.has(id)) throw new DocumentOpError(`Warstwa „${id}” nie istnieje.`);
  }
  const keep = new Set(layerIds);
  return {
    ...doc,
    layers: doc.layers.map((layer) => ({ ...layer, visible: keep.has(layer.id) })),
  };
}

export function summarizeMap(doc: DungeonDocument): MapSummary {
  const grid = doc.gridSize || GRID_SIZE;
  const authoring = doc.authoring ?? emptyAuthoring();
  const bounds = computeDocumentBounds(doc);
  const overlaps = overlapNotes(authoring.rooms);
  return {
    title: doc.title,
    themeId: doc.themeId,
    gridSize: grid,
    feetPerCell: doc.feetPerCell,
    showGrid: doc.showGrid,
    activeLayerId: doc.activeLayerId,
    boundsCells: {
      x: toCells(bounds.x, grid),
      y: toCells(bounds.y, grid),
      w: toCells(bounds.width, grid),
      h: toCells(bounds.height, grid),
    },
    layers: doc.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      environment: layerEnvironment(layer),
      wallStyle: layer.wallStyle,
    })),
    rooms: authoring.rooms.map((room) => ({ ...room })),
    corridors: authoring.corridors.map((corridor) => ({
      ...corridor,
      points: corridor.points.map((point) => [point[0], point[1]] as Point2D),
    })),
    doors: doc.doors.map((door) => ({
      id: door.id,
      x: toCells(door.x, grid),
      y: toCells(door.y, grid),
      rotation: door.rotation,
      type: door.type,
      ...(authoring.doorLinks[door.id] ? { between: authoring.doorLinks[door.id] } : {}),
    })),
    stairs: doc.stairs.map((stair) => ({
      id: stair.id,
      x: toCells(stair.x, grid),
      y: toCells(stair.y, grid),
      rotation: stair.rotation,
      type: stair.type,
    })),
    props: doc.props.map((prop) => ({
      id: prop.id,
      propId: prop.svgPropId,
      x: toCells(prop.x, grid),
      y: toCells(prop.y, grid),
      rotation: prop.rotation,
      label: prop.label,
    })),
    labels: doc.labels.map((label) => ({
      id: label.id,
      x: toCells(label.x, grid),
      y: toCells(label.y, grid),
      text: label.text,
      ...(label.badgeNumber ? { number: label.badgeNumber } : {}),
    })),
    warnings: [...overlaps, ...authoring.notes],
  };
}

function blankDocument(input: BuildMapInput): DungeonDocument {
  const title = input.title?.trim() ?? '';
  if (!title) throw new DocumentOpError('Tytuł mapy nie może być pusty.');
  const themeId = input.themeId ?? 'classic';
  assertTheme(themeId);
  const gridSize = input.gridSize ?? GRID_SIZE;
  if (!Number.isFinite(gridSize) || gridSize < MIN_GRID_SIZE || gridSize > MAX_GRID_SIZE) {
    throw new DocumentOpError(`gridSize musi być liczbą od ${MIN_GRID_SIZE} do ${MAX_GRID_SIZE}.`);
  }
  const feetPerCell = input.feetPerCell ?? 5;
  if (!Number.isFinite(feetPerCell) || feetPerCell <= 0) {
    throw new DocumentOpError('feetPerCell musi być liczbą większą od zera.');
  }
  const layerInputs =
    input.layers && input.layers.length > 0
      ? input.layers
      : [{ id: 'layer-main', name: 'Główny Loch', environment: 'interior' as const }];
  const seen = new Set<string>();
  const layers = layerInputs.map((layer) => {
    if (!layer.id?.trim() || !layer.name?.trim()) {
      throw new DocumentOpError('Każda warstwa potrzebuje id i nazwy.');
    }
    if (seen.has(layer.id)) throw new DocumentOpError(`Id warstwy „${layer.id}” jest już użyte.`);
    seen.add(layer.id);
    return makeLayer(layer);
  });
  return {
    title,
    gridSize,
    feetPerCell,
    themeId,
    showGrid: input.showGrid ?? true,
    layers,
    activeLayerId: layers[0].id,
    doors: [],
    stairs: [],
    props: [],
    labels: [],
    authoring: emptyAuthoring(),
  };
}

function makeLayer(input: LayerInput): DungeonLayer {
  const environment = input.environment ?? 'interior';
  if (environment !== 'interior' && environment !== 'exterior') {
    throw new DocumentOpError(`Nieznane środowisko warstwy „${String(input.environment)}”.`);
  }
  const layer = createEmptyLayer(input.id, input.name.trim(), environment);
  if (input.wallStyle) {
    if (!WALL_STYLE_OPTIONS.includes(input.wallStyle)) {
      throw new DocumentOpError(`Nieznany styl ścian „${input.wallStyle}”.`);
    }
    layer.wallStyle = input.wallStyle;
  }
  if (input.buildingStyle) {
    if (!BUILDING_STYLE_OPTIONS.some((option) => option.id === input.buildingStyle)) {
      throw new DocumentOpError(`Nieznany styl zabudowy „${input.buildingStyle}”.`);
    }
    layer.buildingStyle = input.buildingStyle;
  }
  return layer;
}

function placeRoom(
  doc: DungeonDocument,
  room: RoomInput,
  options?: OpOptions
): { doc: DungeonDocument; notes: MapNote[] } {
  const id = requireId(room.id, 'pokoju');
  assertFreshId(doc, id);
  const x = requireFinite(room.x, `x pokoju „${id}”`);
  const y = requireFinite(room.y, `y pokoju „${id}”`);
  const w = requireFinite(room.w, `szerokość pokoju „${id}”`);
  const h = requireFinite(room.h, `wysokość pokoju „${id}”`);
  if (w <= 0 || h <= 0) throw new DocumentOpError(`Pokój „${id}” musi mieć dodatnią szerokość i wysokość.`);
  const layerId = room.layer ?? doc.activeLayerId;
  requireLayer(doc, layerId);
  const grid = doc.gridSize || GRID_SIZE;
  const polygon = rectToPolygon(x * grid, y * grid, (x + w) * grid, (y + h) * grid);
  if (!polygon.length) throw new DocumentOpError(`Pokój „${id}” jest za mały, żeby go narysować.`);
  let next = carveFloor(doc, [polygon], 'add', layerId);
  const authored: AuthoredRoom = {
    id,
    layerId,
    x,
    y,
    w,
    h,
    ...(room.name?.trim() ? { name: room.name.trim() } : {}),
    ...(room.number !== undefined && String(room.number).trim() ? { number: String(room.number).trim() } : {}),
  };
  const notes: MapNote[] = [];
  if (room.floorTexture?.trim()) {
    const texturePath = room.floorTexture.trim();
    if (options?.knownTextures && options.knownTextures.length > 0 && !options.knownTextures.includes(texturePath)) {
      notes.push({
        code: 'unknown-texture',
        message: `Tekstura „${texturePath}” nie leży w src/assets-textures. Zostanie zapisana, ale edytor może jej nie pokazać.`,
      });
    }
    const paint: TexturePaint = {
      id: takeId(options, 'tp'),
      texturePath,
      softness: 0.08,
      kind: 'fill',
      shape: 'bucket',
      dabs: [],
      region: [polygon],
    };
    next = {
      ...next,
      layers: next.layers.map((layer) =>
        layer.id === layerId ? { ...layer, texturePaints: [...(layer.texturePaints ?? []), paint] } : layer
      ),
    };
  }
  if (authored.name || authored.number) {
    next = placeLabel(
      next,
      {
        x: (x + w / 2) * grid,
        y: (y + h / 2) * grid,
        text: authored.name ?? '',
        badgeNumber: authored.number,
        fontSize: 13 * inkScale(grid),
        rotation: 0,
      },
      takeId(options, 'lb')
    );
  }
  next = {
    ...next,
    authoring: {
      ...mustAuthoring(next),
      rooms: [...mustAuthoring(next).rooms, authored],
    },
  };
  return { doc: next, notes };
}

function placeCorridor(
  doc: DungeonDocument,
  corridor: CorridorInput,
  options?: OpOptions
): { doc: DungeonDocument; notes: MapNote[] } {
  const authoring = mustAuthoring(doc);
  const from = corridor.from ? findRoom(authoring, corridor.from) : undefined;
  const to = corridor.to ? findRoom(authoring, corridor.to) : undefined;
  if (corridor.from && !from) throw new DocumentOpError(`Korytarz wskazuje nieznany pokój „${corridor.from}”.`);
  if (corridor.to && !to) throw new DocumentOpError(`Korytarz wskazuje nieznany pokój „${corridor.to}”.`);
  let cellPoints: Point2D[];
  if (corridor.points && corridor.points.length >= 2) {
    cellPoints = corridor.points.map((point, index) => [
      requireFinite(point[0], `x punktu ${index + 1} korytarza`),
      requireFinite(point[1], `y punktu ${index + 1} korytarza`),
    ]);
  } else if (from && to) {
    cellPoints = elbowBetween(roomCenter(from), roomCenter(to), corridor.horizontalFirst);
  } else {
    throw new DocumentOpError('Korytarz potrzebuje from i to albo co najmniej dwóch punktów.');
  }
  const widthCells = corridor.widthCells ?? 1;
  if (!Number.isFinite(widthCells) || widthCells <= 0) {
    throw new DocumentOpError('Szerokość korytarza musi być liczbą większą od zera.');
  }
  const layerId = corridor.layer ?? from?.layerId ?? doc.activeLayerId;
  requireLayer(doc, layerId);
  const grid = doc.gridSize || GRID_SIZE;
  const pixelPoints = cellPoints.map((point) => [point[0] * grid, point[1] * grid] as Point2D);
  const polygon = corridorPathToMultiPolygon(pixelPoints, widthCells * grid);
  if (!polygon.length) throw new DocumentOpError('Korytarz nie utworzył geometrii.');
  const id = corridor.id?.trim() || takeId(options, 'cor');
  assertFreshId(doc, id);
  const notes: MapNote[] = [];
  if (from && to && from.layerId !== to.layerId) {
    notes.push({
      code: 'corridor-cross-layer',
      message: `Korytarz „${id}” łączy pokoje z różnych warstw. Geometria leży na warstwie „${layerId}”.`,
    });
  }
  const authored: AuthoredCorridor = {
    id,
    layerId,
    ...(corridor.from ? { from: corridor.from } : {}),
    ...(corridor.to ? { to: corridor.to } : {}),
    points: cellPoints,
    widthCells,
  };
  const next = carveFloor(doc, polygon, 'add', layerId);
  return {
    doc: {
      ...next,
      authoring: {
        ...mustAuthoring(next),
        corridors: [...mustAuthoring(next).corridors, authored],
      },
    },
    notes,
  };
}

function placeDoorInput(
  doc: DungeonDocument,
  door: DoorInput,
  options?: OpOptions
): { doc: DungeonDocument; notes: MapNote[] } {
  const type = door.type ?? 'standard';
  if (!DOOR_TYPE_OPTIONS.includes(type)) {
    throw new DocumentOpError(`Nieznany typ drzwi „${String(door.type)}”. Użyj list_catalog.`);
  }
  const grid = doc.gridSize || GRID_SIZE;
  const id = door.id?.trim() || takeId(options, 'dr');
  assertFreshId(doc, id);
  let x: number;
  let y: number;
  let rotation: number;
  const notes: MapNote[] = [];
  let between: [string, string] | undefined;
  if (door.between) {
    const [leftId, rightId] = door.between;
    const left = findRoom(mustAuthoring(doc), leftId);
    const right = findRoom(mustAuthoring(doc), rightId);
    if (!left || !right) {
      throw new DocumentOpError(`Drzwi between wskazują nieznany pokój „${left ? rightId : leftId}”.`);
    }
    between = [left.id, right.id];
    const shared = sharedEdge(left, right);
    if (shared) {
      x = shared.x * grid;
      y = shared.y * grid;
      rotation = shared.rotation;
    } else {
      const corridor = connectingCorridor(mustAuthoring(doc), left, right);
      if (corridor) {
        const mid = pathMidpoint(corridor.points.map((point) => [point[0] * grid, point[1] * grid]));
        x = mid.x;
        y = mid.y;
        rotation = mid.rotation;
        notes.push({
          code: 'door-on-corridor',
          message: `Pokoje „${left.id}” i „${right.id}” nie mają wspólnej ściany. Drzwi ustawiono na środku korytarza.`,
        });
      } else {
        const a = roomCenter(left);
        const b = roomCenter(right);
        x = ((a[0] + b[0]) / 2) * grid;
        y = ((a[1] + b[1]) / 2) * grid;
        rotation = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
        notes.push({
          code: 'door-no-passage',
          message: `Pokoje „${left.id}” i „${right.id}” nie stykają się i nie łączy ich korytarz. Drzwi ustawiono między środkami pokoi.`,
        });
      }
    }
  } else {
    if (door.x === undefined || door.y === undefined) {
      throw new DocumentOpError('Drzwi potrzebują between albo współrzędnych x i y.');
    }
    x = requireFinite(door.x, 'x drzwi') * grid;
    y = requireFinite(door.y, 'y drzwi') * grid;
    rotation = door.rotation ?? 0;
    if (!Number.isFinite(rotation)) throw new DocumentOpError('Obrót drzwi musi być liczbą.');
  }
  let next = placeDoor(
    doc,
    {
      x,
      y,
      rotation,
      type,
      widthCells: doorWidthCells(type),
      ...(door.flipped ? { flipped: true } : {}),
    },
    id
  );
  if (between) {
    const authoring = mustAuthoring(next);
    next = {
      ...next,
      authoring: {
        ...authoring,
        doorLinks: { ...authoring.doorLinks, [id]: between },
      },
    };
  }
  return { doc: next, notes };
}

function placeStairInput(doc: DungeonDocument, stair: StairInput, options?: OpOptions): DungeonDocument {
  const type = stair.type ?? 'straight';
  if (!STAIR_TYPE_OPTIONS.includes(type)) {
    throw new DocumentOpError(`Nieznany typ schodów „${String(stair.type)}”. Użyj list_catalog.`);
  }
  const defaults = stairSize(type);
  const widthCells = stair.widthCells ?? defaults.widthCells;
  const lengthCells = stair.lengthCells ?? defaults.lengthCells;
  if (!Number.isFinite(widthCells) || !Number.isFinite(lengthCells) || widthCells <= 0 || lengthCells <= 0) {
    throw new DocumentOpError('Wymiary schodów muszą być liczbami większymi od zera.');
  }
  const grid = doc.gridSize || GRID_SIZE;
  const id = stair.id?.trim() || takeId(options, 'st');
  assertFreshId(doc, id);
  return placeStair(
    doc,
    {
      x: requireFinite(stair.x, 'x schodów') * grid,
      y: requireFinite(stair.y, 'y schodów') * grid,
      rotation: stair.rotation ?? 0,
      type,
      widthCells,
      lengthCells,
    },
    id
  );
}

function placePropInput(
  doc: DungeonDocument,
  prop: PropInput,
  options?: OpOptions
): { doc: DungeonDocument; notes: MapNote[] } {
  const entry = SVG_PROP_CATALOG.find((item) => item.id === prop.propId);
  if (!entry) throw new DocumentOpError(`Nieznany rekwizyt „${String(prop.propId)}”. Użyj list_catalog.`);
  const scale = prop.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) throw new DocumentOpError('Skala rekwizytu musi być liczbą większą od zera.');
  const grid = doc.gridSize || GRID_SIZE;
  const id = prop.id?.trim() || takeId(options, 'pr');
  assertFreshId(doc, id);
  return {
    doc: placeProp(
      doc,
      {
        x: requireFinite(prop.x, 'x rekwizytu') * grid,
        y: requireFinite(prop.y, 'y rekwizytu') * grid,
        rotation: prop.rotation ?? 0,
        scale,
        kind: 'svg',
        svgPropId: entry.id,
        label: pl.props[entry.id],
        widthPx: entry.widthPx,
        heightPx: entry.heightPx,
        artwork: 'plane',
      },
      id
    ),
    notes: [],
  };
}

function placeLabelInput(doc: DungeonDocument, label: LabelInput, options?: OpOptions): DungeonDocument {
  const grid = doc.gridSize || GRID_SIZE;
  const id = label.id?.trim() || takeId(options, 'lb');
  assertFreshId(doc, id);
  const text = label.text?.trim() ?? '';
  const number = label.number !== undefined ? String(label.number).trim() : '';
  if (!text && !number) throw new DocumentOpError('Etykieta potrzebuje tekstu albo numeru.');
  const fontSize = label.fontSize ?? 13 * inkScale(grid);
  if (!Number.isFinite(fontSize) || fontSize <= 0) {
    throw new DocumentOpError('Rozmiar etykiety musi być liczbą większą od zera.');
  }
  return placeLabel(
    doc,
    {
      x: requireFinite(label.x, 'x etykiety') * grid,
      y: requireFinite(label.y, 'y etykiety') * grid,
      text,
      ...(number ? { badgeNumber: number } : {}),
      fontSize,
      rotation: label.rotation ?? 0,
    },
    id
  );
}

function finish(doc: DungeonDocument, notes: MapNote[]): MapOpResult {
  const next = notes.length ? addNotes(doc, notes) : doc;
  return { doc: next, summary: summarizeMap(next) };
}

function addNotes(doc: DungeonDocument, notes: MapNote[]): DungeonDocument {
  const authoring = mustAuthoring(ensureAuthoring(doc));
  const seen = new Set(authoring.notes.map((note) => `${note.code}\u0000${note.message}`));
  const next = [...authoring.notes];
  for (const note of notes) {
    const key = `${note.code}\u0000${note.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(note);
  }
  return { ...doc, authoring: { ...authoring, notes: next } };
}

function overlapNotes(rooms: AuthoredRoom[]): MapNote[] {
  const notes: MapNote[] = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      if (a.layerId !== b.layerId) continue;
      if (overlapArea(a, b) <= 0) continue;
      notes.push({
        code: 'rooms-overlap',
        message: `Pokoje „${a.id}” i „${b.id}” nachodzą na siebie i zostały połączone w jedną podłogę.`,
      });
    }
  }
  return notes;
}

function sharedEdge(a: AuthoredRoom, b: AuthoredRoom): { x: number; y: number; rotation: number } | null {
  const eps = 1e-4;
  const candidates: { len: number; x: number; y: number; rotation: number }[] = [];
  const ar = a.x + a.w;
  const br = b.x + b.w;
  const ab = a.y + a.h;
  const bb = b.y + b.h;
  const vertical = (edgeX: number) => {
    const start = Math.max(a.y, b.y);
    const end = Math.min(ab, bb);
    if (end - start > eps) candidates.push({ len: end - start, x: edgeX, y: (start + end) / 2, rotation: 90 });
  };
  const horizontal = (edgeY: number) => {
    const start = Math.max(a.x, b.x);
    const end = Math.min(ar, br);
    if (end - start > eps) candidates.push({ len: end - start, x: (start + end) / 2, y: edgeY, rotation: 0 });
  };
  if (Math.abs(ar - b.x) <= eps) vertical(ar);
  if (Math.abs(br - a.x) <= eps) vertical(a.x);
  if (Math.abs(ab - b.y) <= eps) horizontal(ab);
  if (Math.abs(bb - a.y) <= eps) horizontal(a.y);
  candidates.sort((left, right) => right.len - left.len);
  return candidates[0] ?? null;
}

function connectingCorridor(
  authoring: MapAuthoring,
  a: AuthoredRoom,
  b: AuthoredRoom
): AuthoredCorridor | undefined {
  return authoring.corridors.find((corridor) => {
    if (corridor.from && corridor.to) {
      const linked = [corridor.from, corridor.to].sort().join('\u0000');
      const want = [a.id, b.id].sort().join('\u0000');
      if (linked === want) return true;
    }
    const start = corridor.points[0];
    const end = corridor.points[corridor.points.length - 1];
    if (!start || !end) return false;
    return (
      (pointInRoom(start, a) && pointInRoom(end, b)) || (pointInRoom(start, b) && pointInRoom(end, a))
    );
  });
}

function pathMidpoint(points: Point2D[]): { x: number; y: number; rotation: number } {
  if (points.length === 0) return { x: 0, y: 0, rotation: 0 };
  if (points.length === 1) return { x: points[0][0], y: points[0][1], rotation: 0 };
  const segments: { a: Point2D; b: Point2D; len: number }[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segments.push({ a, b, len });
    total += len;
  }
  let remain = total / 2;
  const last = segments[segments.length - 1];
  for (const segment of segments) {
    if (remain <= segment.len || segment === last) {
      const t = segment.len === 0 ? 0 : Math.min(1, remain / segment.len);
      return {
        x: segment.a[0] + (segment.b[0] - segment.a[0]) * t,
        y: segment.a[1] + (segment.b[1] - segment.a[1]) * t,
        rotation: (Math.atan2(segment.b[1] - segment.a[1], segment.b[0] - segment.a[0]) * 180) / Math.PI,
      };
    }
    remain -= segment.len;
  }
  return { x: last.b[0], y: last.b[1], rotation: 0 };
}

function elbowBetween(
  from: Point2D,
  to: Point2D,
  horizontalFirst = Math.abs(to[0] - from[0]) >= Math.abs(to[1] - from[1])
): Point2D[] {
  return computeElbowPath(from, to, horizontalFirst);
}

function roomCenter(room: AuthoredRoom): Point2D {
  return [room.x + room.w / 2, room.y + room.h / 2];
}

function pointInRoom(point: Point2D, room: AuthoredRoom): boolean {
  const eps = 1e-4;
  return (
    point[0] >= room.x - eps &&
    point[0] <= room.x + room.w + eps &&
    point[1] >= room.y - eps &&
    point[1] <= room.y + room.h + eps
  );
}

function overlapArea(a: AuthoredRoom, b: AuthoredRoom): number {
  const width = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (width <= 1e-4 || height <= 1e-4) return 0;
  return width * height;
}

function stairSize(type: StairType): { widthCells: number; lengthCells: number } {
  if (type === 'wide') return { widthCells: 2, lengthCells: 2 };
  if (type === 'spiral') return { widthCells: 1.5, lengthCells: 1.5 };
  return { widthCells: 1, lengthCells: 2 };
}

function emptyAuthoring(): MapAuthoring {
  return { rooms: [], corridors: [], doorLinks: {}, notes: [] };
}

function ensureAuthoring(doc: DungeonDocument): DungeonDocument {
  if (doc.authoring) return doc;
  return { ...doc, authoring: emptyAuthoring() };
}

function mustAuthoring(doc: DungeonDocument): MapAuthoring {
  return doc.authoring ?? emptyAuthoring();
}

function findRoom(authoring: MapAuthoring, id: string): AuthoredRoom | undefined {
  return authoring.rooms.find((room) => room.id === id);
}

function requireLayer(doc: DungeonDocument, layerId: string): DungeonLayer {
  const layer = doc.layers.find((item) => item.id === layerId);
  if (!layer) throw new DocumentOpError(`Warstwa „${layerId}” nie istnieje.`);
  return layer;
}

function assertFreshId(doc: DungeonDocument, id: string): void {
  if (takenIds(doc).has(id)) throw new DocumentOpError(`Id „${id}” jest już użyte.`);
}

function takenIds(doc: DungeonDocument): Set<string> {
  const ids = new Set<string>();
  for (const layer of doc.layers) ids.add(layer.id);
  for (const room of doc.authoring?.rooms ?? []) ids.add(room.id);
  for (const corridor of doc.authoring?.corridors ?? []) ids.add(corridor.id);
  for (const door of doc.doors) ids.add(door.id);
  for (const stair of doc.stairs) ids.add(stair.id);
  for (const prop of doc.props) ids.add(prop.id);
  for (const label of doc.labels) ids.add(label.id);
  return ids;
}

function takeId(options: OpOptions | undefined, kind: string): string {
  return options?.ids ? options.ids(kind) : createEntityId(kind);
}

function requireId(id: string, label: string): string {
  const trimmed = id?.trim();
  if (!trimmed) throw new DocumentOpError(`Brakuje id ${label}.`);
  return trimmed;
}

function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new DocumentOpError(`${label} musi być liczbą.`);
  return value;
}

function assertTheme(themeId: MapThemeId): void {
  if (!MAP_THEMES[themeId]) throw new DocumentOpError(`Nieznany motyw „${String(themeId)}”.`);
}

function toCells(px: number, grid: number): number {
  return Math.round((px / grid) * 1000) / 1000;
}
