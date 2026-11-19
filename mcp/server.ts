import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  BUILDING_STYLE_OPTIONS,
  DOOR_TYPE_OPTIONS,
  STAIR_TYPE_OPTIONS,
  SVG_PROP_CATALOG,
  WALL_STYLE_OPTIONS,
} from '../src/data/presets';
import {
  addCorridors,
  addDoors,
  addLabels,
  addProps,
  addRooms,
  addStairs,
  buildMap,
  listCatalog,
  parseDocument,
  setMapMeta,
  summarizeMap,
  withVisibleLayers,
  type BuildMapInput,
} from '../src/document/ops';
import type { DungeonDocument, MapThemeId } from '../src/types/dungeon';
import { exportDocument, shutdownExportHost } from './exportHost';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const INSTRUCTIONS = `Jinkline rysuje mapy lochów. Wynik to plik .dungeon.json, który edytor umie wczytać, oraz SVG albo PNG na życzenie.

Przygodę (PDF) czytasz sam. Ten serwer nie parsuje PDF.

Kroki:
1. list_catalog — motywy, drzwi, schody, rekwizyty, tekstury.
2. Jedno build_map z całym układem w kratkach. x rośnie w prawo, y w dół, (x, y) to lewy górny róg pokoju. path to bezwzględna ścieżka pliku .dungeon.json w workspace użytkownika. build_map nadpisuje ten plik.
3. Poprawki bez rysowania całości od nowa: add_rooms, add_corridors, add_doors, add_stairs, add_props, add_labels, set_map_meta.
4. export_map z formatem svg, png albo both. Domyślny widok to flat. iso i 3d są dostępne.
Odpowiedź narzędzia zawiera skrót i ścieżki. Nie wklejaj SVG ani PNG do czatu.`;

const themeId = z.enum(['classic', 'parchment', 'blueprint', 'dark_vtt']);
const doorType = z.enum(tuple(DOOR_TYPE_OPTIONS));
const stairType = z.enum(tuple(STAIR_TYPE_OPTIONS));
const wallStyle = z.enum(tuple(WALL_STYLE_OPTIONS));
const buildingStyle = z.enum(tuple(BUILDING_STYLE_OPTIONS.map((option) => option.id)));
const propId = z.enum(tuple(SVG_PROP_CATALOG.map((entry) => entry.id)));
const cell = z.number();
const roomNumber = z.union([z.string(), z.number()]);

const roomSchema = z.object({
  id: z.string(),
  x: cell,
  y: cell,
  w: cell.describe('Szerokość w kratkach'),
  h: cell.describe('Wysokość w kratkach'),
  layer: z.string().optional(),
  name: z.string().optional(),
  number: roomNumber.optional(),
  floorTexture: z.string().optional().describe('Nazwa pliku z src/assets-textures, np. kamien.png'),
});

const corridorSchema = z.object({
  id: z.string().optional(),
  layer: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  points: z.array(z.tuple([cell, cell])).optional().describe('Łamana w kratkach. Zastępuje from/to, gdy są co najmniej dwa punkty.'),
  widthCells: cell.optional(),
  horizontalFirst: z.boolean().optional(),
});

const doorSchema = z.object({
  id: z.string().optional(),
  type: doorType.optional(),
  x: cell.optional(),
  y: cell.optional(),
  rotation: cell.optional().describe('Stopnie wzdłuż ściany. 0 = ściana pozioma, 90 = pionowa.'),
  between: z.tuple([z.string(), z.string()]).optional().describe('Id dwóch pokoi. Wspólna ściana albo środek korytarza.'),
  flipped: z.boolean().optional(),
});

const stairSchema = z.object({
  id: z.string().optional(),
  type: stairType.optional(),
  x: cell,
  y: cell,
  rotation: cell.optional(),
  widthCells: cell.optional(),
  lengthCells: cell.optional(),
});

const propSchema = z.object({
  id: z.string().optional(),
  propId: propId.describe('Id z list_catalog.props, np. barrel'),
  x: cell,
  y: cell,
  rotation: cell.optional(),
  scale: cell.optional(),
});

const labelSchema = z.object({
  id: z.string().optional(),
  x: cell,
  y: cell,
  text: z.string().optional(),
  number: roomNumber.optional(),
  fontSize: cell.optional().describe('Rozmiar w pikselach świata. Domyślnie jak narzędzie etykiety.'),
  rotation: cell.optional(),
});

