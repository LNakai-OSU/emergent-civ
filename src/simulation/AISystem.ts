import type { WorldGrid } from "./WorldGrid";
import type { Coordinate } from "./Tile";
import { FactionStatus, type Faction } from "./Faction";
import { Unit } from "./Unit";
import type { MilitarySystem } from "./MilitarySystem";
import type { DiplomacySystem } from "./DiplomacySystem";
import type { MovementSystem } from "./MovementSystem";
import type { TerritoryIndex } from "./TerritoryIndex";
import { WARRIOR } from "../data/unitTypes";

// AISystem deliberately only ever builds the baseline Warrior - it doesn't
// research tech or use buildings yet. Extending it to use new content is a
// reasonable follow-up, not done here since it wasn't asked for. Expansion
// is no longer an AI-chosen action - it's automatic and food-funded in
// EconomySystem for every faction, which frees this action slot for
// military/diplomacy and fixes a real deadlock where Expand always
// outscored everything else at map scale.
const WAR_SCORE_THRESHOLD = -30;
const WAR_DOMINANCE_RELADV = 0.6; // opportunistic: attack when this dominant
const WAR_CLOSING_RELADV = 0.5;
const WAR_CLOSING_WINDOW = 0.01;
const WAR_CLOSING_SCORE = -35;
const RIVALRY_THRESHOLD = 20;
const RIVALRY_RELADV = 0.5;
const PEACE_RELADV = 0.45; // capitulate when this outmatched
const PEACE_STALEMATE_MIN_WARTURNS = 10;
const PEACE_STALEMATE_BAND = 0.05; // relAdv within 0.45-0.55 counts as a stalemate

export interface AIActionLog {
  factionId: number;
  description: string;
}

interface Candidate {
  utility: number;
  description: string;
  execute: () => void;
}

// One AI-controlled faction's turn: score a handful of candidate actions
// against current Economy/Military/Diplomacy state, then execute only the
// single highest-scoring one. Deliberately not scripted - no "if turn 20 do
// X" - every decision reads live state, which is what should let outcomes
// vary across different maps and situations instead of always playing out
// the same way.
export class AISystem {
  tick(
    grid: WorldGrid,
    factions: Faction[],
    units: Unit[],
    diplomacy: DiplomacySystem,
    military: MilitarySystem,
    movement: MovementSystem,
    index: TerritoryIndex,
    turn: number,
    allocateUnitId: () => number,
  ): AIActionLog[] {
    const log: AIActionLog[] = [];

    for (const faction of factions) {
      if (faction.isPlayerControlled) continue;
      if (faction.status !== FactionStatus.Active) continue;

      this.updateInvestRate(faction, factions, units, diplomacy, military);

      const candidates: Candidate[] = [];

      this.addBuildUnitCandidate(candidates, faction, units, military, index, allocateUnitId);
      this.addAttackCandidates(candidates, grid, faction, units, diplomacy, military, movement, index);
      this.addDiplomacyCandidates(candidates, faction, factions, diplomacy, turn);

      if (candidates.length === 0) continue;

      candidates.sort((a, b) => b.utility - a.utility);
      const best = candidates[0];
      if (best.utility <= 0) continue;

      best.execute();
      log.push({ factionId: faction.id, description: best.description });
    }

    return log;
  }

  // Free (doesn't compete for the action slot): builds up economy while
  // safe, pulls back toward military spending when at war or outmatched.
  private updateInvestRate(
    faction: Faction,
    factions: Faction[],
    units: Unit[],
    diplomacy: DiplomacySystem,
    military: MilitarySystem,
  ): void {
    const atWarWithAnyone = factions.some((other) => other.id !== faction.id && diplomacy.areAtWar(faction.id, other.id));
    if (atWarWithAnyone) {
      faction.investRate = 0.1;
      return;
    }
    const myStrength = military.getFactionStrength(faction.id, units);
    const strongestRival = this.strongestRivalStrength(faction.id, units, military);
    faction.investRate = strongestRival > 1.2 * myStrength ? 0.2 : 0.4;
  }

