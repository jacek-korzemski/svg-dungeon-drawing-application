/** Dimetric 2:1 projection shared by the isometric sheet and the 3D preview. */

export const ISO_K = Math.SQRT1_2;

export type IsoQuarter = 0 | 1 | 2 | 3;

/** `iso` shears the flat map. `3d` extrudes the same projection into walls. */
export type IsoViewMode = 'flat' | 'iso' | '3d';

export function viewUsesProjection(mode: IsoViewMode): boolean {
  return mode === 'iso' || mode === '3d';
}

export interface CameraFrame {
  mode: IsoViewMode;
  quarter: IsoQuarter;
}

export interface AxisBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Quarter-turn around the world origin. Y grows downward, matching SVG. */
export function rotateQuarter(x: number, y: number, quarter: IsoQuarter): [number, number] {
  switch (quarter) {
    case 1:
      return [-y, x];
    case 2:
      return [-x, -y];
    case 3:
      return [y, -x];
    default:
      return [x, y];
  }
}

export function unrotateQuarter(u: number, v: number, quarter: IsoQuarter): [number, number] {
  switch (quarter) {
    case 1:
      return [v, -u];
    case 2:
      return [-u, -v];
    case 3:
      return [-v, u];
    default:
      return [u, v];
  }
}

/**
 * sx = k (u - v)
 * sy = (k / 2) (u + v) - z
 * k = 1/sqrt(2) keeps a grid diagonal the same length as a flat cell rotated 45°.
 */
export function projectIso(x: number, y: number, z: number, quarter: IsoQuarter): [number, number] {
  const [u, v] = rotateQuarter(x, y, quarter);
  return [ISO_K * (u - v), 0.5 * ISO_K * (u + v) - z];
}

function isoBasis(quarter: IsoQuarter) {
  const [a, b] = projectIso(1, 0, 0, quarter);
  const [c, d] = projectIso(0, 1, 0, quarter);
  return { a, b, c, d };
}

function formatMatrix(a: number, b: number, c: number, d: number, e: number, f: number): string {
  const n = (value: number) => Number(value.toFixed(6));
  return `matrix(${n(a)} ${n(b)} ${n(c)} ${n(d)} ${n(e)} ${n(f)})`;
}

/** SVG matrix that maps world (x, y) onto the horizontal plane z = z0. */
export function isoPlaneMatrix(quarter: IsoQuarter, z0: number): string {
  const { a, b, c, d } = isoBasis(quarter);
  return formatMatrix(a, b, c, d, 0, -z0);
}

function roundedIsoInverse(quarter: IsoQuarter) {
  const { a, b, c, d } = isoBasis(quarter);
  const n = (value: number) => Number(value.toFixed(6));
  const ra = n(a);
  const rb = n(b);
  const rc = n(c);
  const rd = n(d);
  const det = ra * rd - rc * rb || 1;
  return { a: rd / det, b: -rb / det, c: -rc / det, d: ra / det };
}

/** Inverse of isoPlaneMatrix on z = 0. Cancels the floor shear around a local origin. */
export function isoPlaneInverseMatrix(quarter: IsoQuarter): string {
  const { a, b, c, d } = roundedIsoInverse(quarter);
  return formatMatrix(a, b, c, d, 0, 0);
}

function applyIsoInverse(x: number, y: number, quarter: IsoQuarter): [number, number] {
  const { a, b, c, d } = roundedIsoInverse(quarter);
  return [a * x + c * y, b * x + d * y];
}

export type PropArtworkFrame = 'plane' | 'upright';

/** Rotate and flip, then pre-shear upright art so the iso view shows it straight. */
export function propArtworkTransform(
  artwork: PropArtworkFrame | undefined,
  quarter: IsoQuarter | undefined,
  rotation: number,
  flipX?: boolean
): string {
  const spin = `rotate(${rotation}) scale(${flipX ? -1 : 1}, 1)`;
  if (artwork !== 'upright') return spin;
  return `${isoPlaneInverseMatrix(quarter ?? 0)} ${spin}`;
}

