# EmergentCiv

A civilization-strategy simulation where the core mechanics - economic growth, diplomacy, and war - are built from real economic and sociological models rather than hand-tuned numbers, and where AI factions make every decision themselves from live game state. No scripted events, no "if turn 20, attack": a faction's choice to expand, build, attack, declare war, or sue for peace is a utility-scored decision re-evaluated every turn against its neighbors' actual behavior.

Play as one faction against an AI, or step back and spectate 2-100 AI civilizations playing each other out in real time.

## What's actually driving it

- **Economy** - a Malthus-Boserup-Smith growth model: a Cobb-Douglas production function gives every civilization a Malthusian subsistence ceiling, escaped over time by investment-driven productivity (a player/AI-adjustable slider that trades military spending now for a permanently higher ceiling later), bounded by a physical citizens-per-tile density cap so territory matters for the entire game instead of flatlining early.
- **Diplomacy** - a Spiral-Exchange model combining the security dilemma, social exchange theory, balance-of-threat, and forgiveness (relationship score decays toward neutral over time) with a "lateral pressure" mechanic: a closing, unclaimed frontier between two neighbors builds tension on its own, independent of military activity, eventually forcing war even between perfectly matched civilizations that would otherwise sit at a permanent peaceful stalemate.
- **Conquest** - real territorial consequences: defeating a garrison or besieging an undefended tile for several turns flips it; a faction's capital survives as long as it has population, but taking it sacks a share of the surrounding territory and relocates the capital; newly conquered land runs at reduced output for a while before fully integrating.
- **AI** - every non-player faction scores five candidate actions (build, attack, declare war, sue for peace, plus automatic economic expansion) against current world state each turn and executes only the best one.

## How the design got built

The economy and diplomacy models weren't hand-picked - they came out of an explicit multi-agent review process: independent "economist" and "sociologist" specialist passes proposed the models from real theory, and independent critic passes scored each revision, gated at a 9/10 bar, re-simulating worked examples from scratch rather than trusting the proposal's own numbers. Both models went through 3-4 revision rounds before passing. A separate integration pass and a "fun/playtesting" pass (with veto power over anything too punishing or opaque) designed how conquest actually works in-game.

Two real bugs survived that entire review process and were only caught by testing at actual full-game scale, since every worked example in review used small, roughly-constant example numbers: a diplomacy term that decayed to zero once armies grew into the thousands (so a fully land-locked map never produced tension at late-game scale), and a utility-scoring imbalance where declaring war never actually led to any fighting, because building yet another unit always scored higher than attacking. Both are documented and fixed in the commit history.

## Stack

TypeScript + React, Canvas for the map, hand-rolled turn/tick simulation - no game engine. `src/simulation/` is backend/systems, `src/data/` is content (terrain, units, buildings, tech), `src/components/` is presentation.

## Running it

```bash
npm install
npm run dev
```

## Known limitations

- The player's manual tile-claim stays free/instant rather than sharing the AI's food-funded automatic expansion cost.
- The diplomacy graph renders every faction pair as a network edge, which gets visually dense well before 100 factions.
- AI factions don't yet use buildings, tech research, or unit variety beyond the baseline unit - a deliberate scope limit, not a bug.
