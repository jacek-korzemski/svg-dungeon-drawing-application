import React, { useEffect, useState } from 'react';
import { Check, Code2, Copy, Download, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { DungeonDocument } from '../types/dungeon';
import { buildCleanExportSvg } from '../utils/exportDungeon';

interface SvgInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  doc: DungeonDocument;
  viewportEl: SVGGElement | null;
  onDownloadSvg: () => void;
}

export const SvgInspectorModal: React.FC<SvgInspectorModalProps> = ({
  isOpen,
  onClose,
  doc,
  viewportEl,
  onDownloadSvg,
}) => {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [svgCode, setSvgCode] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    buildCleanExportSvg(doc, viewportEl).then((code) => {
      if (!cancelled) setSvgCode(code);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, doc, viewportEl]);

  if (!isOpen) return null;

  const svgPropsCount = doc.props.filter((p) => p.kind === 'svg').length;
  const pngPropsCount = doc.props.filter((p) => p.kind === 'png').length;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(svgCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl rounded-xl bg-[#1C1F24] border border-[#2D333D] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#2D333D] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-emerald-400" />
            <h2 className="font-display font-semibold text-sm text-[#F1F3F5]">
              {t('svgModal.title')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[#252A32] text-[#9CA3AF] hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modular Architecture Summary Badges */}
        <div className="px-4 py-2.5 bg-[#141619] border-b border-[#2D333D] flex flex-wrap items-center gap-2 text-[11px]">
          <span className="px-2 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-mono-tech">
            {t('svgModal.layers', { count: doc.layers.length })}
          </span>
          <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono-tech">
            {t('svgModal.architecture', { count: doc.doors.length + doc.stairs.length })}
          </span>
          <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono-tech">
            {t('svgModal.svgProps', { count: svgPropsCount })}
          </span>
          <span className="px-2 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-sky-300 font-mono-tech">
            {t('svgModal.pngProps', { count: pngPropsCount })}
          </span>
        </div>

        {/* Code Preview */}
        <div className="p-4 flex-1 overflow-auto bg-[#0F1114]">
          <pre className="font-mono-tech text-[11px] leading-relaxed text-[#D1D5DB] whitespace-pre-wrap break-all select-text">
            {svgCode.slice(0, 18000)}
            {svgCode.length > 18000
              ? t('svgModal.truncated', { size: Math.round(svgCode.length / 1024) })
              : ''}
          </pre>
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-3 border-t border-[#2D333D] flex items-center justify-between bg-[#1C1F24]">
          <span className="text-xs text-[#9CA3AF]">
            {t('svgModal.size')} <strong className="text-[#F1F3F5]">{Math.max(1, Math.round(svgCode.length / 1024))} KB</strong>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#252A32] hover:bg-[#313844] text-xs font-medium text-[#F1F3F5] transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? t('svgModal.copied') : t('svgModal.copy')}</span>
            </button>
            <button
              onClick={onDownloadSvg}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t('svgModal.download')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
