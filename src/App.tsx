import { useEffect, useState } from "react";
import { WorldGrid } from "./simulation/WorldGrid";
import { Faction } from "./simulation/Faction";
import { Unit } from "./simulation/Unit";
import type { Coordinate } from "./simulation/Tile";
import { TurnController } from "./simulation/TurnController";
import { findNearestPassableTile } from "./simulation/Pathfinding";
import { DiplomaticStance } from "./simulation/DiplomacySystem";
import { captureSnapshot, type GameSnapshot } from "./simulation/GameSnapshot";
import { getFactionAppearance } from "./factionPalette";
import { DEFAULT_TERRAIN_PALETTE } from "./data/terrainTypes";
import { WARRIOR, ALL_UNIT_TYPES } from "./data/unitTypes";
import { ALL_BUILDING_TYPES } from "./data/buildingTypes";
import { ALL_TECHS } from "./data/techTypes";
import { GridCanvas } from "./components/GridCanvas";
import { DiplomacyGraph } from "./components/DiplomacyGraph";
import { FactionStatsChart, type FactionStatLike } from "./components/FactionStatsChart";
import "./App.css";

const SPEED_OPTIONS = [
  { label: "0.5x", intervalMs: 1000 },
  { label: "1x", intervalMs: 500 },
  { label: "2x", intervalMs: 250 },
  { label: "4x", intervalMs: 125 },
];

// No hard tie to a fixed color list any more (see factionPalette.ts, which
// generates colors/names for an arbitrary count) - this is just a sane UI/
// performance ceiling, not a palette limit.
const MAX_CPUS = 100;

// "Normal" keeps 2-faction starting distance around 16 tiles (generateStartPositions
// scales with map size), close to the ~7-10 tiles needed for territories to
// actually touch once expansion plateaus around 25-40 tiles/faction under
// the economic model - with some room to grow before contact, not zero gap.
// "Epic" is the original 200x200, a legitimate slow-burn option kept
// available but not the default, since at that scale factions wouldn't
// meaningfully interact for thousands of turns.
const MAP_SIZE_OPTIONS = [
  { label: "Normal", size: 20 },
  { label: "Epic", size: 200 },
];

// How many past turns "scroll back" can reach - a sliding window, not the
// whole game's history, to keep memory bounded during long fast-forwards.
const MAX_HISTORY = 300;

type GameMode = "play" | "spectate";

interface Game {
  grid: WorldGrid;
  factions: Faction[];
  units: Unit[];
  turnController: TurnController;
}

// Starting positions spread evenly around a circle centered on the map -
// generalizes cleanly to any faction count instead of hardcoding corners for
// exactly two.
function generateStartPositions(grid: WorldGrid, count: number): Coordinate[] {
  const centerX = grid.width / 2;
  const centerY = grid.height / 2;
  const radius = Math.min(grid.width, grid.height) * 0.4;
  const positions: Coordinate[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    const x = Math.round(centerX + radius * Math.cos(angle));
    const y = Math.round(centerY + radius * Math.sin(angle));
    positions.push({
      x: Math.max(0, Math.min(grid.width - 1, x)),
      y: Math.max(0, Math.min(grid.height - 1, y)),
    });
  }
  return positions;
}

// Hand-claimed starting territory for this demo harness only, to bootstrap
// EconomySystem before a faction has had a chance to claim anything itself.
// Everything after this - expansion, unit building, attacking, war/peace -
// goes through the same claimTile/buildUnit/issueMoveOrder/declareWar API
// for both the player and AISystem.
function claimStartingTerritory(grid: WorldGrid, faction: Faction, center: Coordinate): void {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const coord = { x: center.x + dx, y: center.y + dy };
      if (!grid.isInBounds(coord)) continue;
      const tile = grid.getTile(coord);
      if (tile.terrain.movementCost < 90) {
        tile.ownerFactionId = faction.id;
        if (!faction.capital) faction.capital = tile.coordinate;
      }
    }
  }

  // If the whole starting block happened to be water, fall back to the
  // nearest passable tile so the faction never starts with a capital it
  // doesn't actually own.
  if (!faction.capital) {
    const fallback = findNearestPassableTile(grid, center);
    grid.getTile(fallback).ownerFactionId = faction.id;
    faction.capital = fallback;
  }
}

