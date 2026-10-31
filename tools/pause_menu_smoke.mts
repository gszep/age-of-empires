/** #349: the native pause dialog and the separate lab setup surface, by real
 * clicks on a private host. Fallback mode by default; automatically serves a
 * published import when public/ exists (the owned checkpoint), where it also
 * asserts every wpfg material the dialog uses resolves on the loaded page.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser } from 'puppeteer';
import { createServer } from 'vite';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { runMatch } from '../src/headless/runner.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicDir = existsSync(`${root}public/imported/aoe2/manifest.json`) ? 'public' : false;
const port = 5241;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, publicDir, logLevel: 'error',
  server: { host: '127.0.0.1', port, strictPort: true } });
const errors: string[] = [];
const fixtures = mkdtempSync(`${root}.local/pause-files-`);
let browser: Browser | undefined;
try {
  await server.listen();
  const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
  browser = await puppeteer.launch({ headless: true,
    env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument('globalThis.__name = f => f');
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', error => { errors.push(String(error)); console.error(error); });
  await page.goto(`http://127.0.0.1:${port}/?solo=1&map=arabia&seed=349`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000 });
  const query = (request: object): Promise<any> => page.evaluate(value => (window as any).__empiresDebug(value), request);
  const until = (expression: string) => page.waitForFunction(async text => {
    const state = await (window as any).__empiresDebug({ type: 'sim' });
    return new Function('s', `return ${text}`)(state);
  }, { timeout: 30_000 }, expression);
  const menuShown = () => page.$eval('#menu-dialog', e => !e.classList.contains('hidden'));
  const native = await page.$eval('#menu-dialog', e => e.classList.contains('native-pause'));
  const stack = () => page.$$eval('#menu-dialog .menu-stack button', bs => bs.map(b => ({
    menu: b.dataset.menu ?? 'options', label: (b.textContent ?? '').trim(), disabled: b.disabled, title: b.title })));

  // The native stack: fixed XAML order, no heading, no separate Resume label,
  // unsupported actions greyed in place with the policy stated, not native.
  await page.keyboard.press('F10');
  const entries = await stack();
  assert.deepEqual(entries.map(e => [e.menu, e.label]), [
    ['invitations', 'Invitations'], ['quit', 'Quit Current Game'], ['resign', 'Resign'],
    ['statistics', 'Statistics'], ['save', 'Save Game'], ['load', 'Load Game'],
    ['spectate', 'Spectate With CA'], ['chapter', 'Save Chapter'], ['options', 'Options'],
    ['restart', 'Restart'], ['cancel', 'Cancel'], ['setup', 'Game Setup (Lab)']],
    'the eleven named native slots in XAML order, then the labelled lab entry');
  assert(await page.$eval('#menu-dialog', e => e.querySelector('h1, h2, h3') === null), 'no heading element');
  assert.equal(await page.$$eval('[data-menu="resume"]', bs => bs.length), 0, 'no Resume label: Cancel carries it');
  const disabled = entries.filter(e => e.disabled);
  assert.deepEqual(disabled.map(e => e.menu),
    ['invitations', 'quit', 'resign', 'statistics', 'save', 'load', 'spectate', 'chapter'],
    'unsupported native actions stay present and disabled');
  for (const entry of disabled) {
    assert(entry.title.includes('our product policy') && entry.title.includes('unverified'),
      `${entry.menu}: grey-out is stated as our policy, not native runtime behaviour`);
  }
  for (const entry of entries.filter(e => !e.disabled)) {
    assert(entry.label.length > 0, `${entry.menu}: enabled entries keep a label`);
  }
  assert(await page.$('#menu-dialog .menu-close'), 'the X close is present');

  // Disabled native actions are inert: while paused, a sweep of disabled
  // clicks changes no authoritative state and never dismisses the dialog.
  await page.keyboard.press('F3');
  await until('s.connection.paused');
  const before = await query({ type: 'sim' });
  for (const entry of disabled) {
    await page.click(`#menu-dialog [data-menu="${entry.menu}"]`);
    assert(await menuShown(), `${entry.menu}: a disabled click cannot close the menu`);
  }
  const after = await query({ type: 'sim' });
  assert.equal(after.synchronizationHash, before.synchronizationHash, 'disabled clicks cannot touch the match');
  assert.equal(after.tick, before.tick, 'disabled clicks cannot advance the match');

  // Cancel performs the old Resume semantics: close and explicitly unpause.
  await page.click('#menu-dialog [data-menu="cancel"]');
  await page.waitForSelector('#menu-dialog.hidden');
  await until('!s.connection.paused');
  // The X close closes without forcing an unpause, exactly like Escape.
  await page.keyboard.press('F3'); await until('s.connection.paused');
  await page.keyboard.press('F10');
  await page.click('#menu-dialog .menu-close');
  await page.waitForSelector('#menu-dialog.hidden');
  await until('s.connection.paused');
  // Escape still closes the pause dialog from the keyboard.
  await page.keyboard.press('F10');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#menu-dialog.hidden');

  // Options still routes to the existing overlay and closes the pause dialog.
  await page.keyboard.press('F10');
  await page.click('#menu-dialog [data-options]');
  await page.waitForSelector('#options-dialog[open]');
  await page.click('[data-option-action="cancel"]');
  assert.equal(await page.$eval('#options-dialog', e => (e as HTMLDialogElement).open), false);
  assert.equal(await page.evaluate(() => document.querySelector('#options-dialog')!.contains(document.activeElement)), false,
    'closing options releases focus from the closed dialog so game keys are not swallowed');

  // The lab setup surface is separate and labelled, holding the untouched
  // map-setup controls, civilization picks, host note and replay loading.
  await page.keyboard.press('F10');
  await page.click('#menu-dialog [data-menu="setup"]');
  await page.waitForSelector('#lab-dialog[open]');
  assert(await menuShown(), 'the pause dialog stays behind the lab surface');
  assert.equal(await page.$eval('#lab-title', e => e.textContent), 'Game Setup (Lab)');
  assert(await page.$eval('#map-setup', e => !!e.closest('#lab-dialog')), 'the form lives in the lab surface');
  assert.equal(await page.$eval('#map-setup', e => e.closest('#menu-dialog') !== null), false,
    'the form is out of the pause button stack');
  for (const selector of ['#map-choice', '#regicide-mode', '#population-limit', '#wonder-victory', '#map-seed',
    '#random-map-seed', '#map-host-note', '[data-menu="load-replay"]', '#replay-file']) {
    assert(await page.$(`#lab-dialog ${selector}`), `${selector} is inside the lab surface`);
  }
  assert.equal(await page.$$eval('#lab-dialog [data-lab-close]', bs => bs.length), 1, 'the lab surface closes itself');
  const civs = await page.$$eval('#civilization-1, #civilization-2', selects => selects.map(
    s => ({ options: s.querySelectorAll('option').length, value: (s as HTMLSelectElement).value })));
  assert.equal(civs.length, 2, 'both civilization picks are present');
  for (const pick of civs) {
    assert(pick.options >= 1 && pick.value !== '', 'each civilization pick kept its choices');
  }
  for (const control of ['#map-choice', '#population-limit', '#map-seed']) {
    assert(!await page.$eval(control, e => (e as HTMLSelectElement).disabled), `${control} stays enabled for the solo host`);
  }
  assert(await page.$eval('#map-host-note', e => e.hidden), 'no host restriction note for the solo host');
  const chooser = page.waitForFileChooser();
  await page.click('#lab-dialog [data-menu="load-replay"]');
  await (await chooser).cancel();

  // Escape closes the lab surface first and leaves the pause dialog up.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector<HTMLDialogElement>('#lab-dialog')!.open);
  assert(await menuShown(), 'Escape closes the lab surface, not the pause dialog behind it');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#menu-dialog.hidden');

  // The lab surface still starts a real match and closes both dialogs.
  await page.keyboard.press('F10');
  await page.click('#menu-dialog [data-menu="setup"]');
  await page.waitForSelector('#lab-dialog[open]');
  await page.select('#map-choice', 'islands');
  await page.locator('#map-seed').fill('21');
  await page.click('#map-setup button[type="submit"]');
  await page.waitForSelector('#menu-dialog.hidden');
  await page.waitForFunction(() => !document.querySelector<HTMLDialogElement>('#lab-dialog')!.open);
  await until("s.connection.setup.map === 'islands' && s.connection.setup.seed === 21");

  // Independent coverage of the route after feedback_smoke's preexisting
  // score-name assertion. Finish an actual match through a public command.
  const enemyTc = (await query({ type: 'entities', owner: 2 })).entities.find((e: any) => e.kind === 'town-center');
  assert(enemyTc, 'Leave Map fixture has an enemy town center');
  assert.equal((await query({ type: 'command', command: { kind: 'delete', player: 2, entityIds: [enemyTc.id] } })).ok, true);
  if ((await query({ type: 'sim' })).connection.paused) await page.keyboard.press('F3');
  await until('s.winner === 1');
  await page.waitForSelector('#end-dialog[open]');
  await page.click('[data-end="leave"]');
  assert.equal(await page.$eval('#end-dialog', e => (e as HTMLDialogElement).open), false);
  assert(await menuShown());
  await page.click('#menu-dialog [data-menu="setup"]');
  await page.waitForSelector('#lab-dialog[open]');
  await page.select('#map-choice', 'arabia');
  await page.locator('#map-seed').fill('59');
  await page.click('#map-setup button[type="submit"]');
  await until("s.connection.setup.map === 'arabia' && s.connection.setup.seed === 59 && !s.winner");
  assert.equal(await page.$eval('#lab-dialog', e => (e as HTMLDialogElement).open), false);
  console.log('Leave Map -> pause -> Lab -> Arabia seed 59: PASS');

  const rules = publicDir ? rulesFromManifest(JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'))) : FALLBACK_RULES;
  const replay = await runMatch({ version: 2, seed: 253, populationLimit: 25, maxTimeSeconds: 1 },
    { 1: { decide: () => [] }, 2: { decide: () => [] } }, rules);
  const replayPath = `${fixtures}/replay.json`;
  writeFileSync(replayPath, JSON.stringify(replay.record));
  for (let attempt = 0; attempt < 2; attempt++) {
    // Re-select the SAME file through the visible route, not a synthetic
    // change event. A new match in between proves the second selection loads.
    await page.keyboard.press('F10');
    await page.click('#menu-dialog [data-menu="setup"]');
    const selected = page.waitForFileChooser();
    await page.click('#lab-dialog [data-menu="load-replay"]');
    await (await selected).accept([replayPath]);
    await page.waitForSelector('#menu-dialog.hidden');
    await until('s.connection.setup.seed === 253');
    assert.equal((await query({ type: 'snapshot' })).populationLimit, 25);
    await page.keyboard.press('F10');
    await page.click('#menu-dialog [data-menu="setup"]');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector<HTMLDialogElement>('#lab-dialog')!.open);
    assert(await menuShown(), 'Escape after successful selection closes Lab only');
    await page.click('#menu-dialog [data-menu="setup"]');
    await page.locator('#map-seed').fill(String(60 + attempt));
    await page.click('#map-setup button[type="submit"]');
    await until(`s.connection.setup.seed === ${60 + attempt}`);
  }
  console.log('Visible replay selection, same-file repeat and subsequent Escape: PASS');
  await page.keyboard.press('F10');
  await page.click('#menu-dialog [data-menu="setup"]');
  for (let attempt = 0; attempt < 2; attempt++) {
    const canceled = page.waitForFileChooser();
    await page.click('#lab-dialog [data-menu="load-replay"]');
    await (await canceled).cancel();
    assert.equal(await page.$eval('#lab-dialog', e => (e as HTMLDialogElement).open), true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector<HTMLDialogElement>('#lab-dialog')!.open);
    assert(await menuShown(), 'canceling a chooser cannot trap subsequent Escape');
    if (attempt === 0) await page.click('#menu-dialog [data-menu="setup"]');
  }
  await page.keyboard.press('Escape');
  await page.waitForSelector('#menu-dialog.hidden');

  // The native materials resolve on the loaded page (owned mode only; the
  // open fallback correctly has none).
  const used = await page.evaluate(() => {
    const urls = new Set<string>();
    for (const sheet of Array.from(document.querySelectorAll('#menu-dialog .menu-frame span'))) {
      for (const match of (sheet as HTMLElement).style.backgroundImage.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) urls.add(match[1]);
    }
    for (const element of Array.from(document.querySelectorAll('#menu-dialog .menu-close, #menu-dialog .menu-stack .native-button'))) {
      for (const match of getComputedStyle(element).backgroundImage.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) urls.add(match[1]);
    }
    return [...urls];
  });
  if (native) {
    assert(used.length >= 6, `the pause dialog uses its frame, button and cross materials (found ${used.length})`);
    const resolved = await page.evaluate(async paths => Promise.all(paths.map(async path => {
      try { return { path, ok: (await fetch(path)).ok }; } catch { return { path, ok: false }; }
    })), used);
    for (const { path, ok } of resolved) assert(ok, `${path} resolves on the loaded page`);
  } else {
    assert(used.length === 0, 'the open fallback uses no owned materials');
    assert.equal(await page.$eval('#menu-dialog .menu-close', e => e.textContent), '×', 'fallback close stays textual');
  }

  // Usable on a small viewport: the scaled dialog stays inside the screen and
  // its buttons remain clickable.
  await page.setViewport({ width: 480, height: 360 });
  await page.keyboard.press('F10');
  const box = await page.$eval('#menu-dialog', e => {
    const r = e.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight };
  });
  assert(box.left >= 0 && box.top >= 0, 'the dialog starts inside the viewport');
  assert(box.right <= box.w && box.bottom <= box.h + 1, 'the scaled dialog fits the small viewport');
  for (const selector of ['.menu-close', ...entries.map(e => e.menu === 'options' ? '[data-options]' : `[data-menu="${e.menu}"]`)]) {
    const visible = await page.$eval(`#menu-dialog ${selector}`, element => {
      element.scrollIntoView({ block: 'nearest' });
      const r = element.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { reachable: !!hit && element.contains(hit), width: r.width, height: r.height,
        fits: element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight };
    });
    assert(visible.reachable && visible.width > 0 && visible.height > 0 && visible.fits,
      `${selector}: label fits and center is scroll-reachable, not overlapped`);
  }
  await page.click('#menu-dialog [data-menu="setup"]');
  await page.waitForSelector('#lab-dialog[open]');
  await page.click('#lab-dialog [data-lab-close]');
  assert(await menuShown(), 'small viewport Lab entry and Close are reachable');
  await page.click('#menu-dialog [data-menu="cancel"]');
  await page.waitForSelector('#menu-dialog.hidden');

  // Public synthetic fixture, NOT owned art validation. Exercise the native
  // constructor branch even without a depot, plus CSSOM's quoted URL form.
  // The prior stylePauseMenu-before-menuDialog ordering crashes here.
  const fixture = await page.evaluate(async () => {
    const modulePath = '/src/view/hud.ts';
    const { Hud } = await import(/* @vite-ignore */ modulePath);
    const parent = document.createElement('div'); document.body.append(parent);
    const image = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
    const frame = { images: Array.from({ length: 9 }, (_, i) => `${image}#${i}`), columns: [84, 83, 133], rows: [133, 83, 84] };
    const ui = { base: '', layouts: {}, materials: {}, icons: {}, nativeFeedback: {
      fonts: {}, images: Object.fromEntries(['normal', 'hover', 'active', 'disable'].map(s => [`button_large_${s}`, `${image}#${s}`])),
      button: { height: 100, fontSize: 52, border: 4, borderColor: '#000000', gradient: [{ color: '#ffffff', offset: 0 }] },
      confirm: { frame, messageWidth: 1000, fontSize: 52, rows: ['100', 'auto', '50', '50', '80'],
        buttonWidth: 500, buttonMargin: [0, 25, 25, 0], side: 100, close: [85, 87], gradient: [{ color: '#ffffff', offset: 0 }] },
    } };
    Object.assign(ui.nativeFeedback.images, { button_close_cross: `${image}#cross` });
    const hud = new Hud(parent, ui, { onSound: () => {} });
    try {
      const menu = parent.querySelector('#menu-dialog')!;
      hud.toggleMenu(true);
      const box = menu.getBoundingClientRect();
      if (box.left < 0 || box.top < 0 || box.right > innerWidth || box.bottom > innerHeight + 1) {
        throw new Error('synthetic native menu is outside the small viewport');
      }
      for (const element of menu.querySelectorAll<HTMLElement>('.menu-close, .menu-stack button')) {
        element.scrollIntoView({ block: 'nearest' });
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        if (!hit || !element.contains(hit) || element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight) {
          throw new Error(`synthetic native entry is clipped or overlapped: ${JSON.stringify({ label: element.textContent,
            rect: rect.toJSON(), hit: hit?.outerHTML, scroll: [element.scrollWidth, element.scrollHeight],
            client: [element.clientWidth, element.clientHeight], font: getComputedStyle(element).font })}`);
        }
      }
      const urls = new Set<string>();
      for (const element of menu.querySelectorAll('.menu-frame span, .menu-close, .menu-stack .native-button')) {
        for (const match of getComputedStyle(element).backgroundImage.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) urls.add(match[1]);
      }
      return { native: menu.classList.contains('native-pause'), frames: menu.querySelectorAll('.menu-frame span').length,
        buttons: menu.querySelectorAll('.menu-stack .native-button').length, urls: urls.size };
    } finally { hud.destroy(); parent.remove(); }
  });
  assert.deepEqual(fixture, { native: true, frames: 9, buttons: 12, urls: 12 });
  console.log('Synthetic native constructor + CSSOM material URL extraction: PASS (not owned-art verification)');

  assert.deepEqual(errors, []);
  console.log(`PAUSE MENU SMOKE GREEN (${native ? 'owned materials' : 'open fallback'})`);
} finally {
  try { await browser?.close(); }
  finally { await server.close(); rmSync(fixtures, { recursive: true, force: true }); }
}
