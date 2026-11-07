import { MAP_THEMES } from '../data/presets';
import { DungeonDocument } from '../types/dungeon';
import {
  buildStylizedWallData,
  GRID_SIZE,
  inkScale,
  multiPolygonToSvgPath,
} from './geometry';

export function computeDocumentBounds(doc: DungeonDocument) {
  const G = doc.gridSize || GRID_SIZE;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const expand = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    for (const poly of layer.geometry) {
      for (const ring of poly) {
        for (const pt of ring) expand(pt[0], pt[1]);
      }
    }
    for (const sw of layer.standaloneWalls) {
      for (const pt of sw.points) expand(pt[0], pt[1]);
    }
    for (const road of layer.roads ?? []) {
      for (const pt of road.points) expand(pt[0], pt[1]);
      for (const poly of road.polygon ?? []) {
        for (const ring of poly) {
          for (const pt of ring) expand(pt[0], pt[1]);
        }
      }
    }
    for (const paint of layer.texturePaints ?? []) {
      for (const dab of paint.dabs) {
        expand(dab.x - dab.r, dab.y - dab.r);
        expand(dab.x + dab.r, dab.y + dab.r);
      }
      for (const poly of paint.region) {
        for (const ring of poly) {
          for (const pt of ring) expand(pt[0], pt[1]);
        }
      }
    }
  }

  for (const d of doc.doors) {
    const half = (d.widthCells * G) / 2;
    expand(d.x - half, d.y - half);
    expand(d.x + half, d.y + half);
  }
  for (const s of doc.stairs) {
    const halfW = (s.widthCells * G) / 2;
    const halfL = (s.lengthCells * G) / 2;
    expand(s.x - halfW, s.y - halfL);
    expand(s.x + halfW, s.y + halfL);
  }
  for (const p of doc.props) {
    const w = (p.widthPx * p.scale) / 2;
    const h = (p.heightPx * p.scale) / 2;
    expand(p.x - w, p.y - h);
    expand(p.x + w, p.y + h);
  }
  for (const l of doc.labels) {
    expand(l.x - G, l.y - G);
    expand(l.x + G, l.y + G);
  }

  if (!isFinite(minX)) {
    return { x: 0, y: 0, width: 32 * G, height: 24 * G };
  }

  const margin = G;
  const x = Math.floor((minX - margin) / G) * G;
  const y = Math.floor((minY - margin) / G) * G;
  const width = Math.max(G, Math.ceil((maxX + margin - x) / G) * G);
  const height = Math.max(G, Math.ceil((maxY + margin - y) / G) * G);

  return { x, y, width, height };
}

