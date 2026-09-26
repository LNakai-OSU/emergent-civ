import type { WorldGrid } from "./WorldGrid";
import { Unit } from "./Unit";
import type { Coordinate } from "./Tile";
import { findPath } from "./Pathfinding";

export interface MovementEvent {
  unit: Unit;
  to: Coordinate;
}

export class MovementSystem {
  issueMoveOrder(unit: Unit, grid: WorldGrid, destination: Coordinate): boolean {
    const path = findPath(grid, unit.coordinate, destination);
    if (!path) return false;
    unit.order = { path, pathIndex: 0 };
    return true;
  }

  // Each unit with a pending order advances along its precomputed path,
  // spending its per-turn movement budget. A unit always completes at least
  // one step per turn even if that tile's cost exceeds its remaining
  // budget (standard 4X movement rule) - it just can't start another step
  // afterward.
  tick(grid: WorldGrid, units: Unit[]): MovementEvent[] {
    const events: MovementEvent[] = [];
    for (const unit of units) {
      if (!unit.order) continue;
      let remainingBudget = unit.movementPoints;

      while (remainingBudget > 0 && unit.order.pathIndex < unit.order.path.length) {
        const nextCoord = unit.order.path[unit.order.pathIndex];
        const cost = grid.getTile(nextCoord).terrain.movementCost;
        unit.coordinate = nextCoord;
        unit.order.pathIndex += 1;
        remainingBudget -= cost;
        events.push({ unit, to: nextCoord });
      }

      if (unit.order.pathIndex >= unit.order.path.length) {
        unit.order = null;
      }
    }
    return events;
  }
}
