import fontManifest from './fontManifest.json';

export interface FontFaceFile {
  family: string;
  weight: number;
  style: string;
  file: string;
  unicodeRange: string;
  /** Inlined into exported SVG and PNG so labels match the on-screen faces. */
  embed?: boolean;
}

export const FONT_MANIFEST = fontManifest as FontFaceFile[];

export function fontPublicUrl(file: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}fonts/${file}`;
}

/** Installs the faces shipped in public/fonts. Safe to call once at startup. */
export function installLocalFonts(): void {
  if (typeof document === 'undefined' || document.querySelector('style[data-jinkline-fonts]')) return;
  const css = FONT_MANIFEST.map(
    (face) =>
      `@font-face{font-family:'${face.family}';font-style:${face.style};font-weight:${face.weight};font-display:swap;src:url(${fontPublicUrl(face.file)}) format('woff2');unicode-range:${face.unicodeRange};}`
  ).join('\n');
  const style = document.createElement('style');
  style.dataset.jinklineFonts = 'true';
  style.textContent = css;
  document.head.appendChild(style);
}
