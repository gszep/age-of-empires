import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { type Atlas, type ContentAssets } from './assets';
import { createProjectileView, updateProjectileView } from './sprites';
import { worldToIso } from './iso';

const atlas = (image: string, widths = [8, 12]): Atlas => ({ image, size: [32, 8], framesInFile: widths.length, scale: 2,
  frames: widths.map(w => ({ x: 0, y: 0, w, h: w ? 8 : 0, cx: w / 2, cy: 4 })) });
const animation = { frames: 2, directions: 1, frameSeconds: .1, mirroringMode: 0 };
function fixture(): ContentAssets {
  return {
    textures: new Map([['ball', new THREE.Texture()], ['arrow', new THREE.Texture()], ['impact', new THREE.Texture()]]),
    entities: {
      'naval-cannonball': { category: 'projectile', projectile: { arc: 0 },
        animations: { idle: animation, ball: { ...animation, frameSeconds: .2, alpha: .8 } },
        atlases: { idle: atlas('shadow-only', [0, 0]), ball: atlas('ball') },
        animationLayers: { idle: [{ animation: 'idle', x: 0, y: 0 }, { animation: 'ball', x: 4, y: -6 }] } },
      arrow: { category: 'projectile', projectile: { arc: 0 },
        animations: { idle: { ...animation, frames: 3, frameSeconds: 0 } }, atlases: { idle: atlas('arrow', [4, 8, 12]) } },
    },
    particles: { impact: { atlas: atlas('impact'), loop: false, cycleSeconds: [1, 1], fadeInSeconds: 0, fadeOutSeconds: 0 } },
    skins: new Map(), playerRamps: new Map(), terrain: {}, ages: [],
  };
}

describe('composite projectile flight (#297)', () => {
  it('draws the ball after an empty leading layer with its own clock, scale, offsets and projectile height', () => {
    const assets = fixture(), view = createProjectileView(), point = { x: 20, y: 10 };
    const iso = worldToIso(point.x, point.y);
    updateProjectileView(view, assets, point, 0, .5, 10, 2, 'naval-cannonball', .1, 7);
    expect(view.body.mesh.visible).toBe(false);
    const ball = view.annexes[0];
    expect(ball.mesh.visible).toBe(true);
    expect(ball.textureImage).toBe('ball');
    expect(ball.mesh.scale.x).toBe(4); // .1 is still the ball's first .2s frame
    expect(ball.mesh.position.x).toBe(iso.x + 4);
    expect(ball.mesh.position.y).toBe(iso.y + 24 + 7 + 6);
    expect((ball.mesh.material as THREE.MeshBasicMaterial).opacity).toBe(.8);
    updateProjectileView(view, assets, point, 0, .5, 10, 2, 'naval-cannonball', .2, 7);
    expect(ball.mesh.scale.x).toBe(6);
    expect(ball.mesh.position.y).toBe(iso.y + 24 + 7 + 6); // offsets do not accumulate
  });

  it('requests a cold secondary page, draws it on arrival, and suppresses intentionally empty frames', () => {
    const assets = fixture(), view = createProjectileView(), requested: string[] = [];
    assets.textures.delete('ball'); assets.loadTexture = image => { requested.push(image); };
    updateProjectileView(view, assets, { x: 0, y: 0 }, 0, .5, 10, 0, 'naval-cannonball', 0);
    expect(requested).toEqual(['ball']); // no request for the empty shadow-only body
    expect(view.annexes[0].mesh.visible).toBe(false);
    expect(view.annexes[0].pendingTexture).toBe('ball');
    assets.textures.set('ball', new THREE.Texture());
    updateProjectileView(view, assets, { x: 0, y: 0 }, 0, .5, 10, 0, 'naval-cannonball', 0);
    expect(view.annexes[0].mesh.visible).toBe(true);
    assets.entities['naval-cannonball'].atlases.ball.frames[1].w = 0;
    updateProjectileView(view, assets, { x: 0, y: 0 }, 0, .5, 10, 0, 'naval-cannonball', .2);
    expect(view.annexes[0].mesh.visible).toBe(false);
    expect(view.annexes[0].textureImage).toBeUndefined();
  });

  it('retires composite layers when switching to an impact or a single-sheet projectile', () => {
    const assets = fixture(), view = createProjectileView();
    const draw = (key: string, impact?: string) => updateProjectileView(view, assets, { x: 0, y: 0 }, 0, .5, 10, 0, key, 0, 0, impact);
    draw('naval-cannonball');
    expect(view.annexes[0].mesh.visible).toBe(true);
    draw('naval-cannonball', 'impact');
    expect(view.body.textureImage).toBe('impact');
    expect(view.annexes[0].mesh.visible).toBe(false);
    expect(view.annexes[0].textureImage).toBeUndefined();
    draw('naval-cannonball'); draw('arrow');
    expect(view.body.mesh.visible).toBe(true);
    expect(view.frameIndex).toBe(1); // flat, unanimated arrow uses its pitch frame
    expect(view.body.mesh.scale.x).toBe(4);
    expect(view.annexes[0].mesh.visible).toBe(false);
    draw('missing-art');
    expect(view.body.textureImage).toBe('arrow'); // existing imported-arrow fallback
  });
});
