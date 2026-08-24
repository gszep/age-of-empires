import type { GameState, PlayerId, Point } from '../sim/types';
import { PLAYER_COLORS } from './sprites';

const RESOURCE_COLORS: Record<string, string> = {
  food: '#c4506e',
  wood: '#1f5426',
  gold: '#e8c04a',
  stone: '#9aa0a6',
};

/** AoE-style diamond minimap with fog, entity dots, and the camera diamond. */
export class Minimap {
  private context: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement, private player: PlayerId = 1) {
    this.context = canvas.getContext('2d')!;
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

  draw(state: GameState, viewCenter: Point, viewTiles: { w: number; h: number }): void {
    const ctx = this.context;
    const visibility = state.visibility[this.player];
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Terrain and fog per tile.
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const index = y * state.width + x;
        const explored = visibility.explored[index] === 1;
        const visible = visibility.visible[index] === 1;
        ctx.fillStyle = !explored ? '#000000' : visible ? '#6f8f4a' : '#3c4d2c';
        const a = this.toCanvas(state, x, y);
        const b = this.toCanvas(state, x + 1, y);
        const c = this.toCanvas(state, x + 1, y + 1);
        const d = this.toCanvas(state, x, y + 1);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y);
        ctx.lineTo(d.x, d.y);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Entities: live visible ones plus remembered snapshots.
    const drawDot = (x: number, y: number, color: string, size: number) => {
      const p = this.toCanvas(state, x, y);
      ctx.fillStyle = color;
      ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    };
    for (const entity of state.entities) {
      if (entity.dead) continue;
      const index = Math.floor(entity.position.y) * state.width + Math.floor(entity.position.x);
      const visible = visibility.visible[index] === 1;
      if (entity.owner !== this.player && !visible) continue;
      if (entity.owner === this.player || visible) {
        const color = entity.kind === 'resource'
          ? RESOURCE_COLORS[entity.resourceKind ?? 'wood']
          : `#${PLAYER_COLORS[entity.owner].toString(16).padStart(6, '0')}`;
        const size = entity.kind === 'town-center' ? 6 : entity.kind === 'resource' ? 3 : entity.radius > 0.5 ? 5 : 2.5;
        drawDot(entity.position.x, entity.position.y, color, size);
      }
    }
    for (const remembered of Object.values(visibility.memory)) {
      const index = Math.floor(remembered.y) * state.width + Math.floor(remembered.x);
      if (visibility.visible[index] === 1) continue;
      const color = remembered.kind === 'resource'
        ? RESOURCE_COLORS[remembered.resource ?? 'wood']
        : `#${PLAYER_COLORS[remembered.owner].toString(16).padStart(6, '0')}`;
      drawDot(remembered.x, remembered.y, color, remembered.kind === 'town-center' ? 6 : 3);
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
