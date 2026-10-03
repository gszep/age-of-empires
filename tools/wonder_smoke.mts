/** #110: paid public construction, owned timer pixels, focus, reload, destruction and victory. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { createGame } from '../src/sim/game.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { createVisibility, updateVisibility } from '../src/sim/visibility.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import { WONDER_VICTORY_TICKS } from '../src/sim/wonder.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const rules = rulesFromManifest(JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8')));
const state = createGame(110, rules, undefined, 'arabia', 'random-map', undefined, true);
const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
state.entities = state.entities.filter(e => e.kind === 'town-center' || e.id === worker.id);
state.width = state.height = 40; state.terrain = new Array(1600).fill(0); state.elevation = new Array(1600).fill(0);
state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!.position = { x: 6.5, y: 6.5 };
state.entities.find(e => e.kind === 'town-center' && e.owner === 2)!.position = { x: 34.5, y: 34.5 };
worker.position = { x: 12, y: 12 };
Object.assign(state.players[1], { age: 3, researched: ['feudal-age', 'castle-age', 'imperial-age'], wood: 10000, gold: 10000, stone: 10000 });
state.visibility = createVisibility(state); state.visibility[1].explored.fill(1); updateVisibility(state);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error',
  server: { host: '127.0.0.1', port: 5298, strictPort: true }, plugins: [{
    name: 'wonder-public-outcome-clock', enforce: 'pre', transform(code, id) {
      if (!id.endsWith('/src/main.ts')) return;
      const anchor = 'renderer.setAnimationLoop(now => {'; assert(code.includes(anchor));
      return code.replace(anchor, `Object.assign(globalThis, {
        __wonderStep: (n: number) => { if (n < 0 || n > 100000) throw new Error('bounded fixture clock'); for (let i=0;i<n;i++) stepGame(game); },
        __wonderComplete: (id: number) => { let n=0; while (game.entities.find(e=>e.id===id)?.buildProgress !== undefined && n++ < 80000) stepGame(game); return n; }
      });\n${anchor}\npaused = true;`);
    },
  }] });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true, env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 800 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
  await page.evaluateOnNewDocument(snapshot => {
    if (sessionStorage.getItem('wonder-fixture')) return;
    sessionStorage.setItem('wonder-fixture', '1');
    sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot));
  }, { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved, setup: { map: 'arabia', seed: 110, wonderVictory: true } });
  const ready = () => page.waitForFunction(() => !!(globalThis as any).__wonderStep && !!(globalThis as any).__empiresDebug, { timeout: 120000 });
  const query = (q: object): Promise<any> => page.evaluate(q => (globalThis as any).__empiresDebug(q), q);
  const snapshot = () => query({ type: 'snapshot' });
  const step = (n: number) => page.evaluate(n => (globalThis as any).__wonderStep(n), n);
  await page.goto('http://127.0.0.1:5298/?solo=1', { waitUntil: 'domcontentloaded' }); await ready();
  assert.equal((await snapshot()).width, 40, 'fixture must actually resume');
  assert.equal((await snapshot()).wonderVictory, true);
  const build = async (x: number) => {
    assert((await query({ type: 'command', command: { kind: 'build', player: 1, builderIds: [worker.id], building: 'wonder', target: { x, y: 14.5 } } })).ok);
    const id = (await snapshot()).entities.at(-1).id;
    await page.waitForFunction(() => document.querySelector('.message-lines')?.textContent?.includes('started building a Wonder'));
    assert.equal((await page.$$('.wonder-banner')).length, 0, 'foundation must not count down');
    const ticks = await page.evaluate(id => (globalThis as any).__wonderComplete(id), id);
    assert(ticks > 69000 && ticks < 80000, 'actual source construction clock, no fast-build rule substitution');
    await page.waitForSelector(`.wonder-banner[data-wonder-id="${id}"]`);
    assert((await snapshot()).entities.find((e: any) => e.id === id).buildProgress === undefined);
    return id;
  };
  const first = await build(16.5);
  let s = await snapshot(); assert.equal(s.players[1].wood, 9000); assert.equal(s.players[1].gold, 9000); assert.equal(s.players[1].stone, 9000);
  assert.equal(s.wonderCountdowns[0].finishTick - s.tick, WONDER_VICTORY_TICKS);
  assert.equal(await page.$eval('.wonder-years', e => e.textContent), '200');
  await page.waitForFunction(() => document.querySelector('.message-lines')?.textContent?.includes('You completed a Wonder'));
  await page.waitForFunction(() => {
    const banner = document.querySelector<HTMLElement>('.wonder-banner');
    if (!banner) return false;
    const url = getComputedStyle(banner).backgroundImage;
    return url.includes('player_banner_blue.png');
  });
  const screenshot = await page.screenshot({ path: `${root}.local/wonder110-banner.png` });
  const pixels = await page.evaluate(async data => {
    const image = new Image(); image.src = data; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    const r = document.querySelector('.wonder-banner')!.getBoundingClientRect();
    const bytes = ctx.getImageData(Math.ceil(r.left), 80, Math.floor(r.width), 40).data;
    let blue = 0; for (let i=0;i<bytes.length;i+=4) if (bytes[i+2]>40 && bytes[i+2]>bytes[i]*1.3 && bytes[i+2]>bytes[i+1]) blue++;
    return blue;
  }, 'data:image/png;base64,' + Buffer.from(screenshot).toString('base64'));
  assert(pixels > 10, `owned banner must contribute blue sRGB pixels: ${pixels}`);
  await query({ type: 'look', rect: [35, 5] });
  const hash = (await query({ type: 'sim' })).synchronizationHash;
  const hit = await page.$eval('.wonder-banner', e => { const r=e.getBoundingClientRect(); return {
    rect: { x:r.x,y:r.y,width:r.width,height:r.height }, hit:document.elementFromPoint(r.x+r.width/2,Math.max(0,r.y)+Math.min(innerHeight,r.bottom)/2)?.outerHTML.slice(0,500),
  }; });
  await page.click('.wonder-banner');
  const drawn = (await query({ type: 'entities', id: first })).entities[0];
  assert(Math.abs(drawn.screen.x - 640) < 2 && Math.abs(drawn.screen.y - 400) < 2, `banner focuses the Wonder: ${JSON.stringify({ hit, screen:drawn.screen })}`);
  assert.equal((await query({ type: 'sim' })).synchronizationHash, hash, 'focus never mutates simulation');
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
  assert.equal((await query({ type: 'sim' })).synchronizationHash, hash);
  await page.waitForSelector('.wonder-banner');
  await query({ type: 'select', ids: [first] }); await page.keyboard.press('Delete');
  await page.waitForSelector('#confirm-dialog[open]'); await page.click('[data-answer="yes"]'); await step(1);
  await page.waitForFunction(() => document.querySelectorAll('.wonder-banner').length === 0);
  assert.equal((await snapshot()).winner, undefined);
  const second = await build(23.5);
  s = await snapshot(); assert.equal(s.players[1].wood, 8000);
  await step(WONDER_VICTORY_TICKS - 1); assert.equal((await snapshot()).winner, undefined);
  await step(1); assert.equal((await snapshot()).winner, 1);
  assert((await snapshot()).entities.some((e: any) => e.owner === 2 && !e.dead));
  await page.waitForSelector('#end-dialog[open]');
  assert.deepEqual(errors, []);
  console.log(`WONDER GREEN: source-time paid construction twice,200years,${pixels} blue sRGB banner pixels, real focus/reload/Delete cancellation, fresh second deadline and victory`);
} finally { await browser.close(); await server.close(); }
