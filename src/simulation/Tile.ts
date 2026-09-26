import type { TerrainTypeData } from "../data/TerrainTypeData";
import type { BuildingTypeData } from "../data/BuildingTypeData";

export interface Coordinate {
  x: number;
  y: number;
}

export const UNCLAIMED_FACTION_ID = -1;

export class Tile {
  readonly coordinate: Coordinate;
  readonly terrain: TerrainTypeData;
  ownerFactionId: number = UNCLAIMED_FACTION_ID;
  building: BuildingTypeData | null = null;

  // Conquest state. occupationTurns counts consecutive turns a lone enemy
  // unit has stood here uncontested (see MilitarySystem) - reaching the
  // threshold flips the tile. unrestTurns counts down after any conquest,
  // halving this tile's yield while positive (see TerritoryIndex).
  occupationTurns = 0;
  unrestTurns = 0;

  constructor(coordinate: Coordinate, terrain: TerrainTypeData) {
    this.coordinate = coordinate;
    this.terrain = terrain;
  }

  get isUnclaimed(): boolean {
    return this.ownerFactionId === UNCLAIMED_FACTION_ID;
  }
}
