import type { Faction } from "./Faction";
import type { Unit } from "./Unit";
import type { MilitarySystem } from "./MilitarySystem";
import type { TerritoryIndex } from "./TerritoryIndex";

export const DiplomaticStance = {
  Peace: "peace",
  War: "war",
} as const;
export type DiplomaticStance = (typeof DiplomaticStance)[keyof typeof DiplomaticStance];

interface Relationship {
  score: number;
  stance: DiplomaticStance;
  peaceTurns: number;
  warTurns: number;
  truceUntil: number;
  rivalry: number;
  battlesThisWar: number;
  norm: number | null; // seeded lazily; only used in the 2-faction case
  relAdvHistory: number[];
}

const DEFAULT_SCORE = 0;
// Rescaled from the model's original abstract-example constants (floor 5,
// coefficient 50, divisor 0.06) once checked against this game's real
// numbers: WARRIOR.strength=5 exactly matched the original floor, pinning
// armsSpiral at its clamp from the very first unit anyone built. These
// values keep the term live across a realistic strength range instead of
// saturating immediately.
const STRENGTH_FLOOR = 25;
const ARMS_COEFFICIENT = 20;
const FRONTIER_COEFFICIENT = 3.5;
const DECAY_RATE = 0.035;
const CONFLICT_SCORE_PENALTY = 12;
const WAR_DECLARED_PENALTY = 10;
const WAR_DECLARED_BETRAYAL_PENALTY = 25; // applied instead, if score was still positive at declaration
const PEACE_TREATY_BONUS = 8;
const SETTLEMENT_FLOOR = -25; // applied on any treaty, so a settled dyad starts above the war gate
const TRUCE_DURATION = 12;

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function defaultRelationship(): Relationship {
  return {
    score: DEFAULT_SCORE,
    stance: DiplomaticStance.Peace,
    peaceTurns: 0,
    warTurns: 0,
    truceUntil: 0,
    rivalry: 0,
    battlesThisWar: 0,
    norm: null,
    relAdvHistory: [],
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Spiral-Exchange model with Lateral Pressure. Five real mechanisms:
// security dilemma (military buildup ABOVE a habituated norm breeds
// mistrust - Richardson's arms race, reference-dependent threat), social
// exchange (peaceful contact slowly builds trust - Gowa-Mansfield), balance
// of threat (weaker factions drift together against a dominant third party
// - Walt), forgiveness (score decays toward neutral over time - Axelrod),
// and lateral pressure (a closing, unclaimed frontier breeds tension
// regardless of military buildup - Choucri & North). The last one feeds an
// enduring-rivalry counter that eventually forces war even between
// perfectly evenly-matched neighbors whose military strength ratio never
// crosses the ordinary war thresholds - this is what makes "competition for
// adjacent tiles" (the original design's stated goal) actually do
// something, instead of score only ever moving after combat.
export class DiplomacySystem {
  private readonly relationships = new Map<string, Relationship>();

  private getOrCreate(a: number, b: number): Relationship {
    const key = pairKey(a, b);
    let relationship = this.relationships.get(key);
    if (!relationship) {
      relationship = defaultRelationship();
      this.relationships.set(key, relationship);
    }
    return relationship;
  }

  getStance(a: number, b: number): DiplomaticStance {
    if (a === b || a < 0 || b < 0) return DiplomaticStance.Peace;
    return this.getOrCreate(a, b).stance;
  }

  getScore(a: number, b: number): number {
    if (a === b) return 100;
    if (a < 0 || b < 0) return 0;
    return this.getOrCreate(a, b).score;
  }

  areAtWar(a: number, b: number): boolean {
    return this.getStance(a, b) === DiplomaticStance.War;
  }

  getRivalry(a: number, b: number): number {
    return this.getOrCreate(a, b).rivalry;
  }

  isTruced(a: number, b: number, turn: number): boolean {
    return turn < this.getOrCreate(a, b).truceUntil;
  }

  // relAdvHistory is always stored relative to min(a,b) internally (see
  // tick()); this flips the result to whichever faction the caller actually
  // asked about, so callers never need to know the internal convention.
  getRelAdvWindow(a: number, b: number): { relAdv: number; window: number } {
    const rel = this.getOrCreate(a, b);
    const relAdv = rel.relAdvHistory[rel.relAdvHistory.length - 1] ?? 0.5;
    const window = rel.relAdvHistory.length >= 5 ? rel.relAdvHistory[0] - relAdv : 0;
    return a <= b ? { relAdv, window } : { relAdv: 1 - relAdv, window: -window };
  }

  getWarTurns(a: number, b: number): number {
    return this.getOrCreate(a, b).warTurns;
  }

  getBattlesThisWar(a: number, b: number): number {
    return this.getOrCreate(a, b).battlesThisWar;
  }

  declareWar(a: number, b: number): void {
    const rel = this.getOrCreate(a, b);
    rel.score = Math.max(-100, rel.score - (rel.score > 0 ? WAR_DECLARED_BETRAYAL_PENALTY : WAR_DECLARED_PENALTY));
    rel.stance = DiplomaticStance.War;
    rel.warTurns = 0;
    rel.battlesThisWar = 0;
    rel.rivalry = 0;
  }

  makePeace(a: number, b: number, turn: number): void {
    const rel = this.getOrCreate(a, b);
    rel.score = Math.max(rel.score + PEACE_TREATY_BONUS, SETTLEMENT_FLOOR);
    rel.stance = DiplomaticStance.Peace;
    rel.peaceTurns = 0;
    rel.truceUntil = turn + TRUCE_DURATION;
    rel.rivalry = 0;
  }

  recordConflict(a: number, b: number): void {
    const rel = this.getOrCreate(a, b);
    rel.score = Math.max(-100, rel.score - CONFLICT_SCORE_PENALTY);
    rel.battlesThisWar += 1;
  }

  // Updates every existing pair's score dynamics and rivalry counter once
  // per turn. Runs last in TurnController's order, so the strength delta it
  // measures already spans this turn's builds, movement, and combat losses.
  tick(factions: Faction[], units: Unit[], military: MilitarySystem, index: TerritoryIndex): void {
    for (const faction of factions) {
      const strength = military.getFactionStrength(faction.id, units);
      const growth = Math.max(0, strength - faction.prevStrength);
      faction.strengthGrowthEma = 0.4 * growth + 0.6 * faction.strengthGrowthEma;
      faction.prevStrength = strength;
    }

    const rates = new Map<number, number>();
    for (const faction of factions) {
      const strength = military.getFactionStrength(faction.id, units);
      rates.set(faction.id, faction.strengthGrowthEma / Math.max(strength, STRENGTH_FLOOR));
    }
    const sortedRates = [...rates.values()].sort((x, y) => x - y);
    const globalMedianRate = sortedRates.length > 0 ? sortedRates[Math.floor(sortedRates.length / 2)] : 0;

    const strongestId = this.strongestFactionId(factions, units, military);

    for (let i = 0; i < factions.length; i++) {
      for (let j = i + 1; j < factions.length; j++) {
        const a = factions[i];
        const b = factions[j];
        const rel = this.getOrCreate(a.id, b.id);

        const rA = rates.get(a.id) ?? 0;
        const rB = rates.get(b.id) ?? 0;
        let norm: number;
        if (factions.length >= 3) {
          norm = globalMedianRate;
        } else {
          norm = rel.norm == null ? (rA + rB) / 2 : 0.05 * ((rA + rB) / 2) + 0.95 * rel.norm;
          rel.norm = norm;
        }

        const excess = Math.max(0, rA - norm) + Math.max(0, rB - norm);
        const borderTiles = index.getBorderTiles(a.id, b.id);
        const contact = Math.min(borderTiles, 8) / 8;
        const contactFactor = 0.25 + 0.75 * contact;
        const armsSpiral = -clamp(ARMS_COEFFICIENT * excess * contactFactor, 0, 6);

        const totalsA = index.getTotals(a.id);
        const totalsB = index.getTotals(b.id);
        const openFrontier = Math.min(totalsA.openFrontierCount, totalsB.openFrontierCount);
        const closure = 1 - Math.min(1, openFrontier / Math.max(2 * borderTiles, 1));
        // Deliberately NOT gated by military growth rate (the approved spec's
        // (rA+rB)/divisor factor): a closed frontier should create tension on
        // its own, for empires of any size. Verified during implementation
        // that with the rate gate, frontier decayed to ~0 once armies grew
        // into the thousands (a same-sized unit build is a vanishingly small
        // "rate" against a huge existing strength), so a fully land-locked
        // map at late-game scale never actually ignited a war - closure and
        // contact alone are what the mechanism is supposed to be about.
        const frontier = -FRONTIER_COEFFICIENT * contact * closure;

        const trust = clamp((rel.score + 120) / 160, 0.25, 1);
        const exch =
          rel.stance === DiplomaticStance.Peace
            ? 1.4 * (0.3 + 0.7 * contact) * Math.min(1.5, 0.5 + rel.peaceTurns / 40) * trust
            : 0;

        const strengthA = military.getFactionStrength(a.id, units);
        const strengthB = military.getFactionStrength(b.id, units);
        let align = 0;
        if (factions.length >= 3 && strongestId != null && strongestId !== a.id && strongestId !== b.id) {
          const hegStrength = military.getFactionStrength(strongestId, units);
          if (hegStrength >= 1.3 * Math.max(strengthA, strengthB)) {
            align = 2.5 * Math.min(1, hegStrength / Math.max(strengthA + strengthB, 1));
          }
        }

        const decay = -DECAY_RATE * rel.score;

        rel.score = clamp(rel.score + armsSpiral + frontier + exch + align + decay, -100, 100);

        if (rel.stance === DiplomaticStance.Peace) rel.peaceTurns += 1;
        else rel.warTurns += 1;

        // Stored relative to whichever of the pair has the smaller id,
        // matching getRelAdvWindow's convention - independent of which
        // order they happen to appear in the factions array.
        const total = strengthA + strengthB;
        const strengthOfLowerId = a.id < b.id ? strengthA : strengthB;
        const relAdv = total === 0 ? 0.5 : strengthOfLowerId / total;
        rel.relAdvHistory.push(relAdv);
        if (rel.relAdvHistory.length > 5) rel.relAdvHistory.shift();

        const isPeaceAndClosed = rel.stance === DiplomaticStance.Peace && rel.score <= -30 && closure >= 0.8;
        rel.rivalry = isPeaceAndClosed ? rel.rivalry + 1 : 0;
      }
    }
  }

  private strongestFactionId(factions: Faction[], units: Unit[], military: MilitarySystem): number | null {
    let best: number | null = null;
    let bestStrength = -Infinity;
    for (const faction of factions) {
      const strength = military.getFactionStrength(faction.id, units);
      if (strength > bestStrength) {
        bestStrength = strength;
        best = faction.id;
      }
    }
    return best;
  }
}
