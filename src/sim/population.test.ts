import { describe, expect, it } from 'vitest';
import { createGame, applyCommand, stepGame } from './game';
import { FALLBACK_RULES, TICK_SECONDS } from './data';
import { checksumState } from './checksum';
import { populationLimitFor } from './rules';
import { validPopulationLimit } from './population';
import { runMatch, replayRecord } from '../headless/runner';
import { validateMatchConfig, validateMatchRecord } from '../protocol/validate';
import { validMatchSetup } from '../match-setup';

describe('match population ceiling', () => {
  it('holds paid production at the chosen ceiling despite houses, then releases exactly one unit after a loss and JSON resume', () => {
    const state = createGame(253, FALLBACK_RULES, undefined, 'arabia', 'random-map', 25);
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    // Supplied actors/housing isolate the cap; only public commands drive production/loss.
    for (let i = 0; i < 21; i++) state.entities.push({ ...structuredClone(worker), id: state.nextId++, position: { x: 50+i%7, y: 50+Math.floor(i/7) } });
    for (let i = 0; i < 6; i++) state.entities.push({ ...structuredClone(tc), id: state.nextId++, kind: 'house',
      position: { x: 70+i*3, y: 80 }, hp: FALLBACK_RULES.buildings.house.hp, maxHp: FALLBACK_RULES.buildings.house.hp });
    const excess = { ...structuredClone(worker), id: state.nextId++ };
    state.entities.push(excess);
    expect(applyCommand(state, { kind: 'delete', player: 1, entityIds: [excess.id] }).ok).toBe(true);
    expect(state.players[1].population).toBe(25);
    expect(state.players[1].populationCap).toBe(25);
    const food = state.players[1].food;
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: tc.id, unit: 'villager' }).ok).toBe(true);
    for (let i = 0; i <= FALLBACK_RULES.units.villager.trainSeconds / TICK_SECONDS; i++) stepGame(state);
    expect(tc.training?.remainingTicks).toBe(0);
    expect(state.players[1].population).toBe(25);
    expect(state.players[1].food).toBe(food - FALLBACK_RULES.units.villager.cost.food!);
    const saved = JSON.parse(JSON.stringify(state));
    const loss = { kind: 'delete', player: 1, entityIds: [worker.id] } as const;
    for (const s of [state, saved]) {
      expect(applyCommand(s, { ...loss, entityIds: [...loss.entityIds] }).ok).toBe(true);
      stepGame(s);
    }
    expect(tc.training).toBeUndefined();
    expect(state.players[1].population).toBe(25);
    expect(checksumState(saved)).toBe(checksumState(state));
  });

  it('does not provide housing or mutate per-civilisation rules, and preserves an omitted legacy ceiling', () => {
    const rules = structuredClone(FALLBACK_RULES);
    const original = JSON.stringify(rules);
    const state = createGame(253, rules, undefined, 'arabia', 'random-map', 500);
    expect(populationLimitFor(state, 1)).toBe(500);
    expect(state.players[1].populationCap).toBe(createGame(253, rules).players[1].populationCap);
    expect(JSON.stringify(rules)).toBe(original);
    delete rules.populationLimit;
    const legacy = createGame(253, rules);
    expect(legacy).not.toHaveProperty('populationLimit');
    expect(populationLimitFor(legacy, 1)).toBe(Infinity);
  });

  it('rejects invalid ceilings consistently before a match is created', () => {
    for (const value of [0, -25, 26, 275, 350, 501, 25.5, NaN, Infinity, null, '25']) {
      expect(validPopulationLimit(value)).toBe(false);
      expect(validMatchSetup({ map: 'arabia', seed: 253, populationLimit: value })).toBe(false);
      expect(validateMatchConfig({ version: 2, seed: 253, populationLimit: value })).toBe(false);
      expect(() => createGame(253, FALLBACK_RULES, undefined, 'arabia', 'random-map', value as number)).toThrow('population limit');
    }
    expect(validateMatchConfig({ version: 1, seed: 253, populationLimit: 25 })).toBe(false);
  });

  it('records the explicit ceiling and reproduces it through the JSON replay format; old omissions keep their checksum', async () => {
    const idle = { decide: () => [] };
    for (const populationLimit of [undefined, 25, 500]) {
      const { record } = await runMatch({ version: 2, seed: 253, maxTimeSeconds: 5, populationLimit }, { 1: idle, 2: idle });
      const wire = JSON.parse(JSON.stringify(record));
      expect(validateMatchRecord(wire)).toBe(true);
      expect(wire.populationLimit).toBe(populationLimit);
      expect(replayRecord(wire)).toMatchObject({ ok: true, checked: 1 });
      if (populationLimit === undefined) expect(wire).not.toHaveProperty('populationLimit');
      else {
        delete wire.populationLimit;
        expect(replayRecord(wire).ok).toBe(false);
      }
    }
  });
});
