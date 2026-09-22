import type { EntityKind, GameState, PlayerId, Point, ResourceKind, UnitKind, ReadonlyGameState } from '../sim/types';
import { isBuilding, NODE_OF_RESOURCE, type NodeKind } from '../sim/data';
import type { ContentAssets, ImportedTerrain } from './assets';
import { playerColorHex } from './sprites';

/**
 * Resource dots without owned content. With it, the DAT's own
 * `minimap_color` per node is drawn (`ResourceNodeRules.minimapColor`).
 * Trees carry none, so their wood overlay uses the owned Forest terrain's
 * palette instead of overriding it with a colour sampled from a scaled image.
 */
const RESOURCE_COLORS: Record<string, string> = {
  food: '#c4506e',
  wood: '#298c21',
  gold: '#e8c04a',
  stone: '#9aa0a6',
};
function resourceColor(
  state: ReadonlyGameState, resource: string | undefined, node?: NodeKind,
  woodShade?: readonly [number, number, number],
): string {
  const kind = resource ?? 'wood';
  const own = state.rules.nodes[node ?? NODE_OF_RESOURCE[kind as ResourceKind]]?.minimapColor;
  const color = own ?? (kind === 'wood' ? woodShade : undefined);
  return color ? `rgb(${color[0]},${color[1]},${color[2]})` : RESOURCE_COLORS[kind];
}
/** A gaia animal in the DAT's own dot -- a sheep is food-green, not white. */
function gaiaColor(state: ReadonlyGameState, kind: string): string | undefined {
  const own = state.rules.units[kind as UnitKind]?.minimapColor;
  return own && `rgb(${own[0]},${own[1]},${own[2]})`;
}

/** AoE-style diamond minimap with fog, entity dots, and the camera diamond. */
/** Fog shades, as RGB triples so the per-tile buffer can be written directly. */
const UNEXPLORED = [0x00, 0x00, 0x00] as const;
const IN_SIGHT = [0x6f, 0x8f, 0x4a] as const;
const WATER = [0x38, 0x78, 0xa8] as const;
const ROAD = [0xa8, 0x7d, 0x4e] as const;
const FOREST = [0x31, 0x5f, 0x35] as const;
const REMEMBERED_FACTOR = 0.55;

/** DAT shade index: light, flat, dark. The human's editor reference (2026-09-22)
 * shows light on screen-right-facing slopes. With +x down-left and +y
 * down-right, the corresponding height gradient is +dx - dy, not -dx - dy.
 * The discrete gradient classifier remains an approximation (ledger #96). */
export function minimapReliefShade(
  state: Pick<ReadonlyGameState, 'width' | 'height' | 'elevation'>, x: number, y: number,
): 0 | 1 | 2 {
  const tx = Math.max(0, Math.min(state.width - 1, Math.floor(x)));
  const ty = Math.max(0, Math.min(state.height - 1, Math.floor(y)));
  const centre = state.elevation?.[ty * state.width + tx] ?? 0;
  const sample = (dx: number, dy: number) => state.elevation?.[
    Math.max(0, Math.min(state.height - 1, ty + dy)) * state.width
    + Math.max(0, Math.min(state.width - 1, tx + dx))
  ] ?? centre;
  const gradient = sample(1, 0) - sample(-1, 0) + sample(0, -1) - sample(0, 1);
  return gradient > 1e-6 ? 0 : gradient < -1e-6 ? 2 : 1;
}

function reliefColor(state: ReadonlyGameState, x: number, y: number, slot: ImportedTerrain) {
  return slot.minimapShades?.[minimapReliefShade(state, x, y)] ?? slot.minimapColor;
}

/** Compact building dot: 2 backing pixels become about 3px in the owned
 * 2000px-wide HUD (MapView is 720 reference pixels, our buffer 240).
 * Measured against hud-bottom-2026-09-17.png, not a world-space footprint.
 * Live and remembered buildings use this same marker. */
const BUILDING_DOT_SIZE = 2;

/** Keep resources at roughly one map tile rather than a fixed three pixels.
 * A fixed dot made each Windsor tree cover about 10 surveyed tiles and turned
 * its minimap into an apparently solid forest. */
export function minimapResourceDotSize(width: number, height: number): number {
  return Math.max(1, Math.min(3, 360 / Math.max(width, height)));
}

export class Minimap {
  private context: CanvasRenderingContext2D;
  /** Flares dropped on the map: where, and when they were lit (ms). */
  private flares: { x: number; y: number; at: number }[] = [];

