import type { UnitTypeData } from "./UnitTypeData";

export const WARRIOR: UnitTypeData = {
  id: "warrior",
  displayName: "Warrior",
  strength: 5,
  movementPoints: 2,
  productionCost: 20,
  requiresTechId: null,
};

export const SCOUT: UnitTypeData = {
  id: "scout",
  displayName: "Scout",
  strength: 2,
  movementPoints: 4,
  productionCost: 15,
  requiresTechId: "scouting",
};

export const WARBAND: UnitTypeData = {
  id: "warband",
  displayName: "Warband",
  strength: 9,
  movementPoints: 1,
  productionCost: 35,
  requiresTechId: "bronze_working",
};

export const ALL_UNIT_TYPES: UnitTypeData[] = [WARRIOR, SCOUT, WARBAND];