const layerSchema = z.object({
  id: z.string(),
  name: z.string(),
  environment: z.enum(['interior', 'exterior']).optional(),
  wallStyle: wallStyle.optional(),
  buildingStyle: buildingStyle.optional(),
});

const server = new McpServer(
  { name: 'jinkline', version: '0.1.0' },
  { instructions: INSTRUCTIONS }
);

server.registerTool(
  'list_catalog',
  {
    description: 'Motywy, typy drzwi i schodów, rekwizyty SVG, style ścian oraz nazwy tekstur podłogi.',
    inputSchema: {},
  },
  async () => ok(listCatalog(textureNames()))
);

server.registerTool(
  'build_map',
  {
    description:
      'Tworzy całą mapę od zera i zapisuje .dungeon.json. Nadpisuje istniejący plik. Pokoje w kratkach, korytarze from/to albo łamaną, drzwi between albo x/y.',
    inputSchema: {
      path: z.string().describe('Bezwzględna ścieżka pliku .dungeon.json'),
      title: z.string(),
      themeId: themeId.optional(),
      feetPerCell: cell.optional(),
      gridSize: cell.optional(),
      showGrid: z.boolean().optional(),
      layers: z.array(layerSchema).optional(),
      rooms: z.array(roomSchema).optional(),
      corridors: z.array(corridorSchema).optional(),
      doors: z.array(doorSchema).optional(),
      stairs: z.array(stairSchema).optional(),
      props: z.array(propSchema).optional(),
      labels: z.array(labelSchema).optional(),
    },
  },
  async (args) => {
    try {
      const { path: filePath, ...spec } = args;
      const result = buildMap(spec as BuildMapInput, { knownTextures: textureNames() });
      const jsonPath = writeMap(filePath, result.doc);
      return ok({ ...result.summary, jsonPath });
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  'summarize_map',
  {
    description: 'Czyta plik mapy i zwraca pokoje, drzwi, rekwizyty i ostrzeżenia w kratkach.',
    inputSchema: { path: z.string() },
  },
  async ({ path: filePath }) => {
    try {
      const abs = path.resolve(filePath);
      return ok({ ...summarizeMap(readMap(abs)), jsonPath: abs });
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  'add_rooms',
  {
    description: 'Dopisuje prostokątne pokoje do istniejącego pliku. Nachodzące pokoje na tej samej warstwie są łączone.',
    inputSchema: { path: z.string(), rooms: z.array(roomSchema) },
  },
  async ({ path: filePath, rooms }) => edit(filePath, (doc) => addRooms(doc, rooms, { knownTextures: textureNames() }).doc)
);

server.registerTool(
  'add_corridors',
  {
    description: 'Dopisuje korytarze. from i to to id pokoi. points to łamana w kratkach.',
    inputSchema: { path: z.string(), corridors: z.array(corridorSchema) },
  },
  async ({ path: filePath, corridors }) => edit(filePath, (doc) => addCorridors(doc, corridors).doc)
);

server.registerTool(
  'add_doors',
  {
    description: 'Dopisuje drzwi. between stawia je na wspólnej ścianie albo na środku korytarza, gdy pokoje się nie stykają.',
    inputSchema: { path: z.string(), doors: z.array(doorSchema) },
  },
  async ({ path: filePath, doors }) => edit(filePath, (doc) => addDoors(doc, doors).doc)
);

server.registerTool(
  'add_stairs',
  {
    description: 'Dopisuje schody. x i y to środek w kratkach.',
    inputSchema: { path: z.string(), stairs: z.array(stairSchema) },
  },
  async ({ path: filePath, stairs }) => edit(filePath, (doc) => addStairs(doc, stairs).doc)
);

server.registerTool(
  'add_props',
  {
    description: 'Dopisuje rekwizyty SVG z katalogu. x i y to środek w kratkach.',
    inputSchema: { path: z.string(), props: z.array(propSchema) },
  },
  async ({ path: filePath, props }) => edit(filePath, (doc) => addProps(doc, props).doc)
);

server.registerTool(
  'add_labels',
  {
    description: 'Dopisuje etykiety. x i y są w kratkach.',
    inputSchema: { path: z.string(), labels: z.array(labelSchema) },
  },
  async ({ path: filePath, labels }) => edit(filePath, (doc) => addLabels(doc, labels).doc)
);

server.registerTool(
  'set_map_meta',
  {
    description: 'Zmienia tytuł, motyw, stopy na kratkę albo widoczność siatki.',
    inputSchema: {
      path: z.string(),
      title: z.string().optional(),
      themeId: themeId.optional(),
      feetPerCell: cell.optional(),
      showGrid: z.boolean().optional(),
    },
  },
  async ({ path: filePath, title, themeId: nextTheme, feetPerCell, showGrid }) =>
    edit(filePath, (doc) =>
      setMapMeta(doc, {
        ...(title !== undefined ? { title } : {}),
        ...(nextTheme !== undefined ? { themeId: nextTheme as MapThemeId } : {}),
        ...(feetPerCell !== undefined ? { feetPerCell } : {}),
        ...(showGrid !== undefined ? { showGrid } : {}),
      }).doc
    )
);

server.registerTool(
  'export_map',
  {
    description:
      'Eksportuje mapę tą samą ścieżką co przycisk w edytorze. format: svg, png albo both. Zapisuje plik obok JSON i nie zmienia JSON. layers ogranicza widoczne warstwy tylko na czas eksportu.',
    inputSchema: {
      path: z.string().describe('Ścieżka pliku .dungeon.json'),
      format: z.enum(['svg', 'png', 'both']),
      mode: z.enum(['flat', 'iso', '3d']).optional(),
      quarter: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
      wallHeightCells: cell.optional(),
      layers: z.array(z.string()).optional(),
    },
  },
  async ({ path: filePath, format, mode, quarter, wallHeightCells, layers }) => {
    try {
      const abs = path.resolve(filePath);
      let doc = readMap(abs);
      if (layers && layers.length > 0) doc = withVisibleLayers(doc, layers);
      const rendered = await exportDocument(
        doc,
        {
          mode: mode ?? 'flat',
          quarter: quarter ?? 0,
          wallHeightCells: wallHeightCells ?? 0.85,
        },
        format
      );
      const written: { svgPath?: string; pngPath?: string } = {};
      if (rendered.svg) {
        const svgPath = exportSibling(abs, 'svg');
        writeFileSync(svgPath, rendered.svg, 'utf8');
        written.svgPath = svgPath;
      }
      if (rendered.png) {
        const pngPath = exportSibling(abs, 'png');
        writeFileSync(pngPath, rendered.png);
        written.pngPath = pngPath;
      }
      return ok({ jsonPath: abs, ...written, bytes: { svg: rendered.svg?.length ?? 0, png: rendered.png?.length ?? 0 } });
    } catch (error) {
      return fail(error);
    }
  }
);

async function main(): Promise<void> {
  process.stdin.on('close', () => {
    void shutdownExportHost();
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

void main();

function tuple<T extends string>(values: readonly T[]): [T, ...T[]] {
  if (values.length === 0) throw new Error('Pusta lista wartości enumeracji.');
  return [values[0], ...values.slice(1)];
}

function textureNames(): string[] {
  try {
    return readdirSync(path.join(repoRoot, 'src', 'assets-textures'))
      .filter((name) => name.toLowerCase().endsWith('.png'))
      .sort((left, right) => left.localeCompare(right, 'pl'));
  } catch {
    return [];
  }
}

function readMap(filePath: string): DungeonDocument {
  try {
    return parseDocument(JSON.parse(readFileSync(filePath, 'utf8')));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Plik mapy nie jest poprawnym JSON: ${filePath}`);
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Nie znaleziono pliku mapy: ${filePath}`);
    throw error;
  }
}

function writeMap(filePath: string, doc: DungeonDocument): string {
  const abs = path.resolve(filePath);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return abs;
}

function edit(filePath: string, change: (doc: DungeonDocument) => DungeonDocument) {
  try {
    const abs = path.resolve(filePath);
    const next = change(readMap(abs));
    writeMap(abs, next);
    return ok({ ...summarizeMap(next), jsonPath: abs });
  } catch (error) {
    return fail(error);
  }
}

function exportSibling(jsonPath: string, ext: 'svg' | 'png'): string {
  const parsed = path.parse(jsonPath);
  const base = parsed.name.endsWith('.dungeon') ? parsed.name.slice(0, -'.dungeon'.length) : parsed.name;
  return path.join(parsed.dir, `${base}.${ext}`);
}

function ok(summary: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] };
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true as const, content: [{ type: 'text' as const, text: message }] };
}
