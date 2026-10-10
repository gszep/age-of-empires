import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { applyCommand, createGame } from '../sim/game';
import { synchronizationHash } from '../shared/checksum';
import { worldToIso, isoDepth } from './iso';
import { spriteLayerOrder } from './render-order';
import { SpriteResidency } from './sprite-residency';
import { effectSample, EffectPlayer } from './effects';
import { detectEffectTriggers, type ViewSnapshot } from './effect-triggers';
import type { ParticleEffect, Atlas, ContentAssets, ImportedEntity } from './assets';

const mockAtlas: Atlas = { image: 'test', size: [100, 100], framesInFile: 4,
  frames: Array.from({ length: 4 }, (_, i) => ({ x: i * 20, y: 0, w: 20, h: 30, cx: 3, cy: 7 })) };
const assetsFor = (effect: ParticleEffect): ContentAssets => ({
  particles: { test: effect }, textures: new Map([['test', new THREE.Texture()]]),
  entities: {}, ages: [], skins: new Map(), terrain: {}, playerRamps: new Map(),
});

const baseEffect: ParticleEffect = {
  atlas: mockAtlas,
  loop: false,
  cycleSeconds: [1, 1],
  fadeInSeconds: 0,
  fadeOutSeconds: 0,
};

describe('effectSample', () => {
  it('respects startDelay (sampled once per instance, but we pass explicit)', () => {
    const effect: ParticleEffect = { ...baseEffect };
    const sample1 = effectSample(effect, 0.5, 0.2); // age=0.3 adjusted
    expect(sample1.done).toBe(false);
    const sample2 = effectSample(effect, 0.1, 0.2); // age=-0.1 adjusted (before delay)
    expect(sample2.alpha).toBe(0);
  });

  it('Once type: ends after one cycle', () => {
    const effect: ParticleEffect = { ...baseEffect, loop: false, cycleSeconds: [1, 1] };
    const before = effectSample(effect, 0.5, 0); // age=0.5, not done
    expect(before.done).toBe(false);
    const at = effectSample(effect, 1.0, 0); // age=1.0, done
    expect(at.done).toBe(true);
    const after = effectSample(effect, 1.5, 0); // age=1.5, still done
    expect(after.done).toBe(true);
  });

  it('Loop type: never done until stopped', () => {
    const effect: ParticleEffect = { ...baseEffect, loop: true };
    const sample1 = effectSample(effect, 2.5, 0);
    expect(sample1.done).toBe(false);
    const sample2 = effectSample(effect, 10.0, 0);
    expect(sample2.done).toBe(false);
  });

  it('StartMode Fade: ramps alpha from 0 over startDuration', () => {
    const effect: ParticleEffect = { ...baseEffect, startMode: 'Fade', startDuration: 0.5 };
    const start = effectSample(effect, 0, 0);
    expect(start.alpha).toBe(0);
    const mid = effectSample(effect, 0.25, 0);
    expect(mid.alpha).toBeCloseTo(0.5, 2);
    const end = effectSample(effect, 0.5, 0);
    expect(end.alpha).toBeCloseTo(1, 2);
  });

  it('startMode Fade with startDuration takes priority over fadeInSeconds 0', () => {
    const effect: ParticleEffect = {
      ...baseEffect,
      startMode: 'Fade',
      startDuration: 0.5,
      fadeInSeconds: 0, // importer always emits this; should be ignored when startMode is Fade
    };
    const start = effectSample(effect, 0, 0);
    expect(start.alpha).toBe(0); // fade-in starts at 0
    const mid = effectSample(effect, 0.25, 0);
    expect(mid.alpha).toBeCloseTo(0.5, 2); // 0.25 / 0.5 = 0.5
    const end = effectSample(effect, 0.5, 0);
    expect(end.alpha).toBeCloseTo(1, 2); // 0.5 / 0.5 = 1
  });

  it('StopMode Fade: ramps alpha to 0 over stopDuration at cycle end (Once)', () => {
    const effect: ParticleEffect = {
      ...baseEffect,
      loop: false,
      cycleSeconds: [1, 1],
      stopMode: 'Fade',
      stopDuration: 0.5,
    };
    const beforeEnd = effectSample(effect, 0.9, 0);
    expect(beforeEnd.done).toBe(false);
    expect(beforeEnd.alpha).toBeCloseTo(1, 2);

    const stopStart = effectSample(effect, 1.0, 0); // at cycle end, stopMode begins
    expect(stopStart.done).toBe(false); // player must retain the mesh through the fade
    expect(stopStart.alpha).toBeCloseTo(1, 2); // just started stopping

    const stopMid = effectSample(effect, 1.25, 0); // 0.25s into stop fade
    expect(stopMid.alpha).toBeCloseTo(0.5, 2);

    const stopEnd = effectSample(effect, 1.5, 0); // stop complete
    expect(stopEnd.alpha).toBeCloseTo(0, 2);
    expect(stopEnd.done).toBe(true);
  });

  it('alpha/alphaStart->alphaEnd: interpolates over cycle', () => {
    const effect: ParticleEffect = {
      ...baseEffect,
      alphaStart: 0,
      alphaEnd: 1,
      cycleSeconds: [1, 1],
    };
    const start = effectSample(effect, 0, 0);
    expect(start.alpha).toBe(0);
    const mid = effectSample(effect, 0.5, 0);
    expect(mid.alpha).toBeCloseTo(0.5, 2);
    const end = effectSample(effect, 1.0, 0);
    expect(end.alpha).toBeCloseTo(1, 2);
  });

  it('clamps final opacity to ≤1', () => {
    const effect: ParticleEffect = { ...baseEffect, alpha: 2.0 };
    const sample = effectSample(effect, 0.5, 0);
    expect(sample.alpha).toBeLessThanOrEqual(1);
  });

  it('frame index: cycles through frames', () => {
    const effect: ParticleEffect = {
      ...baseEffect,
      atlas: { ...mockAtlas, framesInFile: 4 },
      cycleSeconds: [1, 1],
    };
    const f0 = effectSample(effect, 0, 0);
    expect(f0.frame).toBe(0);
    const f1 = effectSample(effect, 0.25, 0);
    expect(f1.frame).toBe(1);
    const f3 = effectSample(effect, 0.75, 0);
    expect(f3.frame).toBe(3);
    const loop = effectSample({ ...effect, loop: true }, 1.25, 0);
    expect(loop.frame).toBe(1);
  });
});

