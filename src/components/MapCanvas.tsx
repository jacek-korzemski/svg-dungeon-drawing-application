import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readImageFile, resolveAssetUrl } from '../data/assetLibrary';
import { MAP_THEMES } from '../data/presets';
import {
  DoorItem,
  DoorType,
  DungeonDocument,
  DistrictAreaShape,
  EraserShape,
  LabelItem,
  Point2D,
  Polygon2D,
  TextureDab,
  PropBrush,
  PropItem,
  SelectedEntity,
  StairItem,
  StairType,
  TextureBrushShape,
  TexturePaint,
  ToolType,
  MultiPolygon2D,
  RoadStyle,
  doorWidthCells,
  layerEnvironment,
} from '../types/dungeon';
import {
  buildExteriorBuildingData,
  buildStylizedWallData,
  circleToPolygon,
  computeElbowPath,
  corridorPathToMultiPolygon,
  findNearestWallSnap,
  GRID_SIZE,
  multiPolygonToSvgPath,
  polygonCentroid,
  polygonEdgeAngle,
  rectToPolygon,
  rotatePolygon,
  snapToGrid,
  translatePolygon,
  unionGeometry,
} from '../utils/geometry';
import {
  dabsToMultiPolygon,
  fillEnclosedRoom,
  fillExteriorArea,
  newTexturePaintId,
  stampDabs,
  textureBlurPx,
} from '../utils/texturePaint';
import { useI18n } from '../i18n';
import { ExteriorLayerGraphics } from './ExteriorArt';
import { SvgDoorArtwork, SvgPropArtwork, SvgStairArtwork } from './SvgPropArtwork';
import { draftTexturePaint, FloorTextureResources, FloorTextureStack } from './FloorTextureLayer';

interface MapCanvasProps {
  doc: DungeonDocument;
  activeTool: ToolType;
  selectedEntity: SelectedEntity;
  onSelectEntity: (entity: SelectedEntity) => void;
  snapEnabled: boolean;
  // Tool options
  corridorWidthCells: number;
  corridorElbowMode: boolean;
  onToggleCorridorElbow: () => void;
  caveBrushCells: number;
  texturePath: string;
  textureShape: TextureBrushShape;
  textureMode: 'brush' | 'bucket';
  textureBrushCells: number;
  textureSoftness: number;
  textureErasing: boolean;
  onApplyTexturePaint: (paint: TexturePaint) => void;
  onEraseTexture: (cut: MultiPolygon2D) => void;
  onTextureNotice: (message: string) => void;
  activeDoorType: DoorType;
  activeStairType: StairType;
  activePropPreset: PropBrush;
  pendingRotation: number;
  // Mutators
  roadStyle: RoadStyle;
  onCarveFloor: (polygonOrMulti: Point2D[][][], mode: 'add' | 'subtract') => void;
  onAddStandaloneWall: (points: Point2D[]) => void;
  onAddRoad: (points: Point2D[]) => void;
  onEraseRoads: (cut: MultiPolygon2D) => void;
  onGenerateDistrict: (region: Polygon2D) => void;
  eraserShape: EraserShape;
  eraserStrokeCells: number;
  districtArea: DistrictAreaShape;
  onPlaceDoor: (door: Omit<DoorItem, 'id'>) => void;
  onPlaceStair: (stair: Omit<StairItem, 'id'>) => void;
  onPlaceProp: (prop: Omit<PropItem, 'id'>) => void;
  onPlaceLabel: (label: Omit<LabelItem, 'id'>) => void;
  onUpdateEntity: (
    entity: NonNullable<SelectedEntity>,
    patch: Record<string, unknown>,
    commitHistory?: boolean
  ) => void;
  onDeleteEntity: (entity: NonNullable<SelectedEntity>) => void;
  // Camera
  zoom: number;
  onZoomChange: (newZoom: number) => void;
  pan: { x: number; y: number };
  onPanChange: (newPan: { x: number; y: number }) => void;
  // Ref for SVG export
  viewportRef: React.RefObject<SVGGElement | null>;
  onCursorWorldMove?: (pt: Point2D) => void;
}

