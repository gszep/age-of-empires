import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, TICK_SECONDS, rulesFromManifest, type ContentManifest, type GameRules, type TechEffect } from './data';
import { applyCommand, createGame, rulesForPlayer, stepGame, unitRulesFor, unitRulesForEntity } from './game';
import { synchronizationHash } from '../shared/checksum';
import { updateVisibility } from './visibility';
import { replayRecord, runMatch, type Strategy } from '../headless/runner';
import type { Command, Entity, GameState, PlayerId, UnitKind } from './types';

// Deliberately contrasting diagnostic profiles, not invented civilisation data.
const kinds = ['militia', 'longbowman', 'villager', 'battering-ram'] as const;
function catalog(): GameRules {
  const root = structuredClone(FALLBACK_RULES), donor = structuredClone(FALLBACK_RULES);
  donor.civilization = { key: 'donor', name: 'Donor fixture', unavailable: { technologies: [], units: [], buildings: [] } };
  for (const [index, rules] of [root, donor].entries()) {
    rules.units.monk.hp = 10000;
    for (const kind of kinds) {
      Object.assign(rules.units[kind], {
        hp: index ? 80 : 40, speed: index ? 2 : 0.4, lineOfSight: index ? 10 : 3,
        attacks: [{ class: kind === 'longbowman' ? 3 : 4, amount: index ? 20 : 4 }],
        armors: [{ class: 4, amount: index ? 6 : 0 }, { class: 3, amount: index ? 6 : 0 }],
      });
    }
    rules.units.longbowman.range = index ? 7 : 1;
    rules.units.longbowman.accuracyPercent = 100;
    rules.units.longbowman.datId = 8;
    const effects = (amount: number): TechEffect[] => kinds.flatMap(unit => [
      { unit, attribute: 'hitPoints', operation: 'add', amount: 10 },
      { unit, attribute: 'attack', armorClass: unit === 'longbowman' ? 3 : 4, operation: 'add', amount },
      { unit, attribute: 'speed', operation: 'multiply', amount: 1.5 },
      { unit, attribute: 'range', operation: 'add', amount: 1 },
      { unit, attribute: 'lineOfSight', operation: 'add', amount: 2 },
    ]);
    for (const [key, techId, amount] of [['before', 9001, index ? 3 : 1], ['after', 9002, 11]] as const) {
      rules.technologies[key] = { techId, name: key, researchSeconds: 0.1,
        cost: { food: 0, wood: 0, gold: 0, stone: 0 }, researchedAt: 'town-center', requiresAge: 0,
        effects: effects(amount) };
    }
    rules.technologies.promote = { techId: 9003, name: 'Fixture promotion',
      researchSeconds: 0.1, cost: { food: 0, wood: 0, gold: 0, stone: 0 },
      researchedAt: 'town-center', requiresAge: 0, effects: [],
      upgrades: [{ from: 'militia', to: 'man-at-arms' }, { from: 'longbowman', to: 'elite-longbowman' }] };
  }
  // The captured unique unit cannot be trained by its recipient.
  root.civilization.unavailable.units.push(8);
  root.civilizations = { donor };
  return root;
}

const sides = { 1: 'open', 2: 'donor' } as const;
const manifestPath = 'public/imported/aoe2/manifest.json';
const imported = existsSync(manifestPath)
  ? rulesFromManifest(JSON.parse(readFileSync(manifestPath, 'utf8')) as ContentManifest) : undefined;
