export interface UnitTypeData {
  id: string;
  displayName: string;
  strength: number;
  movementPoints: number;
  productionCost: number;
  // null means available from the start, no tech required.
  requiresTechId: string | null;
}
