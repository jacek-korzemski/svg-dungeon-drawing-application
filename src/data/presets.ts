import {
  BuildingStyle,
  DoorType,
  DungeonDocument,
  DungeonLayer,
  ExteriorRoad,
  ExteriorWallStyle,
  LayerEnvironment,
  MapTheme,
  MapThemeId,
  Point2D,
  RoadStyle,
  StairType,
  PropCategoryId,
  StandaloneWall,
  SvgPropId,
  TexturePaint,
  WallStyle,
} from '../types/dungeon';
import {
  corridorPathToMultiPolygon,
  GRID_SIZE,
  rectToPolygon,
  subtractGeometry,
  unionGeometry,
} from '../utils/geometry';
import { getBuiltinPngAssets } from '../utils/samplePngAssets';

export const MAP_THEMES: Record<MapThemeId, MapTheme> = {
  classic: {
    id: 'classic',
    bgVoid: '#EAE6DC',
    gridMajor: '#D6D0C4',
    gridMinor: '#E2DDD2',
    floorFill: '#FAF8F3',
    floorGrid: '#DFDBD0',
    inkStroke: '#141618',
    hatchStroke: '#23262B',
    wallFill: '#D4CFC3',
    accentLabel: '#1E293B',
  },
  parchment: {
    id: 'parchment',
    bgVoid: '#DFD2B8',
    gridMajor: '#C7B697',
    gridMinor: '#D5C6A9',
    floorFill: '#F4EBD9',
    floorGrid: '#D9CCB2',
    inkStroke: '#2C1E12',
    hatchStroke: '#3D2B1B',
    wallFill: '#C2B091',
    accentLabel: '#4A2C11',
  },
  blueprint: {
    id: 'blueprint',
    bgVoid: '#0C213D',
    gridMajor: '#183A66',
    gridMinor: '#122E52',
    floorFill: '#12335C',
    floorGrid: '#1E497D',
    inkStroke: '#E0F2FE',
    hatchStroke: '#7DD3FC',
    wallFill: '#1E497D',
    accentLabel: '#BAE6FD',
  },
  dark_vtt: {
    id: 'dark_vtt',
    bgVoid: '#0E1015',
    gridMajor: '#1C2029',
    gridMinor: '#151820',
    floorFill: '#242934',
    floorGrid: '#313847',
    inkStroke: '#E2E8F0',
    hatchStroke: '#94A3B8',
    wallFill: '#3B4252',
    accentLabel: '#F8FAFC',
  },
};

export interface BuildingStyleOption {
  id: BuildingStyle;
  /** Tile from src/assets-textures used to fill the footprint. */
  texturePath: string;
}

export const BUILDING_STYLE_OPTIONS: BuildingStyleOption[] = [
  { id: 'roof_tile', texturePath: 'dachówka.png' },
  { id: 'roof_thatch', texturePath: 'strzecha.png' },
  { id: 'roof_slate', texturePath: 'łupek.png' },
  { id: 'castle_wall', texturePath: 'posadzka.png' },
  { id: 'palisade', texturePath: 'ziemia.png' },
  { id: 'ruined_building', texturePath: 'kamień.png' },
];

export function buildingTexturePath(style: BuildingStyle): string {
  return BUILDING_STYLE_OPTIONS.find((option) => option.id === style)?.texturePath ?? 'dachówka.png';
}

export interface RoadStyleOption {
  id: RoadStyle;
  texturePath: string;
}

export const ROAD_STYLE_OPTIONS: RoadStyleOption[] = [
  { id: 'cobble', texturePath: 'bruk.png' },
  { id: 'dirt', texturePath: 'droga.png' },
  { id: 'gravel', texturePath: 'żwir.png' },
  { id: 'wood_planks', texturePath: 'deski.png' },
];

export function roadTexturePath(style: RoadStyle): string {
  return ROAD_STYLE_OPTIONS.find((option) => option.id === style)?.texturePath ?? 'droga.png';
}

