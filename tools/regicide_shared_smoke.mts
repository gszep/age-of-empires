/** Real two-page mode setup and Treason through a private authoritative host. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Page } from 'puppeteer';
import { createServer } from 'vite';
import { sharedMatchPlugin } from '../src/shared/server.ts';
import { SHARED_VERSION } from '../src/shared/protocol.ts';
import { createGame } from '../src/sim/game.ts';
import { rulesFromManifest } from '../src/sim/data.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const checkpoint = `${root}.local/regicide-shared-${process.pid}.json`;
const rules = rulesFromManifest(JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8')));
const { rules: omitted, ...state } = createGame(130, rules, undefined, 'islands', 'regicide');
state.players[1].gold = 900; // funded starting fixture; subsequent changes are public commands
writeFileSync(checkpoint, JSON.stringify({ version: SHARED_VERSION,
  rulesHash: createHash('sha256').update(JSON.stringify(rules)).digest('hex'), state,
  settings: { paused: true, speed: 1, generation: 0 }, humanTwo: true,
  setup: { map: 'islands', seed: 130, mode: 'regicide' } }));
const server = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error',
  plugins: [sharedMatchPlugin(root, checkpoint)], server: { host: '127.0.0.1', port: 5294, strictPort: true } });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
const query = (page: Page, q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
const wait = (page: Page, mode: string) => page.waitForFunction(async mode => {
  const s = await (window as any).__empiresDebug({ type: 'sim' }); return s.mode === mode;
}, { polling: 100 }, mode);
const click = async (page: Page, selector: string) => {
  await page.waitForFunction(selector => {
    const e = document.querySelector<HTMLInputElement>(selector); if (!e || e.disabled) return false;
    const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0
      && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest(selector) === e;
  }, { polling: 100 }, selector);
  const p = await page.evaluate(selector => {
    const r = document.querySelector(selector)!.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
  await page.mouse.click(p.x, p.y);
};
let completed = false;
try {
  const pages = [await browser.newPage(), await browser.newPage()];
  const errors: string[] = [];
  for (const [i, page] of pages.entries()) {
    page.on('pageerror', e => errors.push(String(e)));
    await page.setViewport({ width: 1280, height: 800 }); await page.bringToFront();
    await page.goto(`http://127.0.0.1:5294/?player=${i + 1}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120000, polling: 100 });
    assert.equal((await query(page, { type: 'sim' })).connection.player, i + 1); await wait(page, 'regicide');
  }
  const [a, b] = pages;
  await click(b, '[data-menu="open"]');
  assert(await b.$eval('#regicide-mode', e => (e as HTMLInputElement).checked && (e as HTMLInputElement).disabled));
  await b.keyboard.press('F10');
  await a.bringToFront();
  const castle = state.entities.find(e => e.kind === 'castle' && e.owner === 1)!;
  await query(a, { type: 'select', ids: [castle.id] }); await click(a, '[data-command="treason"]');
  await a.keyboard.press('F3');
  for (const page of pages) await page.waitForFunction(async () => {
    const s = await (window as any).__empiresDebug({ type: 'sim' }); return s.players[1].gold === 500;
  }, { polling: 100 });
  await a.keyboard.press('F3');
  for (const page of pages) await page.waitForFunction(async () => {
    const s = await (window as any).__empiresDebug({ type: 'sim' }); return s.connection.paused && s.connection.pendingTicks === 0;
  }, { polling: 100 });
  const [one, two] = await Promise.all(pages.map(page => query(page, { type: 'sim' })));
  assert.equal(one.synchronizationHash, two.synchronizationHash, 'both browser simulations agree after paid Treason');
  for (const mode of ['random-map', 'regicide']) {
    await a.bringToFront(); await click(a, '[data-menu="open"]');
    await click(a, '#regicide-mode'); await click(a, '#map-setup button[type="submit"]');
    for (const page of pages) await wait(page, mode);
    for (const page of pages) {
      const s = await query(page, { type: 'snapshot' });
      assert.equal(s.entities.filter((e: any) => e.kind === 'king').length, mode === 'regicide' ? 2 : 0);
      assert.equal(s.treasonUntil, undefined, 'new match clears temporary intelligence');
    }
  }
  await a.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await a.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120000, polling: 100 });
  await wait(a, 'regicide');
  assert.deepEqual(errors, []);
  completed = true;
  console.log('SHARED REGICIDE GREEN: two actual v2 clients, guest setup read-only, real Treason click/payment, equal synchronization hashes, both mode switches and reconnect');
} finally {
  await browser.close(); await server.close();
  const saved = JSON.parse(readFileSync(checkpoint, 'utf8'));
  if (completed) { assert.equal(saved.state.mode, 'regicide'); assert.equal(saved.setup.mode, 'regicide'); }
  rmSync(checkpoint, { force: true });
}
