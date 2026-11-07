export interface LibraryAsset {
  /** Path relative to src/assets, e.g. "Domy/chata.png". */
  path: string;
  folder: string;
  label: string;
  url: string;
}

const rawUrls = import.meta.glob('../assets/**/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function toAssetPath(globKey: string): string | null {
  const normalized = globKey.replace(/\\/g, '/');
  const marker = '/assets/';
  const idx = normalized.lastIndexOf(marker);
  if (idx < 0) return null;
  return normalized.slice(idx + marker.length);
}

function fileLabel(fileName: string): string {
  return fileName.replace(/\.png$/i, '').replace(/-/g, ' ');
}

export const LIBRARY_ASSETS: LibraryAsset[] = Object.entries(rawUrls)
  .flatMap(([key, url]) => {
    const path = toAssetPath(key);
    if (!path || !path.includes('/')) return [];
    const slash = path.indexOf('/');
    const folder = path.slice(0, slash);
    const fileName = path.slice(slash + 1);
    if (!folder || !fileName) return [];
    return [{ path, folder, label: fileLabel(fileName), url }];
  })
  .sort((a, b) => a.label.localeCompare(b.label, 'pl'));

const byPath = new Map(LIBRARY_ASSETS.map((asset) => [asset.path, asset]));

export function resolveAssetUrl(assetPath?: string): string | undefined {
  if (!assetPath) return undefined;
  return byPath.get(assetPath)?.url;
}

export function libraryFolders(): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const asset of LIBRARY_ASSETS) {
    counts.set(asset.folder, (counts.get(asset.folder) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

export function foldSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

export function measureImage(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth || 64,
        height: img.naturalHeight || 64,
      });
    };
    img.onerror = () => reject(new Error('Nie udało się odczytać wymiarów grafiki'));
    img.src = src;
  });
}

const sizeCache = new Map<string, { width: number; height: number }>();

export async function measureImageCached(src: string): Promise<{ width: number; height: number }> {
  const cached = sizeCache.get(src);
  if (cached) return cached;
  const size = await measureImage(src);
  sizeCache.set(src, size);
  return size;
}

export function readImageFile(
  file: File
): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Nie udało się wczytać pliku'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Nie udało się wczytać pliku'));
        return;
      }
      const dataUrl = reader.result;
      const img = new Image();
      img.onload = () => {
        resolve({
          dataUrl,
          width: img.naturalWidth || 64,
          height: img.naturalHeight || 64,
        });
      };
      img.onerror = () => reject(new Error('Nie udało się odczytać wymiarów grafiki'));
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}
