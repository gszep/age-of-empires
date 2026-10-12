import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { loadContentAssets, spriteTexture, type Atlas } from './assets';
import type { BcRenderer } from './bc-pages';

const BASE = '/imported/aoe2/';
const atlas = (name: string, format: 'bc1' | 'bc4' = 'bc1'): Atlas => ({
  image: `${name}.png`, size: [8, 8], bc: { image: `blocks/${name}.${format}`, format },
  frames: [{ x: 0, y: 0, w: 8, h: 8, cx: 4, cy: 4 }], framesInFile: 1,
});
const renderer = (enabled = true): BcRenderer => ({
  backend: { isWebGPUBackend: true }, hasFeature: vi.fn(() => enabled), initTexture: vi.fn(),
});

function fixture(atlases: Atlas[], extra = {}) {
  const manifest = { entities: { villager: { atlases: Object.fromEntries(atlases.map((a, i) => [i, a])) } }, ...extra };
  const fetcher = vi.fn(async (url: string) => url.endsWith('manifest.json')
    ? new Response(JSON.stringify(manifest)) : new Response(new Uint8Array(32)));
  vi.stubGlobal('fetch', fetcher);
  const png = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async () =>
    new THREE.Texture({ width: 8, height: 8 } as HTMLImageElement));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return { fetcher, png };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('BC sprite loading through the public cache', () => {
  it('bounds concurrent loads at four, drains >4 successes, deduplicates and reloads after eviction', async () => {
    const pages = Array.from({ length: 10 }, (_, i) => atlas(`page${i}`));
    const { fetcher, png } = fixture(pages);
    const assets = (await loadContentAssets(renderer()))!;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    fetcher.mockImplementation(async () => { await gate; return new Response(new Uint8Array(32)); });
    for (const page of pages) {
      assets.loadTexture!(page.image);
      assets.loadTexture!(page.image);
    }
    expect(fetcher).toHaveBeenCalledTimes(5); // manifest + four pages
    release();
    await vi.waitFor(() => expect(assets.textures.size).toBe(10));
    expect(fetcher).toHaveBeenCalledTimes(11);
    expect(png).not.toHaveBeenCalled();
    expect(assets.spriteResidency!.stats.bytes).toBe(10 * 32);
    const old = assets.textures.get('page0.png') as THREE.CompressedTexture;
    const dispose = vi.fn(); old.addEventListener('dispose', dispose);
    const now = performance.now();
    vi.spyOn(performance, 'now').mockReturnValue(now + 121_000);
    assets.spriteResidency!.sweep();
    expect(assets.textures.size).toBe(0);
    expect(dispose).toHaveBeenCalledOnce();
    expect(old.mipmaps).toEqual([]);
    expect(spriteTexture(assets, 'page0.png')).toBeUndefined();
    await vi.waitFor(() => expect(assets.textures.has('page0.png')).toBe(true));
    expect(assets.textures.get('page0.png')).not.toBe(old);
    expect(fetcher).toHaveBeenLastCalledWith(`${BASE}blocks/page0.bc1`);
    expect(assets.spriteResidency!.stats.bytes).toBe(32);
  });

  it('drains a mixed queue including fetch/size/upload failures and a failed PNG, under the original PNG keys', async () => {
    const names = ['bc', 'http', 'length', 'upload', 'network', 'both-fail', 'plain', 'shade-playercolor', 'mask', 'last'];
    const pages = names.map(name => atlas(name, name === 'mask' ? 'bc4' : 'bc1'));
    delete pages[6].bc; delete pages[7].bc;
    const { fetcher, png } = fixture(pages);
    const device = renderer();
    const assets = (await loadContentAssets(device))!;
    fetcher.mockImplementation(async url => {
      if (url.includes('http') || url.includes('both-fail')) return new Response('', { status: 404 });
      if (url.includes('network')) throw new Error('offline');
      const data = new Uint8Array(url.includes('length') ? 31 : 32);
      if (url.includes('upload')) data[0] = 99;
      return new Response(data);
    });
    const disposed = vi.fn();
    vi.mocked(device.initTexture).mockImplementation(texture => {
      if ((texture as THREE.CompressedTexture).mipmaps[0].data[0] === 99) {
        texture.addEventListener('dispose', disposed);
        throw new Error('upload failed');
      }
    });
    png.mockImplementation(async url => {
      if (url.includes('both-fail')) throw new Error('missing PNG');
      return new THREE.Texture({ width: 8, height: 8 } as HTMLImageElement);
    });
    pages.forEach(page => assets.loadTexture!(page.image));
    await vi.waitFor(() => expect(assets.textures.size).toBe(9));
    expect(disposed).toHaveBeenCalledOnce();
    expect(assets.textures.has('both-fail.png')).toBe(false);
    for (const name of names.filter(name => name !== 'both-fail')) {
      const texture = assets.textures.get(`${name}.png`)!;
      expect(!!(texture as THREE.CompressedTexture).isCompressedTexture).toBe(name === 'bc' || name === 'last');
      expect(texture.colorSpace).toBe(name === 'shade-playercolor' ? THREE.NoColorSpace : THREE.SRGBColorSpace);
      expect(texture.minFilter).toBe(THREE.LinearFilter);
      expect(texture.generateMipmaps).toBe(false);
    }
    expect(fetcher).not.toHaveBeenCalledWith(`${BASE}blocks/mask.bc4`);
    const attempts = png.mock.calls.length;
    assets.loadTexture!('both-fail.png'); // Existing failure backoff survives.
    expect(png).toHaveBeenCalledTimes(attempts);
    const now = performance.now();
    vi.spyOn(performance, 'now').mockReturnValue(now + 11_000);
    png.mockResolvedValue(new THREE.Texture({ width: 8, height: 8 } as HTMLImageElement));
    assets.loadTexture!('both-fail.png');
    await vi.waitFor(() => expect(assets.textures.size).toBe(10));
  });

  it('indexes profile main/multipage, root/profile annexes and particles after expansion', async () => {
    const root = atlas('root'), annex = atlas('annex'), civ = atlas('civ'), civAnnex = atlas('civ-annex');
    civ.pages = [civ, atlas('civ-p1')].map(({ image, size, bc }) => ({ image, size, bc }));
    const particle = atlas('particle');
    const { png, fetcher } = fixture([], {
      entities: { villager: { atlases: { main: root }, annexes: [{ atlases: { main: annex } }] } },
      civilizations: { inca: { entities: { villager: { atlases: { main: civ }, annexes: [{ atlases: { main: civAnnex } }] } } } },
      particles: { fire: { atlas: particle } },
    });
    const assets = (await loadContentAssets(renderer()))!;
    const pages = [root, annex, civ, civ.pages[1], civAnnex, particle];
    pages.forEach(page => assets.loadTexture!(page.image));
    await vi.waitFor(() => expect(assets.textures.size).toBe(6));
    expect(assets.entities['civilizations/inca/villager']).toBeDefined();
    for (const page of pages) expect(fetcher).toHaveBeenCalledWith(BASE + page.bc!.image);
    expect(png).not.toHaveBeenCalled();
  });

  it.each(['unsupported', 'forced', 'no-renderer', 'old-manifest'])('preserves PNG for %s and configures each fresh asset load (HMR)', async mode => {
    const page = atlas('sprite');
    if (mode === 'old-manifest') delete page.bc;
    const { fetcher, png } = fixture([page]);
    const device = mode === 'no-renderer' ? undefined : renderer(mode !== 'unsupported');
    for (let reload = 0; reload < 2; reload++) {
      const assets = (await loadContentAssets(device, mode === 'forced' ? '?textures=png' : ''))!;
      assets.loadTexture!(page.image);
      await vi.waitFor(() => expect(assets.textures.size).toBe(1));
      expect((assets.textures.get(page.image) as THREE.CompressedTexture).isCompressedTexture).toBeUndefined();
    }
    expect(fetcher).toHaveBeenCalledTimes(2); // manifests only
    expect(png).toHaveBeenCalledTimes(2);
  });
  it('reapplies supported capability and upload configuration on a fresh load', async () => {
    const page = atlas('sprite'), device = renderer();
    const { png } = fixture([page]);
    for (let reload = 0; reload < 2; reload++) {
      const assets = (await loadContentAssets(device))!;
      assets.loadTexture!(page.image);
      await vi.waitFor(() => expect(assets.textures.size).toBe(1));
      expect((assets.textures.get(page.image) as THREE.CompressedTexture).isCompressedTexture).toBe(true);
    }
    expect(device.hasFeature).toHaveBeenCalledTimes(2);
    expect(device.initTexture).toHaveBeenCalledTimes(2);
    expect(png).not.toHaveBeenCalled();
  });
});