describe('EffectPlayer', () => {
  for (const cancel of [false, true]) {
    it(`research glow waiting beyond two seconds ${cancel ? 'is disposed on stop before readiness' : 'appears when its texture arrives'}`, () => {
      const game = createGame(49);
      const building = game.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
      expect(building).toBeDefined();
      const assets = assetsFor({ ...baseEffect, loop: true, timer: 'Real' });
      assets.textures.clear();
      const player = new EffectPlayer(game.seed, assets);
      let snapshot: ViewSnapshot | undefined;
      const sync = (now: number) => {
        const result = detectEffectTriggers(game, snapshot, e => ({ visible: true,
          imported: e.id === building.id ? { researchingEffect: 'test' } as ImportedEntity : undefined }));
        snapshot = result.snapshot;
        for (const request of result.effects) {
          if (request.type === 'start') player.start(request.entityId, request.name, request.position, 0, now);
          else if (request.type === 'stop') player.stop(request.entityId, 0, now);
          else player.spawn(request.name, request.position, 0, now, { entityId: request.entityId });
        }
        player.update(0, now, snapshot.visibleIds);
        return result.effects.map(e => e.type);
      };
      expect(sync(0)).toEqual([]);
      game.players[1].gold = 100;
      expect(applyCommand(game, { kind: 'research', player: 1, buildingId: building.id, tech: 'loom' }).ok).toBe(true);
      expect(sync(0)).toEqual(['start']);
      expect(sync(3)).toEqual([]); // No repeated start request will rescue a dropped loop.
      expect(building.researching?.tech).toBe('loom');
      expect(player.group.children).toHaveLength(1);
      const mesh = player.group.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
      expect(mesh.visible).toBe(false);
      if (cancel) {
        const geometry = vi.spyOn(mesh.geometry, 'dispose'), material = vi.spyOn(mesh.material, 'dispose');
        expect(applyCommand(game, { kind: 'cancel-research', player: 1, buildingId: building.id }).ok).toBe(true);
        expect(sync(3.5)).toEqual(['stop']);
        expect(player.group.children).toHaveLength(0);
        expect(geometry).toHaveBeenCalledOnce(); expect(material).toHaveBeenCalledOnce();
      }
      assets.textures.set('test', new THREE.Texture());
      expect(sync(4)).toEqual([]);
      expect(player.group.children).toHaveLength(cancel ? 0 : 1);
      if (!cancel) {
        expect(mesh.visible).toBe(true);
        expect(mesh.material.opacity).toBe(1);
        expect(sync(10)).toEqual([]);
        expect(player.group.children).toHaveLength(1);
        expect(mesh.visible).toBe(true);
      }
      player.reset(game.seed);
    });
  }

  it('starts a short effect when delayed textures arrive, not when it was requested', () => {
    const assets = assetsFor({ ...baseEffect, timer: 'Real', cycleSeconds: [.5, .5] });
    assets.textures.clear(); assets.loadTexture = vi.fn();
    const player = new EffectPlayer(1, assets);
    player.spawn('test', { x: 0, y: 0 }, 0, 100);
    player.update(0, 100.8);
    expect(player.group.children).toHaveLength(1);
    expect(player.group.children[0].visible).toBe(false);
    expect(assets.loadTexture).toHaveBeenCalledWith('test');
    assets.textures.set('test', new THREE.Texture());
    player.update(0, 101);
    expect(player.group.children[0].visible).toBe(true);
    player.update(0, 101.49); expect(player.group.children).toHaveLength(1);
    player.update(0, 101.5); expect(player.group.children).toHaveLength(0);
  });

  it('drops stale or cancelled waiting instances even while the game clock is paused', () => {
    const assets = assetsFor(baseEffect); assets.textures.clear();
    const player = new EffectPlayer(1, assets);
    player.spawn('test', { x: 0, y: 0 }, 0, 100);
    player.update(0, 102); expect(player.group.children).toHaveLength(0);
    assets.textures.set('test', new THREE.Texture());
    player.update(0, 103); expect(player.group.children).toHaveLength(0);
    assets.textures.clear();
    player.start(1, 'test', { x: 0, y: 0 }, 0, 104);
    player.stop(1, 0, 104.1); player.update(0, 104.1);
    expect(player.group.children).toHaveLength(0);
  });

  it('reloads evicted art on a later spawn without consuming its animation lifetime', () => {
    let now = 0;
    const assets = assetsFor({ ...baseEffect, timer: 'Real', cycleSeconds: [.5, .5] });
    const residency = new SpriteResidency(assets.textures, () => now);
    assets.spriteResidency = residency;
    const texture = new THREE.DataTexture(new Uint8Array(100 * 100 * 4), 100, 100);
    residency.add('test', texture);
    const player = new EffectPlayer(1, assets);
    player.spawn('test', { x: 0, y: 0 }, 0, 0); player.update(0, .1);
    expect(player.group.children[0].visible).toBe(true);
    player.update(0, .5);
    now = 121000; residency.sweep();
    expect(residency.stats.evictions).toBe(1); expect(assets.textures.has('test')).toBe(false);
    player.spawn('test', { x: 0, y: 0 }, 0, 121); player.update(0, 121.8);
    expect(player.group.children[0].visible).toBe(false);
    residency.add('test', new THREE.DataTexture(new Uint8Array(100 * 100 * 4), 100, 100));
    player.update(0, 122); expect(player.group.children[0].visible).toBe(true);
    player.update(0, 122.4); expect(player.group.children).toHaveLength(1);
    player.update(0, 122.5); expect(player.group.children).toHaveLength(0);
  });

  it('preloads short feedback flipbooks before the first command can expire on a texture miss', () => {
    const assets = assetsFor(baseEffect);
    assets.entities = { villager: { spawnEffect: 'test' } as any };
    assets.loadTexture = vi.fn();
    new EffectPlayer(1, assets);
    expect(assets.loadTexture).toHaveBeenCalledExactlyOnceWith('test');
  });

  it('preloads only brief Once feedback plus the UI one-shot idle pointer, once per image', () => {
    const assets = assetsFor(baseEffect);
    const named = (image: string, seconds: number, loop = false): ParticleEffect => ({
      ...baseEffect, atlas: { ...mockAtlas, image }, cycleSeconds: [seconds, seconds], loop,
    });
    assets.particles = {
      move: named('move.png', .5), spawn: named('spawn.png', 1),
      alias: named('spawn.png', 1), idlepointer: named('idle.png', 2, true),
      glow: named('research.png', 3, true), complete: named('research.png', 2.5),
      dust: named('dust.png', 6), shortLoop: named('loop.png', .5, true),
      upgrade: named('unused.png', 1), // Not part of the implemented feedback triggers.
    };
    assets.entities = {
      unit: { spawnEffect: 'spawn' } as ImportedEntity,
      alias: { spawnEffect: 'alias' } as ImportedEntity,
      building: { researchingEffect: 'glow', researchCompleteEffect: 'complete', constructionEffect: 'dust' } as ImportedEntity,
      other: { researchingEffect: 'shortLoop' } as ImportedEntity,
    };
    assets.loadTexture = vi.fn();
    new EffectPlayer(1, assets);
    expect(vi.mocked(assets.loadTexture).mock.calls.map(([image]) => image).sort())
      .toEqual(['idle.png', 'move.png', 'spawn.png']);
  });

  it('on-demand research completion reuses the resident glow texture and plays its full 2.5 seconds', () => {
    const assets = assetsFor(baseEffect);
    assets.textures.clear(); assets.loadTexture = vi.fn();
    const atlas = { ...mockAtlas, image: 'research.png' };
    assets.particles = {
      glow: { ...baseEffect, atlas, loop: true, timer: 'Real', cycleSeconds: [3, 3] },
      complete: { ...baseEffect, atlas, cycleSeconds: [2.5, 2.5] },
    };
    assets.entities = { building: { researchingEffect: 'glow', researchCompleteEffect: 'complete' } as ImportedEntity };
    const player = new EffectPlayer(1, assets);
    expect(assets.loadTexture).not.toHaveBeenCalled();
    player.start(7, 'glow', { x: 5, y: 8 }, 0, 0);
    expect(assets.loadTexture).toHaveBeenCalledWith('research.png');
    assets.textures.set('research.png', new THREE.Texture());
    player.update(0, 3); // Even a slow, >2s load can resolve a current research loop.
    expect(player.group.children[0].visible).toBe(true);
    vi.mocked(assets.loadTexture).mockClear();
    player.stop(7, 0, 4);
    player.spawn('complete', { x: 5, y: 8 }, 0, 4, { entityId: 7 });
    player.update(0, 4, new Set([7]));
    expect(player.group.children.map(m => [m.name, m.visible])).toEqual([['feedback:complete', true]]);
    player.update(2.1, 10, new Set([7])); // Neither the readiness cap nor removing the glow loses this page.
    expect(player.group.children[0].visible).toBe(true);
    expect(assets.textures.size).toBe(1);
    expect(assets.loadTexture).not.toHaveBeenCalled();
    player.update(2.5, 11, new Set([7]));
    expect(player.group.children).toHaveLength(0);
  });
  it('creates real pieces with a separate random stream without changing the simulation hash', () => {
    const game = createGame(49);
    const before = synchronizationHash(game);
    const player = new EffectPlayer(game.seed, assetsFor({ ...baseEffect, startDelay: [0.1, 0.3] }));
    for (let i = 0; i < 10; i++) player.spawn('test', { x: i, y: 20 }, 0);
    expect(player.group.children).toHaveLength(10);
    player.update(0.5);
    expect(player.group.children.every(m => m.visible)).toBe(true);
    expect(synchronizationHash(game)).toBe(before);
    player.update(2);
    expect(player.group.children).toHaveLength(0);
  });

  it('open fallback is a graceful no-op', () => {
    const player = new EffectPlayer(42);
    player.spawn('missing', { x: 0, y: 0 }, 0);
    player.start(1, 'missing', { x: 0, y: 0 }, 0);
    player.stop(1, 1); player.update(2);
    expect(player.group.children).toHaveLength(0);
  });

  it('uses Real time while paused and game time for other effects, preserving hotspots and elevation', () => {
    const player = new EffectPlayer(1, assetsFor({ ...baseEffect, timer: 'Real' }));
    const point = { x: 5, y: 8 }, iso = worldToIso(5, 8);
    player.spawn('test', point, 0, 100);
    player.update(0, 100.5, undefined, () => 12);
    const mesh = player.group.children[0] as THREE.Mesh;
    expect(mesh.visible).toBe(true);
    expect(mesh.position.x).toBe(iso.x + 10 - 3);
    expect(mesh.position.y).toBe(iso.y - 15 + 7 + 12);
    player.update(0, 101);
    expect(player.group.children).toHaveLength(0);
    const timed = new EffectPlayer(1, assetsFor(baseEffect));
    timed.spawn('test', point, 0, 100); timed.update(0, 200);
    expect(timed.group.children).toHaveLength(1);
    timed.update(1, 200); expect(timed.group.children).toHaveLength(0);
  });

  it('keyed loops deduplicate, stop with fade, restart, and dispose owned geometry/materials only', () => {
    const assets = assetsFor({ ...baseEffect, loop: true, stopMode: 'Fade', stopDuration: 0.5 });
    const player = new EffectPlayer(1, assets);
    player.start(7, 'test', { x: 5, y: 8 }, 0);
    player.start(7, 'test', { x: 5, y: 8 }, 0);
    expect(player.group.children).toHaveLength(1);
    const mesh = player.group.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    const geometry = vi.spyOn(mesh.geometry, 'dispose'), material = vi.spyOn(mesh.material, 'dispose');
    const texture = vi.spyOn(assets.textures.get('test')!, 'dispose');
    player.stop(7, 10); player.update(10.25);
    expect(mesh.material.opacity).toBeCloseTo(.5);
    expect(mesh.visible).toBe(true);
    player.update(10.5);
    expect(player.group.children).toHaveLength(0);
    expect(geometry).toHaveBeenCalledOnce(); expect(material).toHaveBeenCalledOnce(); expect(texture).not.toHaveBeenCalled();
    player.start(7, 'test', { x: 5, y: 8 }, 11);
    expect(player.group.children).toHaveLength(1);
    player.reset(2); expect(player.group.children).toHaveLength(0);
  });

  it('culls loops AND one-shots immediately on visibility loss, never leaking a stop fade', () => {
    const player = new EffectPlayer(1, assetsFor({ ...baseEffect, loop: true, stopMode: 'Fade', stopDuration: 2 }));
    player.start(7, 'test', { x: 0, y: 0 }, 0);
    player.spawn('test', { x: 0, y: 0 }, 0, 0, { entityId: 7, once: true });
    player.update(.2, .2, new Set([7]));
    expect(player.group.children).toHaveLength(2);
    expect(player.group.children.every(m => m.visible)).toBe(true);
    player.update(.3, .3, new Set());
    expect(player.group.children).toHaveLength(0);
  });

  it('retains Once meshes through the stop fade and bounds the inferred idle-pointer lifetime', () => {
    const player = new EffectPlayer(1, assetsFor({ ...baseEffect, stopMode: 'Fade', stopDuration: .5 }));
    player.spawn('test', { x: 0, y: 0 }, 0); player.update(1.25);
    expect(player.group.children).toHaveLength(1);
    expect((player.group.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>).material.opacity).toBeCloseTo(.5);
    player.update(1.5); expect(player.group.children).toHaveLength(0);
    const idle = new EffectPlayer(1, assetsFor({ ...baseEffect, loop: true }));
    idle.spawn('test', { x: 0, y: 0 }, 0, 0, { once: true });
    idle.update(.5); expect(idle.group.children).toHaveLength(1);
    idle.update(1); expect(idle.group.children).toHaveLength(0);
  });

  it('Terrain draws below units and Top above them, rather than both at depth zero', () => {
    for (const layer of ['Terrain', 'Top']) {
      const player = new EffectPlayer(1, assetsFor({ ...baseEffect, layer }));
      player.spawn('test', { x: 5, y: 8 }, 0); player.update(.5);
      const order = player.group.children[0].renderOrder, unitOrder = spriteLayerOrder(isoDepth(5, 8));
      expect(layer === 'Terrain' ? order < unitOrder : order > unitOrder).toBe(true);
    }
  });
});
