/** #141: real options controls, persisted preferences and native hotkey profiles. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { createGame } from '../src/sim/game.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const fallback = process.env.OPEN_FALLBACK === '1';
const ui = JSON.parse(readFileSync(`${root}public/imported/aoe2/ui/manifest.json`, 'utf8'));
const rules = fallback ? FALLBACK_RULES : rulesFromManifest(JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8')));
const state = createGame(141, rules);
state.players[1].food = 5000; state.players[1].wood = 5000;
state.visibility[1].visible.fill(1); state.visibility[1].explored.fill(1);
const own = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
const enemy = state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!;
const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
const { rules: omitted, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error',
  server: { host: '127.0.0.1', port: 5297, strictPort: true }, plugins: [{
    name: 'private-options-clock', enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/src/main.ts')) return;
      const anchor = 'renderer.setAnimationLoop(now => {'; assert(code.includes(anchor));
      return code.replace('if (!shared && !paused && !matchOver(game))', 'if (false && !shared && !paused && !matchOver(game))')
        .replace(anchor, `Object.assign(globalThis, { __optionsState: () => ({
          preferences, speedIndex, gameSpeed: gameSpeed(), music: (musicPlayer as any).element ? {
            volume:(musicPlayer as any).element.volume, paused:(musicPlayer as any).element.paused,
            time:(musicPlayer as any).element.currentTime } : null,
          sounds:[...(audioPlayer as any).active.keys()].map((e: HTMLAudioElement) => ({volume:e.volume,src:e.src}))
        }), __optionsMapPoint: (p: Point) => hud.minimap.toCanvas(game,p.x,p.y) });\n${anchor}`);
    },
  }] });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 800 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
  if (fallback) {
    await page.setRequestInterception(true);
    page.on('request', r => { void (r.url().includes('/imported/') ? r.respond({ status: 404, body: '' }) : r.continue()); });
  }
  await page.evaluateOnNewDocument(snapshot => {
    if (!sessionStorage.getItem('open-empires-lab:dev-session')) sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot));
  }, { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved, setup: { map: 'arabia', seed: 141 } });
  await page.goto('http://127.0.0.1:5297/?solo=1', { waitUntil: 'networkidle0', timeout: 120000 });
  const ready = () => page.waitForFunction(() => typeof (window as any).__optionsState === 'function', { timeout: 120000 });
  await ready();
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  const runtime = (): Promise<any> => page.evaluate(() => (window as any).__optionsState());
  const click = async (selector: string) => {
    await page.waitForFunction(selector => {
      const e = document.querySelector<HTMLButtonElement>(selector);
      return e && !e.disabled && e.getBoundingClientRect().width > 0;
    }, {}, selector);
    const p = await page.$eval(selector, e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.click(p.x, p.y);
  };
  const open = async () => { await click('#menu-panel [data-options]'); await page.waitForSelector('#options-dialog[open]'); };
  const apply = () => click('[data-option-action="apply"]');
  const ok = () => click('[data-option-action="ok"]');
  const range = async (name: string, value: number) => {
    await page.focus(`#option-${name}`);
    await page.keyboard.press('Home');
    for (let i = 0; i < value; i++) await page.keyboard.press('ArrowRight');
    assert.equal(await page.$eval(`#option-${name}`, e => (e as HTMLInputElement).value), String(value));
  };
  const selectEntity = async (id: number) => {
    await query({ type: 'look', entity: id }); await query({ type: 'select', ids: [id] });
  };
  assert.equal((await query({ type: 'snapshot' })).tick, state.tick);
  await selectEntity(own.id); await open();
  const before = (await query({ type: 'sim' })).synchronizationHash;
  assert.equal((await runtime()).speedIndex, 2, 'fresh preferences select native Normal');
  assert.deepEqual(await page.$$eval('#option-speed option', rows => rows.slice(0,4).map(e => e.textContent)), ['Slow','Casual','Normal','Fast']);
  for (const [index, multiplier] of [1,1.5,1.7,2].entries()) {
    await page.select('#option-speed', String(index)); await apply();
    assert.equal((await runtime()).gameSpeed, multiplier);
    assert.equal((await query({ type: 'sim' })).synchronizationHash, before);
  }
  await page.select('#option-speed', '1'); await ok();
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); await open();
  assert.equal((await runtime()).speedIndex, 1, 'saved index1 retains its pace instead of migrating to the new Normal');
  assert.equal((await runtime()).gameSpeed, 1.5);
  await page.select('#option-speed', '4');
  await range('music', 0); await range('sound', 25);
  if (!fallback) await page.select('#option-hotkeys', 'classic');
  await apply();
  assert.equal((await runtime()).speedIndex, 4);
  assert.equal((await query({ type: 'sim' })).synchronizationHash, before, 'options never mutate authoritative state');
  if (!fallback) await page.waitForFunction(() => (window as any).__optionsState().music?.paused);
  const layout = await page.$eval('#options-dialog', e => {
    const r = e.getBoundingClientRect();
    return { inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      centered: Math.abs(r.left + r.width / 2 - innerWidth / 2) < 2 && Math.abs(r.top + r.height / 2 - innerHeight / 2) < 2,
      overflow: e.scrollHeight > e.clientHeight, frames: e.querySelectorAll('.native-frame span').length };
  });
  assert(layout.inside && layout.centered && !layout.overflow, JSON.stringify(layout));
  if (!fallback) {
    assert.equal(layout.frames, 9);
    await page.screenshot({ path: `${root}.local/options141-owned.png` });
  }
  await ok();

  if (!fallback) {
    for (const [profile, key] of [['classic', 'c'], ['high definition', 'a'], ['left handed', 'y'], ['definitive', 'q']]) {
      await open(); await page.select('#option-hotkeys', profile); await ok();
      await selectEntity(own.id);
      await page.waitForFunction(key => document.querySelector('[data-command="train-villager"] .hotkey')?.textContent === key.toUpperCase(), {}, key);
      const snapshot = await query({ type: 'snapshot' });
      const count = snapshot.entities.find((e: any) => e.id === own.id).trainingQueue?.length ?? 0;
      const training = !!snapshot.entities.find((e: any) => e.id === own.id).training;
      await page.keyboard.press(key);
      const next = (await query({ type: 'snapshot' })).entities.find((e: any) => e.id === own.id);
      assert.equal((next.trainingQueue?.length ?? 0) + Number(!!next.training), count + Number(training) + 1, `${profile} actually trains`);
      if (profile === 'classic') {
        const food = (await query({ type: 'snapshot' })).players[1].food;
        await page.keyboard.press('q');
        assert.equal((await query({ type: 'snapshot' })).players[1].food, food, 'old grid key is not silently retained');
        assert.equal(await page.$('[data-command="research-loom"] .hotkey'), null, 'explicitly unbound classic research stays unbound');
      }
      if (profile === 'left handed') {
        await selectEntity(worker.id); await page.keyboard.press('g');
        assert.deepEqual((await query({ type: 'sim' })).selected, [own.id], 'left-handed goto TC uses G');
        await page.keyboard.press('v');
        const selected = (await query({ type: 'sim' })).selected;
        assert((await query({ type: 'snapshot' })).entities.some((e: any) => selected.includes(e.id) && e.kind === 'villager'));
      }
    }
    console.log('OPTIONS HOTKEYS GREEN: four native profiles train through real keys; unbound keys and left-handed navigation respected');

    await selectEntity(enemy.id);
    const mapPoint = await page.evaluate(p => (window as any).__optionsMapPoint(p), enemy.position);
    for (const palette of ['deuteranopia', 'protanopia', 'tritanopia', 'default']) {
      await open(); await page.select('#option-palette', palette); await apply();
      const colors = palette === 'default' ? ui.colors : ui.colorPalettes[palette];
      const rgb = (role: string) => `rgb(${colors.ColorTables.Red[role].slice(0, 3).join(', ')})`;
      const score = await page.$eval('.score-row:nth-child(2) .score-name', e => getComputedStyle(e).color);
      assert.equal(score, rgb('Text'));
      assert.equal(await page.$eval('.score-row:nth-child(2) .score-badge', e => getComputedStyle(e).backgroundColor), rgb('Icons'));
      if (palette !== 'default') assert.equal(await page.$eval('.hp-fill', e => getComputedStyle(e).backgroundColor), rgb('HealthBar'));
      await page.waitForFunction(({ p, expected }) => {
        const ctx = document.querySelector<HTMLCanvasElement>('#minimap-canvas')!.getContext('2d')!;
        const pixel = ctx.getImageData(Math.round(p.x - 1), Math.round(p.y - 1), 1, 1).data;
        return expected.every((v: number, i: number) => pixel[i] === v);
      }, { timeout: 10000 }, { p: mapPoint, expected: colors.ColorTables.Red.MiniMap });
      await ok();
      await click('#menu-panel [data-command="diplomacy"]');
      await page.waitForSelector('#diplomacy-dialog[open]');
      assert.equal(await page.$eval('[data-player="2"] [data-diplomacy-cell="number"]', e => getComputedStyle(e).backgroundColor), rgb('Icons'));
      await click('[data-diplomacy-close]');
    }
    console.log('OPTIONS PALETTES GREEN: owned score text/badges, selection health and actual minimap pixels follow all three palettes and restore');
  }
  await open(); await page.select('#option-speed', '2'); await range('music', 50); await range('sound', 40);
  if (!fallback) await page.select('#option-hotkeys', 'classic');
  await ok();
  if (!fallback) {
    await page.waitForFunction(() => { const m = (window as any).__optionsState().music; return m && !m.paused && m.volume === 0.5; });
    await selectEntity(own.id);
    const drawn = (await query({ type: 'entities', id: own.id })).entities[0];
    await page.mouse.click(drawn.screen.x, drawn.screen.y);
    await page.waitForFunction(() => (window as any).__optionsState().sounds.some((s: any) => s.volume === 0.4));
  }
  await page.reload({ waitUntil: 'networkidle0', timeout: 120000 }); await ready();
  const reloaded = await runtime();
  assert.equal(reloaded.speedIndex, 2); assert.equal(reloaded.preferences.music, 50); assert.equal(reloaded.preferences.sound, 40);
  assert.equal(reloaded.preferences.hotkeys, fallback ? 'definitive' : 'classic');
  await page.keyboard.press('+'); assert.equal((await runtime()).speedIndex, 3);
  await page.reload({ waitUntil: 'networkidle0', timeout: 120000 }); await ready();
  assert.equal((await runtime()).speedIndex, 3, 'speed keys persist too');
  await open(); await page.select('#option-speed', '0'); await click('[data-option-action="cancel"]');
  assert.equal((await runtime()).speedIndex, 3, 'Cancel discards unapplied edits');
  assert.deepEqual(errors, []);
  console.log(`OPTIONS SMOKE GREEN (${fallback ? 'fallback' : 'owned'}): real controls, bounded layout, volume application, reload/key persistence and Cancel`);
} finally { await browser.close(); await server.close(); }
