import type { WorldGrid } from "./WorldGrid";
import type { Coordinate } from "./Tile";

// Terrain at or above this movementCost is treated as impassable (matches
// Water's cost of 99, our stand-in for a real isPassable flag - see the
// TODO in TerrainTypeData.ts).
const IMPASSABLE_THRESHOLD = 90;

function key(coordinate: Coordinate): string {
  return `${coordinate.x},${coordinate.y}`;
}

// Dijkstra over the grid's 4-directional adjacency, weighted by each tile's
// terrain movementCost. The grid is small (tens of tiles per side), so a
// plain array scan for the next node is fine - no need for a binary heap.
export function findPath(grid: WorldGrid, start: Coordinate, goal: Coordinate): Coordinate[] | null {
  const dist = new Map<string, number>([[key(start), 0]]);
  const prev = new Map<string, Coordinate>();
  const visited = new Set<string>();
  const frontier: Coordinate[] = [start];

  while (frontier.length > 0) {
    frontier.sort((a, b) => (dist.get(key(a)) ?? Infinity) - (dist.get(key(b)) ?? Infinity));
    const current = frontier.shift()!;
    const currentKey = key(current);
    if (visited.has(currentKey)) continue;
    visited.add(currentKey);

    if (currentKey === key(goal)) break;

    for (const neighbor of grid.getNeighbors(current)) {
      if (neighbor.terrain.movementCost >= IMPASSABLE_THRESHOLD) continue;
      const neighborKey = key(neighbor.coordinate);
      if (visited.has(neighborKey)) continue;

      const tentativeDist = (dist.get(currentKey) ?? Infinity) + neighbor.terrain.movementCost;
      if (tentativeDist < (dist.get(neighborKey) ?? Infinity)) {
        dist.set(neighborKey, tentativeDist);
        prev.set(neighborKey, current);
        frontier.push(neighbor.coordinate);
      }
    }
  }

  if (!dist.has(key(goal))) return null;

  const path: Coordinate[] = [];
  let current: Coordinate | undefined = goal;
  while (current && key(current) !== key(start)) {
    path.unshift(current);
    current = prev.get(key(current));
  }
  return path;
}

export function isPassable(movementCost: number): boolean {
  return movementCost < IMPASSABLE_THRESHOLD;
}

// BFS outward from `near` until a passable tile is found. Terrain is
// randomly generated, so any hardcoded spawn coordinate could land on
// impassable terrain (e.g. Water) - callers placing units should route
// through this rather than trusting raw coordinates.
export function findNearestPassableTile(grid: WorldGrid, near: Coordinate): Coordinate {
  if (isPassable(grid.getTile(near).terrain.movementCost)) return near;

  const visited = new Set<string>([key(near)]);
  let frontier = [near];

  while (frontier.length > 0) {
    const next: Coordinate[] = [];
    for (const coord of frontier) {
      for (const neighbor of grid.getNeighbors(coord)) {
        const neighborKey = key(neighbor.coordinate);
        if (visited.has(neighborKey)) continue;
        visited.add(neighborKey);
        if (isPassable(neighbor.terrain.movementCost)) return neighbor.coordinate;
        next.push(neighbor.coordinate);
      }
    }
    frontier = next;
  }

  throw new Error("No passable tile found on the grid.");
}
