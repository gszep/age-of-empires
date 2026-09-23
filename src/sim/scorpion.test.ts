import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, rulesFromManifest, type GameRules } from './data';
import { applyCommand, createGame, stepGame } from './game';
import { checksumState } from './checksum';
import { validateCommand, validateObservation } from '../protocol/validate';
import { observe } from './observe';
import type { Entity, GameState, UnitKind } from './types';

const imported = existsSync('public/imported/aoe2/manifest.json')
  ? rulesFromManifest(JSON.parse(readFileSync('public/imported/aoe2/manifest.json', 'utf8'))) : undefined;
function spawn(state: GameState, kind: UnitKind, owner: 1 | 2, x: number, y: number): Entity {
  const rule = state.rules.units[kind];
  const unit: Entity = { id: state.nextId++, kind, owner, position: { x, y }, hp: rule.hp, maxHp: rule.hp,
    radius: rule.radius, activity: 'idle', order: { kind: 'idle' } };
  state.entities.push(unit);
  return unit;
}
const run = (state: GameState, ticks: number) => { for (let i = 0; i < ticks; i++) stepGame(state); };
function arena(rules: GameRules): GameState {
  const state = createGame(127, rules);
  state.entities = state.entities.filter(e => e.owner !== 0);
  state.terrain.fill(0);
  state.elevation.fill(0); // isolate bolt/armour rules from generated hill bonuses
  return state;
}

describe('scorpion bolts', () => {
  for (const [name, rules] of [['fallback', FALLBACK_RULES], ['imported', imported]] as const) {
    it.skipIf(!rules)(`${name}: crosses multiple enemies once, keeps flying past its target, and spares allies`, () => {
      const state = arena(rules!);
      const shooter = spawn(state, 'scorpion', 1, 30, 30);
      const target = spawn(state, 'villager', 2, 34, 30);
      const inFront = spawn(state, 'villager', 2, 32.5, 30);
      const beyond = spawn(state, 'villager', 2, 38, 30);
      const ally = spawn(state, 'villager', 1, 36.5, 30);
      const beside = spawn(state, 'villager', 2, 34, 31);
      const tooFar = spawn(state, 'villager', 2, 42, 30);
      stepGame(state); // authoritative visibility sees the fixture
      expect(applyCommand(state, { kind: 'order', player: 1, entityIds: [shooter.id], target: target.position, targetId: target.id }).ok).toBe(true);
      for (let i = 0; i < 100 && !state.projectiles.length; i++) stepGame(state);
      expect(state.projectiles).toHaveLength(1);
      expect(state.projectiles[0].aim).toEqual({ x: 40, y: 30 });
      expect(state.projectiles[0].art).toBe('scorpion-bolt');
      // A launched bolt survives its shooter, with no later attack to hide a double hit.
      expect(applyCommand(state, { kind: 'delete', player: 1, entityIds: [shooter.id] }).ok).toBe(true);
      const resumed = JSON.parse(JSON.stringify(state)) as GameState;
      run(state, 50); run(resumed, 50);
      expect(target.maxHp - target.hp).toBe(11);
      expect(inFront.maxHp - inFront.hp).toBe(5);
      expect(beyond.maxHp - beyond.hp).toBe(5);
      for (const safe of [ally, beside, tooFar]) expect(safe.hp).toBe(safe.maxHp);
      expect(state.projectiles).toHaveLength(0);
      expect(checksumState(resumed)).toBe(checksumState(state));
    });
  }

  it.skipIf(!imported)('research replaces live, active and waiting scorpions and strengthens collateral damage', () => {
    const state = arena(imported!);
    const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const workshop: Entity = { ...home, id: state.nextId++, kind: 'siege-workshop', position: { x: 45, y: 50 } };
    state.entities.push(workshop);
    const player = state.players[1];
    player.food = player.wood = player.gold = 10_000;
    player.age = 1;
    const train = { kind: 'train', player: 1, buildingId: workshop.id, unit: 'scorpion' } as const;
    expect(validateCommand(train)).toBe(true);
    expect(applyCommand(state, train).ok).toBe(false);
    player.age = 2;
    expect(applyCommand(state, train).ok).toBe(true);
    run(state, 600);
    const scorpion = state.entities.find(e => e.kind === 'scorpion')!;
    expect(scorpion).toBeDefined();
    const research = { kind: 'research', player: 1, buildingId: workshop.id, tech: 'heavy-scorpion' } as const;
    expect(applyCommand(state, research).ok).toBe(false);
    player.age = 3;
    expect(applyCommand(state, { ...train, unit: 'heavy-scorpion' }).ok).toBe(false);
    scorpion.hp -= 7;
    workshop.training = { kind: 'scorpion', remainingTicks: 2000 };
    workshop.trainingQueue = ['scorpion'];
    expect(applyCommand(state, research).ok).toBe(true);
    run(state, imported!.technologies['heavy-scorpion'].researchSeconds * 20);
    expect(scorpion.kind).toBe('heavy-scorpion');
    expect(scorpion.hp).toBe(53);
    expect(workshop.training?.kind).toBe('heavy-scorpion');
    expect(workshop.trainingQueue).toEqual(['heavy-scorpion']);
    expect(applyCommand(state, train).ok).toBe(false);
    // Public cancellation frees the fixture's occupied queue slots.
    applyCommand(state, { kind: 'cancel-train', player: 1, buildingId: workshop.id });
    applyCommand(state, { kind: 'cancel-train', player: 1, buildingId: workshop.id });
    player.populationCap += 5;
    expect(applyCommand(state, { ...train, unit: 'heavy-scorpion' }).ok).toBe(true);
    expect(validateObservation(observe(state, 1))).toBe(true);
    scorpion.position = { x: 30, y: 30 };
    const target = spawn(state, 'villager', 2, 34, 30);
    const behind = spawn(state, 'villager', 2, 37, 30);
    stepGame(state);
    applyCommand(state, { kind: 'order', player: 1, entityIds: [scorpion.id], target: target.position, targetId: target.id });
    for (let i = 0; i < 100 && !state.projectiles.length; i++) stepGame(state);
    expect(state.projectiles).toHaveLength(1);
    applyCommand(state, { kind: 'delete', player: 1, entityIds: [scorpion.id] });
    run(state, 50);
    expect(target.maxHp - target.hp).toBe(14);
    // The heavy bolt's base 6 + technology 239's 4, not a guessed half of 14.
    expect(behind.maxHp - behind.hp).toBe(10);
  });
});
