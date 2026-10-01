// Diagnostic WebGPU client for #163; never loaded by the game.
const unbase64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const report = value => fetch('/result', { method: 'POST', body: JSON.stringify(value) });
const base64 = bytes => {
  const parts = [];
  for (let i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return btoa(parts.join(''));
};

async function run() {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return { supported: false, reason: 'no WebGPU adapter', fallback: 'PNG' };
  const bc = adapter.features.has('texture-compression-bc');
  const device = await adapter.requestDevice({ requiredFeatures: bc ? ['texture-compression-bc'] : [] });
  const errors = [];
  device.addEventListener('uncapturederror', e => errors.push(e.error.message));
  const cases = (await (await fetch('/fixture')).json()).cases;
  const shader = mask => device.createShaderModule({ code: `
    @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
      let p = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
      return vec4f(p[i], 0, 1);
    }
    @group(0) @binding(0) var image: texture_2d<f32>;
    @fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
      let v = textureLoad(image, vec2i(p.xy), 0);
      return ${mask ? 'vec4f(v.rrr, 1)' : 'v'};
    }` });
  const pipelines = ['rgba8unorm', 'rgba32float'].flatMap(format => [false, true].map(mask => {
    const module = shader(mask);
    return device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] } });
  }));
  async function render(fixture, compressed, srgb = false, floating = false) {
    const { width, height } = fixture;
    const format = compressed ? fixture.format + (srgb ? '-srgb' : '') : 'rgba8unorm' + (srgb ? '-srgb' : '');
    const texture = device.createTexture({ size: [width, height], format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | (compressed ? 0 : GPUTextureUsage.RENDER_ATTACHMENT) });
    if (compressed) device.queue.writeTexture({ texture }, unbase64(fixture.compressed),
      { bytesPerRow: width / 4 * 8, rowsPerImage: height }, [width, height]);
    else {
      const bitmap = await createImageBitmap(new Blob([unbase64(fixture.png)], { type: 'image/png' }),
        { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [width, height]);
      bitmap.close();
    }
    const target = device.createTexture({ size: [width, height], format: floating ? 'rgba32float' : 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const pixelBytes = floating ? 16 : 4;
    const buffer = device.createBuffer({ size: width * height * pixelBytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const pipeline = pipelines[(floating ? 2 : 0) + Number(fixture.layer === 'shadow' && compressed)];
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear',
      storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: texture.createView() }] }));
    pass.draw(3); pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow: width * pixelBytes }, [width, height]);
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(buffer.getMappedRange()).slice();
    buffer.unmap(); buffer.destroy(); target.destroy(); texture.destroy();
    return bytes;
  }
  function difference(a, b) {
    let pixels = 0, channels = 0, maxError = 0, alphaPixels = 0, totalError = 0;
    const examples = [];
    for (let i = 0; i < a.length; i += 4) {
      let changed = false;
      if (a[i + 3] !== b[i + 3]) alphaPixels++;
      for (let c = 0; c < 4; c++) {
        if (c < 3 && a[i + 3] === 0 && b[i + 3] === 0) continue;
        const error = Math.abs(a[i + c] - b[i + c]);
        if (error) { channels++; changed = true; }
        maxError = Math.max(maxError, error); totalError += error;
      }
      if (changed) {
        pixels++;
        if (examples.length < 4) examples.push({ pixel: i / 4, png: [...a.slice(i, i + 4)], candidate: [...b.slice(i, i + 4)] });
      }
    }
    return { pixels, channels, alphaPixels, maxError, totalError, examples };
  }
  const comparisons = [];
  for (const fixture of cases) {
    for (const srgb of fixture.layer === 'main' ? [false, true] : [false]) {
      const png = await render(fixture, false, srgb);
      // Capability absence and an explicit opt-out both choose the unchanged PNG path.
      const fallback = await render(fixture, false, srgb);
      const candidate = await render(fixture, bc, srgb);
      comparisons.push({ key: fixture.key, layer: fixture.layer, source: fixture.source, sha256: fixture.sha256,
        blocks: fixture.blocks, pixels: fixture.width * fixture.height,
        colourSpace: srgb ? 'linear-light readback from sRGB textures' : 'unorm data bytes',
        pngDecode: srgb ? null : difference(unbase64(fixture.rgba), png),
        fallback: difference(png, fallback), compressed: bc ? difference(png, candidate) : null });
      if (new URL(location.href).searchParams.has('readback')) comparisons.at(-1).readback = base64(candidate);
      if (!srgb && bc && new URL(location.href).searchParams.get('allocation') === 'decode') {
        comparisons.at(-1).floatReadback = base64(await render(fixture, true, false, true));
      }
    }
  }

  // Allocation experiment, distinct from the small source-fidelity experiment.
  // Actual OS GPU-process counters are recorded alongside exact API allocations;
  // neither downloaded bytes nor THREE.info.memory.textures is a byte measure.
  const mode = new URL(location.href).searchParams.get('allocation');
  const info = adapter.info;
  const adapterInfo = { vendor: info.vendor, architecture: info.architecture,
    device: info.device, description: info.description, isFallbackAdapter: info.isFallbackAdapter };
  if (mode === 'decode') {
    await device.queue.onSubmittedWorkDone();
    device.destroy();
    return { supported: true, bc, adapter: adapterInfo, comparisons, errors };
  }
  const compressed = mode === 'bc' && bc;
  const format = compressed ? 'bc1-rgba-unorm' : 'rgba8unorm';
  const memory = async phase => (await (await fetch(`/memory?phase=${phase}`)).json());
  await device.queue.onSubmittedWorkDone();
  const before = await memory('before');
  const textures = [], size = 2048, count = 8, bytesPerRow = compressed ? size / 4 * 8 : size * 4;
  const bytes = new Uint8Array(compressed ? size * size / 2 : size * size * 4);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 17 + (i >>> 5)) & 255;
  for (let i = 0; i < count; i++) {
    bytes[0] = i; // distinct initialized allocations, not uncommitted zero textures
    const texture = device.createTexture({ size: [size, size], format,
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
    device.queue.writeTexture({ texture }, bytes, { bytesPerRow, rowsPerImage: size }, [size, size]);
    textures.push(texture);
  }
  await device.queue.onSubmittedWorkDone();
  const allocated = await memory('allocated');
  for (const texture of textures) texture.destroy();
  await device.queue.onSubmittedWorkDone();
  const released = await memory('released');
  device.destroy();
  return { supported: true, bc, adapter: adapterInfo,
    comparisons, memory: { mode, format, count, size, payloadBytes: bytes.length * count, before, allocated, released }, errors };
}

run().then(report).catch(error => report({ error: String(error), stack: error.stack }));
