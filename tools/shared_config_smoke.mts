/** #276: failed discovery must not become a solo game; recover in the same page. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer, { type Page } from 'puppeteer';
import { sharedMatchPlugin } from '../src/shared/server.ts';
import { createGame, stepGame } from '../src/sim/game.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import { startupDiagnostics } from './browser-startup-diagnostics.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = mkdtempSync(`${root}.local/shared-config-`), checkpoint = `${directory}/match.json`;
const fallback = process.env.OPEN_FALLBACK === '1';
const rules = fallback ? FALLBACK_RULES : rulesFromManifest(JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8')));
const state = createGame(276, rules);
for (let i = 0; i < 150; i++) stepGame(state);
const { rules: omitted, ...saved } = state;
const snapshot = JSON.stringify({ version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
let mode: 'offline' | 'shared' | 'missing' | 'html' | 'disabled' = 'offline';
let requests = 0;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error',
  plugins: [{ name: 'shared-config-failure-fixture', enforce: 'pre', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? '').split('?')[0];
      if (fallback && path.startsWith('/imported/')) { res.writeHead(404); res.end(); return; }
      if (path !== '/__match/config') { next(); return; }
      requests++;
      res.setHeader('Cache-Control', 'no-store');
      if (mode === 'shared') { next(); return; }
      if (mode === 'offline') { res.writeHead(502); res.end('fixture host unavailable'); return; }
      if (mode === 'missing') { res.writeHead(404); res.end(); return; }
      if (mode === 'html') { res.setHeader('Content-Type', 'text/html'); res.end('<html>standalone fallback</html>'); return; }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ enabled: false }));
    });
  } }, sharedMatchPlugin(fallback ? directory : root, checkpoint)],
  server: { host: '127.0.0.1', port: 5246, strictPort: true },
});
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
const errors: string[] = [];
const diagnostics: ReturnType<typeof startupDiagnostics>[] = [];
const page = async () => {
  const p = await browser.newPage(); await p.setViewport({ width: 1280, height: 800 });
  p.on('pageerror', error => errors.push(String(error)));
  diagnostics.push(startupDiagnostics(p, browser, `${root}.local/browser-diagnostics/shared-config-${fallback ? 'fallback' : 'owned'}`));
  return p;
};
const query = (p: Page, q: object): Promise<any> => p.evaluate(q => (window as any).__empiresDebug(q), q);
const ready = (p: Page) => p.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
const pause = async (p: Page) => {
  if (!(await query(p, { type: 'sim' })).connection.paused) await p.keyboard.press('F3');
  await p.waitForFunction(async () => (await (window as any).__empiresDebug({ type: 'sim' })).connection.paused, { timeout: 30_000 });
};
try {
  const p = await page();
  await p.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', snapshot), snapshot);
  await p.goto('http://127.0.0.1:5246/', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => document.querySelector('#game-message')?.textContent?.includes('Shared match unavailable'), { timeout: 120_000 });
  await p.waitForResponse(response => response.url().endsWith('/__match/config') && response.status() === 502);
  assert(requests >= 2, 'failed discovery is retried');
  assert.equal(await p.evaluate(() => typeof (window as any).__empiresDebug), 'undefined', 'no solo simulation/debug startup');
  assert.equal(await p.$('#hud'), null, 'no playable solo HUD after failed shared discovery');
  assert.equal(await p.evaluate(() => sessionStorage.getItem('open-empires-lab:dev-session')), snapshot, 'saved match untouched while unavailable');
  assert(!existsSync(checkpoint), 'failed discovery did not join or replace the private host match');
  mode = 'shared';
  await ready(p); await pause(p);
  const restored = await query(p, { type: 'snapshot' });
  assert.equal(restored.matchSeed, state.matchSeed, 'recovered connection adopts saved match, not a new solo board');
  assert(restored.tick >= 150);
  const sim = await query(p, { type: 'sim' });
  assert.equal(sim.connection.player, 1); assert.equal(sim.connection.connected, true);
  assert.equal(await p.$('#app > #game-message'), null, 'startup unavailable notice removed after joining');
  const tc = (await query(p, { type: 'entities', owner: 1 })).entities.find(e => e.kind === 'town-center');
  await query(p, { type: 'select', ids: [tc.id] });
  await p.locator('[data-command="train-villager"]:not([disabled])').click();
  await p.keyboard.press('F3');
  await p.waitForFunction(async food => (await (window as any).__empiresDebug({ type: 'sim' })).players[1].food === food - 50,
    { timeout: 30_000 }, sim.players[1].food);
  await pause(p);
  console.log('Failed502 startup stayed unavailable, preserved saved state, recovered without reload and accepted a paid shared train click');
  await p.close();

  mode = 'offline';
  const before = requests, solo = await page();
  await solo.goto('http://127.0.0.1:5246/?solo=1', { waitUntil: 'domcontentloaded' }); await ready(solo);
  const soloConnection = (await query(solo, { type: 'sim' })).connection;
  assert.equal(soloConnection.connected, false); assert.equal(soloConnection.synchronization, undefined);
  assert.equal(requests, before, 'explicit solo never requests shared config');
  await solo.close();
  for (const standalone of ['missing', 'html', 'disabled'] as const) {
    mode = standalone;
    const p = await page(); await p.goto('http://127.0.0.1:5246/', { waitUntil: 'domcontentloaded' }); await ready(p);
    const connection = (await query(p, { type: 'sim' })).connection;
    assert.equal(connection.connected, false, `${standalone} remains standalone`);
    assert.equal(connection.synchronization, undefined, `${standalone} has no shared client`);
    await p.close();
  }
  assert.deepEqual(errors, []);
  console.log(`SHARED CONFIG SMOKE GREEN (${fallback ? 'fallback' : 'owned'}): recovery, explicit solo, static404/HTML and disabled config`);
} catch (error) {
  for (const trace of diagnostics) await trace.capture(error, 'shared configuration failure/recovery');
  throw error;
} finally {
  for (const trace of diagnostics) trace.dispose();
  await browser.close(); await server.close(); rmSync(directory, { recursive: true, force: true });
}
