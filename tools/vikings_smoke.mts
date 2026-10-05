import assert from 'node:assert/strict';
import { civilizationBrowser } from './civ_browser.mts';
import { activateAutomaticTechnologies, createGame } from '../src/sim/game.ts';
import { buildingRulesFor, unitRulesFor } from '../src/sim/rules.ts';
import type { BuildingKind, Entity, GameState, PlayerId, UnitKind } from '../src/sim/types.ts';

const b = await civilizationBrowser('vikings', 5283);
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
  assert.equal(b.profile.civilization.hudStyle, 'CivSlav');
  const s = createGame(189, b.rules, { 1: 'vikings', 2: 'britons' });
  s.entities = s.entities.filter(e => e.kind === 'town-center'); s.terrain.fill(0); s.elevation.fill(0);
  s.entities.forEach((e, i) => e.position = { x: 10 + 80 * i, y: 10 });
  for (const owner of [1, 2] as const) Object.assign(s.players[owner], { age: 1, food: 30000, wood: 30000, gold: 30000, stone: 30000 });
  home(s, 'archery-range', 1, 30, 30); home(s, 'blacksmith', 1, 40, 30);
  const castle = home(s, 'castle', 1, 20, 20);
  activateAutomaticTechnologies(s); await b.stage(s);
  assert((await b.snapshot()).players[1].researched.includes('wheelbarrow'), 'free Wheelbarrow in Feudal');
  await b.research(s.entities.find(e => e.owner === 1 && e.kind === 'town-center')!.id, 'castle-age');
  await b.until((s: any) => s.players[1].researched.includes('hand-cart'), null);
  assert(!(await b.snapshot()).players[2].researched.includes('hand-cart'));
  await b.art(castle.id, 'castle');
  const berserk = await b.train(castle.id, 'dat-unit-692'); await b.art(berserk.id, 'dat-unit-692');
  await b.research(castle.id, 'chieftains');
  await b.research(s.entities.find(e => e.owner === 1 && e.kind === 'town-center')!.id, 'imperial-age');
  await b.research(castle.id, 'elite-berserk');
  // Promoted existing units keep the old texture (#303); verify elite art on a fresh unit here.
  const elite = await b.train(castle.id, 'dat-unit-694'); await b.art(elite.id, 'dat-unit-694');
  await b.research(castle.id, 'bogsveigar');
  await b.reload(); const after = await b.snapshot();
  assert.equal(after.players[1].civilization, 'vikings');
  for (const key of ['chieftains', 'bogsveigar', 'elite-berserk', 'hand-cart', 'wheelbarrow']) assert(after.players[1].researched.includes(key), key);

  const sea = createGame(189, b.rules, { 1: 'vikings', 2: 'britons' }, 'islands');
  sea.entities = sea.entities.filter(e => e.kind === 'town-center'); sea.terrain.fill(23); sea.elevation.fill(0);
  for (const owner of [1, 2] as const) Object.assign(sea.players[owner], { age: 2, food: 30000, wood: 30000, gold: 30000, stone: 30000 });
  const dock = home(sea, 'dock', 1, 40, 40), seaCastle = home(sea, 'castle', 1, 60, 60); home(sea, 'university', 1, 70, 40);
  activateAutomaticTechnologies(sea); await b.stage(sea);
  await b.art(dock.id, 'dock');
  const longboat = await b.train(dock.id, 'dat-unit-250'); await b.art(longboat.id, 'dat-unit-250');
  await b.research(sea.entities.find(e => e.owner === 1 && e.kind === 'town-center')!.id, 'imperial-age');
  await b.research(dock.id, 'elite-longboat');
  const eliteBoat = await b.train(dock.id, 'dat-unit-533'); await b.art(eliteBoat.id, 'dat-unit-533');
  void seaCastle;
  assert.deepEqual(b.errors, []);
  console.log('VIKINGS SMOKE GREEN: menu/reload, SLAV HUD, free Wheelbarrow (Feudal) and Hand Cart on paid Castle age with no opponent grant, castle/Berserk/elite/dock/Longboat/elite art, paid Chieftains/Bogsveigar/elite research');
} finally { await b.close(); }
