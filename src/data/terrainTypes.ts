import type { TerrainTypeData } from "./TerrainTypeData";

export const PLAINS: TerrainTypeData = {
  id: "plains",
  displayName: "Plains",
  foodYield: 2,
  productionYield: 1,
  goldYield: 0,
  movementCost: 1,
  color: "#8FBF5C",
};

export const FOREST: TerrainTypeData = {
  id: "forest",
  displayName: "Forest",
  foodYield: 1,
  productionYield: 2,
  goldYield: 0,
  movementCost: 2,
  color: "#2D5A27",
};

export const MOUNTAIN: TerrainTypeData = {
  id: "mountain",
  displayName: "Mountain",
  foodYield: 0,
  productionYield: 1,
  goldYield: 1,
  movementCost: 3,
  color: "#8B8378",
};

export const WATER: TerrainTypeData = {
  id: "water",
  displayName: "Water",
  foodYield: 1,
  productionYield: 0,
  goldYield: 2,
  movementCost: 99,
  color: "#3B7EA1",
};

export const DEFAULT_TERRAIN_PALETTE: TerrainTypeData[] = [PLAINS, FOREST, MOUNTAIN, WATER];
