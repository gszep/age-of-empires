/** #58: real Delete key/buttons, notification lifetime, and owned palette CSS. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { createGame } from '../src/sim/game.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const fallback = process.env.OPEN_FALLBACK === '1';
const fixtures = mkdtempSync(`${root}.local/feedback-files-`);
writeFileSync(`${fixtures}/malformed.json`, '{');
writeFileSync(`${fixtures}/invalid-record.json`, '{}');
writeFileSync(`${fixtures}/wrong-rules.json`, JSON.stringify({ version: 1, commands: [], checksums: [], rulesOrigin: 'different' }));
const rules = fallback ? FALLBACK_RULES : rulesFromManifest(JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8')));
const state = createGame(58, rules);
const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
tc.researching = { tech: 'loom', remainingTicks: 1 };
tc.training = { kind: 'villager', remainingTicks: 0 };
state.entities.push({ ...structuredClone(worker), id: state.nextId++, position: { x: tc.position.x - 3, y: tc.position.y } });
state.players[1].population = state.players[1].populationCap;
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
  await page.goto('http://127.0.0.1:5268/?solo=1', { waitUntil: 'networkidle0', timeout: 120_000 });
  await page.waitForFunction(() => !!(window as any).__feedbackHud, { timeout: 60_000 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  const pixelsAt = async (points: { x: number; y: number }[]) => {
    const screenshot = await page.screenshot();
    return page.evaluate(async ({ data, points }) => {
      const image = new Image(); image.src = data; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
      return points.map(p => [...context.getImageData(p.x, p.y, 1, 1).data]);
    }, { data: 'data:image/png;base64,' + Buffer.from(screenshot).toString('base64'), points });
  };
  const checkTransparentCorner = async (selector: string) => {
    const points = await page.$eval(selector, async element => {
      const image = new Image();
      image.src = getComputedStyle(element).backgroundImage.slice(5, -2);
      await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
      if (context.getImageData(1, 1, 1, 1).data[3] !== 0) throw new Error('source precondition: transparent parchment corner');
      const plane = document.createElement('div'); plane.id = 'dialog-test-plane';
      Object.assign(plane.style, { position: 'absolute', inset: '0', background: 'rgb(240, 240, 240)' });
      // Above the ordinary HUD/menu (including its shadow), below native
      // top-layer dialog/backdrop. Both sample positions share one backdrop.
      document.querySelector('#hud')!.after(plane);
      const r = element.getBoundingClientRect();
      return [{ x: Math.ceil(r.x) + 1, y: Math.ceil(r.y) + 1 }, { x: Math.floor(r.x) - 2, y: Math.ceil(r.y) + 1 }];
    });
    const [inside, outside] = await pixelsAt(points);
    assert.deepEqual(inside, outside, `${selector}: transparent owned corner must show the dimmed battlefield, not fallback fill`);
    console.log(`${selector} corner sRGB:`, { inside, outside });
    await page.evaluate(() => document.querySelector('#dialog-test-plane')!.remove());
  };
  assert.equal((await query({ type: 'sim' })).tick, state.tick);
  await page.waitForSelector('.production-item[title="Loom"]');
  await page.waitForSelector('#production-warning:not([hidden])');
  assert.equal(await page.$eval('.warning-text', e => e.textContent), 'You need more houses to continue unit production.');
  assert.equal(await page.$eval('[data-value="population"]', e => e.classList.contains('production-blocked')), true);
  if (!fallback) {
    await page.setViewport({ width: 2560, height: 1440 });
    await page.screenshot({ path: `${root}.local/issue58-housing-owned.png` });
    const warning = await page.$eval('#production-warning', e => {
      const r = e.getBoundingClientRect(); return { centre: r.x + r.width / 2, bottom: innerHeight - r.bottom, width: r.width, height: r.height };
    });
    assert(Math.abs(warning.centre - (1280 + 200 * 2 / 3)) < 1);
    assert(Math.abs(warning.bottom - 374 * 2 / 3) < 1);
    assert(Math.abs(warning.width - 828 * 2 / 3) < 1);
    assert(Math.abs(warning.height - 134 * 2 / 3) < 1);
    const flash = await page.$eval('#population-flash', e => ({ width: e.getBoundingClientRect().width, color: getComputedStyle(e).backgroundColor }));
    assert(Math.abs(flash.width - 140 * 2 / 3) < 1);
    assert.equal(flash.color, 'rgba(255, 255, 0, 0.7)');
    await page.setViewport({ width: 1280, height: 800 });
  }
  await page.click('.production-item[title="Loom"]');
  assert((await query({ type: 'entities', id: tc.id })).entities[0].selected, 'global research icon selects its producer');
  assert((await query({ type: 'command', command: { kind: 'cancel-train', player: 1, buildingId: tc.id } })).ok);
  await page.waitForSelector('#production-warning[hidden]');
  assert.equal(await page.$eval('[data-value="population"]', e => e.classList.contains('production-blocked')), false, 'full population alone is not blocked production');
  await page.evaluate(() => { (window as any).__feedbackRun = true; });
  await page.waitForFunction(() => {
    const text = document.querySelector('.message-lines')!.textContent!;
    return text.includes('Loom') && text.includes('under attack');
  }, { timeout: 20_000 });
  await page.evaluate(() => { (window as any).__feedbackRun = false; });
  const alive = async (id: number) => (await query({ type: 'entities', id })).entities.some((e: any) => e.id === id && !e.dead);
  for (const [file, expected, dismiss] of [
    ['malformed.json', 'Not a valid replay file', 'click'],
    ['invalid-record.json', 'Not a valid replay file', 'Enter'],
    ['wrong-rules.json', 'Replay was recorded with different rules;', 'Escape'],
  ]) {
    const hash = (await query({ type: 'sim' })).synchronizationHash;
    if (await page.$eval('#menu-dialog', e => e.classList.contains('hidden'))) await page.keyboard.press('F10');
    const chooser = page.waitForFileChooser();
    await page.click('[data-menu="load-replay"]');
    await (await chooser).accept([`${fixtures}/${file}`]);
    await page.waitForSelector('#popup-dialog[open]');
    assert((await page.$eval('#popup-message', e => e.textContent!)).includes(expected));
    assert.equal(await page.$eval('[data-popup-ok]', e => e.textContent), 'OK');
    if (!fallback && file === 'malformed.json') {
      const boxes = await page.$eval('#popup-dialog', e => {
        const rect = e.getBoundingClientRect(), text = e.querySelector('p')!.getBoundingClientRect();
        const button = e.querySelector('button')!.getBoundingClientRect();
        return { width: rect.width, height: rect.height, textX: text.x - rect.x, textY: text.y - rect.y,
          buttonX: button.x - rect.x, buttonY: button.y - rect.y, art: getComputedStyle(e).backgroundImage };
      });
      for (const [key, value] of Object.entries({ width: 1280, height: 720, textX: 90, textY: 75, buttonX: 420, buttonY: 575 })) {
        assert(Math.abs(boxes[key as keyof typeof boxes] as number - value / 3) < 1, `popup source geometry: ${key}`);
      }
      assert.notEqual(boxes.art, 'none');
      await checkTransparentCorner('#popup-dialog');
      await page.hover('[data-popup-ok]');
      assert(Math.abs(await page.$eval('[data-popup-ok]', e => parseFloat(getComputedStyle(e).fontSize)) - 45 * 0.7 / 3) < 0.1);
      await page.setViewport({ width: 2000, height: 1125 });
      await page.screenshot({ path: `${root}.local/issue58-popup-owned.png` });
      await page.setViewport({ width: 1280, height: 800 });
    }
    if (dismiss === 'click') await page.click('[data-popup-ok]');
    else await page.keyboard.press(dismiss);
    await page.waitForFunction(() => !document.querySelector<HTMLDialogElement>('#popup-dialog')!.open);
    assert.equal((await query({ type: 'sim' })).synchronizationHash, hash, 'invalid replay acknowledgement is read-only');
  }
  if (!await page.$eval('#menu-dialog', e => e.classList.contains('hidden'))) await page.keyboard.press('F10');
  await query({ type: 'select', ids: [tc.id] });
  await page.keyboard.press('Delete');
  await page.waitForSelector('#confirm-dialog[open]');
  assert(await alive(tc.id), 'opening the question does not delete');
  if (!fallback) {
    const geometry = await page.$eval('#confirm-dialog', e => ({ width: e.getBoundingClientRect().width, pieces: e.querySelectorAll('.native-frame > span').length,
      font: getComputedStyle(e.querySelector('#confirm-message')!).fontFamily }));
    assert(Math.abs(geometry.width - 1400 / 3) < 1);
    assert.equal(geometry.pieces, 9);
    assert(geometry.font.includes('AoE2 body'));
    assert.equal(await page.$eval('#hud', e => getComputedStyle(e).getPropertyValue('--ui-Red-Text').trim()), 'rgba(255, 100, 100, 1)');
    await page.setViewport({ width: 2560, height: 1440 });
    await page.screenshot({ path: `${root}.local/issue58-confirmation-owned.png` });
    assert(Math.abs(await page.$eval('#confirm-dialog', e => e.getBoundingClientRect().width) - 1400 * 2 / 3) < 1, '100% UI at 1440p must not hit the old 0.62 cap');
    await page.setViewport({ width: 1280, height: 800 });
  }
  await page.click('[data-answer="no"]');
  assert(await alive(tc.id));
  await page.keyboard.press('Delete');
  await page.waitForSelector('#confirm-dialog[open]');
  await page.click('[data-confirm-cancel]');
  assert(await alive(tc.id), 'the reference close button is cancellation');
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
      return { x: Math.round(r.x + r.width * 0.85), y: Math.round(r.y + r.height * 0.7) };
    });
    const sampleSrgb = async () => {
      return (await pixelsAt([point]))[0];
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
    hud.showMessage('--Loom Research Complete--');
  });
  if (!fallback) {
    await page.setViewport({ width: 2560, height: 1440 });
    await page.waitForFunction(() => Math.abs(parseFloat(getComputedStyle(document.querySelector('#hud')!).getPropertyValue('--ui-scale')) - 2 / 3) < 0.0001);
    const messageHeight = await page.$eval('#game-message', e => e.getBoundingClientRect().height);
    assert(Math.abs(messageHeight - 60 * 2 / 3) < 1, `one-row height at 1440p: ${messageHeight}`);
    await page.screenshot({ path: `${root}.local/issue58-notification-owned.png` });
    await page.setViewport({ width: 1280, height: 800 });
    await page.waitForFunction(() => Math.abs(parseFloat(getComputedStyle(document.querySelector('#hud')!).getPropertyValue('--ui-scale')) - 1 / 3) < 0.0001);
  }
  await page.evaluate(() => (window as any).__feedbackHud.showMessage('<b>Second message</b>'));
  assert.equal(await page.$eval('.message-lines', e => e.children.length), 2);
  if (!fallback) {
    assert(Math.abs(await page.$eval('#game-message', e => e.getBoundingClientRect().height) - 100 / 3) < 1,
      'two rows use 2*40 plus 2*10 padding, not the 250px template maximum');
  }
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
  // The earlier real Yes deleted our TC. Resume through the normal winner
  // check to prove the defeated-player panel is wired to the match outcome.
  await page.evaluate(() => { (window as any).__feedbackRun = true; });
  await page.waitForSelector('#defeat-notification:not([hidden])');
  assert.equal((await query({ type: 'sim' })).winner, 2);
  assert.equal(await page.$eval('.defeat-text', e => e.textContent), 'Player 1 was defeated');
  assert.equal(await page.$eval('.defeat-number', e => e.textContent), '1');
  if (!fallback) {
    const box = await page.$eval('#defeat-notification', e => {
      const r = e.getBoundingClientRect(), label = e.querySelector('.defeat-text')!.getBoundingClientRect();
      const civ = e.querySelector('.defeat-civ')!;
      return { x: r.x, y: r.y, width: r.width, height: r.height, labelX: label.x - r.x,
        civWidth: civ.getBoundingClientRect().width, civArt: getComputedStyle(civ).backgroundImage };
    });
    for (const [key, value] of Object.entries({ x: 1140, y: 110, width: 520, height: 100, labelX: 144.5, civWidth: 75 })) {
      assert(Math.abs((box[key as keyof typeof box] as number) - value / 3) < 1, `defeat source geometry: ${key}`);
    }
    assert.notEqual(box.civArt, 'none');
    await page.setViewport({ width: 2560, height: 1440 });
    await page.screenshot({ path: `${root}.local/issue58-defeat-owned.png` });
    await page.setViewport({ width: 1280, height: 800 });
  }
  await page.waitForSelector('#defeat-notification[hidden]', { timeout: 10_000 });
  assert.equal((await query({ type: 'sim' })).winner, 2, 'notification expiry does not restart the match');
  const endHash = (await query({ type: 'sim' })).synchronizationHash;
  if (!fallback) {
    const ink = () => page.$eval('.end-embers', element => {
      const c = element as HTMLCanvasElement;
      return Array.from(c.getContext('2d')!.getImageData(0, 0, 256, 128).data).reduce((sum, n) => sum + n, 0);
    });
    const first = await ink();
    assert(first > 0, 'animated embers are actually drawn');
    await page.waitForFunction(before => {
      const c = document.querySelector<HTMLCanvasElement>('.end-embers')!;
      return Array.from(c.getContext('2d')!.getImageData(0, 0, 256, 128).data).reduce((sum, n) => sum + n, 0) !== before;
    }, {}, first);
  }
  await page.click('[data-end="return"]');
  assert.equal(await page.$eval('#end-dialog', e => (e as HTMLDialogElement).open), false);
  assert.equal((await query({ type: 'sim' })).synchronizationHash, endHash, 'Return to Map does not restart or mutate the match');
  await page.evaluate(() => (window as any).__feedbackRebuild());
  assert.equal(await page.$eval('#end-dialog', e => (e as HTMLDialogElement).open), false, 'HMR respects dismissal');
  // A fresh page re-stages the same snapshot via evaluateOnNewDocument. The
  // other player's public deletion proves a victory names the loser, not us.
  await page.reload({ waitUntil: 'networkidle0', timeout: 120_000 });
  await page.waitForFunction(() => !!(window as any).__feedbackHud, { timeout: 60_000 });
  assert.equal((await query({ type: 'sim' })).tick, state.tick);
  await page.waitForSelector('.score-row:nth-child(2) .score-name');
  const opponentName = await page.$eval('.score-row:nth-child(2) .score-name', e => e.textContent!);
  await query({ type: 'select', ids: [tc.id, worker.id] });
  await page.keyboard.press('Delete');
  await page.waitForSelector('#confirm-dialog[open]');
  const enemyTc = state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!;
  assert.equal((await query({ type: 'command', command: { kind: 'delete', player: 2, entityIds: [enemyTc.id] } })).ok, true);
  await page.evaluate(() => { (window as any).__feedbackRun = true; });
  await page.waitForSelector('#defeat-notification:not([hidden])');
  assert.equal((await query({ type: 'sim' })).winner, 1);
  assert.equal(await page.$eval('.defeat-text', e => e.textContent), `${opponentName} was defeated`);
  assert.equal(await page.$eval('.defeat-number', e => e.textContent), '2');
  assert(await alive(tc.id));
  assert(await alive(worker.id), 'a match-ending modal aborts, rather than declines, a pending mixed deletion');
  assert.equal(await page.$('#confirm-dialog[open]'), null);
  await page.click('[data-end="leave"]');
  assert.equal(await page.$eval('#end-dialog', e => (e as HTMLDialogElement).open), false);
  assert.equal(await page.$eval('#menu-dialog', e => e.classList.contains('hidden')), false, 'Leave Map opens the existing match launcher');
  await page.select('#map-choice', 'arabia');
  await page.locator('#map-seed').fill('59');
  await page.click('#map-setup button[type="submit"]');
  await page.waitForSelector('#menu-dialog.hidden');
  assert.equal((await query({ type: 'sim' })).connection.setup.seed, 59, 'Leave Map -> Start Game begins the requested match');
  assert.deepEqual(errors, []);
  console.log(`FEEDBACK GREEN (${rules.origin}): replay error popups; actual defeat; attack/research alerts; Delete/No/Escape/mixed/Yes; read-only HUD rebuild; notification text, bounds, expiry; owned geometry/palette/background pixels`);
} finally {
  await browser.close();
  await server.close();
  rmSync(fixtures, { recursive: true, force: true });
}
