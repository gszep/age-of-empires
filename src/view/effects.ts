/** Cosmetic feedback owns its clocks, lifetime, geometry and random stream. */
import * as THREE from 'three/webgpu';
import type { ContentAssets, ParticleEffect } from './assets';
import { spriteTexture } from './assets';
import { makePiece, applyFrame } from './sprites';
import { groundLayerOrder, spriteLayerOrder, rallyLayerOrder } from './render-order';
import { isoDepth } from './iso';
import { random01, seedFrom } from '../sim/random';

export interface EffectSample { frame: number; alpha: number; done: boolean }
const cycleSeconds = (effect: ParticleEffect): number => Math.max(0.001, (effect.cycleSeconds[0] + effect.cycleSeconds[1]) / 2);
const stopSeconds = (effect: ParticleEffect): number => effect.stopMode === 'Fade' ? effect.stopDuration ?? effect.fadeOutSeconds : 0;

/** Once plays its flipbook then holds its last frame for the stop fade. */
export function effectSample(effect: ParticleEffect, ageSeconds: number, startDelaySeconds: number): EffectSample {
  const age = ageSeconds - startDelaySeconds;
  if (age < 0) return { frame: 0, alpha: 0, done: false };
  const cycle = cycleSeconds(effect), frames = Math.max(1, effect.atlas.framesInFile);
  const fadeIn = effect.startMode === 'Fade' ? effect.startDuration ?? effect.fadeInSeconds : effect.fadeInSeconds;
  const fadeOut = stopSeconds(effect);
  const frame = effect.loop ? Math.floor(age / cycle * frames) % frames : Math.min(frames - 1, Math.floor(age / cycle * frames));
  let alpha = effect.alpha ?? 1;
  if (fadeIn > 0) alpha *= Math.min(1, age / fadeIn);
  if (!effect.loop && age >= cycle && fadeOut > 0) alpha *= Math.max(0, 1 - (age - cycle) / fadeOut);
  if (effect.alphaStart !== undefined && effect.alphaEnd !== undefined) {
    alpha *= effect.alphaStart + (effect.alphaEnd - effect.alphaStart) * Math.min(1, age / cycle);
  }
  return { frame, alpha: Math.min(1, Math.max(0, alpha)), done: !effect.loop && age >= cycle + fadeOut };
}

interface ActiveEffect {
  definition: ParticleEffect;
  point: { x: number; y: number };
  piece: ReturnType<typeof makePiece>;
  started?: number;
  requestedReal: number;
  delay: number;
  entityId?: number;
  keyId?: number;
  stopped?: number;
  offsetY: number;
}

export class EffectPlayer {
  readonly group = new THREE.Group();
  private effects = new Set<ActiveEffect>();
  private keyed = new Map<number, ActiveEffect>();
  private random: { seed: number };

  constructor(seed: number, private assets?: ContentAssets) {
    this.random = { seed: seedFrom(seed ^ 0x49e7) };
    this.preload();
  }

  /** Warm only brief feedback. Idlepointer is explicitly played Once by the UI
   * despite its source Loop definition; large, long-lived effects load on demand. */
  private preload(): void {
    const names = new Set(['move', 'idlepointer']);
    for (const entity of Object.values(this.assets?.entities ?? {})) {
      for (const name of [entity.spawnEffect, entity.researchingEffect, entity.researchCompleteEffect, entity.constructionEffect]) {
        if (name) names.add(name);
      }
    }
    const images = new Set<string>();
    for (const name of names) {
      const effect = this.assets?.particles?.[name];
      if (!effect || (name !== 'idlepointer' && (effect.loop || Math.max(...effect.cycleSeconds) > 1))) continue;
      for (const page of effect.atlas.pages ?? [effect.atlas]) images.add(page.image);
    }
    for (const image of images) this.assets?.loadTexture?.(image);
  }

  private ready(effect: ParticleEffect): boolean {
    // Touch all pages while active, but do not permanently pin feedback art.
    // Visit every page even on a miss so multi-page loads start together.
    return (effect.atlas.pages ?? [effect.atlas]).map(page => !!spriteTexture(this.assets!, page.image)).every(Boolean);
  }