  private addBuildUnitCandidate(
    candidates: Candidate[],
    faction: Faction,
    units: Unit[],
    military: MilitarySystem,
    index: TerritoryIndex,
    allocateUnitId: () => number,
  ): void {
    if (faction.productionStockpile < WARRIOR.productionCost) return;

    const homeTile = index.getTotals(faction.id).homeTile;
    if (!homeTile) return;

    const myStrength = military.getFactionStrength(faction.id, units);
    const strongestRival = this.strongestRivalStrength(faction.id, units, military);
    const urgency = strongestRival === 0 ? 0 : Math.max(0, 1 - myStrength / (myStrength + strongestRival));

    candidates.push({
      utility: 0.3 + urgency * 0.5,
      description: `${faction.name} built a new unit at (${homeTile.coordinate.x}, ${homeTile.coordinate.y})`,
      execute: () => {
        faction.productionStockpile -= WARRIOR.productionCost;
        units.push(new Unit(allocateUnitId(), faction.id, WARRIOR, homeTile.coordinate));
      },
    });
  }

  private addAttackCandidates(
    candidates: Candidate[],
    grid: WorldGrid,
    faction: Faction,
    units: Unit[],
    diplomacy: DiplomacySystem,
    military: MilitarySystem,
    movement: MovementSystem,
    index: TerritoryIndex,
  ): void {
    const idleUnits = units.filter(
      (u) => u.factionId === faction.id && !u.order && !this.isOnStation(u, grid, diplomacy),
    );
    if (idleUnits.length === 0) return;

    const enemyFactionIds = new Set<number>();
    for (const unit of units) {
      if (unit.factionId !== faction.id && diplomacy.areAtWar(faction.id, unit.factionId)) {
        enemyFactionIds.add(unit.factionId);
      }
    }
    if (enemyFactionIds.size === 0) return;

    const myStrength = military.getFactionStrength(faction.id, units);
    const enemyUnits = units.filter((u) => enemyFactionIds.has(u.factionId));

    for (const unit of idleUnits) {
      let target: Coordinate | null = null;
      let targetFactionId: number | null = null;

      const nearestEnemyUnit = this.nearestUnit(unit, enemyUnits);
      if (nearestEnemyUnit) {
        target = nearestEnemyUnit.coordinate;
        targetFactionId = nearestEnemyUnit.factionId;
      } else {
        // No enemy units anywhere - fall back to marching on their
        // territory instead. This was a real bug: without this fallback, a
        // faction that goes pure-economy with zero army was invisible to
        // Attack, making all-in investment risk-free regardless of war.
        let bestDist = Infinity;
        for (const enemyId of enemyFactionIds) {
          const homeTile = index.getTotals(enemyId).homeTile;
          if (!homeTile) continue;
          const dist =
            Math.abs(homeTile.coordinate.x - unit.coordinate.x) + Math.abs(homeTile.coordinate.y - unit.coordinate.y);
          if (dist < bestDist) {
            bestDist = dist;
            target = homeTile.coordinate;
            targetFactionId = enemyId;
          }
        }
      }

      if (!target || targetFactionId == null) continue;

      const enemyStrength = military.getFactionStrength(targetFactionId, units);
      const advantage = myStrength / (myStrength + enemyStrength) - 0.5;
      // Combat is probabilistic, not certain death at slight disadvantage,
      // so allow near-parity fights through rather than requiring a clear
      // edge - found during implementation that requiring advantage>0
      // meant two evenly-matched factions at war (advantage exactly 0)
      // never generated an Attack candidate at all, on top of a separate
      // utility-competition issue with Build Unit (see below).
      if (advantage < -0.2) continue;

      // Once at war, pursuing it should generally outweigh yet more
      // peacetime buildup - without this, Attack's utility (~0.4 at parity)
      // consistently lost to Build Unit's (up to ~0.55), and armies at war
      // just kept building forever without ever actually marching.
      const baseUtility = 0.6;
      candidates.push({
        utility: baseUtility + advantage * 2,
        description: `${faction.name} ordered a unit to attack toward (${target.x}, ${target.y})`,
        execute: () => {
          movement.issueMoveOrder(unit, grid, target!);
        },
      });
    }
  }

  // A unit standing on enemy territory while at war with its owner is
  // besieging/garrisoning that tile - excluding it from idle-unit
  // reassignment is what makes occupation (MilitarySystem's undefended-tile
  // capture, and the siege that can eventually famine-eliminate a faction)
  // actually hold rather than the unit being immediately handed a fresh
  // attack order and walking off.
  private isOnStation(unit: Unit, grid: WorldGrid, diplomacy: DiplomacySystem): boolean {
    const tile = grid.tryGetTile(unit.coordinate);
    if (!tile || tile.isUnclaimed) return false;
    return tile.ownerFactionId !== unit.factionId && diplomacy.areAtWar(unit.factionId, tile.ownerFactionId);
  }

