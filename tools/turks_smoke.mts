import assert from 'node:assert/strict';
import { civilizationBrowser } from './civ_browser.mts';
import { activateAutomaticTechnologies, createGame } from '../src/sim/game.ts';
import { buildingRulesFor, unitRulesFor } from '../src/sim/rules.ts';
import type { BuildingKind, Entity, GameState, PlayerId, UnitKind } from '../src/sim/types.ts';

const b = await civilizationBrowser('turks', 5281);
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
  const s = createGame(188, b.rules, { 1: 'turks', 2: 'britons' });
  s.entities = s.entities.filter(e => e.kind === 'town-center'); s.terrain.fill(0); s.elevation.fill(0);
  s.entities.forEach((e, i) => e.position = { x: 10 + 80 * i, y: 10 });
  for (const owner of [1, 2] as const) Object.assign(s.players[owner], { age: 2, food: 30000, wood: 30000, gold: 30000, stone: 30000 });
  const castle = home(s, 'castle', 1, 20, 20), range = home(s, 'archery-range', 1, 30, 20);
  const workshop = home(s, 'siege-workshop', 1, 40, 20);
  activateAutomaticTechnologies(s); await b.stage(s);
  await b.art(castle.id, 'castle');
  const janissary = await b.train(castle.id, 'dat-unit-46'); await b.art(janissary.id, 'dat-unit-46');
  assert.equal(janissary.maxHp, unitRulesFor({ ...(await b.snapshot()), rules: b.rules } as GameState, 1, 'dat-unit-46' as UnitKind).hp);
  await b.research(s.entities.find(e => e.owner === 1 && e.kind === 'town-center')!.id, 'imperial-age');
  assert((await b.snapshot()).players[1].researched.includes('chemistry'), 'free Chemistry in Imperial');
  await b.research(castle.id, 'elite-janissary'); await b.art(janissary.id, 'dat-unit-557');
  const elite = await b.train(castle.id, 'dat-unit-557'); await b.art(elite.id, 'dat-unit-557');
  await b.research(castle.id, 'sipahi');
  await b.research(castle.id, 'artillery');
  const gunner = await b.train(range.id, 'dat-unit-5'); await b.art(gunner.id, 'dat-unit-5');
  const bombard = await b.train(workshop.id, 'dat-unit-36'); await b.art(bombard.id, 'dat-unit-36');
  await b.reload(); const after = await b.snapshot();
  assert.equal(after.players[1].civilization, 'turks');
  for (const key of ['sipahi', 'artillery', 'elite-janissary']) assert(after.players[1].researched.includes(key), key);
  assert(!after.players[2].researched.includes('chemistry'));
  assert.deepEqual(b.errors, []);
  console.log('TURKS SMOKE GREEN: menu/reload, ORIE HUD, castle/Janissary/elite/Hand Cannoneer/Bombard Cannon art, paid Imperial age with free Chemistry, paid unique research, no opponent grant');
} finally { await b.close(); }
