export type SamplePngId = 'png-barrel' | 'png-chest' | 'png-brazier' | 'png-rune';

export interface BuiltinPngAsset {
  id: string;
  /** Set for files the user uploaded. Built-in examples are named from the locale. */
  label?: string;
  widthPx: number;
  heightPx: number;
  dataUrl: string;
}

let cachedAssets: BuiltinPngAsset[] | null = null;

function renderCanvasToPng(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  draw(ctx, width, height);
  return canvas.toDataURL('image/png');
}

export function getBuiltinPngAssets(): BuiltinPngAsset[] {
  if (cachedAssets) return cachedAssets;

  // 1. Shaded Oak Barrel PNG
  const barrelPng = renderCanvasToPng(96, 96, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const r = 34;

    // Drop shadow
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx + 4, cy + 5, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.fill();
    ctx.restore();

    // Radial wood shading
    const grad = ctx.createRadialGradient(cx - 10, cy - 10, 4, cx, cy, r);
    grad.addColorStop(0, '#C68B59');
    grad.addColorStop(0.65, '#8C582B');
    grad.addColorStop(1, '#4E2D12');

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#1C140D';
    ctx.stroke();

    // Wood plank lines
    ctx.strokeStyle = 'rgba(30, 18, 8, 0.55)';
    ctx.lineWidth = 2;
    for (const offset of [-18, -6, 6, 18]) {
      const chordHalf = Math.sqrt(Math.max(0, r * r - offset * offset));
      ctx.beginPath();
      ctx.moveTo(cx + offset, cy - chordHalf + 2);
      ctx.lineTo(cx + offset, cy + chordHalf - 2);
      ctx.stroke();
    }

    // Iron hoop ring
    ctx.beginPath();
    ctx.arc(cx, cy, r - 6, 0, Math.PI * 2);
    ctx.strokeStyle = '#333840';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Bung plug highlight
    ctx.beginPath();
    ctx.arc(cx + 10, cy - 8, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#2B190B';
    ctx.fill();
  });

  // 2. Treasure Chest PNG
  const chestPng = renderCanvasToPng(112, 84, (ctx, w, h) => {
    const padX = 14;
    const padY = 16;
    const bw = w - padX * 2;
    const bh = h - padY * 2;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(padX + 4, padY + 5, bw, bh);

    // Rich mahogany gradient
    const grad = ctx.createLinearGradient(padX, padY, padX, padY + bh);
    grad.addColorStop(0, '#A65E2E');
    grad.addColorStop(0.5, '#7A3E18');
    grad.addColorStop(1, '#4D230B');

    ctx.fillStyle = grad;
    ctx.fillRect(padX, padY, bw, bh);

    // Plank ridges
    ctx.strokeStyle = 'rgba(25, 10, 2, 0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padX, padY + bh * 0.35);
    ctx.lineTo(padX + bw, padY + bh * 0.35);
    ctx.moveTo(padX, padY + bh * 0.68);
    ctx.lineTo(padX + bw, padY + bh * 0.68);
    ctx.stroke();

    // Iron straps
    ctx.fillStyle = '#3E444D';
    ctx.fillRect(padX + 10, padY, 8, bh);
    ctx.fillRect(padX + bw - 18, padY, 8, bh);

    // Gold lockplate
    ctx.fillStyle = '#F59E0B';
    ctx.fillRect(w / 2 - 7, padY + bh * 0.42, 14, 14);
    ctx.strokeStyle = '#18181B';
    ctx.lineWidth = 2;
    ctx.strokeRect(w / 2 - 7, padY + bh * 0.42, 14, 14);

    // Outer ink border
    ctx.strokeStyle = '#18130E';
    ctx.lineWidth = 3.5;
    ctx.strokeRect(padX, padY, bw, bh);
  });

  // 3. Glowing Brazier / Fire Pit PNG
  const brazierPng = renderCanvasToPng(96, 96, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;

    // Warm fire glow aura
    const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, 44);
    glow.addColorStop(0, 'rgba(251, 146, 60, 0.85)');
    glow.addColorStop(0.55, 'rgba(234, 88, 12, 0.35)');
    glow.addColorStop(1, 'rgba(234, 88, 12, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, 44, 0, Math.PI * 2);
    ctx.fill();

    // Stone iron bowl
    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, Math.PI * 2);
    ctx.fillStyle = '#374151';
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#111827';
    ctx.stroke();

    // Glowing coals & flames
    const coalGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, 19);
    coalGrad.addColorStop(0, '#FEF08A');
    coalGrad.addColorStop(0.45, '#F97316');
    coalGrad.addColorStop(1, '#991B1B');
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.fillStyle = coalGrad;
    ctx.fill();
  });

  // 4. Arcane Ritual Circle PNG
  const runePng = renderCanvasToPng(128, 128, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;

    const glow = ctx.createRadialGradient(cx, cy, 8, cx, cy, 58);
    glow.addColorStop(0, 'rgba(99, 102, 241, 0.35)');
    glow.addColorStop(0.75, 'rgba(79, 70, 229, 0.14)');
    glow.addColorStop(1, 'rgba(79, 70, 229, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, 58, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#4338CA';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 48, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(cx, cy, 38, 0, Math.PI * 2);
    ctx.stroke();

    // Hexagram / star geometry
    ctx.strokeStyle = '#4F46E5';
    ctx.lineWidth = 2;
    for (let rot = 0; rot < 2; rot++) {
      ctx.beginPath();
      for (let i = 0; i <= 3; i++) {
        const ang = (i * (Math.PI * 2)) / 3 + (rot * Math.PI) / 3;
        const px = cx + Math.cos(ang) * 38;
        const py = cy + Math.sin(ang) * 38;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  });

  cachedAssets = [
    { id: 'png-barrel', widthPx: 60, heightPx: 60, dataUrl: barrelPng },
    { id: 'png-chest', widthPx: 76, heightPx: 56, dataUrl: chestPng },
    { id: 'png-brazier', widthPx: 64, heightPx: 64, dataUrl: brazierPng },
    { id: 'png-rune', widthPx: 128, heightPx: 128, dataUrl: runePng },
  ];

  return cachedAssets;
}
