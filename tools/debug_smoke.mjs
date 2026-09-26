#!/usr/bin/env node
/**
 * The gate's browser step: a private dev server, the game in headless Chrome,
 * and the player's own input path -- a real click on a building, a real click
 * on a command button, a real key, a real right-click on the ground -- read
 * back through /__debug. `src/main.ts` holds every button's enablement and
 * every click-to-command path and has no unit tests; two shipped bugs lived
 * exactly there (a train button greyed by its own queue; a carcass order the
 * click path accepted and `applyCommand` refused). This is the check that
 * would have failed on both (issue #102).
 *
 * Runs its own Vite server on its own port and opens the only page attached
 * to it: the debug bridge answers from whichever page replies first, and a
 * tab left open on 5173 would answer from its own match.
 *
 * Usage: npm run debug:smoke
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = join(import.meta.dirname, '..');
const PORT = Number(process.env.SMOKE_PORT ?? 5199);

// Minimal systems (e.g. fresh WSL2) lack Chrome's NSS libraries and there may
// be no sudo; `apt-get download libnspr4 libnss3` + `dpkg-deb -x` into this
// directory makes Chrome runnable without root.
const extraLibs = join(homedir(), '.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu');
const launchEnv = existsSync(extraLibs)
  ? { ...process.env, LD_LIBRARY_PATH: [extraLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') }
  : process.env;

const failures = [];
function check(name, condition, detail) {
  const mark = condition ? 'ok  ' : 'FAIL';
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures.push(name);
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const { createServer } = await import('vite');
const server = await createServer({
  root: ROOT, configFile: join(ROOT, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: PORT, strictPort: false },
  logLevel: 'silent',
});
await server.listen();
const BASE = `http://127.0.0.1:${server.config.server.port}`;
console.log(`private dev server at ${BASE}`);

const browser = await puppeteer.launch({
  headless: true,
  env: launchEnv,
  // WSL2/CI have no GPU. SwiftShader's WebGPU device dies spontaneously
  // (~2s in) under this app, so WebGPU is disabled and three's WebGL2
  // fallback renders via SwiftShader instead — a supported first-class path.
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const pageErrors = [];
  page.on('pageerror', error => { pageErrors.push(error.message); console.log(`page error: ${error.message}`); });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60_000 });
  // The canvas is inserted before owned content finishes loading and before
  // the debug listener is installed. Wait for readiness, not a three-second race.
  await page.waitForFunction(() => document.querySelector('canvas.battlefield') !== null
    && typeof window.__empiresDebug === 'function', { timeout: 60_000 });

  const query = async payload => {
    const response = await fetch(`${BASE}/__debug`, { method: 'POST', body: JSON.stringify(payload) });
    const body = await response.json();
    if (!response.ok) throw new Error(`${payload.type}: ${body.error}`);
    return body;
  };
  const entity = async id => (await query({ type: 'entities', id })).entities[0];
  // A command is applied on the next tick; SwiftShader ticks a few times a second.
  const settle = () => sleep(600);

  // --- the protocol itself -------------------------------------------------
  const sim = await query({ type: 'sim' });
  check('sim query', Number.isInteger(sim.tick) && sim.players?.['1'] !== undefined,
    `tick ${sim.tick}, p1 food ${sim.players?.['1']?.food}`);

  const mine = await query({ type: 'entities', owner: 1 });
  check('entities query', mine.count > 0, `${mine.count} entities for player 1`);
  const townCenter = mine.entities.find(e => e.kind === 'town-center');
  const villager = mine.entities.find(e => e.kind === 'villager');
  check('town center reported', townCenter !== undefined,
    townCenter && `screen (${townCenter.screen.x}, ${townCenter.screen.y}), rendered=${townCenter.rendered}`);

  const pixels = await query({ type: 'pixels' });
  check('pixel readback', pixels.pixels > 0 && pixels.colors.length > 0,
    `mean rgb(${pixels.mean}) over ${pixels.pixels}px, top ${pixels.colors[0]?.hex} ${pixels.colors[0]?.fraction}`);
  check('canvas is not blank', pixels.colors[0]?.fraction < 0.995,
    'a single colour covering everything means nothing rendered');
  if (townCenter) {
    const area = await query({ type: 'pixels', entity: townCenter.id });
    check('entity pixel sample', area.pixels > 0, `mean rgb(${area.mean})`);
  }
  // The measurements that used to live in throwaway numpy scripts (#103).
  const named = await query({ type: 'pixels', rect: [0, 0, 200, 200], match: pixels.colors[0]?.hex ?? '#000000', tolerance: 16 });
  check('pixels names its colour space and counts a colour', typeof named.colorSpace === 'string' && named.matched >= 0,
    `${named.colorSpace}, ${named.matched} px within 16 of ${pixels.colors[0]?.hex}`);
  const edge = await query({ type: 'edge', from: [0, 400], to: [400, 400] });
  check('edge query reads a luminance profile', edge.samples > 100 && edge.width >= 0,
    `${edge.samples} samples, ${edge.low}-${edge.high}, 10-90% over ${edge.widthCss} css px`);
  const shot = await fetch(`${BASE}/__debug/screenshot?x=0&y=0&w=400&h=300`);
  const png = Buffer.from(await shot.arrayBuffer());
  check('screenshot endpoint', shot.ok && png.subarray(1, 4).toString() === 'PNG', `${png.length} bytes`);

  // --- the player's path: click, button, key, order -------------------------
  if (townCenter) {
    // A left-click on the town center selects it, and the HUD names it.
    await page.mouse.click(townCenter.screen.x, townCenter.screen.y);
    await settle();
    const afterClick = await query({ type: 'sim' });
    check('click selects the town center', afterClick.selected?.includes(townCenter.id),
      `selected ${JSON.stringify(afterClick.selected)}`);
    const name = await page.$eval('.object-name', el => el.textContent).catch(() => null);
    check('selection panel names it', typeof name === 'string' && name.length > 0, name ?? 'no .object-name');

    // The train button is enabled, and a real click on it starts training.
    const button = await page.$('.command-button[data-command="train-villager"]');
    check('train button offered', button !== null);
    if (button) {
      const foodBefore = afterClick.players['1'].food;
      const box = await button.boundingBox();
      check('train button enabled', await button.evaluate(el => !el.disabled));
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await settle();
      const tc1 = await entity(townCenter.id);
      const food1 = (await query({ type: 'sim' })).players['1'].food;
      check('click on the button trains', tc1.training === 'villager' && food1 === foodBefore - 50,
        `training=${tc1.training}, queued=${tc1.queued}, food ${foodBefore} -> ${food1}`);
      // Issue #7's bug: the button greyed the moment its building was busy.
      check('train button stays enabled while training', await button.evaluate(el => !el.disabled));
      // #143: queue past the opening's 4-of-5 population. Housing is checked
      // when a unit emerges, never when the player pays for another entry.
      const p1 = (await query({ type: 'sim' })).players['1'];
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await settle();
      const tc2 = await entity(townCenter.id);
      check('second click queues beyond the population cap',
        tc2.queued === 2, `queued=${tc2.queued}, population ${p1.population}/${p1.populationCap}`);
      // The hotkey goes through the same command as the button.
      const hotkey = await button.$eval('.hotkey', el => el.textContent).catch(() => null);
      if (hotkey) {
        const before = tc2.queued;
        await page.keyboard.press(hotkey.toLowerCase());
        await settle();
        const tc3 = await entity(townCenter.id);
        check(`hotkey ${hotkey} reaches the same command`, tc3.queued === before + 1,
          `queued ${before} -> ${tc3.queued}`);
      }
    }
  }

  if (villager) {
    // A left-click on a villager selects it; a right-click on open ground
    // orders it there -- the context-order path, the layer the carcass bug
    // sat in (docs/lessons.md, "three layers").
    await page.mouse.click(villager.screen.x, villager.screen.y);
    await settle();
    const selected = (await query({ type: 'sim' })).selected ?? [];
    check('click selects a villager', selected.includes(villager.id), `selected ${JSON.stringify(selected)}`);
    // Aim away from the town center: a right-click on one's own building
    // garrisons the unit (#75), which takes it off the map.
    const away = townCenter
      ? { x: villager.screen.x - townCenter.screen.x, y: villager.screen.y - townCenter.screen.y }
      : { x: 0, y: 60 };
    const scale = 120 / Math.max(1, Math.hypot(away.x, away.y));
    const target = { x: villager.screen.x + away.x * scale, y: villager.screen.y + away.y * scale };
    await page.mouse.click(target.x, target.y, { button: 'right' });
    await settle();
    const ordered = await entity(villager.id);
    check('right-click orders the villager', ordered !== undefined && ordered.order !== 'idle',
      ordered ? `order=${ordered.order}, activity=${ordered.activity}` : `entity ${villager.id} left the map (garrisoned?)`);
  }

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nall debug protocol checks passed');
