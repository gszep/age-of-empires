import assert from 'node:assert/strict';
import { civilizationBrowser } from './civ_browser.mts';
import { activateAutomaticTechnologies, createGame } from '../src/sim/game.ts';
import { buildingRulesFor, unitRulesFor } from '../src/sim/rules.ts';
import type { BuildingKind, Entity, GameState, PlayerId, UnitKind } from '../src/sim/types.ts';

const b = await civilizationBrowser('mongols', 5287);
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
  assert.equal(b.profile.civilization.hudStyle, 'CivNomad');
  const s = createGame(190, b.rules, { 1: 'mongols', 2: 'britons' });
  s.entities = s.entities.filter(e => e.kind === 'town-center'); s.terrain.fill(0); s.elevation.fill(0);
  s.entities.forEach((e, i) => e.position = { x: 10 + 80 * i, y: 10 });
  for (const owner of [1, 2] as const) Object.assign(s.players[owner], { age: 2, food: 30000, wood: 30000, gold: 30000, stone: 30000 });
  const castle = home(s, 'castle', 1, 20, 20), stable = home(s, 'stable', 1, 34, 20);
  const workshop = home(s, 'siege-workshop', 1, 44, 20); home(s, 'university', 1, 54, 20);
  activateAutomaticTechnologies(s); await b.stage(s);
  await b.art(castle.id, 'castle');
  const mangudai = await b.train(castle.id, 'dat-unit-11'); await b.art(mangudai.id, 'dat-unit-11');
  const lancer = await b.train(stable.id, 'dat-unit-1370'); await b.art(lancer.id, 'dat-unit-1370');
  const ram = await b.train(workshop.id, 'battering-ram'); await b.art(ram.id, 'battering-ram');
  await b.research(s.entities.find(e => e.owner === 1 && e.kind === 'town-center')!.id, 'imperial-age');
  await b.research(castle.id, 'drill');
  await b.research(castle.id, 'elite-mangudai'); await b.art(mangudai.id, 'dat-unit-561');
  await b.research(stable.id, 'elite-steppe-lancer'); await b.art(lancer.id, 'dat-unit-1372');
  await b.reload(); const after = await b.snapshot();
  assert.equal(after.players[1].civilization, 'mongols');
  for (const key of ['drill', 'elite-mangudai', 'elite-steppe-lancer']) assert(after.players[1].researched.includes(key), key);
  assert(!after.players[2].researched.includes('drill'));
  assert.deepEqual(b.errors, []);
  console.log('MONGOLS SMOKE GREEN: menu/reload, NOMAD HUD, castle/Mangudai/Steppe Lancer/ram art with promoted elite art, paid Imperial age, Drill and elite research, no opponent grant');
} finally { await b.close(); }
