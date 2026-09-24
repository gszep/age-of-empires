/** #58: real Delete key/buttons, notification lifetime, and owned palette CSS. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { createGame } from '../src/sim/game.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const fallback = process.env.OPEN_FALLBACK === '1';
const rules = fallback ? FALLBACK_RULES : rulesFromManifest(JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8')));
const state = createGame(58, rules);
const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
tc.researching = { tech: 'loom', remainingTicks: 1 };
state.entities.push({ id: state.nextId++, kind: 'militia', owner: 2,
  position: { x: worker.position.x + 0.5, y: worker.position.y },
  hp: rules.units.militia.hp, maxHp: rules.units.militia.hp, radius: rules.units.militia.radius,
  activity: 'idle', order: { kind: 'attack', targetId: worker.id } });
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'feedback-probe', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    const anchor = 'renderer.setAnimationLoop(now => {';
    assert(code.includes(anchor));
    return code.replace(anchor,
      'Object.defineProperty(window, "__feedbackHud", { get: () => hud });\n'
      + '(window as any).__feedbackRebuild = rebuildPresentation;\n'
      + anchor + '\npaused = !(window as any).__feedbackRun;');
  },
}], server: { host: '127.0.0.1', port: 5268, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  if (fallback) {
    await page.setRequestInterception(true);
    page.on('request', request => { void (request.url().includes('/imported/') ? request.respond({ status: 404, body: '' }) : request.continue()); });
  }
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5268/?solo=1&uiPalette=deuteranopia', { waitUntil: 'networkidle0', timeout: 120_000 });
  await page.waitForFunction(() => !!(window as any).__feedbackHud, { timeout: 60_000 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  assert.equal((await query({ type: 'sim' })).tick, state.tick);
  await page.evaluate(() => { (window as any).__feedbackRun = true; });
  await page.waitForFunction(() => {
    const text = document.querySelector('.message-lines')!.textContent!;
    return text.includes('Loom') && text.includes('under attack');
  }, { timeout: 20_000 });
  await page.evaluate(() => { (window as any).__feedbackRun = false; });
  const alive = async (id: number) => (await query({ type: 'entities', id })).entities.some((e: any) => e.id === id && !e.dead);
  await query({ type: 'select', ids: [tc.id] });
  await page.keyboard.press('Delete');
  await page.waitForSelector('#confirm-dialog[open]');
  assert(await alive(tc.id), 'opening the question does not delete');
  if (!fallback) {
    const geometry = await page.$eval('#confirm-dialog', e => ({ width: e.getBoundingClientRect().width, art: getComputedStyle(e).backgroundImage }));
    assert(Math.abs(geometry.width - 1280 / 3) < 1);
    assert(geometry.art.includes('popup'));
    assert.equal(await page.$eval('#hud', e => getComputedStyle(e).getPropertyValue('--ui-Red-Text').trim()), 'rgba(255, 221, 115, 1)');
  }
  await page.click('[data-answer="no"]');
  assert(await alive(tc.id));
  await page.keyboard.press('Delete');
  await page.waitForSelector('#confirm-dialog[open]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector<HTMLDialogElement>('#confirm-dialog')!.open);
  assert(await alive(tc.id));
  assert.equal(await page.$eval('#menu-dialog', e => e.classList.contains('hidden')), true, 'Escape does not open the game menu');
  // A lifecycle abort must not be mistaken for No: No deliberately deletes
  // unflagged members, whereas an HMR rebuild must leave all game state alone.
  await query({ type: 'select', ids: [tc.id, worker.id] });
  await page.keyboard.press('Delete');
  await page.waitForSelector('#confirm-dialog[open]');
  const beforeRebuild = (await query({ type: 'sim' })).synchronizationHash;
  assert.equal(typeof beforeRebuild, 'string');
  await page.evaluate(() => (window as any).__feedbackRebuild());
  assert.equal((await query({ type: 'sim' })).synchronizationHash, beforeRebuild, 'HUD rebuild is simulation-read-only');
  assert(await alive(tc.id));
  assert(await alive(worker.id), 'teardown must not delete the unflagged member');
  assert.equal(await page.$('#confirm-dialog[open]'), null);
  // A mixed selection preserves the pre-existing unflagged deletion semantics.
  await query({ type: 'select', ids: [tc.id, worker.id] });
  await page.keyboard.press('Delete');
  await page.waitForSelector('#confirm-dialog[open]');
  await page.click('[data-answer="no"]');
  assert(await alive(tc.id));
  assert.equal(await alive(worker.id), false);
  await query({ type: 'select', ids: [tc.id] });
  await page.keyboard.press('Delete');
  await page.waitForSelector('#confirm-dialog[open]');
  await page.click('[data-answer="yes"]');
  assert.equal(await alive(tc.id), false, 'Yes issues the public delete command');
  await page.waitForFunction(() => document.querySelector('.message-lines')!.childElementCount === 0, { timeout: 10_000 });
  if (!fallback) {
    // Verify actual background contribution at full opacity. A controlled
    // battlefield plane prevents animation from influencing sRGB readback.
    await page.evaluate(() => {
      const plane = document.createElement('div');
      plane.id = 'feedback-test-plane';
      Object.assign(plane.style, { position: 'absolute', inset: '0', background: 'rgb(240, 240, 240)' });
      document.querySelector('#hud')!.before(plane);
      (window as any).__feedbackHud.showMessage('Background visibility');
    });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#game-message')!).opacity === '1');
    const point = await page.$eval('#game-message', e => {
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height * 0.7) };
    });
    const sampleSrgb = async () => {
      const screenshot = await page.screenshot();
      return page.evaluate(async ({ data, point }) => {
        const image = new Image(); image.src = data; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
        return [...context.getImageData(point.x, point.y, 1, 1).data];
      }, { data: 'data:image/png;base64,' + Buffer.from(screenshot).toString('base64'), point });
    };
    const visible = await sampleSrgb();
    await page.$eval('.notification-surround', e => (e as HTMLElement).style.visibility = 'hidden');
    const hidden = await sampleSrgb();
    assert.deepEqual(hidden, [240, 240, 240, 255], 'controlled sRGB background');
    assert(visible.slice(0, 3).every((channel, i) => channel < hidden[i]), 'owned Surround must darken the battlefield at opacity one');
    console.log('Notification background sRGB:', { visible, hidden });
    await page.evaluate(() => {
      (document.querySelector('.notification-surround') as HTMLElement).style.removeProperty('visibility');
      document.querySelector('#feedback-test-plane')!.remove();
    });
    await page.waitForFunction(() => document.querySelector('.message-lines')!.childElementCount === 0, { timeout: 10_000 });
  }
  await page.evaluate(() => {
    const hud = (window as any).__feedbackHud;
    hud.showMessage('First message');
    hud.showMessage('<b>Second message</b>');
  });
  assert.equal(await page.$eval('.message-lines', e => e.children.length), 2);
  assert.equal(await page.$('.message-lines b'), null, 'messages are text, never markup');
  if (!fallback) {
    const box = await page.$eval('#game-message', e => ({ x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y, cells: e.querySelectorAll('.notification-surround span').length }));
    assert(Math.abs(box.x - 40 / 3) < 1);
    assert(Math.abs(box.y - 305 / 3) < 1);
    assert.equal(box.cells, 9);
    assert.equal(await page.$eval('.message-lines', e => getComputedStyle(e).color), 'rgb(255, 255, 255)');
  }
  await page.evaluate(() => { window.setTimeout(() => (window as any).__feedbackHud.showMessage('Later message'), 3000); });
  await page.waitForFunction(() => document.querySelector('.message-lines')!.textContent === 'Later message', { timeout: 10_000 });
  assert.equal(await page.$eval('#game-message', e => e.classList.contains('show')), true, 'an older expiry cannot hide a newer message');
  await page.waitForFunction(() => !document.querySelector('#game-message')!.classList.contains('show'), { timeout: 10_000 });
  await page.evaluate(() => { for (let i = 0; i < 8; i++) (window as any).__feedbackHud.showMessage(String(i)); });
  assert.deepEqual(await page.$$eval('.message-lines > div', elements => elements.map(e => e.textContent)), ['3', '4', '5', '6', '7']);
  assert.deepEqual(errors, []);
  console.log(`FEEDBACK GREEN (${rules.origin}): attack/research alerts; Delete/No/Escape/mixed/Yes; read-only HUD rebuild; notification text, bounds, expiry; owned geometry/palette/background pixels`);
} finally {
  await browser.close();
  await server.close();
}
