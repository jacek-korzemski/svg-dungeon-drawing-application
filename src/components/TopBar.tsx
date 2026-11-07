import React, { useRef, useState } from 'react';
import {
  Check,
  Code2,
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
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { MAP_THEMES, PresetId } from '../data/presets';
import { useI18n, type Locale } from '../i18n';
import { MapThemeId } from '../types/dungeon';

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
  snapEnabled: boolean;
  onToggleSnap: () => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  onLoadPreset: (preset: PresetId) => void;
  themeId: MapThemeId;
  onChangeTheme: (themeId: MapThemeId) => void;
  onExportSvg: () => void;
  onExportPng: () => void;
  onExportJson: () => void;
  onImportJsonFile: (file: File) => void;
  onOpenSvgInspector: () => void;
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
  snapEnabled,
  onToggleSnap,
  showGrid,
  onToggleGrid,
  onLoadPreset,
  themeId,
  onChangeTheme,
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
  const activeTheme = MAP_THEMES[themeId];
  const activeThemeName = messages.themes[themeId].name;
  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const presetItems: PresetId[] = ['starter', 'caverns', 'fortress', 'settlement', 'empty'];

  return (
    <header className="h-12 px-3 bg-[#141619] border-b border-[#2D333D] flex items-center justify-between gap-2 z-30 shrink-0">
      {/* Left: Brand + Map Title + Preset Switcher */}
      <div className="flex items-center gap-2.5 min-w-0">
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
          className="bg-[#1C1F24] hover:bg-[#252A32] focus:bg-[#252A32] text-[#F1F3F5] text-xs font-medium px-2.5 py-1.5 rounded border border-transparent focus:border-indigo-500/60 outline-none w-44 sm:w-56 truncate transition-colors"
        />

        {/* Presets Dropdown */}
        <div className="relative">
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

        <div className="relative">
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
              <div className="absolute left-0 mt-1.5 w-60 rounded-lg bg-[#1C1F24] border border-[#2D333D] shadow-2xl py-1.5 z-50">
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
              </div>
            </>
          )}
        </div>
      </div>

      {/* Center: Undo/Redo + Grid/Snap Toggles + Zoom */}
      <div className="flex items-center gap-1.5">
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
          <button
            onClick={onToggleSnap}
            title={t('topBar.snap')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
              snapEnabled
                ? 'bg-indigo-600/25 text-indigo-300'
                : 'text-[#9CA3AF] hover:text-[#F1F3F5]'
            }`}
          >
            <Magnet className="w-3.5 h-3.5" />
            <span>{t('topBar.snapLabel')}</span>
          </button>
          <button
            onClick={onToggleGrid}
            title={t('topBar.grid')}
            className={`p-1.5 rounded transition-colors ${
              showGrid ? 'text-[#F1F3F5] bg-[#252A32]' : 'text-[#6B7280] hover:text-[#D1D5DB]'
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
          </button>
        </div>

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
      <div className="flex items-center gap-2">
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
                    <div className="text-[10px] text-[#9CA3AF]">{t('topBar.exportPngHint')}</div>
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
