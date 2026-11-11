import React, { useEffect, useState } from 'react';
import { Dices, X } from 'lucide-react';
import { useI18n } from '../i18n';
import {
  DEFAULT_RANDOM_MAP_CONFIG,
  RandomMapConfig,
  RandomMapSize,
  RandomMapStage,
  generateRandomMap,
} from '../utils/randomMapGenerator';
import { DungeonDocument, MapThemeId } from '../types/dungeon';

const STORAGE_KEY = 'jinkline.randomMapConfig';
const SIZES: RandomMapSize[] = ['small', 'medium', 'large', 'mega'];

interface RandomMapModalProps {
  isOpen: boolean;
  themeId: MapThemeId;
  onClose: () => void;
  onGenerated: (doc: DungeonDocument) => void;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function readConfig(): RandomMapConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_RANDOM_MAP_CONFIG;
    const parsed = JSON.parse(raw) as Partial<RandomMapConfig>;
    const size = SIZES.includes(parsed.size as RandomMapSize) ? (parsed.size as RandomMapSize) : DEFAULT_RANDOM_MAP_CONFIG.size;
    let dungeon = typeof parsed.dungeon === 'boolean' ? parsed.dungeon : DEFAULT_RANDOM_MAP_CONFIG.dungeon;
    let exterior = typeof parsed.exterior === 'boolean' ? parsed.exterior : DEFAULT_RANDOM_MAP_CONFIG.exterior;
    if (!dungeon && !exterior) dungeon = true;
    return {
      dungeon,
      exterior,
      maxDungeonLayers: clampInt(parsed.maxDungeonLayers, 1, 4, DEFAULT_RANDOM_MAP_CONFIG.maxDungeonLayers),
      maxExteriorLayers: clampInt(parsed.maxExteriorLayers, 1, 8, DEFAULT_RANDOM_MAP_CONFIG.maxExteriorLayers),
      useTextures: typeof parsed.useTextures === 'boolean' ? parsed.useTextures : DEFAULT_RANDOM_MAP_CONFIG.useTextures,
      size,
    };
  } catch {
    return DEFAULT_RANDOM_MAP_CONFIG;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const RandomMapModal: React.FC<RandomMapModalProps> = ({ isOpen, themeId, onClose, onGenerated }) => {
  const { t, messages } = useI18n();
  const [config, setConfig] = useState<RandomMapConfig>(readConfig);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(false);
  const [progress, setProgress] = useState<{ stage: RandomMapStage; pct: number }>({ stage: 'layout', pct: 0 });

  useEffect(() => {
    if (!isOpen) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      // The choice still applies for this session.
    }
  }, [config, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !running) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, running]);

  if (!isOpen) return null;

  const setDungeon = (on: boolean) => {
    setConfig((current) => {
      if (!on && !current.exterior) return { ...current, dungeon: false, exterior: true };
      return { ...current, dungeon: on };
    });
  };
  const setExterior = (on: boolean) => {
    setConfig((current) => {
      if (!on && !current.dungeon) return { ...current, exterior: false, dungeon: true };
      return { ...current, exterior: on };
    });
  };

  const generate = async () => {
    if (running || (!config.dungeon && !config.exterior)) return;
    const started = performance.now();
    setRunning(true);
    setError(false);
    setProgress({ stage: 'layout', pct: 0 });
    try {
      const doc = await generateRandomMap(config, {
        themeId,
        labels: { ...messages.randomMap, props: messages.props },
        onProgress: (stage, pct) => setProgress({ stage, pct }),
      });
      const elapsed = performance.now() - started;
      if (elapsed < 900) await sleep(900 - elapsed);
      setProgress({ stage: 'finish', pct: 100 });
      await sleep(250);
      onGenerated(doc);
      setRunning(false);
      onClose();
    } catch {
      setRunning(false);
      setError(true);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={() => {
        if (!running) onClose();
      }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[#2D333D] bg-[#1C1F24] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#2D333D] px-4 py-3">
          <div className="flex items-center gap-2">
            <Dices className="h-4 w-4 text-indigo-400" />
            <h2 className="font-display text-sm font-semibold text-[#F1F3F5]">{t('randomModal.title')}</h2>
          </div>
          {!running && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('randomModal.close')}
              className="rounded p-1 text-[#9CA3AF] hover:bg-[#252A32] hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {running ? (
          <div className="flex flex-col gap-4 px-5 py-8">
            <div className="flex items-end justify-between gap-3">
              <p className="text-sm font-medium text-[#F1F3F5]">{t(`randomModal.stages.${progress.stage}`)}</p>
              <span className="font-mono-tech text-sm text-indigo-300">{Math.round(progress.pct)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#141619]">
              <div
                className="h-full rounded-full bg-indigo-500 transition-[width] duration-300"
                style={{ width: `${Math.max(0, Math.min(100, progress.pct))}%` }}
              />
            </div>
            <p className="text-xs text-[#9CA3AF]">{t('randomModal.generating')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 overflow-auto px-4 py-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <Toggle
                on={config.dungeon}
                label={t('randomModal.dungeon')}
                hint={t('randomModal.dungeonHint')}
                onChange={setDungeon}
              />
              <Toggle
                on={config.exterior}
                label={t('randomModal.exterior')}
                hint={t('randomModal.exteriorHint')}
                onChange={setExterior}
              />
            </div>

            <Field label={t('randomModal.dungeonLayers')} disabled={!config.dungeon}>
              <Segments
                value={config.maxDungeonLayers}
                max={4}
                disabled={!config.dungeon}
                onChange={(maxDungeonLayers) => setConfig((current) => ({ ...current, maxDungeonLayers }))}
              />
            </Field>
            <Field label={t('randomModal.exteriorLayers')} disabled={!config.exterior}>
              <Segments
                value={config.maxExteriorLayers}
                max={8}
                disabled={!config.exterior}
                onChange={(maxExteriorLayers) => setConfig((current) => ({ ...current, maxExteriorLayers }))}
              />
            </Field>

            <Toggle
              on={config.useTextures}
              label={t('randomModal.textures')}
              hint={config.useTextures ? t('randomModal.texturesOn') : t('randomModal.texturesOff')}
              onChange={(useTextures) => setConfig((current) => ({ ...current, useTextures }))}
            />

            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">{t('randomModal.size')}</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {SIZES.map((size) => {
                  const active = config.size === size;
                  return (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setConfig((current) => ({ ...current, size }))}
                      className={`rounded-lg border px-2 py-2 text-left transition-colors ${
                        active
                          ? 'border-indigo-500/70 bg-indigo-600/20'
                          : 'border-[#2D333D] bg-[#141619] hover:border-[#3D4654]'
                      }`}
                    >
                      <div className={`text-xs font-semibold ${active ? 'text-indigo-200' : 'text-[#F1F3F5]'}`}>
                        {t(`randomModal.sizes.${size}.name`)}
                      </div>
                      <div className="font-mono-tech text-[10px] text-[#9CA3AF]">{t(`randomModal.sizes.${size}.hint`)}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {error && <p className="text-xs text-amber-300">{t('randomModal.error')}</p>}

            <div className="flex items-center justify-end gap-2 border-t border-[#2D333D] pt-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-[#252A32] px-3 py-1.5 text-xs font-medium text-[#F1F3F5] hover:bg-[#313844]"
              >
                {t('randomModal.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void generate()}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                {t('randomModal.generate')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

function Toggle({
  on,
  label,
  hint,
  onChange,
}: {
  on: boolean;
  label: string;
  hint: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-[#2D333D] bg-[#141619] px-3 py-2.5 text-left hover:border-indigo-500/40"
    >
      <span>
        <span className="block text-xs font-medium text-[#F1F3F5]">{label}</span>
        <span className="block text-[11px] text-[#9CA3AF]">{hint}</span>
      </span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-indigo-600' : 'bg-[#2D333D]'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </span>
    </button>
  );
}

function Field({ label, disabled, children }: { label: string; disabled: boolean; children: React.ReactNode }) {
  return (
    <div className={disabled ? 'opacity-40' : undefined}>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">{label}</div>
      {children}
    </div>
  );
}

function Segments({
  value,
  max,
  disabled,
  onChange,
}: {
  value: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex rounded-md border border-[#2D333D] bg-[#141619] p-0.5">
      {Array.from({ length: max }, (_, index) => index + 1).map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onChange(n)}
          className={`flex-1 rounded px-1 py-1 text-[11px] font-semibold ${
            value === n ? 'bg-indigo-600 text-white' : 'text-[#D1D5DB] hover:bg-[#252A32] disabled:hover:bg-transparent'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
