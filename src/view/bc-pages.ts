import * as THREE from 'three/webgpu';

/** The initialized r180 renderer, including its selected fallback backend. */
export type BcRenderer = {
  backend: object;
  // r180's JS returns boolean; @types/three incorrectly declares false | void.
  hasFeature(name: string): unknown;
  initTexture(texture: THREE.Texture): void;
};
type BcBackend = {
  isWebGPUBackend?: boolean;
  isWebGLBackend?: boolean;
  extensions?: { has(name: string): boolean };
  device?: Pick<GPUDevice, 'pushErrorScope' | 'popErrorScope'>;
  gl?: Pick<WebGL2RenderingContext, 'getError' | 'NO_ERROR'>;
};

export function bcSupported(renderer: BcRenderer): boolean {
  const backend = renderer.backend as BcBackend;
  if (backend.isWebGPUBackend) return !!renderer.hasFeature('texture-compression-bc');
  // WebGLBackend.hasFeature maps either S3TC extension to BC. We need BOTH:
  // main colour pages are sRGB, and RGTC is irrelevant while masks stay PNG.
  return !!(backend.isWebGLBackend
    && backend.extensions?.has('WEBGL_compressed_texture_s3tc')
    && backend.extensions.has('WEBGL_compressed_texture_s3tc_srgb'));
}

export function forcePng(search: string = globalThis.location?.search ?? ''): boolean {
  return new URLSearchParams(search).get('textures') === 'png';
}

/** Force r180's synchronous createTexture/writeTexture before publishing a page.
 * Pop scopes immediately (before yielding) so concurrent page loads cannot nest
 * their scopes. Device loss or errors from a later draw are not recoverable here.
 */
export async function uploadBcTexture(renderer: BcRenderer, texture: THREE.CompressedTexture): Promise<void> {
  const backend = renderer.backend as BcBackend;
  const device = backend.isWebGPUBackend ? backend.device : undefined;
  if (device) {
    device.pushErrorScope('validation');
    device.pushErrorScope('out-of-memory');
    const errors: Promise<GPUError | null>[] = [];
    try {
      renderer.initTexture(texture);
    } finally {
      errors.push(device.popErrorScope(), device.popErrorScope());
      const results = await Promise.all(errors);
      const error = results.find(result => result !== null);
      if (error) throw new Error(error.message);
    }
  } else {
    renderer.initTexture(texture);
    if (backend.gl && backend.gl.getError() !== backend.gl.NO_ERROR) {
      throw new Error('BC texture upload produced a WebGL error');
    }
  }
}

/** Raw, top-down BC1 blocks; BC4 coverage does not match MeshBasicMaterial. */
export async function loadBcTexture(
  url: string,
  format: 'bc1' | 'bc4',
  size: [number, number],
  upload?: (texture: THREE.CompressedTexture) => Promise<void>,
): Promise<THREE.CompressedTexture | undefined> {
  let texture: THREE.CompressedTexture | undefined;
  try {
    if (format !== 'bc1' || !size.every(n => Number.isSafeInteger(n) && n > 0 && n % 4 === 0)) return undefined;
    const expectedBytes = size[0] * size[1] / 2;
    if (!Number.isSafeInteger(expectedBytes)) return undefined;
    const response = await fetch(url);
    if (!response.ok) return undefined;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== expectedBytes) throw new Error(`BC1 buffer size: expected ${expectedBytes}, got ${buffer.byteLength}`);
    texture = new THREE.CompressedTexture(
      [{ data: new Uint8Array(buffer), width: size[0], height: size[1] }],
      size[0], size[1], THREE.RGBA_S3TC_DXT1_Format, THREE.UnsignedByteType,
    );
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    // applyFrame's PNG UVs are bottom-up. Compressed uploads cannot flip rows;
    // reflect the sampling coordinate instead, also when a pending page binds.
    texture.repeat.y = -1;
    texture.offset.y = 1;
    texture.updateMatrix();
    texture.needsUpdate = true;
    await upload?.(texture);
    return texture;
  } catch (error) {
    if (texture) {
      texture.dispose();
      texture.mipmaps = [];
      texture.source.data = null;
    }
    console.warn(`BC page ${url} failed; using PNG`, error);
    return undefined;
  }
}
