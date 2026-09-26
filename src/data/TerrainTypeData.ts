export interface TerrainTypeData {
  id: string;
  displayName: string;
  foodYield: number;
  productionYield: number;
  goldYield: number;

  // TODO: Water is currently marked impassable via a very high movementCost (99)
  // instead of a real flag. Replace with an explicit isPassable bool (or per-unit-type
  // passability, for future naval units) once the movement/pathing system exists.
  movementCost: number;

  color: string;
}