  spawn(name: string, point: { x: number; y: number }, gameSeconds: number, realSeconds = gameSeconds,
    options: { entityId?: number; keyId?: number; once?: boolean; offsetY?: number } = {}): void {
    const source = this.assets?.particles?.[name];
    if (!source) return; // Open fallback deliberately has no invented art.
    const definition = options.once ? { ...source, loop: false } : source;
    const piece = makePiece();
    piece.mesh.name = `feedback:${name}`;
    this.group.add(piece.mesh);
    const [low, high] = definition.startDelay ?? [0, 0];
    const active: ActiveEffect = { definition, piece, point: { ...point },
      started: this.ready(definition) ? (definition.timer === 'Real' ? realSeconds : gameSeconds) : undefined,
      requestedReal: realSeconds,
      delay: low + (high - low) * random01(this.random),
      entityId: options.entityId, keyId: options.keyId, offsetY: options.offsetY ?? 0 };
    this.effects.add(active);
    if (active.keyId !== undefined) this.keyed.set(active.keyId, active);
  }

  start(id: number, name: string, point: { x: number; y: number }, gameSeconds: number, realSeconds = gameSeconds): void {
    const old = this.keyed.get(id);
    if (old && old.stopped === undefined && old.piece.mesh.name === `feedback:${name}`) return;
    if (old) this.remove(old);
    this.spawn(name, point, gameSeconds, realSeconds, { entityId: id, keyId: id });
  }

  stop(id: number, gameSeconds: number, realSeconds = gameSeconds): void {
    const active = this.keyed.get(id);
    if (active && active.stopped === undefined) active.stopped = active.definition.timer === 'Real' ? realSeconds : gameSeconds;
  }

  private remove(active: ActiveEffect): void {
    this.group.remove(active.piece.mesh);
    active.piece.mesh.geometry.dispose();
    (active.piece.mesh.material as THREE.Material).dispose();
    this.effects.delete(active);
    if (active.keyId !== undefined) this.keyed.delete(active.keyId);
  }

  reset(seed: number): void {
    for (const active of this.effects) this.remove(active);
    this.random = { seed: seedFrom(seed ^ 0x49e7) };
  }

  setAssets(assets: ContentAssets | undefined): void {
    for (const active of this.effects) this.remove(active);
    this.assets = assets;
    this.preload();
  }

  update(gameSeconds: number, realSeconds = gameSeconds, visibleIds?: ReadonlySet<number>,
    elevation: (point: { x: number; y: number }) => number = () => 0): void {
    for (const active of this.effects) {
      const effect = active.definition;
      if (active.entityId !== undefined && visibleIds && !visibleIds.has(active.entityId)) {
        this.remove(active); continue;
      }
      const now = effect.timer === 'Real' ? realSeconds : gameSeconds;
      if (active.started === undefined) {
        // One-shots must not appear stale. Research loops remain current while
        // their key lives; stop/death/fog still dispose them before readiness.
        if ((!effect.loop && realSeconds - active.requestedReal >= 2) || active.stopped !== undefined) {
          this.remove(active); continue;
        }
        if (!this.ready(effect)) continue;
        active.started = now;
      } else if (!this.ready(effect)) {
        // Active pages are touched every frame; an unexpected loss must not
        // leave a disposed texture bound or restart a half-played cue.
        this.remove(active); continue;
      }
      const sample = effectSample(effect, now - active.started, active.delay);
      if (sample.done || (active.stopped !== undefined && now - active.stopped >= stopSeconds(effect))) {
        this.remove(active); continue;
      }
      if (active.stopped !== undefined) sample.alpha *= Math.max(0, 1 - (now - active.stopped) / stopSeconds(effect));
      // applyFrame preserves the source hotspot; never overwrite its position.
      applyFrame(active.piece, this.assets!, effect.atlas, sample.frame, active.point, 0xffffff);
      active.piece.mesh.position.y += elevation(active.point) + active.offsetY;
      const depth = isoDepth(active.point.x, active.point.y);
      active.piece.mesh.renderOrder = effect.layer === 'Terrain' ? groundLayerOrder(950, depth)
        : effect.layer === 'Top' ? rallyLayerOrder(depth) : spriteLayerOrder(depth, effect.sortBias ?? 0);
      (active.piece.mesh.material as THREE.Material).opacity = sample.alpha;
    }
  }
}