const run = (state: GameState, ticks: number) => { for (let i = 0; i < ticks; i++) stepGame(state); };
function until(state: GameState, done: () => boolean, ticks = 220): void {
  for (let i = 0; i < ticks && !done(); i++) stepGame(state);
  expect(done()).toBe(true);
}
function arena(rules = catalog()): GameState {
  const state = createGame(178, rules, sides);
  state.entities = state.entities.filter(e => e.kind === 'town-center');
  state.terrain.fill(0);
  state.elevation.fill(0);
  return state;
}
function spawn(state: GameState, kind: UnitKind, owner: PlayerId, x = 60.5, y = 50.5): Entity {
  const rules = unitRulesFor(state, owner, kind);
  const entity: Entity = { id: state.nextId++, kind, owner, position: { x, y }, hp: rules.hp,
    maxHp: rules.hp, radius: rules.radius, activity: 'idle', order: { kind: 'idle' } };
  state.entities.push(entity);
  return entity;
}
function command(state: GameState, value: Command): void {
  updateVisibility(state);
  expect(applyCommand(state, value)).toEqual({ ok: true });
}
function research(state: GameState, player: PlayerId, tech: string): void {
  const tc = state.entities.find(e => e.owner === player && e.kind === 'town-center')!;
  command(state, { kind: 'research', player, buildingId: tc.id, tech });
  until(state, () => state.players[player].researched.includes(tech));
}
function convert(state: GameState, monk: Entity, target: Entity): void {
  command(state, { kind: 'order', player: monk.owner as PlayerId, entityIds: [monk.id],
    target: target.position, targetId: target.id });
  expect(monk.order.kind).toBe('convert');
  until(state, () => target.owner === monk.owner);
}

