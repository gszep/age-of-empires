/** #120: an old corpse must not die again when a scout re-enters sight. */
import assert from 'node:assert/strict';
import { ownedManifest, startServer, launchBrowser, newPage } from './smoke-harness.mjs';
import { applyCommand, createGame, stepGame } from '../src/sim/game.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';

const rules = rulesFromManifest(ownedManifest());
const state = createGame(120, rules);
const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
const scout = state.entities.find(e => e.owner === 1 && e.kind === 'scout-cavalry')!;
const corpse = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
state.entities = state.entities.filter(e => e.kind === 'town-center' || e.id === scout.id || e.id === corpse.id);
state.terrain.fill(0);
corpse.position = { x: home.position.x + 14, y: home.position.y };
scout.position = { x: corpse.position.x + 1, y: corpse.position.y };
assert(applyCommand(state, { kind: 'delete', player: 2, entityIds: [corpse.id] }).ok);
for (let i = 0; i < 200; i++) stepGame(state);
const { rules: ignored, ...saved } = state;
const server = await startServer({ port: 5227 });
const browser = await launchBrowser();
try {
  const { page, errors } = await newPage(browser);
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5227/?solo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  await page.keyboard.press('F3');
  assert((await query({ type: 'snapshot' })).tick >= 200, 'old-corpse fixture resumed');
  await query({ type: 'look', entity: corpse.id });
  const before = (await query({ type: 'entities', id: corpse.id, dead: true })).entities[0];
  assert(before.rendered && before.animation.endsWith('/decay'), `initial saved corpse: ${before.animation}`);
  await query({ type: 'command', command: { kind: 'order', player: 1, entityIds: [scout.id], target: home.position } });
  for (let i = 0; i < 6; i++) await page.keyboard.press('+');
  await page.keyboard.press('F3');
  await page.waitForFunction(async id => {
    const e = (await (window as any).__empiresDebug({ type: 'entities', id, dead: true })).entities[0];
    return e && !e.rendered;
  }, { timeout: 30_000, polling: 100 }, corpse.id);
  await query({ type: 'command', command: { kind: 'order', player: 1, entityIds: [scout.id],
    target: { x: corpse.position.x + 1, y: corpse.position.y } } });
  await page.waitForFunction(async id => {
    const e = (await (window as any).__empiresDebug({ type: 'entities', id, dead: true })).entities[0];
    return e?.rendered;
  }, { timeout: 30_000, polling: 50 }, corpse.id);
  await page.keyboard.press('F3');
  const after = (await query({ type: 'entities', id: corpse.id, dead: true })).entities[0];
  assert(after.animation.endsWith('/decay'), `resighted corpse: ${after.animation}`);
  assert.deepEqual(errors, []);
  console.log(`CORPSE RESIGHT SMOKE GREEN: saved corpse ${before.animation}; hidden view removed; resighted ${after.animation}`);
} finally { await browser.close(); await server.close(); }
