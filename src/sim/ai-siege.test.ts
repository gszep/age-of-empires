import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exampleAiCommands } from './ai';
import { addNode, activateAutomaticTechnologies, applyCommand, createGame, stepGame } from './game';
import { FALLBACK_RULES, isBuilding, rulesFromManifest, type GameRules } from './data';
import { buildingRulesFor, unitRulesFor } from './rules';
import { observe } from './observe';
import { updateVisibility } from './visibility';
import type { Entity, EntityKind } from './types';

const owned = existsSync('public/imported/aoe2/manifest.json')
  ? rulesFromManifest(JSON.parse(readFileSync('public/imported/aoe2/manifest.json', 'utf8'))) : undefined;
function fixture(rules: GameRules = FALLBACK_RULES) {
  const state = createGame(131, structuredClone(rules));
  state.entities = []; state.terrain.fill(0); state.elevation.fill(0);
  for (const p of [1, 2] as const) {
    Object.assign(state.players[p], { age: 3, food: 0, wood: 1000, gold: 1000, stone: 640 });
    state.players[p].researched.push('feudal-age', 'castle-age', 'imperial-age', 'loom');
  }
  activateAutomaticTechnologies(state);
  const put = (kind: EntityKind, x: number, y: number, owner: 1 | 2 = 1): Entity => {
    if (kind === 'resource' || kind === 'relic') throw new Error('unit/building fixture');
    const r = isBuilding(kind) ? buildingRulesFor(state, owner, kind) : unitRulesFor(state, owner, kind);
    const e: Entity = { id: state.nextId++, kind, owner, position: { x, y }, hp: r.hp, maxHp: r.hp,
      radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
    state.entities.push(e); return e;
  };
  put('town-center', 30, 40);
  const enemy = put('town-center', 85, 40, 2);
  // A second TC keeps this fixture alive under the current last-TC defeat
  // rule; the monument supplies a durable visible siege objective after the
  // crossbow army demolishes the first TC during real castle construction.
  put('wonder', 85, 48, 2);
  put('town-center', 100, 100, 2);
  put('outpost', 80.5, 44.5); // legitimate scouting of both siege objectives
  put('barracks', 20.5, 30.5); put('archery-range', 20.5, 36.5); put('blacksmith', 20.5, 42.5);
  for (let i = 0; i < 4; i++) put('house', 20 + i * 3, 20);
  for (let i = 0; i < 6; i++) put('villager', 34 + i, 43);
  for (let i = 0; i < 10; i++) put('crossbowman', 32 + i % 5, 50 + Math.floor(i / 5));
  const stone = addNode(state, 'stone', { x: 35.5, y: 35.5 });
  stepGame(state); updateVisibility(state);
  expect(observe(state, 1).entities.some(e => e.kind === 'wonder' && e.owner === 2)).toBe(true);
  const commands = () => exampleAiCommands(JSON.parse(JSON.stringify(observe(state, 1))), { fishing: false });
  return { state, put, enemy, stone, commands };
}

describe.each([{ mode: 'open', rules: FALLBACK_RULES }, { mode: 'owned', rules: owned }])('$mode example-AI siege', ({ rules }) => {
  it.skipIf(!rules)('mines its missing castle stone, builds a paid castle, trains and bombards a known fortification', () => {
    const { state, commands, enemy, stone } = fixture(rules);
    const actions: string[] = [];
    let mined = false, built = false, trained = false, shot = false;
    for (let tick = 0; tick < 8500 && !shot; tick++) {
      if (state.tick % 10 === 0) for (const command of commands()) {
        const result = applyCommand(state, command);
        if (command.kind === 'build' && command.building === 'castle') {
          expect(result.ok).toBe(true); built = true; actions.push('castle');
        }
        if (command.kind === 'train' && command.unit === 'trebuchet') {
          expect(result.ok).toBe(true); trained = true; actions.push('trebuchet');
        }
      }
      stepGame(state);
      mined ||= (stone.amount ?? 0) < state.rules.nodes.stone.amount;
      shot = state.projectiles.some(p => state.entities.some(e => e.id === p.shooterId && e.kind === 'trebuchet'));
    }
    expect(mined).toBe(true); expect(built).toBe(true); expect(trained).toBe(true);
    expect(shot, JSON.stringify({ tick: state.tick, player: state.players[1], enemy,
      engines: state.entities.filter(e => e.kind === 'trebuchet' || e.kind === 'castle') })).toBe(true);
    expect(actions[0]).toBe('castle');
    const engine = state.entities.find(e => e.kind === 'trebuchet')!;
    expect(engine.unpacked).toBe(true);
    const projectile = state.projectiles.find(p => p.shooterId === engine.id)!;
    const objective = state.entities.find(e => e.id === projectile.targetId)!;
    expect(objective.owner).toBe(2); expect(isBuilding(objective.kind)).toBe(true);
    expect(engine.order).toMatchObject({ kind: 'attack', targetId: objective.id });
    const hp = objective.hp;
    for (let tick = 0; tick < 150; tick++) stepGame(state);
    expect(objective.hp).toBeLessThan(hp);
    expect(state.players[1].stone).toBeLessThan(650);
  });
});

it('reserves a scarce 200W/200G and the last population slot for the siege engine', () => {
  const { state, put, commands } = fixture();
  const castle = put('castle', 40, 50);
  Object.assign(state.players[1], { wood: 200, gold: 200, food: 400, populationCap: state.players[1].population + 1 });
  updateVisibility(state);
  const decisions = commands();
  const training = decisions.filter(c => c.kind === 'train');
  expect(training).toEqual([{ kind: 'train', player: 1, buildingId: castle.id, unit: 'trebuchet' }]);
  for (const command of decisions) applyCommand(state, command);
  expect(castle.training?.kind).toBe('trebuchet');
  expect(state.players[1].gold).toBe(0);
});

it('counts queued siege toward the cap and recovers an unstaffed paid castle', () => {
  const { state, put, commands } = fixture();
  const castle = put('castle', 40, 50);
  castle.buildProgress = .5;
  updateVisibility(state);
  expect(commands().some(c => c.kind === 'order' && c.targetId === castle.id)).toBe(true);
  castle.buildProgress = undefined;
  for (let i = 0; i < 3; i++) put('trebuchet', 42 + i, 52);
  castle.training = { kind: 'trebuchet', remainingTicks: 100 };
  put('castle', 50, 50);
  updateVisibility(state);
  expect(commands().some(c => c.kind === 'train' && c.unit === 'trebuchet')).toBe(false);
});

it('uses only observed buildings, sends a coordinate order to fog memory, and leaves existing attacks alone', () => {
  const { state, put } = fixture();
  const engine = put('trebuchet', 40, 50);
  updateVisibility(state);
  const observation = JSON.parse(JSON.stringify(observe(state, 1)));
  const enemy = observation.entities.find((e: any) => e.owner === 2);
  observation.entities = observation.entities.filter((e: any) => e.owner !== 2);
  observation.memory = [{ ...enemy, lastSeenAt: 0 }];
  const commands = exampleAiCommands(observation);
  expect(commands.find(c => c.kind === 'order' && c.entityIds.includes(engine.id))).toEqual({
    kind: 'order', player: 1, entityIds: [engine.id], target: { x: enemy.x, y: enemy.y },
  });
  observation.memory = [];
  expect(exampleAiCommands(observation).some(c => c.kind === 'order' && c.entityIds.includes(engine.id))).toBe(false);
  observation.entities.push(enemy);
  observation.entities.find((e: any) => e.id === engine.id).order = 'attack';
  expect(exampleAiCommands(observation).some(c => c.kind === 'order' && c.entityIds.includes(engine.id))).toBe(false);
});
