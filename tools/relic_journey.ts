/** Shared acceptance fixture: generated terrain, nodes and relics are untouched.
 * Only the Castle-age monk, monastery and transport are staged. All travel,
 * collection, embarkation and deposit use public commands in Node and browser. */
import assert from 'node:assert/strict';
import { FALLBACK_RULES, type GameRules } from '../src/sim/data';
import { createGame, placementLegal } from '../src/sim/game';
import { buildNavGrid, distance, findPath } from '../src/sim/nav';
import { updateVisibility } from '../src/sim/visibility';
import type { Command, Entity, GameState, Point } from '../src/sim/types';

export function relicJourneyFixture(rules: GameRules = FALLBACK_RULES) {
  const state = createGame(130, rules, undefined, 'islands');
  const index = (p: Point) => Math.floor(p.y) * state.width + Math.floor(p.x);
  const worker = state.entities.find(e => e.kind === 'villager' && e.owner === 1)!;
  const relics = state.entities.filter(e => e.kind === 'relic');
  const local = relics.find(e => state.landIds![index(e.position)] === 1)!;
  const extra = relics.find(e => state.landIds![index(e.position)] === 20)!;
  const add = (kind: 'monk' | 'monastery' | 'transport-ship', position: Point) => {
    const r = kind === 'monastery' ? rules.buildings[kind] : rules.units[kind];
    const e: Entity = { id: state.nextId++, kind, owner: 1, position: { ...position }, hp: r.hp, maxHp: r.hp,
      radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
    state.entities.push(e); return e;
  };
  const cells = state.terrain.map((_, i) => ({ x: i % state.width + 0.5, y: Math.floor(i / state.width) + 0.5 }));
  const home = cells.filter(p => state.landIds![index(p)] === 1)
    .sort((a, b) => distance(a, worker.position) - distance(b, worker.position))
    .find(p => placementLegal(state, 'monastery', p, 'x', 1).ok);
  assert(home, 'a legal monastery on the generated home island');
  const monastery = add('monastery', home);
  const monk = add('monk', worker.position);
  const land = buildNavGrid(state), sea = buildNavGrid(state, undefined, 1, rules.units['transport-ship'].terrainRestriction);
  const shores = (id: number, origin: Point) => cells.filter(p => state.landIds![index(p)] === id && !land.blocked[index(p)])
    .flatMap(p => [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dy]) => ({ land: p, sea: { x: p.x + dx, y: p.y + dy } })))
    .filter(p => !sea.blocked[index(p.sea)] && findPath(land, origin, p.land)?.length);
  const departure = shores(1, monk.position).sort((a, b) => distance(a.land, extra.position) - distance(b.land, extra.position))[0];
  assert(departure, 'reachable home shore');
  const arrival = shores(20, extra.position).sort((a, b) => distance(a.land, departure.land) - distance(b.land, departure.land))
    .find(p => findPath(sea, departure.sea, p.sea)?.length);
  assert(arrival, 'transport route to resource land 20');
  const transport = add('transport-ship', departure.sea);
  state.players[1].age = 2;
  updateVisibility(state);
  return { state, monk, monastery, transport, local, extra, departure, arrival };
}

export async function runRelicJourney(f: ReturnType<typeof relicJourneyFixture>, api: {
  snapshot(): Promise<GameState>;
  command(command: Command): Promise<void>;
  step(ticks: number): Promise<void>;
  collect?(monk: number, relic: number): Promise<void>;
}) {
  const entity = (s: GameState, e: Entity) => s.entities.find(t => t.id === e.id);
  const until = async (name: string, predicate: (s: GameState) => boolean, ticks = 6000) => {
    for (let i = 0; i < ticks; i += 100) {
      const s = await api.snapshot();
      if (predicate(s)) return;
      await api.step(100);
    }
    const s = await api.snapshot();
    assert(predicate(s), `${name}: ${JSON.stringify({ monk: entity(s, f.monk), transport: entity(s, f.transport) })}`);
  };
  const move = (e: Entity, target: Point) => api.command({ kind: 'order', player: 1, entityIds: [e.id], target });
  const target = (e: Entity, t: Entity) => api.command({ kind: 'order', player: 1, entityIds: [e.id], targetId: t.id, target: t.position });
  const collect = async (relic: Entity) => {
    await move(f.monk, relic.position);
    await until('walk to relic', s => distance(entity(s, f.monk)!.position, relic.position) < 3);
    if (api.collect) await api.collect(f.monk.id, relic.id); else await target(f.monk, relic);
  };
  await collect(f.local);
  await until('home relic deposited', s => !!entity(s, f.monastery)?.relics?.some(r => r.id === f.local.id));
  await move(f.monk, f.departure.land);
  await until('home embarkation shore', s => distance(entity(s, f.monk)!.position, f.departure.land) < 1);
  await target(f.monk, f.transport);
  await until('outbound boarding', s => !!entity(s, f.transport)?.garrison?.length);
  await api.command({ kind: 'ungarrison', player: 1, buildingId: f.transport.id, target: f.arrival.land });
  await until('resource-islet landing', s => !!entity(s, f.monk) && !entity(s, f.transport)?.garrison?.length);
  await collect(f.extra);
  await until('fifth relic carried', s => !!entity(s, f.monk)?.relics?.some(r => r.id === f.extra.id));
  await move(f.monk, f.arrival.land);
  await until('return embarkation shore', s => distance(entity(s, f.monk)!.position, f.arrival.land) < 1);
  const ship = entity(await api.snapshot(), f.transport)!;
  await target(f.monk, ship);
  await until('carrier boarded', s => !!entity(s, f.transport)?.garrison?.[0].relics?.some(r => r.id === f.extra.id));
  await api.command({ kind: 'ungarrison', player: 1, buildingId: f.transport.id, target: f.departure.land });
  await until('carrier landed at home', s => !!entity(s, f.monk) && !entity(s, f.transport)?.garrison?.length);
  await target(f.monk, f.monastery);
  await until('fifth relic deposited', s => !!entity(s, f.monastery)?.relics?.some(r => r.id === f.extra.id));
  const before = (await api.snapshot()).players[1].gold;
  await api.step(1200);
  assert.equal((await api.snapshot()).players[1].gold - before, 60, 'two deposited relics bank 60 gold/minute');
}
