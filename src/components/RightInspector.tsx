import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Circle,
  Copy,
  Eraser,
  Eye,
  EyeOff,
  FlipHorizontal2,
  GripVertical,
  Hash,
  Layers,
  PaintBucket,
  Plus,
  RotateCcw,
  RotateCw,
  SprayCan,
  Square,
  Trash2,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { AssetBrowser } from './AssetBrowser';
import {
  BUILDING_STYLE_OPTIONS,
  DOOR_TYPE_OPTIONS,
  EXTERIOR_WALL_STYLE_OPTIONS,
  ROAD_STYLE_OPTIONS,
  STAIR_TYPE_OPTIONS,
  SVG_PROP_CATALOG,
  WALL_STYLE_OPTIONS,
} from '../data/presets';
import {
  BuildingStyle,
  DistrictAngleMode,
  DistrictAreaShape,
  DistrictSizePreset,
  DoorType,
  DungeonDocument,
  DungeonLayer,
  EraserShape,
  ExteriorWallStyle,
  LayerEnvironment,
  PropBrush,
  RoadStyle,
  SelectedEntity,
  StairType,
  TextureBrushShape,
  ToolType,
  WallStyle,
  doorWidthCells,
  layerEnvironment,
} from '../types/dungeon';
import { readImageFile } from '../data/assetLibrary';
import { FLOOR_TEXTURES } from '../data/textureLibrary';
import { polygonEdgeAngle, rotatePolygon } from '../utils/geometry';
import { BuiltinPngAsset } from '../utils/samplePngAssets';
import {
  BuildingStylePreviewSvg,
  ExteriorWallPreviewSvg,
  SvgDoorArtwork,
  SvgPropArtwork,
  SvgStairArtwork,
  WallStylePreviewSvg,
} from './SvgPropArtwork';

type LayerDrag = {
  id: string;
  from: number;
  over: number;
};

/** `over` is the slot before removal. Shifting past the original index lands one lower. */
function layerDropIndex(from: number, over: number): number {
  return from < over ? over - 1 : over;
}

function slotIndexFromPoint(list: HTMLElement | null, clientY: number): number {
  const rows = list?.querySelectorAll<HTMLElement>('[data-layer-row]') ?? [];
  for (let index = 0; index < rows.length; index += 1) {
    const rect = rows[index].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return index;
  }
  return rows.length;
}

interface RightInspectorProps {
  doc: DungeonDocument;
  activeTool: ToolType;
  selectedEntity: SelectedEntity;
  onSelectEntity: (entity: SelectedEntity) => void;
  // Tool states
  corridorWidthCells: number;
  onChangeCorridorWidth: (w: number) => void;
  corridorElbowMode: boolean;
  onToggleCorridorElbow: () => void;
  caveBrushCells: number;
  onChangeCaveBrush: (c: number) => void;
  eraserShape: EraserShape;
  onChangeEraserShape: (shape: EraserShape) => void;
  eraserStrokeCells: number;
  onChangeEraserStroke: (cells: number) => void;
  districtDensity: number;
  onChangeDistrictDensity: (density: number) => void;
  districtSize: DistrictSizePreset;
  onChangeDistrictSize: (size: DistrictSizePreset) => void;
  districtAngle: DistrictAngleMode;
  onChangeDistrictAngle: (mode: DistrictAngleMode) => void;
  districtArea: DistrictAreaShape;
  onChangeDistrictArea: (shape: DistrictAreaShape) => void;
  texturePath: string;
  onChangeTexturePath: (path: string) => void;
  textureShape: TextureBrushShape;
  onChangeTextureShape: (shape: TextureBrushShape) => void;
  textureMode: 'brush' | 'bucket';
  onChangeTextureMode: (mode: 'brush' | 'bucket') => void;
  textureBrushCells: number;
  onChangeTextureBrush: (cells: number) => void;
  textureSoftness: number;
  onChangeTextureSoftness: (softness: number) => void;
  textureErasing: boolean;
  onToggleTextureErasing: () => void;
  activeDoorType: DoorType;
  onChangeDoorType: (t: DoorType) => void;
  activeStairType: StairType;
  onChangeStairType: (t: StairType) => void;
  activePropPreset: PropBrush;
  onSelectPropPreset: (preset: PropBrush) => void;
  pendingRotation: number;
  onChangePendingRotation: (deg: number) => void;
  // Document mutations
  onChangeActiveLayerWallStyle: (style: WallStyle) => void;
  onChangeActiveLayerBuildingStyle: (style: BuildingStyle) => void;
  onToggleActiveLayerHatch: () => void;
  onSelectActiveLayer: (layerId: string) => void;
  onAddLayer: (environment: LayerEnvironment) => void;
  onSetLayerEnvironment: (layerId: string, environment: LayerEnvironment) => void;
  onDeleteLayer: (layerId: string) => void;
  onReorderLayers: (layerId: string, toIndex: number) => void;
  roadStyle: RoadStyle;
  onChangeRoadStyle: (style: RoadStyle) => void;
  exteriorWallStyle: ExteriorWallStyle;
  onChangeExteriorWallStyle: (style: ExteriorWallStyle) => void;
  exteriorWallTowers: boolean;
  onToggleExteriorWallTowers: () => void;
  onToggleLayerVisibility: (layerId: string) => void;
  onRenameLayer: (layerId: string, name: string) => void;
  onUpdateEntity: (
    entity: NonNullable<SelectedEntity>,
    patch: Record<string, unknown>,
    commitHistory?: boolean
  ) => void;
  onDeleteEntity: (entity: NonNullable<SelectedEntity>) => void;
  onDuplicateEntity: (entity: NonNullable<SelectedEntity>) => void;
}

