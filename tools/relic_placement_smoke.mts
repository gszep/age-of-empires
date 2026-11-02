import assert from 'node:assert/strict';
import { ownedManifest, startServer, launchBrowser, newPage } from './smoke-harness.mjs';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { relicJourneyFixture, runRelicJourney } from './relic_journey.ts';

const rules = rulesFromManifest(ownedManifest());
const fixture = relicJourneyFixture(rules);
const { rules: omitted, ...saved } = fixture.state;
const server = await startServer({ port: 5291, plugins: [{
    name: 'private-relic-placement-clock', enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/src/main.ts')) return;
      const anchor = 'renderer.setAnimationLoop(now => {';
      assert(code.includes(anchor));
      return code.replace(anchor, `Object.assign(globalThis, { __relicStep: (n: number) => { for (let i=0;i<n;i++) stepGame(game); } });\n${anchor}\npaused = true;`);
    },
  }] });
const browser = await launchBrowser();
try {
  const { page, errors } = await newPage(browser);
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5291/?solo=1', { waitUntil: 'networkidle0', timeout: 120_000 });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function');
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  const snapshot = () => query({ type: 'snapshot' });
  const initial = await snapshot();
  assert.equal(initial.tick, 0);
  assert.deepEqual(initial.landIds, saved.landIds, 'generated geography resumed');
  assert.equal(initial.entities.filter((e: any) => e.kind === 'relic').length, 5);
  await runRelicJourney(fixture, {
    snapshot,
    command: async command => { await query({ type: 'command', command }); },
    step: ticks => page.evaluate(n => (window as any).__relicStep(n), ticks),
    collect: async (monk, relic) => {
      await query({ type: 'look', entity: relic });
      await query({ type: 'select', ids: [monk] });
      await page.waitForFunction(async id => (await (window as any).__empiresDebug({ type: 'entities', id })).entities[0]?.bodyVisible, {}, relic);
      const drawn = (await query({ type: 'entities', id: relic })).entities[0];
      await page.mouse.click(drawn.screen.x, drawn.screen.y, { button: 'right' });
      assert.equal((await snapshot()).entities.find((e: any) => e.id === monk).order.kind, 'relic');
    },
  });
  const final = await snapshot();
  assert.deepEqual(final.terrain, saved.terrain, 'no fixture ground edits during travel');
  assert.deepEqual(errors, []);
  console.log(`RELIC PLACEMENT GREEN: generated Islands seed 130; two real relic right-clicks; home collection, outward transport, fifth-relic pickup, carrier return, two deposits and 60 gold/minute; tick ${final.tick}`);
} finally { await browser.close(); await server.close(); }
