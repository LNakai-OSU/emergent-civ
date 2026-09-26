import type { TechTypeData } from "./TechTypeData";

export const SCOUTING: TechTypeData = {
  id: "scouting",
  displayName: "Scouting",
  productionCost: 20,
  description: "Unlocks the Scout unit (fast, weak).",
};

export const BRONZE_WORKING: TechTypeData = {
  id: "bronze_working",
  displayName: "Bronze Working",
  productionCost: 40,
  description: "Unlocks the Warband unit (slow, strong).",
};

export const AGRICULTURE: TechTypeData = {
  id: "agriculture",
  displayName: "Agriculture",
  productionCost: 25,
  description: "Unlocks the Farm building (+2 food on its tile).",
};

export const MASONRY: TechTypeData = {
  id: "masonry",
  displayName: "Masonry",
  productionCost: 30,
  description: "Unlocks the Workshop building (+2 production on its tile).",
};

export const ALL_TECHS: TechTypeData[] = [SCOUTING, BRONZE_WORKING, AGRICULTURE, MASONRY];