  private addDiplomacyCandidates(
    candidates: Candidate[],
    faction: Faction,
    factions: Faction[],
    diplomacy: DiplomacySystem,
    turn: number,
  ): void {
    for (const other of factions) {
      if (other.id === faction.id) continue;
      const atWar = diplomacy.areAtWar(faction.id, other.id);
      const { relAdv, window } = diplomacy.getRelAdvWindow(faction.id, other.id);

      if (!atWar) {
        if (diplomacy.isTruced(faction.id, other.id, turn)) continue;
        const score = diplomacy.getScore(faction.id, other.id);
        const rivalry = diplomacy.getRivalry(faction.id, other.id);

        const dominant = relAdv >= WAR_DOMINANCE_RELADV;
        const closingWindow = relAdv >= WAR_CLOSING_RELADV && window >= WAR_CLOSING_WINDOW && score <= WAR_CLOSING_SCORE;
        const enduringRivalry = rivalry >= RIVALRY_THRESHOLD && relAdv >= RIVALRY_RELADV;

        if (score <= WAR_SCORE_THRESHOLD && (dominant || closingWindow || enduringRivalry)) {
          // The rivalry valve exists specifically to force an eventual
          // release for stalemated pairs (verified: rivalry can climb into
          // the hundreds between evenly-matched neighbors) - found during
          // implementation that a flat 0.5 utility let "Build Unit" (which
          // stays competitively high, ~0.55, whenever forces are balanced)
          // permanently outscore it, so the valve never actually fired
          // despite its trigger condition being true for hundreds of turns.
          candidates.push({
            utility: enduringRivalry ? 0.9 : 0.5,
            description: `${faction.name} declared war on ${other.name}`,
            execute: () => diplomacy.declareWar(faction.id, other.id),
          });
        }
      } else {
        const warTurns = diplomacy.getWarTurns(faction.id, other.id);
        const battles = diplomacy.getBattlesThisWar(faction.id, other.id);
        if (warTurns < 3 || battles < 2) continue;

        const capitulating = relAdv <= PEACE_RELADV;
        const stalemate = warTurns >= PEACE_STALEMATE_MIN_WARTURNS && Math.abs(relAdv - 0.5) <= PEACE_STALEMATE_BAND;

        if (capitulating || stalemate) {
          candidates.push({
            utility: 0.7,
            description: `${faction.name} sued for peace with ${other.name}`,
            execute: () => diplomacy.makePeace(faction.id, other.id, turn),
          });
        }
      }
    }
  }

  // A dormant faction has no economy or build/attack options (0 tiles), so
  // this runs unconditionally rather than competing for the action slot:
  // any of its surviving units standing on an unclaimed, passable tile
  // immediately founds a new capital there.
  refoundDormantFactions(grid: WorldGrid, factions: Faction[], units: Unit[]): AIActionLog[] {
    const log: AIActionLog[] = [];
    for (const faction of factions) {
      if (faction.status !== FactionStatus.Dormant) continue;
      const unit = units.find((u) => u.factionId === faction.id);
      if (!unit) continue;

      const tile = grid.tryGetTile(unit.coordinate);
      if (!tile || !tile.isUnclaimed || tile.terrain.movementCost >= 90) continue;

      tile.ownerFactionId = faction.id;
      faction.capital = tile.coordinate;
      faction.status = FactionStatus.Active;
      faction.dormantTurns = 0;
      log.push({ factionId: faction.id, description: `${faction.name} refounded their civilization at (${tile.coordinate.x}, ${tile.coordinate.y})` });
    }
    return log;
  }

  private strongestRivalStrength(factionId: number, units: Unit[], military: MilitarySystem): number {
    const rivalIds = new Set(units.filter((u) => u.factionId !== factionId).map((u) => u.factionId));
    let strongest = 0;
    for (const id of rivalIds) {
      strongest = Math.max(strongest, military.getFactionStrength(id, units));
    }
    return strongest;
  }

  private nearestUnit(from: Unit, candidates: Unit[]): Unit | null {
    let nearest: Unit | null = null;
    let bestDist = Infinity;
    for (const candidate of candidates) {
      const dist =
        Math.abs(candidate.coordinate.x - from.coordinate.x) + Math.abs(candidate.coordinate.y - from.coordinate.y);
      if (dist < bestDist) {
        bestDist = dist;
        nearest = candidate;
      }
    }
    return nearest;
  }
}
