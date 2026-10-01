import assert from 'node:assert/strict';
import { civilizationBrowser } from './civ_browser.mts';
import { activateAutomaticTechnologies, createGame } from '../src/sim/game.ts';
import { buildingRulesFor, unitRulesFor } from '../src/sim/rules.ts';
import type { BuildingKind, Entity, GameState, PlayerId, UnitKind } from '../src/sim/types.ts';

const b = await civilizationBrowser('chinese', 5274);
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
const speed = async (key: '+' | '-') => { for (let i = 0; i < 6; i++) await b.page.keyboard.press(key); };
const command = async (command: object) => assert((await b.query({ type: 'command', command })).ok);
try {
  await b.menu('japanese');
  const opening = await b.snapshot();
  assert.equal(opening.entities.filter((e: any) => e.owner === 1 && e.kind === 'villager').length, 6);
  assert.equal(opening.players[1].food, 0); assert.equal(opening.players[1].wood, 150);
  assert.equal(opening.players[1].populationCap, 15);
  const s = createGame(184, b.rules, { 1: 'chinese', 2: 'japanese' });
  s.entities = s.entities.filter(e => e.owner === 1); s.terrain.fill(0); s.elevation.fill(0);
  for (const owner of [1, 2] as const) Object.assign(s.players[owner], { age: 1, food: 30000, wood: 30000, gold: 30000, stone: 30000 });
  home(s, 'town-center', 2, 90, 90);
  const tc = s.entities.find(e => e.kind === 'town-center')!; tc.position = { x: 20, y: 20 };
  const workers = s.entities.filter(e => e.kind === 'villager'); workers.forEach((e, i) => e.position = { x: 35, y: 40 + i * 2 });
  const castle = home(s, 'castle', 1, 20, 40), mill = home(s, 'mill', 1, 40, 20);
  const barracks = home(s, 'barracks', 1, 28, 20), workshop = home(s, 'siege-workshop', 1, 40, 40);
  home(s, 'market', 1, 20, 30); home(s, 'blacksmith', 1, 28, 30); home(s, 'university', 1, 40, 30);
  const victim = unit(s, 'knight', 2, 56, 50); victim.hp = victim.maxHp = 10000; victim.attackCooldown = 100000;
  home(s, 'outpost', 1, 56.5, 54.5); // public orders need genuine friendly sight
  activateAutomaticTechnologies(s); await b.stage(s);
  const before = await b.snapshot(); await b.research(tc.id, 'castle-age');
  assert.equal(before.players[1].food - (await b.snapshot()).players[1].food, 760);
  const farm = await b.build(workers[0].id, 'farm', { x: 34.5, y: 58.5 });
  assert.equal((await b.snapshot()).entities.find((e: any) => e.id === farm.site.id).amount, 193);
  await command({ kind: 'stop', player: 1, entityIds: [workers[0].id] });
  await b.research(mill.id, 'horse-collar');
  const crop = await b.build(workers[1].id, 'farm', { x: 38.5, y: 58.5 });
  assert.equal((await b.snapshot()).entities.find((e: any) => e.id === crop.site.id).amount, 275);
  const ckn = await b.train(castle.id, 'dat-unit-73'); await b.art(ckn.id, 'dat-unit-73');
  const tower = await b.build(workers[2].id, 'watch-tower', { x: 40.5, y: 65.5 });
  const hp = (await b.snapshot()).entities.find((e: any) => e.id === tower.site.id).maxHp;
  await b.research(castle.id, 'great-wall');
  assert.equal((await b.snapshot()).entities.find((e: any) => e.id === tower.site.id).maxHp, hp * 1.3);
  const lancer = await b.train(barracks.id, 'dat-unit-1901'); await b.art(lancer.id, 'dat-unit-1901');
  await command({ kind: 'order', player: 1, entityIds: [lancer.id], targetId: victim.id, target: victim.position });
  await b.until((s, a) => { const e = s.entities.find((e: any) => e.id === a.id); return Math.hypot(e.position.x - a.x, e.position.y - a.y) < 7; }, { id: lancer.id, ...victim.position });
  await speed('-');
  await b.until((s, id) => s.entities.find((e: any) => e.id === id)?.attackWeapon === 'alternate', lancer.id);
  await b.art(lancer.id, 'dat-unit-1901');
  const special = await b.page.evaluate(id => (window as any).__civProbe.art(id), lancer.id);
  assert.equal(special.texture, b.profile.entities['dat-unit-1901'].atlases['attack-special'].image);
  await b.until((s, id) => s.projectiles.filter((p: any) => p.shooterId === id).length === 3, lancer.id);
  await b.select(lancer.id); await b.page.waitForFunction(() => document.body.innerText.includes('Charge: 0%'));
  await command({ kind: 'delete', player: 2, entityIds: [victim.id] }); await speed('+');
  const cart = await b.train(workshop.id, 'dat-unit-1904'); await b.art(cart.id, 'dat-unit-1904');
  await b.select(cart.id); await b.click('attack-ground');
  await b.page.waitForSelector('[data-command="cancel"]');
  const at = { x: 50, y: 40 }; await b.query({ type: 'look', rect: [at.x, at.y] });
  await b.page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const screen = await b.page.evaluate(p => (window as any).__civProbe.screen(p), at);
  await b.page.mouse.click(screen.x, screen.y);
  assert.equal((await b.snapshot()).entities.find((e: any) => e.id === cart.id).order.kind, 'attack-ground');
  await b.until((s, id) => s.projectiles.some((p: any) => p.shooterId === id && p.art === 'dat-projectile-1906'), cart.id);
  await b.select(cart.id); await b.click('stop');
  assert.equal((await b.snapshot()).entities.find((e: any) => e.id === cart.id).attackVolley, undefined);
  await b.research(tc.id, 'imperial-age'); await b.research(castle.id, 'elite-chu-ko-nu'); await b.art(ckn.id, 'dat-unit-559');
  await b.research(barracks.id, 'elite-fire-lancer'); await b.art(lancer.id, 'dat-unit-1903');
  await b.research(workshop.id, 'heavy-rocket-cart'); await b.art(cart.id, 'dat-unit-1907');
  await b.research(castle.id, 'rocketry');
  const ram = await b.train(workshop.id, 'battering-ram');
  await b.research(workshop.id, 'capped-ram'); await b.research(workshop.id, 'siege-ram'); await b.art(ram.id, 'dat-unit-548');
  await b.reload(); assert.equal((await b.snapshot()).players[1].civilization, 'chinese');
  console.log('CHINESE LAND GREEN: six-villager opening, discounted age/research, team crops, Great Wall, Chu Ko Nu/elite, firearm art+bullets+charge HUD, ground-fire button, regional upgrades and siege ram art');

  const sea = createGame(184, b.rules, { 1: 'chinese', 2: 'japanese' }, 'islands');
  sea.entities = sea.entities.filter(e => e.kind === 'town-center'); sea.terrain.fill(23); sea.elevation.fill(0);
  for (const owner of [1, 2] as const) Object.assign(sea.players[owner], { age: 3, food: 30000, wood: 30000, gold: 30000, stone: 30000 });
  const dock = home(sea, 'dock', 1, 40, 40), fort = home(sea, 'castle', 1, 20, 20), school = home(sea, 'university', 1, 28, 20);
  const enemy = unit(sea, 'galley', 2, 52, 44); enemy.hp = enemy.maxHp = 10000; enemy.attackCooldown = 100000;
  activateAutomaticTechnologies(sea); await b.stage(sea);
  const dragon = await b.train(dock.id, 'fire-galley');
  await b.research(dock.id, 'warships'); await b.research(school.id, 'siphons'); await b.research(dock.id, 'heavy-warships');
  assert((await b.snapshot()).players[1].researched.includes('dragon-ship')); await b.art(dragon.id, 'dat-unit-1302');
  const lou = await b.train(dock.id, 'dat-unit-1948'); await b.art(lou.id, 'dat-unit-1948');
  await command({ kind: 'order', player: 1, entityIds: [lou.id], targetId: enemy.id, target: enemy.position });
  await b.until((s, id) => s.projectiles.some((p: any) => p.shooterId === id && p.art === 'dat-projectile-1936'), lou.id);
  await b.research(fort.id, 'rocketry');
  await b.until((s, id) => s.projectiles.some((p: any) => p.shooterId === id && p.art === 'dat-projectile-1879'), lou.id);
  await b.reload(); assert((await b.snapshot()).players[1].researched.includes('rocketry'));
  assert.deepEqual(b.errors, []);
  console.log(`CHINESE SMOKE GREEN (${b.pending ? 'pending' : 'published enabled'}; Dragon Ship/free upgrade/Siphons, Lou Chuan arrows and Rocketry art, private real-browser commands)`);
} finally { await b.close(); }
