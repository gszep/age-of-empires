import assert from 'node:assert/strict';
import { civilizationBrowser } from './civ_browser.mts';
import { activateAutomaticTechnologies, createGame } from '../src/sim/game.ts';
import { buildingRulesFor } from '../src/sim/rules.ts';
import type { BuildingKind, Entity, GameState, PlayerId } from '../src/sim/types.ts';

const b = await civilizationBrowser('incas', 5299);
function home(s: GameState, kind: BuildingKind, owner: PlayerId, x: number, y: number) {
  const r = buildingRulesFor(s, owner, kind), e: Entity = { id: s.nextId++, kind, owner, position: { x, y },
    hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
  s.entities.push(e); return e;
}
try {
  await b.menu('britons');
  assert.equal(b.profile.civilization.hudStyle, 'CivAnde');
  const s = createGame(199, b.rules, { 1: 'incas', 2: 'britons' });
  const scouts = (owner: PlayerId) => s.entities.filter(e => e.owner === owner && (e.kind === 'dat-unit-2550' || e.kind === 'scout-cavalry')).map(e => e.kind);
  assert.deepEqual(scouts(1), ['dat-unit-2550'], 'Inca open with the Champi Scout (resource 263)');
  assert.deepEqual(scouts(2), ['scout-cavalry'], 'Britons keep Scout Cavalry');
  const llamas = (owner: PlayerId) => s.entities.filter(e => e.owner === owner && (e.kind === 'dat-unit-305' || e.kind === 'dat-unit-1963'));
  assert.equal(llamas(1).length, 1, 'team bonus 730 grants one llama'); assert.equal(llamas(2).length, 0);
  const llama = llamas(1)[0];
  s.entities = s.entities.filter(e => e.kind === 'town-center' || e === llama); s.terrain.fill(0); s.elevation.fill(0);
  s.entities.filter(e => e.kind === 'town-center').forEach((e, i) => e.position = { x: 10 + 80 * i, y: 10 });
  llama.position = { x: 16, y: 16 };
  for (const owner of [1, 2] as const) Object.assign(s.players[owner], { age: 2, food: 30000, wood: 30000, gold: 30000, stone: 30000 });
  const settlement = home(s, 'settlement', 1, 30, 20), barracks = home(s, 'barracks', 1, 40, 30);
  const range = home(s, 'archery-range', 1, 30, 40), castle = home(s, 'castle', 1, 20, 30);
  activateAutomaticTechnologies(s); await b.stage(s);
  const tc = s.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
  await b.art(tc.id, 'town-center'); await b.art(settlement.id, 'settlement'); await b.art(llama.id, llama.kind);
  await b.research(settlement.id, 'double-bit-axe');
  const champi = await b.train(barracks.id, 'dat-unit-2550'); await b.art(champi.id, 'dat-unit-2550');
  const slinger = await b.train(range.id, 'dat-unit-185'); await b.art(slinger.id, 'dat-unit-185');
  const kamayuk = await b.train(castle.id, 'dat-unit-879'); await b.art(kamayuk.id, 'dat-unit-879');
  await b.research(castle.id, 'andean-sling');
  await b.research(tc.id, 'imperial-age'); await b.art(tc.id, 'town-center');
  await b.research(castle.id, 'elite-kamayuk'); await b.art(kamayuk.id, 'dat-unit-881');
  await b.research(castle.id, 'fabric-shields');
  await b.reload(); const after = await b.snapshot();
  assert.equal(after.players[1].civilization, 'incas');
  for (const key of ['double-bit-axe', 'andean-sling', 'elite-kamayuk', 'fabric-shields']) assert(after.players[1].researched.includes(key), key);
  assert(!after.players[2].researched.includes('fabric-shields'));
  assert.deepEqual(b.errors, []);
  console.log('INCA SMOKE GREEN: menu/reload, ANDE HUD, Champi Scout opening (Britons keep Scout Cavalry), Andean TC Castle/Imperial and Settlement art, paid Double-Bit Axe at the Settlement, Champi/Slinger/Kamayuk/Elite Kamayuk art, paid Andean Sling/Fabric Shields, free-llama grant and art');
} finally { await b.close(); }
