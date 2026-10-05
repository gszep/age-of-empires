/** #295: research in progress shows its icon in the selection panel, and clicking it cancels with a refund. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { createGame } from '../src/sim/game.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import { updateVisibility } from '../src/sim/visibility.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'));
assert.equal(manifest.strings?.stopResearching, 'Click to stop researching this item.', 'run npm run import:aoe2');
const rules = rulesFromManifest(manifest), state = createGame(295, rules);
state.entities = state.entities.filter(e => e.kind === 'town-center' || e.kind === 'villager');
const tc = state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
updateVisibility(state);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'research-cancel-fixture', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    assert(code.includes('let paused = false;'));
    return code.replace('let paused = false;', 'let paused = true;');
  },
}], server: { host: '127.0.0.1', port: 5274, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage(), errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5274/?solo=1', { waitUntil: 'networkidle0', timeout: 120_000 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  const purse = async () => { const p = (await query({ type: 'snapshot' })).players[1]; return [p.food, p.wood, p.gold, p.stone]; };
  await query({ type: 'look', entity: tc.id });
  await query({ type: 'select', ids: [tc.id] });
  const before = await purse();
  // Public research through the HUD's own button.
  await page.waitForSelector('[data-command="research-loom"]', { timeout: 30_000 });
  await page.click('[data-command="research-loom"]');
  const paid = await purse();
  assert.notDeepEqual(paid, before, 'Loom was paid for');
  const portrait = await page.waitForSelector('#training-active .production-portrait', { visible: true, timeout: 10_000 });
  const shown = await portrait!.evaluate(button => ({
    title: button.getAttribute('title'), image: getComputedStyle(button).backgroundImage,
    status: document.querySelector('.training-status')?.textContent,
  }));
  console.log(JSON.stringify(shown));
  assert.match(shown.title ?? '', /^Loom\nClick to stop researching this item\.$/);
  assert.match(shown.image, /url\(/, 'owned technology icon');
  assert.match(shown.status ?? '', /^Researching \d+%Loom$/);
  if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT });
  await portrait!.click();
  assert.deepEqual(await purse(), before, 'cancelling refunds Loom');
  const snapshot = await query({ type: 'snapshot' });
  assert(!snapshot.entities.find((e: any) => e.id === tc.id).researching, 'research stopped');
  await page.waitForFunction(() => !document.querySelector('#training-active .production-portrait'), { timeout: 5_000 });
  assert.deepEqual(errors, []);
  console.log('RESEARCH CANCEL GREEN: HUD research icon shown with owned strings; click refunds and stops it');
} finally { await browser.close(); await server.close(); }
