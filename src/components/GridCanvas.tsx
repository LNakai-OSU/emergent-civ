import { useEffect, useRef } from "react";
import type { WorldGrid } from "../simulation/WorldGrid";
import type { Coordinate } from "../simulation/Tile";
import { UNCLAIMED_FACTION_ID } from "../simulation/Tile";

// Duck-typed rather than the concrete Unit/Faction classes, so both live
// simulation objects and plain historical-snapshot data (see GameSnapshot.ts)
// can be rendered by the same component without converting one into the other.
interface UnitLike {
  id: number;
  factionId: number;
  coordinate: Coordinate;
}

interface FactionLike {
  id: number;
  color: string;
}

interface TileOverride {
  ownerFactionId: number;
  unrestTurns: number;
  occupationTurns: number;
}

interface GridCanvasProps {
  grid: WorldGrid;
  units?: readonly UnitLike[];
  factions?: readonly FactionLike[];
  tileSize?: number;
  selectedUnitId?: number | null;
  selectedTile?: Coordinate | null;
  onTileClick?: (coordinate: Coordinate) => void;
  // When viewing a past turn (see the history/scrub-back feature in
  // App.tsx), tile ownership no longer matches the live grid's mutable
  // fields - this overrides ownership/unrest/occupation per-coordinate for
  // that read-only view, while terrain (which never changes) still comes
  // straight from the live grid. Absent (live play), tiles render from
  // their own current fields as before.
  tileOverrides?: ReadonlyMap<string, TileOverride> | null;
  // Units/tiles are mutated in place by the simulation (same object
  // references before and after a tick), so the draw effect's dependency
  // array wouldn't otherwise notice a change. Pass a counter that increments
  // on every tick to force a redraw.
  redrawToken?: number;
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function GridCanvas({
  grid,
  units = [],
  factions = [],
  tileSize = 24,
  selectedUnitId = null,
  selectedTile = null,
  onTileClick,
  tileOverrides = null,
  redrawToken = 0,
}: GridCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const tile of grid.allTiles()) {
      const px = tile.coordinate.x * tileSize;
      const py = tile.coordinate.y * tileSize;

      ctx.fillStyle = tile.terrain.color;
      ctx.fillRect(px, py, tileSize - 1, tileSize - 1);

      const override = tileOverrides?.get(tileKey(tile.coordinate.x, tile.coordinate.y));
      const ownerFactionId = tileOverrides ? (override?.ownerFactionId ?? UNCLAIMED_FACTION_ID) : tile.ownerFactionId;
      const unrestTurns = tileOverrides ? (override?.unrestTurns ?? 0) : tile.unrestTurns;
      const occupationTurns = tileOverrides ? (override?.occupationTurns ?? 0) : tile.occupationTurns;

      if (ownerFactionId !== UNCLAIMED_FACTION_ID) {
        const owner = factions.find((f) => f.id === ownerFactionId);
        const ownerColor = owner?.color ?? "#000000";

        // A strong color wash over the whole tile (not just a thin border) is
        // what actually makes "who owns what" and expansion shape readable
        // at a glance, especially once territories are patchy/interspersed.
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = ownerColor;
        ctx.fillRect(px, py, tileSize - 1, tileSize - 1);
        ctx.globalAlpha = 1;

        // Border width scales down for small tiles (e.g. on a very large
        // board) so it doesn't overwhelm the tile at low tileSize.
        const borderWidth = tileSize >= 12 ? 3 : 1;
        ctx.strokeStyle = ownerColor;
        ctx.lineWidth = borderWidth;
        const inset = borderWidth / 2 + 0.5;
        ctx.strokeRect(px + inset, py + inset, tileSize - inset * 2, tileSize - inset * 2);

        // Freshly-conquered tiles get a diagonal hatch (fading as unrest
        // decays) so a territory flip reads as "newly taken, still raw"
        // rather than a confusing recolor.
        if (unrestTurns > 0 && tileSize >= 6) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(px, py, tileSize - 1, tileSize - 1);
          ctx.clip();
          ctx.strokeStyle = "#000000";
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = 1;
          for (let offset = -tileSize; offset < tileSize * 2; offset += 4) {
            ctx.beginPath();
            ctx.moveTo(px + offset, py);
            ctx.lineTo(px + offset + tileSize, py + tileSize);
            ctx.stroke();
          }
          ctx.restore();
        }

        // A tile currently under active siege (a lone enemy unit
        // accumulating occupation turns) gets a pulsing bright outline.
        if (occupationTurns > 0) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 1, py + 1, tileSize - 2, tileSize - 2);
        }
      }
    }

    if (selectedTile) {
      ctx.strokeStyle = "#ffd60a";
      ctx.lineWidth = 3;
      ctx.strokeRect(selectedTile.x * tileSize + 1, selectedTile.y * tileSize + 1, tileSize - 2, tileSize - 2);
    }

    for (const unit of units) {
      const faction = factions.find((f) => f.id === unit.factionId);
      const centerX = unit.coordinate.x * tileSize + tileSize / 2;
      const centerY = unit.coordinate.y * tileSize + tileSize / 2;
      ctx.beginPath();
      ctx.arc(centerX, centerY, tileSize / 3, 0, Math.PI * 2);
      ctx.fillStyle = faction?.color ?? "#000000";
      ctx.fill();
      ctx.lineWidth = unit.id === selectedUnitId ? 3 : 1;
      ctx.strokeStyle = unit.id === selectedUnitId ? "#ffd60a" : "#000000";
      ctx.stroke();
    }
  }, [grid, units, factions, tileSize, selectedUnitId, selectedTile, tileOverrides, redrawToken]);

  const handleClick: React.MouseEventHandler<HTMLCanvasElement> = (e) => {
    if (!onTileClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / tileSize);
    const y = Math.floor((e.clientY - rect.top) / tileSize);
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return;
    onTileClick({ x, y });
  };

  return (
    <canvas
      ref={canvasRef}
      width={grid.width * tileSize}
      height={grid.height * tileSize}
      onClick={handleClick}
      style={{ cursor: onTileClick ? "pointer" : "default" }}
    />
  );
}