export const RightInspector: React.FC<RightInspectorProps> = ({
  doc,
  activeTool,
  selectedEntity,
  onSelectEntity,
  corridorWidthCells,
  onChangeCorridorWidth,
  corridorElbowMode,
  onToggleCorridorElbow,
  caveBrushCells,
  onChangeCaveBrush,
  eraserShape,
  onChangeEraserShape,
  eraserStrokeCells,
  onChangeEraserStroke,
  districtDensity,
  onChangeDistrictDensity,
  districtSize,
  onChangeDistrictSize,
  districtAngle,
  onChangeDistrictAngle,
  districtArea,
  onChangeDistrictArea,
  texturePath,
  onChangeTexturePath,
  textureShape,
  onChangeTextureShape,
  textureMode,
  onChangeTextureMode,
  textureBrushCells,
  onChangeTextureBrush,
  textureSoftness,
  onChangeTextureSoftness,
  textureErasing,
  onToggleTextureErasing,
  activeDoorType,
  onChangeDoorType,
  activeStairType,
  onChangeStairType,
  activePropPreset,
  onSelectPropPreset,
  pendingRotation,
  onChangePendingRotation,
  onChangeActiveLayerWallStyle,
  onChangeActiveLayerBuildingStyle,
  onToggleActiveLayerHatch,
  onSelectActiveLayer,
  onAddLayer,
  onSetLayerEnvironment,
  onDeleteLayer,
  onReorderLayers,
  roadStyle,
  onChangeRoadStyle,
  exteriorWallStyle,
  onChangeExteriorWallStyle,
  exteriorWallTowers,
  onToggleExteriorWallTowers,
  onToggleLayerVisibility,
  onRenameLayer,
  onUpdateEntity,
  onDeleteEntity,
  onDuplicateEntity,
}) => {
  const { messages, t } = useI18n();
  const [propTab, setPropTab] = useState<'svg' | 'png'>('svg');
  const [customPngs, setCustomPngs] = useState<BuiltinPngAsset[]>([]);
  const [layerMenuPos, setLayerMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [layerDrag, setLayerDrag] = useState<LayerDrag | null>(null);
  const newLayerButtonRef = useRef<HTMLButtonElement>(null);
  const layerMenuRef = useRef<HTMLDivElement>(null);
  const layerListRef = useRef<HTMLDivElement>(null);
  const layerDragRef = useRef<
    | (LayerDrag & {
        pointerId: number;
        startX: number;
        startY: number;
        fromInput: boolean;
        active: boolean;
        html5: boolean;
        committed: boolean;
      })
    | null
  >(null);

  useEffect(() => {
    if (!layerDrag) return;
    const previous = document.body.style.cursor;
    document.body.style.cursor = 'grabbing';
    return () => {
      document.body.style.cursor = previous;
    };
  }, [layerDrag]);

  useEffect(() => {
    if (!layerMenuPos) return;
    const close = () => setLayerMenuPos(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [layerMenuPos]);

  const placeLayerMenu = (height: number, width: number) => {
    const button = newLayerButtonRef.current;
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    const gap = 6;
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    const below = rect.bottom + gap;
    const top =
      below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - gap) : below;
    return { top, left };
  };

  useLayoutEffect(() => {
    const menu = layerMenuRef.current;
    if (!layerMenuPos || !menu) return;
    const next = placeLayerMenu(menu.offsetHeight, menu.offsetWidth);
    if (!next) return;
    if (Math.abs(next.top - layerMenuPos.top) > 1 || Math.abs(next.left - layerMenuPos.left) > 1) {
      setLayerMenuPos(next);
    }
  }, [layerMenuPos]);

  const openLayerMenu = () => {
    const next = placeLayerMenu(140, 240);
    if (next) setLayerMenuPos(next);
  };

  const activeLayer: DungeonLayer | undefined =
    doc.layers.find((l) => l.id === doc.activeLayerId) || doc.layers[0];
  const exterior = activeLayer ? layerEnvironment(activeLayer) === 'exterior' : false;

  const handleUploadPng = (file: File) => {
    readImageFile(file)
      .then(({ dataUrl, width, height }) => {
        const asset: BuiltinPngAsset = {
          id: `custom-png-${Date.now()}`,
          label: file.name.replace(/\.[^.]+$/, ''),
          widthPx: width,
          heightPx: height,
          dataUrl,
        };
        setCustomPngs((prev) => [asset, ...prev]);
        onSelectPropPreset({
          kind: 'png',
          pngDataUrl: asset.dataUrl,
          label: asset.label ?? '',
          widthPx: asset.widthPx,
          heightPx: asset.heightPx,
        });
      })
      .catch(() => undefined);
  };

  const showWallStyles = ['room', 'corridor', 'cave', 'polygon', 'eraser', 'wall', 'district'].includes(
    activeTool
  );

  // Resolve selected object details if any
  const renderSelectedEntityInspector = () => {
    if (!selectedEntity) return null;

    if (selectedEntity.kind === 'door') {
      const door = doc.doors.find((d) => d.id === selectedEntity.id);
      if (!door) return null;
      return (
        <div className="p-3 border-b border-[#2D333D] bg-[#1C1F24]/70 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
              {t('inspector.selectedDoor')}
            </span>
            <button
              onClick={() => onSelectEntity(null)}
              className="text-[11px] text-[#9CA3AF] hover:text-white"
            >
              {t('inspector.close')}
            </button>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] text-[#9CA3AF]">{t('inspector.passageType')}</label>
            <select
              value={door.type}
              onChange={(e) => {
                const nextType = e.target.value as DoorType;
                onUpdateEntity(
                  selectedEntity,
                  { type: nextType, widthCells: nextType === 'double' ? 2 : 1 },
                  true
                );
              }}
              className="w-full bg-[#141619] border border-[#2D333D] rounded px-2 py-1.5 text-xs text-[#F1F3F5]"
            >
              {DOOR_TYPE_OPTIONS.map((id) => (
                <option key={id} value={id}>
                  {messages.doors[id]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() =>
                onUpdateEntity(selectedEntity, { rotation: (door.rotation + 90) % 360 }, true)
              }
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-[#252A32] hover:bg-[#2F3640] text-xs"
            >
              <RotateCw className="w-3.5 h-3.5" /> {t('inspector.rotate90')}
            </button>
            <button
              onClick={() =>
                onUpdateEntity(selectedEntity, { flipped: !door.flipped }, true)
              }
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-[#252A32] hover:bg-[#2F3640] text-xs"
            >
              <FlipHorizontal2 className="w-3.5 h-3.5" /> {t('inspector.flipArc')}
            </button>
          </div>
          <div className="flex items-center gap-1.5 pt-1">
            <button
              onClick={() => onDuplicateEntity(selectedEntity)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-[#252A32] hover:bg-[#2F3640] text-xs text-[#D1D5DB]"
            >
              <Copy className="w-3.5 h-3.5" /> {t('inspector.duplicate')}
            </button>
            <button
              onClick={() => onDeleteEntity(selectedEntity)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-red-950/60 hover:bg-red-900/70 border border-red-800/50 text-xs text-red-300"
            >
              <Trash2 className="w-3.5 h-3.5" /> {t('inspector.delete')}
            </button>
          </div>
        </div>
      );
    }

    if (selectedEntity.kind === 'stair') {
      const stair = doc.stairs.find((s) => s.id === selectedEntity.id);
      if (!stair) return null;
      return (
        <div className="p-3 border-b border-[#2D333D] bg-[#1C1F24]/70 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
              {t('inspector.selectedStairs')}
            </span>
            <button
              onClick={() => onSelectEntity(null)}
              className="text-[11px] text-[#9CA3AF] hover:text-white"
            >
              {t('inspector.close')}
            </button>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] text-[#9CA3AF]">{t('inspector.stairType')}</label>
            <select
              value={stair.type}
              onChange={(e) => {
                const nextType = e.target.value as StairType;
                onUpdateEntity(
                  selectedEntity,
                  {
                    type: nextType,
                    widthCells: nextType === 'wide' ? 2 : nextType === 'spiral' ? 1.5 : 1,
                    lengthCells: nextType === 'spiral' ? 1.5 : 2,
                  },
                  true
                );
              }}
              className="w-full bg-[#141619] border border-[#2D333D] rounded px-2 py-1.5 text-xs text-[#F1F3F5]"
            >
              {STAIR_TYPE_OPTIONS.map((id) => (
                <option key={id} value={id}>
                  {messages.stairs[id]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() =>
                onUpdateEntity(selectedEntity, { rotation: (stair.rotation - 90) % 360 }, true)
              }
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-[#252A32] hover:bg-[#2F3640] text-xs"
            >
              <RotateCcw className="w-3.5 h-3.5" /> -90°
            </button>
            <button
              onClick={() =>
                onUpdateEntity(selectedEntity, { rotation: (stair.rotation + 90) % 360 }, true)
              }
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-[#252A32] hover:bg-[#2F3640] text-xs"
            >
              <RotateCw className="w-3.5 h-3.5" /> +90°
            </button>
          </div>
          <div className="flex items-center gap-1.5 pt-1">
            <button
              onClick={() => onDuplicateEntity(selectedEntity)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-[#252A32] hover:bg-[#2F3640] text-xs"
            >
              <Copy className="w-3.5 h-3.5" /> {t('inspector.duplicate')}
            </button>
            <button
              onClick={() => onDeleteEntity(selectedEntity)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-red-950/60 hover:bg-red-900/70 border border-red-800/50 text-xs text-red-300"
            >
              <Trash2 className="w-3.5 h-3.5" /> {t('inspector.delete')}
            </button>
          </div>
        </div>
      );
    }

    if (selectedEntity.kind === 'prop') {
      const prop = doc.props.find((p) => p.id === selectedEntity.id);
      if (!prop) return null;
      return (
        <div className="p-3 border-b border-[#2D333D] bg-[#1C1F24]/70 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400 truncate max-w-[170px]">
              {prop.label} ({prop.kind.toUpperCase()})
            </span>
            <button
              onClick={() => onSelectEntity(null)}
              className="text-[11px] text-[#9CA3AF] hover:text-white"
            >
              {t('inspector.close')}
            </button>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-[#9CA3AF]">
              <span>{t('inspector.objectScale')}</span>
              <span className="font-mono-tech text-[#F1F3F5]">{prop.scale.toFixed(2)}×</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="2.5"
              step="0.05"
              value={prop.scale}
              onChange={(e) =>
                onUpdateEntity(selectedEntity, { scale: parseFloat(e.target.value) }, true)
              }
              className="w-full accent-indigo-500"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-[#9CA3AF]">
              <span>{t('inspector.rotation')}</span>
              <span className="font-mono-tech text-[#F1F3F5]">{Math.round(prop.rotation)}°</span>
            </div>
            <input
              type="range"
              min="-180"
              max="180"
              step="15"
              value={prop.rotation}
              onChange={(e) =>
                onUpdateEntity(selectedEntity, { rotation: parseFloat(e.target.value) }, true)
              }
              className="w-full accent-indigo-500"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() =>
                onUpdateEntity(selectedEntity, { rotation: (prop.rotation + 45) % 360 }, true)
              }
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-[#252A32] hover:bg-[#2F3640] text-xs"
            >
              <RotateCw className="w-3.5 h-3.5" /> +45°
            </button>
            <button
              onClick={() => onUpdateEntity(selectedEntity, { flipX: !prop.flipX }, true)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-[#252A32] hover:bg-[#2F3640] text-xs"
            >
              <FlipHorizontal2 className="w-3.5 h-3.5" /> {t('inspector.flip')}
            </button>
          </div>

          <div className="flex items-center gap-1.5 pt-1">
            <button
              onClick={() => onDuplicateEntity(selectedEntity)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-[#252A32] hover:bg-[#2F3640] text-xs"
            >
              <Copy className="w-3.5 h-3.5" /> {t('inspector.duplicate')}
            </button>
            <button
              onClick={() => onDeleteEntity(selectedEntity)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-red-950/60 hover:bg-red-900/70 border border-red-800/50 text-xs text-red-300"
            >
              <Trash2 className="w-3.5 h-3.5" /> {t('inspector.delete')}
            </button>
          </div>
        </div>
      );
    }

    if (selectedEntity.kind === 'label') {
      const lbl = doc.labels.find((l) => l.id === selectedEntity.id);
      if (!lbl) return null;
      return (
        <div className="p-3 border-b border-[#2D333D] bg-[#1C1F24]/70 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
              {t('inspector.editLabel')}
            </span>
            <button
              onClick={() => onSelectEntity(null)}
              className="text-[11px] text-[#9CA3AF] hover:text-white"
            >
              {t('inspector.close')}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-[#9CA3AF]">{t('inspector.number')}</label>
              <input
                type="text"
                value={lbl.badgeNumber || ''}
                placeholder={t('inspector.numberPlaceholder')}
                onChange={(e) =>
                  onUpdateEntity(selectedEntity, { badgeNumber: e.target.value }, true)
                }
                className="w-full bg-[#141619] border border-[#2D333D] rounded px-2 py-1 text-xs font-mono-tech text-[#F1F3F5]"
              />
            </div>
            <div className="col-span-2">
              <label className="text-[10px] text-[#9CA3AF]">{t('inspector.roomName')}</label>
              <input
                type="text"
                value={lbl.text}
                onChange={(e) => onUpdateEntity(selectedEntity, { text: e.target.value }, true)}
                className="w-full bg-[#141619] border border-[#2D333D] rounded px-2 py-1 text-xs text-[#F1F3F5]"
              />
            </div>
          </div>
          <button
            onClick={() => onDeleteEntity(selectedEntity)}
            className="w-full flex items-center justify-center gap-1 py-1.5 rounded bg-red-950/60 hover:bg-red-900/70 border border-red-800/50 text-xs text-red-300"
          >
            <Trash2 className="w-3.5 h-3.5" /> {t('inspector.deleteLabel')}
          </button>
        </div>
      );
    }

    if (selectedEntity.kind === 'wall') {
      const wallLayer = doc.layers.find((layer) => layer.id === selectedEntity.layerId);
      const wall = wallLayer?.standaloneWalls.find((item) => item.id === selectedEntity.id);
      const exteriorWall = wallLayer && layerEnvironment(wallLayer) === 'exterior';
      return (
        <div className="p-3 border-b border-[#2D333D] bg-[#1C1F24]/70 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
              {exteriorWall ? t('inspector.exteriorWall') : t('inspector.partition')}
            </span>
            <button
              onClick={() => onSelectEntity(null)}
              className="text-[11px] text-[#9CA3AF] hover:text-white"
            >
              {t('inspector.close')}
            </button>
          </div>
          {exteriorWall && wall && (
            <div className="space-y-1.5">
              <label className="text-[11px] text-[#9CA3AF]">{t('inspector.wallStyle')}</label>
              <select
                value={wall.exteriorWallStyle ?? 'castle_crenellated'}
                onChange={(event) =>
                  onUpdateEntity(
                    selectedEntity,
                    { exteriorWallStyle: event.target.value as ExteriorWallStyle },
                    true
                  )
                }
                className="w-full bg-[#141619] border border-[#2D333D] rounded px-2 py-1.5 text-xs text-[#F1F3F5]"
              >
                {EXTERIOR_WALL_STYLE_OPTIONS.map((id) => (
                  <option key={id} value={id}>
                    {messages.exteriorWalls[id].name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onUpdateEntity(selectedEntity, { hasTowers: !wall.hasTowers }, true)}
                className={`w-full py-1.5 rounded border text-xs ${
                  wall.hasTowers
                    ? 'bg-indigo-600/25 border-indigo-500 text-indigo-200'
                    : 'bg-[#1C1F24] border-[#2D333D] text-[#D1D5DB]'
                }`}
              >
                {wall.hasTowers ? t('inspector.towersOn') : t('inspector.towers')}
              </button>
            </div>
          )}
          <button
            onClick={() => onDeleteEntity(selectedEntity)}
            className="w-full flex items-center justify-center gap-1 py-1.5 rounded bg-red-950/60 hover:bg-red-900/70 border border-red-800/50 text-xs text-red-300"
          >
            <Trash2 className="w-3.5 h-3.5" /> {exteriorWall ? t('inspector.deleteWall') : t('inspector.deletePartition')}
          </button>
        </div>
      );
    }

    if (selectedEntity.kind === 'road') {
      const roadLayer = doc.layers.find((layer) => layer.id === selectedEntity.layerId);
      const road = roadLayer?.roads?.find((item) => item.id === selectedEntity.id);
      if (!road) return null;
      return (
        <div className="p-3 border-b border-[#2D333D] bg-[#1C1F24]/70 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
              {t('inspector.selectedRoad')}
            </span>
            <button
              onClick={() => onSelectEntity(null)}
              className="text-[11px] text-[#9CA3AF] hover:text-white"
            >
              {t('inspector.close')}
            </button>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] text-[#9CA3AF]">{t('inspector.surface')}</label>
            <select
              value={road.style}
              onChange={(event) =>
                onUpdateEntity(selectedEntity, { style: event.target.value as RoadStyle }, true)
              }
              className="w-full bg-[#141619] border border-[#2D333D] rounded px-2 py-1.5 text-xs text-[#F1F3F5]"
            >
              {ROAD_STYLE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {messages.roadStyles[option.id].name}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => onDeleteEntity(selectedEntity)}
            className="w-full flex items-center justify-center gap-1 py-1.5 rounded bg-red-950/60 hover:bg-red-900/70 border border-red-800/50 text-xs text-red-300"
          >
            <Trash2 className="w-3.5 h-3.5" /> {t('inspector.deleteRoad')}
          </button>
        </div>
      );
    }

    if (selectedEntity.kind === 'building') {
      const buildingLayer = doc.layers.find((layer) => layer.id === selectedEntity.layerId);
      const polygon = buildingLayer?.geometry[selectedEntity.polyIndex];
      if (!polygon) return null;
      const angle = Math.round((polygonEdgeAngle(polygon) * 180) / Math.PI);
      const turn = (degrees: number) => {
        onUpdateEntity(
          selectedEntity,
          { polygon: rotatePolygon(polygon, (degrees * Math.PI) / 180) },
          true
        );
      };
      return (
        <div className="p-3 border-b border-[#2D333D] bg-[#1C1F24]/70 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
              {t('inspector.building')}
            </span>
            <button
              onClick={() => onSelectEntity(null)}
              className="text-[11px] text-[#9CA3AF] hover:text-white"
            >
              {t('inspector.close')}
            </button>
          </div>
          <div className="text-[11px] text-[#9CA3AF]">{t('inspector.edgeAngle', { angle })}</div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => turn(-15)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-[#252A32] hover:bg-[#2F3640] text-xs"
            >
              <RotateCcw className="w-3.5 h-3.5" /> -15°
            </button>
            <button
              onClick={() => turn(15)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-[#252A32] hover:bg-[#2F3640] text-xs"
            >
              <RotateCw className="w-3.5 h-3.5" /> +15°
            </button>
          </div>
          <p className="text-[10px] leading-snug text-[#9CA3AF]">
            {t('inspector.buildingHint')}
          </p>
          <button
            onClick={() => onDeleteEntity(selectedEntity)}
            className="w-full flex items-center justify-center gap-1 py-1.5 rounded bg-red-950/60 hover:bg-red-900/70 border border-red-800/50 text-xs text-red-300"
          >
            <Trash2 className="w-3.5 h-3.5" /> {t('inspector.deleteBuilding')}
          </button>
        </div>
      );
    }

    return null;
  };

  return (
    <aside className="w-76 bg-[#141619] border-l border-[#2D333D] flex flex-col h-full overflow-hidden z-20 shrink-0 select-none">
      <div className="flex-1 min-h-0 overflow-y-auto">
      {/* Contextual Selected Entity Inspector */}
      {renderSelectedEntityInspector()}

      {/* SECTION 1: WALL OR BUILDING STYLE */}
      {showWallStyles && (
      <div className="p-3 border-b border-[#2D333D] space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
            {exterior ? t('inspector.buildingTypes') : t('inspector.wallTypes')}
          </span>
          {activeLayer && (
            <button
              onClick={onToggleActiveLayerHatch}
              title={exterior ? t('inspector.shadowTitle') : t('inspector.hatchTitle')}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                activeLayer.hatchEnabled
                  ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300'
                  : 'bg-[#1C1F24] border-[#2D333D] text-[#6B7280]'
              }`}
            >
              <Hash className="w-3 h-3" />
              <span>{exterior ? t('inspector.shadow') : t('inspector.hatch')}</span>
            </button>
          )}
        </div>

        {exterior ? (
          <div className="grid grid-cols-1 gap-1.5">
            {BUILDING_STYLE_OPTIONS.map((opt) => {
              const copy = messages.buildingStyles[opt.id];
              const isSelected = (activeLayer?.buildingStyle ?? 'roof_tile') === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => onChangeActiveLayerBuildingStyle(opt.id)}
                  className={`flex items-center gap-2.5 p-2 rounded-lg border text-left transition-all ${
                    isSelected
                      ? 'bg-indigo-600/15 border-indigo-500/70 text-[#F1F3F5]'
                      : 'bg-[#1C1F24] border-[#2D333D] hover:border-[#3E4654] text-[#D1D5DB]'
                  }`}
                >
                  <div className="shrink-0 rounded overflow-hidden border border-black/30">
                    <BuildingStylePreviewSvg style={opt.id} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold leading-tight">{copy.name}</div>
                    <div className="text-[10px] text-[#9CA3AF] truncate">{copy.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-1.5">
            {WALL_STYLE_OPTIONS.map((id) => {
              const copy = messages.wallStyles[id];
              const isSelected = activeLayer?.wallStyle === id;
              return (
                <button
                  key={id}
                  onClick={() => onChangeActiveLayerWallStyle(id)}
                  className={`flex items-center gap-2.5 p-2 rounded-lg border text-left transition-all ${
                    isSelected
                      ? 'bg-indigo-600/15 border-indigo-500/70 text-[#F1F3F5]'
                      : 'bg-[#1C1F24] border-[#2D333D] hover:border-[#3E4654] text-[#D1D5DB]'
                  }`}
                >
                  <div className="shrink-0 rounded overflow-hidden border border-black/30">
                    <WallStylePreviewSvg style={id} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold leading-tight">{copy.name}</div>
                    <div className="text-[10px] text-[#9CA3AF] truncate">{copy.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* SECTION 2: CONTEXTUAL TOOL OPTIONS */}
      {activeTool === 'corridor' && (
        <div className="p-3 border-b border-[#2D333D] space-y-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
            {exterior ? t('inspector.roadSection') : t('inspector.corridorSection')}
          </div>
          {exterior && (
            <div className="grid grid-cols-2 gap-1.5">
              {ROAD_STYLE_OPTIONS.map((option) => {
                const copy = messages.roadStyles[option.id];
                const texture = FLOOR_TEXTURES.find((item) => item.path === option.texturePath);
                const active = roadStyle === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => onChangeRoadStyle(option.id)}
                    className={`flex items-center gap-1.5 p-1.5 rounded-lg border text-left ${
                      active
                        ? 'bg-indigo-600/20 border-indigo-500 text-white'
                        : 'bg-[#1C1F24] border-[#2D333D] text-[#D1D5DB] hover:bg-[#252A32]'
                    }`}
                  >
                    {texture && (
                      <img src={texture.url} alt="" className="w-7 h-7 rounded object-cover shrink-0" />
                    )}
                    <span className="min-w-0">
                      <span className="block text-[11px] font-semibold leading-tight">{copy.name}</span>
                      <span className="block text-[10px] text-[#9CA3AF] truncate">{copy.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="space-y-1">
            <label className="text-[11px] text-[#9CA3AF]">
              {exterior ? t('inspector.roadWidth') : t('inspector.corridorWidth')}
            </label>
            <div className={`grid gap-1.5 ${exterior ? 'grid-cols-4' : 'grid-cols-3'}`}>
              {(exterior ? [0.5, 1, 2, 3] : [1, 2, 3]).map((w) => (
                <button
                  key={w}
                  onClick={() => onChangeCorridorWidth(w)}
                  className={`py-1.5 rounded text-xs font-mono-tech border transition-colors ${
                    corridorWidthCells === w
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-[#1C1F24] border-[#2D333D] text-[#D1D5DB] hover:bg-[#252A32]'
                  }`}
                >
                  {t('units.cellsShort', { n: w })}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-[#D1D5DB]">
              {exterior ? t('inspector.roadElbow') : t('inspector.corridorElbow')}
            </span>
            <button
              onClick={onToggleCorridorElbow}
              className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                corridorElbowMode
                  ? 'bg-indigo-600/25 border-indigo-500 text-indigo-300'
                  : 'bg-[#1C1F24] border-[#2D333D] text-[#9CA3AF]'
              }`}
            >
              {corridorElbowMode ? t('inspector.elbowOn') : t('inspector.elbowStraight')}
            </button>
          </div>
        </div>
      )}

      {exterior && activeTool === 'wall' && (
        <div className="p-3 border-b border-[#2D333D] space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
            {t('inspector.exteriorWallSection')}
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {EXTERIOR_WALL_STYLE_OPTIONS.map((id) => {
              const copy = messages.exteriorWalls[id];
              const active = exteriorWallStyle === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChangeExteriorWallStyle(id)}
                  className={`flex items-center gap-2 p-1.5 rounded-lg border text-left ${
                    active
                      ? 'bg-indigo-600/20 border-indigo-500 text-white'
                      : 'bg-[#1C1F24] border-[#2D333D] text-[#D1D5DB] hover:bg-[#252A32]'
                  }`}
                >
                  <ExteriorWallPreviewSvg style={id} />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold leading-tight">{copy.name}</span>
                    <span className="block text-[10px] text-[#9CA3AF] truncate">{copy.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onToggleExteriorWallTowers}
            className={`w-full py-1.5 rounded border text-xs ${
              exteriorWallTowers
                ? 'bg-indigo-600/25 border-indigo-500 text-indigo-200'
                : 'bg-[#1C1F24] border-[#2D333D] text-[#D1D5DB]'
            }`}
          >
            {exteriorWallTowers ? t('inspector.towersOnLong') : t('inspector.towers')}
          </button>
        </div>
      )}

      {activeTool === 'eraser' && (
        <div className="p-3 border-b border-[#2D333D] space-y-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
            {t('inspector.eraserShape')}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {(
              [
                ['rect', t('eraserShapes.rect')],
                ['polygon', t('eraserShapes.polygon')],
                ['stroke', t('eraserShapes.strokeShort')],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => onChangeEraserShape(id)}
                className={`py-1.5 rounded border text-[11px] ${
                  eraserShape === id
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'bg-[#1C1F24] border-[#2D333D] text-[#D1D5DB] hover:bg-[#252A32]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {eraserShape === 'stroke' && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-[#9CA3AF]">
                <span>{t('inspector.strokeWidth')}</span>
                <span className="font-mono-tech text-indigo-400">{t('units.cellsShort', { n: eraserStrokeCells })}</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="4"
                step="0.25"
                value={eraserStrokeCells}
                onChange={(event) => onChangeEraserStroke(parseFloat(event.target.value))}
                className="w-full accent-indigo-500"
              />
            </div>
          )}
          <p className="text-[10px] leading-snug text-[#9CA3AF]">
            {eraserShape === 'polygon'
              ? t('inspector.eraserPolygonHint')
              : eraserShape === 'stroke'
                ? t('inspector.eraserStrokeHint')
                : t('inspector.eraserRectHint')}
          </p>
        </div>
      )}

      {activeTool === 'district' && (
        <div className="p-3 border-b border-[#2D333D] space-y-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
            {t('inspector.districtSection')}
          </div>
          <div className="grid grid-cols-2 gap-1">
            {(
              [
                ['rect', t('eraserShapes.rect')],
                ['polygon', t('eraserShapes.polygon')],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => onChangeDistrictArea(id)}
                className={`py-1.5 rounded border text-[11px] ${
                  districtArea === id
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'bg-[#1C1F24] border-[#2D333D] text-[#D1D5DB]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-[#9CA3AF]">
              <span>{t('inspector.density')}</span>
              <span className="font-mono-tech text-indigo-400">{Math.round(districtDensity * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.15"
              max="0.9"
              step="0.05"
              value={districtDensity}
              onChange={(event) => onChangeDistrictDensity(parseFloat(event.target.value))}
              className="w-full accent-indigo-500"
            />
            <div className="grid grid-cols-3 gap-1">
              {(
                [
                  [0.2, t('inspector.densitySparse')],
                  [0.5, t('inspector.densityMedium')],
                  [0.85, t('inspector.densityDense')],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => onChangeDistrictDensity(value)}
                  className="py-1 rounded border border-[#2D333D] bg-[#1C1F24] text-[10px] text-[#D1D5DB] hover:bg-[#252A32]"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-[11px] text-[#9CA3AF]">{t('inspector.buildingSize')}</div>
            <div className="grid grid-cols-2 gap-1">
              {(
                [
                  ['small', t('inspector.sizeSmall')],
                  ['medium', t('inspector.sizeTown')],
                  ['large', t('inspector.sizeLarge')],
                  ['mixed', t('inspector.sizeMixed')],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChangeDistrictSize(id)}
                  className={`py-1.5 rounded border text-[11px] ${
                    districtSize === id
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-[#1C1F24] border-[#2D333D] text-[#D1D5DB]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-[11px] text-[#9CA3AF]">{t('inspector.angles')}</div>
            <div className="grid grid-cols-1 gap-1">
              {(
                [
                  ['random', t('inspector.angleRandom')],
                  ['jitter', t('inspector.angleJitter')],
                  ['aligned', t('inspector.angleAligned')],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChangeDistrictAngle(id)}
                  className={`py-1.5 rounded border text-[11px] ${
                    districtAngle === id
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-[#1C1F24] border-[#2D333D] text-[#D1D5DB]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[10px] leading-snug text-[#9CA3AF]">
            {t('inspector.districtHint')}
          </p>
        </div>
      )}

      {activeTool === 'cave' && (
        <div className="p-3 border-b border-[#2D333D] space-y-2">
          <div className="flex justify-between text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
            <span>{exterior ? t('inspector.buildingBrush') : t('inspector.caveBrush')}</span>
            <span className="font-mono-tech text-indigo-400">{t('units.cells', { n: caveBrushCells })}</span>
          </div>
          <input
            type="range"
            min="1"
            max="4"
            step="0.5"
            value={caveBrushCells}
            onChange={(e) => onChangeCaveBrush(parseFloat(e.target.value))}
            className="w-full accent-indigo-500"
          />
        </div>
      )}

      {activeTool === 'texture' && (
        <div className="p-3 border-b border-[#2D333D] space-y-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
            {exterior ? t('inspector.groundTexture') : t('inspector.floorTexture')}
          </div>
          <div className="grid grid-cols-4 gap-1 max-h-44 overflow-y-auto pr-0.5">
            {FLOOR_TEXTURES.map((texture) => {
              const selected = texture.path === texturePath;
              return (
                <button
                  key={texture.path}
                  type="button"
                  title={texture.label}
                  onClick={() => onChangeTexturePath(texture.path)}
                  className={`rounded border overflow-hidden aspect-square ${
                    selected
                      ? 'border-indigo-400 ring-1 ring-indigo-400'
                      : 'border-[#2D333D] hover:border-[#3F4856]'
                  }`}
                >
                  <img src={texture.url} alt={texture.label} className="w-full h-full object-cover" />
                </button>
              );
            })}
          </div>
          <div className="text-[10px] text-[#9CA3AF] truncate">
            {FLOOR_TEXTURES.find((texture) => texture.path === texturePath)?.label}
          </div>

          <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-[#1C1F24] border border-[#2D333D]">
            <button
              type="button"
              onClick={() => onChangeTextureMode('brush')}
              className={`py-1 rounded-md text-xs font-medium transition-colors ${
                textureMode === 'brush' ? 'bg-indigo-600 text-white' : 'text-[#9CA3AF] hover:text-[#F1F3F5]'
              }`}
            >
              {t('inspector.brush')}
            </button>
            <button
              type="button"
              onClick={() => onChangeTextureMode('bucket')}
              className={`py-1 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1 ${
                textureMode === 'bucket' ? 'bg-indigo-600 text-white' : 'text-[#9CA3AF] hover:text-[#F1F3F5]'
              }`}
            >
              <PaintBucket className="w-3 h-3" /> {t('inspector.bucket')}
            </button>
          </div>

          {textureMode === 'brush' && (
            <>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    ['round', t('inspector.brushRound'), Circle],
                    ['square', t('inspector.brushSquare'), Square],
                    ['spray', t('inspector.brushSpray'), SprayCan],
                  ] as const
                ).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onChangeTextureShape(id)}
                    className={`flex flex-col items-center gap-0.5 py-1.5 rounded border text-[10px] ${
                      textureShape === id
                        ? 'bg-indigo-600/20 border-indigo-500 text-white'
                        : 'bg-[#1C1F24] border-[#2D333D] text-[#D1D5DB] hover:bg-[#252A32]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-[#9CA3AF]">
                  <span>{t('inspector.brushSize')}</span>
                  <span className="font-mono-tech text-indigo-400">
                    {t('units.cellsShort', { n: textureBrushCells })}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="6"
                  step="0.5"
                  value={textureBrushCells}
                  onChange={(e) => onChangeTextureBrush(parseFloat(e.target.value))}
                  className="w-full accent-indigo-500"
                />
              </div>
              <button
                type="button"
                onClick={onToggleTextureErasing}
                className={`w-full flex items-center justify-center gap-1.5 py-1.5 rounded border text-xs ${
                  textureErasing
                    ? 'bg-red-950/70 border-red-700 text-red-200'
                    : 'bg-[#1C1F24] border-[#2D333D] text-[#D1D5DB] hover:bg-[#252A32]'
                }`}
              >
                <Eraser className="w-3.5 h-3.5" />
                {textureErasing ? t('inspector.eraserOn') : t('inspector.eraser')}
              </button>
            </>
          )}

          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-[#9CA3AF]">
              <span>{t('inspector.softness')}</span>
              <span className="font-mono-tech text-indigo-400">{Math.round(textureSoftness * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={textureSoftness}
              onChange={(e) => onChangeTextureSoftness(parseFloat(e.target.value))}
              className="w-full accent-indigo-500"
            />
          </div>
          {textureMode === 'bucket' && (
            <p className="text-[10px] leading-snug text-[#9CA3AF]">
              {exterior ? t('inspector.bucketExterior') : t('inspector.bucketInterior')}
            </p>
          )}
        </div>
      )}

      {activeTool === 'door' && (
        <div className="p-3 border-b border-[#2D333D] space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
            {t('inspector.chooseDoor')}
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {DOOR_TYPE_OPTIONS.map((id) => {
              const active = activeDoorType === id;
              return (
                <button
                  key={id}
                  onClick={() => onChangeDoorType(id)}
                  className={`flex items-center justify-between px-2.5 py-2 rounded-lg border text-xs transition-colors ${
                    active
                      ? 'bg-indigo-600/20 border-indigo-500 text-white'
                      : 'bg-[#1C1F24] border-[#2D333D] text-[#D1D5DB] hover:bg-[#252A32]'
                  }`}
                >
                  <span>{messages.doors[id]}</span>
                  <svg viewBox="-24 -16 48 32" className="w-11 h-7">
                    <SvgDoorArtwork
                      type={id}
                      widthPx={doorWidthCells(id) >= 2 ? 40 : 28}
                      inkColor="#F1F3F5"
                      floorColor="#1C1F24"
                    />
                  </svg>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {activeTool === 'stairs' && (
        <div className="p-3 border-b border-[#2D333D] space-y-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
            {t('inspector.chooseStairs')}
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {STAIR_TYPE_OPTIONS.map((id) => {
              const active = activeStairType === id;
              return (
                <button
                  key={id}
                  onClick={() => onChangeStairType(id)}
                  className={`flex items-center justify-between px-2.5 py-2 rounded-lg border text-xs transition-colors ${
                    active
                      ? 'bg-indigo-600/20 border-indigo-500 text-white'
                      : 'bg-[#1C1F24] border-[#2D333D] text-[#D1D5DB] hover:bg-[#252A32]'
                  }`}
                >
                  <span>{messages.stairs[id]}</span>
                  <svg viewBox="-20 -20 40 40" className="w-8 h-8">
                    <SvgStairArtwork
                      type={id}
                      widthPx={24}
                      lengthPx={30}
                      inkColor="#F1F3F5"
                      floorColor="#1C1F24"
                    />
                  </svg>
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-[#9CA3AF]">{t('inspector.orientation', { degrees: pendingRotation })}</span>
            <button
              onClick={() => onChangePendingRotation((pendingRotation + 90) % 360)}
              className="flex items-center gap-1 px-2 py-1 rounded bg-[#252A32] hover:bg-[#2F3640] text-xs"
            >
              <RotateCw className="w-3 h-3" /> {t('inspector.rotate90')}
            </button>
          </div>
        </div>
      )}

      {activeTool === 'prop' && (
        <div className="p-3 border-b border-[#2D333D] space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              {t('inspector.propLibrary')}
            </span>
            <button
              onClick={() => onChangePendingRotation((pendingRotation + 45) % 360)}
              className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300"
            >
              <RotateCw className="w-3 h-3" /> {pendingRotation}°
            </button>
          </div>

          {/* SVG vs PNG Sub-tabs */}
          <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-[#1C1F24] border border-[#2D333D]">
            <button
              onClick={() => setPropTab('svg')}
              className={`py-1 rounded-md text-xs font-medium transition-colors ${
                propTab === 'svg'
                  ? 'bg-indigo-600 text-white'
                  : 'text-[#9CA3AF] hover:text-[#F1F3F5]'
              }`}
            >
              {t('inspector.vectors')}
            </button>
            <button
              onClick={() => setPropTab('png')}
              className={`py-1 rounded-md text-xs font-medium transition-colors ${
                propTab === 'png'
                  ? 'bg-indigo-600 text-white'
                  : 'text-[#9CA3AF] hover:text-[#F1F3F5]'
              }`}
            >
              {t('inspector.pngArt')}
            </button>
          </div>

          {propTab === 'svg' ? (
            <div className="grid grid-cols-3 gap-1.5 max-h-60 overflow-y-auto pr-0.5">
              {SVG_PROP_CATALOG.map((item) => {
                const label = messages.props[item.id];
                const isSelected =
                  activePropPreset.kind === 'svg' && activePropPreset.svgPropId === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() =>
                      onSelectPropPreset({
                        kind: 'svg',
                        svgPropId: item.id,
                        label,
                        widthPx: item.widthPx,
                        heightPx: item.heightPx,
                      })
                    }
                    title={`${label} · ${messages.propCategories[item.category]}`}
                    className={`flex flex-col items-center justify-center p-1.5 rounded-lg border transition-colors ${
                      isSelected
                        ? 'bg-indigo-600/20 border-indigo-500 text-white'
                        : 'bg-[#1C1F24] border-[#2D333D] hover:border-[#3F4856] text-[#D1D5DB]'
                    }`}
                  >
                    <svg viewBox="-28 -28 56 56" className="w-9 h-9">
                      <SvgPropArtwork
                        propId={item.id}
                        width={Math.min(42, item.widthPx / 2)}
                        height={Math.min(42, item.heightPx / 2)}
                        inkColor="#F1F3F5"
                        fillColor="#252A32"
                      />
                    </svg>
                    <span className="text-[10px] leading-tight text-center truncate w-full mt-0.5">
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <AssetBrowser
              selected={activePropPreset}
              customAssets={customPngs}
              onUpload={handleUploadPng}
              onSelect={onSelectPropPreset}
            />
          )}
        </div>
      )}

      </div>

      {/* SECTION 3: LAYERS MANAGER (Warstwy Lochu) */}
      <div className="shrink-0 border-t border-[#2D333D] p-3 space-y-2 max-h-[40%] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <span>{t('layers.count', { count: doc.layers.length })}</span>
          </div>
          <button
            ref={newLayerButtonRef}
            type="button"
            onClick={() => {
              if (layerMenuPos) {
                setLayerMenuPos(null);
                return;
              }
              openLayerMenu();
            }}
            aria-expanded={layerMenuPos !== null}
            aria-haspopup="menu"
            title={t('layers.addTitle')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-[#F1F3F5] ${
              layerMenuPos ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-[#252A32] hover:bg-[#323944]'
            }`}
          >
            <Plus className="w-3 h-3" />
            <span>{t('layers.add')}</span>
          </button>
        </div>

        {layerMenuPos &&
          createPortal(
            <>
              <div className="fixed inset-0 z-[80]" onClick={() => setLayerMenuPos(null)} />
              <div
                ref={layerMenuRef}
                role="menu"
                className="fixed z-[90] w-60 rounded-lg bg-[#1C1F24] border border-[#2D333D] shadow-2xl py-1.5"
                style={{ top: layerMenuPos.top, left: layerMenuPos.left }}
              >
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                  {t('layers.newHeading')}
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onAddLayer('interior');
                    setLayerMenuPos(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-[#252A32] transition-colors"
                >
                  <div className="text-xs font-medium text-[#F1F3F5]">{t('layers.interiorTitle')}</div>
                  <div className="text-[11px] text-[#9CA3AF]">{t('layers.interiorHint')}</div>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onAddLayer('exterior');
                    setLayerMenuPos(null);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-[#252A32] transition-colors"
                >
                  <div className="text-xs font-medium text-[#F1F3F5]">{t('layers.exteriorTitle')}</div>
                  <div className="text-[11px] text-[#9CA3AF]">{t('layers.exteriorHint')}</div>
                </button>
              </div>
            </>,
            document.body
          )}

        <div
          ref={layerListRef}
          className="space-y-1"
        >
          {doc.layers.map((layer, index) => {
            const isActive = layer.id === doc.activeLayerId;
            const environment = layerEnvironment(layer);
            const styleName =
              environment === 'exterior'
                ? messages.buildingStyles[layer.buildingStyle ?? 'roof_tile'].name
                : messages.wallStyles[layer.wallStyle].name;
            const canReorder = doc.layers.length > 1;
            const dropAt = layerDrag ? layerDropIndex(layerDrag.from, layerDrag.over) : null;
            const showDropLine = layerDrag !== null && dropAt !== layerDrag.from;
            const dropBefore = showDropLine && layerDrag.over === index;
            const dropAfter = showDropLine && layerDrag.over === doc.layers.length && index === doc.layers.length - 1;

            const rememberDragSlot = (clientY: number) => {
              const drag = layerDragRef.current;
              if (!drag || drag.committed) return;
              const scroller = layerListRef.current?.parentElement;
              if (scroller) {
                const bounds = scroller.getBoundingClientRect();
                if (clientY < bounds.top + 28) scroller.scrollTop -= 12;
                else if (clientY > bounds.bottom - 28) scroller.scrollTop += 12;
              }
              const over = slotIndexFromPoint(layerListRef.current, clientY);
              drag.active = true;
              drag.over = over;
              setLayerDrag((current) =>
                current && current.id === drag.id && current.from === drag.from && current.over === over
                  ? current
                  : { id: drag.id, from: drag.from, over }
              );
            };

            const commitLayerDrag = () => {
              const drag = layerDragRef.current;
              if (!drag || drag.committed || !drag.active) return;
              drag.committed = true;
              layerDragRef.current = null;
              setLayerDrag(null);
              const swallowClick = (clickEvent: MouseEvent) => {
                clickEvent.preventDefault();
                clickEvent.stopPropagation();
                window.removeEventListener('click', swallowClick, true);
              };
              window.addEventListener('click', swallowClick, true);
              window.setTimeout(() => window.removeEventListener('click', swallowClick, true), 50);
              const toIndex = layerDropIndex(drag.from, drag.over);
              if (toIndex !== drag.from) onReorderLayers(drag.id, toIndex);
              onSelectActiveLayer(drag.id);
            };

            const cancelLayerDrag = () => {
              if (!layerDragRef.current || layerDragRef.current.committed) return;
              layerDragRef.current = null;
              setLayerDrag(null);
            };

            const finishLayerDrag = (event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
              const drag = layerDragRef.current;
              if (!drag || drag.pointerId !== event.pointerId || drag.committed) return;
              try {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              } catch {
                // The pointer is already gone when a native drag session ends.
              }
              if (drag.html5) return;
              if (commit && drag.active) commitLayerDrag();
              else cancelLayerDrag();
            };

            const moveLayerDrag = (event: React.PointerEvent<HTMLDivElement>) => {
              const drag = layerDragRef.current;
              if (!drag || drag.html5 || drag.pointerId !== event.pointerId) return;
              if (!drag.active) {
                const dx = event.clientX - drag.startX;
                const dy = event.clientY - drag.startY;
                if (drag.fromInput) {
                  if (Math.abs(dy) < 8 || Math.abs(dx) > Math.abs(dy)) return;
                  event.currentTarget.querySelector('input')?.blur();
                } else if (Math.abs(dy) < 4) {
                  return;
                }
                try {
                  event.currentTarget.setPointerCapture(event.pointerId);
                } catch {
                  // Capture is optional; the row still receives the gesture.
                }
              }
              rememberDragSlot(event.clientY);
            };

            return (
              <div
                key={layer.id}
                data-layer-row
                onClick={() => onSelectActiveLayer(layer.id)}
                onPointerDown={(event) => {
                  if (!canReorder || event.button !== 0) return;
                  const target = event.target as HTMLElement;
                  const fromInput = Boolean(target.closest('input'));
                  if (target.closest('button') && !target.closest('[data-layer-grip]')) return;
                  layerDragRef.current = {
                    id: layer.id,
                    from: index,
                    over: index,
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    fromInput,
                    active: false,
                    html5: false,
                    committed: false,
                  };
                  if (fromInput) return;
                  try {
                    event.currentTarget.setPointerCapture(event.pointerId);
                  } catch {
                    // A native drag session may already own the pointer.
                  }
                }}
                onPointerMove={moveLayerDrag}
                onPointerUp={(event) => finishLayerDrag(event, true)}
                onPointerCancel={(event) => finishLayerDrag(event, false)}
                onDragOver={(event) => {
                  if (!layerDragRef.current?.html5) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  rememberDragSlot(event.clientY);
                }}
                onDrop={(event) => {
                  if (!layerDragRef.current?.html5) return;
                  event.preventDefault();
                  rememberDragSlot(event.clientY);
                  commitLayerDrag();
                }}
                className={`group flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg border transition-colors ${
                  canReorder ? 'cursor-grab' : 'cursor-pointer'
                } ${
                  layerDrag?.id === layer.id ? 'opacity-45' : ''
                } ${
                  dropBefore ? 'shadow-[inset_0_2px_0_0_#818cf8]' : ''
                } ${
                  dropAfter ? 'shadow-[inset_0_-2px_0_0_#818cf8]' : ''
                } ${
                  isActive
                    ? 'bg-indigo-600/15 border-indigo-500/60'
                    : 'bg-[#1C1F24] border-[#2D333D] hover:border-[#3A4250]'
                }`}
              >
                <div className="min-w-0 flex-1 flex items-center gap-1">
                  {canReorder && (
                    <button
                      type="button"
                      draggable
                      data-layer-grip
                      title={t('layers.reorder')}
                      aria-label={t('layers.reorder')}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move';
                        try {
                          event.dataTransfer.setData('text/plain', layer.id);
                        } catch {
                          // Some drag sessions expose a locked data store.
                        }
                        const existing = layerDragRef.current;
                        if (existing && existing.id === layer.id && !existing.committed) {
                          existing.html5 = true;
                          existing.active = true;
                        } else {
                          layerDragRef.current = {
                            id: layer.id,
                            from: index,
                            over: index,
                            pointerId: -1,
                            startX: event.clientX,
                            startY: event.clientY,
                            fromInput: false,
                            active: true,
                            html5: true,
                            committed: false,
                          };
                        }
                        setLayerDrag({ id: layer.id, from: index, over: layerDragRef.current?.over ?? index });
                      }}
                      onDragEnd={(event) => {
                        const drag = layerDragRef.current;
                        if (!drag || drag.committed || drag.id !== layer.id) return;
                        const moved = Math.abs(event.clientY - drag.startY) >= 4;
                        const accepted = event.dataTransfer?.dropEffect === 'move';
                        if (event.clientY <= 0 || (!moved && !accepted)) {
                          cancelLayerDrag();
                          return;
                        }
                        drag.html5 = true;
                        drag.active = true;
                        rememberDragSlot(event.clientY);
                        commitLayerDrag();
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowUp' && index > 0) {
                          event.preventDefault();
                          onReorderLayers(layer.id, index - 1);
                        } else if (event.key === 'ArrowDown' && index < doc.layers.length - 1) {
                          event.preventDefault();
                          onReorderLayers(layer.id, index + 1);
                        }
                      }}
                      className="shrink-0 -ml-1 p-0.5 rounded text-[#6B7280] hover:text-white hover:bg-[#252A32] cursor-grab"
                    >
                      <GripVertical className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <input
                      type="text"
                      value={layer.name}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onRenameLayer(layer.id, e.target.value)}
                      className="w-full bg-transparent text-xs font-medium text-[#F1F3F5] outline-none truncate cursor-text select-text"
                    />
                    <div className="text-[10px] text-[#9CA3AF] flex items-center gap-1.5">
                      <span>
                        {environment === 'exterior' ? t('layers.exterior') : t('layers.interior')} · {styleName}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onSetLayerEnvironment(
                        layer.id,
                        environment === 'exterior' ? 'interior' : 'exterior'
                      );
                    }}
                    title={environment === 'exterior' ? t('layers.switchToInterior') : t('layers.switchToExterior')}
                    className="cursor-pointer px-1 py-0.5 rounded text-[10px] font-medium text-[#9CA3AF] hover:text-white hover:bg-[#252A32]"
                  >
                    {environment === 'exterior' ? t('layers.toDungeon') : t('layers.toGrounds')}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleLayerVisibility(layer.id);
                    }}
                    title={layer.visible ? t('layers.hide') : t('layers.show')}
                    className="cursor-pointer p-1 rounded hover:bg-[#252A32] text-[#9CA3AF] hover:text-white"
                  >
                    {layer.visible ? (
                      <Eye className="w-3.5 h-3.5" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5 text-[#6B7280]" />
                    )}
                  </button>
                  {doc.layers.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteLayer(layer.id);
                      }}
                      title={t('layers.remove')}
                      className="cursor-pointer p-1 rounded hover:bg-red-950/70 text-[#6B7280] hover:text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
};
