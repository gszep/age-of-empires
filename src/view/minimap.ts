import type { GameState, PlayerId, Point } from '../sim/types';
import type { ContentAssets } from './assets';
import { playerColorHex } from './sprites';

const RESOURCE_COLORS: Record<string, string> = {
  food: '#c4506e',
  wood: '#1f5426',
  gold: '#e8c04a',
  stone: '#9aa0a6',
};

/** AoE-style diamond minimap with fog, entity dots, and the camera diamond. */
/** Fog shades, as RGB triples so the per-tile buffer can be written directly. */
const UNEXPLORED = [0x00, 0x00, 0x00] as const;
const IN_SIGHT = [0x6f, 0x8f, 0x4a] as const;
const WATER = [0x38, 0x78, 0xa8] as const;
const ROAD = [0xa8, 0x7d, 0x4e] as const;
const FOREST = [0x31, 0x5f, 0x35] as const;
const REMEMBERED_FACTOR = 0.55;

/** Keep resources at roughly one map tile rather than a fixed three pixels.
 * A fixed dot made each Windsor tree cover about 10 surveyed tiles and turned
 * its minimap into an apparently solid forest. */
export function minimapResourceDotSize(width: number, height: number): number {
  return Math.max(1, Math.min(3, 360 / Math.max(width, height)));
}

export class Minimap {
  private context: CanvasRenderingContext2D;

  /**
   * Terrain and fog, one pixel per tile on an axis-aligned buffer. Drawing a
   * diamond path per tile is what the minimap used to do, and on a full-size
   * map that is fourteen thousand paths several times a second — measured at
   * half the frame rate of everything else in the game put together. The
   * isometric mapping is linear, so the whole buffer can be laid down in one
   * `drawImage` under the matrix that reproduces it exactly.
   */
  private tiles?: { canvas: HTMLCanvasElement; image: ImageData };

  constructor(private canvas: HTMLCanvasElement, private player: PlayerId = 1) {
    this.context = canvas.getContext('2d')!;
  }

  private terrain(state: GameState, reveal: boolean): HTMLCanvasElement {
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
    const pixels = this.tiles.image.data;
    for (let index = 0; index < state.width * state.height; index++) {
      const terrain = state.terrain[index] ?? 0;
      const base = terrain === 1 ? WATER : terrain === 24 ? ROAD : terrain === 10 ? FOREST : IN_SIGHT;
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

  private toCanvas(state: GameState, x: number, y: number): { x: number; y: number } {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const scaleX = w / (state.width + state.height);
    const scaleY = h / (state.width + state.height);
    return {
      x: w / 2 + (x - y) * scaleX,
      y: (x + y) * scaleY,
    };
  }

  fromCanvas(state: GameState, cx: number, cy: number): Point {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const scaleX = w / (state.width + state.height);
    const scaleY = h / (state.width + state.height);
    const dx = (cx - w / 2) / scaleX;
    const dy = cy / scaleY;
    return { x: (dy + dx) / 2, y: (dy - dx) / 2 };
  }

  /**
   * `assets` is what makes a player's dot the colour the DAT gives them --
   * the manifest carries each player's own `minimapColor`, pure blue and pure
   * red, where the open-content fallback picks its own softer pair.
   */
  draw(
    state: GameState, viewCenter: Point, viewTiles: { w: number; h: number },
    assets?: ContentAssets,
    /** Debug reveal: shade and draw everything as if seen (view-only). */
    reveal = false,
  ): void {
    const ctx = this.context;
    const ownerColor = (owner: number): string =>
      playerColorHex(assets, owner) ?? '#ffffff';
    const visibility = state.visibility[this.player];
    const resourceDotSize = minimapResourceDotSize(state.width, state.height);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Terrain and fog, as one image under the same mapping `toCanvas` applies:
    // (x, y) -> (w/2 + (x - y) * scaleX, (x + y) * scaleY), which is linear and
    // so is exactly a canvas transform.
    const scaleX = this.canvas.width / (state.width + state.height);
    const scaleY = this.canvas.height / (state.width + state.height);
    ctx.save();
    ctx.setTransform(scaleX, scaleY, -scaleX, scaleY, this.canvas.width / 2, 0);
    ctx.drawImage(this.terrain(state, reveal), 0, 0);
    ctx.restore();

    // Entities: live visible ones plus remembered snapshots.
    const drawDot = (x: number, y: number, color: string, size: number) => {
      const p = this.toCanvas(state, x, y);
      ctx.fillStyle = color;
      ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    };
    for (const entity of state.entities) {
      if (entity.dead) continue;
      const index = Math.floor(entity.position.y) * state.width + Math.floor(entity.position.x);
      const visible = reveal || visibility.visible[index] === 1;
      if (entity.owner !== this.player && !visible) continue;
      if (entity.owner === this.player || visible) {
        const color = entity.kind === 'resource'
          ? RESOURCE_COLORS[entity.resourceKind ?? 'wood']
          : ownerColor(entity.owner);
        const size = entity.kind === 'town-center' ? 6
          : entity.kind === 'resource' ? resourceDotSize : entity.radius > 0.5 ? 5 : 2.5;
        drawDot(entity.position.x, entity.position.y, color, size);
      }
    }
    for (const remembered of reveal ? [] : Object.values(visibility.memory)) {
      const index = Math.floor(remembered.y) * state.width + Math.floor(remembered.x);
      if (visibility.visible[index] === 1) continue;
      const color = remembered.kind === 'resource'
        ? RESOURCE_COLORS[remembered.resource ?? 'wood']
        : ownerColor(remembered.owner);
      drawDot(
        remembered.x, remembered.y, color,
        remembered.kind === 'town-center' ? 6
          : remembered.kind === 'resource' ? resourceDotSize : 3,
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
  }
}
