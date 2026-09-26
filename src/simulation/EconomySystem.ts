import { Faction, FactionStatus } from "./Faction";
import type { TerritoryIndex } from "./TerritoryIndex";

const SUBSIST = 0.5; // food eaten per citizen per turn
const GROWTH = 0.08; // max population growth rate per turn
const TFP_SCALE = 2000; // investment needed to meaningfully raise productivity
const DENSITY = 25; // physical citizens-per-tile cap
const TRADE = 0.05; // per-capita commerce term (not land-constrained, unlike food/production)
const MAX_FAMINE_RATE = 0.1; // population can lose at most 10%/turn to starvation

// Auto-expansion: price scales with territory already held (linear, not
// flat), which is what makes growth self-limiting - a large empire expands
// at the same rate as a small one, so land gets steadily more expensive
// per-capita rather than compounding. The coefficient (0.75) equals the
// model's peak per-tile food surplus, chosen so the claim rate approaches
// (never exceeds) about 1 tile/turn while a faction is well below carrying
// capacity, and decays toward 0 as population approaches capacity - the
// same food that feeds citizens is what buys land, so both stay relevant
// for the whole game instead of food going dead once growth plateaus.
const EXPANSION_BASE_COST = 8;
const EXPANSION_COST_PER_TILE = 0.75;

export interface EconomyOutputs {
  A: number;
  foodOut: number;
  prodOut: number;
  goldOut: number;
}

// Malthus-Boserup-Smith growth: a Cobb-Douglas subsistence ceiling (Malthus)
// escaped by investment-driven total factor productivity (Boserup/Solow),
// plus a population-linear commerce term (Smith) so gold isn't land-capped
// the way food/production are. Replaces the old flat "10*population" food
// bin, which had no relationship between territory size and output at all.
export class EconomySystem {
  // Exposed separately (not just inlined in tick()) so the UI can preview
  // "what would this turn produce at my current investRate" without
  // duplicating the formulas or needing to actually advance the simulation.
  computeOutputs(faction: Faction, totals: ReturnType<TerritoryIndex["getTotals"]>): EconomyOutputs {
    const { Fraw, Praw, Graw } = totals;
    const A = 1 + Math.log(1 + faction.investment / TFP_SCALE);
    const pop = faction.population;
    return {
      A,
      foodOut: A * Math.sqrt(Math.max(0, pop * Fraw)),
      prodOut: A * Math.sqrt(Math.max(0, pop * Praw)),
      goldOut: A * (Math.sqrt(Math.max(0, pop * Graw)) + TRADE * pop),
    };
  }

  tick(factions: Faction[], index: TerritoryIndex): void {
    for (const faction of factions) {
      if (faction.status === FactionStatus.Eliminated) continue;

      const totals = index.getTotals(faction.id);
      const { Fraw, tileCount } = totals;
      const pop = faction.population;
      const { A, foodOut, prodOut, goldOut } = this.computeOutputs(faction, totals);

      const Kfood = 4 * A * A * Fraw;
      const K = tileCount > 0 ? Math.min(Kfood, DENSITY * tileCount) : 0;

      const surplus = foodOut - SUBSIST * pop;
      let starved = false;
      if (surplus >= 0) {
        faction.foodStockpile = Math.min(faction.foodStockpile + surplus, 10 * pop);
      } else {
        faction.foodStockpile += surplus;
        if (faction.foodStockpile < 0) {
          const deficit = -faction.foodStockpile;
          const famineRate = Math.min(deficit / Math.max(pop, 0.01), MAX_FAMINE_RATE);
          faction.population = Math.max(0, pop * (1 - famineRate));
          faction.foodStockpile = 0;
          starved = true;
        }
      }

      if (!starved) {
        const growth = K > 0 ? GROWTH * (1 - faction.population / K) : -0.1;
        faction.population = Math.max(0, faction.population * (1 + Math.max(growth, -0.1)));
      }

      if (faction.population < 1) faction.population = 0;

      const invested = faction.investRate * (prodOut + goldOut);
      faction.investment += invested;
      faction.productionStockpile += prodOut * (1 - faction.investRate);
      faction.goldStockpile += goldOut * (1 - faction.investRate);

      this.tryAutoExpand(faction, totals);

      if (faction.status === FactionStatus.Active && totals.tileCount === 0) {
        faction.status = FactionStatus.Dormant;
      }
    }
  }

  private tryAutoExpand(faction: Faction, totals: ReturnType<TerritoryIndex["getTotals"]>): void {
    if (!totals.bestFrontierTile) return;
    const cost = EXPANSION_BASE_COST + EXPANSION_COST_PER_TILE * totals.tileCount;
    if (faction.foodStockpile < cost) return;

    faction.foodStockpile -= cost;
    totals.bestFrontierTile.ownerFactionId = faction.id;
  }
}
