import { Tile, type Coordinate } from "./Tile";
import type { TerrainTypeData } from "../data/TerrainTypeData";

const FOUR_DIRECTIONS: Coordinate[] = [
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
];

// Seeded PRNG (mulberry32) so grid generation is reproducible for debugging,
// since Math.random() can't be seeded.
function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WorldGrid {
  readonly width: number;
  readonly height: number;
  private readonly tiles: Tile[][];

  constructor(width: number, height: number, terrainPalette: TerrainTypeData[], seed = 0) {
    if (terrainPalette.length === 0) {
      throw new Error("terrainPalette must contain at least one TerrainTypeData.");
    }

    this.width = width;
    this.height = height;

    const random = mulberry32(seed);
    this.tiles = [];
    for (let x = 0; x < width; x++) {
      const column: Tile[] = [];
      for (let y = 0; y < height; y++) {
        const terrain = terrainPalette[Math.floor(random() * terrainPalette.length)];
        column.push(new Tile({ x, y }, terrain));
      }
      this.tiles.push(column);
    }
  }

  isInBounds(coordinate: Coordinate): boolean {
    return (
      coordinate.x >= 0 &&
      coordinate.x < this.width &&
      coordinate.y >= 0 &&
      coordinate.y < this.height
    );
  }

  getTile(coordinate: Coordinate): Tile {
    if (!this.isInBounds(coordinate)) {
      throw new RangeError(
        `(${coordinate.x}, ${coordinate.y}) is outside the ${this.width}x${this.height} grid.`,
      );
    }
    return this.tiles[coordinate.x][coordinate.y];
  }

  tryGetTile(coordinate: Coordinate): Tile | undefined {
    return this.isInBounds(coordinate) ? this.tiles[coordinate.x][coordinate.y] : undefined;
  }

  *getNeighbors(coordinate: Coordinate): Generator<Tile> {
    for (const direction of FOUR_DIRECTIONS) {
      const neighbor = this.tryGetTile({
        x: coordinate.x + direction.x,
        y: coordinate.y + direction.y,
      });
      if (neighbor) yield neighbor;
    }
  }

  *allTiles(): Generator<Tile> {
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        yield this.tiles[x][y];
      }
    }
  }
}