/**
 * Generates clean, human-readable, modular Multi-SVG markup from the live DOM container
 * (or constructs a standalone SVG wrapper combining all rendered SVG layers + PNG images).
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Nie udało się osadzić grafiki'));
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Nie udało się osadzić grafiki'));
    };
    reader.readAsDataURL(blob);
  });
}

async function inlineExternalImages(root: SVGGElement) {
  const images = [...root.querySelectorAll('image')];
  await Promise.all(
    images.map(async (img) => {
      const href = img.getAttribute('href') || img.getAttribute('xlink:href');
      if (!href || href.startsWith('data:')) return;
      try {
        const response = await fetch(href);
        if (!response.ok) return;
        const dataUrl = await blobToDataUrl(await response.blob());
        img.setAttribute('href', dataUrl);
        img.removeAttribute('xlink:href');
      } catch {
        // Leave the original href if the asset cannot be fetched.
      }
    })
  );
}

export async function buildCleanExportSvg(
  doc: DungeonDocument,
  viewportGroupEl: SVGGElement | null
): Promise<string> {
  const theme = MAP_THEMES[doc.themeId];
  const bounds = computeDocumentBounds(doc);
  const G = doc.gridSize || GRID_SIZE;
  const ink = inkScale(G);

  // Clone inner SVG content if available from live DOM so every single vector prop, door, stair & PNG is identical!
  let innerLayersMarkup = '';
  if (viewportGroupEl) {
    const clone = viewportGroupEl.cloneNode(true) as SVGGElement;
    // Strip interactive selection/drafting overlays before exporting
    clone
      .querySelectorAll('[data-export-ignore="true"]')
      .forEach((node) => node.remove());
    await inlineExternalImages(clone);
    innerLayersMarkup = clone.innerHTML;
  } else {
    // Fallback programmatic generation
    innerLayersMarkup = doc.layers
      .filter((l) => l.visible)
      .map((layer) => {
        const floorPath = multiPolygonToSvgPath(layer.geometry);
        const wallData = buildStylizedWallData(layer.geometry, layer.wallStyle);
        return `
  <svg id="layer-${layer.id}" overflow="visible">
    <path d="${floorPath}" fill="${theme.floorFill}" />
    <path d="${wallData.mainWallPath}" fill="none" stroke="${theme.inkStroke}" stroke-width="3" />
  </svg>`;
      })
      .join('\n');
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}"
     width="${bounds.width}"
     height="${bounds.height}">
  <title>${escapeXml(doc.title)}</title>
  <defs>
    <!-- Jinkline Diagonal Crosshatch Pattern -->
    <pattern id="export-hatch-pattern" width="${10 * ink}" height="${10 * ink}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="${10 * ink}" stroke="${theme.hatchStroke}" stroke-width="${1.4 * ink}" stroke-opacity="0.42" />
      <line x1="${5 * ink}" y1="0" x2="${5 * ink}" y2="${10 * ink}" stroke="${theme.hatchStroke}" stroke-width="${0.9 * ink}" stroke-opacity="0.25" />
    </pattern>
    <!-- Interior Floor Grid Pattern -->
    <pattern id="export-floor-grid" width="${G}" height="${G}" patternUnits="userSpaceOnUse">
      <path d="M ${G} 0 L 0 0 0 ${G}" fill="none" stroke="${theme.floorGrid}" stroke-width="1" />
    </pattern>
    <!-- Exterior Void Grid Pattern -->
    <pattern id="export-void-grid" width="${G}" height="${G}" patternUnits="userSpaceOnUse">
      <path d="M ${G} 0 L 0 0 0 ${G}" fill="none" stroke="${theme.gridMajor}" stroke-width="1" />
    </pattern>
  </defs>

  <!-- Layer 0: Parchment / Blueprint Backdrop & Grid -->
  <svg id="layer-backdrop" x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}">
    <rect width="100%" height="100%" fill="${theme.bgVoid}" />
    ${doc.showGrid ? `<rect width="100%" height="100%" fill="url(#export-void-grid)" />` : ''}
  </svg>

  <!-- Modular Dungeon Layers (Floors, Crosshatch, Stylized Walls, Doors, Stairs, SVG & PNG Props, Labels) -->
  ${innerLayersMarkup}
</svg>`;
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return c;
    }
  });
}

export function triggerFileDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadSvgFile(
  doc: DungeonDocument,
  viewportGroupEl: SVGGElement | null
) {
  const svgStr = await buildCleanExportSvg(doc, viewportGroupEl);
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const slug = doc.title.toLowerCase().replace(/[^a-z0-9ąęćłńóśźż]+/gi, '-') || 'dungeon';
  triggerFileDownload(blob, `${slug}.svg`);
}

export async function downloadPngFile(
  doc: DungeonDocument,
  viewportGroupEl: SVGGElement | null
): Promise<void> {
  const svgStr = await buildCleanExportSvg(doc, viewportGroupEl);
  const bounds = computeDocumentBounds(doc);
  const scale = 1; // 1 world px = 1 PNG px, so one cell is 64 px

  return new Promise((resolve, reject) => {
    const img = new Image();
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = bounds.width * scale;
      canvas.height = bounds.height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Canvas context unavailable'));
        return;
      }
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, bounds.width, bounds.height);
      URL.revokeObjectURL(url);

      canvas.toBlob((pngBlob) => {
        if (pngBlob) {
          const slug = doc.title.toLowerCase().replace(/[^a-z0-9ąęćłńóśźż]+/gi, '-') || 'dungeon';
          triggerFileDownload(pngBlob, `${slug}.png`);
          resolve();
        } else {
          reject(new Error('Failed to create PNG blob'));
        }
      }, 'image/png');
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };

    img.src = url;
  });
}

export function downloadJsonProject(doc: DungeonDocument) {
  const json = JSON.stringify(doc, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const slug = doc.title.toLowerCase().replace(/[^a-z0-9ąęćłńóśźż]+/gi, '-') || 'dungeon';
  triggerFileDownload(blob, `${slug}.dungeon.json`);
}