describe('converted unit inheritance (#178)', () => {
  it.skipIf(!imported).each([false, true])('owned Loom preserves captured wounds and excludes later research (donor Loom: %s)', donorLoom => {
    const state = createGame(178, imported!);
    state.entities = state.entities.filter(e => e.kind === 'town-center');
    state.terrain.fill(0); state.elevation.fill(0);
    const loom = (player: PlayerId) => {
      const tc = state.entities.find(e => e.kind === 'town-center' && e.owner === player)!;
      command(state, { kind: 'research', player, buildingId: tc.id, tech: 'loom' });
      until(state, () => state.players[player].researched.includes('loom'), 600);
    };
    if (donorLoom) loom(2);
    const target = spawn(state, 'villager', 2), native = spawn(state, 'villager', 1, 20.5, 20.5);
    target.hp -= 7;
    const hp = target.hp, maxHp = target.maxHp;
    const monk = spawn(state, 'monk', 1, 58.5);
    convert(state, monk, target);
    expect(target).toMatchObject({ hp, maxHp, owner: 1 });
    loom(1);
    expect(native.maxHp).toBe(40);
    expect(target).toMatchObject({ hp, maxHp: donorLoom ? 40 : 25 });
    if (!donorLoom) loom(2);
    expect(target).toMatchObject({ hp, maxHp });
    const attacker = spawn(state, 'militia', 2, target.position.x + 0.8, target.position.y);
    command(state, { kind: 'order', player: 2, entityIds: [attacker.id], target: target.position, targetId: target.id });
    until(state, () => target.hp < hp);
    // Pinned owned Loom grants +1 melee armour, as its imported help states.
    expect(hp - target.hp).toBe(donorLoom ? 3 : 4);
  });

  it.each(['militia', 'longbowman'] as const)('retains donor wounds, damage, armour, speed, sight and range: %s', kind => {
    const state = arena();
    research(state, 1, 'before');
    research(state, 2, 'before');
    const target = spawn(state, kind, 2);
    target.hp -= 7; // wounded scenario input; conversion must neither heal nor rescale it
    const monk = spawn(state, 'monk', 1, 58.5);
    convert(state, monk, target);
    expect(target).toMatchObject({ hp: 83, maxHp: 90, owner: 1, kind });
    if (kind === 'longbowman') {
      const castle: Entity = { ...state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!,
        id: state.nextId++, kind: 'castle', position: { x: 20.5, y: 20.5 } };
      state.entities.push(castle);
      expect(applyCommand(state, { kind: 'train', player: 1, buildingId: castle.id, unit: kind }))
        .toMatchObject({ ok: false, reason: expect.stringContaining('do not have') });
    }
    // Beyond recipient sight, within donor sight, recomputed by the real fog pass.
    expect(state.visibility[1].visible[50 * state.width + 69]).toBe(1);
    const start = { ...target.position };
    command(state, { kind: 'order', player: 1, entityIds: [target.id], target: { x: start.x + 10, y: start.y } });
    run(state, 20);
    // The first waypoint/overlap separation can consume part of a tick. This
    // 0.05-tile tolerance still distinguishes donor 3 from recipient 0.6.
    expect(Math.hypot(target.position.x - start.x, target.position.y - start.y)).toBeCloseTo(3, 1);

    const victim = spawn(state, 'villager', 2, target.position.x + (kind === 'longbowman' ? 7 : 0.8), target.position.y);
    victim.hp = victim.maxHp = 1000;
    // Idle villagers do not auto-acquire enemies: a stationary damage dummy.
    const atShot = { ...target.position };
    command(state, { kind: 'order', player: 1, entityIds: [target.id], target: victim.position, targetId: victim.id });
    until(state, () => victim.hp < 1000);
    expect(1000 - victim.hp).toBe(17); // donor 20+3 minus donor armour 6
    if (kind === 'longbowman') expect(target.position).toEqual(atShot); // fired at retained range

    const attacker = spawn(state, 'longbowman', 2, target.position.x + 4, target.position.y - 4);
    command(state, { kind: 'stop', player: 1, entityIds: [target.id] });
    const hp = target.hp;
    command(state, { kind: 'order', player: 2, entityIds: [attacker.id], target: target.position, targetId: target.id });
    until(state, () => target.hp < hp);
    expect(hp - target.hp).toBe(17); // captured armour is donor armour, not recipient zero
  });

  it.each(['militia', 'longbowman'] as const)('excludes captures from both sides’ future stats and promotions, even after reconversion: %s', kind => {
    const state = arena();
    research(state, 2, 'before');
    const target = spawn(state, kind, 2), native = spawn(state, kind, 1, 20.5, 20.5);
    const donorNative = spawn(state, kind, 2, 95.5, 20.5);
    const monk = spawn(state, 'monk', 1, 58.5);
    convert(state, monk, target);
    const frozen = structuredClone(unitRulesForEntity(state, target));
    const hp = target.hp;
    for (const player of [1, 2] as const) {
      research(state, player, 'after');
      research(state, player, 'promote');
    }
    expect(native.kind).toBe(kind === 'militia' ? 'man-at-arms' : 'elite-longbowman');
    expect(donorNative.kind).toBe(native.kind);
    expect(target.kind).toBe(kind);
    expect(target.hp).toBe(hp);
    expect(unitRulesForEntity(state, target)).toEqual(frozen);
    const otherMonk = spawn(state, 'monk', 2, target.position.x + 2, target.position.y);
    convert(state, otherMonk, target);
    expect(unitRulesForEntity(state, target)).toEqual(frozen);
    expect(target.kind).toBe(kind);
    // Actual movement still reads the locked rules after both research and ownership changes.
    const start = { ...target.position };
    command(state, { kind: 'order', player: 2, entityIds: [target.id], target: { x: start.x, y: start.y + 10 } });
    run(state, 20);
    expect(Math.hypot(target.position.x - start.x, target.position.y - start.y)).toBeCloseTo(3, 5);
    expect(state.rules.units[kind].hp).toBe(40);
    expect(rulesForPlayer(state, 2).units[kind].hp).toBe(80);
  });

  it('locks boarded passengers too, persists through JSON saves and unloads with retained stats', () => {
    const state = arena();
    research(state, 2, 'before');
    const ram = spawn(state, 'battering-ram', 2), passenger = spawn(state, 'militia', 2, 61.3);
    command(state, { kind: 'order', player: 2, entityIds: [passenger.id], target: ram.position, targetId: ram.id });
    expect(passenger.order.kind).toBe('garrison');
    until(state, () => !!ram.garrison?.length);
    const monk = spawn(state, 'monk', 1, 58.5);
    convert(state, monk, ram);
    expect(ram.garrison![0]).toMatchObject({ id: passenger.id, owner: 1, hp: 90, maxHp: 90 });
    expect(state.players[1].population).toBe(3); // monk, ram, passenger
    expect(state.players[2].population).toBe(0);
    const resumed = JSON.parse(JSON.stringify(state)) as GameState;
    for (const match of [state, resumed]) {
      research(match, 1, 'after');
      research(match, 1, 'promote');
      command(match, { kind: 'ungarrison', player: 1, buildingId: ram.id });
      const released = match.entities.find(e => e.id === passenger.id)!;
      expect(released).toMatchObject({ kind: 'militia', owner: 1, hp: 90, maxHp: 90 });
      expect(released.convertedRules).toBeDefined();
      const start = { ...released.position };
      command(match, { kind: 'order', player: 1, entityIds: [released.id], target: { x: start.x, y: start.y + 10 } });
      run(match, 20);
      expect(Math.hypot(released.position.x - start.x, released.position.y - start.y)).toBeCloseTo(3, 1);
    }
    expect(JSON.parse(JSON.stringify(resumed))).toEqual(JSON.parse(JSON.stringify(state)));
    expect(synchronizationHash(resumed)).toBe(synchronizationHash(state));
  });

  it('keeps player-level farm resources with the recipient while its captured builder retains unit health', () => {
    const rules = catalog();
    rules.buildings.farm.buildSeconds = 0.1;
    rules.playerAttributes = { farmFoodAmount: 333 };
    rules.civilizations!.donor.playerAttributes = { farmFoodAmount: 999 };
    rules.technologies.after.effects.push({ resource: 'farmFoodAmount', operation: 'add', amount: 111 });
    const state = arena(rules);
    research(state, 2, 'before');
    const worker = spawn(state, 'villager', 2), monk = spawn(state, 'monk', 1, 58.5);
    convert(state, monk, worker);
    research(state, 1, 'after');
    expect(worker).toMatchObject({ hp: 90, maxHp: 90 });
    const target = { x: 64.5, y: 50.5 };
    command(state, { kind: 'build', player: 1, builderIds: [worker.id], building: 'farm', target });
    const farm = state.entities.find(e => e.kind === 'farm')!;
    until(state, () => farm.buildProgress === undefined);
    expect(farm.amount).toBe(444);
    expect(farm.owner).toBe(1);
  });

  it('replays a public training/conversion/research stream with conversion snapshots in its checksums', async () => {
    const rules = catalog();
    // Speed up only reach and training in this protocol fixture so the command
    // recording exercises real conversion without a long march across Arabia.
    Object.assign(rules.units.monk, { trainedAt: 'town-center', age: 0, trainSeconds: 0.1, lineOfSight: 120,
      convert: { minSeconds: 0.1, maxSeconds: 0.2, range: 120 } });
    const strategy: Strategy = { decide({ observation: o }) {
      const tc = o.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
      if (o.time === 0) return [{ kind: 'train', player: 1, buildingId: tc.id, unit: 'monk' }];
      const monk = o.entities.find(e => e.owner === 1 && e.kind === 'monk');
      const enemy = o.entities.find(e => e.owner === 2 && e.kind === 'villager');
      if (monk && enemy && o.time < 2) return [{ kind: 'order', player: 1,
        entityIds: [monk.id], targetId: enemy.id, target: { x: enemy.x, y: enemy.y } }];
      if (!o.researched.includes('after') && !tc.researching) return [{ kind: 'research', player: 1, buildingId: tc.id, tech: 'after' }];
      return [];
    } };
    const { record, result } = await runMatch({ version: 1, seed: 178, civilizations: sides,
      maxTimeSeconds: 5, decideIntervalSeconds: TICK_SECONDS * 5 }, { 1: strategy, 2: { decide: () => [] } }, rules);
    expect(result.rejectedCommands).toEqual([]);
    let captures = 0;
    expect(replayRecord(JSON.parse(JSON.stringify(record)), rules, state => {
      captures = Math.max(captures, state.entities.filter(e => e.convertedRules).length);
    }).ok).toBe(true);
    expect(captures).toBeGreaterThan(0);
  });
});