function createGame(mode: GameMode, cpuCount: number, mapSize: number): Game {
  const factionCount = mode === "play" ? 2 : cpuCount;
  const grid = new WorldGrid(mapSize, mapSize, DEFAULT_TERRAIN_PALETTE, Math.floor(Math.random() * 1_000_000));
  const positions = generateStartPositions(grid, factionCount);

  const factions: Faction[] = [];
  const units: Unit[] = [];
  for (let i = 0; i < factionCount; i++) {
    const { name, color } = getFactionAppearance(i);
    const faction = new Faction(i, name, color);
    if (mode === "play" && i === 0) faction.isPlayerControlled = true;
    claimStartingTerritory(grid, faction, positions[i]);
    factions.push(faction);

    // One starting unit per faction so AISystem has something to work with
    // immediately (build/attack decisions need at least one unit or home
    // tile to reason about).
    const start = findNearestPassableTile(grid, positions[i]);
    units.push(new Unit(i, faction.id, WARRIOR, start));
  }

  return { grid, factions, units, turnController: new TurnController(grid, factions, units) };
}

function App() {
  const [gameMode, setGameMode] = useState<GameMode>("play");
  const [cpuCount, setCpuCount] = useState(4);
  const [mapSize, setMapSize] = useState(MAP_SIZE_OPTIONS[0].size);
  const [game, setGame] = useState<Game>(() => createGame("play", 2, MAP_SIZE_OPTIONS[0].size));
  const { grid, factions, units, turnController } = game;
  const player = factions.find((f) => f.isPlayerControlled) ?? null;

  const [tickCounter, setTickCounter] = useState(0);
  const [runCount, setRunCount] = useState(50);
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
  const [selectedTile, setSelectedTile] = useState<Coordinate | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [speedIntervalMs, setSpeedIntervalMs] = useState(SPEED_OPTIONS[1].intervalMs);

  // Scroll-back-in-steps: a sliding window of past-turn snapshots, plus a
  // "viewing index" - null means live (the normal, mutable game state);
  // set means read-only, showing that snapshot instead. Advancing the
  // simulation always appends the new state to history.
  const [history, setHistory] = useState<GameSnapshot[]>([]);
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);
  const viewingSnapshot = viewingIndex != null ? (history[viewingIndex] ?? null) : null;
  const isLive = viewingSnapshot == null;

  const bumpRedraw = () => setTickCounter((n) => n + 1);

  const recordHistory = () => {
    const snapshot = captureSnapshot(grid, factions, units, turnController);
    setHistory((h) => {
      const next = [...h, snapshot];
      return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
    });
  };

  const handleNewGame = () => {
    setIsRunning(false);
    setSelectedUnitId(null);
    setSelectedTile(null);
    setHistory([]);
    setViewingIndex(null);
    setGame(createGame(gameMode, cpuCount, mapSize));
    bumpRedraw();
  };

  // The real-time clock: advanceTurn() was always designed to not care who
  // calls it, so "going real-time" is just this - a timer replacing manual
  // clicks. Pausing (isRunning=false) stops the clock but leaves all player
  // actions (claim/build/research/orders) available, same as before.
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => {
      turnController.advanceTurn();
      recordHistory();
      bumpRedraw();
    }, speedIntervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, speedIntervalMs, turnController]);

  const handleTick = () => {
    turnController.advanceTurn();
    recordHistory();
    bumpRedraw();
  };

  const handleRunMany = () => {
    for (let i = 0; i < runCount; i++) {
      turnController.advanceTurn();
      recordHistory();
    }
    bumpRedraw();
  };

  const handleStepBack = () => {
    setIsRunning(false);
    setViewingIndex((i) => {
      if (history.length === 0) return i;
      // The most recent snapshot is captured right after the last tick, so
      // it's usually indistinguishable from live - skip straight to the one
      // before it so the first click visibly moves back a turn.
      if (i == null) return Math.max(0, history.length - 2);
      return Math.max(0, i - 1);
    });
  };

  const handleStepForward = () => {
    setViewingIndex((i) => {
      if (i == null) return null;
      return i + 1 >= history.length ? null : i + 1; // stepping past the last snapshot returns to live
    });
  };

  const handleGoLive = () => setViewingIndex(null);

  const handleTileClick = (coord: Coordinate) => {
    if (!isLive) return; // read-only while scrolled back in history
    const clickedUnit = units.find((u) => u.coordinate.x === coord.x && u.coordinate.y === coord.y);

    if (selectedUnitId != null) {
      // Second click: treat it as a move/attack order for the previously
      // selected unit, whatever's on the destination tile (moving onto an
      // enemy tile at war triggers combat automatically via MilitarySystem -
      // no separate "attack" action needed).
      const unit = units.find((u) => u.id === selectedUnitId);
      if (unit && player && unit.factionId === player.id) {
        turnController.issueMoveOrder(unit, coord);
      }
      setSelectedUnitId(null);
    } else if (clickedUnit && player && clickedUnit.factionId === player.id) {
      setSelectedUnitId(clickedUnit.id);
    }

    setSelectedTile(coord);
    bumpRedraw();
  };

  const selectedTileInfo = selectedTile ? grid.getTile(selectedTile) : null;
  const canClaimSelected =
    isLive &&
    player != null &&
    selectedTile != null &&
    selectedTileInfo != null &&
    selectedTileInfo.isUnclaimed &&
    selectedTileInfo.terrain.movementCost < 90 &&
    [...grid.getNeighbors(selectedTile)].some((n) => n.ownerFactionId === player.id);
  const canBuildOnSelected =
    isLive && player != null && selectedTileInfo != null && selectedTileInfo.ownerFactionId === player.id;

  const hasTech = (requiresTechId: string | null) =>
    !requiresTechId || (player?.researchedTechIds.has(requiresTechId) ?? false);

  const handleClaim = () => {
    if (!player || !selectedTile) return;
    turnController.claimTile(player.id, selectedTile);
    bumpRedraw();
  };

  const handleBuildUnit = (unitType: (typeof ALL_UNIT_TYPES)[number]) => {
    if (!player || !selectedTile) return;
    turnController.buildUnit(player.id, selectedTile, unitType);
    bumpRedraw();
  };

  const handleBuildBuilding = (buildingType: (typeof ALL_BUILDING_TYPES)[number]) => {
    if (!player || !selectedTile) return;
    turnController.buildBuilding(player.id, selectedTile, buildingType);
    bumpRedraw();
  };

  const handleResearch = (tech: (typeof ALL_TECHS)[number]) => {
    if (!player) return;
    turnController.researchTech(player.id, tech);
    bumpRedraw();
  };

  const opponent = player ? factions.find((f) => f.id !== player.id) ?? null : null;
  const atWarWithOpponent = player && opponent ? turnController.getStance(player.id, opponent.id) === DiplomaticStance.War : false;
  const handleDeclareWar = () => {
    if (!player || !opponent) return;
    turnController.declareWar(player.id, opponent.id);
    bumpRedraw();
  };
  const handleMakePeace = () => {
    if (!player || !opponent) return;
    turnController.makePeace(player.id, opponent.id);
    bumpRedraw();
  };

  const factionName = (factionId: number) =>
    factions.find((f) => f.id === factionId)?.name ?? `Faction ${factionId}`;

  // Everything below derives from either the live simulation or the
  // selected historical snapshot, so the map/graph/stats/logs all render
  // the same way regardless of which one is active.
  const displayTurn = viewingSnapshot ? viewingSnapshot.turn : turnController.turn;

  const displayFactions: FactionStatLike[] = viewingSnapshot
    ? viewingSnapshot.factions
    : factions.map((f) => ({
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
        militaryStrength: turnController.getFactionMilitaryStrength(f.id),
      }));

  const displayUnits = viewingSnapshot ? viewingSnapshot.units : units;

  const tileOverrides = viewingSnapshot
    ? new Map(
        viewingSnapshot.tiles.map((t) => [
          `${t.x},${t.y}`,
          { ownerFactionId: t.ownerFactionId, unrestTurns: t.unrestTurns, occupationTurns: t.occupationTurns },
        ]),
      )
    : null;

  const getStanceDisplay = viewingSnapshot
    ? (a: number, b: number): DiplomaticStance =>
        viewingSnapshot.diplomacy.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a))?.stance ??
        DiplomaticStance.Peace
    : (a: number, b: number) => turnController.getStance(a, b);

  const getStrengthDisplay = viewingSnapshot
    ? (id: number) => viewingSnapshot.factions.find((f) => f.id === id)?.militaryStrength ?? 0
    : (id: number) => turnController.getFactionMilitaryStrength(id);

  const displayAiLog = viewingSnapshot ? viewingSnapshot.aiLog : turnController.lastAI.map((a) => a.description);
  const displayMovementLog = viewingSnapshot
    ? viewingSnapshot.movementLog.map((m) => `${factionName(m.factionId)}'s unit moved to (${m.to.x}, ${m.to.y})`)
    : turnController.lastMovement.map((m) => `${factionName(m.unit.factionId)}'s unit moved to (${m.to.x}, ${m.to.y})`);
  const displayCombatLog = viewingSnapshot
    ? viewingSnapshot.combatLog.map(
        (c) =>
          `${factionName(c.winnerFactionId)} (strength ${c.winnerStrength}) defeated ${factionName(c.loserFactionId)} at (${c.at.x}, ${c.at.y})`,
      )
    : turnController.lastCombat.map(
        (r) =>
          `${factionName(r.winner.factionId)} (strength ${r.winner.strength}) defeated ${factionName(r.loser.factionId)} at (${r.loser.coordinate.x}, ${r.loser.coordinate.y})`,
      );

  return (
    <div style={{ padding: "1rem", display: "flex", gap: "2rem" }}>
      <div>
        <h1>EmergentCiv</h1>

        <div style={{ marginBottom: "0.75rem", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <label>
            <input
              type="radio"
              name="gameMode"
              checked={gameMode === "play"}
              onChange={() => setGameMode("play")}
            />{" "}
            Play
          </label>
          <label>
            <input
              type="radio"
              name="gameMode"
              checked={gameMode === "spectate"}
              onChange={() => setGameMode("spectate")}
            />{" "}
            Spectate
          </label>
          {gameMode === "spectate" && (
            <label>
              CPUs:{" "}
              <input
                type="number"
                min={2}
                max={MAX_CPUS}
                value={cpuCount}
                onChange={(e) => setCpuCount(Math.max(2, Math.min(MAX_CPUS, Number(e.target.value) || 2)))}
                style={{ width: "4rem" }}
              />
            </label>
          )}
          <label>
            Map:{" "}
            <select value={mapSize} onChange={(e) => setMapSize(Number(e.target.value))}>
              {MAP_SIZE_OPTIONS.map((opt) => (
                <option key={opt.label} value={opt.size}>
                  {opt.label} ({opt.size}x{opt.size})
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={handleNewGame}>
            New Game
          </button>
        </div>

        <div style={{ maxWidth: "800px", maxHeight: "800px", overflow: "auto", border: "1px solid #444" }}>
          <GridCanvas
            grid={grid}
            units={displayUnits}
            factions={displayFactions}
            tileSize={Math.max(4, Math.min(20, Math.floor(700 / grid.width)))}
            redrawToken={tickCounter}
            selectedUnitId={isLive ? selectedUnitId : null}
            selectedTile={isLive ? selectedTile : null}
            onTileClick={isLive ? handleTileClick : undefined}
            tileOverrides={tileOverrides}
          />
        </div>
      </div>
      <div>
        <h2>
          Turn {displayTurn}
          {!isLive && <span style={{ color: "#b45309" }}> (viewing history)</span>}
        </h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={() => setIsRunning((r) => !r)} disabled={!isLive}>
            {isRunning ? "Pause" : "Play"}
          </button>
          {SPEED_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => setSpeedIntervalMs(opt.intervalMs)}
              disabled={speedIntervalMs === opt.intervalMs}
            >
              {opt.label}
            </button>
          ))}
          <button type="button" onClick={handleTick} disabled={!isLive}>
            Tick
          </button>
          <input
            type="number"
            min={1}
            value={runCount}
            onChange={(e) => setRunCount(Math.max(1, Number(e.target.value) || 1))}
            style={{ width: "4rem" }}
            disabled={!isLive}
          />
          <button type="button" onClick={handleRunMany} disabled={!isLive}>
            Run N Turns
          </button>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.5rem" }}>
          <button
            type="button"
            onClick={handleStepBack}
            disabled={isLive ? history.length === 0 : (viewingIndex ?? 0) === 0}
          >
            ◀ Step Back
          </button>
          <button type="button" onClick={handleStepForward} disabled={isLive}>
            Step Forward ▶
          </button>
          <button type="button" onClick={handleGoLive} disabled={isLive}>
            Go Live
          </button>
          <span style={{ fontSize: "0.8rem", color: "#666" }}>
            {history.length} turn{history.length === 1 ? "" : "s"} of history available
          </span>
        </div>

        <h3 style={{ marginTop: "1rem" }}>Diplomacy</h3>
        <DiplomacyGraph
          factions={displayFactions}
          getStance={getStanceDisplay}
          getStrength={getStrengthDisplay}
          size={displayFactions.length > 2 ? 320 : 200}
        />
        {isLive && player && opponent && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {atWarWithOpponent ? (
              <button type="button" onClick={handleMakePeace}>
                Sue for Peace with {opponent.name}
              </button>
            ) : (
              <button type="button" onClick={handleDeclareWar}>
                Declare War on {opponent.name}
              </button>
            )}
          </div>
        )}

        <h3 style={{ marginTop: "1rem" }}>Factions</h3>
        <FactionStatsChart factions={displayFactions} />

        {isLive && player && (
          <>
            <h3 style={{ marginTop: "1.5rem" }}>Investment</h3>
            <p>
              Investment rate: {Math.round(player.investRate * 100)}% (trades production/gold now for a permanently
              higher ceiling later)
            </p>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(player.investRate * 100)}
              onChange={(e) => {
                turnController.setInvestRate(player.id, Number(e.target.value) / 100);
                bumpRedraw();
              }}
              style={{ width: "200px" }}
            />
            {(() => {
              const preview = turnController.previewEconomy(player.id);
              if (!preview) return null;
              const bankedThisTurn = (preview.prodOut + preview.goldOut) * (1 - player.investRate);
              const investedThisTurn = (preview.prodOut + preview.goldOut) * player.investRate;
              return (
                <p>
                  This turn: banking ~{bankedThisTurn.toFixed(1)} production/gold, investing ~
                  {investedThisTurn.toFixed(1)} (total invested: {player.investment.toFixed(0)}, productivity{" "}
                  {preview.A.toFixed(2)}x)
                </p>
              );
            })()}

            <h3 style={{ marginTop: "1.5rem" }}>Research ({player.productionStockpile.toFixed(0)} production)</h3>
            <ul>
              {ALL_TECHS.map((tech) => {
                const researched = player.researchedTechIds.has(tech.id);
                return (
                  <li key={tech.id}>
                    {tech.displayName} — {tech.description}{" "}
                    {researched ? (
                      "(researched)"
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleResearch(tech)}
                        disabled={player.productionStockpile < tech.productionCost}
                      >
                        Research (cost {tech.productionCost})
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>

            <h3>Selected</h3>
            {selectedTile && selectedTileInfo ? (
              <div>
                <p>
                  Tile ({selectedTile.x}, {selectedTile.y}): {selectedTileInfo.terrain.displayName}, owner:{" "}
                  {selectedTileInfo.isUnclaimed ? "unclaimed" : factionName(selectedTileInfo.ownerFactionId)}
                  {selectedTileInfo.building ? `, building: ${selectedTileInfo.building.displayName}` : ""}
                </p>
                {selectedUnitId != null && <p>Unit #{selectedUnitId} selected — click a tile to move/attack there.</p>}

                {canClaimSelected && (
                  <button type="button" onClick={handleClaim}>
                    Claim Tile
                  </button>
                )}

                {canBuildOnSelected && (
                  <div style={{ marginTop: "0.5rem" }}>
                    <p>Build unit:</p>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      {ALL_UNIT_TYPES.filter((t) => hasTech(t.requiresTechId)).map((unitType) => (
                        <button
                          key={unitType.id}
                          type="button"
                          onClick={() => handleBuildUnit(unitType)}
                          disabled={player.productionStockpile < unitType.productionCost}
                        >
                          {unitType.displayName} (cost {unitType.productionCost}, str {unitType.strength}, mv{" "}
                          {unitType.movementPoints})
                        </button>
                      ))}
                    </div>

                    {!selectedTileInfo.building && (
                      <>
                        <p>Build building:</p>
                        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                          {ALL_BUILDING_TYPES.filter((b) => hasTech(b.requiresTechId)).map((buildingType) => (
                            <button
                              key={buildingType.id}
                              type="button"
                              onClick={() => handleBuildBuilding(buildingType)}
                              disabled={player.productionStockpile < buildingType.productionCost}
                            >
                              {buildingType.displayName} (cost {buildingType.productionCost})
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p>Click a unit to select it, or a tile to inspect it.</p>
            )}
          </>
        )}

        <h3>Last AI Actions</h3>
        {displayAiLog.length === 0 ? (
          <p>No AI actions this turn.</p>
        ) : (
          <ul>
            {displayAiLog.map((action, i) => (
              <li key={i}>{action}</li>
            ))}
          </ul>
        )}

        <h3>Last Movement</h3>
        {displayMovementLog.length === 0 ? (
          <p>No movement this turn.</p>
        ) : (
          <ul>
            {displayMovementLog.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}

        <h3>Last Combat</h3>
        {displayCombatLog.length === 0 ? (
          <p>No combat this turn.</p>
        ) : (
          <ul>
            {displayCombatLog.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default App;
