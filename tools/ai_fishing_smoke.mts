/** #91: the actual player-2 example AI starts from an untouched Islands opening. */
import assert from 'node:assert/strict';
import { startServer, launchBrowser, newPage, blockImported } from './smoke-harness.mjs';

const fallback = process.env.OPEN_FALLBACK === '1';
const server = await startServer({ port: 5298, plugins: [{
    name: 'private-fishing-observer', enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/src/main.ts')) return;
      const anchor = 'renderer.setAnimationLoop(now => {';
      const apply = 'const result = shared ? shared.command(command) : applyLocalCommand(state, command);';
      assert(code.includes(anchor) && code.includes(apply));
      return code.replaceAll('stepGame(game);', '__fishingStep();')
        .replace(apply, apply + `
          if(command.player===2 && !result.ok && ((command.kind==='build'&&command.building==='dock')
            ||(command.kind==='train'&&command.unit==='fishing-ship'))) __fishingProbe.refused.push(result.reason);`)
        .replace(anchor, `const __fishingProbe = {dockAt:0,shipAt:0,bankAt:0,banked:0,refused:[] as string[]};
          function __fishingStep() {
            const cargo=game.entities.filter(e=>e.owner===2&&e.kind==='fishing-ship'&&e.carrying?.amount)
              .map(e=>({id:e.id,amount:e.carrying!.amount}));
            const food=game.players[2].food;
            stepGame(game);
            if(!__fishingProbe.dockAt&&game.entities.some(e=>e.owner===2&&e.kind==='dock'&&e.buildProgress===undefined)) __fishingProbe.dockAt=gameTimeSeconds(game);
            if(!__fishingProbe.shipAt&&game.entities.some(e=>e.owner===2&&e.kind==='fishing-ship')) __fishingProbe.shipAt=gameTimeSeconds(game);
            for(const load of cargo) if(game.entities.some(e=>e.id===load.id&&!e.dead&&!e.carrying)&&game.players[2].food>=food+load.amount) {
              __fishingProbe.bankAt ||= gameTimeSeconds(game); __fishingProbe.banked+=load.amount;
            }
          }
          Object.assign(globalThis,{__fishingProbe});\n${anchor}`);
    },
  }] });
const browser = await launchBrowser();
try {
  const { page, errors } = await newPage(browser);
  if (fallback) await blockImported(page);
  await page.goto('http://127.0.0.1:5298/?solo=1&map=islands&seed=2', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120000 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  for (let i = 0; i < 6; i++) await page.keyboard.press('+');
  try {
    await page.waitForFunction(() => (window as any).__fishingProbe.banked > 0, { timeout: 170000, polling: 250 });
  } catch (error) {
    console.log('FISHING DIAGNOSTIC', await page.evaluate(() => (window as any).__fishingProbe), await query({ type: 'sim' }));
    throw error;
  }
  await page.keyboard.press('F3');
  const probe = await page.evaluate(() => (window as any).__fishingProbe);
  assert(probe.dockAt > 0 && probe.shipAt > probe.dockAt && probe.bankAt > probe.shipAt);
  assert.deepEqual(probe.refused, []);
  const state = await query({ type: 'snapshot' });
  const dock = state.entities.find((e: any) => e.owner === 2 && e.kind === 'dock');
  const ship = state.entities.find((e: any) => e.owner === 2 && e.kind === 'fishing-ship');
  assert(dock && ship && dock.buildProgress === undefined);
  await page.keyboard.press('F4');
  for (const entity of [dock, ship]) {
    await query({ type: 'look', entity: entity.id });
    await page.waitForFunction(async id => (await (window as any).__empiresDebug({ type: 'entities', id })).entities[0]?.bodyVisible,
      { timeout: 60000 }, entity.id);
  }
  const drawn = (await query({ type: 'entities', id: ship.id })).entities[0];
  await page.mouse.click(drawn.screen.x, drawn.screen.y);
  assert((await query({ type: 'sim' })).selected.includes(ship.id));
  await page.waitForFunction(() => document.querySelector('.object-name')?.textContent?.includes('Fishing Ship'));
  assert.deepEqual(errors, []);
  console.log(`AI FISHING SMOKE GREEN (${fallback ? 'fallback' : 'owned'}): ${JSON.stringify(probe)}; natural opening, real dock/ship art and selection`);
} finally { await browser.close(); await server.close(); }
