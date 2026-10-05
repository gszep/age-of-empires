import assert from 'node:assert/strict';
import { civilizationBrowser } from './civ_browser.mts';
import { activateAutomaticTechnologies, createGame } from '../src/sim/game.ts';
import { buildingRulesFor, unitRulesFor } from '../src/sim/rules.ts';
import type { BuildingKind, Entity, GameState, PlayerId, UnitKind } from '../src/sim/types.ts';

const b = await civilizationBrowser('celts', 5285);
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
  assert.equal(b.profile.civilization.hudStyle, 'CivWest');
  const s = createGame(191, b.rules, { 1: 'celts', 2: 'britons' });
  s.entities = s.entities.filter(e => e.kind === 'town-center'); s.terrain.fill(0); s.elevation.fill(0);
  s.entities.forEach((e, i) => e.position = { x: 10 + 80 * i, y: 10 });
  for (const owner of [1, 2] as const) Object.assign(s.players[owner], { age: 2, food: 30000, wood: 30000, gold: 30000, stone: 30000 });
  const castle = home(s, 'castle', 1, 20, 20), workshop = home(s, 'siege-workshop', 1, 34, 20);
  home(s, 'university', 1, 44, 20);
  const patient = unit(s, 'militia', 1, 22, 25); patient.hp = 1;
  activateAutomaticTechnologies(s); await b.stage(s);
  await b.art(castle.id, 'castle');
  const woad = await b.train(castle.id, 'dat-unit-232'); await b.art(woad.id, 'dat-unit-232');
  await b.research(castle.id, 'stronghold');
  await b.until((s, id) => s.entities.find((e: any) => e.id === id).hp > 1, patient.id);
  const mangonel = await b.train(workshop.id, 'mangonel'); await b.art(mangonel.id, 'mangonel');
  await b.research(s.entities.find(e => e.owner === 1 && e.kind === 'town-center')!.id, 'imperial-age');
  await b.research(castle.id, 'furor-celtica');
  await b.research(castle.id, 'elite-woad-raider'); await b.art(woad.id, 'dat-unit-534');
  await b.reload(); const after = await b.snapshot();
  assert.equal(after.players[1].civilization, 'celts');
  for (const key of ['stronghold', 'furor-celtica', 'elite-woad-raider']) assert(after.players[1].researched.includes(key), key);
  assert(!after.players[2].researched.includes('stronghold'));
  assert.deepEqual(b.errors, []);
  console.log('CELTS SMOKE GREEN: menu/reload, WEST HUD, castle/Woad Raider/promoted Elite Woad/mangonel art, paid Stronghold with castle healing, Imperial age, Furor Celtica and elite research, no opponent grant');
} finally { await b.close(); }
