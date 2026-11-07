import { useCallback, useEffect, useRef, useState } from 'react';
import { localizePresetDocument, useI18n } from './i18n';
import { LeftToolbar } from './components/LeftToolbar';
import { MapCanvas } from './components/MapCanvas';
import { RightInspector } from './components/RightInspector';
import { SvgInspectorModal } from './components/SvgInspectorModal';
import { TopBar } from './components/TopBar';
import { createEmptyLayer, createPresetDungeon, PresetId, SVG_PROP_CATALOG } from './data/presets';
import { defaultFloorTexturePath } from './data/textureLibrary';
import {
  BuildingStyle,
  DistrictAngleMode,
  DistrictAreaShape,
  DistrictSizePreset,
  DoorItem,
  DoorType,
  DungeonDocument,
  EraserShape,
  ExteriorWallStyle,
  LabelItem,
  LayerEnvironment,
  MapThemeId,
  MultiPolygon2D,
  Point2D,
  Polygon2D,
  PropBrush,
  PropItem,
  RoadStyle,
  SelectedEntity,
  StairItem,
  StairType,
  TextureBrushShape,
  TexturePaint,
  ToolType,
  WallStyle,
  layerEnvironment,
} from './types/dungeon';
import {
  computeDocumentBounds,
  downloadJsonProject,
  downloadPngFile,
  downloadSvgFile,
} from './utils/exportDungeon';
import { corridorPathToMultiPolygon, generateBuildingsInRegion, subtractGeometry, unionGeometry } from './utils/geometry';
import { eraseRoadPolygons, eraseTexturePaints } from './utils/texturePaint';

const MAX_HISTORY = 50;

