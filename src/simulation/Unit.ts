import type { Coordinate } from "./Tile";
import type { UnitTypeData } from "../data/UnitTypeData";

export interface MoveOrder {
  path: Coordinate[];
  pathIndex: number;
}

export class Unit {
  readonly id: number;
  readonly factionId: number;
  readonly type: UnitTypeData;
  strength: number;
  coordinate: Coordinate;
  movementPoints: number;
  order: MoveOrder | null = null;

  constructor(id: number, factionId: number, type: UnitTypeData, coordinate: Coordinate) {
    this.id = id;
    this.factionId = factionId;
    this.type = type;
    this.strength = type.strength;
    this.coordinate = coordinate;
    this.movementPoints = type.movementPoints;
  }
}
