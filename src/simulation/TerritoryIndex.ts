import type { WorldGrid } from "./WorldGrid";
import type { Tile } from "./Tile";

export interface FactionTotals {
  tileCount: number;
  Fraw: number;
  Praw: number;
  Graw: number;
  homeTile: Tile | null;
  bestFrontierTile: Tile | null;
  // Count of distinct unclaimed, passable tiles adjacent to this faction's
  // territory anywhere on the map. Used as a simplified stand-in for the
  // approved "openTiles per pair" lateral-pressure input: two factions'
  // shared frontier is treated as closing once EITHER side individually has
  // little open land left, rather than computing the exact geometry of
  // tiles near their specific shared border. Cheaper (one O(tiles) pass,
  // no per-pair tile walk) and still captures the "nowhere left to expand"
  // story the model is going for.
  openFrontierCount: number;
}

const EMPTY_TOTALS: FactionTotals = {
  tileCount: 0,
  Fraw: 0,
  Praw: 0,
  Graw: 0,
  homeTile: null,
  bestFrontierTile: null,
  openFrontierCount: 0,
};

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function tileYield(tile: Tile): number {
  const unrestFactor = tile.unrestTurns > 0 ? 0.5 : 1;
  return (tile.terrain.foodYield + tile.terrain.productionYield + tile.terrain.goldYield) * unrestFactor;
}

// One O(tiles) pass computing everything EconomySystem, DiplomacySystem, and
// AISystem need per turn - replacing what used to be a separate
// O(factions*tiles) scan in each of those systems. Built fresh from current
// grid state whenever a system needs up-to-date territory facts.
export class TerritoryIndex {
  private readonly totals = new Map<number, FactionTotals>();
  private readonly borderTiles = new Map<string, number>();

  constructor(grid: WorldGrid) {
    const seenFrontierTile = new Map<number, Set<string>>();

    for (const tile of grid.allTiles()) {
      if (tile.isUnclaimed) continue;

      const totals = this.getOrCreate(tile.ownerFactionId);
      const unrestFactor = tile.unrestTurns > 0 ? 0.5 : 1;
      totals.tileCount += 1;
      totals.Fraw += (tile.terrain.foodYield + (tile.building?.foodBonus ?? 0)) * unrestFactor;
      totals.Praw += (tile.terrain.productionYield + (tile.building?.productionBonus ?? 0)) * unrestFactor;
      totals.Graw += (tile.terrain.goldYield + (tile.building?.goldBonus ?? 0)) * unrestFactor;
      if (!totals.homeTile) totals.homeTile = tile;

      for (const neighbor of grid.getNeighbors(tile.coordinate)) {
        if (neighbor.isUnclaimed) {
          if (neighbor.terrain.movementCost >= 90) continue;

          if (!totals.bestFrontierTile || tileYield(neighbor) > tileYield(totals.bestFrontierTile)) {
            totals.bestFrontierTile = neighbor;
          }

          let seen = seenFrontierTile.get(tile.ownerFactionId);
          if (!seen) {
            seen = new Set();
            seenFrontierTile.set(tile.ownerFactionId, seen);
          }
          const key = `${neighbor.coordinate.x},${neighbor.coordinate.y}`;
          if (!seen.has(key)) {
            seen.add(key);
            totals.openFrontierCount += 1;
          }
        } else if (neighbor.ownerFactionId !== tile.ownerFactionId) {
          const key = pairKey(tile.ownerFactionId, neighbor.ownerFactionId);
          this.borderTiles.set(key, (this.borderTiles.get(key) ?? 0) + 1);
        }
      }
    }
  }

  getTotals(factionId: number): FactionTotals {
    return this.totals.get(factionId) ?? EMPTY_TOTALS;
  }

  getBorderTiles(a: number, b: number): number {
    return this.borderTiles.get(pairKey(a, b)) ?? 0;
  }

  private getOrCreate(factionId: number): FactionTotals {
    let totals = this.totals.get(factionId);
    if (!totals) {
      totals = { tileCount: 0, Fraw: 0, Praw: 0, Graw: 0, homeTile: null, bestFrontierTile: null, openFrontierCount: 0 };
      this.totals.set(factionId, totals);
    }
    return totals;
  }
}
