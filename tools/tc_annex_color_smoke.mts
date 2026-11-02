/** #294: an Imperial Japanese town center draws player colour only where its own art has a mask. */
import assert from 'node:assert/strict';
import { ownedManifest, startServer, launchBrowser, newPage } from './smoke-harness.mjs';
import { createGame } from '../src/sim/game.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import { updateVisibility } from '../src/sim/visibility.ts';

const manifest = ownedManifest();
assert(manifest.civilizations?.japanese, 'owned import publishes the Japanese profile');
const rules = rulesFromManifest(manifest), state = createGame(294, rules, { 1: 'japanese', 2: 'britons' });
state.entities = state.entities.filter(e => e.kind === 'town-center');
state.terrain.fill(0); state.elevation.fill(0);
state.players[1].age = 3;
const tc = state.entities.find(e => e.owner === 1)!;
updateVisibility(state);
const { rules: ignored, ...saved } = state;
const server = await startServer({ plugins: [{
  name: 'tc-annex-fixture', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    assert(code.includes('renderer.render(scene, camera);') && code.includes('let paused = false;'));
    return code.replace('let paused = false;', 'let paused = true;').replace('renderer.render(scene, camera);',
      'Object.assign(globalThis, { __tc: { views } }); renderer.render(scene, camera);');
  },
}], port: 5272 });
const browser = await launchBrowser();
try {
  const { page, errors } = await newPage(browser);
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5272/?solo=1', { waitUntil: 'networkidle0', timeout: 120_000 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  assert((await query({ type: 'snapshot' })).entities.some((e: any) => e.id === tc.id), 'fixture resumed');
  await query({ type: 'look', entity: tc.id });
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 30_000 });
  const pieces = await page.evaluate(id => {
    const view = (globalThis as any).__tc.views.get(`e${id}`);
    return view.annexes.map((piece: any, index: number) => ({
      art: piece.textureImage, color: view.annexColors[index].mesh.visible ? view.annexColors[index].textureImage : null,
    }));
  }, tc.id);
  console.log(JSON.stringify(pieces));
  const art = (stem: string) => pieces.find((p: any) => p.art?.includes(stem));
  assert(art('annex0-idle-imperial')?.color?.includes('annex0-idle-imperial-playercolor'), 'main piece keeps its own mask');
  assert(art('annex2-idle-imperial'), 'front piece draws Imperial art');
  assert.equal(art('annex2-idle-imperial').color, null, 'front piece borrows no other age’s mask');
  for (const piece of pieces) {
    if (piece.color) assert(piece.color.startsWith(piece.art.replace(/\.png$/, '').replace(/-p\d+$/, '')), `${piece.art} colour ${piece.color}`);
  }
  if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT });
  assert.deepEqual(errors, []);
  console.log('TC ANNEX COLOUR GREEN: every visible annex colour mask matches its own art');
} finally { await browser.close(); await server.close(); }
