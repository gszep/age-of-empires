import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import { createGame } from '../src/sim/game.ts';
import { rulesFromManifest, FALLBACK_RULES } from '../src/sim/data.ts';
import type { Entity } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const fallback = process.env.OPEN_FALLBACK === '1';
const rules = fallback ? FALLBACK_RULES : rulesFromManifest(JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8')));
const state = createGame(138, rules);
state.entities = state.entities.filter(e => e.kind === 'town-center');
state.terrain = state.terrain.map(() => 0); state.elevation.fill(0);
Object.assign(state.players[1], { age: 3, wood: 1300, food: 2600, gold: 1300, stone: 1300 });
const r = rules.buildings.market;
const market: Entity = { id: state.nextId++, kind: 'market', owner: 1, position: { x: 40, y: 50 }, hp: r.hp,
  maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
state.entities.push(market);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error',
  server: { host: '127.0.0.1', port: 5292, strictPort: true }, plugins: [{
    name: 'private-diplomacy-clock', enforce: 'pre',
    configureServer(server) {
      if (fallback) server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/imported/')) { res.statusCode = 404; res.end(); } else next();
      });
    },
    transform(code, id) {
      if (!id.endsWith('/src/main.ts')) return;
      const anchor = 'renderer.setAnimationLoop(now => {'; assert(code.includes(anchor));
      return code.replace(anchor, `Object.assign(globalThis, { __dipStep: (n: number) => { for (let i=0;i<n;i++) stepGame(game); } });\n${anchor}\npaused = true;`);
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
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5292/?solo=1', { waitUntil: 'networkidle0', timeout: 120000 });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function');
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  const snapshot = () => query({ type: 'snapshot' });
  const step = (n: number) => page.evaluate(n => (window as any).__dipStep(n), n);
  const open = async () => {
    await page.click('[data-command="diplomacy"]');
    await page.waitForSelector('#diplomacy-dialog[open]');
  };
  const tribute = (r: string) => `#diplomacy-dialog [data-player="2"] [data-tribute-resource="${r}"]`;
  assert.equal((await snapshot()).tick, 0);
  await open();
  assert.equal(await page.$$eval('[data-relation]:disabled', nodes => nodes.length), 6);
  if (!fallback) assert((await page.$eval(tribute('wood'), e => getComputedStyle(e).backgroundImage)).includes('tribute_wood.png'));
  const before = await snapshot();
  await page.click(tribute('wood'));
  await page.keyboard.down('Shift'); await page.click(tribute('food')); await page.keyboard.up('Shift');
  assert.deepEqual((await snapshot()).players, before.players, 'draft is not paid before confirmation');
  await page.click('[data-diplomacy-clear]');
  assert.equal(await page.$eval(tribute('wood'), e => e.textContent), '0');
  await page.click(tribute('wood')); await page.keyboard.press('Escape');
  assert.deepEqual((await snapshot()).players, before.players, 'escape cancels');
  await open(); assert.equal(await page.$eval(tribute('wood'), e => e.textContent), '0');
  await page.click(tribute('wood'));
  await page.keyboard.down('Shift'); await page.click(tribute('food')); await page.keyboard.up('Shift');
  await page.click(tribute('wood'), { button: 'right' });
  assert.equal(await page.$eval(tribute('wood'), e => e.textContent), '0');
  await page.keyboard.down('Control'); await page.click(tribute('wood')); await page.keyboard.up('Control');
  assert.equal(await page.$eval(tribute('wood'), e => e.textContent), '1000');
  await page.click('[data-diplomacy-confirm]');
  let after = await snapshot();
  assert.equal(after.players[1].wood, 0); assert.equal(after.players[2].wood - before.players[2].wood, 1000);
  assert.equal(after.players[1].food, 1950); assert.equal(after.players[2].food - before.players[2].food, 500);
  // Both native fee-reduction research buttons feed live dialog quotes.
  for (const [tech, fee] of [['coinage', 20], ['banking', 0]] as const) {
    await query({ type: 'select', ids: [market.id] });
    await page.waitForFunction(key => {
      const e = document.querySelector<HTMLButtonElement>(`[data-command="research-${key}"]`);
      if (!e || e.disabled) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === e;
    }, {}, tech);
    const at = await page.$eval(`[data-command="research-${tech}"]`, e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.click(at.x, at.y);
    const clicked = await snapshot();
    assert.equal(clicked.entities.find((e: any) => e.id === market.id)?.researching?.tech, tech,
      `research click must be accepted before advancing time: ${JSON.stringify(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.outerHTML, at))}`);
    await step(Math.ceil(rules.technologies[tech].researchSeconds * 20) + 1);
    await open();
    assert((await page.$eval('[data-tribute-heading]', e => e.textContent!)).includes(`${fee}%`));
    const prior = (await snapshot()).players[1].stone;
    await page.click(tribute('stone')); await page.click('[data-diplomacy-confirm]');
    assert.equal(prior - (await snapshot()).players[1].stone, 100 + fee);
  }
  await open(); await page.click(tribute('gold'));
  await query({ type: 'command', command: { kind: 'delete', player: 1, entityIds: [market.id] } });
  const prior = await snapshot();
  await page.click('[data-diplomacy-confirm]');
  assert.deepEqual((await snapshot()).players, prior.players, 'destroyed market cannot send a pending draft');
  await page.waitForFunction(() => !!document.querySelector('[data-diplomacy-market]')?.textContent);
  await page.click('[data-diplomacy-cancel]');
  // Actual replay file input; the dialog remains viewable, all payment inputs disabled.
  await page.evaluate(({ origin, civilization }) => {
    const input = document.querySelector<HTMLInputElement>('#replay-file')!;
    const data = new DataTransfer();
    data.items.add(new File([JSON.stringify({ version: 1, seed: 138, rulesOrigin: origin,
      civilizations: { 1: civilization, 2: civilization }, commands: [], checksums: [] })], 'diplomacy-replay.json', { type: 'application/json' }));
    input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { origin: rules.origin, civilization: rules.civilization.key });
  await page.waitForFunction(async () => (await (window as any).__empiresDebug({ type: 'snapshot' })).tick === 0);
  await open();
  assert.equal(await page.$$eval('#diplomacy-dialog [data-tribute-resource]:disabled', nodes => nodes.length), 8);
  assert(await page.$eval('[data-diplomacy-confirm]', e => (e as HTMLButtonElement).disabled));
  after = await snapshot(); await page.click(tribute('wood')); assert.deepEqual((await snapshot()).players, after.players);
  assert.deepEqual(errors, []);
  console.log(`DIPLOMACY ${fallback ? 'FALLBACK' : 'OWNED'} GREEN: native button, draft/clear/cancel, Shift/right-click/CTRL-all, atomic fees, Coinage/Banking UI, market loss and read-only replay`);
} finally { await browser.close(); await server.close(); }
