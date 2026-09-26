import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { applyCommand, createGame, stepGame } from '../src/sim/game.ts';
import { runMatch } from '../src/headless/runner.ts';
import { TREASON_TICKS } from '../src/sim/regicide.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const rules = rulesFromManifest(JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8')));
const audio = JSON.parse(readFileSync(`${root}public/imported/aoe2/audio/manifest.json`, 'utf8'));
assert(audio.audio['king-select']?.files.length, 'original King voice must be published');
const state = createGame(130, rules, undefined, 'islands', 'regicide');
state.players[1].gold = 900;
const kings = [1, 2].map(owner => state.entities.find(e => e.owner === owner && e.kind === 'king')!);
const castles = [1, 2].map(owner => state.entities.find(e => e.owner === owner && e.kind === 'castle')!);
assert(applyCommand(state, { kind: 'order', player: 2, entityIds: [kings[1].id], targetId: castles[1].id, target: castles[1].position }).ok);
for (let i = 0; i < 1000 && !castles[1].garrison?.length; i++) stepGame(state);
assert(castles[1].garrison?.some(e => e.id === kings[1].id));
while (state.tick % 20) stepGame(state);
const { rules: omitted, ...saved } = state;
const replay = await runMatch({ version: 2, seed: 131, mode: 'regicide', map: 'islands', maxTimeSeconds: 5 },
  { 1: { decide: () => [] }, 2: { decide: () => [] } }, rules);
const server = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error',
  server: { host: '127.0.0.1', port: 5293, strictPort: true }, plugins: [{
    name: 'private-regicide-clock', enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/src/main.ts')) return;
      const anchor = 'renderer.setAnimationLoop(now => {'; assert(code.includes(anchor));
      return code.replace(anchor, `Object.assign(globalThis, {
        __regicidePlayback: false,
        __regicideStep: (n: number) => { for (let i=0;i<n;i++) stepGame(game); },
        __regicidePoint: (p: Point) => hud.minimap.toCanvas(game, p.x, p.y),
        __regicideReplay: () => ({ verified: replay?.verified, failed: replay?.failed })
      });\n${anchor}\nif (!(globalThis as any).__regicidePlayback) paused = true;`);
    },
  }] });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
