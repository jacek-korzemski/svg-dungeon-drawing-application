import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Check,
  Diamond,
  Code2,
  Dices,
  Download,
  FileJson,
  FolderOpen,
  Grid,
  Image as ImageIcon,
  LayoutTemplate,
  Magnet,
  Maximize2,
  Palette,
  Redo2,
  RotateCcw,
  RotateCw,
  Square,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { MAP_THEMES, PresetId, resolveTheme, ThemeColorKey } from '../data/presets';
import { useI18n, type Locale } from '../i18n';
import { MapThemeId } from '../types/dungeon';
import type { IsoViewMode } from '../utils/isoProjection';
import { isSnapDivisor, type SnapDivisor } from '../utils/geometry';
import { MAX_GRID_SIZE, MIN_GRID_SIZE } from '../utils/scaleDocument';

interface TopBarProps {
  title: string;
  onTitleChange: (title: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onResetView: () => void;
  snapDivisor: SnapDivisor;
  onChangeSnapDivisor: (divisor: SnapDivisor) => void;
  gridSize: number;
  onChangeGridSize: (size: number) => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  viewMode: IsoViewMode;
  onSetViewMode: (mode: IsoViewMode) => void;
  onRotateIso: (delta: 1 | -1) => void;
  wallHeightCells: number;
  onWallHeightChange: (height: number) => void;
  onLoadPreset: (preset: PresetId) => void;
  onOpenRandomGenerator: () => void;
  themeId: MapThemeId;
  themeOverrides?: Partial<Record<ThemeColorKey, string>>;
  onChangeTheme: (themeId: MapThemeId) => void;
  onChangeThemeColor: (key: ThemeColorKey, value: string) => void;
  onResetThemeColor: (key: ThemeColorKey) => void;
  onResetThemeColors: () => void;
  onExportSvg: () => void;
  onExportPng: () => void;
  onExportJson: () => void;
  onImportJsonFile: (file: File) => void;
  onOpenSvgInspector: () => void;
}

function colorInputValue(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
}

export const TopBar: React.FC<TopBarProps> = ({
  title,
  onTitleChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoom,
  onZoomChange,
  onResetView,
  snapDivisor,
  onChangeSnapDivisor,
  gridSize,
  onChangeGridSize,
  showGrid,
  onToggleGrid,
  viewMode,
  onSetViewMode,
  onRotateIso,
  wallHeightCells,
  onWallHeightChange,
  onLoadPreset,
  onOpenRandomGenerator,
  themeId,
  themeOverrides,
  onChangeTheme,
  onChangeThemeColor,
  onResetThemeColor,
  onResetThemeColors,
  onExportSvg,
  onExportPng,
  onExportJson,
  onImportJsonFile,
  onOpenSvgInspector,
}) => {
  const { locale, setLocale, messages, t } = useI18n();
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const activeTheme = resolveTheme(themeId, themeOverrides);
  const activeThemeName = messages.themes[themeId].name;
  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const presetItems: PresetId[] = ['starter', 'caverns', 'fortress', 'settlement', 'empty'];
  const [gridDraft, setGridDraft] = useState(String(gridSize));
  useEffect(() => {
    setGridDraft(String(gridSize));
  }, [gridSize]);

  const commitGridSize = () => {
    const next = Math.round(Number(gridDraft));
    if (!Number.isFinite(next) || next < MIN_GRID_SIZE || next > MAX_GRID_SIZE) {
      setGridDraft(String(gridSize));
      return;
    }
    setGridDraft(String(next));
    if (next !== gridSize) onChangeGridSize(next);
  };

  return (
    <header className="h-12 px-3 bg-[#141619] border-b border-[#2D333D] flex items-center justify-between gap-2 z-30 shrink-0">
      {/* Left: Brand + Map Title + Preset Switcher */}
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5 overflow-hidden">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 rounded-md bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M4 4h7v6h9v10H4z" />
                <path d="M11 10v4" strokeDasharray="2 2" />
              </svg>
            </div>
            <span className="font-display font-bold text-sm tracking-tight text-[#F1F3F5] hidden sm:inline">
              Jinkline
            </span>
          </div>

          <span className="text-[#2D333D] hidden sm:inline">/</span>

          <input
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            aria-label={t('topBar.mapName')}
            className="min-w-0 bg-[#1C1F24] hover:bg-[#252A32] focus:bg-[#252A32] text-[#F1F3F5] text-xs font-medium px-2.5 py-1.5 rounded border border-transparent focus:border-indigo-500/60 outline-none w-44 sm:w-56 truncate transition-colors"
          />
        </div>

        {/* Presets Dropdown */}
        <div className="relative shrink-0">
          <button
            onClick={() => {
              setPresetMenuOpen((v) => !v);
              setThemeMenuOpen(false);
              setExportMenuOpen(false);
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#1C1F24] hover:bg-[#252A32] border border-[#2D333D] text-xs font-medium text-[#D1D5DB] transition-colors"
            title={t('topBar.presetsTitle')}
          >
            <LayoutTemplate className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden md:inline">{t('topBar.presets')}</span>
          </button>

          {presetMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setPresetMenuOpen(false)}
              />
              <div className="absolute left-0 mt-1.5 w-64 rounded-lg bg-[#1C1F24] border border-[#2D333D] shadow-2xl py-1.5 z-50">
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                  {t('topBar.presetsHeading')}
                </div>
                {presetItems.map((id) => (
                  <button
                    key={id}
                    onClick={() => {
                      onLoadPreset(id);
                      setPresetMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-[#252A32] transition-colors"
                  >
                    <div className="text-xs font-medium text-[#F1F3F5]">{messages.presets[id].title}</div>
                    <div className="text-[11px] text-[#9CA3AF]">{messages.presets[id].description}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            setPresetMenuOpen(false);
            setThemeMenuOpen(false);
            setExportMenuOpen(false);
            onOpenRandomGenerator();
          }}
          className="flex shrink-0 items-center gap-1.5 rounded border border-[#2D333D] bg-[#1C1F24] px-2.5 py-1.5 text-xs font-medium text-[#D1D5DB] transition-colors hover:bg-[#252A32]"
          title={t('topBar.randomMapTitle')}
        >
          <Dices className="h-3.5 w-3.5 text-indigo-400" />
          <span className="hidden md:inline">{t('topBar.randomMap')}</span>
        </button>

        <div className="relative shrink-0">
          <button
            onClick={() => {
              setThemeMenuOpen((v) => !v);
              setPresetMenuOpen(false);
              setExportMenuOpen(false);
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#1C1F24] hover:bg-[#252A32] border border-[#2D333D] text-xs font-medium text-[#D1D5DB] transition-colors"
            title={t('topBar.themeTitle', { name: activeThemeName })}
          >
            <span
              className="w-3 h-3 rounded-full border shrink-0"
              style={{ backgroundColor: activeTheme.floorFill, borderColor: activeTheme.inkStroke }}
            />
            <Palette className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden lg:inline max-w-28 truncate">{activeThemeName}</span>
          </button>

          {themeMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setThemeMenuOpen(false)} />
              <div className="absolute left-0 mt-1.5 w-72 max-h-[70vh] overflow-auto rounded-lg bg-[#1C1F24] border border-[#2D333D] shadow-2xl py-1.5 z-50">
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                  {t('topBar.themeHeading')}
                </div>
                {Object.values(MAP_THEMES).map((theme) => {
                  const active = theme.id === themeId;
                  return (
                    <button
                      key={theme.id}
                      onClick={() => {
                        onChangeTheme(theme.id);
                        setThemeMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#252A32] transition-colors"
                    >
                      <span
                        className="w-4 h-4 rounded-full border shrink-0"
                        style={{ backgroundColor: theme.floorFill, borderColor: theme.inkStroke }}
                      />
                      <span className="text-xs font-medium text-[#F1F3F5] flex-1">
                        {messages.themes[theme.id].name}
                      </span>
                      {active && <Check className="w-3.5 h-3.5 text-indigo-300" />}
                    </button>
                  );
                })}
                <div className="mx-3 my-1.5 border-t border-[#2D333D]" />
                {(
                  [
                    ['floorFill', 'topBar.paletteFloor'],
                    ['wallFill', 'topBar.paletteWall'],
                    ['inkStroke', 'topBar.paletteInk'],
                    ['hatchStroke', 'topBar.paletteHatch'],
                    ['floorGrid', 'topBar.paletteFloorGrid'],
                    ['bgVoid', 'topBar.paletteVoid'],
                    ['gridMajor', 'topBar.paletteGrid'],
                    ['accentLabel', 'topBar.paletteLabel'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 px-3 py-1">
                    <input
                      type="color"
                      value={colorInputValue(activeTheme[key])}
                      onChange={(event) => onChangeThemeColor(key, event.target.value)}
                      className="h-5 w-7 shrink-0 cursor-pointer border-0 bg-transparent p-0"
                    />
                    <span className="flex-1 text-[11px] text-[#D1D5DB]">{t(label)}</span>
                    {themeOverrides?.[key] && (
                      <button
                        type="button"
                        onClick={() => onResetThemeColor(key)}
                        className="text-[10px] text-[#9CA3AF] hover:text-[#F1F3F5]"
                      >
                        {t('topBar.paletteReset')}
                      </button>
                    )}
                  </label>
                ))}
                <div className="px-3 pt-1.5">
                  <button
                    type="button"
                    onClick={onResetThemeColors}
                    className="w-full rounded border border-[#2D333D] px-2 py-1 text-[10px] text-[#9CA3AF] hover:border-[#3D4654] hover:text-[#F1F3F5]"
                  >
                    {t('topBar.paletteResetAll')}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Center: Undo/Redo + Grid/Snap Toggles + Zoom */}
      <div className="flex shrink-0 items-center gap-1.5">
        <div className="flex items-center bg-[#1C1F24] border border-[#2D333D] rounded-md p-0.5">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            title={t('topBar.undo')}
            className="p-1.5 rounded text-[#D1D5DB] hover:bg-[#252A32] disabled:opacity-35 disabled:pointer-events-none"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            title={t('topBar.redo')}
            className="p-1.5 rounded text-[#D1D5DB] hover:bg-[#252A32] disabled:opacity-35 disabled:pointer-events-none"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="hidden lg:flex items-center bg-[#1C1F24] border border-[#2D333D] rounded-md p-0.5">
          <label
            className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium ${
              snapDivisor > 0 ? 'bg-indigo-600/25 text-indigo-300' : 'text-[#9CA3AF]'
            }`}
            title={t('topBar.snap')}
          >
            <Magnet className="w-3.5 h-3.5" />
            <select
              aria-label={t('topBar.snap')}
              value={snapDivisor}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (isSnapDivisor(next)) onChangeSnapDivisor(next);
              }}
              className="bg-[#1C1F24] text-xs font-medium text-[#F1F3F5] outline-none"
            >
              <option value={0} className="bg-[#1C1F24] text-[#F1F3F5]">{t('topBar.snapOff')}</option>
              <option value={1} className="bg-[#1C1F24] text-[#F1F3F5]">1</option>
              <option value={2} className="bg-[#1C1F24] text-[#F1F3F5]">1/2</option>
              <option value={3} className="bg-[#1C1F24] text-[#F1F3F5]">1/3</option>
              <option value={4} className="bg-[#1C1F24] text-[#F1F3F5]">1/4</option>
            </select>
          </label>
          <button
            onClick={onToggleGrid}
            title={t('topBar.grid')}
            className={`p-1.5 rounded transition-colors ${
              showGrid ? 'text-[#F1F3F5] bg-[#252A32]' : 'text-[#6B7280] hover:text-[#D1D5DB]'
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
          </button>
          <form
            className="flex items-center gap-1 px-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              commitGridSize();
            }}
          >
            <input
              type="number"
              min={MIN_GRID_SIZE}
              max={MAX_GRID_SIZE}
              step={1}
              value={gridDraft}
              aria-label={t('topBar.gridSize')}
              title={t('topBar.gridSize')}
              onChange={(event) => setGridDraft(event.target.value)}
              onBlur={commitGridSize}
              className="w-12 bg-transparent text-right font-mono-tech text-xs text-[#F1F3F5] outline-none"
            />
            <span className="text-[10px] text-[#9CA3AF]">px</span>
          </form>
        </div>

        <div className="flex items-center rounded-md border border-[#2D333D] bg-[#1C1F24] p-0.5" role="group" aria-label={t('topBar.viewIsoTitle')}>
          <button
            type="button"
            aria-pressed={viewMode === 'flat'}
            title={t('topBar.view2dTitle')}
            onClick={() => onSetViewMode('flat')}
            className={`flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-semibold ${
              viewMode === 'flat' ? 'bg-indigo-600 text-white' : 'text-[#9CA3AF] hover:text-[#F1F3F5]'
            }`}
          >
            <Square className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">{t('topBar.view2d')}</span>
          </button>
          <button
            type="button"
            aria-pressed={viewMode === 'iso'}
            title={t('topBar.viewIsoTitle')}
            onClick={() => onSetViewMode('iso')}
            className={`flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-semibold ${
              viewMode === 'iso' ? 'bg-indigo-600 text-white' : 'text-[#9CA3AF] hover:text-[#F1F3F5]'
            }`}
          >
            <Diamond className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">{t('topBar.viewIso')}</span>
          </button>
          <button
            type="button"
            aria-pressed={viewMode === '3d'}
            title={t('topBar.view3dTitle')}
            onClick={() => onSetViewMode('3d')}
            className={`flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-semibold ${
              viewMode === '3d' ? 'bg-indigo-600 text-white' : 'text-[#9CA3AF] hover:text-[#F1F3F5]'
            }`}
          >
            <Box className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">{t('topBar.view3d')}</span>
          </button>
        </div>

        {viewMode !== 'flat' && (
          <div className="flex items-center gap-1 rounded-md border border-[#2D333D] bg-[#1C1F24] p-0.5">
            <button type="button" title={t('topBar.rotateLeft')} onClick={() => onRotateIso(-1)} className="rounded p-1.5 text-[#D1D5DB] hover:bg-[#252A32]">
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button type="button" title={t('topBar.rotateRight')} onClick={() => onRotateIso(1)} className="rounded p-1.5 text-[#D1D5DB] hover:bg-[#252A32]">
              <RotateCw className="h-3.5 w-3.5" />
            </button>
            {viewMode === '3d' && (
              <label className="flex items-center gap-1 px-1 text-[10px] text-[#9CA3AF]" title={t('topBar.wallHeight')}>
                <input
                  type="range"
                  min={0.35}
                  max={1.6}
                  step={0.05}
                  value={wallHeightCells}
                  aria-label={t('topBar.wallHeight')}
                  onChange={(event) => onWallHeightChange(Number(event.target.value))}
                  className="w-14 accent-indigo-500"
                />
                <span className="w-7 font-mono-tech text-[#D1D5DB]">{wallHeightCells.toFixed(2)}</span>
              </label>
            )}
          </div>
        )}

        {/* Zoom Controls */}
        <div className="hidden sm:flex items-center bg-[#1C1F24] border border-[#2D333D] rounded-md p-0.5">
          <button
            onClick={() => onZoomChange(Math.max(0.15, Number((zoom - 0.15).toFixed(2))))}
            title={t('topBar.zoomOut')}
            className="p-1.5 rounded text-[#D1D5DB] hover:bg-[#252A32]"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="font-mono-tech text-[11px] text-[#D1D5DB] px-1.5 min-w-[44px] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => onZoomChange(Math.min(3.0, Number((zoom + 0.15).toFixed(2))))}
            title={t('topBar.zoomIn')}
            className="p-1.5 rounded text-[#D1D5DB] hover:bg-[#252A32]"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onResetView}
            title={t('topBar.resetView')}
            className="p-1.5 rounded text-[#9CA3AF] hover:text-[#F1F3F5] hover:bg-[#252A32]"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Right: SVG Code Inspector + Export Menu */}
      <div className="flex shrink-0 items-center gap-2">
        <div
          className="flex items-center bg-[#1C1F24] border border-[#2D333D] rounded-md p-0.5"
          role="group"
          aria-label={t('topBar.language')}
        >
          {(['pl', 'en'] as const satisfies readonly Locale[]).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setLocale(code)}
              aria-pressed={locale === code}
              className={`px-1.5 py-1 rounded text-[10px] font-semibold tracking-wide ${
                locale === code ? 'bg-indigo-600 text-white' : 'text-[#9CA3AF] hover:text-[#F1F3F5]'
              }`}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          onClick={onOpenSvgInspector}
          title={t('topBar.svgCodeTitle')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#1C1F24] hover:bg-[#252A32] border border-[#2D333D] text-xs font-medium text-[#D1D5DB] transition-colors"
        >
          <Code2 className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden md:inline">{t('topBar.svgCode')}</span>
        </button>

        <div className="relative">
          <button
            onClick={() => {
              setExportMenuOpen((v) => !v);
              setPresetMenuOpen(false);
              setThemeMenuOpen(false);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-sm transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{t('topBar.export')}</span>
          </button>

          {exportMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setExportMenuOpen(false)}
              />
              <div className="absolute right-0 mt-1.5 w-60 rounded-lg bg-[#1C1F24] border border-[#2D333D] shadow-2xl py-1.5 z-50">
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                  {t('topBar.exportHeading')}
                </div>
                <button
                  onClick={() => {
                    onExportSvg();
                    setExportMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#252A32] transition-colors"
                >
                  <Code2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div>
                    <div className="text-xs font-medium text-[#F1F3F5]">{t('topBar.exportSvg')}</div>
                    <div className="text-[10px] text-[#9CA3AF]">{t('topBar.exportSvgHint')}</div>
                  </div>
                </button>
                <button
                  onClick={() => {
                    onExportPng();
                    setExportMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#252A32] transition-colors"
                >
                  <ImageIcon className="w-4 h-4 text-sky-400 shrink-0" />
                  <div>
                    <div className="text-xs font-medium text-[#F1F3F5]">{t('topBar.exportPng')}</div>
                    <div className="text-[10px] text-[#9CA3AF]">{t('topBar.exportPngHint', { px: gridSize })}</div>
                  </div>
                </button>
                <div className="my-1 border-t border-[#2D333D]" />
                <button
                  onClick={() => {
                    onExportJson();
                    setExportMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#252A32] transition-colors"
                >
                  <FileJson className="w-4 h-4 text-amber-400 shrink-0" />
                  <div>
                    <div className="text-xs font-medium text-[#F1F3F5]">{t('topBar.exportJson')}</div>
                    <div className="text-[10px] text-[#9CA3AF]">{t('topBar.exportJsonHint')}</div>
                  </div>
                </button>
                <button
                  onClick={() => {
                    jsonInputRef.current?.click();
                    setExportMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#252A32] transition-colors"
                >
                  <FolderOpen className="w-4 h-4 text-purple-400 shrink-0" />
                  <div>
                    <div className="text-xs font-medium text-[#F1F3F5]">{t('topBar.importJson')}</div>
                    <div className="text-[10px] text-[#9CA3AF]">{t('topBar.importJsonHint')}</div>
                  </div>
                </button>
              </div>
            </>
          )}
        </div>

        <input
          ref={jsonInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImportJsonFile(f);
            e.target.value = '';
          }}
        />
      </div>
    </header>
  );
};
