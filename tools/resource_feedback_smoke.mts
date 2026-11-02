/** #70: unaffordable build/train/research buttons remain actionable and show
 * the owned resource warning, without spending resources or changing the match. */
import assert from 'node:assert/strict';
import { ownedManifest, startServer, launchBrowser, blockImported } from './smoke-harness.mjs';
import { createGame } from '../src/sim/game.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';

const fallback = process.env.OPEN_FALLBACK === '1';
const manifest = ownedManifest();
const rules = fallback ? FALLBACK_RULES : rulesFromManifest(manifest);
const state = createGame(70, rules);
Object.assign(state.players[1], { food: 0, wood: 0, gold: 0, stone: 0 });
const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
const { rules: ignored, ...saved } = state;
const server = await startServer({ plugins: [{
  name: 'resource-feedback-probe', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    const anchor = 'renderer.setAnimationLoop(now => {';
    assert(code.includes(anchor));
    return code.replace(anchor, anchor + '\npaused = true;');
  },
}], port: 5275 });
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  if (fallback) await blockImported(page);
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:5275/?solo=1', { waitUntil: 'networkidle0', timeout: 120_000 });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 60_000 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  const before = await query({ type: 'sim' });
  assert.equal(before.tick, state.tick);
  assert.equal((await query({ type: 'snapshot' })).players[1].food, 0, 'fixture resumed');
  const click = async (id: string) => {
    const selector = `.command-button[data-command="${id}"]`;
    await page.waitForSelector(selector);
    assert.equal(await page.$eval(selector, e => (e as HTMLButtonElement).disabled), false, `${id} remains clickable`);
    await page.locator(selector).click();
  };
  for (const [id, resource] of [['train-villager', 'Food'], ['research-loom', 'Gold']] as const) {
    await query({ type: 'select', ids: [tc.id] });
    await click(id);
    const expected = fallback ? `not enough ${resource.toLowerCase()}` : manifest.strings[`notEnough${resource}`];
    assert(expected);
    await page.waitForFunction(text => document.querySelector('.message-lines')?.textContent?.includes(text), {}, expected);
    assert.equal((await query({ type: 'sim' })).synchronizationHash, before.synchronizationHash, 'rejection changes no simulation state');
  }
  await query({ type: 'select', ids: [worker.id] });
  await click('page-economic');
  await click('build-house');
  const expected = fallback ? 'not enough wood' : manifest.strings.notEnoughWood;
  await page.waitForFunction(text => document.querySelector('.message-lines')?.textContent?.includes(text), {}, expected);
  assert.equal((await query({ type: 'sim' })).synchronizationHash, before.synchronizationHash);
  assert.deepEqual(errors, []);
  console.log(`RESOURCE FEEDBACK GREEN (${fallback ? 'fallback' : 'owned'}): real train/research/build clicks with zero resources; food/gold/wood warnings; unchanged simulation`);
} finally { await browser.close(); await server.close(); }
