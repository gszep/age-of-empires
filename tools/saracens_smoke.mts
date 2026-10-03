import assert from 'node:assert/strict';
import { civilizationBrowser } from './civ_browser.mts';
import { activateAutomaticTechnologies, createGame } from '../src/sim/game.ts';
import { buildingRulesFor, unitRulesFor } from '../src/sim/rules.ts';
import type { BuildingKind, Entity, GameState, PlayerId, UnitKind } from '../src/sim/types.ts';

const b = await civilizationBrowser('saracens', 5277);
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
try {
  await b.menu('britons');
  assert.equal(b.profile.civilization.hudStyle, 'CivOrie');
  const panel = await b.page.$eval('#resource-panel', e => (e as HTMLElement).style.backgroundImage);
  assert(panel.toLowerCase().includes('orie'), panel);
  const s = createGame(187, b.rules, { 1: 'saracens', 2: 'britons' });
  s.entities = s.entities.filter(e => e.kind === 'town-center'); s.terrain.fill(0); s.elevation.fill(0);
  s.entities.forEach((e, i) => e.position = { x: 10 + 80 * i, y: 10 });
  for (const owner of [1, 2] as const) Object.assign(s.players[owner], { age: 2, food: 30000, wood: 30000, gold: 30000, stone: 30000 });
  const castle = home(s, 'castle', 1, 20, 20), stable = home(s, 'stable', 1, 30, 20);
  const monastery = home(s, 'monastery', 1, 40, 20);
  home(s, 'mill', 1, 30, 30);
  const worker = unit(s, 'villager', 1, 40, 40);
  const monk = unit(s, 'monk', 1, 50, 50), patient = unit(s, 'militia', 1, 53, 50); patient.hp = 1;
  activateAutomaticTechnologies(s); await b.stage(s);
  await b.art(castle.id, 'castle');
  const mameluke = await b.train(castle.id, 'dat-unit-282'); await b.art(mameluke.id, 'dat-unit-282');
  assert.equal(mameluke.maxHp, 100);
  await b.research(s.entities.find(e => e.owner === 1 && e.kind === 'town-center')!.id, 'imperial-age');
  await b.research(castle.id, 'elite-mameluke'); await b.art(mameluke.id, 'dat-unit-556');
  await b.research(castle.id, 'counterweights');
  await b.research(castle.id, 'bimaristan');
  await b.until((s, id) => s.entities.find((e: any) => e.id === id).hp > 5, patient.id);
  await b.art(monk.id, 'monk');
  const camel = await b.train(stable.id, 'dat-unit-329'); await b.art(camel.id, 'dat-unit-329'); assert.equal(camel.maxHp, 125);
  await b.train(monastery.id, 'monk');
  const market = await b.build(worker.id, 'market', { x: 44, y: 40 });
  assert.equal(market.before.players[1].wood - market.after.players[1].wood, 75);
  await b.art(market.site.id, 'market');
  const before = await b.snapshot();
  const result = await b.query({ type: 'command', command: { kind: 'exchange', player: 1, marketId: market.site.id, resource: 'food', side: 'sell', amount: 100 } });
  assert(result.ok); assert.equal((await b.snapshot()).players[1].gold - before.players[1].gold, 95);
  await b.reload(); assert.equal((await b.snapshot()).players[1].civilization, 'saracens');
  assert((await b.snapshot()).players[1].researched.includes('bimaristan'));
  const fight = { ...(await b.snapshot()), rules: b.rules } as GameState;
  const attacker = fight.entities.find(e => e.id === mameluke.id)!;
  attacker.position = { x: 60, y: 60 };
  const victim = unit(fight, 'knight', 2, 62, 60); victim.hp = victim.maxHp = 10000; victim.attackCooldown = 100000;
  await b.stage(fight);
  assert((await b.query({ type: 'command', command: { kind: 'order', player: 1, entityIds: [attacker.id], targetId: victim.id, target: victim.position } })).ok);
  await b.until((s, id) => s.entities.find((e: any) => e.id === id).hp < 10000, victim.id);
  await b.art(attacker.id, 'dat-unit-556');

  const sea = createGame(187, b.rules, { 1: 'saracens', 2: 'britons' }, 'islands');
  sea.entities = sea.entities.filter(e => e.kind === 'town-center'); sea.terrain.fill(23); sea.elevation.fill(0);
  for (const owner of [1, 2] as const) Object.assign(sea.players[owner], { age: 3, food: 30000, wood: 30000, gold: 30000, stone: 30000 });
  const dock = home(sea, 'dock', 1, 40, 40); activateAutomaticTechnologies(sea); await b.stage(sea);
  const transport = await b.train(dock.id, 'transport-ship'); assert.equal(transport.maxHp, 140); await b.art(transport.id, 'transport-ship');
  const galley = await b.train(dock.id, 'galley'); await b.art(galley.id, 'galley');
  await b.research(dock.id, 'warships'); await b.art(galley.id, 'war-galley');
  await b.research(dock.id, 'heavy-warships'); await b.art(galley.id, 'galleon');
  assert.deepEqual(b.errors, []);
  console.log('SARACENS SMOKE GREEN: menu/restart/reload, ORIE HUD, original castle/Mameluke/elite/camel/monk/market/ship art, paid age and unique research, passive healing, Mameluke combat, market construction/payment/exchange and naval upgrades');
} finally { await b.close(); }
