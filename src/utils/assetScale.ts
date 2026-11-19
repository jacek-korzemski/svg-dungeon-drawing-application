export const MIN_PROP_SCALE = 0.1;
export const MAX_PROP_SCALE = 4;

export interface AssetScaleIdentity {
  kind: 'svg' | 'png';
  svgPropId?: string;
  assetPath?: string;
  label: string;
  widthPx: number;
  heightPx: number;
}

/** Library art, vector props, and uploads each remember a scale under their own key. */
export function assetScaleKey(item: AssetScaleIdentity): string {
  if (item.kind === 'svg' && item.svgPropId) return `svg:${item.svgPropId}`;
  if (item.assetPath) return `asset:${item.assetPath}`;
  return `upload:${item.label}:${item.widthPx}x${item.heightPx}`;
}

/** `ceiling` lets a grid rescale keep a scale that is already above the slider's usual max. */
export function clampPropScale(scale: number, ceiling = MAX_PROP_SCALE): number {
  if (!Number.isFinite(scale)) return 1;
  const max = Math.max(MAX_PROP_SCALE, ceiling);
  return Math.min(max, Math.max(MIN_PROP_SCALE, Math.round(scale * 100) / 100));
}
