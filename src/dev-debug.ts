/**
 * Dev-only text protocol into the live match, served over Vite's HMR
 * websocket. The dev server middleware (vite.config.ts) forwards HTTP
 * requests on /__debug here and returns whatever this module answers, so
 * an agent can interrogate real rendered state — simulation values, screen
 * positions, and actual canvas pixels — without a human playtest loop.
 *
 * Pixels cannot be copied out of a WebGPU canvas (drawImage/toDataURL return
 * blank), so captures re-render the scene into an offscreen RenderTarget and
 * read that back through the renderer. Row order and channel order of that
 * readback differ between the WebGPU and WebGL2 backends, so both are
 * calibrated once with a probe render instead of being assumed, and the target
 * is given the renderer's output colour space so the numbers are the ones on
 * screen rather than their linear counterparts.
 */

import * as THREE from 'three/webgpu';
import { gameTimeSeconds } from './sim/game';
import type { CommandResult } from './sim/game';
import type { Command, Entity, GameState, Point } from './sim/types';
import { colorStats, type ColorStats } from './dev-debug-stats';
import { worldToIso, TILE_W } from './view/iso';

export interface DebugContext {
  game(): GameState;
  cameraCenter(): Point;
  zoom(): number;
  selectedIds(): number[];
  /** Apply one public command, exactly as the UI and every strategy does. */
  apply(command: Command): CommandResult;
  select(ids: number[]): void;
  lookAt(point: Point): void;
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  views: Map<string, {
    animationState?: string;
    facing: number;
    playerColor?: string;
    color: { mesh?: { visible?: boolean; material?: unknown } };
    annexColors?: { mesh?: { visible?: boolean } }[];
  }>;
}

interface DebugQuery {
  type: 'sim' | 'entities' | 'pixels' | 'command' | 'select' | 'look';
  id?: number;
  owner?: number;
  kind?: string;
  entity?: number;
  rect?: [number, number, number, number];
  png?: boolean;
  command?: Command;
  ids?: number[];
}

