import assert from 'node:assert/strict';
import { civilizationBrowser } from './civ_browser.mts';
import { activateAutomaticTechnologies, createGame } from '../src/sim/game.ts';
import { buildingRulesFor, unitRulesFor } from '../src/sim/rules.ts';
import type { BuildingKind, Entity, GameState, PlayerId, UnitKind } from '../src/sim/types.ts';

const b = await civilizationBrowser('byzantines', 5275);
function home(s: GameState, kind: BuildingKind, owner: PlayerId, x: number, y: number) {
  const r = buildingRulesFor(s, owner, kind), e: Entity = { id: s.nextId++, kind, owner, position: { x, y },
    hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
  s.entities.push(e); return e;
}
function unit(s: GameState, kind: UnitKind, owner: PlayerId, x: number, y: number) {
  const r = unitRulesFor(s, owner, kind), e: Entity = { id: s.nextId++, kind, owner, position: { x, y },
    hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
  s.entities.push(e); return e;
}
const command = async (command: object) => {
  const result = await b.query({ type: 'command', command });
  assert(result.ok, JSON.stringify({ command, result }));
};
const speed = async (key: '+' | '-') => { for (let i = 0; i < 6; i++) await b.page.keyboard.press(key); };
try {
  await b.menu('britons');
  assert.equal(b.profile.civilization.hudStyle, 'CivMedi');
  const panel = await b.page.$eval('#resource-panel', e => (e as HTMLElement).style.backgroundImage);
  assert(panel.toLowerCase().includes('medi'), panel);
  const s = createGame(185, b.rules, { 1: 'byzantines', 2: 'britons' });
  s.entities = s.entities.filter(e => e.owner === 1); s.terrain.fill(0); s.elevation.fill(0);
  for (const owner of [1, 2] as const) Object.assign(s.players[owner], { age: 1, food: 30000, wood: 30000, gold: 30000, stone: 30000 });
  home(s, 'town-center', 2, 90, 90);
  const tc = s.entities.find(e => e.kind === 'town-center')!; tc.position = { x: 20, y: 20 };
  const workers = s.entities.filter(e => e.kind === 'villager'); workers.forEach((e, i) => e.position = { x: 35, y: 40 + i * 2 });
  const castle = home(s, 'castle', 1, 20, 40), stable = home(s, 'stable', 1, 28, 30);
  const monastery = home(s, 'monastery', 1, 20, 60), school = home(s, 'university', 1, 40, 30);
  home(s, 'barracks', 1, 28, 20); home(s, 'mill', 1, 40, 20);
  home(s, 'market', 1, 20, 30); home(s, 'blacksmith', 1, 35, 20);
  const patient = unit(s, 'knight', 1, 36, 60); patient.hp = 1;
  const victim = unit(s, 'militia', 2, 56, 50), nearby = unit(s, 'dat-unit-25', 2, 56, 50.6);
  for (const e of [victim, nearby]) { e.hp = e.maxHp = 10000; e.attackCooldown = 100000; }
  home(s, 'outpost', 1, 56.5, 54.5);
  activateAutomaticTechnologies(s); await b.stage(s);
  assert((await b.snapshot()).players[1].researched.includes('town-watch'));
  await b.research(tc.id, 'castle-age'); await b.art(castle.id, 'castle');
  await b.select(castle.id);
  await b.page.waitForSelector('[data-command="train-dat-unit-40"]');
  const button = await b.page.$eval('[data-command="train-dat-unit-40"]', e => ({ title: e.getAttribute('title'), icon: (e as HTMLElement).style.backgroundImage }));
  assert(button.title?.includes('Cataphract')); assert(button.icon.includes(String(b.profile.entities['dat-unit-40'].iconId)));
  assert.equal(await b.page.$('[data-command="train-longbowman"]'), null);
  const cat = await b.train(castle.id, 'dat-unit-40'); await b.art(cat.id, 'dat-unit-40');
  const bank = await b.snapshot(), camel = await b.train(stable.id, 'dat-unit-329'); await b.art(camel.id, 'dat-unit-329');
  assert.equal(bank.players[1].food - (await b.snapshot()).players[1].food, 41);
  assert.equal(bank.players[1].gold - (await b.snapshot()).players[1].gold, 45);
  const house = await b.build(workers[0].id, 'house', { x: 36, y: 66 });
  const expected = buildingRulesFor({ ...(await b.snapshot()), rules: b.rules }, 1, 'house').hp;
  assert.equal((await b.snapshot()).entities.find((e: any) => e.id === house.site.id).maxHp, expected);
  const monk = await b.train(monastery.id, 'monk');
  await command({ kind: 'order', player: 1, entityIds: [monk.id], targetId: patient.id, target: patient.position });
  await b.until((s, id) => s.entities.find((e: any) => e.id === id).hp > 20, patient.id);
  await b.art(monk.id, 'monk');
  const before = await b.snapshot(); await b.research(tc.id, 'imperial-age');
  assert.equal(before.players[1].food - (await b.snapshot()).players[1].food, 670);
  assert.equal(before.players[1].gold - (await b.snapshot()).players[1].gold, 536);
  assert((await b.snapshot()).players[1].researched.includes('town-patrol'));
  await b.research(castle.id, 'elite-cataphract'); await b.art(cat.id, 'dat-unit-553');
  await b.research(stable.id, 'heavy-camel-rider'); await b.art(camel.id, 'dat-unit-330');
  await b.research(castle.id, 'logistica');
  await command({ kind: 'order', player: 1, entityIds: [cat.id], targetId: victim.id, target: victim.position });
  await b.until((s, a) => s.entities.find((e: any) => e.id === a.primary).hp < 10000 && s.entities.find((e: any) => e.id === a.secondary).hp < 10000,
    { primary: victim.id, secondary: nearby.id });
  for (const e of [victim, nearby]) await command({ kind: 'delete', player: 2, entityIds: [e.id] });
  await command({ kind: 'stop', player: 1, entityIds: [cat.id] });
  await b.research(school.id, 'chemistry'); await b.research(school.id, 'bombard-tower');
  const tower = await b.build(workers[1].id, 'bombard-tower', { x: 45.5, y: 65.5 }); await b.art(tower.site.id, 'bombard-tower');
  await b.research(castle.id, 'greek-fire');
  await b.reload(); assert.equal((await b.snapshot()).players[1].civilization, 'byzantines');
  console.log('BYZANTINE LAND GREEN: MEDI HUD/castle, menu/reload/restart, discounted camels/elite, Cataphracts/icon/elite/Logistica collateral, actual healing, age HP/sight, paid670/536 Imperial, Bombard Tower construction and Greek Fire');

  const sea = createGame(185, b.rules, { 1: 'byzantines', 2: 'britons' }, 'islands');
  sea.entities = sea.entities.filter(e => e.kind === 'town-center'); sea.terrain.fill(23); sea.elevation.fill(0);
  for (const owner of [1, 2] as const) Object.assign(sea.players[owner], { age: 3, food: 30000, wood: 30000, gold: 30000, stone: 30000 });
  const dock = home(sea, 'dock', 1, 40, 40), fort = home(sea, 'castle', 1, 20, 20);
  const enemy = unit(sea, 'transport-ship', 2, 50, 44); enemy.hp = enemy.maxHp = 10000;
  const bombard = home(sea, 'bombard-tower', 1, 60.5, 40.5), target = home(sea, 'house', 2, 67.5, 80.5);
  activateAutomaticTechnologies(sea); await b.stage(sea);
  const dromon = await b.train(dock.id, 'dat-unit-1795'); await b.art(dromon.id, 'dat-unit-1795');
  const fire = await b.train(dock.id, 'fire-galley');
  await b.research(dock.id, 'warships'); await b.research(dock.id, 'heavy-warships'); await b.art(fire.id, 'fast-fire-ship');
  await b.research(fort.id, 'greek-fire'); await speed('-');
  await command({ kind: 'order', player: 1, entityIds: [dromon.id], targetId: enemy.id, target: enemy.position });
  await b.until((s, id) => s.projectiles.some((p: any) => p.shooterId === id && p.art === 'dat-projectile-1798'), dromon.id);
  // Stage the target in range only after the paid research/production clocks;
  // otherwise automatic defensive fire destroys it before this command.
  const cannonScene = await b.snapshot();
  const cannonTarget = cannonScene.entities.find((e: any) => e.id === target.id);
  assert(cannonTarget && !cannonTarget.dead);
  assert.equal(cannonTarget.hp, buildingRulesFor({ ...cannonScene, rules: b.rules }, 2, 'house').hp);
  const targetHp = cannonTarget.hp;
  cannonTarget.position = { x: 67.5, y: 40.5 };
  await b.stage({ ...cannonScene, rules: b.rules }); await speed('-');
  await command({ kind: 'order', player: 1, entityIds: [bombard.id], targetId: target.id, target: cannonTarget.position });
  await b.until((s, id) => s.projectiles.some((p: any) => p.shooterId === id && p.art === 'dat-projectile-537'), bombard.id);
  await b.until((s, a) => s.entities.find((e: any) => e.id === a.id)?.hp < a.hp, { id: target.id, hp: targetHp });
  assert.deepEqual(b.errors, []);
  console.log(`BYZANTINE SMOKE GREEN (${b.pending ? 'pending' : 'published enabled'}; Dromon/Fire Ship training and upgrades, Greek Fire original projectile identities and tower damage)`);
} catch (error) {
  const state = await b.snapshot();
  console.error('BYZANTINE DIAGNOSTIC', JSON.stringify({ preview: await b.page.evaluate(() => (window as any).__civProbe.preview()), buttons: await b.page.$$eval('[data-command]', nodes => nodes.map(e => ({ key: e.getAttribute('data-command'), title: e.getAttribute('title') }))), players: state.players, entities: state.entities }));
  throw error;
} finally { await b.close(); }
