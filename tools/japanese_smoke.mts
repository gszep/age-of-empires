import assert from 'node:assert/strict';
import { civilizationBrowser } from './civ_browser.mts';
import { activateAutomaticTechnologies, createGame } from '../src/sim/game.ts';
import { buildingRulesFor, unitRulesFor } from '../src/sim/rules.ts';
import type { BuildingKind, Entity, GameState, PlayerId, UnitKind } from '../src/sim/types.ts';

const b = await civilizationBrowser('japanese', 5273);
function building(s: GameState, kind: BuildingKind, owner: PlayerId, x: number, y: number) {
  const r = buildingRulesFor(s, owner, kind), e: Entity = { id: s.nextId++, kind, owner, position: { x, y },
    hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
  s.entities.push(e); return e;
}
function unit(s: GameState, kind: UnitKind, owner: PlayerId, x: number, y: number) {
  const r = unitRulesFor(s, owner, kind), e: Entity = { id: s.nextId++, kind, owner, position: { x, y },
    hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
  s.entities.push(e); return e;
}
try {
  await b.menu('teutons');
  const s = createGame(183, b.rules, { 1: 'japanese', 2: 'teutons' });
  s.entities = s.entities.filter(e => e.owner !== 0); s.terrain.fill(0); s.elevation.fill(0);
  for (const owner of [1, 2] as const) Object.assign(s.players[owner], { age: 1, food: 20000, wood: 20000, gold: 20000, stone: 20000 });
  const tc = s.entities.find(e => e.kind === 'town-center' && e.owner === 1)!; tc.position = { x: 20, y: 20 };
  const workers = s.entities.filter(e => e.owner === 1 && e.kind === 'villager');
  workers.forEach((e, i) => e.position = { x: 35, y: 40 + i * 2 });
  const castle = building(s, 'castle', 1, 20, 40), university = building(s, 'university', 1, 28, 30);
  building(s, 'blacksmith', 1, 20, 30); building(s, 'market', 1, 40, 20);
  const target = unit(s, 'villager', 2, 47, 60); target.hp = target.maxHp = 10000;
  activateAutomaticTechnologies(s); await b.stage(s);
  await b.art(castle.id, 'castle');
  const mill = await b.build(workers[0].id, 'mill', { x: 34, y: 50 });
  assert.equal(mill.before.players[1].wood - mill.after.players[1].wood, 50); await b.art(mill.site.id, 'mill');
  await b.research(tc.id, 'castle-age');
  await b.select(castle.id);
  await b.page.waitForSelector('[data-command="train-dat-unit-291"]');
  const button = await b.page.$eval('[data-command="train-dat-unit-291"]', e => ({ title: e.getAttribute('title'), icon: (e as HTMLElement).style.backgroundImage }));
  assert(button.title?.includes(b.profile.entities['dat-unit-291'].text.name));
  assert(button.icon.includes(String(b.profile.entities['dat-unit-291'].iconId)));
  const samurai = await b.train(castle.id, 'dat-unit-291'); await b.art(samurai.id, 'dat-unit-291');
  await b.select(castle.id);
  assert.equal(await b.page.$('[data-command="train-dat-unit-25"]'), null);
  const tower = await b.build(workers[1].id, 'watch-tower', { x: 40.5, y: 60.5 });
  await b.research(castle.id, 'yasama');
  await b.until((s, id) => s.projectiles.filter((p: any) => p.shooterId === id).length === 3, tower.site.id);
  assert.equal((await b.snapshot()).projectiles.filter((p: any) => p.shooterId === tower.site.id).length, 3);
  assert((await b.query({ type: 'command', command: { kind: 'delete', player: 2, entityIds: [target.id] } })).ok);
  await b.research(university.id, 'guard-tower'); await b.art(tower.site.id, 'guard-tower');
  await b.research(tc.id, 'imperial-age');
  await b.research(castle.id, 'elite-samurai'); await b.art(samurai.id, 'dat-unit-560');
  await b.research(university.id, 'keep'); await b.art(tower.site.id, 'keep');
  const treb = await b.train(castle.id, 'trebuchet'); await b.art(treb.id, 'trebuchet');
  await b.research(castle.id, 'kataparuto');
  await b.select(treb.id); await b.click('unpack');
  const packing = (await b.snapshot()).entities.find((e: any) => e.id === treb.id);
  assert.equal(packing.packingTicks, 23);
  await b.until((s, id) => s.entities.find((e: any) => e.id === id)?.unpacked === true, treb.id);
  await b.art(treb.id, 'trebuchet-unpacked');
  await b.reload();
  const reloaded = await b.snapshot(); assert.equal(reloaded.players[1].civilization, 'japanese');
  assert(reloaded.players[1].researched.includes('kataparuto'));
  console.log('JAPANESE LAND GREEN: selection/restart/reload, paid mill/Samurai/elite/Yasama/Kataparuto, three tower arrows, own Asia art');

  const sea = createGame(183, b.rules, { 1: 'japanese', 2: 'teutons' }, 'islands');
  sea.entities = sea.entities.filter(e => e.kind === 'town-center'); sea.terrain.fill(23); sea.elevation.fill(0);
  for (const owner of [1, 2] as const) Object.assign(sea.players[owner], { age: 3, food: 20000, wood: 20000, gold: 20000, stone: 20000 });
  const dock = building(sea, 'dock', 1, 40, 40), school = building(sea, 'university', 1, 20, 20);
  const fish: Entity = { id: sea.nextId++, kind: 'resource', owner: 0, node: 'fish', resourceKind: 'food', amount: 10,
    position: { x: 46, y: 40 }, hp: 1, maxHp: 1, radius: .5, activity: 'idle', order: { kind: 'idle' } };
  sea.entities.push(fish); activateAutomaticTechnologies(sea); await b.stage(sea);
  const fishing = await b.train(dock.id, 'fishing-ship'); assert.equal(fishing.maxHp, 100); await b.art(fishing.id, 'fishing-ship');
  const food = (await b.snapshot()).players[1].food;
  assert((await b.query({ type: 'command', command: { kind: 'order', player: 1, entityIds: [fishing.id], targetId: fish.id, target: fish.position } })).ok);
  await b.until((s, food) => s.players[1].food > food, food);
  assert.equal((await b.snapshot()).players[1].food - food, 10);
  await b.research(school.id, 'chemistry');
  const ship = await b.train(dock.id, 'cannon-galleon');
  await b.research(dock.id, 'elite-cannon-galleon'); await b.art(ship.id, 'dat-unit-691');
  await b.reload(); assert.equal((await b.snapshot()).entities.find((e: any) => e.id === ship.id).kind, 'dat-unit-691');
  assert.deepEqual(b.errors, []);
  console.log(`JAPANESE SMOKE GREEN (${b.pending ? 'pending' : 'published enabled'} profile; real menus/buttons/build/research, fishing bank, elite cannon-galleon art)`);
} finally { await b.close(); }
