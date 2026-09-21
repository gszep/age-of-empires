import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, type NodeKind } from './data';
import { addNode, applyCommand, createGame, stepGame } from './game';
import type { BuildingKind, Entity } from './types';

function fixture(kind: BuildingKind) {
  const state = createGame(79);
  state.entities = state.entities.filter(e => e.owner !== 0);
  state.terrain.fill(0);
  const workers = state.entities.filter(e => e.kind === 'villager' && e.owner === 1);
  const home = state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
  const position = { x: home.position.x + 6, y: home.position.y };
  const rules = FALLBACK_RULES.buildings[kind];
  const site: Entity = {
    id: state.nextId++, kind, owner: 1, position,
    hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
    buildProgress: 0.999, activity: 'idle', order: { kind: 'idle' },
  };
  state.entities.push(site);
  for (const worker of workers) worker.position = { x: position.x + 1, y: position.y };
  const node = (kind: NodeKind, dx = 3, dy = 0) => addNode(state, kind, { x: position.x + dx, y: position.y + dy });
  const build = () => {
    stepGame(state); // reveal the fixture before issuing the public order
    expect(applyCommand(state, { kind: 'order', player: 1, entityIds: workers.map(e => e.id), target: position, targetId: site.id }).ok).toBe(true);
  };
  const finish = () => { stepGame(state); expect(site.buildProgress).toBeUndefined(); };
  return { state, workers, site, node, build, finish };
}

describe('gather after building a resource camp (#79)', () => {
  it.each([
    ['lumber-camp', 'tree', 'wood'], ['mining-camp', 'gold', 'gold'],
    ['mining-camp', 'stone', 'stone'], ['mill', 'berries', 'food'],
  ] as const)('%s builders gather and bank %s without another order', (kind, resource, bank) => {
    const { state, workers, node, build, finish } = fixture(kind);
    const target = node(resource);
    build(); finish();
    expect(workers.every(e => e.order.kind === 'gather' && e.order.targetId === target.id)).toBe(true);
    const before = state.players[1][bank];
    for (let i = 0; i < 1600 && state.players[1][bank] === before; i++) stepGame(state);
    expect(state.players[1][bank]).toBeGreaterThan(before);
  });

  it.each(['gold', 'stone'] as const)('chooses nearer %s instead of preferring a mining resource type', near => {
    const { workers, node, build, finish } = fixture('mining-camp');
    node(near === 'gold' ? 'stone' : 'gold', 6, 0);
    const target = node(near);
    build(); finish();
    expect(workers.every(e => e.order.kind === 'gather' && e.order.targetId === target.id)).toBe(true);
  });

  it('reserves a free farm once and sends surplus mill builders to berries', () => {
    const { state, workers, site, node, build, finish } = fixture('mill');
    const farm: Entity = { ...site, id: state.nextId++, kind: 'farm', buildProgress: undefined,
      position: { x: site.position.x + 3, y: site.position.y }, resourceKind: 'food', amount: 100 };
    state.entities.push(farm);
    const berries = node('berries', 4, 2);
    build(); finish();
    expect(workers.filter(e => e.order.kind === 'gather' && e.order.targetId === farm.id)).toHaveLength(1);
    expect(workers.filter(e => e.order.kind === 'gather' && e.order.targetId === berries.id)).toHaveLength(2);
  });

  it('does not use animals, carcasses, fish or depleted bushes after a mill', () => {
    const { state, workers, site, node, build, finish } = fixture('mill');
    node('berries').amount = 0;
    node('shore-fish', 3, 1);
    for (const [kind, dead] of [['sheep', false], ['deer', true], ['boar', false]] as const) {
      state.entities.push({ ...site, id: state.nextId++, kind, owner: 1, dead,
        position: { x: site.position.x + 2, y: site.position.y + 2 },
        buildProgress: undefined, resourceKind: 'food', amount: 100, decayTicks: 100 });
    }
    build(); finish();
    expect(workers.every(e => e.order.kind === 'idle')).toBe(true);
  });

  it('honours a queued move instead of starting an endless gather order', () => {
    const { state, workers, site, node, build, finish } = fixture('lumber-camp');
    node('tree'); build();
    const target = { x: site.position.x, y: site.position.y + 6 };
    expect(applyCommand(state, { kind: 'order', player: 1, entityIds: workers.map(e => e.id), target, queue: true }).ok).toBe(true);
    finish(); stepGame(state);
    expect(workers.every(e => e.order.kind === 'move')).toBe(true);
  });

  it.each(['empty', 'distant', 'hidden', 'enclosed'] as const)('skips a tree that is %s', situation => {
    const { state, workers, node, build, finish } = fixture('lumber-camp');
    const tree = node('tree', situation === 'distant' ? 18 : 3);
    if (situation === 'empty') tree.amount = 0;
    if (situation === 'enclosed') {
      node('tree', 2); node('tree', 4); node('tree', 3, -1); node('tree', 3, 1);
    }
    build();
    if (situation === 'hidden') state.visibility[1].visible.fill(0);
    finish();
    if (situation === 'enclosed') expect(workers.every(e => e.order.kind !== 'gather' || e.order.targetId !== tree.id)).toBe(true);
    else expect(workers.every(e => e.order.kind === 'idle')).toBe(true);
  });

  it.each(['occupied', 'unfinished', 'enemy'] as const)('does not claim an %s farm', condition => {
    const { state, workers, site, build, finish } = fixture('mill');
    const farm: Entity = { ...site, id: state.nextId++, kind: 'farm',
      position: { x: site.position.x + 3, y: site.position.y },
      owner: condition === 'enemy' ? 2 : 1,
      buildProgress: condition === 'unfinished' ? 0 : undefined, resourceKind: 'food', amount: 100 };
    state.entities.push(farm);
    build();
    if (condition === 'occupied') {
      const incumbent = { ...workers[0], id: state.nextId++, order: { kind: 'gather' as const, targetId: farm.id } };
      state.entities.push(incumbent);
    }
    finish();
    expect(workers.every(e => e.order.kind === 'idle')).toBe(true);
  });

  it('only participating builders take up gathering', () => {
    const { workers, site, node, build, finish } = fixture('lumber-camp');
    node('tree'); build();
    workers[0].position = { x: site.position.x - 15, y: site.position.y };
    finish();
    expect(workers[0].order.kind).toBe('idle');
    expect(workers.slice(1).every(e => e.order.kind === 'gather')).toBe(true);
  });
});
