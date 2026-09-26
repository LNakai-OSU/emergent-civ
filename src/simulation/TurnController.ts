import type { WorldGrid } from "./WorldGrid";
import { Faction, FactionStatus } from "./Faction";
import type { Coordinate } from "./Tile";
import { Unit } from "./Unit";
import { EconomySystem, type EconomyOutputs } from "./EconomySystem";
import { MilitarySystem, type CombatResult } from "./MilitarySystem";
import { DiplomacySystem, type DiplomaticStance } from "./DiplomacySystem";
import { MovementSystem, type MovementEvent } from "./MovementSystem";
import { AISystem, type AIActionLog } from "./AISystem";
import { TerritoryIndex } from "./TerritoryIndex";
import type { UnitTypeData } from "../data/UnitTypeData";
import type { BuildingTypeData } from "../data/BuildingTypeData";
import type { TechTypeData } from "../data/TechTypeData";

const DORMANT_TURNS_UNTIL_ELIMINATED = 15;

// The one unit of simulation progress, deliberately decoupled from how it's
// invoked - a UI button calls advanceTurn() now, but a real-time clock could
// call it on a timer later with no changes needed here or in the systems.
//
// Order: build a territory index -> AI decisions -> movement -> combat
// (which resolves conquest) -> faction lifecycle -> rebuild the index ->
// economy -> diplomacy last. Units must move into contact before combat can
// trigger; diplomacy runs last so the strength delta it measures already
// spans this turn's builds and combat losses, and so a battle's score
// penalty applies the same turn it happens with no event queue needed. The
// index is rebuilt after combat/lifecycle so economy and diplomacy both see
// this turn's conquered/lost territory, not last turn's.
export class TurnController {
  private readonly grid: WorldGrid;
  private readonly factions: Faction[];
  private readonly units: Unit[];
  private readonly economy: EconomySystem;
  private readonly military: MilitarySystem;
  private readonly diplomacy: DiplomacySystem;
  private readonly movement: MovementSystem;
  private readonly ai: AISystem;

  private currentTurn = 0;
  private lastCombatResults: CombatResult[] = [];
  private lastMovementEvents: MovementEvent[] = [];
  private lastAIActions: AIActionLog[] = [];
  // Starts well above any hand-created demo unit ids (0, 1, ...) so AI-built
  // and player-built units can never collide - this is the single source of
  // unit ids for both.
  private nextUnitId = 1000;

  constructor(
    grid: WorldGrid,
    factions: Faction[],
    units: Unit[],
    economy: EconomySystem = new EconomySystem(),
    military: MilitarySystem = new MilitarySystem(),
    diplomacy: DiplomacySystem = new DiplomacySystem(),
    movement: MovementSystem = new MovementSystem(),
    ai: AISystem = new AISystem(),
  ) {
    this.grid = grid;
    this.factions = factions;
    this.units = units;
    this.economy = economy;
    this.military = military;
    this.diplomacy = diplomacy;
    this.movement = movement;
    this.ai = ai;
  }

  get turn(): number {
    return this.currentTurn;
  }

  get lastCombat(): readonly CombatResult[] {
    return this.lastCombatResults;
  }

  get lastMovement(): readonly MovementEvent[] {
    return this.lastMovementEvents;
  }

  get lastAI(): readonly AIActionLog[] {
    return this.lastAIActions;
  }

  private allocateUnitId = (): number => this.nextUnitId++;

  advanceTurn(): void {
    const preIndex = new TerritoryIndex(this.grid);

    const aiActions = this.ai.tick(
      this.grid,
      this.factions,
      this.units,
      this.diplomacy,
      this.military,
      this.movement,
      preIndex,
      this.currentTurn,
      this.allocateUnitId,
    );

    this.lastMovementEvents = this.movement.tick(this.grid, this.units);
    this.lastCombatResults = this.military.tick(this.grid, this.units, this.factions, this.diplomacy);
    for (const result of this.lastCombatResults) {
      this.diplomacy.recordConflict(result.winner.factionId, result.loser.factionId);
    }

    const refoundActions = this.ai.refoundDormantFactions(this.grid, this.factions, this.units);
    this.updateFactionLifecycle();

    this.lastAIActions = [...aiActions, ...refoundActions];

    const postIndex = new TerritoryIndex(this.grid);
    this.economy.tick(this.factions, postIndex);
    this.diplomacy.tick(this.factions, this.units, this.military, postIndex);

    this.currentTurn += 1;
  }

