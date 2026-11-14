import { memo, useMemo } from 'react';
import { resolveAssetUrl } from '../data/assetLibrary';
import { buildingTexturePath, resolveTheme, roadTexturePath } from '../data/presets';
import { floorTextureByPath, texturePatternId } from '../data/textureLibrary';
import { BuildingStyle, DungeonDocument, layerEnvironment, MapTheme } from '../types/dungeon';
import { buildExteriorBuildingData, inkScale, multiPolygonToSvgPath } from '../utils/geometry';
import { buildIsoModel, IsoDrawable } from '../utils/isoGeometry';
import { IsoQuarter, isoPlaneMatrix, projectIso, propArtworkTransform } from '../utils/isoProjection';
import { BuildingShape } from './ExteriorArt';
import { FloorTextureStack } from './FloorTextureLayer';
import { SvgDoorArtwork, SvgPropArtwork, SvgStairArtwork } from './SvgPropArtwork';

interface IsoSceneProps {
  doc: DungeonDocument;
  quarter: IsoQuarter;
  wallHeightCells: number;
}

const ROOF_STYLES = new Set<BuildingStyle>(['roof_tile', 'roof_thatch', 'roof_slate']);

function patternFill(texturePath: string, fallback: string): string {
  return floorTextureByPath(texturePath) ? `url(#${texturePatternId(texturePath)})` : fallback;
}

