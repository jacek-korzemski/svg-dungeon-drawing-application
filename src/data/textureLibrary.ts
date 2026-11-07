import { useSyncExternalStore } from 'react';

export interface FloorTexture {
  /** File name, e.g. "trawa.png". */
  path: string;
  label: string;
  url: string;
}

const rawUrls = import.meta.glob('../assets-textures/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function fileName(globKey: string): string | null {
  const normalized = globKey.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  const name = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  if (!name || name.includes('/')) return null;
  return name;
}

function fileLabel(name: string): string {
  return name.replace(/\.png$/i, '').replace(/-/g, ' ');
}

export const FLOOR_TEXTURES: FloorTexture[] = Object.entries(rawUrls)
  .flatMap(([key, url]) => {
    const path = fileName(key);
    if (!path) return [];
    return [{ path, label: fileLabel(path), url }];
  })
  .sort((a, b) => a.label.localeCompare(b.label, 'pl'));

const byPath = new Map(FLOOR_TEXTURES.map((texture) => [texture.path, texture]));

export function floorTextureByPath(path: string): FloorTexture | undefined {
  return byPath.get(path);
}

export function defaultFloorTexturePath(): string {
  return byPath.has('trawa.png') ? 'trawa.png' : (FLOOR_TEXTURES[0]?.path ?? 'trawa.png');
}

export function texturePatternId(path: string): string {
  return `tex-pat-${encodeURIComponent(path).replace(/%/g, '_')}`;
}

const sizes = new Map<string, { width: number; height: number }>();
const listeners = new Set<() => void>();
let version = 0;
let started = false;

function ensureTextureSizes(): void {
  if (started || typeof Image === 'undefined') return;
  started = true;
  for (const texture of FLOOR_TEXTURES) {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || 192;
      const height = img.naturalHeight || 192;
      const prev = sizes.get(texture.path);
      if (prev && prev.width === width && prev.height === height) return;
      sizes.set(texture.path, { width, height });
      version += 1;
      listeners.forEach((listener) => listener());
    };
    img.src = texture.url;
  }
}

export function texturePixelSize(path: string): { width: number; height: number } {
  return sizes.get(path) ?? { width: 192, height: 192 };
}

/** Bumps when native texture sizes finish loading, so patterns can retile. */
export function useFloorTextureVersion(): number {
  return useSyncExternalStore(
    (callback) => {
      ensureTextureSizes();
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => version,
    () => 0
  );
}
