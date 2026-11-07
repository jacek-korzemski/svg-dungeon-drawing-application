import {
  FLOOR_TEXTURES,
  floorTextureByPath,
  texturePatternId,
  texturePixelSize,
  useFloorTextureVersion,
} from '../data/textureLibrary';
import { TextureBrushShape, TextureDab, TexturePaint } from '../types/dungeon';
import { paintWorldRect, textureBlurPx } from '../utils/texturePaint';
import { multiPolygonToSvgPath } from '../utils/geometry';

export function FloorTextureResources({ blurPx }: { blurPx: number[] }) {
  const version = useFloorTextureVersion();
  return (
    <defs>
      {FLOOR_TEXTURES.map((texture) => {
        const size = texturePixelSize(texture.path);
        return (
          <pattern
            key={`${texture.path}-${version}`}
            id={texturePatternId(texture.path)}
            x={0}
            y={0}
            width={size.width}
            height={size.height}
            patternUnits="userSpaceOnUse"
          >
            <image
              href={texture.url}
              width={size.width}
              height={size.height}
              preserveAspectRatio="none"
            />
          </pattern>
        );
      })}
      {blurPx.map((px) => (
        <filter key={px} id={`tex-blur-${px}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={px} />
        </filter>
      ))}
    </defs>
  );
}

function PaintShapes({ paint }: { paint: Pick<TexturePaint, 'kind' | 'shape' | 'dabs' | 'region'> }) {
  if (paint.kind === 'fill') {
    const d = multiPolygonToSvgPath(paint.region);
    if (!d) return null;
    return <path d={d} fill="white" fillRule="evenodd" />;
  }
  if (paint.shape === 'square') {
    return (
      <>
        {paint.dabs.map((dab, index) => (
          <rect
            key={index}
            x={dab.x - dab.r}
            y={dab.y - dab.r}
            width={dab.r * 2}
            height={dab.r * 2}
            fill="white"
          />
        ))}
      </>
    );
  }
  return (
    <>
      {paint.dabs.map((dab, index) => (
        <circle key={index} cx={dab.x} cy={dab.y} r={dab.r} fill="white" />
      ))}
    </>
  );
}

function PaintMask({ paint, maskId }: { paint: TexturePaint; maskId: string }) {
  const blur = textureBlurPx(paint);
  const rect = paintWorldRect(paint, blur * 3 + 48) ?? {
    x: -20000,
    y: -20000,
    width: 40000,
    height: 40000,
  };
  return (
    <mask
      id={maskId}
      maskUnits="userSpaceOnUse"
      maskContentUnits="userSpaceOnUse"
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
    >
      <g filter={blur > 0 ? `url(#tex-blur-${blur})` : undefined}>
        <PaintShapes paint={paint} />
      </g>
    </mask>
  );
}

function PaintFill({ paint, maskId }: { paint: TexturePaint; maskId: string }) {
  if (!floorTextureByPath(paint.texturePath)) return null;
  const rect = paintWorldRect(paint, textureBlurPx(paint) + 8);
  if (!rect || rect.width < 1 || rect.height < 1) return null;
  return (
    <rect
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      fill={`url(#${texturePatternId(paint.texturePath)})`}
      mask={`url(#${maskId})`}
    />
  );
}

export function draftTexturePaint(
  dabs: TextureDab[],
  shape: TextureBrushShape,
  softness: number,
  texturePath: string
): TexturePaint {
  return {
    id: 'draft',
    texturePath,
    softness,
    kind: 'dabs',
    shape,
    dabs,
    region: [],
  };
}

export function FloorTextureStack({
  layerId,
  paints,
  clipId,
  draft,
}: {
  layerId: string;
  paints: TexturePaint[];
  clipId?: string;
  draft: TexturePaint | null;
}) {
  const visible = paints.filter(
    (paint) => (paint.kind === 'fill' ? paint.region.length > 0 : paint.dabs.length > 0)
  );
  if (!visible.length && !draft) return null;
  const draftId = `tex-mask-draft-${layerId}`;
  return (
    <g clipPath={clipId ? `url(#${clipId})` : undefined}>
      <defs>
        {visible.map((paint) => (
          <PaintMask key={paint.id} paint={paint} maskId={`tex-mask-${layerId}-${paint.id}`} />
        ))}
        {draft && (
          <g data-export-ignore="true">
            <PaintMask paint={draft} maskId={draftId} />
          </g>
        )}
      </defs>
      {visible.map((paint) => (
        <PaintFill key={paint.id} paint={paint} maskId={`tex-mask-${layerId}-${paint.id}`} />
      ))}
      {draft && (
        <g data-export-ignore="true">
          <PaintFill paint={draft} maskId={draftId} />
        </g>
      )}
    </g>
  );
}
