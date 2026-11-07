import type { PointerEvent as ReactPointerEvent } from 'react';
import { buildingTexturePath, roadTexturePath } from '../data/presets';
import { floorTextureByPath, texturePatternId } from '../data/textureLibrary';
import {
  BuildingStyle,
  DungeonLayer,
  ExteriorRoad,
  ExteriorWallStyle,
  MapTheme,
  SelectedEntity,
  StandaloneWall,
  TextureBrushShape,
  TextureDab,
  ToolType,
} from '../types/dungeon';
import {
  buildExteriorWallSvgData,
  ExteriorBuildingData,
  multiPolygonToSvgPath,
} from '../utils/geometry';
import { draftTexturePaint, FloorTextureStack } from './FloorTextureLayer';

const BUILDING_FALLBACK: Record<BuildingStyle, string> = {
  roof_tile: '#b4533a',
  roof_thatch: '#c4a15a',
  roof_slate: '#4b5563',
  castle_wall: '#d6d3d1',
  palisade: '#d8c7a2',
  ruined_building: '#a8a29e',
};

const ROAD_FALLBACK: Record<string, string> = {
  cobble: '#9ca3af',
  dirt: '#a16207',
  gravel: '#d6d3d1',
  wood_planks: '#c4a574',
};

function patternFill(texturePath: string, fallback: string): string {
  return floorTextureByPath(texturePath) ? `url(#${texturePatternId(texturePath)})` : fallback;
}

function isRoof(style: BuildingStyle): boolean {
  return style === 'roof_tile' || style === 'roof_thatch' || style === 'roof_slate';
}

function BuildingShape({
  floorPath,
  data,
  style,
  theme,
  ink,
  shadow,
}: {
  floorPath: string;
  data: ExteriorBuildingData;
  style: BuildingStyle;
  theme: MapTheme;
  ink: number;
  shadow: boolean;
}) {
  const fill = patternFill(buildingTexturePath(style), BUILDING_FALLBACK[style]);
  const shadeOpacity = style === 'roof_slate' ? 0.4 : style === 'roof_thatch' ? 0.2 : 0.28;

  return (
    <g pointerEvents="none">
      <g filter={shadow ? 'url(#ds-building-shadow)' : undefined}>
        {style === 'palisade' ? (
          <path d={floorPath} fill={theme.wallFill} fillOpacity={0.18} fillRule="evenodd" />
        ) : (
          <path
            d={floorPath}
            fill={fill}
            fillOpacity={style === 'ruined_building' ? 0.55 : 1}
            fillRule="evenodd"
          />
        )}
        {isRoof(style) && data.shadedSlopePath && (
          <path d={data.shadedSlopePath} fill={theme.inkStroke} fillOpacity={shadeOpacity} fillRule="evenodd" />
        )}
      </g>

      {isRoof(style) && (
        <>
          <path
            d={floorPath}
            fill="none"
            stroke={theme.inkStroke}
            strokeWidth={2.1 * ink}
            strokeLinejoin="miter"
          />
          {data.roofDetailPath && (
            <path
              d={data.roofDetailPath}
              fill="none"
              stroke={theme.inkStroke}
              strokeWidth={(style === 'roof_thatch' ? 1.35 : 0.9) * ink}
              strokeLinecap="round"
              opacity={style === 'roof_thatch' ? 0.8 : 0.5}
            />
          )}
          {data.raggedPath && (
            <path
              d={data.raggedPath}
              fill="none"
              stroke={theme.inkStroke}
              strokeWidth={1.5 * ink}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.75}
            />
          )}
          {data.hipPath && (
            <path d={data.hipPath} fill="none" stroke={theme.inkStroke} strokeWidth={1.45 * ink} />
          )}
          {data.ridgePath && (
            <path
              d={data.ridgePath}
              fill="none"
              stroke={theme.inkStroke}
              strokeWidth={(style === 'roof_thatch' ? 3.1 : 2.3) * ink}
              strokeLinecap="round"
            />
          )}
        </>
      )}

      {style === 'castle_wall' && (
        <>
          <path d={floorPath} fill="none" stroke={theme.inkStroke} strokeWidth={16 * ink} strokeLinejoin="miter" />
          <path d={floorPath} fill="none" stroke={theme.wallFill} strokeWidth={10 * ink} strokeLinejoin="miter" />
          {data.crenellationsPath && (
            <path
              d={data.crenellationsPath}
              fill={theme.wallFill}
              stroke={theme.inkStroke}
              strokeWidth={1.15 * ink}
              strokeLinejoin="miter"
            />
          )}
          {data.cornerTowers.map((tower, index) => (
            <g key={index}>
              <circle cx={tower.x} cy={tower.y} r={tower.r} fill={theme.wallFill} stroke={theme.inkStroke} strokeWidth={1.6 * ink} />
              <circle cx={tower.x} cy={tower.y} r={tower.r * 0.45} fill="none" stroke={theme.inkStroke} strokeWidth={ink} />
            </g>
          ))}
        </>
      )}

      {style === 'palisade' &&
        data.palisadePosts.map((post, index) => (
          <circle
            key={index}
            cx={post.x}
            cy={post.y}
            r={post.r}
            fill="#a56b3c"
            stroke={theme.inkStroke}
            strokeWidth={ink}
          />
        ))}

      {style === 'ruined_building' && (
        <>
          {data.brokenPath && (
            <path
              d={data.brokenPath}
              fill="none"
              stroke={theme.inkStroke}
              strokeWidth={3.2 * ink}
              strokeLinecap="square"
            />
          )}
          {data.rubblePaths.map((rubble, index) => (
            <path key={index} d={rubble} fill={theme.wallFill} stroke={theme.inkStroke} strokeWidth={ink} />
          ))}
          {data.ridgePath && (
            <path
              d={data.ridgePath}
              fill="none"
              stroke={theme.inkStroke}
              strokeWidth={2 * ink}
              strokeLinecap="square"
              strokeDasharray={`${8 * ink} ${5 * ink}`}
            />
          )}
        </>
      )}
    </g>
  );
}

