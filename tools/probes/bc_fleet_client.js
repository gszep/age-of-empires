// Browser half of the private fleet probe. No public simulation mutations.
const errors = [];
const warnings = [];
for (const [level, sink] of [['error', errors], ['warn', warnings]]) {
  const original = console[level].bind(console);
  console[level] = (...args) => { sink.push(args.map(String).join(' ')); original(...args); };
}
addEventListener('error', e => errors.push(e.message || `resource failed: ${e.target?.src ?? e.target?.href}`), true);
addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
const base64 = bytes => {
  const parts = [];
  for (let i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return btoa(parts.join(''));
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const require = (ok, message) => { if (!ok) throw new Error(message); };
async function until(test, message, timeout = 60_000) {
  const end = performance.now() + timeout;
  while (performance.now() < end) {
    if (test()) return;
    if (errors.length) throw new Error(errors.join('; '));
    await wait(100);
  }
  throw new Error(message);
}
async function run() {
  const fixture = await fetch('/fleet/fixture').then(r => r.json());
  if (location.pathname === '/fleet/start') {
    sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(fixture.snapshot));
    const mode = new URL(location.href).searchParams.get('mode');
    location.replace('/?solo=1' + (mode === 'png' ? '&textures=png' : ''));
    return;
  }
  await until(() => globalThis.__empiresDebug && globalThis.__fleetViews, 'game/debug did not initialize');
  const debug = globalThis.__empiresDebug, renderer = globalThis.__fleetRenderer;
  const device = renderer.backend.device;
  const info = device?.adapterInfo;
  require(info, 'actual renderer GPUDevice.adapterInfo unavailable (not hardware evidence)');
  const adapter = { vendor: info.vendor, architecture: info.architecture, device: info.device,
    description: info.description, isFallbackAdapter: info.isFallbackAdapter };
  const webgpu = renderer.backend.isWebGPUBackend === true;
  const bc = device.features.has('texture-compression-bc');
  require(webgpu && bc && adapter.isFallbackAdapter === false, 'hardware WebGPU with BC required');
  device.addEventListener('uncapturederror', e => errors.push(`GPU: ${e.error.message}`));
  device.lost.then(info => errors.push(`GPU device lost: ${info.message}`));
  const snapshot = await debug({ type: 'snapshot' });
  require(snapshot.tick === fixture.snapshot.state.tick, 'fixture must stay at staged tick');
  require(JSON.stringify(snapshot.entities) === JSON.stringify(fixture.snapshot.state.entities), 'page declined or mutated fixture');
  await debug({ type: 'look', rect: fixture.look });
  // Every view piece, not only the first nonzero texture count or hull body.
  const pieces = view => Object.values(view).flatMap(value => Array.isArray(value) ? value : [value])
    .filter(value => value && typeof value === 'object' && 'mesh' in value);
  await until(() => fixture.ships.every(ship => {
    const view = globalThis.__fleetViews.get(`e${ship.id}`);
    return view && !view.fallback && view.body.mesh.visible && pieces(view).every(p => !p.pendingTexture);
  }) && [...globalThis.__fleetViews.values()].every(v => pieces(v).every(p => !p.pendingTexture)), 'full fleet residency timed out');
  // Allow the next synchronization/draw and the 1 Hz OS counters to settle.
  let textures = await debug({ type: 'textures' });
  await wait(2000);
  const settled = await debug({ type: 'textures' });
  require(JSON.stringify(textures) === JSON.stringify(settled), 'residency changed after ready');
  textures = settled;
  const images = [...new Set(fixture.ships.flatMap(ship => pieces(globalThis.__fleetViews.get(`e${ship.id}`)).map(p => p.textureImage).filter(Boolean)))].sort();
  require(images.length >= 10 && textures.resident >= images.length, 'fixture must span many resident atlas pages');
  require(images.every(image => globalThis.__fleetAssets.textures.has(image)), 'a required fleet page is missing');
  renderer.setAnimationLoop(null); // Fixed presentation as well as fixed simulation tick.
  await device.queue.onSubmittedWorkDone();
  const before = globalThis.__fleetBefore;
  const after = await fetch('/fleet/memory').then(r => r.json());
  const sim = await debug({ type: 'sim' });
  const entities = await debug({ type: 'entities', owner: 1 });
  require(fixture.ships.every(s => entities.entities.some(e => e.id === s.id && e.bodyVisible && e.onScreen)), 'fleet must be visible in sampled view');
  const capture = await debug({ type: 'pixels', png: true, rect: fixture.rect });
  const image = new Image(); image.src = `data:image/png;base64,${capture.png}`; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = capture.width; canvas.height = capture.height;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' }); ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const colorSpace = String(renderer.outputColorSpace);
  require(colorSpace === 'srgb', 'readback must be sRGB');
  // Establish actual fleet pixels, not just an unchanged patch of terrain.
  for (const ship of fixture.ships) globalThis.__fleetViews.get(`e${ship.id}`).group.visible = false;
  let hidden;
  try { hidden = await debug({ type: 'pixels', png: true, rect: fixture.rect }); }
  finally { for (const ship of fixture.ships) globalThis.__fleetViews.get(`e${ship.id}`).group.visible = true; }
  require(capture.png !== hidden.png, 'capture contains no fleet pixels');
  require((await debug({ type: 'sim' })).synchronizationHash === sim.synchronizationHash, 'capture mutated simulation');
  return { adapter, webgpu, bc, textures, images, memory: { before, after },
    simulationHash: sim.synchronizationHash, tick: sim.tick, entities,
    view: { look: fixture.look, rect: fixture.rect, viewport: [innerWidth, innerHeight], devicePixelRatio },
    pixels: { width: capture.width, height: capture.height, colorSpace, data: base64(data) }, errors, warnings };
}
run().catch(error => ({ error: String(error), stack: error.stack, errors, warnings })).then(result => {
  if (result) return fetch('/fleet/result', { method: 'POST', body: JSON.stringify(result) });
});