export function installDebug(context: DebugContext): void {
  const hot = import.meta.hot!;

  hot.on('aoe:debug-request', async (message: { id: number; query: DebugQuery }) => {
    try {
      const result = await handle(message.query);
      hot.send('aoe:debug-response', { id: message.id, result });
    } catch (error) {
      const detail = error instanceof Error ? error.stack ?? error.message : String(error);
      hot.send('aoe:debug-response', { id: message.id, error: detail });
    }
  });

  /** Canvas-relative CSS-pixel position of a world point. */
  function toScreen(x: number, y: number): Point {
    const canvas = context.renderer.domElement;
    const center = context.cameraCenter();
    const zoom = context.zoom();
    const iso = worldToIso(x, y);
    return {
      x: (iso.x - center.x) * zoom + canvas.clientWidth / 2,
      y: -(iso.y - center.y) * zoom + canvas.clientHeight / 2,
    };
  }

  function describeEntity(entity: Entity): Record<string, unknown> {
    const screen = toScreen(entity.position.x, entity.position.y);
    const canvas = context.renderer.domElement;
    const view = context.views.get(`e${entity.id}`);
    const material = view?.color.mesh?.material as { color?: { getHexString(): string } } | undefined;
    // The player-colour pieces shade the owner's hue through the imported
    // palette ramp, so the hue is the view's, not a flat material colour. The
    // town center carries none on its body: its colour is all in the annexes.
    const colored = view?.color.mesh?.visible
      || view?.annexColors?.some(piece => piece.mesh?.visible);
    const colorTint = colored
      ? view!.playerColor ?? (material?.color ? `#${material.color.getHexString()}` : undefined)
      : undefined;
    return {
      id: entity.id,
      kind: entity.kind,
      owner: entity.owner,
      position: { x: round(entity.position.x), y: round(entity.position.y) },
      hp: entity.hp,
      maxHp: entity.maxHp,
      activity: entity.activity,
      order: entity.order.kind,
      selected: context.selectedIds().includes(entity.id),
      screen: { x: Math.round(screen.x), y: Math.round(screen.y) },
      onScreen: screen.x >= 0 && screen.x < canvas.clientWidth && screen.y >= 0 && screen.y < canvas.clientHeight,
      rendered: view !== undefined,
      animation: view?.animationState,
      facing: view ? round(view.facing) : undefined,
      colorTint,
    };
  }

  /** Screen box an entity's art plausibly covers, biased upward for sprites. */
  function entityRect(entity: Entity): [number, number, number, number] {
    const screen = toScreen(entity.position.x, entity.position.y);
    const size = (entity.radius * 2 + 1) * TILE_W * context.zoom();
    return [screen.x - size / 2, screen.y - size * 0.7, size, size];
  }

  /**
   * One probe render answers how this backend's readback is oriented: a red
   * quad covers the top half, so a dark first row means rows come back
   * bottom-up, and red landing in byte 2 means channels come back as BGRA.
   */
  let orientation: Promise<{ flip: boolean; bgra: boolean }> | undefined;
  function calibrate(): Promise<{ flip: boolean; bgra: boolean }> {
    return (orientation ??= (async () => {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x000000);
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
      camera.position.z = 5;
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 1), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
      quad.position.y = 0.5;
      scene.add(quad);
      const raw = await renderAndRead(scene, camera, 4, 4, 0, 0, 4, 4);
      quad.geometry.dispose();
      quad.material.dispose();
      // Rows may come back packed (16 bytes) or padded to a 256-byte stride.
      const stride = raw.length === 4 * 4 * 4 ? 4 * 4 : 256;
      const flip = raw[0] + raw[2] <= 128; // dark first row = rows are bottom-up
      const lit = flip ? stride * 3 : 0;
      return { flip, bgra: raw[lit + 2] > raw[lit] };
    })());
  }

  async function renderAndRead(
    scene: THREE.Scene, camera: THREE.Camera,
    targetWidth: number, targetHeight: number,
    x: number, y: number, w: number, h: number,
  ): Promise<Uint8Array> {
    const renderer = context.renderer;
    const target = new THREE.RenderTarget(targetWidth, targetHeight);
    // A render target is linear by default, so the output transfer the canvas
    // applies would be skipped and every colour read back darker than the one
    // on screen. Ask for the renderer's own output space instead.
    target.texture.colorSpace = renderer.outputColorSpace;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(previous);
    const raw = await renderer.readRenderTargetPixelsAsync(target, x, y, w, h) as Uint8Array;
    target.dispose();
    return raw;
  }

  /** Rendered RGBA pixels for a CSS-pixel rect, top-to-bottom rows. */
  async function capturePixels(rect: [number, number, number, number]): Promise<{ data: Uint8ClampedArray<ArrayBuffer>; w: number; h: number }> {
    const canvas = context.renderer.domElement;
    const ratio = canvas.width / canvas.clientWidth;
    const x = Math.max(0, Math.round(rect[0] * ratio));
    const y = Math.max(0, Math.round(rect[1] * ratio));
    const w = Math.min(canvas.width - x, Math.round(rect[2] * ratio));
    const h = Math.min(canvas.height - y, Math.round(rect[3] * ratio));
    if (w <= 0 || h <= 0) throw new Error('capture rect is outside the canvas');
    const { flip, bgra } = await calibrate();
    const raw = await renderAndRead(
      context.scene, context.camera, canvas.width, canvas.height,
      x, flip ? canvas.height - y - h : y, w, h,
    );
    // The WebGPU backend returns rows padded to a 256-byte stride; the WebGL2
    // backend returns them packed. Detect by length rather than by backend.
    const packed = w * 4;
    const stride = raw.length === packed * h ? packed : Math.ceil(packed / 256) * 256;
    // Explicit ArrayBuffer so the result satisfies ImageData's element type.
    const data = new Uint8ClampedArray(new ArrayBuffer(packed * h));
    for (let row = 0; row < h; row++) {
      data.set(raw.subarray(row * stride, row * stride + packed), (flip ? h - 1 - row : row) * packed);
    }
    if (bgra) {
      for (let i = 0; i < data.length; i += 4) {
        const swap = data[i];
        data[i] = data[i + 2];
        data[i + 2] = swap;
      }
    }
    return { data, w, h };
  }

  async function handle(query: DebugQuery): Promise<unknown> {
    const game = context.game();
    if (query.type === 'sim') {
      const counts: Record<string, Record<string, number>> = {};
      for (const entity of game.entities) {
        if (entity.dead) continue;
        const byKind = (counts[`player${entity.owner}`] ??= {});
        byKind[entity.kind] = (byKind[entity.kind] ?? 0) + 1;
      }
      return {
        tick: game.tick,
        seconds: round(gameTimeSeconds(game)),
        winner: game.winner,
        players: Object.fromEntries(Object.entries(game.players).map(([id, player]) => [id, {
          food: player.food, wood: player.wood, gold: player.gold, stone: player.stone,
          population: player.population, populationCap: player.populationCap,
        }])),
        entities: counts,
        projectiles: game.projectiles.length,
      };
    }
    if (query.type === 'entities') {
      const matches = game.entities.filter(entity => !entity.dead
        && (query.id === undefined || entity.id === query.id)
        && (query.owner === undefined || entity.owner === query.owner)
        && (query.kind === undefined || entity.kind === query.kind));
      return { count: matches.length, entities: matches.slice(0, 200).map(describeEntity) };
    }
    if (query.type === 'pixels') {
      let rect = query.rect;
      if (query.entity !== undefined) {
        const entity = game.entities.find(e => e.id === query.entity && !e.dead);
        if (!entity) throw new Error(`no living entity ${query.entity}`);
        rect = entityRect(entity);
      }
      const canvas = context.renderer.domElement;
      rect ??= [0, 0, canvas.clientWidth, canvas.clientHeight];
      const { data, w, h } = await capturePixels(rect);
      if (query.png) {
        const scratch = document.createElement('canvas');
        scratch.width = w;
        scratch.height = h;
        scratch.getContext('2d')!.putImageData(new ImageData(data, w, h), 0, 0);
        return { png: scratch.toDataURL('image/png').split(',')[1], width: w, height: h };
      }
      const stats: ColorStats = colorStats(data);
      return { rect: rect.map(Math.round), devicePixels: [w, h], ...stats };
    }
    // Reading the match is not enough to verify how it renders: a corpse, a
    // rally flag, or a freshly trained unit only exists once someone plays.
    // These go through the same public entry points the UI uses, so nothing
    // here can reach a state a player could not.
    if (query.type === 'command') {
      if (!query.command) throw new Error('command query needs a `command`');
      return context.apply(query.command);
    }
    if (query.type === 'select') {
      const ids = query.ids ?? (query.entity !== undefined ? [query.entity] : []);
      context.select(ids);
      return { selected: context.selectedIds() };
    }
    if (query.type === 'look') {
      const entity = query.entity !== undefined
        ? game.entities.find(e => e.id === query.entity)
        : undefined;
      if (query.entity !== undefined && !entity) throw new Error(`no entity ${query.entity}`);
      const point = entity ? entity.position : { x: query.rect?.[0] ?? 0, y: query.rect?.[1] ?? 0 };
      context.lookAt(point);
      return { center: { x: round(point.x), y: round(point.y) } };
    }
    throw new Error(`unknown debug query type: ${(query as { type: string }).type}`);
  }
}

const round = (value: number): number => Math.round(value * 100) / 100;
