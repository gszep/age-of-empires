/** A small observation-only adaptation of the owned fishing policy.
 * Promisory/watercontrol.per: nearby ocean fish,14-tile deep-fish preference,
 *25-tile dock search. units.per has bounded4/8/12-boat branches; this example
 * caps at4. It never asks the simulation for hidden terrain or legal sites.
 */
import { FALLBACK_RULES, isBuilding, LAND_RESTRICTION, terrainAllows } from './data';
import { isOpenWater } from './mapgen';
import { distance } from './nav';
import { decodeObservedTerrain, type TerrainGrid } from '../protocol/terrain';
import type { ObservedEntity, PlayerObservation, RememberedEntityObservation } from '../protocol/types';
import type { Command, Point } from './types';

export const FISHING_LIMIT = 4;
export const FISH_SEARCH = 25;
export const DEEP_FISH_ALLOWANCE = 14;
export const DOCK_WOOD = 150;
export const FISHING_SHIP_WOOD = 75;
const DOCK_HALF = 1.5;
type Known = ObservedEntity | RememberedEntityObservation;

export interface FishingWater {
  observation: PlayerObservation;
  grid: TerrainGrid;
  labels: Int32Array;
  fish: Known[];
  known: Known[];
  ships: ObservedEntity[];
  docks: ObservedEntity[];
}

const fishNode = (entity: Known) => (entity.node === 'fish' || entity.node === 'shore-fish') && (entity.amount ?? 0) > 0;

function neighbours(grid: TerrainGrid, index: number): number[] {
  const x = index % grid.width, y = Math.floor(index / grid.width);
  return [x > 0 ? index - 1 : -1, x + 1 < grid.width ? index + 1 : -1,
    y > 0 ? index - grid.width : -1, y + 1 < grid.height ? index + grid.width : -1].filter(i => i >= 0);
}

function tile(grid: TerrainGrid, point: Point): number {
  const x = Math.floor(point.x), y = Math.floor(point.y);
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height ? y * grid.width + x : -1;
}

export function fishingWater(observation: PlayerObservation): FishingWater | undefined {
  const known = [...observation.entities, ...observation.memory];
  const fish = known.filter(fishNode);
  const mine = observation.entities.filter(e => e.owner === observation.player);
  const ships = mine.filter(e => e.kind === 'fishing-ship');
  const docks = mine.filter(e => e.kind === 'dock');
  const queued = docks.filter(e => e.training?.kind === 'fishing-ship').length;
  if ((!fish.length || ships.length + queued >= FISHING_LIMIT) && !ships.some(e => e.order === 'idle')) return;
  const grid = decodeObservedTerrain(observation);
  if (!grid) return;
  const labels = new Int32Array(grid.tiles.length).fill(-1);
  const queue = new Int32Array(grid.tiles.length);
  let label = 0;
  for (let start = 0; start < grid.tiles.length; start++) {
    if (labels[start] >= 0 || !isOpenWater(grid.tiles[start])) continue;
    let head = 0, end = 1; queue[0] = start; labels[start] = label;
    while (head < end) for (const next of neighbours(grid, queue[head++])) {
      if (labels[next] >= 0 || !isOpenWater(grid.tiles[next])) continue;
      labels[next] = label; queue[end++] = next;
    }
    label++;
  }
  return { observation, grid, labels, known, fish, ships, docks };
}

function dockComponent(water: FishingWater, dock: Point): number {
  const x = Math.floor(dock.x), y = Math.floor(dock.y);
  const labels = new Set<number>();
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const index = tile(water.grid, { x: x + dx, y: y + dy });
    if (index >= 0 && water.labels[index] >= 0) labels.add(water.labels[index]);
  }
  // Do not site across two separate pools and assume where the hull spawns.
  return labels.size === 1 ? labels.values().next().value! : -1;
}

function nearFish(water: FishingWater, at: Point, component: number): Known[] {
  return component < 0 ? [] : water.fish.filter(fish => water.labels[tile(water.grid, fish)] === component && distance(at, fish) <= FISH_SEARCH);
}

/** Choose clear, explored shore on the builder's known land component. The
 * actual public build command still decides terrain/obstruction legality.
 */