export function App() {
  const { messages, t, tp } = useI18n();
  const [doc, setDoc] = useState<DungeonDocument>(() =>
    localizePresetDocument(createPresetDungeon('empty'), 'empty', messages)
  );
  const [past, setPast] = useState<DungeonDocument[]>([]);
  const [future, setFuture] = useState<DungeonDocument[]>([]);

  // Active tool & sub-options
  const [activeTool, setActiveTool] = useState<ToolType>('room');
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);

  const [corridorWidthCells, setCorridorWidthCells] = useState(1);
  const [corridorElbowMode, setCorridorElbowMode] = useState(true);
  const [caveBrushCells, setCaveBrushCells] = useState(2);
  const [activeDoorType, setActiveDoorType] = useState<DoorType>('standard');
  const [activeStairType, setActiveStairType] = useState<StairType>('straight');
  const [activePropPreset, setActivePropPreset] = useState<PropBrush>(() => ({
    kind: 'svg',
    svgPropId: SVG_PROP_CATALOG[0].id,
    label: messages.props[SVG_PROP_CATALOG[0].id],
    widthPx: SVG_PROP_CATALOG[0].widthPx,
    heightPx: SVG_PROP_CATALOG[0].heightPx,
  }));
  const [pendingRotation, setPendingRotation] = useState(0);
  const [texturePath, setTexturePath] = useState(defaultFloorTexturePath);
  const [textureShape, setTextureShape] = useState<TextureBrushShape>('round');
  const [textureMode, setTextureMode] = useState<'brush' | 'bucket'>('brush');
  const [textureBrushCells, setTextureBrushCells] = useState(1.5);
  const [textureSoftness, setTextureSoftness] = useState(0.4);
  const [textureErasing, setTextureErasing] = useState(false);
  const [roadStyle, setRoadStyle] = useState<RoadStyle>('cobble');
  const [exteriorWallStyle, setExteriorWallStyle] = useState<ExteriorWallStyle>('castle_crenellated');
  const [exteriorWallTowers, setExteriorWallTowers] = useState(true);
  const [eraserShape, setEraserShape] = useState<EraserShape>('rect');
  const [eraserStrokeCells, setEraserStrokeCells] = useState(1.5);
  const [districtDensity, setDistrictDensity] = useState(0.45);
  const [districtSize, setDistrictSize] = useState<DistrictSizePreset>('mixed');
  const [districtAngle, setDistrictAngle] = useState<DistrictAngleMode>('random');
  const [districtArea, setDistrictArea] = useState<DistrictAreaShape>('rect');

  // Camera state
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 40, y: 20 });

  // Modals & notifications
  const [svgInspectorOpen, setSvgInspectorOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const viewportRef = useRef<SVGGElement | null>(null);
  const lastCommittedDocRef = useRef<DungeonDocument>(doc);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 2600);
  }, []);

  // Commit state change with undo history
  const commitDocChange = useCallback(
    (updater: (prev: DungeonDocument) => DungeonDocument) => {
      setDoc((prev) => {
        const next = updater(prev);
        if (next === prev) return prev;
        setPast((h) => [...h.slice(-(MAX_HISTORY - 1)), prev]);
        setFuture([]);
        lastCommittedDocRef.current = next;
        return next;
      });
    },
    []
  );

  // Center camera on bounds
  const fitViewToDocument = useCallback((targetDoc: DungeonDocument) => {
    const bounds = computeDocumentBounds(targetDoc);
    const availableW = Math.max(400, window.innerWidth - 360);
    const availableH = Math.max(300, window.innerHeight - 60);
    const fitZoom = Math.min(
      1.25,
      Math.max(0.15, Math.min(availableW / bounds.width, availableH / bounds.height))
    );
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    setZoom(Number(fitZoom.toFixed(2)));
    setPan({
      x: Math.round(availableW / 2 - centerX * fitZoom),
      y: Math.round(availableH / 2 - centerY * fitZoom),
    });
  }, []);

  useEffect(() => {
    setActivePropPreset((prev) => {
      if (prev.kind === 'svg' && prev.svgPropId) {
        const label = messages.props[prev.svgPropId];
        return prev.label === label ? prev : { ...prev, label };
      }
      return prev;
    });
  }, [messages]);

  // Center initial starter dungeon on mount
  useEffect(() => {
    fitViewToDocument(doc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Undo & Redo handlers
  const handleUndo = useCallback(() => {
    setPast((prevPast) => {
      if (prevPast.length === 0) return prevPast;
      const previous = prevPast[prevPast.length - 1];
      setFuture((f) => [doc, ...f]);
      setDoc(previous);
      lastCommittedDocRef.current = previous;
      setSelectedEntity(null);
      return prevPast.slice(0, -1);
    });
  }, [doc]);

  const handleRedo = useCallback(() => {
    setFuture((prevFuture) => {
      if (prevFuture.length === 0) return prevFuture;
      const next = prevFuture[0];
      setPast((p) => [...p, doc]);
      setDoc(next);
      lastCommittedDocRef.current = next;
      setSelectedEntity(null);
      return prevFuture.slice(1);
    });
  }, [doc]);

  // Global keyboard shortcuts (Undo/Redo + Tool hotkeys + Q rotate)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement ||
        document.activeElement instanceof HTMLSelectElement
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key.toLowerCase();
      const map: Record<string, ToolType> = {
        v: 'select',
        h: 'pan',
        r: 'room',
        c: 'corridor',
        b: 'cave',
        g: 'polygon',
        e: 'eraser',
        w: 'wall',
        d: 'door',
        s: 'stairs',
        p: 'prop',
        t: 'label',
        m: 'texture',
        k: 'district',
      };

      if (map[key]) {
        e.preventDefault();
        setActiveTool(map[key]);
      } else if (key === 'q') {
        e.preventDefault();
        setPendingRotation((r) => (r + 45) % 360);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

  // Carve or subtract floor geometry on active layer
  const handleCarveFloor = useCallback(
    (polygonOrMulti: Point2D[][][], mode: 'add' | 'subtract') => {
      commitDocChange((prev) => {
        const layers = prev.layers.map((layer) => {
          if (layer.id !== prev.activeLayerId) return layer;
          const nextGeo =
            mode === 'add'
              ? unionGeometry(layer.geometry, polygonOrMulti)
              : subtractGeometry(layer.geometry, polygonOrMulti);
          return {
            ...layer,
            visible: true,
            geometry: nextGeo,
          };
        });
        return { ...prev, layers };
      });
    },
    [commitDocChange]
  );

  // Add standalone internal partition wall
  const handleAddStandaloneWall = useCallback(
    (points: Point2D[]) => {
      commitDocChange((prev) => {
        const layers = prev.layers.map((layer) => {
          if (layer.id !== prev.activeLayerId) return layer;
          const exterior = layerEnvironment(layer) === 'exterior';
          return {
            ...layer,
            standaloneWalls: [
              ...layer.standaloneWalls,
              {
                id: `sw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                points,
                wallStyle: layer.wallStyle,
                thickness: exterior ? 14 : 8,
                ...(exterior
                  ? { exteriorWallStyle, hasTowers: exteriorWallTowers }
                  : {}),
              },
            ],
          };
        });
        return { ...prev, layers };
      });
    },
    [commitDocChange, exteriorWallStyle, exteriorWallTowers]
  );

  const handleAddRoad = useCallback(
    (points: Point2D[]) => {
      commitDocChange((prev) => {
        const width = corridorWidthCells * (prev.gridSize || 64);
        const polygon = corridorPathToMultiPolygon(points, width);
        if (!polygon.length) return prev;
        return {
          ...prev,
          layers: prev.layers.map((layer) => {
            if (layer.id !== prev.activeLayerId || layerEnvironment(layer) !== 'exterior') return layer;
            return {
              ...layer,
              roads: [
                ...(layer.roads ?? []),
                {
                  id: `rd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  points,
                  width,
                  style: roadStyle,
                  polygon,
                },
              ],
            };
          }),
        };
      });
    },
    [commitDocChange, corridorWidthCells, roadStyle]
  );

  const handleEraseRoads = useCallback(
    (cut: MultiPolygon2D) => {
      commitDocChange((prev) => {
        let changed = false;
        const layers = prev.layers.map((layer) => {
          if (layer.id !== prev.activeLayerId) return layer;
          const current = layer.roads ?? [];
          const next = eraseRoadPolygons(current, cut);
          if (next === current) return layer;
          changed = true;
          return { ...layer, roads: next };
        });
        return changed ? { ...prev, layers } : prev;
      });
    },
    [commitDocChange]
  );

  const handleApplyTexturePaint = useCallback(
    (paint: TexturePaint) => {
      commitDocChange((prev) => ({
        ...prev,
        layers: prev.layers.map((layer) =>
          layer.id === prev.activeLayerId
            ? { ...layer, texturePaints: [...(layer.texturePaints ?? []), paint] }
            : layer
        ),
      }));
    },
    [commitDocChange]
  );

  const handleEraseTexture = useCallback(
    (cut: MultiPolygon2D) => {
      commitDocChange((prev) => {
        let changed = false;
        const layers = prev.layers.map((layer) => {
          if (layer.id !== prev.activeLayerId) return layer;
          const current = layer.texturePaints ?? [];
          const next = eraseTexturePaints(current, cut);
          if (next === current) return layer;
          changed = true;
          return { ...layer, texturePaints: next };
        });
        return changed ? { ...prev, layers } : prev;
      });
    },
    [commitDocChange]
  );

  const handleGenerateDistrict = useCallback(
    (region: Polygon2D) => {
      const active = doc.layers.find((layer) => layer.id === doc.activeLayerId) ?? doc.layers[0];
      if (!active || layerEnvironment(active) !== 'exterior') {
        showToast(t('toast.districtExteriorOnly'));
        return;
      }
      const result = generateBuildingsInRegion(region, doc.layers, {
        density: districtDensity,
        sizePreset: districtSize,
        angleMode: districtAngle,
        gridSize: doc.gridSize || 64,
      });
      if (result.placedCount === 0) {
        showToast(t('toast.districtTooTight'));
        return;
      }
      const buildings = result.buildings;
      commitDocChange((prev) => ({
        ...prev,
        layers: prev.layers.map((layer) =>
          layer.id === prev.activeLayerId
            ? { ...layer, geometry: [...layer.geometry, ...buildings] }
            : layer
        ),
      }));
      showToast(tp('toast.generatedBuildings', result.placedCount));
    },
    [commitDocChange, districtAngle, districtDensity, districtSize, doc, showToast, t, tp]
  );

  // Place Door / Stair / Prop / Label
  const handlePlaceDoor = useCallback(
    (door: Omit<DoorItem, 'id'>) => {
      const id = `dr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      commitDocChange((prev) => ({
        ...prev,
        doors: [...prev.doors, { ...door, id }],
      }));
    },
    [commitDocChange]
  );

  const handlePlaceStair = useCallback(
    (stair: Omit<StairItem, 'id'>) => {
      const id = `st-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      commitDocChange((prev) => ({
        ...prev,
        stairs: [...prev.stairs, { ...stair, id }],
      }));
    },
    [commitDocChange]
  );

  const handlePlaceProp = useCallback(
    (prop: Omit<PropItem, 'id'>) => {
      const id = `pr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      commitDocChange((prev) => ({
        ...prev,
        props: [...prev.props, { ...prop, id }],
      }));
    },
    [commitDocChange]
  );

  const handlePlaceLabel = useCallback(
    (label: Omit<LabelItem, 'id'>) => {
      const id = `lb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      commitDocChange((prev) => ({
        ...prev,
        labels: [...prev.labels, { ...label, id }],
      }));
      setSelectedEntity({ kind: 'label', id });
      setActiveTool('select');
    },
    [commitDocChange]
  );

  // Update entity (supports live preview drag with commitHistory=false, then final commitHistory=true)
  const handleUpdateEntity = useCallback(
    (
      entity: NonNullable<SelectedEntity>,
      patch: Record<string, unknown>,
      commitHistory = true
    ) => {
      const applyPatch = (d: DungeonDocument): DungeonDocument => {
        if (entity.kind === 'door') {
          return {
            ...d,
            doors: d.doors.map((item) => (item.id === entity.id ? { ...item, ...patch } : item)),
          };
        }
        if (entity.kind === 'stair') {
          return {
            ...d,
            stairs: d.stairs.map((item) => (item.id === entity.id ? { ...item, ...patch } : item)),
          };
        }
        if (entity.kind === 'prop') {
          return {
            ...d,
            props: d.props.map((item) => (item.id === entity.id ? { ...item, ...patch } : item)),
          };
        }
        if (entity.kind === 'label') {
          return {
            ...d,
            labels: d.labels.map((item) => (item.id === entity.id ? { ...item, ...patch } : item)),
          };
        }
        if (entity.kind === 'wall') {
          return {
            ...d,
            layers: d.layers.map((layer) =>
              layer.id === entity.layerId
                ? {
                    ...layer,
                    standaloneWalls: layer.standaloneWalls.map((wall) =>
                      wall.id === entity.id ? { ...wall, ...patch } : wall
                    ),
                  }
                : layer
            ),
          };
        }
        if (entity.kind === 'road') {
          return {
            ...d,
            layers: d.layers.map((layer) =>
              layer.id === entity.layerId
                ? {
                    ...layer,
                    roads: (layer.roads ?? []).map((road) =>
                      road.id === entity.id ? { ...road, ...patch } : road
                    ),
                  }
                : layer
            ),
          };
        }
        if (entity.kind === 'building' && patch.polygon) {
          const polygon = patch.polygon as Polygon2D;
          return {
            ...d,
            layers: d.layers.map((layer) =>
              layer.id === entity.layerId
                ? {
                    ...layer,
                    geometry: layer.geometry.map((item, index) =>
                      index === entity.polyIndex ? polygon : item
                    ),
                  }
                : layer
            ),
          };
        }
        return d;
      };

      if (!commitHistory) {
        setDoc((prev) => applyPatch(prev));
      } else {
        setDoc((prev) => {
          const next = applyPatch(prev);
          if (lastCommittedDocRef.current !== next) {
            setPast((h) => [...h.slice(-(MAX_HISTORY - 1)), lastCommittedDocRef.current]);
            setFuture([]);
            lastCommittedDocRef.current = next;
          }
          return next;
        });
      }
    },
    []
  );

  // Delete selected entity
  const handleDeleteEntity = useCallback(
    (entity: NonNullable<SelectedEntity>) => {
      commitDocChange((prev) => {
        if (entity.kind === 'door') {
          return { ...prev, doors: prev.doors.filter((d) => d.id !== entity.id) };
        }
        if (entity.kind === 'stair') {
          return { ...prev, stairs: prev.stairs.filter((s) => s.id !== entity.id) };
        }
        if (entity.kind === 'prop') {
          return { ...prev, props: prev.props.filter((p) => p.id !== entity.id) };
        }
        if (entity.kind === 'label') {
          return { ...prev, labels: prev.labels.filter((l) => l.id !== entity.id) };
        }
        if (entity.kind === 'wall') {
          return {
            ...prev,
            layers: prev.layers.map((layer) =>
              layer.id === entity.layerId
                ? {
                    ...layer,
                    standaloneWalls: layer.standaloneWalls.filter((w) => w.id !== entity.id),
                  }
                : layer
            ),
          };
        }
        if (entity.kind === 'road') {
          return {
            ...prev,
            layers: prev.layers.map((layer) =>
              layer.id === entity.layerId
                ? {
                    ...layer,
                    roads: (layer.roads ?? []).filter((road) => road.id !== entity.id),
                  }
                : layer
            ),
          };
        }
        if (entity.kind === 'building') {
          return {
            ...prev,
            layers: prev.layers.map((layer) =>
              layer.id === entity.layerId
                ? {
                    ...layer,
                    geometry: layer.geometry.filter((_, index) => index !== entity.polyIndex),
                  }
                : layer
            ),
          };
        }
        return prev;
      });
      setSelectedEntity(null);
    },
    [commitDocChange]
  );

  // Duplicate selected entity
  const handleDuplicateEntity = useCallback(
    (entity: NonNullable<SelectedEntity>) => {
      const offset = 20;
      const newId = `dup-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
      commitDocChange((prev) => {
        if (entity.kind === 'door') {
          const item = prev.doors.find((d) => d.id === entity.id);
          if (!item) return prev;
          return {
            ...prev,
            doors: [...prev.doors, { ...item, id: newId, x: item.x + offset, y: item.y + offset }],
          };
        }
        if (entity.kind === 'stair') {
          const item = prev.stairs.find((s) => s.id === entity.id);
          if (!item) return prev;
          return {
            ...prev,
            stairs: [...prev.stairs, { ...item, id: newId, x: item.x + offset, y: item.y + offset }],
          };
        }
        if (entity.kind === 'prop') {
          const item = prev.props.find((p) => p.id === entity.id);
          if (!item) return prev;
          return {
            ...prev,
            props: [...prev.props, { ...item, id: newId, x: item.x + offset, y: item.y + offset }],
          };
        }
        return prev;
      });
      setSelectedEntity({ kind: entity.kind, id: newId } as SelectedEntity);
    },
    [commitDocChange]
  );

  // Layer & Wall Style operations
  const handleChangeActiveLayerWallStyle = useCallback(
    (wallStyle: WallStyle) => {
      commitDocChange((prev) => ({
        ...prev,
        layers: prev.layers.map((l) =>
          l.id === prev.activeLayerId ? { ...l, wallStyle } : l
        ),
      }));
    },
    [commitDocChange]
  );

  const handleToggleActiveLayerHatch = useCallback(() => {
    commitDocChange((prev) => ({
      ...prev,
      layers: prev.layers.map((l) =>
        l.id === prev.activeLayerId ? { ...l, hatchEnabled: !l.hatchEnabled } : l
      ),
    }));
  }, [commitDocChange]);

  const handleChangeActiveLayerBuildingStyle = useCallback(
    (buildingStyle: BuildingStyle) => {
      commitDocChange((prev) => ({
        ...prev,
        layers: prev.layers.map((layer) =>
          layer.id === prev.activeLayerId ? { ...layer, buildingStyle } : layer
        ),
      }));
    },
    [commitDocChange]
  );

  const handleAddLayer = useCallback(
    (environment: LayerEnvironment) => {
      const newId = `layer-${Date.now()}`;
      commitDocChange((prev) => ({
        ...prev,
        activeLayerId: newId,
        layers: [
          ...prev.layers,
          createEmptyLayer(
            newId,
            environment === 'exterior'
              ? t('layers.defaultExterior', { n: prev.layers.length + 1 })
              : t('layers.defaultInterior', { n: prev.layers.length + 1 }),
            environment
          ),
        ],
      }));
      showToast(environment === 'exterior' ? t('toast.layerAddedExterior') : t('toast.layerAddedInterior'));
    },
    [commitDocChange, showToast, t]
  );

  const handleSetLayerEnvironment = useCallback(
    (layerId: string, environment: LayerEnvironment) => {
      commitDocChange((prev) => ({
        ...prev,
        layers: prev.layers.map((layer) =>
          layer.id === layerId
            ? {
                ...layer,
                environment,
                buildingStyle: layer.buildingStyle ?? 'roof_tile',
                roads: layer.roads ?? [],
              }
            : layer
        ),
      }));
    },
    [commitDocChange]
  );

  const handleDeleteLayer = useCallback(
    (layerId: string) => {
      commitDocChange((prev) => {
        if (prev.layers.length <= 1) return prev;
        const remaining = prev.layers.filter((l) => l.id !== layerId);
        const nextActive =
          prev.activeLayerId === layerId ? remaining[0].id : prev.activeLayerId;
        return {
          ...prev,
          layers: remaining,
          activeLayerId: nextActive,
        };
      });
    },
    [commitDocChange]
  );

  const handleToggleLayerVisibility = useCallback(
    (layerId: string) => {
      commitDocChange((prev) => ({
        ...prev,
        layers: prev.layers.map((l) =>
          l.id === layerId ? { ...l, visible: !l.visible } : l
        ),
      }));
    },
    [commitDocChange]
  );

  const handleRenameLayer = useCallback((layerId: string, name: string) => {
    setDoc((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.id === layerId ? { ...l, name } : l)),
    }));
  }, []);

  const handleChangeTheme = useCallback(
    (themeId: MapThemeId) => {
      commitDocChange((prev) => ({ ...prev, themeId }));
    },
    [commitDocChange]
  );

  // Preset & JSON loading
  const handleLoadPreset = useCallback(
    (preset: PresetId) => {
      const next = localizePresetDocument(createPresetDungeon(preset), preset, messages);
      setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), doc]);
      setFuture([]);
      setDoc(next);
      lastCommittedDocRef.current = next;
      setSelectedEntity(null);
      fitViewToDocument(next);
      showToast(t('toast.presetLoaded', { title: next.title }));
    },
    [doc, fitViewToDocument, messages, showToast, t]
  );

  const handleImportJsonFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          if (typeof reader.result !== 'string') return;
          const parsed = JSON.parse(reader.result) as DungeonDocument;
          if (!parsed.layers || !Array.isArray(parsed.layers)) {
            throw new Error('Nieprawidłowy format pliku mapy');
          }
          parsed.layers = parsed.layers.map((layer) => ({
            ...layer,
            environment: layer.environment === 'exterior' ? 'exterior' : 'interior',
            buildingStyle: layer.buildingStyle,
            geometry: Array.isArray(layer.geometry) ? layer.geometry : [],
            standaloneWalls: Array.isArray(layer.standaloneWalls) ? layer.standaloneWalls : [],
            texturePaints: Array.isArray(layer.texturePaints) ? layer.texturePaints : [],
            roads: Array.isArray(layer.roads) ? layer.roads : [],
          }));
          parsed.doors = Array.isArray(parsed.doors) ? parsed.doors : [];
          parsed.stairs = Array.isArray(parsed.stairs) ? parsed.stairs : [];
          parsed.props = Array.isArray(parsed.props) ? parsed.props : [];
          parsed.labels = Array.isArray(parsed.labels) ? parsed.labels : [];
          setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), doc]);
          setFuture([]);
          setDoc(parsed);
          lastCommittedDocRef.current = parsed;
          setSelectedEntity(null);
          fitViewToDocument(parsed);
          showToast(t('toast.mapLoaded', { title: parsed.title }));
        } catch {
          showToast(t('toast.jsonError'));
        }
      };
      reader.readAsText(file);
    },
    [doc, fitViewToDocument, showToast, t]
  );

  // Export handlers
  const handleExportSvg = async () => {
    try {
      await downloadSvgFile(doc, viewportRef.current);
      showToast(t('toast.svgExported'));
    } catch {
      showToast(t('toast.svgFailed'));
    }
  };

  const handleExportPng = async () => {
    try {
      await downloadPngFile(doc, viewportRef.current);
      showToast(t('toast.pngExported'));
    } catch {
      showToast(t('toast.pngFailed'));
    }
  };

  const handleExportJson = () => {
    downloadJsonProject(doc);
    showToast(t('toast.jsonSaved'));
  };

  return (
    <div className="w-screen h-screen flex flex-col bg-[#141619] text-[#F1F3F5] overflow-hidden">
      <TopBar
        title={doc.title}
        onTitleChange={(title) => setDoc((prev) => ({ ...prev, title }))}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        zoom={zoom}
        onZoomChange={setZoom}
        onResetView={() => fitViewToDocument(doc)}
        snapEnabled={snapEnabled}
        onToggleSnap={() => setSnapEnabled((s) => !s)}
        showGrid={doc.showGrid}
        onToggleGrid={() => setDoc((prev) => ({ ...prev, showGrid: !prev.showGrid }))}
        onLoadPreset={handleLoadPreset}
        themeId={doc.themeId}
        onChangeTheme={handleChangeTheme}
        onExportSvg={handleExportSvg}
        onExportPng={handleExportPng}
        onExportJson={handleExportJson}
        onImportJsonFile={handleImportJsonFile}
        onOpenSvgInspector={() => setSvgInspectorOpen(true)}
      />

      <div className="flex-1 flex min-h-0 relative">
        <LeftToolbar
          activeTool={activeTool}
          environment={layerEnvironment(
            doc.layers.find((layer) => layer.id === doc.activeLayerId) ?? doc.layers[0]
          )}
          eraserShape={eraserShape}
          onChangeEraserShape={setEraserShape}
          onSelectTool={(t) => {
            setActiveTool(t);
            if (t !== 'select') setSelectedEntity(null);
          }}
        />

        <main className="flex-1 relative min-w-0 h-full">
          <MapCanvas
            doc={doc}
            activeTool={activeTool}
            selectedEntity={selectedEntity}
            onSelectEntity={setSelectedEntity}
            snapEnabled={snapEnabled}
            corridorWidthCells={corridorWidthCells}
            corridorElbowMode={corridorElbowMode}
            onToggleCorridorElbow={() => setCorridorElbowMode((v) => !v)}
            caveBrushCells={caveBrushCells}
            texturePath={texturePath}
            textureShape={textureShape}
            textureMode={textureMode}
            textureBrushCells={textureBrushCells}
            textureSoftness={textureSoftness}
            textureErasing={textureErasing}
            onApplyTexturePaint={handleApplyTexturePaint}
            onEraseTexture={handleEraseTexture}
            onTextureNotice={showToast}
            activeDoorType={activeDoorType}
            activeStairType={activeStairType}
            activePropPreset={activePropPreset}
            pendingRotation={pendingRotation}
            roadStyle={roadStyle}
            onCarveFloor={handleCarveFloor}
            onAddStandaloneWall={handleAddStandaloneWall}
            onAddRoad={handleAddRoad}
            onEraseRoads={handleEraseRoads}
            onGenerateDistrict={handleGenerateDistrict}
            eraserShape={eraserShape}
            eraserStrokeCells={eraserStrokeCells}
            districtArea={districtArea}
            onPlaceDoor={handlePlaceDoor}
            onPlaceStair={handlePlaceStair}
            onPlaceProp={handlePlaceProp}
            onPlaceLabel={handlePlaceLabel}
            onUpdateEntity={handleUpdateEntity}
            onDeleteEntity={handleDeleteEntity}
            zoom={zoom}
            onZoomChange={setZoom}
            pan={pan}
            onPanChange={setPan}
            viewportRef={viewportRef}
          />

          {/* Floating Toast Notification */}
          {toastMsg && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full bg-[#1C1F24] border border-indigo-500/50 text-xs font-medium text-[#F1F3F5] shadow-xl z-40 pointer-events-none">
              {toastMsg}
            </div>
          )}
        </main>

        <RightInspector
          doc={doc}
          activeTool={activeTool}
          selectedEntity={selectedEntity}
          onSelectEntity={setSelectedEntity}
          corridorWidthCells={corridorWidthCells}
          onChangeCorridorWidth={setCorridorWidthCells}
          corridorElbowMode={corridorElbowMode}
          onToggleCorridorElbow={() => setCorridorElbowMode((v) => !v)}
          caveBrushCells={caveBrushCells}
          onChangeCaveBrush={setCaveBrushCells}
          eraserShape={eraserShape}
          onChangeEraserShape={setEraserShape}
          eraserStrokeCells={eraserStrokeCells}
          onChangeEraserStroke={setEraserStrokeCells}
          districtDensity={districtDensity}
          onChangeDistrictDensity={setDistrictDensity}
          districtSize={districtSize}
          onChangeDistrictSize={setDistrictSize}
          districtAngle={districtAngle}
          onChangeDistrictAngle={setDistrictAngle}
          districtArea={districtArea}
          onChangeDistrictArea={setDistrictArea}
          texturePath={texturePath}
          onChangeTexturePath={setTexturePath}
          textureShape={textureShape}
          onChangeTextureShape={setTextureShape}
          textureMode={textureMode}
          onChangeTextureMode={setTextureMode}
          textureBrushCells={textureBrushCells}
          onChangeTextureBrush={setTextureBrushCells}
          textureSoftness={textureSoftness}
          onChangeTextureSoftness={setTextureSoftness}
          textureErasing={textureErasing}
          onToggleTextureErasing={() => setTextureErasing((value) => !value)}
          activeDoorType={activeDoorType}
          onChangeDoorType={setActiveDoorType}
          activeStairType={activeStairType}
          onChangeStairType={setActiveStairType}
          activePropPreset={activePropPreset}
          onSelectPropPreset={setActivePropPreset}
          pendingRotation={pendingRotation}
          onChangePendingRotation={setPendingRotation}
          onChangeActiveLayerWallStyle={handleChangeActiveLayerWallStyle}
          onChangeActiveLayerBuildingStyle={handleChangeActiveLayerBuildingStyle}
          onToggleActiveLayerHatch={handleToggleActiveLayerHatch}
          onSelectActiveLayer={(layerId) =>
            setDoc((prev) => ({ ...prev, activeLayerId: layerId }))
          }
          onAddLayer={handleAddLayer}
          onSetLayerEnvironment={handleSetLayerEnvironment}
          roadStyle={roadStyle}
          onChangeRoadStyle={setRoadStyle}
          exteriorWallStyle={exteriorWallStyle}
          onChangeExteriorWallStyle={setExteriorWallStyle}
          exteriorWallTowers={exteriorWallTowers}
          onToggleExteriorWallTowers={() => setExteriorWallTowers((value) => !value)}
          onDeleteLayer={handleDeleteLayer}
          onToggleLayerVisibility={handleToggleLayerVisibility}
          onRenameLayer={handleRenameLayer}
          onUpdateEntity={handleUpdateEntity}
          onDeleteEntity={handleDeleteEntity}
          onDuplicateEntity={handleDuplicateEntity}
        />
      </div>

      <SvgInspectorModal
        isOpen={svgInspectorOpen}
        onClose={() => setSvgInspectorOpen(false)}
        doc={doc}
        viewportEl={viewportRef.current}
        onDownloadSvg={handleExportSvg}
      />
    </div>
  );
}

export default App;
