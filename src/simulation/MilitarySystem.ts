import type { WorldGrid } from "./WorldGrid";
import { Unit } from "./Unit";
import type { Tile, Coordinate } from "./Tile";
import type { Faction } from "./Faction";
import type { DiplomacySystem } from "./DiplomacySystem";

export interface CombatResult {
  winner: Unit;
  loser: Unit;
}

const OCCUPATION_THRESHOLD = 4; // consecutive turns a lone enemy unit must hold an undefended tile
const UNREST_DURATION = 25; // turns a freshly-conquered tile yields at half rate

function coordKey(c: Coordinate): string {
  return `${c.x},${c.y}`;
}

function parseKey(key: string): Coordinate {
  const [x, y] = key.split(",").map(Number);
  return { x, y };
}

function coordEquals(a: Coordinate, b: Coordinate): boolean {
  return a.x === b.x && a.y === b.y;
}

function terrainDefenseBonus(movementCost: number): number {
  return Math.max(0, movementCost - 1);
}

function tileTotalYield(tile: Tile): number {
  const building = tile.building;
  return (
    tile.terrain.foodYield +
    tile.terrain.productionYield +
    tile.terrain.goldYield +
    (building ? building.foodBonus + building.productionBonus + building.goldBonus : 0)
  );
}

// Combat resolution, plus the conquest consequences of it: a defeated
// garrison's tile falls immediately (path 1); an undefended tile falls
// after OCCUPATION_THRESHOLD turns of lone enemy presence (path 2); a
// faction's capital cannot fall outright while it still has population -
// taking it instead sacks a share of their remaining territory and
// relocates their capital. Newly conquered tiles run at half yield for
// UNREST_DURATION turns.
export class MilitarySystem {
  private readonly occupiedTiles = new Set<Tile>();
  private readonly unrestTiles = new Set<Tile>();

  // Probabilistic rather than "bigger number always wins" - occasional
  // underdog victories are part of what keeps outcomes feeling emergent
  // instead of perfectly predictable.
  resolveCombat(
    attacker: Unit,
    defender: Unit,
    grid: WorldGrid,
    random: () => number = Math.random,
  ): CombatResult {
    const defenseBonus = terrainDefenseBonus(grid.getTile(defender.coordinate).terrain.movementCost);
    const effectiveDefense = defender.strength + defenseBonus;
    const attackerWinChance = attacker.strength / (attacker.strength + effectiveDefense);

    return random() < attackerWinChance
      ? { winner: attacker, loser: defender }
      : { winner: defender, loser: attacker };
  }

  getFactionStrength(factionId: number, units: Iterable<Unit>): number {
    let total = 0;
    for (const unit of units) {
      if (unit.factionId === factionId) total += unit.strength;
    }
    return total;
  }

  // Auto-resolves combat for any tile occupied by units from factions
  // currently at War with each other - factions at Peace can share a tile
  // without fighting. With 3+ factions on one tile, resolution is a
  // sequential king-of-the-hill elimination rather than a true free-for-all
  // - an acceptable simplification until real orders exist.
  tick(
    grid: WorldGrid,
    units: Unit[],
    factions: Faction[],
    diplomacy: DiplomacySystem,
    random: () => number = Math.random,
  ): CombatResult[] {
    const byTile = new Map<string, Unit[]>();
    for (const unit of units) {
      const key = coordKey(unit.coordinate);
      const group = byTile.get(key);
      if (group) group.push(unit);
      else byTile.set(key, [unit]);
    }

    const results: CombatResult[] = [];
    const defeated = new Set<Unit>();
    const finalSurvivorByTile = new Map<string, Unit>();

    for (const [key, group] of byTile) {
      if (new Set(group.map((u) => u.factionId)).size < 2) continue;

      let survivor = group[0];
      for (const contender of group.slice(1)) {
        if (survivor.factionId === contender.factionId) continue;
        if (!diplomacy.areAtWar(survivor.factionId, contender.factionId)) continue;
        const result = this.resolveCombat(survivor, contender, grid, random);
        results.push(result);
        defeated.add(result.loser);
        survivor = result.winner;
      }
      finalSurvivorByTile.set(key, survivor);
    }

    if (defeated.size > 0) {
      const remaining = units.filter((u) => !defeated.has(u));
      units.length = 0;
      units.push(...remaining);
    }

    // Territorial consequences use the FINAL survivor of each tile's fight,
    // not each intermediate result - a winner who flips a tile could
    // otherwise be killed two lines later in the same king-of-hill loop.
    // Also guards against a third faction's tile flipping from an A-vs-B
    // fight that doesn't involve its owner.
    for (const [key, survivor] of finalSurvivorByTile) {
      const tile = grid.getTile(parseKey(key));
      if (tile.isUnclaimed) continue;
      if (tile.ownerFactionId === survivor.factionId) continue;
      if (!diplomacy.areAtWar(survivor.factionId, tile.ownerFactionId)) continue;
      this.captureTile(tile, survivor.factionId, factions, grid);
    }

    this.updateOccupation(grid, units, factions, diplomacy);
    this.decayUnrest();

    return results;
  }

