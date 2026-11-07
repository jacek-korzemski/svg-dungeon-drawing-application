import React, { useMemo, useRef, useState } from 'react';
import { ChevronLeft, Folder, Search, Upload } from 'lucide-react';
import {
  foldSearch,
  LIBRARY_ASSETS,
  libraryFolders,
  measureImageCached,
} from '../data/assetLibrary';
import { useI18n, type Messages } from '../i18n';
import { PropBrush } from '../types/dungeon';
import { BuiltinPngAsset, getBuiltinPngAssets, type SamplePngId } from '../utils/samplePngAssets';

const EXAMPLES_FOLDER = 'examples';
const UPLOADS_FOLDER = 'uploads';

function sampleLabel(messages: Messages, id: string): string | undefined {
  if (id in messages.samplePng) return messages.samplePng[id as SamplePngId];
  return undefined;
}

interface AssetBrowserProps {
  selected: PropBrush;
  customAssets: BuiltinPngAsset[];
  onUpload: (file: File) => void;
  onSelect: (brush: PropBrush) => void;
}

export const AssetBrowser: React.FC<AssetBrowserProps> = ({
  selected,
  customAssets,
  onUpload,
  onSelect,
}) => {
  const { messages, t } = useI18n();
  const [folder, setFolder] = useState<string | null>(null);
  const folderName = (id: string) =>
    id === UPLOADS_FOLDER
      ? t('assetBrowser.uploads')
      : id === EXAMPLES_FOLDER
        ? t('assetBrowser.examples')
        : id;
  const [query, setQuery] = useState('');
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const examples = getBuiltinPngAssets();
  const folders = libraryFolders();
  const foldedQuery = foldSearch(query.trim());

  const libraryInFolder = useMemo(
    () => LIBRARY_ASSETS.filter((asset) => asset.folder === folder),
    [folder]
  );

  const searchHits = useMemo(() => {
    if (!foldedQuery) return [];
    const libraryHits = LIBRARY_ASSETS.filter((asset) =>
      foldSearch(`${asset.folder} ${asset.label}`).includes(foldedQuery)
    ).map((asset) => ({
      key: asset.path,
      folder: asset.folder,
      label: asset.label,
      thumb: asset.url,
      select: async () => {
        const size = await measureImageCached(asset.url);
        onSelect({
          kind: 'png',
          assetPath: asset.path,
          label: asset.label,
          widthPx: size.width,
          heightPx: size.height,
        });
      },
      active: selected.kind === 'png' && selected.assetPath === asset.path,
    }));

    const exampleHits = examples
      .filter((asset) =>
        foldSearch(`${t('assetBrowser.examples')} ${sampleLabel(messages, asset.id) ?? ''}`).includes(foldedQuery)
      )
      .map((asset) => {
        const label = sampleLabel(messages, asset.id) ?? asset.id;
        return {
        key: asset.id,
        folder: t('assetBrowser.examples'),
        label,
        thumb: asset.dataUrl,
        select: () =>
          onSelect({
            kind: 'png',
            pngDataUrl: asset.dataUrl,
            label,
            widthPx: asset.widthPx,
            heightPx: asset.heightPx,
          }),
        active: selected.kind === 'png' && selected.pngDataUrl === asset.dataUrl,
      };
      });

    const uploadHits = customAssets
      .filter((asset) => foldSearch(`${t('assetBrowser.uploads')} ${asset.label ?? ''}`).includes(foldedQuery))
      .map((asset) => ({
        key: asset.id,
        folder: t('assetBrowser.uploads'),
        label: asset.label ?? '',
        thumb: asset.dataUrl,
        select: () =>
          onSelect({
            kind: 'png',
            pngDataUrl: asset.dataUrl,
            label: asset.label ?? '',
            widthPx: asset.widthPx,
            heightPx: asset.heightPx,
          }),
        active: selected.kind === 'png' && selected.pngDataUrl === asset.dataUrl,
      }));

    return [...uploadHits, ...exampleHits, ...libraryHits];
  }, [customAssets, examples, foldedQuery, messages, onSelect, selected.assetPath, selected.kind, selected.pngDataUrl, t]);

  const tileClass = (active: boolean) =>
    `flex flex-col items-center p-2 rounded-lg border transition-colors ${
      active
        ? 'bg-indigo-600/20 border-indigo-500 text-white'
        : 'bg-[#1C1F24] border-[#2D333D] hover:border-[#3F4856] text-[#D1D5DB]'
    }`;

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[#6B7280]" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('assetBrowser.search')}
          className="w-full bg-[#1C1F24] border border-[#2D333D] rounded-lg pl-7 pr-2 py-1.5 text-xs text-[#F1F3F5] outline-none focus:border-indigo-500/60"
        />
      </div>

      <button
        onClick={() => uploadRef.current?.click()}
        className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border border-dashed border-indigo-500/60 bg-indigo-950/20 hover:bg-indigo-950/40 text-xs font-medium text-indigo-300 transition-colors"
      >
        <Upload className="w-3.5 h-3.5" />
        <span>{t('assetBrowser.upload')}</span>
      </button>
      <input
        ref={uploadRef}
        type="file"
        accept="image/png,image/webp,image/jpeg,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          e.target.value = '';
        }}
      />

      {foldedQuery ? (
        <div className="grid grid-cols-2 gap-1.5">
          {searchHits.length === 0 && (
            <p className="col-span-2 text-[11px] text-[#9CA3AF] px-1 py-2">{t('assetBrowser.empty')}</p>
          )}
          {searchHits.map((hit) => (
            <button key={hit.key} onClick={() => void hit.select()} className={tileClass(hit.active)}>
              <img src={hit.thumb} alt={hit.label} className="w-10 h-10 object-contain" />
              <span className="text-[10px] text-center leading-tight w-full mt-1 line-clamp-2">
                {hit.label}
              </span>
              <span className="text-[9px] text-[#9CA3AF] truncate w-full">{hit.folder}</span>
            </button>
          ))}
        </div>
      ) : folder === null ? (
        <div className="grid grid-cols-1 gap-1.5">
          {customAssets.length > 0 && (
            <FolderButton
              name={folderName(UPLOADS_FOLDER)}
              count={customAssets.length}
              onClick={() => setFolder(UPLOADS_FOLDER)}
            />
          )}
          <FolderButton
            name={folderName(EXAMPLES_FOLDER)}
            count={examples.length}
            onClick={() => setFolder(EXAMPLES_FOLDER)}
          />
          {folders.map((item) => (
            <FolderButton
              key={item.name}
              name={item.name}
              count={item.count}
              onClick={() => setFolder(item.name)}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          <button
            onClick={() => setFolder(null)}
            className="flex items-center gap-1 text-[11px] font-medium text-indigo-300 hover:text-indigo-200"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span className="truncate">{folderName(folder)}</span>
          </button>
          <div className="grid grid-cols-2 gap-1.5">
            {folder === UPLOADS_FOLDER &&
              customAssets.map((asset) => (
                <button
                  key={asset.id}
                  onClick={() =>
                    onSelect({
                      kind: 'png',
                      pngDataUrl: asset.dataUrl,
                      label: asset.label ?? '',
                      widthPx: asset.widthPx,
                      heightPx: asset.heightPx,
                    })
                  }
                  className={tileClass(selected.kind === 'png' && selected.pngDataUrl === asset.dataUrl)}
                >
                  <img src={asset.dataUrl} alt={asset.label ?? ''} className="w-10 h-10 object-contain" />
                  <span className="text-[10px] text-center leading-tight w-full mt-1 line-clamp-2">
                    {asset.label}
                  </span>
                </button>
              ))}
            {folder === EXAMPLES_FOLDER &&
              examples.map((asset) => {
                const label = sampleLabel(messages, asset.id) ?? asset.id;
                return (
                <button
                  key={asset.id}
                  onClick={() =>
                    onSelect({
                      kind: 'png',
                      pngDataUrl: asset.dataUrl,
                      label,
                      widthPx: asset.widthPx,
                      heightPx: asset.heightPx,
                    })
                  }
                  className={tileClass(selected.kind === 'png' && selected.pngDataUrl === asset.dataUrl)}
                >
                  <img src={asset.dataUrl} alt={label} className="w-10 h-10 object-contain" />
                  <span className="text-[10px] text-center leading-tight w-full mt-1 line-clamp-2">
                    {label}
                  </span>
                </button>
                );
              })}
            {folder !== UPLOADS_FOLDER &&
              folder !== EXAMPLES_FOLDER &&
              libraryInFolder.map((asset) => (
                <button
                  key={asset.path}
                  onClick={() =>
                    void measureImageCached(asset.url).then((size) =>
                      onSelect({
                        kind: 'png',
                        assetPath: asset.path,
                        label: asset.label,
                        widthPx: size.width,
                        heightPx: size.height,
                      })
                    )
                  }
                  className={tileClass(selected.kind === 'png' && selected.assetPath === asset.path)}
                >
                  <img src={asset.url} alt={asset.label} className="w-10 h-10 object-contain" />
                  <span className="text-[10px] text-center leading-tight w-full mt-1 line-clamp-2">
                    {asset.label}
                  </span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};

const FolderButton: React.FC<{ name: string; count: number; onClick: () => void }> = ({
  name,
  count,
  onClick,
}) => (
  <button
    onClick={onClick}
    className="flex items-center gap-2 px-2.5 py-2 rounded-lg border bg-[#1C1F24] border-[#2D333D] hover:border-[#3F4856] text-left"
  >
    <Folder className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
    <span className="text-xs font-medium text-[#F1F3F5] truncate flex-1">{name}</span>
    <span className="text-[10px] font-mono-tech text-[#9CA3AF]">{count}</span>
  </button>
);
