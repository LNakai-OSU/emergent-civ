import type { WorldGrid } from "./WorldGrid";
import type { Faction } from "./Faction";
import type { Unit } from "./Unit";
import type { TurnController } from "./TurnController";
import type { DiplomaticStance } from "./DiplomacySystem";

export interface TileSnapshot {
  x: number;
  y: number;
  ownerFactionId: number;
  unrestTurns: number;
  occupationTurns: number;
}

export interface FactionSnapshot {
  id: number;
  name: string;
  color: string;
  isPlayerControlled: boolean;
  status: string;
  population: number;
  foodStockpile: number;
  productionStockpile: number;
  goldStockpile: number;
  investRate: number;
  investment: number;
  militaryStrength: number;
}

export interface UnitSnapshot {
  id: number;
  factionId: number;
  coordinate: { x: number; y: number };
}

export interface DiplomacyPairSnapshot {
  a: number;
  b: number;
  score: number;
  stance: DiplomaticStance;
}

export interface MovementLogEntry {
  factionId: number;
  to: { x: number; y: number };
}

export interface CombatLogEntry {
  winnerFactionId: number;
  winnerStrength: number;
  loserFactionId: number;
  at: { x: number; y: number };
}

export interface GameSnapshot {
  turn: number;
  tiles: TileSnapshot[]; // only claimed tiles - terrain itself never changes, so unclaimed tiles render straight from the live (static) grid
  factions: FactionSnapshot[];
  units: UnitSnapshot[];
  diplomacy: DiplomacyPairSnapshot[];
  aiLog: string[]; // AIActionLog.description already bakes in faction names at generation time
  movementLog: MovementLogEntry[];
  combatLog: CombatLogEntry[];
}

// Plain-data snapshot for the history/scrub-back feature - deliberately not
// a deep clone of the live class instances, just what rendering needs, so
// stepping back through history doesn't require re-running the simulation
// or keeping every mutable object alive.
export function captureSnapshot(grid: WorldGrid, factions: Faction[], units: Unit[], turnController: TurnController): GameSnapshot {
  const tiles: TileSnapshot[] = [];
  for (const tile of grid.allTiles()) {
    if (tile.isUnclaimed) continue;
    tiles.push({
      x: tile.coordinate.x,
      y: tile.coordinate.y,
      ownerFactionId: tile.ownerFactionId,
      unrestTurns: tile.unrestTurns,
      occupationTurns: tile.occupationTurns,
    });
  }

  const diplomacy: DiplomacyPairSnapshot[] = [];
  for (let i = 0; i < factions.length; i++) {
    for (let j = i + 1; j < factions.length; j++) {
      const a = factions[i].id;
      const b = factions[j].id;
      diplomacy.push({ a, b, score: turnController.getRelationshipScore(a, b), stance: turnController.getStance(a, b) });
    }
  }

  return {
    turn: turnController.turn,
    tiles,
    factions: factions.map((f) => ({
      id: f.id,
      name: f.name,
      color: f.color,
      isPlayerControlled: f.isPlayerControlled,
      status: f.status,
      population: f.population,
      foodStockpile: f.foodStockpile,
      productionStockpile: f.productionStockpile,
      goldStockpile: f.goldStockpile,
      investRate: f.investRate,
      investment: f.investment,
      militaryStrength: turnController.getFactionMilitaryStrength(f.id),
    })),
    units: units.map((u) => ({ id: u.id, factionId: u.factionId, coordinate: { x: u.coordinate.x, y: u.coordinate.y } })),
    diplomacy,
    aiLog: turnController.lastAI.map((a) => a.description),
    movementLog: turnController.lastMovement.map((m) => ({ factionId: m.unit.factionId, to: { x: m.to.x, y: m.to.y } })),
    combatLog: turnController.lastCombat.map((c) => ({
      winnerFactionId: c.winner.factionId,
      winnerStrength: c.winner.strength,
      loserFactionId: c.loser.factionId,
      at: { x: c.loser.coordinate.x, y: c.loser.coordinate.y },
    })),
  };
}