export const EXTERIOR_WALL_STYLE_OPTIONS: ExteriorWallStyle[] = [
  'castle_crenellated',
  'palisade_logs',
  'stone_wall',
  'wood_fence',
  'hedge',
];

export function createEmptyLayer(
  id: string,
  name: string,
  environment: LayerEnvironment
): DungeonLayer {
  return {
    id,
    name,
    visible: true,
    locked: false,
    opacity: 1,
    wallStyle: 'straight',
    hatchEnabled: true,
    environment,
    buildingStyle: environment === 'exterior' ? 'roof_tile' : undefined,
    geometry: [],
    standaloneWalls: [],
    texturePaints: [],
    roads: [],
  };
}

export const WALL_STYLE_OPTIONS: WallStyle[] = ['straight', 'rock', 'brick', 'double', 'ruins'];

export interface SvgPropCatalogEntry {
  id: SvgPropId;
  category: PropCategoryId;
  widthPx: number;
  heightPx: number;
}

export const SVG_PROP_CATALOG: SvgPropCatalogEntry[] = [
  { id: 'barrel', category: 'furniture', widthPx: 52, heightPx: 52 },
  { id: 'crate', category: 'furniture', widthPx: 56, heightPx: 56 },
  { id: 'table', category: 'furniture', widthPx: 112, heightPx: 60 },
  { id: 'throne', category: 'furniture', widthPx: 76, heightPx: 76 },
  { id: 'bed', category: 'furniture', widthPx: 64, heightPx: 108 },
  { id: 'bookshelf', category: 'furniture', widthPx: 108, heightPx: 44 },
  { id: 'weapon_rack', category: 'furniture', widthPx: 88, heightPx: 44 },
  { id: 'chest', category: 'treasure', widthPx: 64, heightPx: 48 },
  { id: 'altar', category: 'treasure', widthPx: 96, heightPx: 60 },
  { id: 'sarcophagus', category: 'treasure', widthPx: 64, heightPx: 112 },
  { id: 'brazier', category: 'treasure', widthPx: 52, heightPx: 52 },
  { id: 'statue', category: 'treasure', widthPx: 64, heightPx: 64 },
  { id: 'pillar', category: 'nature', widthPx: 56, heightPx: 56 },
  { id: 'boulder', category: 'nature', widthPx: 72, heightPx: 64 },
  { id: 'campfire', category: 'nature', widthPx: 64, heightPx: 64 },
  { id: 'tree', category: 'nature', widthPx: 128, heightPx: 128 },
  { id: 'bush', category: 'nature', widthPx: 56, heightPx: 56 },
  { id: 'well', category: 'furniture', widthPx: 64, heightPx: 64 },
];

export const DOOR_TYPE_OPTIONS: DoorType[] = [
  'standard',
  'double',
  'secret',
  'portcullis',
  'archway',
  'gatehouse',
  'wood_gate',
  'bridge_stone',
  'bridge_wood',
];

export const STAIR_TYPE_OPTIONS: StairType[] = ['straight', 'spiral', 'wide'];

export type PresetId = 'starter' | 'caverns' | 'fortress' | 'settlement' | 'empty';