function RoadShape({
  road,
  theme,
  ink,
  selected,
  interactive,
  onPointerDown,
}: {
  road: ExteriorRoad;
  theme: MapTheme;
  ink: number;
  selected: boolean;
  interactive: boolean;
  onPointerDown: (event: ReactPointerEvent) => void;
}) {
  const d = multiPolygonToSvgPath(road.polygon);
  if (!d) return null;
  return (
    <g
      onPointerDown={interactive ? onPointerDown : undefined}
      className={interactive ? 'cursor-pointer' : undefined}
    >
      <path d={d} fill={patternFill(roadTexturePath(road.style), ROAD_FALLBACK[road.style] ?? theme.wallFill)} />
      <path
        d={d}
        fill="none"
        stroke={theme.inkStroke}
        strokeWidth={1.45 * ink}
        strokeLinejoin="round"
      />
      {selected && (
        <path
          d={d}
          fill="none"
          stroke="#3B82F6"
          strokeWidth={2.6 * ink}
          strokeDasharray={`${5 * ink} ${3 * ink}`}
        />
      )}
    </g>
  );
}

function ExteriorWallShape({
  wall,
  theme,
  ink,
  gridSize,
  selected,
  interactive,
  onPointerDown,
}: {
  wall: StandaloneWall;
  theme: MapTheme;
  ink: number;
  gridSize: number;
  selected: boolean;
  interactive: boolean;
  onPointerDown: (event: ReactPointerEvent) => void;
}) {
  const style: ExteriorWallStyle = wall.exteriorWallStyle ?? 'castle_crenellated';
  const data = buildExteriorWallSvgData(wall.points, style, gridSize, Boolean(wall.hasTowers));
  if (!data.linePath && !data.hedgePath) return null;

  const body = (() => {
    if (style === 'castle_crenellated') {
      return (
        <>
          <path d={data.linePath} fill="none" stroke={theme.inkStroke} strokeWidth={14 * ink} strokeLinecap="square" />
          <path d={data.linePath} fill="none" stroke={theme.wallFill} strokeWidth={8 * ink} strokeLinecap="square" />
          {data.crenellationsPath && (
            <path
              d={data.crenellationsPath}
              fill={theme.wallFill}
              stroke={theme.inkStroke}
              strokeWidth={1.1 * ink}
            />
          )}
        </>
      );
    }
    if (style === 'stone_wall') {
      return (
        <>
          <path d={data.linePath} fill="none" stroke={theme.inkStroke} strokeWidth={10 * ink} strokeLinecap="square" />
          <path d={data.linePath} fill="none" stroke={theme.wallFill} strokeWidth={6 * ink} strokeLinecap="square" />
        </>
      );
    }
    if (style === 'wood_fence') {
      return (
        <>
          <path d={data.railPath} fill="none" stroke="#6b3f1f" strokeWidth={1.7 * ink} strokeLinecap="square" />
          {data.posts.map((post, index) => (
            <rect
              key={index}
              x={post.x - post.r}
              y={post.y - post.r * 1.6}
              width={post.r * 2}
              height={post.r * 3.2}
              fill="#c4a574"
              stroke={theme.inkStroke}
              strokeWidth={0.8 * ink}
            />
          ))}
        </>
      );
    }
    if (style === 'hedge') {
      return (
        <>
          <path d={data.hedgePath} fill="none" stroke="#1f4d28" strokeWidth={9 * ink} strokeLinecap="round" strokeLinejoin="round" />
          <path d={data.hedgePath} fill="none" stroke="#67a85a" strokeWidth={4 * ink} strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    }
    return (
      <>
        {data.posts.map((post, index) => (
          <circle key={index} cx={post.x} cy={post.y} r={post.r} fill="#a56b3c" stroke={theme.inkStroke} strokeWidth={ink} />
        ))}
      </>
    );
  })();

  return (
    <g
      onPointerDown={interactive ? onPointerDown : undefined}
      className={interactive ? 'cursor-pointer' : undefined}
    >
      {body}
      {data.towers.map((tower, index) => (
        <circle
          key={index}
          cx={tower.x}
          cy={tower.y}
          r={tower.r}
          fill={style === 'wood_fence' || style === 'palisade_logs' ? '#8a5a32' : theme.wallFill}
          stroke={theme.inkStroke}
          strokeWidth={1.3 * ink}
        />
      ))}
      {selected && (
        <path
          d={data.linePath}
          fill="none"
          stroke="#3B82F6"
          strokeWidth={3 * ink}
          strokeDasharray={`${5 * ink} ${3 * ink}`}
        />
      )}
    </g>
  );
}

export function ExteriorLayerGraphics({
  layer,
  floorPath,
  buildingData,
  theme,
  ink,
  gridSize,
  active,
  draftDabs,
  textureShape,
  textureSoftness,
  texturePath,
  textureErasing,
  selectedEntity,
  activeTool,
  onSelectEntity,
}: {
  layer: DungeonLayer;
  floorPath: string;
  buildingData: ExteriorBuildingData;
  theme: MapTheme;
  ink: number;
  gridSize: number;
  active: boolean;
  draftDabs: TextureDab[] | null;
  textureShape: TextureBrushShape;
  textureSoftness: number;
  texturePath: string;
  textureErasing: boolean;
  selectedEntity: SelectedEntity;
  activeTool: ToolType;
  onSelectEntity: (entity: SelectedEntity) => void;
}) {
  const style = layer.buildingStyle ?? 'roof_tile';
  const selecting = activeTool === 'select';
  return (
    <>
      <FloorTextureStack
        layerId={layer.id}
        paints={layer.texturePaints ?? []}
        draft={
          active && draftDabs && !textureErasing
            ? draftTexturePaint(draftDabs, textureShape, textureSoftness, texturePath)
            : null
        }
      />
      {(layer.roads ?? []).map((road) => (
        <RoadShape
          key={road.id}
          road={road}
          theme={theme}
          ink={ink}
          selected={selectedEntity?.kind === 'road' && selectedEntity.id === road.id}
          interactive={selecting}
          onPointerDown={(event) => {
            event.stopPropagation();
            onSelectEntity({ kind: 'road', layerId: layer.id, id: road.id });
          }}
        />
      ))}
      {floorPath && (
        <BuildingShape
          floorPath={floorPath}
          data={buildingData}
          style={style}
          theme={theme}
          ink={ink}
          shadow={layer.hatchEnabled}
        />
      )}
      {layer.standaloneWalls.map((wall) => (
        <ExteriorWallShape
          key={wall.id}
          wall={wall}
          theme={theme}
          ink={ink}
          gridSize={gridSize}
          selected={selectedEntity?.kind === 'wall' && selectedEntity.id === wall.id}
          interactive={selecting}
          onPointerDown={(event) => {
            event.stopPropagation();
            onSelectEntity({ kind: 'wall', layerId: layer.id, id: wall.id });
          }}
        />
      ))}
    </>
  );
}
