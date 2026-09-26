export interface BuildingTypeData {
  id: string;
  displayName: string;
  productionCost: number;
  foodBonus: number;
  productionBonus: number;
  goldBonus: number;
  requiresTechId: string | null;
}
