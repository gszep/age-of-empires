/** #49: private browser/public commands; no shared publication writes.
 * OPEN_FALLBACK=1 npx tsx tools/feedback_effects_smoke.mts
 * OWNED_PUBLIC=/path/to/public npx tsx tools/feedback_effects_smoke.mts
 * Add FEEDBACK_SOURCE=1 to overlay a small read-only owned-source extraction
 * in .local (not a full import or publication) on that existing public tree.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { createGame, placementLegal } from '../src/sim/game.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { updateVisibility } from '../src/sim/visibility.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';

const root = fileURLToPath(new URL('../', import.meta.url)), port = 5235;
const fallback = process.env.OPEN_FALLBACK === '1';
const published = fallback ? undefined : process.env.OWNED_PUBLIC;
assert(fallback || published, 'set OPEN_FALLBACK=1 or OWNED_PUBLIC');
const source = !fallback && process.env.FEEDBACK_SOURCE === '1';
const manifest = published ? JSON.parse(readFileSync(`${published}/imported/aoe2/manifest.json`, 'utf8')) : undefined;
let fragment: any;
if (source) {
  const path = execFileSync('uv', ['run', '--locked', 'python', 'tools/feedback_effects_fixture.py'], { cwd: root, encoding: 'utf8' }).trim();
  fragment = JSON.parse(readFileSync(path, 'utf8'));
  Object.assign(manifest.particles ??= {}, fragment.particles);
  for (const [key, links] of Object.entries(fragment.entities)) Object.assign(manifest.entities[key], links);
}
const compressed = source ? gzipSync(JSON.stringify(manifest), { mtime: 0 } as any) : undefined;
const rules = manifest ? rulesFromManifest(manifest) : FALLBACK_RULES;
const state = createGame(49, rules);
state.entities = state.entities.filter(e => e.kind === 'town-center' || e.kind === 'villager');
state.terrain.fill(0); state.elevation.fill(0); state.tick = 49;
state.players[1].food = state.players[1].wood = state.players[1].gold = 1000;
state.players[1].populationCap = 30;
const home = state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
const builder = state.entities.find(e => e.kind === 'villager' && e.owner === 1)!;
assert(home && builder);
let site: { x: number; y: number } | undefined;
for (let dx = 5; dx < 10 && !site; dx++) {
  const candidate = { x: Math.floor(home.position.x) + dx, y: Math.floor(home.position.y) };
  if (placementLegal(state, 'house', candidate, 'x', 1).ok) site = candidate;
}
assert(site, 'fixture finds legal clear ground');
builder.position = { x: site.x - 2, y: site.y };
updateVisibility(state);
const { rules: ignored, ...saved } = state;
const out = `${root}.local/feedback-${fallback ? 'fallback' : source ? 'owned-source' : 'owned-published'}`;
mkdirSync(`${root}.local`, { recursive: true });
const names = fallback ? { spawn: 'spawn', glow: '', complete: '', dust: '' } : {
  spawn: manifest.entities.villager.spawnEffect,
  glow: manifest.entities['town-center'].researchingEffect,
  complete: manifest.entities['town-center'].researchCompleteEffect,
  dust: manifest.entities.house.constructionEffect,
};
if (!fallback) for (const name of ['move', 'idlepointer', ...Object.values(names)]) assert(manifest.particles?.[name], `missing imported particle ${name}`);

const server = await createServer({ root, configFile: `${root}vite.config.ts`, publicDir: published ?? false,
  logLevel: 'error', server: { host: '127.0.0.1', port, strictPort: true }, plugins: [{
    name: 'feedback-private-probe', enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0]);
        if (fallback && url.startsWith('/imported/')) { res.statusCode = 404; res.end(); return; }
        if (source && url === '/imported/aoe2/manifest.json') {
          res.setHeader('Content-Type', 'application/json'); res.setHeader('Content-Encoding', 'gzip'); res.end(compressed); return;
        }
        if (source && Object.values(fragment.particles).some((p: any) => url === `/imported/aoe2/${p.atlas.image}`)) {
          res.setHeader('Content-Type', 'image/png');
          createReadStream(`${root}.local/feedback-source/${url.slice('/imported/aoe2/'.length)}`).pipe(res); return;
        }
        next();
      });
    },
    transform(code, id) {
      if (!id.endsWith('/src/main.ts')) return;
      const anchor = 'scene.add(effectPlayer.group);';
      assert(code.includes(anchor) && code.includes('let paused = false;'));
      // Test-only observer and deterministic step driver; no production debug
      // API, no altered rules/rates, no effects writing authoritative state.
      return `import { synchronizationHash as feedbackHash } from './shared/checksum';\n` + code
        .replace('let paused = false;', 'let paused = true;')
        .replace(anchor, `${anchor}
          const requested = new Map<string, number>();
          const probe = { updates: 0, mutations: 0, seen: new Set<string>(), attempts: [] as string[],
            arm: '', held: false,
            mask: (name: string, hidden: boolean) => { for (const m of effectPlayer.group.children) if (m.name === 'feedback:' + name) m.visible = !hidden; },
            rect: (name: string) => {
              const mesh = effectPlayer.group.children.find(m => m.name === 'feedback:' + name);
              if (!mesh) throw new Error('no active mesh: ' + name);
              scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
              const box = new THREE.Box3().setFromObject(mesh);
              const a = box.min.clone().project(camera), b = box.max.clone().project(camera);
              const x = Math.max(0, Math.floor((Math.min(a.x, b.x) + 1) * innerWidth / 2));
              const y = Math.max(0, Math.floor((1 - Math.max(a.y, b.y)) * innerHeight / 2));
              return [x, y, Math.min(innerWidth - x, Math.ceil(Math.abs(b.x - a.x) * innerWidth / 2) + 2),
                Math.min(innerHeight - y, Math.ceil(Math.abs(b.y - a.y) * innerHeight / 2) + 2)];
            },
            loaded: () => Object.fromEntries(Object.entries(assets?.particles ?? {}).map(([name, p]) => [name, assets?.textures.has(p.atlas.image)])),
            meshes: () => effectPlayer.group.children.map(m => ({ name: m.name, visible: m.visible, opacity: (m as THREE.Mesh<any, THREE.MeshBasicMaterial>).material.opacity })),
            advance: (n: number) => { for (let i = 0; i < n; i++) stepGame(game); } };
          const spawnFeedback = effectPlayer.spawn.bind(effectPlayer);
          effectPlayer.spawn = (...args) => {
            probe.attempts.push(args[0]);
            requested.set(args[0], assets?.particles?.[args[0]]?.timer === 'Real' ? args[3] ?? args[2] : args[2]);
            spawnFeedback(...args);
          };
          const updateFeedback = effectPlayer.update.bind(effectPlayer);
          effectPlayer.update = (...args) => {
            if (probe.held) return; // Test-only freeze for matched framebuffer readbacks.
            const before = feedbackHash(game); updateFeedback(...args);
            probe.updates++; if (feedbackHash(game) !== before) probe.mutations++;
            for (const m of probe.meshes()) if (m.visible && m.opacity > 0) probe.seen.add(m.name);
            const effect = assets?.particles?.[probe.arm];
            if (effect && probe.meshes().some(m => m.name === 'feedback:' + probe.arm && m.visible && m.opacity > 0)) {
              const age = (effect.timer === 'Real' ? args[1] ?? args[0] : args[0]) - (requested.get(probe.arm) ?? Infinity);
              if (age >= .35 * (effect.cycleSeconds[0] + effect.cycleSeconds[1]) / 2 + (effect.startDelay?.[1] ?? 0)) probe.held = true;
            }
          };
          Object.assign(globalThis, { __feedback: probe });`);
    },
  }] });
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
try {
  await server.listen();
  const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
  browser = await puppeteer.launch({ headless: true,
    env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
  console.log(JSON.stringify({ pid: process.pid, browserPid: browser.process()?.pid, port }));
  const page = await browser.newPage(), errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument('globalThis.__name = f => f');
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto(`http://127.0.0.1:${port}/?solo=1`, { waitUntil: 'networkidle0', timeout: 120000 });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function' && (window as any).__feedback.updates > 0);
  const query = async (q: object): Promise<any> => {
    const response = await fetch(`http://127.0.0.1:${port}/__debug`, { method: 'POST', body: JSON.stringify(q) });
    assert(response.ok); return response.json();
  };
  const snap = () => query({ type: 'snapshot' });
  const command = async (command: object) => { const reply = await query({ type: 'command', command }); assert.equal(reply.ok, true, JSON.stringify(reply)); };
  const advance = async (ticks: number) => {
    await page.evaluate(n => (window as any).__feedback.advance(n), ticks);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  };
  const arm = async (name: string) => page.evaluate(name => {
    const p = (window as any).__feedback; p.arm = name; p.held = false;
  }, name);
  const pixels: Record<string, any> = {};
  const captures = new Map<string, { png: string; rect: number[] }>();
  // PNG readbacks come from the production debug renderer's sRGB framebuffer,
  // normalized for backend orientation. Decode both identically in the page.
  const difference = async (a: string, b: string) => page.evaluate(async ({ a, b }) => {
    const decode = async (png: string) => {
      const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const [left, right] = await Promise.all([decode(a), decode(b)]);
    if (left.length !== right.length) throw new Error('pixel sizes changed');
    let changed = 0, sum = 0, max = 0;
    for (let i = 0; i < left.length; i += 4) {
      let peak = 0;
      for (let c = 0; c < 3; c++) { const d = Math.abs(left[i + c] - right[i + c]); sum += d; peak = Math.max(peak, d); }
      if (peak >= 8) changed++; max = Math.max(max, peak);
    }
    return { changedPixels: changed, meanAbsoluteRgb: sum / (left.length / 4 * 3), maxChannelDelta: max, totalPixels: left.length / 4 };
  }, { a, b });
  const seen = async (name: string) => {
    if (fallback) { assert.deepEqual(await page.evaluate(() => (window as any).__feedback.meshes()), []); return; }
    try {
      await page.waitForFunction(name => (window as any).__feedback.seen.has(`feedback:${name}`), { timeout: 15000 }, name);
    } catch (error) {
      const evidence = await page.evaluate(() => { const p = (window as any).__feedback;
        return { attempts: p.attempts, meshes: p.meshes(), loaded: p.loaded(), seen: [...p.seen] }; });
      writeFileSync(`${out}.failure.json`, JSON.stringify({ name, evidence, errors }, null, 2));
      console.error(JSON.stringify({ name, evidence, errors })); throw error;
    }
    await page.waitForFunction(() => (window as any).__feedback.held, { timeout: 15000 });
    const rect = await page.evaluate(name => (window as any).__feedback.rect(name), name);
    assert(rect[2] > 0 && rect[3] > 0, `${name} is on screen`);
    const before = (await query({ type: 'sim' })).synchronizationHash;
    const active = await query({ type: 'pixels', rect, png: true });
    writeFileSync(`${out}-${name}-active.png`, Buffer.from(active.png, 'base64'));
    await page.screenshot({ path: `${out}-${name}-active-screen.png` });
    // Same scene/tick/camera with only this feedback mesh hidden: standing unit
    // animation or construction progress cannot manufacture this difference.
    await page.evaluate(name => (window as any).__feedback.mask(name, true), name);
    const masked = await query({ type: 'pixels', rect, png: true });
    await page.evaluate(name => (window as any).__feedback.mask(name, false), name);
    const isolated = await difference(active.png, masked.png);
    console.log(JSON.stringify({ name, isolated }));
    assert(isolated.changedPixels >= 20 && isolated.meanAbsoluteRgb > .02, `${name}: no measurable framebuffer contribution`);
    assert.equal((await query({ type: 'sim' })).synchronizationHash, before);
    pixels[name] = { rect, colorSpace: 'srgb', isolated };
    captures.set(name, { png: active.png, rect });
    await page.evaluate(() => { const p = (window as any).__feedback; p.arm = ''; p.held = false; });
  };
  const ended = async (name: string) => {
    await page.waitForFunction(name => !(window as any).__feedback.meshes().some((m: any) => m.name === `feedback:${name}`), { timeout: 15000 }, name);
    const active = captures.get(name);
    if (active) {
      const after = await query({ type: 'pixels', rect: active.rect, png: true });
      writeFileSync(`${out}-${name}-ended.png`, Buffer.from(after.png, 'base64'));
      pixels[name].afterEnd = await difference(active.png, after.png);
      assert(pixels[name].afterEnd.changedPixels >= 20, `${name}: active and ended framebuffers are indistinguishable`);
    }
  };
  const until = async (predicate: (snapshot: any) => boolean, maxTicks = 2400) => {
    for (let i = 0; i < maxTicks; i += 20) { if (predicate(await snap())) return; await advance(20); }
    assert(predicate(await snap()), 'public command outcome did not arrive within simulation bound');
  };
  assert.equal((await snap()).tick, 49, 'fixture really resumed, paused');
  assert.deepEqual(await page.evaluate(() => (window as any).__feedback.attempts), [], 'load cannot spray transient effects');
  console.log('fixture resumed');

  // Actual right-click on clear ground, not direct effectPlayer.spawn.
  await query({ type: 'select', ids: [builder.id] });
  await query({ type: 'look', rect: [site.x, site.y, 0, 0] });
  await advance(0);
  const box = await page.$eval('canvas.battlefield', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await arm('move');
  await page.mouse.click(box.x, box.y, { button: 'right' });
  assert.equal((await snap()).entities.find((e: any) => e.id === builder.id).order.kind, 'move');
  assert((await page.evaluate(() => (window as any).__feedback.attempts)).includes('move'));
  await seen('move');
  console.log('move observed');
  const pausedHash = (await query({ type: 'sim' })).synchronizationHash;
  await ended('move');
  assert.equal((await query({ type: 'sim' })).synchronizationHash, pausedHash);

  const initialIds = new Set((await snap()).entities.map((e: any) => e.id));
  await arm(names.spawn);
  await command({ kind: 'train', player: 1, buildingId: home.id, unit: 'villager' });
  await until(s => s.entities.some((e: any) => !initialIds.has(e.id) && e.kind === 'villager'));
  await seen(names.spawn); await ended(names.spawn);
  console.log('training observed and ended');

  await arm(names.glow);
  await command({ kind: 'research', player: 1, buildingId: home.id, tech: 'loom' });
  assert.equal((await snap()).entities.find((e: any) => e.id === home.id).researching.tech, 'loom');
  await advance(0); await seen(names.glow);
  console.log('research glow observed');
  await arm(names.complete);
  await until(s => s.players[1].researched.includes('loom'));
  await advance(20); // Source game-clock fade-in/sample cannot progress while paused.
  await seen(names.complete); await ended(names.glow);
  // Non-Real completion/dust clocks follow sim time, including their stop fade.
  await advance(200); await ended(names.complete);
  console.log('research complete observed and ended');

  await arm(names.dust);
  await command({ kind: 'build', player: 1, builderIds: [builder.id], building: 'house', target: site });
  await until(s => s.entities.some((e: any) => e.kind === 'house' && e.buildProgress !== undefined));
  // Dust is loaded on demand and its game clock starts when its texture is
  // ready; the paused fixture must not spend its ticks before that.
  if (!fallback) await page.waitForFunction(name => (window as any).__feedback.loaded()[name], { timeout: 30000 }, names.dust);
  await advance(60); // Source delay + an interior dust frame (3 game seconds).
  await seen(names.dust); await advance(200); await ended(names.dust);
  console.log('foundation observed and ended');

  await command({ kind: 'stop', player: 1, entityIds: [builder.id] });
  await query({ type: 'select', ids: [] });
  await advance(0);
  await arm('idlepointer');
  await page.click('[data-command="idle-villager"]');
  const selected = await query({ type: 'entities', owner: 1, kind: 'villager' });
  assert(selected.entities.some((e: any) => e.selected && e.order === 'idle'), 'real idle button selected an idle villager');
  await seen('idlepointer'); await ended('idlepointer');
  console.log('idle pointer observed and ended');

  const evidence = await page.evaluate(() => { const p = (window as any).__feedback;
    return { updates: p.updates, mutations: p.mutations, seen: [...p.seen], attempts: p.attempts, remaining: p.meshes() }; });
  assert(evidence.updates > 10); assert.equal(evidence.mutations, 0, 'every effect update preserves the sim hash');
  assert.deepEqual(evidence.remaining, []); assert.deepEqual(errors, []);
  await page.screenshot({ path: `${out}.png` });
  writeFileSync(`${out}.json`, JSON.stringify({ mode: fallback ? 'fallback' : source ? 'owned-source-overlay' : 'owned-published',
    seed: 49, tick: (await snap()).tick, evidence, pixels, errors, source: fragment?.sha256 }, null, 2));
  console.log(JSON.stringify(evidence)); console.log('PASS');
} finally { await browser?.close(); await server.close(); }