  private updateOccupation(grid: WorldGrid, units: Unit[], factions: Faction[], diplomacy: DiplomacySystem): void {
    const byTile = new Map<string, Unit[]>();
    for (const unit of units) {
      const key = coordKey(unit.coordinate);
      const group = byTile.get(key);
      if (group) group.push(unit);
      else byTile.set(key, [unit]);
    }

    for (const [key, group] of byTile) {
      const tile = grid.getTile(parseKey(key));
      if (tile.isUnclaimed) continue;

      const factionsPresent = new Set(group.map((u) => u.factionId));
      const soleFactionId = factionsPresent.size === 1 ? group[0].factionId : null;
      const qualifies =
        soleFactionId != null &&
        soleFactionId !== tile.ownerFactionId &&
        diplomacy.areAtWar(soleFactionId, tile.ownerFactionId);

      if (qualifies) {
        tile.occupationTurns += 1;
        this.occupiedTiles.add(tile);
        if (tile.occupationTurns >= OCCUPATION_THRESHOLD) {
          this.captureTile(tile, soleFactionId, factions, grid);
        }
      } else if (tile.occupationTurns > 0) {
        tile.occupationTurns = 0;
        this.occupiedTiles.delete(tile);
      }
    }

    // A tile we were tracking as occupied that no longer has any units at
    // all (the occupier left) resets too.
    for (const tile of this.occupiedTiles) {
      if (!byTile.has(coordKey(tile.coordinate))) {
        tile.occupationTurns = 0;
        this.occupiedTiles.delete(tile);
      }
    }
  }

  private decayUnrest(): void {
    for (const tile of this.unrestTiles) {
      tile.unrestTurns -= 1;
      if (tile.unrestTurns <= 0) {
        tile.unrestTurns = 0;
        this.unrestTiles.delete(tile);
      }
    }
  }

  private captureTile(tile: Tile, newOwnerId: number, factions: Faction[], grid: WorldGrid): void {
    const loser = factions.find((f) => f.id === tile.ownerFactionId);
    const isCapital = loser?.capital != null && coordEquals(loser.capital, tile.coordinate);

    if (loser && isCapital && loser.population >= 1) {
      this.sackCapital(loser, newOwnerId, grid);
      return;
    }

    tile.ownerFactionId = newOwnerId;
    tile.occupationTurns = 0;
    this.occupiedTiles.delete(tile);
    tile.unrestTurns = UNREST_DURATION;
    this.unrestTiles.add(tile);

    // The tile that just flipped was this faction's capital (only reachable
    // once their population has already hit 0) - give them a new one among
    // whatever they still hold, if anything.
    if (loser && isCapital) this.relocateCapital(loser, grid);
  }

  // A faction's capital can't be captured outright while it still has
  // population - taking it instead cedes a share of their other territory
  // (BFS outward from the capital, nearest-first, excluding the capital
  // tile itself) and relocates their capital. If they hold nothing else,
  // the assault instead costs them population directly. Repeated sacks
  // eventually leave a faction with only its capital and 0 population,
  // at which point the normal capture path above finally takes it.
  private sackCapital(loser: Faction, winnerId: number, grid: WorldGrid): void {
    const capital = loser.capital!;
    const ownedElsewhere = this.bfsOwnedTiles(grid, capital, loser.id);

    if (ownedElsewhere.length === 0) {
      loser.population = Math.max(0, loser.population * 0.75);
      return;
    }

    const tilesBefore = ownedElsewhere.length + 1;
    const cedeCount = Math.max(1, Math.floor(0.4 * ownedElsewhere.length));
    const ceded = ownedElsewhere.slice(0, cedeCount);

    for (const tile of ceded) {
      tile.ownerFactionId = winnerId;
      tile.occupationTurns = 0;
      this.occupiedTiles.delete(tile);
      tile.unrestTurns = UNREST_DURATION;
      this.unrestTiles.add(tile);
    }

    const tilesAfter = tilesBefore - cedeCount;
    loser.population = Math.max(0, loser.population * (tilesAfter / tilesBefore));

    this.relocateCapital(loser, grid);
  }

  private relocateCapital(faction: Faction, grid: WorldGrid): void {
    let bestTile: Tile | null = null;
    let bestYield = -Infinity;
    for (const tile of grid.allTiles()) {
      if (tile.ownerFactionId !== faction.id) continue;
      const y = tileTotalYield(tile);
      if (y > bestYield) {
        bestYield = y;
        bestTile = tile;
      }
    }
    faction.capital = bestTile ? bestTile.coordinate : null;
  }

  // BFS outward from `from` through tiles owned by `factionId`, excluding
  // `from` itself - used to find a capital's contiguous hinterland.
  private bfsOwnedTiles(grid: WorldGrid, from: Coordinate, factionId: number): Tile[] {
    const visited = new Set<string>([coordKey(from)]);
    const queue: Coordinate[] = [from];
    const found: Tile[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const neighbor of grid.getNeighbors(current)) {
        const key = coordKey(neighbor.coordinate);
        if (visited.has(key)) continue;
        visited.add(key);
        if (neighbor.ownerFactionId === factionId) {
          found.push(neighbor);
          queue.push(neighbor.coordinate);
        }
      }
    }

    return found;
  }
}