/** Map-space corners of a graphic after its own rotation and, for upright art, the inverse shear. */
export function propVisualCorners(prop: {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  widthPx: number;
  heightPx: number;
  flipX?: boolean;
  artwork?: PropArtworkFrame;
  artworkQuarter?: IsoQuarter;
}): Array<[number, number]> {
  const halfW = (prop.widthPx * prop.scale) / 2;
  const halfH = (prop.heightPx * prop.scale) / 2;
  const flip = prop.flipX ? -1 : 1;
  const theta = (prop.rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const locals: Array<[number, number]> = [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
  ];
  return locals.map(([lx, ly]) => {
    const sx = lx * flip;
    const rx = sx * cos - ly * sin;
    const ry = sx * sin + ly * cos;
    const [mx, my] =
      prop.artwork === 'upright' ? applyIsoInverse(rx, ry, prop.artworkQuarter ?? 0) : [rx, ry];
    return [prop.x + mx, prop.y + my];
  });
}

/** Inverse of projectIso on the ground plane. sx/sy are coordinates inside the camera group. */
export function unprojectIsoGround(sx: number, sy: number, quarter: IsoQuarter): [number, number] {
  const u = sx / (2 * ISO_K) + sy / ISO_K;
  const v = -sx / (2 * ISO_K) + sy / ISO_K;
  return unrotateQuarter(u, v, quarter);
}

export function adjustColor(hex: string, amount: number): string {
  const body = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(body)) return hex;
  const packed = Number.parseInt(body, 16);
  const channels = [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255];
  const next = channels.map((channel) => {
    const value = amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(value)));
  });
  return `#${next.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/** Bright top, unchanged lit face, and two darker faces. Amounts are luminance, not ink color. */
export function shadeByFacing(base: string, facing: number, role: 'side' | 'top'): string {
  if (role === 'top') return adjustColor(base, 0.16);
  if (facing > 0.2) return base;
  if (facing > -0.2) return adjustColor(base, -0.22);
  return adjustColor(base, -0.34);
}

export function facingOfNormal(nx: number, ny: number, quarter: IsoQuarter): number {
  const [nu, nv] = rotateQuarter(nx, ny, quarter);
  return nu + nv;
}

export function worldAtCanvasCenter(
  pan: { x: number; y: number },
  zoom: number,
  canvas: { width: number; height: number },
  frame: CameraFrame
): [number, number] {
  const sx = (canvas.width / 2 - pan.x) / zoom;
  const sy = (canvas.height / 2 - pan.y) / zoom;
  if (viewUsesProjection(frame.mode)) return unprojectIsoGround(sx, sy, frame.quarter);
  return [sx, sy];
}

export function panForWorldPoint(
  world: [number, number],
  zoom: number,
  canvas: { width: number; height: number },
  frame: CameraFrame
): { x: number; y: number } {
  const [sx, sy] = viewUsesProjection(frame.mode) ? projectIso(world[0], world[1], 0, frame.quarter) : world;
  return {
    x: canvas.width / 2 - sx * zoom,
    y: canvas.height / 2 - sy * zoom,
  };
}

/**
 * Project an axis-aligned world box. Roof ridges reach about 1.6× wall height and
 * towers about 1.5×, so callers should pass a zTop that covers both.
 */
export function projectBounds(
  bounds: AxisBounds,
  quarter: IsoQuarter,
  zTop: number,
  pad: number
): AxisBounds {
  const corners: Array<[number, number]> = [
    [bounds.x, bounds.y],
    [bounds.x + bounds.width, bounds.y],
    [bounds.x, bounds.y + bounds.height],
    [bounds.x + bounds.width, bounds.y + bounds.height],
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    for (const z of [0, zTop]) {
      const [sx, sy] = projectIso(x, y, z, quarter);
      if (sx < minX) minX = sx;
      if (sy < minY) minY = sy;
      if (sx > maxX) maxX = sx;
      if (sy > maxY) maxY = sy;
    }
  }
  if (!Number.isFinite(minX)) {
    return { x: -pad, y: -pad, width: pad * 2, height: pad * 2 };
  }
  return {
    x: minX - pad,
    y: minY - pad,
    width: Math.max(pad, maxX - minX + pad * 2),
    height: Math.max(pad, maxY - minY + pad * 2),
  };
}
