import type {
  DungeonDocument,
  MultiPolygon2D,
  Point2D,
  Polygon2D,
  Ring2D,
} from '../types/dungeon';

export const MIN_GRID_SIZE = 8;
export const MAX_GRID_SIZE = 256;

function scalePoint(point: Point2D, ratio: number): Point2D {
  return [point[0] * ratio, point[1] * ratio];
}

function scaleRing(ring: Ring2D, ratio: number): Ring2D {
  return ring.map((point) => scalePoint(point, ratio));
}

function scalePolygon(polygon: Polygon2D, ratio: number): Polygon2D {
  return polygon.map((ring) => scaleRing(ring, ratio));
}

function scaleMulti(multi: MultiPolygon2D, ratio: number): MultiPolygon2D {
  return multi.map((polygon) => scalePolygon(polygon, ratio));
}

/**
 * Multiply every world-pixel measurement so a room that occupied N cells still occupies N cells
 * after the cell size changes. `nextGridSize` is the integer the user asked for.
 */
export function scaleDocument(
  doc: DungeonDocument,
  ratio: number,
  nextGridSize = doc.gridSize * ratio
): DungeonDocument {
  if (!Number.isFinite(ratio) || ratio <= 0) return doc;
  if (ratio === 1 && nextGridSize === doc.gridSize) return doc;
  return {
    ...doc,
    gridSize: nextGridSize,
    layers: doc.layers.map((layer) => ({
      ...layer,
      geometry: scaleMulti(layer.geometry, ratio),
      standaloneWalls: (layer.standaloneWalls ?? []).map((wall) => ({
        ...wall,
        points: wall.points.map((point) => scalePoint(point, ratio)),
        thickness: wall.thickness * ratio,
      })),
      texturePaints: (layer.texturePaints ?? []).map((paint) => ({
        ...paint,
        dabs: paint.dabs.map((dab) => ({
          x: dab.x * ratio,
          y: dab.y * ratio,
          r: dab.r * ratio,
        })),
        region: scaleMulti(paint.region, ratio),
      })),
      roads: layer.roads?.map((road) => ({
        ...road,
        points: road.points.map((point) => scalePoint(point, ratio)),
        width: road.width * ratio,
        polygon: scaleMulti(road.polygon, ratio),
      })),
    })),
    doors: doc.doors.map((door) => ({ ...door, x: door.x * ratio, y: door.y * ratio })),
    stairs: doc.stairs.map((stair) => ({ ...stair, x: stair.x * ratio, y: stair.y * ratio })),
    props: doc.props.map((prop) => ({
      ...prop,
      x: prop.x * ratio,
      y: prop.y * ratio,
      scale: (prop.scale || 1) * ratio,
    })),
    labels: doc.labels.map((label) => ({
      ...label,
      x: label.x * ratio,
      y: label.y * ratio,
      fontSize: label.fontSize * ratio,
    })),
  };
}