const errors: string[] = [];
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', e => errors.push(String(e)));
  const voices = new Set<string>(); page.on('request', request => voices.add(request.url()));
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  const snapshot = () => query({ type: 'snapshot' });
  const step = (n: number) => page.evaluate(n => (window as any).__regicideStep(n), n);
  const click = async (selector: string) => {
    await page.waitForFunction(selector => {
      const e = document.querySelector<HTMLButtonElement>(selector);
      if (!e || e.disabled) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest(selector) === e;
    }, {}, selector);
    const p = await page.evaluate(selector => {
      const r = document.querySelector(selector)!.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, selector);
    await page.mouse.click(p.x, p.y);
  };
  const ready = () => page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120000 });
  await page.goto('http://127.0.0.1:5293/?solo=1&map=arabia&seed=130&mode=random-map', { waitUntil: 'networkidle0', timeout: 120000 });
  await ready(); assert.equal((await snapshot()).entities.filter((e: any) => e.kind === 'king').length, 0);
  await click('[data-menu="open"]'); await page.select('#map-choice', 'islands');
  await click('#regicide-mode'); await click('#map-setup button[type="submit"]');
  let s = await snapshot(); assert.equal(s.mode, 'regicide');
  assert.equal(s.entities.filter((e: any) => e.kind === 'king').length, 2);
  assert.equal(s.entities.filter((e: any) => e.kind === 'villager').length, 20);
  const ownKing = s.entities.find((e: any) => e.kind === 'king' && e.owner === 1);
  await query({ type: 'look', entity: ownKing.id });
  await page.waitForFunction(async id => {
    const e = (await (window as any).__empiresDebug({ type: 'entities', id })).entities[0];
    return e?.bodyVisible && e.colorTint;
  }, {}, ownKing.id);
  const drawn = (await query({ type: 'entities', id: ownKing.id })).entities[0];
  assert(drawn.colorTint); await page.mouse.click(drawn.screen.x, drawn.screen.y);
  assert.deepEqual((await query({ type: 'sim' })).selected, [ownKing.id]);
  await page.waitForFunction(() => document.querySelector('#selection-content')?.textContent?.includes('King'));
  assert([...voices].some(url => audio.audio['king-select'].files.some((file: any) => url.endsWith(file.file))), 'King click requests the owned voice');
  await step(7); const savedTick = (await snapshot()).tick;
  await page.reload({ waitUntil: 'networkidle0', timeout: 120000 }); await ready();
  s = await snapshot(); assert.equal(s.mode, 'regicide'); assert.equal(s.tick, savedTick);
  await click('[data-menu="open"]'); assert(await page.$eval('#regicide-mode', e => (e as HTMLInputElement).checked));
  await click('[data-menu="restart"]'); s = await snapshot(); assert.equal(s.mode, 'regicide'); assert.equal(s.tick, 0);
  await click('[data-menu="open"]'); await click('#regicide-mode'); await click('#map-setup button[type="submit"]');
  s = await snapshot(); assert.equal(s.mode, undefined); assert.equal(s.entities.filter((e: any) => e.kind === 'king').length, 0);
  assert.equal(await page.$('[data-command="treason"]'), null);
  console.log('REGICIDE SETUP GREEN: real menu, King art/colour/voice, ten villagers/player, reload/restart and return to random map');

  // Paid action fixture uses generated geography and a publicly garrisoned enemy King.
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved, setup: { map: 'islands', seed: 130, mode: 'regicide' } });
  await page.goto('http://127.0.0.1:5293/?solo=1', { waitUntil: 'networkidle0', timeout: 120000 }); await ready();
  assert.equal((await snapshot()).tick, saved.tick);
  await query({ type: 'select', ids: [castles[0].id] });
  await page.waitForSelector('[data-command="treason"]');
  const point = await page.evaluate(p => (window as any).__regicidePoint(p), castles[1].position);
  const pixels = () => page.evaluate(p => Array.from(document.querySelector<HTMLCanvasElement>('#minimap-canvas')!.getContext('2d')!
    .getImageData(Math.round(p.x) - 7, Math.round(p.y) - 7, 15, 15).data), point);
  const baseline = await pixels(); const vision = (await snapshot()).visibility[1].visible;
  await click('[data-command="treason"]'); s = await snapshot();
  assert.equal(s.players[1].gold, 500); assert(!s.players[1].researched.includes('spies')); assert(!s.players[1].researched.includes('treason'));
  assert.equal(s.entities.find((e: any) => e.id === castles[0].id).researching, undefined);
  await page.waitForFunction(({ p, before }) => {
    const pixels = document.querySelector<HTMLCanvasElement>('#minimap-canvas')!.getContext('2d')!.getImageData(Math.round(p.x) - 7, Math.round(p.y) - 7, 15, 15).data;
    return [...pixels].filter((n, i) => n !== before[i]).length > 20;
  }, {}, { p: point, before: baseline });
  assert.deepEqual(s.visibility[1].visible, vision, 'Treason must not reveal fog');
  assert(!(await query({ type: 'entities', id: castles[1].id })).entities[0].rendered, 'hidden carrier remains hidden');
  await step(10);
  await page.waitForFunction(({ p, before }) => {
    const pixels = document.querySelector<HTMLCanvasElement>('#minimap-canvas')!.getContext('2d')!.getImageData(Math.round(p.x) - 7, Math.round(p.y) - 7, 15, 15).data;
    return [...pixels].every((n, i) => n === before[i]);
  }, {}, { p: point, before: baseline });
  await click('[data-command="treason"]'); s = await snapshot(); assert.equal(s.players[1].gold, 100);
  assert.equal(s.treasonUntil[1], s.tick + TREASON_TICKS);
  await click('[data-command="treason"]'); assert.equal((await snapshot()).players[1].gold, 100);
  await step(TREASON_TICKS + 10);
  await page.waitForFunction(({ p, before }) => {
    const pixels = document.querySelector<HTMLCanvasElement>('#minimap-canvas')!.getContext('2d')!.getImageData(Math.round(p.x) - 7, Math.round(p.y) - 7, 15, 15).data;
    return [...pixels].every((n, i) => n === before[i]);
  }, {}, { p: point, before: baseline });
  // Actual King right-click shelter, original occupied-castle flag, and royal Delete confirmation.
  await query({ type: 'look', entity: castles[0].id }); await query({ type: 'select', ids: [kings[0].id] });
  const castleDrawn = (await query({ type: 'entities', id: castles[0].id })).entities[0];
  await page.mouse.click(castleDrawn.screen.x, castleDrawn.screen.y, { button: 'right' });
  for (let i = 0; i < 1000 && !(await snapshot()).entities.find((e: any) => e.id === castles[0].id).garrison?.length; i += 50) await step(50);
  assert((await snapshot()).entities.find((e: any) => e.id === castles[0].id).garrison?.some((e: any) => e.id === kings[0].id));
  await page.waitForFunction(async id => (await (window as any).__empiresDebug({ type: 'entities', id })).entities[0]?.garrisonFlags?.some((f: any) => f.visible), {}, castles[0].id);
  await query({ type: 'select', ids: [castles[0].id] }); await click('[data-command="ungarrison"]');
  await query({ type: 'select', ids: [kings[0].id] }); await page.keyboard.press('Delete');
  await page.waitForSelector('#confirm-dialog[open]'); await click('[data-answer="yes"]'); await step(1);
  assert.equal((await snapshot()).winner, 2); await page.waitForSelector('#end-dialog[open]');
  console.log('TREASON GREEN: repeatable400-gold clicks; hidden garrisoned King flashing minimap X, blink/expiry pixels, no fog/research leakage; King shelter flag and real Delete defeat');

  // Replay uses its real clock and verifies the headless record, not staged state.
  await page.evaluate(record => {
    const input = document.querySelector<HTMLInputElement>('#replay-file')!, transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(record)], 'regicide.json', { type: 'application/json' }));
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    (window as any).__regicidePlayback = true;
  }, replay.record);
  await page.waitForFunction(() => (window as any).__regicideReplay().verified === 1, { timeout: 30000 });
  assert.equal((await snapshot()).mode, 'regicide');
  assert.equal(await page.evaluate(() => (window as any).__regicideReplay().failed), false);
  assert.deepEqual(errors, []);
  console.log('REGICIDE REPLAY GREEN: v2 mode restored through actual file input and real replay checksum verification');
  await page.evaluate(() => { (window as any).__regicidePlayback = false; });
  await click('[data-menu="open"]'); await click('[data-menu="restart"]');
  await page.waitForFunction(async () => (await (window as any).__empiresDebug({ type: 'sim' })).connection.paused);
  const royal = (await snapshot()).entities.filter((e: any) => e.kind === 'king');
  assert.equal(royal.length, 2);
  for (const k of royal) await query({ type: 'command', command: { kind: 'delete', player: k.owner, entityIds: [k.id] } });
  await step(1); s = await snapshot(); assert.equal(s.draw, true); assert.equal(s.winner, undefined);
  await page.waitForFunction(() => document.querySelector<HTMLDialogElement>('#popup-dialog')?.open
    && document.querySelector('#popup-message')?.textContent?.includes('Draw'));
  assert.equal(await page.$eval('#end-dialog', e => (e as HTMLDialogElement).open), false);
  assert.deepEqual(errors, []);
  console.log('REGICIDE DRAW GREEN: simultaneous public royal deletions, explicit draw and no false winner/defeat frame');
} finally { await browser.close(); await server.close(); }