  /**
   * Terrain and fog, one pixel per tile on an axis-aligned buffer. Drawing a
   * diamond path per tile is what the minimap used to do, and on a full-size
   * map that is fourteen thousand paths several times a second — measured at
   * half the frame rate of everything else in the game put together. The
   * isometric mapping is linear, so the whole buffer can be laid down in one
   * `drawImage` under the matrix that reproduces it exactly.
   */
  private tiles?: { canvas: HTMLCanvasElement; image: ImageData };

  constructor(private canvas: HTMLCanvasElement, public player: PlayerId = 1) {
    this.context = canvas.getContext('2d')!;
  }

  /**
   * Minimap colour per terrain id, from the DAT's own `colors` field, built
   * once per asset set. Three ids were hardcoded, which was fine while the
   * board was grass, forest, water and road; a biome dresses the ground in a
   * dozen terrains and every one of them drew as plain ground.
   */
  private terrainColors(assets?: ContentAssets): Map<number, ImportedTerrain> {
    if (this.colors && this.colorSource === assets?.terrain) return this.colors;
    const colors = new Map<number, ImportedTerrain>();
    for (const slot of Object.values(assets?.terrain ?? {})) {
      if (slot.minimapColor) colors.set(slot.terrainId, slot);
    }
    this.colors = colors;
    this.colorSource = assets?.terrain;
    return colors;
  }
  private colors?: Map<number, ImportedTerrain>;
  private colorSource?: ContentAssets['terrain'];

  private terrain(state: ReadonlyGameState, reveal: boolean, assets?: ContentAssets): HTMLCanvasElement {
    if (this.tiles?.image.width !== state.width || this.tiles.image.height !== state.height) {
      const canvas = document.createElement('canvas');
      canvas.width = state.width;
      canvas.height = state.height;
      this.tiles = {
        canvas,
        image: canvas.getContext('2d')!.createImageData(state.width, state.height),
      };
    }
    const visibility = state.visibility[this.player];
    const palette = this.terrainColors(assets);
    const pixels = this.tiles.image.data;
    for (let index = 0; index < state.width * state.height; index++) {
      const terrain = state.terrain[index] ?? 0;
      const slot = palette.get(terrain);
      const base = (slot && reliefColor(state, index % state.width, Math.floor(index / state.width), slot))
        ?? (terrain === 1 ? WATER : terrain === 24 ? ROAD : terrain === 10 ? FOREST : IN_SIGHT);
      const unexplored = !reveal && visibility.explored[index] !== 1;
      const remembered = !reveal && !unexplored && visibility.visible[index] !== 1;
      const shade = unexplored ? UNEXPLORED : base;
      const factor = remembered ? REMEMBERED_FACTOR : 1;
      const at = index * 4;
      pixels[at] = shade[0] * factor;
      pixels[at + 1] = shade[1] * factor;
      pixels[at + 2] = shade[2] * factor;
      pixels[at + 3] = 255;
    }
    this.tiles.canvas.getContext('2d')!.putImageData(this.tiles.image, 0, 0);
    return this.tiles.canvas;
  }

  private toCanvas(state: ReadonlyGameState, x: number, y: number): { x: number; y: number } {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const scaleX = w / (state.width + state.height);
    const scaleY = h / (state.width + state.height);
    return {
      x: w / 2 + (y - x) * scaleX,
      y: (x + y) * scaleY,
    };
  }

  fromCanvas(state: ReadonlyGameState, cx: number, cy: number): Point {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const scaleX = w / (state.width + state.height);
    const scaleY = h / (state.width + state.height);
    const dx = (cx - w / 2) / scaleX;
    const dy = cy / scaleY;
    return { x: (dy - dx) / 2, y: (dy + dx) / 2 };
  }