  // Dormant (0 tiles) is set inside EconomySystem, since it already knows
  // tile counts. Eliminated only follows once a dormant faction has also
  // had no units for a sustained stretch, which needs unit data EconomySystem
  // doesn't have - handled here instead.
  private updateFactionLifecycle(): void {
    for (const faction of this.factions) {
      if (faction.status !== FactionStatus.Dormant) {
        faction.dormantTurns = 0;
        continue;
      }
      const hasUnits = this.units.some((u) => u.factionId === faction.id);
      if (hasUnits) {
        faction.dormantTurns = 0;
        continue;
      }
      faction.dormantTurns += 1;
      if (faction.dormantTurns >= DORMANT_TURNS_UNTIL_ELIMINATED) {
        faction.status = FactionStatus.Eliminated;
      }
    }
  }

  getFactionMilitaryStrength(factionId: number): number {
    return this.military.getFactionStrength(factionId, this.units);
  }

  issueMoveOrder(unit: Unit, destination: Coordinate): boolean {
    return this.movement.issueMoveOrder(unit, this.grid, destination);
  }

  declareWar(a: number, b: number): void {
    this.diplomacy.declareWar(a, b);
  }

  makePeace(a: number, b: number): void {
    this.diplomacy.makePeace(a, b, this.currentTurn);
  }

  getStance(a: number, b: number): DiplomaticStance {
    return this.diplomacy.getStance(a, b);
  }

  getRelationshipScore(a: number, b: number): number {
    return this.diplomacy.getScore(a, b);
  }

  getRivalry(a: number, b: number): number {
    return this.diplomacy.getRivalry(a, b);
  }

  setInvestRate(factionId: number, rate: number): void {
    const faction = this.factions.find((f) => f.id === factionId);
    if (faction) faction.investRate = Math.max(0, Math.min(1, rate));
  }

  // Lets the UI show "at your current investment rate, this is what you'd
  // bank vs. invest this turn" without needing to actually advance the
  // simulation - the investRate slider is otherwise easy to set-and-forget.
  previewEconomy(factionId: number): EconomyOutputs | null {
    const faction = this.factions.find((f) => f.id === factionId);
    if (!faction) return null;
    const index = new TerritoryIndex(this.grid);
    return this.economy.computeOutputs(faction, index.getTotals(factionId));
  }

  // Same adjacency rule the old Expand action used (auto-expansion in
  // EconomySystem now uses the equivalent best-yield rule automatically) -
  // exposed as a free, instant player action so clicking to grow territory
  // stays simple, on top of (not instead of) the automatic food-funded
  // expansion every faction also gets each turn.
  claimTile(factionId: number, coordinate: Coordinate): boolean {
    const tile = this.grid.tryGetTile(coordinate);
    if (!tile || !tile.isUnclaimed) return false;
    if (tile.terrain.movementCost >= 90) return false; // don't claim impassable water

    const isAdjacentToOwnTerritory = [...this.grid.getNeighbors(coordinate)].some(
      (neighbor) => neighbor.ownerFactionId === factionId,
    );
    if (!isAdjacentToOwnTerritory) return false;

    tile.ownerFactionId = factionId;
    return true;
  }

  buildUnit(factionId: number, atCoordinate: Coordinate, unitType: UnitTypeData): boolean {
    const faction = this.factions.find((f) => f.id === factionId);
    const tile = this.grid.tryGetTile(atCoordinate);
    if (!faction || !tile || tile.ownerFactionId !== factionId) return false;
    if (!this.hasTech(faction, unitType.requiresTechId)) return false;
    if (faction.productionStockpile < unitType.productionCost) return false;

    faction.productionStockpile -= unitType.productionCost;
    this.units.push(new Unit(this.allocateUnitId(), factionId, unitType, atCoordinate));
    return true;
  }

  buildBuilding(factionId: number, atCoordinate: Coordinate, buildingType: BuildingTypeData): boolean {
    const faction = this.factions.find((f) => f.id === factionId);
    const tile = this.grid.tryGetTile(atCoordinate);
    if (!faction || !tile || tile.ownerFactionId !== factionId || tile.building) return false;
    if (!this.hasTech(faction, buildingType.requiresTechId)) return false;
    if (faction.productionStockpile < buildingType.productionCost) return false;

    faction.productionStockpile -= buildingType.productionCost;
    tile.building = buildingType;
    return true;
  }

  researchTech(factionId: number, tech: TechTypeData): boolean {
    const faction = this.factions.find((f) => f.id === factionId);
    if (!faction || faction.researchedTechIds.has(tech.id)) return false;
    if (faction.productionStockpile < tech.productionCost) return false;

    faction.productionStockpile -= tech.productionCost;
    faction.researchedTechIds.add(tech.id);
    return true;
  }

  private hasTech(faction: Faction, requiresTechId: string | null): boolean {
    return !requiresTechId || faction.researchedTechIds.has(requiresTechId);
  }
}