export const MapCanvas: React.FC<MapCanvasProps> = ({
  doc,
  activeTool,
  selectedEntity,
  onSelectEntity,
  snapEnabled,
  corridorWidthCells,
  corridorElbowMode,
  onToggleCorridorElbow,
  caveBrushCells,
  texturePath,
  textureShape,
  textureMode,
  textureBrushCells,
  textureSoftness,
  textureErasing,
  onApplyTexturePaint,
  onEraseTexture,
  onTextureNotice,
  activeDoorType,
  activeStairType,
  activePropPreset,
  pendingRotation,
  roadStyle,
  onCarveFloor,
  onAddStandaloneWall,
  onAddRoad,
  onEraseRoads,
  onGenerateDistrict,
  eraserShape,
  eraserStrokeCells,
  districtArea,
  onPlaceDoor,
  onPlaceStair,
  onPlaceProp,
  onPlaceLabel,
  onUpdateEntity,
  onDeleteEntity,
  zoom,
  onZoomChange,
  pan,
  onPanChange,
  viewportRef,
  onCursorWorldMove,
}) => {
  const { t } = useI18n();
  const svgRootRef = useRef<SVGSVGElement | null>(null);
  const theme = MAP_THEMES[doc.themeId];
  const G = doc.gridSize || GRID_SIZE;
  const ink = G / 32;
  const activeLayer = doc.layers.find((layer) => layer.id === doc.activeLayerId) ?? doc.layers[0];
  const exteriorActive = activeLayer ? layerEnvironment(activeLayer) === 'exterior' : false;
  const worldExtent = 400 * G;

  // Interactive gesture states
  const [isPanning, setIsPanning] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const panStartRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | null>(
    null
  );

  // Drawing states
  const [dragStart, setDragStart] = useState<Point2D | null>(null);
  const [cursorWorld, setCursorWorld] = useState<Point2D>([0, 0]);
  const [rawCursorWorld, setRawCursorWorld] = useState<Point2D>([0, 0]);
  const [elbowHorizFirst, setElbowHorizFirst] = useState(true);
  const [polygonPts, setPolygonPts] = useState<Point2D[]>([]);
  const [caveStrokePts, setCaveStrokePts] = useState<Point2D[]>([]);
  const textureSamplesRef = useRef<Point2D[]>([]);
  const textureDabsRef = useRef<TextureDab[]>([]);
  const texturePaintingRef = useRef(false);
  const [textureDraft, setTextureDraft] = useState<TextureDab[] | null>(null);

  // Entity dragging / rotating states
  const [draggingEntity, setDraggingEntity] = useState<{
    entity: NonNullable<SelectedEntity>;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null>(null);

  const [rotatingEntity, setRotatingEntity] = useState<{
    entity: NonNullable<SelectedEntity>;
    centerX: number;
    centerY: number;
    originPolygon?: Polygon2D;
    startPointerAngle?: number;
  } | null>(null);
  const [draggingBuilding, setDraggingBuilding] = useState<{
    entity: { kind: 'building'; layerId: string; polyIndex: number };
    origin: Polygon2D;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  // Convert screen mouse event to world coordinates
  const screenToWorld = useCallback(
    (clientX: number, clientY: number, applySnap = snapEnabled): Point2D => {
      const rect = svgRootRef.current?.getBoundingClientRect();
      if (!rect) return [0, 0];
      const wx = (clientX - rect.left - pan.x) / zoom;
      const wy = (clientY - rect.top - pan.y) / zoom;
      if (applySnap) {
        return [snapToGrid(wx, G, 1), snapToGrid(wy, G, 1)];
      }
      return [Math.round(wx), Math.round(wy)];
    },
    [pan.x, pan.y, zoom, snapEnabled, G]
  );

  // Keyboard shortcuts for Space panning & Tab elbow flipping & Escape cancel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setSpacePressed(true);
      } else if (e.key === 'Tab' && activeTool === 'corridor') {
        e.preventDefault();
        setElbowHorizFirst((prev) => !prev);
      } else if (e.key === 'Escape') {
        setDragStart(null);
        setPolygonPts([]);
        setCaveStrokePts([]);
        onSelectEntity(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEntity) {
        e.preventDefault();
        onDeleteEntity(selectedEntity);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
        setIsPanning(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [activeTool, selectedEntity, onDeleteEntity, onSelectEntity]);

  // Clear incomplete polygon if switching tools
  useEffect(() => {
    setDragStart(null);
    setPolygonPts([]);
    setCaveStrokePts([]);
  }, [activeTool, eraserShape, districtArea]);

  // Precompute memoized SVG geometry & stylized walls per layer
  const renderedLayers = useMemo(() => {
    return doc.layers.map((layer) => {
      const exterior = layerEnvironment(layer) === 'exterior';
      const floorPath = multiPolygonToSvgPath(layer.geometry);
      return {
        layer,
        floorPath,
        wallData: exterior ? null : buildStylizedWallData(layer.geometry, layer.wallStyle, G),
        buildingData: exterior
          ? buildExteriorBuildingData(layer.geometry, layer.buildingStyle ?? 'roof_tile', G)
          : null,
      };
    });
  }, [doc.layers, G]);

  const textureBlurLevels = useMemo(() => {
    const levels = new Set<number>();
    for (const layer of doc.layers) {
      for (const paint of layer.texturePaints ?? []) {
        const px = textureBlurPx(paint);
        if (px > 0) levels.add(px);
      }
    }
    if (textureDraft && !textureErasing) {
      const px = textureBlurPx(
        draftTexturePaint(textureDraft, textureShape, textureSoftness, texturePath)
      );
      if (px > 0) levels.add(px);
    }
    return [...levels];
  }, [doc.layers, textureDraft, textureErasing, textureShape, textureSoftness, texturePath]);

  // Door ghost preview calculation
  const doorPreview = useMemo(() => {
    if (activeTool !== 'door') return null;
    const snap = findNearestWallSnap(rawCursorWorld[0], rawCursorWorld[1], doc.layers, G * 1.1);
    return {
      x: snap.snapped ? snap.x : cursorWorld[0],
      y: snap.snapped ? snap.y : cursorWorld[1],
      rotation: snap.snapped ? snap.rotation : pendingRotation,
      snapped: snap.snapped,
    };
  }, [activeTool, rawCursorWorld, cursorWorld, doc.layers, G, pendingRotation]);

  // Wheel zoom centered on pointer
  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = svgRootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;
    const worldX = (pointerX - pan.x) / zoom;
    const worldY = (pointerY - pan.y) / zoom;

    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const nextZoom = Math.min(3.0, Math.max(0.15, Number((zoom * factor).toFixed(3))));
    const nextPanX = pointerX - worldX * nextZoom;
    const nextPanY = pointerY - worldY * nextZoom;

    onZoomChange(nextZoom);
    onPanChange({ x: nextPanX, y: nextPanY });
  };

  // Pointer Down
  const finishPolygon = (ring: Point2D[]) => {
    const shape: Polygon2D = [ring];
    if (activeTool === 'polygon') onCarveFloor([shape], 'add');
    else if (activeTool === 'district') onGenerateDistrict(shape);
    else if (activeTool === 'eraser') {
      onCarveFloor([shape], 'subtract');
      if (exteriorActive) onEraseRoads([shape]);
    }
    setPolygonPts([]);
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // Middle click, Space+click, or Pan tool
    if (e.button === 1 || spacePressed || activeTool === 'pan') {
      e.preventDefault();
      setIsPanning(true);
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      return;
    }

    if (e.button !== 0) return;

    const snappedPt = screenToWorld(e.clientX, e.clientY, snapEnabled);
    const rawPt = screenToWorld(e.clientX, e.clientY, false);

    if (activeTool === 'texture') {
      const layer = doc.layers.find((item) => item.id === doc.activeLayerId) ?? doc.layers[0];
      if (textureMode === 'bucket') {
        if (!layer) return;
        const exterior = layerEnvironment(layer) === 'exterior';
        const region = exterior
          ? fillExteriorArea(layer, rawPt[0], rawPt[1])
          : fillEnclosedRoom(layer, rawPt[0], rawPt[1]);
        if (!region) {
          onTextureNotice(exterior ? t('toast.openGround') : t('toast.closedRoom'));
          return;
        }
        onApplyTexturePaint({
          id: newTexturePaintId(),
          texturePath,
          softness: textureSoftness,
          kind: 'fill',
          shape: 'bucket',
          dabs: [],
          region,
        });
        return;
      }
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {
        // The stroke still commits on pointerup over the canvas.
      }
      const radius = (textureBrushCells * G) / 2;
      const dabs = stampDabs(rawPt[0], rawPt[1], radius, textureShape, 0);
      textureSamplesRef.current = [rawPt];
      textureDabsRef.current = dabs;
      texturePaintingRef.current = true;
      setTextureDraft(dabs);
      return;
    }

    if (activeTool === 'select') {
      // Clicked empty canvas -> deselect
      if (e.target === svgRootRef.current || (e.target as HTMLElement)?.dataset?.canvasBg) {
        onSelectEntity(null);
      }
      return;
    }

    const polygonErase = activeTool === 'eraser' && eraserShape === 'polygon';
    const strokeErase = activeTool === 'eraser' && eraserShape === 'stroke';
    const districtPolygon = activeTool === 'district' && districtArea === 'polygon';

    if (
      activeTool === 'room' ||
      activeTool === 'corridor' ||
      activeTool === 'wall' ||
      (activeTool === 'eraser' && eraserShape === 'rect') ||
      (activeTool === 'district' && districtArea === 'rect')
    ) {
      setDragStart(snappedPt);
      return;
    }

    if (activeTool === 'cave' || strokeErase) {
      setDragStart(rawPt);
      setCaveStrokePts([rawPt]);
      return;
    }

    if (activeTool === 'polygon' || polygonErase || districtPolygon) {
      if (polygonPts.length >= 3) {
        const first = polygonPts[0];
        if (Math.hypot(snappedPt[0] - first[0], snappedPt[1] - first[1]) < G * 0.65) {
          const ring = [...polygonPts, [...first] as Point2D];
          finishPolygon(ring);
          return;
        }
      }
      setPolygonPts((prev) => [...prev, snappedPt]);
      return;
    }

    if (activeTool === 'door' && doorPreview) {
      onPlaceDoor({
        x: doorPreview.x,
        y: doorPreview.y,
        rotation: doorPreview.rotation,
        type: activeDoorType,
        widthCells: doorWidthCells(activeDoorType),
      });
      return;
    }

    if (activeTool === 'stairs') {
      const widthCells = activeStairType === 'wide' ? 2 : activeStairType === 'spiral' ? 1.5 : 1;
      const lengthCells = activeStairType === 'spiral' ? 1.5 : 2;
      onPlaceStair({
        x: snappedPt[0],
        y: snappedPt[1],
        rotation: pendingRotation,
        type: activeStairType,
        widthCells,
        lengthCells,
      });
      return;
    }

    if (activeTool === 'prop') {
      onPlaceProp({
        x: snappedPt[0],
        y: snappedPt[1],
        rotation: pendingRotation,
        scale: 1,
        kind: activePropPreset.kind,
        svgPropId: activePropPreset.svgPropId,
        pngDataUrl: activePropPreset.pngDataUrl,
        assetPath: activePropPreset.assetPath,
        label: activePropPreset.label,
        widthPx: activePropPreset.widthPx,
        heightPx: activePropPreset.heightPx,
      });
      return;
    }

    if (activeTool === 'label') {
      const nextNum = String(doc.labels.length + 1);
      onPlaceLabel({
        x: snappedPt[0],
        y: snappedPt[1],
        badgeNumber: nextNum,
        text: exteriorActive ? t('canvas.placeName', { n: nextNum }) : t('canvas.roomName', { n: nextNum }),
        fontSize: 13 * ink,
        rotation: 0,
      });
      return;
    }
  };

  // Pointer Move
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (isPanning && panStartRef.current) {
      const dx = e.clientX - panStartRef.current.clientX;
      const dy = e.clientY - panStartRef.current.clientY;
      onPanChange({
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy,
      });
      return;
    }

    const snappedPt = screenToWorld(e.clientX, e.clientY, snapEnabled);
    const rawPt = screenToWorld(e.clientX, e.clientY, false);
    setCursorWorld(snappedPt);
    setRawCursorWorld(rawPt);
    onCursorWorldMove?.(snappedPt);

    if (texturePaintingRef.current && activeTool === 'texture' && textureMode === 'brush') {
      const radius = (textureBrushCells * G) / 2;
      const spacing = Math.max(4, textureShape === 'spray' ? radius * 0.5 : radius * 0.32);
      const samples = textureSamplesRef.current;
      const last = samples[samples.length - 1];
      if (last) {
        const dist = Math.hypot(rawPt[0] - last[0], rawPt[1] - last[1]);
        if (dist >= spacing) {
          const steps = Math.max(1, Math.floor(dist / spacing));
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const x = last[0] + (rawPt[0] - last[0]) * t;
            const y = last[1] + (rawPt[1] - last[1]) * t;
            samples.push([x, y]);
            textureDabsRef.current = textureDabsRef.current.concat(
              stampDabs(x, y, radius, textureShape, samples.length)
            );
          }
          setTextureDraft(textureDabsRef.current.slice());
        }
      }
    }

    // Handle rotating selected entity
    if (rotatingEntity) {
      const angleRad = Math.atan2(
        rawPt[1] - rotatingEntity.centerY,
        rawPt[0] - rotatingEntity.centerX
      );
      if (rotatingEntity.originPolygon && rotatingEntity.startPointerAngle !== undefined) {
        let delta = angleRad - rotatingEntity.startPointerAngle;
        if (!e.shiftKey) {
          const base = polygonEdgeAngle(rotatingEntity.originPolygon);
          const target = Math.round((base + delta) / (Math.PI / 12)) * (Math.PI / 12);
          delta = target - base;
        }
        onUpdateEntity(
          rotatingEntity.entity,
          { polygon: rotatePolygon(rotatingEntity.originPolygon, delta, [rotatingEntity.centerX, rotatingEntity.centerY]) },
          false
        );
      } else {
        let deg = (angleRad * 180) / Math.PI + 90;
        if (!e.shiftKey) {
          deg = Math.round(deg / 15) * 15;
        } else {
          deg = Math.round(deg);
        }
        onUpdateEntity(rotatingEntity.entity, { rotation: deg }, false);
      }
      return;
    }

    if (draggingBuilding) {
      const dx = rawPt[0] - draggingBuilding.startX;
      const dy = rawPt[1] - draggingBuilding.startY;
      const center = polygonCentroid(draggingBuilding.origin);
      const nextX = snapEnabled && !e.shiftKey ? snapToGrid(center[0] + dx, G, 2) : center[0] + dx;
      const nextY = snapEnabled && !e.shiftKey ? snapToGrid(center[1] + dy, G, 2) : center[1] + dy;
      setDraggingBuilding((prev) => (prev ? { ...prev, moved: true } : null));
      onUpdateEntity(
        draggingBuilding.entity,
        { polygon: translatePolygon(draggingBuilding.origin, nextX - center[0], nextY - center[1]) },
        false
      );
      return;
    }

    // Handle dragging selected entity
    if (draggingEntity) {
      const targetX = rawPt[0] - draggingEntity.offsetX;
      const targetY = rawPt[1] - draggingEntity.offsetY;
      const finalX = snapEnabled && !e.shiftKey ? snapToGrid(targetX, G, 2) : Math.round(targetX);
      const finalY = snapEnabled && !e.shiftKey ? snapToGrid(targetY, G, 2) : Math.round(targetY);

      setDraggingEntity((prev) => (prev ? { ...prev, moved: true } : null));
      onUpdateEntity(draggingEntity.entity, { x: finalX, y: finalY }, false);
      return;
    }

    // Handle cave freehand brush stroke
    if ((activeTool === 'cave' || (activeTool === 'eraser' && eraserShape === 'stroke')) && dragStart) {
      setCaveStrokePts((prev) => {
        const last = prev[prev.length - 1];
        if (!last || Math.hypot(rawPt[0] - last[0], rawPt[1] - last[1]) >= G * 0.25) {
          return [...prev, rawPt];
        }
        return prev;
      });
    }
  };

  // Pointer Up
  const handlePointerUp = () => {
    if (isPanning) {
      setIsPanning(false);
      panStartRef.current = null;
      return;
    }

    if (rotatingEntity) {
      onUpdateEntity(rotatingEntity.entity, {}, true);
      setRotatingEntity(null);
      return;
    }

    if (draggingBuilding) {
      if (draggingBuilding.moved) onUpdateEntity(draggingBuilding.entity, {}, true);
      setDraggingBuilding(null);
      return;
    }

    if (texturePaintingRef.current) {
      const dabs = textureDabsRef.current.slice();
      texturePaintingRef.current = false;
      textureDabsRef.current = [];
      textureSamplesRef.current = [];
      setTextureDraft(null);
      if (dabs.length > 0) {
        if (textureErasing) {
          const cut = dabsToMultiPolygon(dabs, textureShape);
          if (cut.length > 0) onEraseTexture(cut);
        } else {
          onApplyTexturePaint({
            id: newTexturePaintId(),
            texturePath,
            softness: textureSoftness,
            kind: 'dabs',
            shape: textureShape,
            dabs,
            region: [],
          });
        }
      }
      return;
    }

    if (draggingEntity) {
      if (draggingEntity.moved) {
        onUpdateEntity(draggingEntity.entity, {}, true);
      }
      setDraggingEntity(null);
      return;
    }

    if (!dragStart) return;

    if (activeTool === 'room') {
      const poly = rectToPolygon(dragStart[0], dragStart[1], cursorWorld[0], cursorWorld[1]);
      if (poly.length > 0) {
        onCarveFloor([poly], 'add');
      }
    } else if (activeTool === 'district' && districtArea === 'rect') {
      const poly = rectToPolygon(dragStart[0], dragStart[1], cursorWorld[0], cursorWorld[1]);
      if (poly.length > 0) onGenerateDistrict(poly);
    } else if (activeTool === 'eraser' && eraserShape === 'rect') {
      const poly = rectToPolygon(dragStart[0], dragStart[1], cursorWorld[0], cursorWorld[1]);
      if (poly.length > 0) {
        onCarveFloor([poly], 'subtract');
        if (exteriorActive) onEraseRoads([poly]);
      }
    } else if (activeTool === 'eraser' && eraserShape === 'stroke') {
      const ribbon = corridorPathToMultiPolygon(caveStrokePts, eraserStrokeCells * G);
      if (ribbon.length > 0) {
        onCarveFloor(ribbon, 'subtract');
        if (exteriorActive) onEraseRoads(ribbon);
      }
      setCaveStrokePts([]);
    } else if (activeTool === 'corridor') {
      const pathPts = corridorElbowMode
        ? computeElbowPath(dragStart, cursorWorld, elbowHorizFirst)
        : [dragStart, cursorWorld];
      if (exteriorActive) {
        onAddRoad(pathPts);
      } else {
        const mp = corridorPathToMultiPolygon(pathPts, corridorWidthCells * G);
        if (mp.length > 0) {
          onCarveFloor(mp, 'add');
        }
      }
    } else if (activeTool === 'cave') {
      const radius = (caveBrushCells * G) / 2;
      let acc: Point2D[][][] = [];
      for (const pt of caveStrokePts) {
        const cPoly = circleToPolygon(pt[0], pt[1], radius, 14);
        acc = unionGeometry(acc, [cPoly]);
      }
      if (acc.length > 0) {
        onCarveFloor(acc, 'add');
      }
      setCaveStrokePts([]);
    } else if (activeTool === 'wall') {
      if (Math.hypot(cursorWorld[0] - dragStart[0], cursorWorld[1] - dragStart[1]) >= 4 * ink) {
        onAddStandaloneWall([dragStart, cursorWorld]);
      }
    }

    setDragStart(null);
  };

  // Handle Double Click to finish polygon room
  const handleDoubleClick = () => {
    const drawing =
      activeTool === 'polygon' ||
      (activeTool === 'eraser' && eraserShape === 'polygon') ||
      (activeTool === 'district' && districtArea === 'polygon');
    if (drawing && polygonPts.length >= 3) {
      finishPolygon([...polygonPts, [...polygonPts[0]] as Point2D]);
    }
  };

  // Drag & Drop external PNG/Image files straight onto the dungeon map!
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const dropPt = screenToWorld(e.clientX, e.clientY, snapEnabled);
    readImageFile(file)
      .then(({ dataUrl, width, height }) => {
        onPlaceProp({
          x: dropPt[0],
          y: dropPt[1],
          rotation: 0,
          scale: 1,
          kind: 'png',
          pngDataUrl: dataUrl,
          label: file.name.replace(/\.[^.]+$/, ''),
          widthPx: width,
          heightPx: height,
        });
      })
      .catch(() => undefined);
  };

  // Start dragging an existing entity in Select mode
  const startEntityDrag = (
    e: React.PointerEvent,
    entity: NonNullable<SelectedEntity>,
    entityX: number,
    entityY: number
  ) => {
    if (activeTool !== 'select' || spacePressed) return;
    e.stopPropagation();
    onSelectEntity(entity);
    const rawPt = screenToWorld(e.clientX, e.clientY, false);
    setDraggingEntity({
      entity,
      offsetX: rawPt[0] - entityX,
      offsetY: rawPt[1] - entityY,
      moved: false,
    });
  };

  // Compute selection gizmo coordinates
  const selectionInfo = useMemo(() => {
    if (!selectedEntity) return null;
    if (selectedEntity.kind === 'door') {
      const d = doc.doors.find((item) => item.id === selectedEntity.id);
      if (!d) return null;
      return { x: d.x, y: d.y, rotation: d.rotation, radius: (d.widthCells * G) / 2 + 10 * ink };
    }
    if (selectedEntity.kind === 'stair') {
      const s = doc.stairs.find((item) => item.id === selectedEntity.id);
      if (!s) return null;
      return {
        x: s.x,
        y: s.y,
        rotation: s.rotation,
        radius: (Math.max(s.widthCells, s.lengthCells) * G) / 2 + 10 * ink,
      };
    }
    if (selectedEntity.kind === 'prop') {
      const p = doc.props.find((item) => item.id === selectedEntity.id);
      if (!p) return null;
      return {
        x: p.x,
        y: p.y,
        rotation: p.rotation,
        radius: (Math.max(p.widthPx, p.heightPx) * p.scale) / 2 + 10 * ink,
      };
    }
    if (selectedEntity.kind === 'label') {
      const l = doc.labels.find((item) => item.id === selectedEntity.id);
      if (!l) return null;
      return { x: l.x, y: l.y, rotation: l.rotation, radius: 28 * ink };
    }
    if (selectedEntity.kind === 'building') {
      const layer = doc.layers.find((item) => item.id === selectedEntity.layerId);
      const polygon = layer?.geometry[selectedEntity.polyIndex];
      if (!polygon?.[0]?.length) return null;
      const [x, y] = polygonCentroid(polygon);
      let radius = 24 * ink;
      for (const point of polygon[0]) {
        radius = Math.max(radius, Math.hypot(point[0] - x, point[1] - y) + 8 * ink);
      }
      return { x, y, rotation: (polygonEdgeAngle(polygon) * 180) / Math.PI, radius, polygon };
    }
    return null;
  }, [selectedEntity, doc, G, ink]);

  const cursorClass =
    isPanning || spacePressed || activeTool === 'pan'
      ? 'cursor-grab active:cursor-grabbing'
      : activeTool === 'select'
        ? 'cursor-default'
        : 'cursor-crosshair';

  return (
    <div
      className="relative w-full h-full overflow-hidden"
      style={{ backgroundColor: theme.bgVoid }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <svg
        ref={svgRootRef}
        className={`w-full h-full block touch-none ${cursorClass}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <defs>
          {/* Jinkline Diagonal Crosshatch Pattern */}
          <pattern
            id="ds-hatch-pattern"
            width={10 * ink}
            height={10 * ink}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2={10 * ink}
              stroke={theme.hatchStroke}
              strokeWidth={1.4 * ink}
              strokeOpacity="0.45"
            />
            <line
              x1={5 * ink}
              y1="0"
              x2={5 * ink}
              y2={10 * ink}
              stroke={theme.hatchStroke}
              strokeWidth={0.9 * ink}
              strokeOpacity="0.24"
            />
          </pattern>

          {/* Void Background Grid */}
          <pattern id="ds-void-grid" width={G} height={G} patternUnits="userSpaceOnUse">
            <path
              d={`M ${G} 0 L 0 0 0 ${G}`}
              fill="none"
              stroke={theme.gridMajor}
              strokeWidth={ink}
            />
          </pattern>

          {/* Interior Room Floor Grid */}
          <pattern id="ds-floor-grid" width={G} height={G} patternUnits="userSpaceOnUse">
            <path
              d={`M ${G} 0 L 0 0 0 ${G}`}
              fill="none"
              stroke={theme.floorGrid}
              strokeWidth={ink}
            />
          </pattern>

          {/* Subtle Drop Shadow for PNG & Vector Props */}
          <filter id="ds-prop-shadow" x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow dx={1.5 * ink} dy={2 * ink} stdDeviation={1.5 * ink} floodColor="#000000" floodOpacity="0.28" />
          </filter>
        </defs>

        {/* Camera Transform Group */}
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Infinite Drafting Grid Backdrop (ignored in cropped SVG export which uses its own bounded grid) */}
          <g data-export-ignore="true">
            <rect
              data-canvas-bg="true"
              x={-worldExtent}
              y={-worldExtent}
              width={worldExtent * 2}
              height={worldExtent * 2}
              fill={theme.bgVoid}
            />
            {doc.showGrid && (
              <rect
                data-canvas-bg="true"
                x={-worldExtent}
                y={-worldExtent}
                width={worldExtent * 2}
                height={worldExtent * 2}
                fill="url(#ds-void-grid)"
              />
            )}
          </g>

          {activeTool === 'select' && (
            <g data-export-ignore="true">
              {[...doc.layers].reverse().map((layer) => {
                if (!layer.visible) return null;
                return layer.geometry.map((polygon, index) => {
                  const d = multiPolygonToSvgPath([polygon]);
                  if (!d) return null;
                  const selected =
                    selectedEntity?.kind === 'building' &&
                    selectedEntity.layerId === layer.id &&
                    selectedEntity.polyIndex === index;
                  return (
                    <path
                      key={`${layer.id}-${index}`}
                      d={d}
                      fill={selected ? 'rgba(59, 130, 246, 0.12)' : 'rgba(0,0,0,0.001)'}
                      stroke={selected ? '#3B82F6' : 'none'}
                      strokeWidth={1.5 * ink}
                      className="cursor-move"
                      onPointerDown={(event) => {
                        if (spacePressed) return;
                        event.stopPropagation();
                        const entity = { kind: 'building' as const, layerId: layer.id, polyIndex: index };
                        onSelectEntity(entity);
                        const rawPt = screenToWorld(event.clientX, event.clientY, false);
                        setDraggingBuilding({
                          entity,
                          origin: polygon.map((ring) => ring.map((point) => [...point] as Point2D)),
                          startX: rawPt[0],
                          startY: rawPt[1],
                          moved: false,
                        });
                      }}
                    />
                  );
                });
              })}
            </g>
          )}

          {/* EXPORTABLE MODULAR MULTI-SVG VIEWPORT */}
          <g ref={viewportRef} id="dungeon-modular-svg-root">
            <defs>
              <filter id="ds-building-shadow" x="-30%" y="-30%" width="170%" height="170%">
                <feDropShadow
                  dx={3 * ink}
                  dy={4 * ink}
                  stdDeviation={2.4 * ink}
                  floodColor="#000000"
                  floodOpacity="0.32"
                />
              </filter>
            </defs>
            <FloorTextureResources blurPx={textureBlurLevels} />
            {/* ==============================================================
                MODULE 1: DUNGEON LAYERS (Each layer is an independent <svg>)
               ============================================================== */}
            {renderedLayers.map(({ layer, floorPath, wallData, buildingData }) => {
              if (!layer.visible) return null;
              if (buildingData) {
                return (
                  <svg
                    key={layer.id}
                    id={`svg-layer-${layer.id}`}
                    data-layer-name={layer.name}
                    data-environment="exterior"
                    data-building-style={layer.buildingStyle ?? 'roof_tile'}
                    overflow="visible"
                    opacity={layer.opacity}
                    className="dungeon-layer"
                  >
                    <ExteriorLayerGraphics
                      layer={layer}
                      floorPath={floorPath}
                      buildingData={buildingData}
                      theme={theme}
                      ink={ink}
                      gridSize={G}
                      active={layer.id === doc.activeLayerId}
                      draftDabs={textureDraft}
                      textureShape={textureShape}
                      textureSoftness={textureSoftness}
                      texturePath={texturePath}
                      textureErasing={textureErasing}
                      selectedEntity={selectedEntity}
                      activeTool={activeTool}
                      onSelectEntity={onSelectEntity}
                    />
                  </svg>
                );
              }
              if (!wallData) return null;
              const floorColor = layer.floorColorOverride || theme.floorFill;
              const maskId = `mask-outside-${layer.id}`;
              const clipId = `clip-floor-${layer.id}`;

              return (
                <svg
                  key={layer.id}
                  id={`svg-layer-${layer.id}`}
                  data-layer-name={layer.name}
                  data-wall-style={layer.wallStyle}
                  overflow="visible"
                  opacity={layer.opacity}
                  className="dungeon-layer"
                >
                  {floorPath && (
                    <defs>
                      {/* Mask that blocks the floor interior so crosshatching ONLY renders outside walls */}
                      <mask id={maskId}>
                        <rect x={-worldExtent} y={-worldExtent} width={worldExtent * 2} height={worldExtent * 2} fill="white" />
                        {renderedLayers.map(({ layer: maskLayer, floorPath: maskPath }) => {
                          if (!maskLayer.visible || !maskPath || layerEnvironment(maskLayer) === 'exterior') {
                            return null;
                          }
                          return (
                            <path key={maskLayer.id} d={maskPath} fill="black" fillRule="evenodd" />
                          );
                        })}
                      </mask>
                      <clipPath id={clipId}>
                        <path d={floorPath} fillRule="evenodd" />
                      </clipPath>
                    </defs>
                  )}

                  {/* 1A. Jinkline Outer Crosshatch Aura */}
                  {floorPath && layer.hatchEnabled && (
                    <g mask={`url(#${maskId})`}>
                      <path
                        d={floorPath}
                        fill="none"
                        stroke="url(#ds-hatch-pattern)"
                        strokeWidth={G}
                        strokeLinejoin="round"
                      />
                    </g>
                  )}

                  {/* 1B. Carved Floor Fill + Clipped Interior Grid */}
                  {floorPath && (
                    <g>
                      <path d={floorPath} fill={floorColor} fillRule="evenodd" />
                      <FloorTextureStack
                        layerId={layer.id}
                        paints={layer.texturePaints ?? []}
                        clipId={clipId}
                        draft={
                          layer.id === doc.activeLayerId && textureDraft && !textureErasing
                            ? draftTexturePaint(textureDraft, textureShape, textureSoftness, texturePath)
                            : null
                        }
                      />
                      {doc.showGrid && (
                        <rect
                          x={-worldExtent}
                          y={-worldExtent}
                          width={worldExtent * 2}
                          height={worldExtent * 2}
                          fill="url(#ds-floor-grid)"
                          clipPath={`url(#${clipId})`}
                        />
                      )}
                    </g>
                  )}

                  {/* 1C. Stylized Perimeter Walls (Proste / Skalne / Ceglane / Podwójne / Zrujnowane) */}
                  {wallData.mainWallPath && (
                    <g data-wall-style={layer.wallStyle}>
                      {layer.wallStyle === 'straight' && (
                        <>
                          <path
                            d={wallData.mainWallPath}
                            fill="none"
                            stroke={theme.inkStroke}
                            strokeWidth={6 * ink}
                            strokeOpacity={0.14}
                            strokeLinejoin="miter"
                          />
                          <path
                            d={wallData.mainWallPath}
                            fill="none"
                            stroke={theme.inkStroke}
                            strokeWidth={3.2 * ink}
                            strokeLinejoin="miter"
                            strokeLinecap="square"
                          />
                        </>
                      )}

                      {layer.wallStyle === 'rock' && (
                        <>
                          {/* Rocky cavern perimeter */}
                          <path
                            d={wallData.mainWallPath}
                            fill="none"
                            stroke={theme.inkStroke}
                            strokeWidth={3.4 * ink}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                          />
                          {/* Secondary craggy rock fissures */}
                          {wallData.secondaryDetailPath && (
                            <path
                              d={wallData.secondaryDetailPath}
                              fill="none"
                              stroke={theme.inkStroke}
                              strokeWidth={1.3 * ink}
                              strokeOpacity={0.75}
                              strokeLinecap="round"
                            />
                          )}
                          {/* Mineral stippling dots */}
                          {wallData.stippleDots.map((dot, idx) => (
                            <circle
                              key={idx}
                              cx={dot.x}
                              cy={dot.y}
                              r={dot.r}
                              fill={theme.inkStroke}
                              opacity={0.65}
                            />
                          ))}
                        </>
                      )}

                      {layer.wallStyle === 'brick' && (
                        <>
                          {/* Outer masonry casing */}
                          <path
                            d={wallData.mainWallPath}
                            fill="none"
                            stroke={theme.inkStroke}
                            strokeWidth={7.5 * ink}
                            strokeLinejoin="miter"
                          />
                          {/* Brick course band */}
                          <path
                            d={wallData.mainWallPath}
                            fill="none"
                            stroke={theme.wallFill}
                            strokeWidth={4.5 * ink}
                            strokeLinejoin="miter"
                          />
                          {/* Individual brick mortar ticks */}
                          {wallData.brickTicksPath && (
                            <path
                              d={wallData.brickTicksPath}
                              fill="none"
                              stroke={theme.inkStroke}
                              strokeWidth={1.4 * ink}
                            />
                          )}
                        </>
                      )}

                      {layer.wallStyle === 'double' && (
                        <>
                          <path
                            d={wallData.mainWallPath}
                            fill="none"
                            stroke={theme.inkStroke}
                            strokeWidth={8.5 * ink}
                            strokeLinejoin="miter"
                          />
                          <path
                            d={wallData.mainWallPath}
                            fill="none"
                            stroke={theme.wallFill}
                            strokeWidth={3.6 * ink}
                            strokeLinejoin="miter"
                          />
                        </>
                      )}

                      {layer.wallStyle === 'ruins' && (
                        <>
                          <path
                            d={wallData.mainWallPath}
                            fill="none"
                            stroke={theme.inkStroke}
                            strokeWidth={3.2 * ink}
                            strokeLinecap="square"
                          />
                          {wallData.rubblePolygons.map((rp, idx) => (
                            <path
                              key={idx}
                              d={rp}
                              fill={theme.wallFill}
                              stroke={theme.inkStroke}
                              strokeWidth={1.2 * ink}
                            />
                          ))}
                        </>
                      )}
                    </g>
                  )}

                  {/* 1D. Standalone Internal Partition Walls */}
                  {layer.standaloneWalls.map((sw) => {
                    if (sw.points.length < 2) return null;
                    const d = sw.points
                      .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`)
                      .join(' ');
                    const isSelected =
                      selectedEntity?.kind === 'wall' && selectedEntity.id === sw.id;
                    return (
                      <g
                        key={sw.id}
                        onPointerDown={(e) => {
                          if (activeTool === 'select') {
                            e.stopPropagation();
                            onSelectEntity({ kind: 'wall', layerId: layer.id, id: sw.id });
                          }
                        }}
                        className={activeTool === 'select' ? 'cursor-pointer' : undefined}
                      >
                        <path
                          d={d}
                          fill="none"
                          stroke={isSelected ? '#3B82F6' : theme.inkStroke}
                          strokeWidth={(sw.wallStyle === 'double' || sw.wallStyle === 'brick' ? 6.5 : 3.5) * ink}
                          strokeDasharray={
                            sw.wallStyle === 'ruins'
                              ? `${12 * ink} ${6 * ink} ${5 * ink} ${6 * ink}`
                              : undefined
                          }
                          strokeLinecap="square"
                        />
                        {(sw.wallStyle === 'double' || sw.wallStyle === 'brick') && (
                          <path
                            d={d}
                            fill="none"
                            stroke={theme.wallFill}
                            strokeWidth={3 * ink}
                            strokeDasharray={
                              sw.wallStyle === 'brick' ? `${10 * ink} ${2 * ink}` : undefined
                            }
                          />
                        )}
                      </g>
                    );
                  })}
                </svg>
              );
            })}

            {/* ==============================================================
                MODULE 2: STAIRS & DOORS (Individual modular SVG components)
               ============================================================== */}
            <svg id="svg-layer-architecture" overflow="visible">
              {doc.stairs.map((stair) => (
                <svg
                  key={stair.id}
                  id={`svg-stair-${stair.id}`}
                  x={stair.x}
                  y={stair.y}
                  overflow="visible"
                  onPointerDown={(e) =>
                    startEntityDrag(e, { kind: 'stair', id: stair.id }, stair.x, stair.y)
                  }
                  className={activeTool === 'select' ? 'cursor-move' : undefined}
                >
                  <g transform={`rotate(${stair.rotation}) scale(${ink})`}>
                    <SvgStairArtwork
                      type={stair.type}
                      widthPx={(stair.widthCells * G) / ink}
                      lengthPx={(stair.lengthCells * G) / ink}
                      inkColor={theme.inkStroke}
                      floorColor={theme.floorFill}
                    />
                  </g>
                </svg>
              ))}

              {doc.doors.map((door) => (
                <svg
                  key={door.id}
                  id={`svg-door-${door.id}`}
                  x={door.x}
                  y={door.y}
                  overflow="visible"
                  onPointerDown={(e) =>
                    startEntityDrag(e, { kind: 'door', id: door.id }, door.x, door.y)
                  }
                  className={activeTool === 'select' ? 'cursor-move' : undefined}
                >
                  <g transform={`rotate(${door.rotation}) scale(${ink})`}>
                    <SvgDoorArtwork
                      type={door.type}
                      widthPx={(door.widthCells * G) / ink}
                      inkColor={theme.inkStroke}
                      floorColor={theme.floorFill}
                      flipped={door.flipped}
                    />
                  </g>
                </svg>
              ))}
            </svg>

            {/* ==============================================================
                MODULE 3: PROPS & PNG GRAPHICS (Hybrid SVG + PNG components)
               ============================================================== */}
            <svg id="svg-layer-props" overflow="visible">
              {doc.props.map((prop) => {
                const w = prop.widthPx * prop.scale;
                const h = prop.heightPx * prop.scale;
                const pngHref = prop.pngDataUrl || resolveAssetUrl(prop.assetPath);
                return (
                  <svg
                    key={prop.id}
                    id={`svg-prop-${prop.id}`}
                    x={prop.x}
                    y={prop.y}
                    overflow="visible"
                    onPointerDown={(e) =>
                      startEntityDrag(e, { kind: 'prop', id: prop.id }, prop.x, prop.y)
                    }
                    className={activeTool === 'select' ? 'cursor-move' : undefined}
                  >
                    <g
                      transform={`rotate(${prop.rotation}) scale(${prop.flipX ? -1 : 1}, 1)`}
                      filter="url(#ds-prop-shadow)"
                    >
                      {prop.kind === 'svg' && prop.svgPropId ? (
                        <g transform={`scale(${ink})`}>
                          <SvgPropArtwork
                            propId={prop.svgPropId}
                            width={w / ink}
                            height={h / ink}
                            inkColor={theme.inkStroke}
                            fillColor={theme.floorFill}
                          />
                        </g>
                      ) : pngHref ? (
                        <image
                          href={pngHref}
                          x={-w / 2}
                          y={-h / 2}
                          width={w}
                          height={h}
                          preserveAspectRatio="xMidYMid meet"
                        />
                      ) : null}
                    </g>
                  </svg>
                );
              })}
            </svg>

            {/* ==============================================================
                MODULE 4: ANNOTATIONS AND ROOM NUMBERS
               ============================================================== */}
            <svg id="svg-layer-annotations" overflow="visible">
              {doc.labels.map((lbl) => (
                <svg
                  key={lbl.id}
                  id={`svg-label-${lbl.id}`}
                  x={lbl.x}
                  y={lbl.y}
                  overflow="visible"
                  onPointerDown={(e) =>
                    startEntityDrag(e, { kind: 'label', id: lbl.id }, lbl.x, lbl.y)
                  }
                  className={activeTool === 'select' ? 'cursor-move' : undefined}
                >
                  <g transform={`rotate(${lbl.rotation})`}>
                    {lbl.badgeNumber && (
                      <g transform={`translate(0, ${-14 * ink}) scale(${ink})`}>
                        <circle
                          cx={0}
                          cy={0}
                          r={11}
                          fill={theme.floorFill}
                          stroke={theme.inkStroke}
                          strokeWidth={1.8}
                        />
                        <text
                          x={0}
                          y={4}
                          textAnchor="middle"
                          fontSize="11"
                          fontWeight="700"
                          fontFamily="JetBrains Mono, monospace"
                          fill={theme.accentLabel}
                        >
                          {lbl.badgeNumber}
                        </text>
                      </g>
                    )}
                    {lbl.text && (
                      <text
                        x={0}
                        y={lbl.badgeNumber ? 10 * ink : 4 * ink}
                        textAnchor="middle"
                        fontSize={lbl.fontSize}
                        fontWeight="600"
                        fontFamily="Architects Daughter, Inter, sans-serif"
                        fill={theme.accentLabel}
                        stroke={theme.floorFill}
                        strokeWidth={3 * ink}
                        paintOrder="stroke"
                      >
                        {lbl.text}
                      </text>
                    )}
                  </g>
                </svg>
              ))}
            </svg>
          </g>

          {/* ==============================================================
              MODULE 5: LIVE DRAFTING OVERLAY & SELECTION GIZMOS (Not Exported)
             ============================================================== */}
          <g data-export-ignore="true" pointerEvents="none">
            {/* Room / Eraser Live Rubber-Band Rectangle */}
            {dragStart &&
              (activeTool === 'room' ||
                (activeTool === 'district' && districtArea === 'rect') ||
                (activeTool === 'eraser' && eraserShape === 'rect')) && (
              <g>
                {(() => {
                  const x = Math.min(dragStart[0], cursorWorld[0]);
                  const y = Math.min(dragStart[1], cursorWorld[1]);
                  const w = Math.abs(cursorWorld[0] - dragStart[0]);
                  const h = Math.abs(cursorWorld[1] - dragStart[1]);
                  const cellsW = Math.round(w / G);
                  const cellsH = Math.round(h / G);
                  const isErase = activeTool === 'eraser';
                  const isDistrict = activeTool === 'district';
                  return (
                    <>
                      <rect
                        x={x}
                        y={y}
                        width={w}
                        height={h}
                        fill={
                          isErase
                            ? 'rgba(239, 68, 68, 0.18)'
                            : isDistrict
                              ? 'rgba(16, 185, 129, 0.16)'
                              : exteriorActive
                                ? 'rgba(217, 119, 6, 0.22)'
                                : 'rgba(59, 130, 246, 0.2)'
                        }
                        stroke={isErase ? '#EF4444' : isDistrict ? '#10B981' : exteriorActive ? '#D97706' : '#3B82F6'}
                        strokeWidth={2 * ink}
                        strokeDasharray={`${6 * ink} ${4 * ink}`}
                      />
                      {w > 0 && h > 0 && (
                        <g transform={`translate(${x + w / 2}, ${y - 10 * ink}) scale(${ink})`}>
                          <rect
                            x={-58}
                            y={-14}
                            width={116}
                            height={18}
                            rx={4}
                            fill="#141619"
                            stroke="#2D333D"
                          />
                          <text
                            x={0}
                            y={-2}
                            textAnchor="middle"
                            fontSize="10"
                            fontFamily="JetBrains Mono, monospace"
                            fill="#F1F3F5"
                          >
                            {cellsW}×{cellsH} ({cellsW * doc.feetPerCell}×{cellsH * doc.feetPerCell}ft)
                          </text>
                        </g>
                      )}
                    </>
                  );
                })()}
              </g>
            )}

            {/* Corridor Live Preview */}
            {dragStart && activeTool === 'corridor' && (
              <g>
                {(() => {
                  const pts = corridorElbowMode
                    ? computeElbowPath(dragStart, cursorWorld, elbowHorizFirst)
                    : [dragStart, cursorWorld];
                  const mp = corridorPathToMultiPolygon(pts, corridorWidthCells * G);
                  const d = multiPolygonToSvgPath(mp);
                  return (
                    <>
                      <path
                        d={d}
                        fill={
                          exteriorActive
                            ? roadStyle === 'dirt'
                              ? 'rgba(161, 98, 7, 0.35)'
                              : roadStyle === 'wood_planks'
                                ? 'rgba(196, 165, 116, 0.4)'
                                : 'rgba(120, 113, 108, 0.35)'
                            : 'rgba(59, 130, 246, 0.22)'
                        }
                        stroke={exteriorActive ? '#D97706' : '#3B82F6'}
                        strokeWidth={2 * ink}
                        strokeDasharray={`${5 * ink} ${3 * ink}`}
                      />
                      <polyline
                        points={pts.map((p) => `${p[0]},${p[1]}`).join(' ')}
                        fill="none"
                        stroke="#60A5FA"
                        strokeWidth={1.5 * ink}
                      />
                    </>
                  );
                })()}
              </g>
            )}

            {/* Cave Freehand Brush Preview */}
            {(activeTool === 'cave' || (activeTool === 'eraser' && eraserShape === 'stroke')) && (
              <g>
                {caveStrokePts.map((pt, idx) => (
                  <circle
                    key={idx}
                    cx={pt[0]}
                    cy={pt[1]}
                    r={((activeTool === 'eraser' ? eraserStrokeCells : caveBrushCells) * G) / 2}
                    fill={activeTool === 'eraser' ? 'rgba(239, 68, 68, 0.18)' : 'rgba(59, 130, 246, 0.16)'}
                  />
                ))}
                <circle
                  cx={rawCursorWorld[0]}
                  cy={rawCursorWorld[1]}
                  r={((activeTool === 'eraser' ? eraserStrokeCells : caveBrushCells) * G) / 2}
                  fill={activeTool === 'eraser' ? 'rgba(239, 68, 68, 0.14)' : 'rgba(59, 130, 246, 0.14)'}
                  stroke={activeTool === 'eraser' ? '#EF4444' : '#3B82F6'}
                  strokeWidth={1.8 * ink}
                  strokeDasharray={`${4 * ink} ${3 * ink}`}
                />
              </g>
            )}

            {/* Polygon Multi-Point Preview */}
            {(activeTool === 'polygon' ||
              (activeTool === 'eraser' && eraserShape === 'polygon') ||
              (activeTool === 'district' && districtArea === 'polygon')) &&
              polygonPts.length > 0 && (
              <g>
                <polyline
                  points={[...polygonPts, cursorWorld].map((p) => `${p[0]},${p[1]}`).join(' ')}
                  fill="rgba(59, 130, 246, 0.15)"
                  stroke="#3B82F6"
                  strokeWidth={2 * ink}
                />
                {polygonPts.map((pt, i) => (
                  <circle
                    key={i}
                    cx={pt[0]}
                    cy={pt[1]}
                    r={(i === 0 ? 6 : 4) * ink}
                    fill={i === 0 ? '#10B981' : '#3B82F6'}
                    stroke="#FFFFFF"
                    strokeWidth={1.5 * ink}
                  />
                ))}
              </g>
            )}

            {/* Standalone Wall Live Preview */}
            {dragStart && activeTool === 'wall' && (
              <line
                x1={dragStart[0]}
                y1={dragStart[1]}
                x2={cursorWorld[0]}
                y2={cursorWorld[1]}
                stroke="#3B82F6"
                strokeWidth={4 * ink}
                strokeDasharray={`${5 * ink} ${3 * ink}`}
              />
            )}

            {/* Door Ghost Snap Preview */}
            {activeTool === 'door' && doorPreview && (
              <g
                transform={`translate(${doorPreview.x}, ${doorPreview.y}) rotate(${doorPreview.rotation}) scale(${ink})`}
                opacity={0.75}
              >
                <SvgDoorArtwork
                  type={activeDoorType}
                  widthPx={(doorWidthCells(activeDoorType) * G) / ink}
                  inkColor="#2563EB"
                  floorColor={theme.floorFill}
                />
                {doorPreview.snapped && (
                  <circle cx={0} cy={0} r={4} fill="#10B981" />
                )}
              </g>
            )}

            {/* Stairs Ghost Preview */}
            {activeTool === 'stairs' && (
              <g
                transform={`translate(${cursorWorld[0]}, ${cursorWorld[1]}) rotate(${pendingRotation}) scale(${ink})`}
                opacity={0.7}
              >
                <SvgStairArtwork
                  type={activeStairType}
                  widthPx={((activeStairType === 'wide' ? 2 : activeStairType === 'spiral' ? 1.5 : 1) * G) / ink}
                  lengthPx={((activeStairType === 'spiral' ? 1.5 : 2) * G) / ink}
                  inkColor="#2563EB"
                  floorColor={theme.floorFill}
                />
              </g>
            )}

            {activeTool === 'texture' && textureMode === 'brush' && (
              <g>
                {textureShape === 'square' ? (
                  <rect
                    x={rawCursorWorld[0] - (textureBrushCells * G) / 2}
                    y={rawCursorWorld[1] - (textureBrushCells * G) / 2}
                    width={textureBrushCells * G}
                    height={textureBrushCells * G}
                    fill={textureErasing ? 'rgba(239, 68, 68, 0.12)' : 'rgba(59, 130, 246, 0.12)'}
                    stroke={textureErasing ? '#EF4444' : '#3B82F6'}
                    strokeWidth={1.25 / zoom}
                  />
                ) : (
                  <circle
                    cx={rawCursorWorld[0]}
                    cy={rawCursorWorld[1]}
                    r={(textureBrushCells * G) / 2}
                    fill={textureErasing ? 'rgba(239, 68, 68, 0.12)' : 'rgba(59, 130, 246, 0.12)'}
                    stroke={textureErasing ? '#EF4444' : '#3B82F6'}
                    strokeWidth={1.25 / zoom}
                  />
                )}
                {textureErasing &&
                  textureDraft?.map((dab, index) =>
                    textureShape === 'square' ? (
                      <rect
                        key={index}
                        x={dab.x - dab.r}
                        y={dab.y - dab.r}
                        width={dab.r * 2}
                        height={dab.r * 2}
                        fill="rgba(239, 68, 68, 0.35)"
                      />
                    ) : (
                      <circle key={index} cx={dab.x} cy={dab.y} r={dab.r} fill="rgba(239, 68, 68, 0.35)" />
                    )
                  )}
              </g>
            )}

            {/* Prop Ghost Preview */}
            {activeTool === 'prop' && (
              <g
                transform={`translate(${cursorWorld[0]}, ${cursorWorld[1]}) rotate(${pendingRotation})`}
                opacity={0.72}
              >
                {activePropPreset.kind === 'svg' && activePropPreset.svgPropId ? (
                  <g transform={`scale(${ink})`}>
                    <SvgPropArtwork
                      propId={activePropPreset.svgPropId}
                      width={activePropPreset.widthPx / ink}
                      height={activePropPreset.heightPx / ink}
                      inkColor="#2563EB"
                      fillColor={theme.floorFill}
                    />
                  </g>
                ) : activePropPreset.pngDataUrl || activePropPreset.assetPath ? (
                  <image
                    href={activePropPreset.pngDataUrl || resolveAssetUrl(activePropPreset.assetPath)}
                    x={-activePropPreset.widthPx / 2}
                    y={-activePropPreset.heightPx / 2}
                    width={activePropPreset.widthPx}
                    height={activePropPreset.heightPx}
                  />
                ) : null}
              </g>
            )}

            {/* Active Grid Snap Crosshair Dot */}
            {['room', 'corridor', 'polygon', 'eraser', 'wall', 'stairs', 'prop', 'label', 'district'].includes(
              activeTool
            ) && (
              <g transform={`translate(${cursorWorld[0]}, ${cursorWorld[1]})`}>
                <circle cx={0} cy={0} r={3.5 * ink} fill="#3B82F6" />
                <circle
                  cx={0}
                  cy={0}
                  r={7 * ink}
                  fill="none"
                  stroke="#3B82F6"
                  strokeWidth={ink}
                  opacity={0.6}
                />
              </g>
            )}
          </g>

          {/* Interactive Selection Gizmo (clickable rotation handle!) */}
          {selectionInfo && activeTool === 'select' && (
            <g
              data-export-ignore="true"
              transform={`translate(${selectionInfo.x}, ${selectionInfo.y})`}
            >
              <circle
                cx={0}
                cy={0}
                r={selectionInfo.radius}
                fill="none"
                stroke="#3B82F6"
                strokeWidth={1.6 * ink}
                strokeDasharray={`${4 * ink} ${3 * ink}`}
              />
              {/* Rotation Handle */}
              <g transform={`rotate(${selectionInfo.rotation})`}>
                <line
                  x1={0}
                  y1={-selectionInfo.radius}
                  x2={0}
                  y2={-selectionInfo.radius - 18 * ink}
                  stroke="#3B82F6"
                  strokeWidth={1.6 * ink}
                />
                <circle
                  cx={0}
                  cy={-selectionInfo.radius - 20 * ink}
                  r={6 * ink}
                  fill="#3B82F6"
                  stroke="#FFFFFF"
                  strokeWidth={1.5 * ink}
                  className="cursor-grab"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (!selectedEntity) return;
                    const rawPt = screenToWorld(e.clientX, e.clientY, false);
                    if (selectedEntity.kind === 'building' && 'polygon' in selectionInfo && selectionInfo.polygon) {
                      setRotatingEntity({
                        entity: selectedEntity,
                        centerX: selectionInfo.x,
                        centerY: selectionInfo.y,
                        originPolygon: selectionInfo.polygon,
                        startPointerAngle: Math.atan2(rawPt[1] - selectionInfo.y, rawPt[0] - selectionInfo.x),
                      });
                      return;
                    }
                    setRotatingEntity({
                      entity: selectedEntity,
                      centerX: selectionInfo.x,
                      centerY: selectionInfo.y,
                    });
                  }}
                />
              </g>
            </g>
          )}
        </g>
      </svg>

      {/* Bottom Floating Status & Quick Hints Pill */}
      <div className="absolute bottom-3 left-3 flex items-center gap-3 px-3 py-1.5 rounded-lg bg-[#141619]/90 border border-[#2D333D] backdrop-blur-md text-xs text-[#9CA3AF] shadow-lg pointer-events-auto">
        <span className="font-mono-tech text-[#F1F3F5]">
          X:{Math.round(cursorWorld[0] / G)} Y:{Math.round(cursorWorld[1] / G)}
        </span>
        <span className="text-[#2D333D]">|</span>
        <span>
          {t('canvas.scale')} <strong className="text-[#F1F3F5]">{doc.feetPerCell} ft</strong>
        </span>
        {activeTool === 'corridor' && (
          <>
            <span className="text-[#2D333D]">|</span>
            <button
              onClick={() => {
                if (corridorElbowMode) {
                  setElbowHorizFirst((p) => !p);
                } else {
                  onToggleCorridorElbow();
                }
              }}
              className="text-indigo-400 hover:text-indigo-300 font-medium"
            >
              {corridorElbowMode
                ? exteriorActive
                  ? t('canvas.roadElbow')
                  : t('canvas.corridorElbow')
                : exteriorActive
                  ? t('canvas.roadStraight')
                  : t('canvas.corridorStraight')}
            </button>
          </>
        )}
        {(activeTool === 'polygon' ||
          (activeTool === 'eraser' && eraserShape === 'polygon') ||
          (activeTool === 'district' && districtArea === 'polygon')) && (
          <>
            <span className="text-[#2D333D]">|</span>
            <span className="text-emerald-400">{t('canvas.polygonHint')}</span>
          </>
        )}
        {activeTool === 'district' && districtArea === 'rect' && (
          <>
            <span className="text-[#2D333D]">|</span>
            <span className="text-emerald-400">{t('canvas.districtHint')}</span>
          </>
        )}
        {activeTool === 'prop' && (
          <>
            <span className="text-[#2D333D]">|</span>
            <span className="text-indigo-300">{t('canvas.propHint')}</span>
          </>
        )}
      </div>
    </div>
  );
};
