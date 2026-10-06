/** #92: private real-browser HUD acceptance, no world/sim mutation or live service.
 * Requires a private import_ui.py output at .local/sdf-ui (never publishes it).
 * npx tsx tools/sdf_text_smoke.mts
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = resolve(root, '.local/sdf-ui'), output = resolve(root, '.local/sdf-browser');
assert(existsSync(`${fixture}/manifest.json`), 'private UI extraction required');
mkdirSync(output, { recursive: true });
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module">
import { Hud } from '/src/view/hud.ts';
import { createGame } from '/src/sim/game.ts';
import '/src/view/style.css';
const params = new URLSearchParams(location.search);
const ui = params.has('fallback') ? undefined : await fetch('/__sdf/assets/manifest.json').then(r=>r.json());
if (ui) { ui.base = '/__sdf/assets/'; if (params.has('before')) delete ui.sdfFont;
  if (params.has('broken')) ui.sdfFont.pages = ['absent.png']; }
const noop = () => {};
const hud = new Hud(document.body, ui, { onCommand: noop, onSelectMember: noop, onCancelTraining: noop,
  onMinimapNavigate: noop, onFlare: noop, onSelectIdleVillager: noop, onMenu: noop, onReplayFile: noop,
  onSound: noop, onStartMatch: () => false });
const state = createGame(92);
const status = { workers: {wood:0, food:0, gold:0, stone:0}, villagers:3, idle:3,
  ageName: 'Dark Age', ageShield: 'AgeupDarkAge', ageProgress: 0 };
const update = () => hud.updateResources(state, 1, status);
update(); await hud.sdfLabels.ready; await document.fonts.ready;
window.fixture = { hud, state, status, update };
</script></body></html>`;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error',
  server: { host: '127.0.0.1', port: 5292, strictPort: true }, plugins: [{
    name: 'private-sdf-fixture', configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (pathname === '/__sdf') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
        if (!pathname.startsWith('/__sdf/assets/')) return next();
        const path = resolve(fixture, decodeURIComponent(pathname.slice('/__sdf/assets/'.length)));
        if (!path.startsWith(`${fixture}/`) || !existsSync(path)) { res.statusCode = 404; res.end(); return; }
        res.setHeader('Content-Type', ({ '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf' } as Record<string, string>)[extname(path)] ?? 'application/octet-stream');
        res.end(readFileSync(path));
      });
    },
  }] });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox'] });
try {
  const results: Record<string, unknown> = {};
  for (const mode of ['owned-before', 'owned-after', 'fallback-before', 'fallback-after', 'broken']) {
    const page = await browser.newPage(), errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.evaluateOnNewDocument('globalThis.__name = f => f');
    await page.setViewport({ width: 2000, height: 1125, deviceScaleFactor: 1 });
    const query = `${mode.startsWith('fallback') ? 'fallback&' : ''}${mode.endsWith('before') ? 'before&' : ''}${mode === 'broken' ? 'broken' : ''}`;
    await page.goto(`http://127.0.0.1:5292/__sdf?${query}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!(window as any).fixture);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/${mode}.png`, clip: { x: 0, y: 0, width: 900, height: 145 } });
    const info = await page.evaluate(() => {
      const { hud, update } = (window as any).fixture;
      const labels = [...document.querySelectorAll<HTMLElement>('[data-value], [data-age-text]')];
      const before = hud.sdfLabels.stats?.renders ?? 0, start = performance.now();
      for (let i = 0; i < 1000; i++) update();
      const elapsed = performance.now() - start;
      return { before, after: hud.sdfLabels.stats?.renders ?? 0, millisecondsPerUpdate: elapsed / 1000,
        stats: hud.sdfLabels.stats, labels: labels.map(el => {
          const canvas = el.querySelector('canvas'), data = canvas?.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
          let ink = 0, coverage = 0;
          if (data) for (let i = 3; i < data.length; i += 4) { if (data[i]) ink++; coverage += data[i] / 255; }
          return { text: el.textContent, canvas: !!canvas, ink, coverage, width: canvas?.width, height: canvas?.height,
            decorative: canvas?.getAttribute('aria-hidden') };
        }) };
    });
    assert.equal(info.after, info.before, `${mode}: no rasterisation on unchanged frames`);
    assert.equal(info.labels.length, 6);
    assert(info.labels.every(l => l.text), 'DOM text retained');
    if (mode === 'owned-after') {
      assert(info.labels.every(l => l.canvas && l.ink > 0 && l.decorative === 'true'));
      // A real accessibility tree must retain the labels, not just an aria annotation.
      const session = await page.createCDPSession();
      const ax = await session.send('Accessibility.getFullAXTree');
      assert(ax.nodes.some(n => n.name?.value === 'Dark Age' && !n.ignored));
      results.accessibility = 'Dark Age present in full AX tree';
      // Matched-scale fixture for the coordinator's build185872 native capture.
      await page.setViewport({ width: 2560, height: 1440, deviceScaleFactor: 1 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const matched = await page.evaluate(() => {
        const { hud, state, status, update } = (window as any).fixture;
        Object.assign(state.players[1], { wood: 5000, food: 4700, gold: 4800, stone: 0,
          population: 4, populationCap: 20 });
        status.ageName = 'Imperial Age'; update();
        return [...document.querySelectorAll<HTMLElement>('[data-value], [data-age-text]')].map(el => {
          const canvas = el.querySelector('canvas')!, rect = canvas.getBoundingClientRect();
          return { text: el.textContent, x: rect.x, y: rect.y, width: rect.width, height: rect.height,
            png: canvas.toDataURL('image/png') };
        });
      });
      await page.screenshot({ path: `${output}/matched-2560.png`, clip: { x: 0, y: 0, width: 1120, height: 82 } });
      writeFileSync(`${output}/matched-labels.json`, JSON.stringify(matched, null, 2));
      if (process.env.SDF_SWEEP) {
        await page.evaluate(() => {
          const hud = (window as any).fixture.hud;
          (window as any).originalSdfStyles = [...hud.sdfStyles].map(([el, style]: any) => [el, structuredClone(style)]);
        });
        const candidates = [
          ...[.06, .08, .1].flatMap(threshold => [2, 2.25].map(edgeScale => ({ family: 'counter', threshold, edgeScale, outline: .025 }))),
          ...[.1, .12].flatMap(threshold => [1.75, 2].map(edgeScale => ({ family: 'age', threshold, edgeScale, outline: .05 }))),
        ];
        for (const [index, candidate] of candidates.entries()) {
          await page.evaluate(candidate => {
            const { hud, update } = (window as any).fixture;
            for (const [el, original] of (window as any).originalSdfStyles) {
              const style = structuredClone(original);
              if ((el.hasAttribute('data-age-text') ? 'age' : 'counter') === candidate.family) {
                style.treatment = { threshold: candidate.threshold, edgeScale: candidate.edgeScale };
                style.outline = candidate.outline;
              }
              hud.sdfStyles.set(el, style);
            }
            update();
          }, candidate);
          await page.screenshot({ path: `${output}/sweep-${index}.png`, clip: { x: 0, y: 0, width: 1120, height: 82 } });
        }
        writeFileSync(`${output}/sweep.json`, JSON.stringify(candidates, null, 2));
        await page.evaluate(() => {
          const { hud, update } = (window as any).fixture;
          hud.sdfStyles = new Map((window as any).originalSdfStyles); update();
        });
      }
      // Restore the original fixture for the unchanged acceptance below.
      await page.setViewport({ width: 2000, height: 1125, deviceScaleFactor: 1 });
      await page.evaluate(() => {
        const { state, status, update } = (window as any).fixture;
        Object.assign(state.players[1], { wood: 200, food: 200, gold: 100, stone: 0,
          population: 4, populationCap: 5 }); status.ageName = 'Dark Age'; update();
      });
      const changes = await page.evaluate(() => {
        const { hud, update, state, status } = (window as any).fixture;
        const before = hud.sdfLabels.stats.renders;
        state.players[1].wood = 12345; update();
        const after = hud.sdfLabels.stats.renders;
        const ages = ['Feudal Age', 'Castle Age', 'Imperial Age'];
        for (const name of ages) { status.ageName = name; update(); }
        const canvases = document.querySelectorAll('[data-age-text] canvas').length;
        status.ageName = 'Unknown 🐉'; update();
        const unknown = document.querySelector('[data-age-text]')!;
        const fellBack = unknown.textContent === 'Unknown 🐉' && !unknown.querySelector('canvas');
        status.ageName = 'Dark Age'; update();
        return { before, after, canvases, fellBack };
      });
      assert.equal(changes.after, changes.before + 1); assert.equal(changes.canvases, 1); assert(changes.fellBack);
      results.changes = changes;
      await page.setViewport({ width: 2000, height: 1125, deviceScaleFactor: 2 });
      const dpr = await page.evaluate(() => {
        (window as any).fixture.update();
        const canvas = document.querySelector<HTMLCanvasElement>('[data-value="food"] canvas')!;
        return { physical: canvas.width, logical: parseFloat(canvas.style.width), ratio: devicePixelRatio };
      });
      assert.equal(dpr.ratio, 2); assert.equal(dpr.physical, dpr.logical * 2); results.dpr = dpr;
      await page.screenshot({ path: `${output}/owned-dpr2.png`, clip: { x: 0, y: 0, width: 900, height: 145 } });
    } else assert(info.labels.every(l => !l.canvas), `${mode}: CSS fallback`);
    results[mode] = info;
    await page.evaluate(() => (window as any).fixture.hud.destroy());
    await page.close();
  }
  assert.deepEqual(readFileSync(`${output}/fallback-before.png`), readFileSync(`${output}/fallback-after.png`));
  assert.notDeepEqual(readFileSync(`${output}/owned-before.png`), readFileSync(`${output}/owned-after.png`));
  writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); await server.close(); }
