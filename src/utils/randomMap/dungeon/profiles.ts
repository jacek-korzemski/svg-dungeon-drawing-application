import type { WallStyle } from '../../../types/dungeon';
import type { ConcreteArchetype, RoomKind } from './model';

export type RoomRole =
  | 'normal'
  | 'entrance'
  | 'hub'
  | 'sanctum'
  | 'boss'
  | 'vault'
  | 'shrine'
  | 'guard'
  | 'connector'
  | 'storage'
  | 'barracks'
  | 'library'
  | 'prison';

export interface RoutePolicy {
  diagonalRock: number;
  diagonalOther: number;
  diagonalDouble: number;
  wideTree: number;
  wideRequired: number;
  wideLoop: number;
}

export interface DungeonProfile {
  archetype: ConcreteArchetype;
  roomDensity: [number, number];
  kindWeights: Partial<Record<RoomKind, number>>;
  roleKindWeights: Partial<Record<RoomRole, Partial<Record<RoomKind, number>>>>;
  route: RoutePolicy;
  loopRate: number;
  loopMinHops: number;
  primaryStyles: WallStyle[];
  stylePool: WallStyle[];
  layerDropChance: number;
  caveChance: Partial<Record<WallStyle, number>>;
  features: { alcove: number; chasm: number; partition: number };
  propDensity: number;
}

const classicRoute: RoutePolicy = {
  diagonalRock: 0.6,
  diagonalOther: 0.35,
  diagonalDouble: 0,
  wideTree: 0.25,
  wideRequired: 0.25,
  wideLoop: 0,
};

const roleKindWeights: DungeonProfile['roleKindWeights'] = {
  hub: { hall: 40, octagon: 30, hexagon: 20, rect: 10 },
  sanctum: { hall: 35, octagon: 35, hexagon: 20, rect: 10 },
  boss: { hall: 35, octagon: 25, rect: 25, hexagon: 15 },
  connector: { rect: 60, octagon: 40 },
  vault: { rect: 60, octagon: 40 },
  shrine: { octagon: 40, hexagon: 30, rect: 30 },
};

export const PROFILES: Record<ConcreteArchetype, DungeonProfile> = {
  classic: {
    archetype: 'classic',
    roomDensity: [0.85, 1.15],
    kindWeights: { rect: 40, hall: 15, L: 15, octagon: 15, hexagon: 12, T: 15 },
    roleKindWeights,
    route: classicRoute,
    loopRate: 0.15,
    loopMinHops: 3,
    primaryStyles: ['straight'],
    stylePool: ['brick', 'double', 'rock', 'ruins'],
    layerDropChance: 0.35,
    caveChance: { rock: 1 },
    features: { alcove: 0.15, chasm: 0.05, partition: 0.1 },
    propDensity: 0.3,
  },
  delve: {
    archetype: 'delve',
    roomDensity: [0.8, 1],
    kindWeights: { rect: 30, hall: 10, L: 15, octagon: 15, hexagon: 10, T: 10 },
    roleKindWeights,
    route: { diagonalRock: 0.5, diagonalOther: 0.25, diagonalDouble: 0, wideTree: 0.2, wideRequired: 0.45, wideLoop: 0 },
    loopRate: 0.05,
    loopMinHops: 3,
    primaryStyles: ['straight', 'brick', 'ruins'],
    stylePool: ['brick', 'ruins', 'rock', 'double'],
    layerDropChance: 0.15,
    caveChance: { rock: 0.8, ruins: 0.15 },
    features: { alcove: 0.25, chasm: 0.1, partition: 0.15 },
    propDensity: 0.35,
  },
  hub: {
    archetype: 'hub',
    roomDensity: [0.9, 1.1],
    kindWeights: { rect: 35, L: 15, T: 15, octagon: 12, hexagon: 8, hall: 10 },
    roleKindWeights,
    route: { diagonalRock: 0.5, diagonalOther: 0.3, diagonalDouble: 0, wideTree: 0.2, wideRequired: 0.7, wideLoop: 0 },
    loopRate: 0.1,
    loopMinHops: 3,
    primaryStyles: ['straight', 'double'],
    stylePool: ['brick', 'double', 'ruins', 'rock'],
    layerDropChance: 0.15,
    caveChance: { rock: 0.7, ruins: 0.1 },
    features: { alcove: 0.2, chasm: 0.08, partition: 0.2 },
    propDensity: 0.4,
  },
  ring: {
    archetype: 'ring',
    roomDensity: [0.9, 1.1],
    kindWeights: { rect: 40, octagon: 20, hall: 10, L: 10, T: 10, hexagon: 8 },
    roleKindWeights,
    route: { diagonalRock: 0.3, diagonalOther: 0.15, diagonalDouble: 0, wideTree: 0.3, wideRequired: 0.5, wideLoop: 0.2 },
    loopRate: 0.1,
    loopMinHops: 3,
    primaryStyles: ['double', 'straight', 'brick'],
    stylePool: ['brick', 'straight', 'ruins', 'double'],
    layerDropChance: 0.15,
    caveChance: { rock: 0.6 },
    features: { alcove: 0.3, chasm: 0.05, partition: 0.25 },
    propDensity: 0.4,
  },
  maze: {
    archetype: 'maze',
    roomDensity: [0.85, 1.15],
    kindWeights: { rect: 50, hall: 20, octagon: 20, L: 10 },
    roleKindWeights,
    route: classicRoute,
    loopRate: 0.15,
    loopMinHops: 3,
    primaryStyles: ['straight', 'brick'],
    stylePool: ['brick', 'ruins', 'double'],
    layerDropChance: 0.2,
    caveChance: { rock: 1 },
    features: { alcove: 0, chasm: 0, partition: 0.15 },
    propDensity: 0.5,
  },
  cavern: {
    archetype: 'cavern',
    roomDensity: [0.85, 1.15],
    kindWeights: { rect: 40, hall: 15, L: 15, octagon: 15, hexagon: 12, T: 15 },
    roleKindWeights,
    route: classicRoute,
    loopRate: 0.15,
    loopMinHops: 3,
    primaryStyles: ['rock'],
    stylePool: ['ruins', 'brick', 'straight', 'double'],
    layerDropChance: 0.2,
    caveChance: { rock: 1 },
    features: { alcove: 0.15, chasm: 0.05, partition: 0.1 },
    propDensity: 0.5,
  },
};