export function fishingDockSite(water: FishingWater, builder: Point, home: Point): Point | undefined {
  const { grid, known } = water;
  const land = new Uint8Array(grid.tiles.length);
  const passable = (index: number) => index >= 0 && grid.tiles[index] >= 0
    && terrainAllows(FALLBACK_RULES, LAND_RESTRICTION, grid.tiles[index]) && !isOpenWater(grid.tiles[index]);
  const seed = tile(grid, builder);
  const start = passable(seed) ? seed : seed >= 0 ? neighbours(grid, seed).find(passable) : undefined;
  if (start === undefined) return;
  const queue = [start]; land[start] = 1;
  for (let head = 0; head < queue.length; head++) for (const next of neighbours(grid, queue[head])) {
    if (!land[next] && passable(next)) { land[next] = 1; queue.push(next); }
  }
  const blocked = known.filter(e => isBuilding(e.kind) || e.kind === 'resource');
  const candidates: { x: number; y: number; score: number }[] = [];
  for (let y = 1; y < grid.height - 1; y++) for (let x = 1; x < grid.width - 1; x++) {
    let wet = 0, dry = 0, low = Infinity, high = -Infinity, valid = true;
    for (let dy = -1; dy <= 1 && valid; dy++) for (let dx = -1; dx <= 1; dx++) {
      const index = (y + dy) * grid.width + x + dx, terrain = grid.tiles[index];
      if (terrain < 0 || !terrainAllows(FALLBACK_RULES, 6, terrain)) { valid = false; break; }
      if (isOpenWater(terrain)) wet++; else dry++;
      low = Math.min(low, grid.elevation[index]); high = Math.max(high, grid.elevation[index]);
    }
    if (!valid || !wet || !dry || high - low > 1) continue;
    let reachable = false;
    for (let dy = -2; dy <= 2 && !reachable; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) continue;
      const index = tile(grid, { x: x + dx, y: y + dy });
      if (index >= 0 && land[index]) { reachable = true; break; }
    }
    if (!reachable) continue;
    const at = { x: x + 0.5, y: y + 0.5 };
    if (blocked.some(e => {
      // Coarse strategy spacing, not a replacement placement rule.
      const half = e.kind === 'resource' ? 1 : e.kind === 'town-center' || e.kind === 'castle' || e.kind === 'wonder' ? 3 : 2;
      return Math.abs(at.x - e.x) < DOCK_HALF + half && Math.abs(at.y - e.y) < DOCK_HALF + half;
    })) continue;
    const fish = nearFish(water, at, dockComponent(water, at));
    if (!fish.length) continue;
    candidates.push({ ...at, score: distance(home, at) + Math.min(...fish.map(f => distance(at, f))) });
  }
  candidates.sort((a, b) => a.score - b.score || a.y - b.y || a.x - b.x);
  if (!candidates.length) return;
  // Rotate bounded alternatives if the public command rejects a site whose
  // finer footprint/obstruction data is not in this strategy's observation.
  const at = candidates[Math.floor(water.observation.time / 3) % Math.min(8, candidates.length)];
  return at ? { x: at.x, y: at.y } : undefined;
}

export function fishingOrders(water: FishingWater): Command[] {
  const commands: Command[] = [];
  const player = water.observation.player;
  let exploring = false;
  for (const ship of water.ships.filter(e => e.order === 'idle').sort((a, b) => a.id - b.id)) {
    const component = water.labels[tile(water.grid, ship)];
    const dock = water.docks.filter(e => e.buildProgress === undefined && dockComponent(water, e) === component)
      .sort((a, b) => distance(ship, a) - distance(ship, b) || a.id - b.id)[0];
    const fish = (dock ? nearFish(water, dock, component) : []).sort((a, b) => distance(ship, a) - distance(ship, b) || a.id - b.id);
    const shore = fish.find(e => e.node === 'shore-fish');
    const deep = fish.find(e => e.node === 'fish');
    const target = deep && (!shore || distance(ship, deep) <= distance(ship, shore) + DEEP_FISH_ALLOWANCE) ? deep : shore;
    if (target) {
      commands.push({ kind: 'order', player, entityIds: [ship.id], target: { x: target.x, y: target.y }, targetId: target.id });
    } else if (!exploring && component >= 0) {
      const frontier: Point[] = [];
      if (dock) for (let i = 0; i < water.grid.tiles.length; i++) {
        if (water.labels[i] !== component || !neighbours(water.grid, i).some(n => water.grid.tiles[n] < 0)) continue;
        const at = { x: i % water.grid.width + 0.5, y: Math.floor(i / water.grid.width) + 0.5 };
        if (distance(at, dock) <= FISH_SEARCH && distance(at, ship) > 1) frontier.push(at);
      }
      frontier.sort((a, b) => distance(ship, a) - distance(ship, b) || a.y - b.y || a.x - b.x);
      if (frontier.length) {
        commands.push({ kind: 'order', player, entityIds: [ship.id], target: frontier[0] });
        exploring = true;
      }
    }
  }
  return commands;
}

export function fishingProducer(water: FishingWater): ObservedEntity | undefined {
  const count = water.ships.length + water.docks.filter(d => d.training?.kind === 'fishing-ship').length;
  if (count >= FISHING_LIMIT) return;
  return water.docks.filter(d => d.buildProgress === undefined && !d.training && !d.researching
    && nearFish(water, d, dockComponent(water, d)).length > 0).sort((a, b) => a.id - b.id)[0];
}

/** Conservative reservation using the same public default prices the example
 * strategy already assumes. Actual spending remains the command boundary's job.
 */
export function plannedWood(commands: readonly Command[]): number {
  return commands.reduce((wood, command) => wood + (command.kind === 'build'
    ? FALLBACK_RULES.buildings[command.building]?.cost.wood ?? 0
    : command.kind === 'train' ? FALLBACK_RULES.units[command.unit]?.cost.wood ?? 0 : 0), 0);
}
