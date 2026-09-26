import type { BuildingTypeData } from "./BuildingTypeData";

export const FARM: BuildingTypeData = {
  id: "farm",
  displayName: "Farm",
  productionCost: 15,
  foodBonus: 2,
  productionBonus: 0,
  goldBonus: 0,
  requiresTechId: "agriculture",
};

export const WORKSHOP: BuildingTypeData = {
  id: "workshop",
  displayName: "Workshop",
  productionCost: 15,
  foodBonus: 0,
  productionBonus: 2,
  goldBonus: 0,
  requiresTechId: "masonry",
};

export const ALL_BUILDING_TYPES: BuildingTypeData[] = [FARM, WORKSHOP];