export function createPresetDungeon(presetId: PresetId): DungeonDocument {
  const G = GRID_SIZE; // 64px
  const pngAssets = getBuiltinPngAssets();
  const barrelPng = pngAssets.find((a) => a.id === 'png-barrel');
  const chestPng = pngAssets.find((a) => a.id === 'png-chest');
  const brazierPng = pngAssets.find((a) => a.id === 'png-brazier');

  if (presetId === 'empty') {
    return {
      title: 'Nowa Pusta Mapa',
      gridSize: G,
      feetPerCell: 5,
      themeId: 'classic',
      showGrid: true,
      layers: [
        {
          id: 'layer-main',
          name: 'Główny Loch',
          visible: true,
          locked: false,
          opacity: 1,
          wallStyle: 'straight',
          hatchEnabled: true,
          geometry: [],
          standaloneWalls: [],
          texturePaints: [],
        },
      ],
      activeLayerId: 'layer-main',
      doors: [],
      stairs: [],
      props: [],
      labels: [],
    };
  }

  if (presetId === 'caverns') {
    let caveGeo = [rectToPolygon(4 * G, 4 * G, 10 * G, 9 * G)];
    caveGeo = unionGeometry(
      caveGeo,
      corridorPathToMultiPolygon(
        [
          [9.5 * G, 6.5 * G],
          [14.5 * G, 6.5 * G],
          [14.5 * G, 11.5 * G],
        ],
        2 * G
      )
    );
    caveGeo = unionGeometry(caveGeo, [rectToPolygon(12 * G, 10 * G, 20 * G, 16 * G)]);
    caveGeo = unionGeometry(
      caveGeo,
      corridorPathToMultiPolygon(
        [
          [16 * G, 15.5 * G],
          [16 * G, 19.5 * G],
          [23.5 * G, 19.5 * G],
        ],
        1.5 * G
      )
    );
    caveGeo = unionGeometry(caveGeo, [rectToPolygon(22 * G, 15 * G, 28 * G, 21 * G)]);
    // Rock pillar island in center of main cavern
    caveGeo = subtractGeometry(caveGeo, [rectToPolygon(15 * G, 12 * G, 17 * G, 14 * G)]);

    return {
      title: 'Jaskinie Goblinów',
      gridSize: G,
      feetPerCell: 5,
      themeId: 'parchment',
      showGrid: true,
      layers: [
        {
          id: 'layer-caves',
          name: 'System Jaskiń',
          visible: true,
          locked: false,
          opacity: 1,
          wallStyle: 'rock',
          hatchEnabled: true,
          geometry: caveGeo,
          standaloneWalls: [],
          texturePaints: [],
        },
      ],
      activeLayerId: 'layer-caves',
      doors: [],
      stairs: [
        {
          id: 'st-cave-1',
          x: 5 * G,
          y: 6.5 * G,
          rotation: -90,
          type: 'straight',
          widthCells: 1,
          lengthCells: 2,
        },
      ],
      props: [
        {
          id: 'pr-c1',
          x: 14 * G,
          y: 13 * G,
          rotation: 0,
          scale: 1,
          kind: 'svg',
          svgPropId: 'campfire',
          label: 'Ognisko obozowe',
          widthPx: 64,
          heightPx: 64,
        },
        {
          id: 'pr-c2',
          x: 18.5 * G,
          y: 11.5 * G,
          rotation: 15,
          scale: 1,
          kind: 'svg',
          svgPropId: 'boulder',
          label: 'Głaz skalny',
          widthPx: 72,
          heightPx: 64,
        },
        ...(barrelPng
          ? [
              {
                id: 'pr-c3',
                x: 8.5 * G,
                y: 8 * G,
                rotation: 0,
                scale: 1,
                kind: 'png' as const,
                pngDataUrl: barrelPng.dataUrl,
                label: 'Beczka Dębowa (PNG)',
                widthPx: barrelPng.widthPx,
                heightPx: barrelPng.heightPx,
              },
            ]
          : []),
        ...(chestPng
          ? [
              {
                id: 'pr-c4',
                x: 26.5 * G,
                y: 16.5 * G,
                rotation: -30,
                scale: 1,
                kind: 'png' as const,
                pngDataUrl: chestPng.dataUrl,
                label: 'Skrzynia Skarbów (PNG)',
                widthPx: chestPng.widthPx,
                heightPx: chestPng.heightPx,
              },
            ]
          : []),
      ],
      labels: [
        { id: 'lb-c1', x: 7 * G, y: 5 * G, badgeNumber: '1', text: 'Wejście do Groty', fontSize: 26, rotation: 0 },
        { id: 'lb-c2', x: 16 * G, y: 10.6 * G, badgeNumber: '2', text: 'Obozowisko', fontSize: 26, rotation: 0 },
        { id: 'lb-c3', x: 25 * G, y: 15.8 * G, badgeNumber: '3', text: 'Skarbiec Wodza', fontSize: 26, rotation: 0 },
      ],
    };
  }

  if (presetId === 'fortress') {
    let keepGeo = [rectToPolygon(10 * G, 4 * G, 20 * G, 11 * G)];
    keepGeo = unionGeometry(
      keepGeo,
      corridorPathToMultiPolygon(
        [
          [15 * G, 11 * G],
          [15 * G, 15 * G],
        ],
        2 * G
      )
    );
    keepGeo = unionGeometry(keepGeo, [rectToPolygon(5 * G, 14 * G, 12 * G, 20 * G)]);
    keepGeo = unionGeometry(keepGeo, [rectToPolygon(18 * G, 14 * G, 25 * G, 20 * G)]);
    keepGeo = unionGeometry(
      keepGeo,
      corridorPathToMultiPolygon(
        [
          [12 * G, 17 * G],
          [18 * G, 17 * G],
        ],
        2 * G
      )
    );

    return {
      title: 'Twierdza Ceglana',
      gridSize: G,
      feetPerCell: 5,
      themeId: 'classic',
      showGrid: true,
      layers: [
        {
          id: 'layer-keep',
          name: 'Mury Twierdzy',
          visible: true,
          locked: false,
          opacity: 1,
          wallStyle: 'brick',
          hatchEnabled: true,
          geometry: keepGeo,
          standaloneWalls: [
            {
              id: 'sw-f1',
              points: [
                [12 * G, 4 * G],
                [12 * G, 8 * G],
              ],
              wallStyle: 'double',
              thickness: 12,
            },
            {
              id: 'sw-f2',
              points: [
                [18 * G, 4 * G],
                [18 * G, 8 * G],
              ],
              wallStyle: 'double',
              thickness: 12,
            },
          ],
          texturePaints: [],
        },
      ],
      activeLayerId: 'layer-keep',
      doors: [
        { id: 'dr-f1', x: 15 * G, y: 11 * G, rotation: 0, type: 'double', widthCells: 2 },
        { id: 'dr-f2', x: 12 * G, y: 17 * G, rotation: 90, type: 'portcullis', widthCells: 1 },
        { id: 'dr-f3', x: 18 * G, y: 17 * G, rotation: 90, type: 'standard', widthCells: 1 },
      ],
      stairs: [
        { id: 'st-f1', x: 15 * G, y: 19 * G, rotation: 0, type: 'wide', widthCells: 2, lengthCells: 2 },
      ],
      props: [
        {
          id: 'pr-f1',
          x: 15 * G,
          y: 5.5 * G,
          rotation: 180,
          scale: 1.1,
          kind: 'svg',
          svgPropId: 'throne',
          label: 'Tron Kasztelana',
          widthPx: 76,
          heightPx: 76,
        },
        {
          id: 'pr-f2',
          x: 8.5 * G,
          y: 17 * G,
          rotation: 0,
          scale: 1.1,
          kind: 'svg',
          svgPropId: 'table',
          label: 'Stół Narad',
          widthPx: 112,
          heightPx: 60,
        },
        {
          id: 'pr-f3',
          x: 21.5 * G,
          y: 15.5 * G,
          rotation: 0,
          scale: 1,
          kind: 'svg',
          svgPropId: 'weapon_rack',
          label: 'Stojak na broń',
          widthPx: 88,
          heightPx: 44,
        },
      ],
      labels: [
        { id: 'lb-f1', x: 15 * G, y: 8.5 * G, badgeNumber: '1', text: 'Sala Tronowa', fontSize: 28, rotation: 0 },
        { id: 'lb-f2', x: 8.5 * G, y: 15.2 * G, badgeNumber: '2', text: 'Kwatery Straży', fontSize: 26, rotation: 0 },
        { id: 'lb-f3', x: 21.5 * G, y: 18.8 * G, badgeNumber: '3', text: 'Zbrojownia', fontSize: 26, rotation: 0 },
      ],
    };
  }

  if (presetId === 'settlement') {
    const cell = (x: number, y: number): Point2D => [x * G, y * G];
    const road = (
      id: string,
      points: Point2D[],
      widthCells: number,
      style: RoadStyle
    ): ExteriorRoad => ({
      id,
      points,
      width: widthCells * G,
      style,
      polygon: corridorPathToMultiPolygon(points, widthCells * G),
    });
    const paint = (id: string, texturePath: string, x1: number, y1: number, x2: number, y2: number, softness = 0.08): TexturePaint => ({
      id,
      texturePath,
      softness,
      kind: 'fill',
      shape: 'bucket',
      dabs: [],
      region: [rectToPolygon(x1 * G, y1 * G, x2 * G, y2 * G)],
    });
    const palisade = (id: string, x1: number, y1: number, x2: number, y2: number): StandaloneWall => ({
      id,
      points: [cell(x1, y1), cell(x2, y2)],
      wallStyle: 'straight',
      thickness: 12,
      exteriorWallStyle: 'palisade_logs',
      hasTowers: true,
    });

    let tileHouses = [rectToPolygon(16 * G, 9 * G, 22 * G, 13 * G)];
    tileHouses = unionGeometry(tileHouses, [rectToPolygon(23.5 * G, 9.5 * G, 29 * G, 13.5 * G)]);
    tileHouses = unionGeometry(tileHouses, [rectToPolygon(18 * G, 17.5 * G, 24 * G, 22 * G)]);
    tileHouses = unionGeometry(tileHouses, [rectToPolygon(25 * G, 17.5 * G, 31 * G, 21.5 * G)]);

    let thatch = [rectToPolygon(20 * G, 2 * G, 24 * G, 5.5 * G)];
    thatch = unionGeometry(thatch, [rectToPolygon(25 * G, 2.5 * G, 29.5 * G, 6 * G)]);
    thatch = unionGeometry(thatch, [rectToPolygon(30.5 * G, 2 * G, 34 * G, 5.5 * G)]);

    return {
      title: 'Warowna Osada i Zamek',
      gridSize: G,
      feetPerCell: 5,
      themeId: 'classic',
      showGrid: true,
      layers: [
        {
          id: 'layer-terrain',
          name: 'Teren i drogi',
          visible: true,
          locked: false,
          opacity: 1,
          wallStyle: 'straight',
          hatchEnabled: true,
          environment: 'exterior',
          buildingStyle: 'roof_tile',
          geometry: [],
          standaloneWalls: [],
          texturePaints: [
            paint('tp-grass', 'trawa.png', 0, 0, 36, 32, 0.04),
            paint('tp-river', 'woda.png', 0, 25, 36, 28, 0.2),
            paint('tp-field', 'uprawa.png', 2, 17, 9, 23, 0.06),
            paint('tp-pond', 'woda-płytka.png', 31, 9, 34.5, 12.5, 0.25),
          ],
          roads: [
            road(
              'rd-main',
              [cell(8, 12), cell(8, 15), cell(30, 15)],
              1.5,
              'cobble'
            ),
            road('rd-bridge', [cell(12, 15), cell(12, 30)], 1.25, 'cobble'),
            road('rd-lane', [cell(26, 15), cell(26, 7.5)], 1, 'dirt'),
          ],
        },
        {
          id: 'layer-castle',
          name: 'Zamek',
          visible: true,
          locked: false,
          opacity: 1,
          wallStyle: 'straight',
          hatchEnabled: true,
          environment: 'exterior',
          buildingStyle: 'castle_wall',
          geometry: [rectToPolygon(2 * G, 2 * G, 14 * G, 12 * G)],
          standaloneWalls: [],
          texturePaints: [],
          roads: [],
        },
        {
          id: 'layer-roofs',
          name: 'Domy z dachówki',
          visible: true,
          locked: false,
          opacity: 1,
          wallStyle: 'straight',
          hatchEnabled: true,
          environment: 'exterior',
          buildingStyle: 'roof_tile',
          geometry: tileHouses,
          standaloneWalls: [],
          texturePaints: [],
          roads: [],
        },
        {
          id: 'layer-cottages',
          name: 'Chaty i palisada',
          visible: true,
          locked: false,
          opacity: 1,
          wallStyle: 'straight',
          hatchEnabled: true,
          environment: 'exterior',
          buildingStyle: 'roof_thatch',
          geometry: thatch,
          standaloneWalls: [
            palisade('sw-pal-n', 19, 1, 35, 1),
            palisade('sw-pal-e', 35, 1, 35, 7.5),
            palisade('sw-pal-s1', 19, 7.5, 25, 7.5),
            palisade('sw-pal-s2', 27, 7.5, 35, 7.5),
            palisade('sw-pal-w', 19, 7.5, 19, 1),
          ],
          texturePaints: [],
          roads: [],
        },
      ],
      activeLayerId: 'layer-roofs',
      doors: [
        { id: 'dr-gate', x: 8 * G, y: 12 * G, rotation: 0, type: 'gatehouse', widthCells: 2 },
        { id: 'dr-wood', x: 26 * G, y: 7.5 * G, rotation: 0, type: 'wood_gate', widthCells: 1.5 },
        { id: 'dr-bridge', x: 12 * G, y: 26.5 * G, rotation: 90, type: 'bridge_stone', widthCells: 3 },
      ],
      stairs: [
        {
          id: 'st-keep',
          x: 8 * G,
          y: 9 * G,
          rotation: 180,
          type: 'straight',
          widthCells: 1,
          lengthCells: 2,
        },
      ],
      props: [
        {
          id: 'pr-fire',
          x: 6 * G,
          y: 6 * G,
          rotation: 0,
          scale: 1,
          kind: 'svg',
          svgPropId: 'campfire',
          label: 'Ognisko na dziedzińcu',
          widthPx: 64,
          heightPx: 64,
        },
        ...(barrelPng
          ? [
              {
                id: 'pr-set-barrel',
                x: 22 * G,
                y: 16.4 * G,
                rotation: 12,
                scale: 1,
                kind: 'png' as const,
                pngDataUrl: barrelPng.dataUrl,
                label: 'Beczka Dębowa (PNG)',
                widthPx: barrelPng.widthPx,
                heightPx: barrelPng.heightPx,
              },
            ]
          : []),
      ],
      labels: [
        { id: 'lb-keep', x: 8 * G, y: 5 * G, badgeNumber: '1', text: 'Dziedziniec zamku', fontSize: 26, rotation: 0 },
        { id: 'lb-street', x: 15.2 * G, y: 13.45 * G, badgeNumber: '2', text: 'Ulica Brukowana', fontSize: 24, rotation: 0 },
        { id: 'lb-cots', x: 27 * G, y: 8.35 * G, badgeNumber: '3', text: 'Chaty pod strzechą', fontSize: 24, rotation: 0 },
        { id: 'lb-bridge', x: 15 * G, y: 26.5 * G, badgeNumber: '4', text: 'Most na trakcie', fontSize: 24, rotation: 0 },
        { id: 'lb-field', x: 5.5 * G, y: 20 * G, badgeNumber: '5', text: 'Pole uprawne', fontSize: 22, rotation: 0 },
      ],
    };
  }

  // Default: 'starter' — "Krypta Zapomnianego Króla" (demonstrates straight, brick, and rock layers + PNG + SVG props!)
  let mainGeo = [rectToPolygon(5 * G, 13 * G, 10 * G, 18 * G)]; // Entry Guardroom
  mainGeo = unionGeometry(
    mainGeo,
    corridorPathToMultiPolygon(
      [
        [7.5 * G, 13 * G],
        [7.5 * G, 8.5 * G],
        [13 * G, 8.5 * G],
      ],
      1 * G
    )
  );
  mainGeo = unionGeometry(mainGeo, [rectToPolygon(13 * G, 5 * G, 21 * G, 12 * G)]); // Grand Pillared Hall
  // Carve two interior stone pillars out of the Grand Hall
  mainGeo = subtractGeometry(mainGeo, [rectToPolygon(15 * G, 7 * G, 16 * G, 8 * G)]);
  mainGeo = subtractGeometry(mainGeo, [rectToPolygon(18 * G, 7 * G, 19 * G, 8 * G)]);
  // South corridor from Grand Hall to Crypt
  mainGeo = unionGeometry(
    mainGeo,
    corridorPathToMultiPolygon(
      [
        [17 * G, 12 * G],
        [17 * G, 15 * G],
      ],
      1 * G
    )
  );

  // Layer 2: Brick Crypt Chamber (wallStyle: 'brick')
  const cryptGeo = [rectToPolygon(14 * G, 15 * G, 20 * G, 20 * G)];

  // Layer 3: Natural Rock Cavern Annex (wallStyle: 'rock')
  let cavernGeo = corridorPathToMultiPolygon(
    [
      [21 * G, 8.5 * G],
      [24.5 * G, 8.5 * G],
    ],
    1 * G
  );
  cavernGeo = unionGeometry(cavernGeo, [rectToPolygon(24 * G, 6 * G, 30 * G, 12 * G)]);

  return {
    title: 'Krypta Zapomnianego Króla',
    gridSize: G,
    feetPerCell: 5,
    themeId: 'classic',
    showGrid: true,
    layers: [
      {
        id: 'layer-main',
        name: 'Główny Loch (Proste)',
        visible: true,
        locked: false,
        opacity: 1,
        wallStyle: 'straight',
        hatchEnabled: true,
        geometry: mainGeo,
        standaloneWalls: [],
        texturePaints: [],
      },
      {
        id: 'layer-crypt',
        name: 'Krypta Królewska (Ceglane)',
        visible: true,
        locked: false,
        opacity: 1,
        wallStyle: 'brick',
        hatchEnabled: true,
        geometry: cryptGeo,
        standaloneWalls: [],
        texturePaints: [],
      },
      {
        id: 'layer-cavern',
        name: 'Grota Wschodnia (Skalne)',
        visible: true,
        locked: false,
        opacity: 1,
        wallStyle: 'rock',
        hatchEnabled: true,
        geometry: cavernGeo,
        standaloneWalls: [],
        texturePaints: [],
      },
    ],
    activeLayerId: 'layer-main',
    doors: [
      { id: 'dr-1', x: 7.5 * G, y: 13 * G, rotation: 0, type: 'standard', widthCells: 1 },
      { id: 'dr-2', x: 13 * G, y: 8.5 * G, rotation: 90, type: 'double', widthCells: 1 },
      { id: 'dr-3', x: 17 * G, y: 15 * G, rotation: 0, type: 'portcullis', widthCells: 1 },
      { id: 'dr-4', x: 21 * G, y: 8.5 * G, rotation: 90, type: 'secret', widthCells: 1 },
    ],
    stairs: [
      {
        id: 'st-1',
        x: 6 * G,
        y: 16.5 * G,
        rotation: 180,
        type: 'straight',
        widthCells: 1,
        lengthCells: 2,
      },
      {
        id: 'st-2',
        x: 28.5 * G,
        y: 7.5 * G,
        rotation: 0,
        type: 'spiral',
        widthCells: 1.5,
        lengthCells: 1.5,
      },
    ],
    props: [
      {
        id: 'pr-1',
        x: 17 * G,
        y: 18.2 * G,
        rotation: 90,
        scale: 1,
        kind: 'svg',
        svgPropId: 'sarcophagus',
        label: 'Sarkofag Króla',
        widthPx: 64,
        heightPx: 112,
      },
      {
        id: 'pr-2',
        x: 17 * G,
        y: 6.2 * G,
        rotation: 0,
        scale: 1,
        kind: 'svg',
        svgPropId: 'altar',
        label: 'Ołtarz Przysięgi',
        widthPx: 96,
        heightPx: 60,
      },
      {
        id: 'pr-3',
        x: 9 * G,
        y: 15.5 * G,
        rotation: 90,
        scale: 0.95,
        kind: 'svg',
        svgPropId: 'table',
        label: 'Stół Wartowników',
        widthPx: 112,
        heightPx: 60,
      },
      ...(barrelPng
        ? [
            {
              id: 'pr-png-1',
              x: 5.8 * G,
              y: 13.8 * G,
              rotation: 0,
              scale: 1,
              kind: 'png' as const,
              pngDataUrl: barrelPng.dataUrl,
              label: 'Beczka Dębowa (PNG)',
              widthPx: barrelPng.widthPx,
              heightPx: barrelPng.heightPx,
            },
            {
              id: 'pr-png-2',
              x: 6.7 * G,
              y: 13.8 * G,
              rotation: 45,
              scale: 0.92,
              kind: 'png' as const,
              pngDataUrl: barrelPng.dataUrl,
              label: 'Beczka Dębowa (PNG)',
              widthPx: barrelPng.widthPx,
              heightPx: barrelPng.heightPx,
            },
          ]
        : []),
      ...(chestPng
        ? [
            {
              id: 'pr-png-3',
              x: 27.8 * G,
              y: 10.6 * G,
              rotation: -20,
              scale: 1,
              kind: 'png' as const,
              pngDataUrl: chestPng.dataUrl,
              label: 'Skrzynia Skarbów (PNG)',
              widthPx: chestPng.widthPx,
              heightPx: chestPng.heightPx,
            },
          ]
        : []),
      ...(brazierPng
        ? [
            {
              id: 'pr-png-4',
              x: 14.2 * G,
              y: 10.8 * G,
              rotation: 0,
              scale: 0.95,
              kind: 'png' as const,
              pngDataUrl: brazierPng.dataUrl,
              label: 'Koksownik z Ogniem (PNG)',
              widthPx: brazierPng.widthPx,
              heightPx: brazierPng.heightPx,
            },
            {
              id: 'pr-png-5',
              x: 19.8 * G,
              y: 10.8 * G,
              rotation: 0,
              scale: 0.95,
              kind: 'png' as const,
              pngDataUrl: brazierPng.dataUrl,
              label: 'Koksownik z Ogniem (PNG)',
              widthPx: brazierPng.widthPx,
              heightPx: brazierPng.heightPx,
            },
          ]
        : []),
    ],
    labels: [
      {
        id: 'lb-1',
        x: 7.5 * G,
        y: 17.1 * G,
        badgeNumber: '1',
        text: 'Wartownia',
        fontSize: 26,
        rotation: 0,
      },
      {
        id: 'lb-2',
        x: 17 * G,
        y: 9.7 * G,
        badgeNumber: '2',
        text: 'Wielka Sala Kolumnowa',
        fontSize: 28,
        rotation: 0,
      },
      {
        id: 'lb-3',
        x: 17 * G,
        y: 16.3 * G,
        badgeNumber: '3',
        text: 'Krypta Królewska',
        fontSize: 26,
        rotation: 0,
      },
      {
        id: 'lb-4',
        x: 26.5 * G,
        y: 9.1 * G,
        badgeNumber: '4',
        text: 'Ukryta Grota',
        fontSize: 26,
        rotation: 0,
      },
    ],
  };
}