  /**
   * `assets` is what makes a player's dot the colour the DAT gives them --
   * the manifest carries each player's own `minimapColor`, pure blue and pure
   * red, where the open-content fallback picks its own softer pair.
   */
  draw(
    state: ReadonlyGameState, viewCenter: Point, viewTiles: { w: number; h: number },
    assets?: ContentAssets,
    /** Debug reveal: shade and draw everything as if seen (view-only). */
    reveal = false,
  ): void {
    const ctx = this.context;
    const ownerColor = (owner: number): string =>
      playerColorHex(assets, owner) ?? '#ffffff';
    const visibility = state.visibility[this.player];
    const resourceDotSize = minimapResourceDotSize(state.width, state.height);
    const forest = this.terrainColors(assets).get(10); // owned Forest terrain slot
    const woodShade = (x: number, y: number) => forest && reliefColor(state, x, y, forest);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Terrain and fog, as one image under the same mapping `toCanvas` applies:
    // (x, y) -> (w/2 + (y - x) * scaleX, (x + y) * scaleY), which is linear and
    // so is exactly a canvas transform.
    const scaleX = this.canvas.width / (state.width + state.height);
    const scaleY = this.canvas.height / (state.width + state.height);
    ctx.save();
    ctx.setTransform(-scaleX, scaleY, scaleX, scaleY, this.canvas.width / 2, 0);
    ctx.drawImage(this.terrain(state, reveal, assets), 0, 0);
    ctx.restore();

    // Entities: live visible ones plus remembered snapshots.
    const drawDot = (x: number, y: number, color: string, size: number) => {
      const p = this.toCanvas(state, x, y);
      ctx.fillStyle = color;
      ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    };
    const drawBuilding = (kind: EntityKind, x: number, y: number, color: string): boolean => {
      if (!isBuilding(kind)) return false;
      if (state.rules.buildings[kind].minimapMode !== 0) {
        const p = this.toCanvas(state, x, y);
        ctx.fillStyle = color;
        // Snapping prevents an extra antialiased fringe around a two-pixel dot.
        ctx.fillRect(Math.round(p.x - BUILDING_DOT_SIZE / 2), Math.round(p.y - BUILDING_DOT_SIZE / 2),
          BUILDING_DOT_SIZE, BUILDING_DOT_SIZE);
      }
      return true;
    };
    for (const entity of state.entities) {
      if (entity.dead) continue;
      const index = Math.floor(entity.position.y) * state.width + Math.floor(entity.position.x);
      const visible = reveal || visibility.visible[index] === 1;
      if (entity.owner !== this.player && !visible) continue;
      if (entity.owner === this.player || visible) {
        const color = entity.kind === 'resource'
          ? resourceColor(state, entity.resourceKind, entity.node,
            entity.resourceKind === 'wood' ? woodShade(entity.position.x, entity.position.y) : undefined)
          : (entity.owner === 0 && gaiaColor(state, entity.kind)) || ownerColor(entity.owner);
        if (drawBuilding(entity.kind, entity.position.x, entity.position.y, color)) continue;
        const size = entity.kind === 'resource' ? resourceDotSize : 2.5;
        drawDot(entity.position.x, entity.position.y, color, size);
      }
    }
    for (const remembered of reveal ? [] : Object.values(visibility.memory)) {
      const index = Math.floor(remembered.y) * state.width + Math.floor(remembered.x);
      if (visibility.visible[index] === 1) continue;
      const color = remembered.kind === 'resource'
        ? resourceColor(state, remembered.resource, remembered.node,
          remembered.resource === 'wood' ? woodShade(remembered.x, remembered.y) : undefined)
        : (remembered.owner === 0 && gaiaColor(state, remembered.kind)) || ownerColor(remembered.owner);
      if (drawBuilding(remembered.kind, remembered.x, remembered.y, color)) continue;
      drawDot(
        remembered.x, remembered.y, color,
        remembered.kind === 'resource' ? resourceDotSize : 3,
      );
    }

    // Camera viewport diamond.
    ctx.strokeStyle = '#f5f0dc';
    ctx.lineWidth = 1;
    const corners = [
      this.toCanvas(state, viewCenter.x - viewTiles.w / 2, viewCenter.y - viewTiles.h / 2),
      this.toCanvas(state, viewCenter.x + viewTiles.w / 2, viewCenter.y - viewTiles.h / 2),
      this.toCanvas(state, viewCenter.x + viewTiles.w / 2, viewCenter.y + viewTiles.h / 2),
      this.toCanvas(state, viewCenter.x - viewTiles.w / 2, viewCenter.y + viewTiles.h / 2),
    ];
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (const corner of corners.slice(1)) ctx.lineTo(corner.x, corner.y);
    ctx.closePath();
    ctx.stroke();

    // Flares: a ring that pulses for a few seconds where somebody pointed.
    const now = performance.now();
    this.flares = this.flares.filter(flare => now - flare.at < FLARE_MS);
    for (const flare of this.flares) {
      const age = (now - flare.at) / FLARE_MS;
      const p = this.toCanvas(state, flare.x, flare.y);
      const radius = 3 + 6 * (0.5 + 0.5 * Math.sin(age * Math.PI * 8));
      ctx.strokeStyle = `rgba(255, 255, 255, ${(1 - age).toFixed(2)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** Drop a flare at a world point; it shows for `FLARE_MS`. */
  flare(x: number, y: number): void {
    this.flares.push({ x, y, at: performance.now() });
  }
}

/** How long a flare stays lit. Not in the owned files; a few seconds, as played. */
const FLARE_MS = 4000;
