import type { Coordinate } from "./Tile";

export const FactionStatus = {
  Active: "active",
  Dormant: "dormant",
  Eliminated: "eliminated",
} as const;
export type FactionStatus = (typeof FactionStatus)[keyof typeof FactionStatus];

export class Faction {
  readonly id: number;
  name: string;
  color: string;

  population = 1;
  foodStockpile = 0;
  productionStockpile = 0;
  goldStockpile = 0;
  isPlayerControlled = false;
  researchedTechIds = new Set<string>();

  // Economic growth model (Malthus-Boserup-Smith)
  investment = 0;
  investRate = 0.3;

  // Diplomacy model (Spiral-Exchange with Lateral Pressure) reads this to
  // gauge each faction's recent military buildup.
  prevStrength = 0;
  strengthGrowthEma = 0;

  // Conquest/elimination
  capital: Coordinate | null = null;
  status: FactionStatus = FactionStatus.Active;
  dormantTurns = 0;

  constructor(id: number, name: string, color: string) {
    this.id = id;
    this.name = name;
    this.color = color;
  }
}
