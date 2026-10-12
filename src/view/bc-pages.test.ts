import { describe, it, expect, afterEach, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { bcSupported, forcePng, loadBcTexture, uploadBcTexture, type BcRenderer } from './bc-pages';
import { applyFrame } from './sprites';
import type { Atlas, ContentAssets } from './assets';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('r180 BC capability', () => {
  it.each([false, true])('uses initialized WebGPU hasFeature: %s', enabled => {
    const hasFeature = vi.fn(() => enabled);
    const renderer = { backend: { isWebGPUBackend: true, device: {} }, hasFeature, initTexture: vi.fn() };
    expect(bcSupported(renderer)).toBe(enabled);
    expect(hasFeature).toHaveBeenCalledWith('texture-compression-bc');
  });
  it.each([[], ['WEBGL_compressed_texture_s3tc'], ['WEBGL_compressed_texture_s3tc_srgb'],
    ['WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_rgtc'],
    ['WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_s3tc_srgb']] as string[][])('requires both WebGL S3TC extensions: %j', (...extensions: string[]) => {
    const renderer = { backend: { isWebGLBackend: true, extensions: { has: (name: string) => extensions.includes(name) } },
      hasFeature: vi.fn(() => true), initTexture: vi.fn() };
    expect(bcSupported(renderer)).toBe(extensions.includes('WEBGL_compressed_texture_s3tc')
      && extensions.includes('WEBGL_compressed_texture_s3tc_srgb'));
    expect(renderer.hasFeature).not.toHaveBeenCalled();
  });
  it('does not infer a backend from the renderer class or a top-level device', () => {
    expect(bcSupported({ backend: {}, hasFeature: vi.fn(() => true), initTexture: vi.fn() })).toBe(false);
  });
  it('forces PNG only for ?textures=png', () => {
    expect(forcePng('?textures=png')).toBe(true);
    expect(forcePng('?map=arabia&textures=png')).toBe(true);
    expect(forcePng('?textures=bc')).toBe(false);
    expect(forcePng('')).toBe(false);
  });
});

function blocks(data = new Uint8Array(32)) {
  const fetcher = vi.fn(async () => new Response(data));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

describe('raw BC pages', () => {
  it('sets the BC1 format, sRGB, filters and upload version before initialization', async () => {
    blocks();
    const upload = vi.fn(async (texture: THREE.CompressedTexture) => {
      expect(texture.version).toBe(1);
      expect(texture.flipY).toBe(false);
    });
    const texture = await loadBcTexture('page.bc1', 'bc1', [8, 8], upload);
    expect(texture?.format).toBe(THREE.RGBA_S3TC_DXT1_Format);
    expect(texture?.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(texture?.magFilter).toBe(THREE.LinearFilter);
    expect(texture?.minFilter).toBe(THREE.LinearFilter);
    expect(texture?.generateMipmaps).toBe(false);
    expect(upload).toHaveBeenCalledOnce();
  });
  it('keeps BC4 on the PNG path without fetching a red-only coverage texture', async () => {
    const fetcher = blocks();
    expect(await loadBcTexture('mask.bc4', 'bc4', [8, 8])).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([[250, 250], [0, 4], [-4, 4], [4, 4.5], [NaN, 4], [4, Infinity]])('rejects invalid dimensions %j before fetching', async (w, h) => {
    const fetcher = blocks();
    expect(await loadBcTexture('bad.bc1', 'bc1', [w, h])).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([31, 33])('rejects short AND long payloads (%i bytes)', async length => {
    blocks(new Uint8Array(length));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadBcTexture('bad.bc1', 'bc1', [8, 8])).toBeUndefined();
    expect(console.warn).toHaveBeenCalledOnce();
  });
  it('returns fallback on HTTP and network failures', async () => {
    const fetcher = blocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetcher.mockResolvedValueOnce(new Response('', { status: 404 }));
    expect(await loadBcTexture('missing.bc1', 'bc1', [8, 8])).toBeUndefined();
    fetcher.mockRejectedValueOnce(new Error('offline'));
    expect(await loadBcTexture('offline.bc1', 'bc1', [8, 8])).toBeUndefined();
  });
  it('disposes a failed upload and releases its CPU blocks', async () => {
    blocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let failed!: THREE.CompressedTexture;
    const disposed = vi.fn();
    const result = await loadBcTexture('page.bc1', 'bc1', [8, 8], async texture => {
      failed = texture;
      texture.addEventListener('dispose', disposed);
      throw new Error('upload');
    });
    expect(result).toBeUndefined();
    expect(disposed).toHaveBeenCalledOnce();
    expect(failed.mipmaps).toEqual([]);
    expect(failed.image).toBeNull();
  });
});

describe('pre-publication upload', () => {
  function gpu(error: GPUError | null = null, syncFailure = false) {
    const calls: string[] = [];
    const renderer: BcRenderer = {
      backend: { isWebGPUBackend: true, device: {
        pushErrorScope: (filter: string) => { calls.push(filter); },
        popErrorScope: () => { calls.push('pop'); return Promise.resolve(error); },
      } },
      hasFeature: vi.fn(() => true),
      initTexture: () => { calls.push('upload'); if (syncFailure) throw new Error('sync'); },
    };
    return { renderer, calls };
  }
  it('forces upload and pops all scopes before another concurrent upload starts', async () => {
    const { renderer, calls } = gpu();
    const a = uploadBcTexture(renderer, new THREE.CompressedTexture([], 4, 4));
    const b = uploadBcTexture(renderer, new THREE.CompressedTexture([], 4, 4));
    expect(calls).toEqual(Array(2).fill(['validation', 'out-of-memory', 'upload', 'pop', 'pop']).flat());
    await Promise.all([a, b]);
  });
  it('rejects asynchronous GPU validation/OOM errors and synchronous throws', async () => {
    for (const fixture of [gpu({ message: 'validation' }), gpu({ message: 'out-of-memory' }), gpu(null, true)]) {
      await expect(uploadBcTexture(fixture.renderer, new THREE.CompressedTexture([], 4, 4))).rejects.toThrow();
      expect(fixture.calls.slice(-2)).toEqual(['pop', 'pop']);
    }
  });
  it('rejects WebGL upload errors', async () => {
    await expect(uploadBcTexture({ backend: { isWebGLBackend: true, gl: { NO_ERROR: 0, getError: () => 1281 } },
      hasFeature: vi.fn(), initTexture: vi.fn() }, new THREE.CompressedTexture([], 4, 4))).rejects.toThrow('WebGL');
  });
});

describe('BC orientation through production applyFrame', () => {
  it('samples asymmetric top/down rows at multiple frame positions and page sizes, without changing PNG UVs', async () => {
    // Endpoints only: four coloured quadrants, and selectors varying vertically
    // inside EVERY block (top red/green/blue/white; bottom black).
    const makePage = (w: number, h: number) => {
      const data = new Uint8Array(w * h / 2);
      const endpoints = [0xf800, 0x07e0, 0x001f, 0xffff];
      for (let by = 0; by < h / 4; by++) for (let bx = 0; bx < w / 4; bx++) {
        const i = (by * w / 4 + bx) * 8, c = endpoints[(by % 2) * 2 + bx % 2];
        data[i] = c & 255; data[i + 1] = c >> 8;
        data[i + 6] = data[i + 7] = 0x55; // selector 1 (black), rows 2,3
      }
      return data;
    };
    const pages = [{ image: 'one.png', size: [8, 8] as [number, number] },
      { image: 'two.png', size: [16, 12] as [number, number] }];
    const textures = new Map<string, THREE.Texture>();
    const data = pages.map(p => makePage(...p.size));
    for (let p = 0; p < pages.length; p++) {
      blocks(data[p]);
      textures.set(pages[p].image, (await loadBcTexture('page.bc1', 'bc1', pages[p].size))!);
    }
    const assets = { textures } as ContentAssets;
    const atlas: Atlas = { ...pages[0], pages, framesInFile: 3, frames: [
      { x: 0, y: 0, w: 4, h: 4, cx: 0, cy: 0 },
      { x: 4, y: 4, w: 4, h: 4, cx: 0, cy: 0 },
      { x: 8, y: 4, w: 4, h: 4, cx: 0, cy: 0, page: 1 },
    ] };
    const piece = { mesh: new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()) };
    for (const [index, frame] of atlas.frames.entries()) {
      const p = frame.page ?? 0, page = pages[p], [w, h] = page.size;
      const bc = textures.get(page.image)!;
      applyFrame(piece, assets, atlas, index, { x: 0, y: 0 }, 0xffffff);
      const uv = piece.mesh.geometry.getAttribute('uv');
      const original = Array.from(uv.array);
      for (let corner = 0; corner < 4; corner++) {
        const sample = new THREE.Vector2(uv.getX(corner), uv.getY(corner)).applyMatrix3(bc.matrix);
        const x = Math.floor(sample.x * w), y = Math.floor(sample.y * h);
        expect(x).toBe(frame.x + (corner % 2 ? frame.w - 1 : 0));
        expect(y).toBe(frame.y + (corner >= 2 ? frame.h - 1 : 0));
        const offset = (Math.floor(y / 4) * (w / 4) + Math.floor(x / 4)) * 8;
        const selector = (data[p][offset + 4 + y % 4] >> ((x % 4) * 2)) & 3;
        expect(selector).toBe(corner >= 2 ? 1 : 0);
      }
      const png = new THREE.Texture();
      textures.set(page.image, png);
      applyFrame(piece, assets, atlas, index, { x: 0, y: 0 }, 0xffffff);
      expect(Array.from(uv.array)).toEqual(original);
      expect(png.flipY).toBe(true);
      expect(png.matrix.equals(new THREE.Matrix3())).toBe(true);
      textures.set(page.image, bc);
    }
  });
});