function facePath(points: Array<[number, number, number]>, quarter: IsoQuarter, closed: boolean): string {
  let path = '';
  for (let index = 0; index < points.length; index++) {
    const [x, y] = projectIso(points[index][0], points[index][1], points[index][2], quarter);
    path += `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return closed ? `${path}Z` : path;
}

function FaceShape({ item, quarter }: { item: IsoDrawable; quarter: IsoQuarter }) {
  if (item.draw.kind !== 'face') return null;
  const face = item.draw;
  return (
    <path
      d={facePath(face.points, quarter, face.closed)}
      fill={face.fill}
      fillOpacity={face.fill === 'none' ? 0 : face.opacity}
      stroke={face.stroke}
      strokeWidth={face.strokeWidth}
      strokeOpacity={face.stroke === 'none' ? 0 : face.strokeOpacity * face.opacity}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  );
}

function IsoSceneView({ doc, quarter, wallHeightCells }: IsoSceneProps) {
  const theme = useMemo(() => resolveTheme(doc.themeId, doc.themeOverrides), [doc.themeId, doc.themeOverrides]);
  const grid = doc.gridSize || 64;
  const ink = inkScale(grid);
  const wallHeight = wallHeightCells * grid;
  const worldExtent = 400 * grid;
  const ground = isoPlaneMatrix(quarter, 0);

  const model = useMemo(
    () =>
      buildIsoModel(doc, quarter, wallHeight, {
        wallFill: theme.wallFill,
        floorFill: theme.floorFill,
        ink: theme.inkStroke,
      }),
    [doc, quarter, wallHeight, theme, grid]
  );

  return (
    <g pointerEvents="none">
      <defs>
        <pattern id="iso-hatch-pattern" width={10 * ink} height={10 * ink} patternUnits="userSpaceOnUse" patternTransform="rotate(18)">
          <line x1="0" y1="0" x2="0" y2={10 * ink} stroke={theme.hatchStroke} strokeWidth={1.4 * ink} strokeOpacity="0.45" />
          <line x1={5 * ink} y1="0" x2={5 * ink} y2={10 * ink} stroke={theme.hatchStroke} strokeWidth={0.9 * ink} strokeOpacity="0.24" />
        </pattern>
        <pattern id="iso-void-grid" width={grid} height={grid} patternUnits="userSpaceOnUse">
          <path d={`M ${grid} 0 L 0 0 0 ${grid}`} fill="none" stroke={theme.gridMajor} strokeWidth={ink} />
        </pattern>
        <pattern id="iso-floor-grid" width={grid} height={grid} patternUnits="userSpaceOnUse">
          <path d={`M ${grid} 0 L 0 0 0 ${grid}`} fill="none" stroke={theme.floorGrid} strokeWidth={ink} />
        </pattern>
      </defs>

      <g transform={ground}>
        <rect x={-worldExtent} y={-worldExtent} width={worldExtent * 2} height={worldExtent * 2} fill={theme.bgVoid} />
        {doc.showGrid && (
          <rect x={-worldExtent} y={-worldExtent} width={worldExtent * 2} height={worldExtent * 2} fill="url(#iso-void-grid)" />
        )}

        {doc.layers.map((layer) => {
          if (!layer.visible) return null;
          const exterior = layerEnvironment(layer) === 'exterior';
          const floorPath = multiPolygonToSvgPath(layer.geometry);
          if (!exterior) {
            const maskId = `iso-mask-outside-${layer.id}`;
            const clipId = `iso-clip-floor-${layer.id}`;
            const floorColor = layer.floorColorOverride || theme.floorFill;
            return (
              <g key={layer.id} opacity={layer.opacity}>
                {floorPath && (
                  <defs>
                    <mask id={maskId}>
                      <rect x={-worldExtent} y={-worldExtent} width={worldExtent * 2} height={worldExtent * 2} fill="white" />
                      {doc.layers.map((maskLayer) => {
                        if (!maskLayer.visible || layerEnvironment(maskLayer) === 'exterior') return null;
                        const maskPath = multiPolygonToSvgPath(maskLayer.geometry);
                        if (!maskPath) return null;
                        return <path key={maskLayer.id} d={maskPath} fill="black" fillRule="evenodd" />;
                      })}
                    </mask>
                    <clipPath id={clipId}>
                      <path d={floorPath} fillRule="evenodd" />
                    </clipPath>
                  </defs>
                )}
                {floorPath && layer.hatchEnabled && (
                  <g mask={`url(#${maskId})`}>
                    <path d={floorPath} fill="none" stroke="url(#iso-hatch-pattern)" strokeWidth={grid} strokeLinejoin="round" />
                  </g>
                )}
                {floorPath && (
                  <g>
                    <path d={floorPath} fill={floorColor} fillRule="evenodd" />
                    <FloorTextureStack
                      layerId={layer.id}
                      paints={layer.texturePaints ?? []}
                      clipId={clipId}
                      draft={null}
                      idPrefix="iso-"
                    />
                    {doc.showGrid && (
                      <rect
                        x={-worldExtent}
                        y={-worldExtent}
                        width={worldExtent * 2}
                        height={worldExtent * 2}
                        fill="url(#iso-floor-grid)"
                        clipPath={`url(#${clipId})`}
                      />
                    )}
                  </g>
                )}
              </g>
            );
          }

          const style = layer.buildingStyle ?? 'roof_tile';
          const building = buildExteriorBuildingData(layer.geometry, style, grid);
          return (
            <g key={layer.id} opacity={layer.opacity}>
              <FloorTextureStack
                layerId={layer.id}
                paints={layer.texturePaints ?? []}
                draft={null}
                idPrefix="iso-"
              />
              {(layer.roads ?? []).map((road) => {
                const d = multiPolygonToSvgPath(road.polygon);
                if (!d) return null;
                return (
                  <path
                    key={road.id}
                    d={d}
                    fill={patternFill(roadTexturePath(road.style), theme.wallFill)}
                    stroke={theme.inkStroke}
                    strokeWidth={1.45 * ink}
                    strokeLinejoin="round"
                  />
                );
              })}
              {floorPath && ROOF_STYLES.has(style) && (
                <path d={floorPath} fill={theme.inkStroke} fillOpacity={0.16} fillRule="evenodd" />
              )}
              {floorPath && style === 'castle_wall' && (
                <path
                  d={floorPath}
                  fill={patternFill(buildingTexturePath(style), theme.wallFill)}
                  fillRule="evenodd"
                />
              )}
              {floorPath && style === 'palisade' && (
                <path d={floorPath} fill={theme.wallFill} fillOpacity={0.18} fillRule="evenodd" />
              )}
              {floorPath && style === 'ruined_building' && (
                <path
                  d={floorPath}
                  fill={patternFill(buildingTexturePath(style), theme.wallFill)}
                  fillOpacity={0.55}
                  fillRule="evenodd"
                />
              )}
              {style === 'ruined_building' &&
                building.rubblePaths.map((rubble, index) => (
                  <path key={index} d={rubble} fill={theme.wallFill} stroke={theme.inkStroke} strokeWidth={ink} />
                ))}
            </g>
          );
        })}

        {doc.stairs.map((stair) => (
          <svg key={stair.id} x={stair.x} y={stair.y} overflow="visible">
            <g transform={`rotate(${stair.rotation}) scale(${ink})`}>
              <SvgStairArtwork
                type={stair.type}
                widthPx={(stair.widthCells * grid) / ink}
                lengthPx={(stair.lengthCells * grid) / ink}
                inkColor={theme.inkStroke}
                floorColor={theme.floorFill}
              />
            </g>
          </svg>
        ))}

        {doc.doors.map((door) => (
          <svg key={door.id} x={door.x} y={door.y} overflow="visible">
            <g transform={`rotate(${door.rotation}) scale(${ink})`}>
              <SvgDoorArtwork
                type={door.type}
                widthPx={(door.widthCells * grid) / ink}
                inkColor={theme.inkStroke}
                floorColor={theme.floorFill}
                flipped={door.flipped}
              />
            </g>
          </svg>
        ))}

        {doc.props.map((prop) => {
          if (prop.artwork !== 'upright' && prop.kind === 'svg' && (prop.svgPropId === 'tree' || prop.svgPropId === 'boulder')) return null;
          const width = prop.widthPx * prop.scale;
          const height = prop.heightPx * prop.scale;
          const pngHref = prop.pngDataUrl || resolveAssetUrl(prop.assetPath);
          return (
            <svg key={prop.id} x={prop.x} y={prop.y} overflow="visible">
              <g transform={propArtworkTransform(prop.artwork, prop.artworkQuarter, prop.rotation, prop.flipX)} filter="url(#ds-prop-shadow)">
                {prop.kind === 'svg' && prop.svgPropId ? (
                  <g transform={`scale(${ink})`}>
                    <SvgPropArtwork
                      propId={prop.svgPropId}
                      width={width / ink}
                      height={height / ink}
                      inkColor={theme.inkStroke}
                      fillColor={theme.floorFill}
                    />
                  </g>
                ) : pngHref ? (
                  <image href={pngHref} x={-width / 2} y={-height / 2} width={width} height={height} preserveAspectRatio="xMidYMid meet" />
                ) : null}
              </g>
            </svg>
          );
        })}
      </g>

      <g>
        {model.curbs.map((curb) => (
          <path
            key={curb.id}
            d={curb.d}
            fill={curb.fill}
            fillRule="nonzero"
            fillOpacity={curb.fill === 'none' ? 0 : curb.opacity}
            stroke={curb.stroke}
            strokeWidth={curb.strokeWidth}
            strokeOpacity={curb.stroke === 'none' ? 0 : curb.strokeOpacity * curb.opacity}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {model.volumes.map((item) =>
          item.draw.kind === 'roof' ? (
            <RoofShape key={item.draw.id} item={item} quarter={quarter} grid={grid} theme={theme} ink={ink} />
          ) : (
            <FaceShape key={item.draw.id} item={item} quarter={quarter} />
          )
        )}
      </g>

      <g>
        {doc.labels.map((label) => {
          const [x, y] = projectIso(label.x, label.y, wallHeight * 0.35, quarter);
          return (
            <g key={label.id} transform={`translate(${x} ${y}) rotate(${label.rotation})`}>
              {label.badgeNumber && (
                <g transform={`translate(0 ${-14 * ink}) scale(${ink})`}>
                  <circle cx={0} cy={0} r={11} fill={theme.floorFill} stroke={theme.inkStroke} strokeWidth={1.8} />
                  <text x={0} y={4} textAnchor="middle" fontSize="11" fontWeight="700" fontFamily="JetBrains Mono, monospace" fill={theme.accentLabel}>
                    {label.badgeNumber}
                  </text>
                </g>
              )}
              {label.text && (
                <text
                  x={0}
                  y={label.badgeNumber ? 10 * ink : 4 * ink}
                  textAnchor="middle"
                  fontSize={label.fontSize}
                  fontWeight="600"
                  fontFamily="Architects Daughter, Inter, sans-serif"
                  fill={theme.accentLabel}
                  stroke={theme.floorFill}
                  strokeWidth={3 * ink}
                  paintOrder="stroke"
                >
                  {label.text}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </g>
  );
}

export const IsoScene = memo(IsoSceneView);

function RoofShape({
  item,
  quarter,
  grid,
  theme,
  ink,
}: {
  item: IsoDrawable;
  quarter: IsoQuarter;
  grid: number;
  theme: MapTheme;
  ink: number;
}) {
  if (item.draw.kind !== 'roof') return null;
  const roof = item.draw;
  const data = buildExteriorBuildingData([roof.polygon], roof.style, grid);
  const floorPath = multiPolygonToSvgPath([roof.polygon]);
  if (!floorPath) return null;
  return (
    <g opacity={roof.opacity} transform={isoPlaneMatrix(quarter, roof.z)}>
      <BuildingShape
        floorPath={floorPath}
        data={data}
        style={roof.style}
        theme={theme}
        ink={ink}
        shadow={false}
      />
    </g>
  );
}
