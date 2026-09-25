import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, rulesFromManifest, type ContentManifest } from './data';
import { applyCommand, createGame, stepGame, trainableUnitsAt } from './game';
import { SharedMatch } from '../shared/match';
import { validateCommand, validateObservation } from '../protocol/validate';
import { observe } from './observe';
import { updateVisibility } from './visibility';

it('refuses disabled profile selection before replacing a shared match', () => {
  const rules = structuredClone(FALLBACK_RULES);
  const pending = structuredClone(FALLBACK_RULES);
  pending.civilization = { ...pending.civilization, key: 'pending', enabled: false };
  rules.civilizations = { pending };
  const match = new SharedMatch(createGame(122, rules));
  const previous = match.state;
  expect(() => match.restart(123, 'arabia', { 1: 'open', 2: 'pending' })).toThrow('not loaded');
  expect(match.state).toBe(previous);
});

const contentPath = process.env.CIV_PROFILE_CONTENT ?? 'public/imported/aoe2/manifest.json';
const manifest: ContentManifest | undefined = existsSync(contentPath) ? JSON.parse(readFileSync(contentPath, 'utf8')) : undefined;
describe.skipIf(!manifest?.civilizations?.franks)('owned Briton / Frank roster', () => {
  it.each(['britons', 'franks'])('%s retains public ram and palisade-gate construction through source tree aliases', civ => {
    const rules = rulesFromManifest(manifest!);
    rules.civilizations!.franks.civilization.enabled = true;
    const state = createGame(122, rules, { 1: civ, 2: 'britons' });
    state.entities = state.entities.filter(e => e.owner !== 0);
    state.terrain.fill(0); state.elevation.fill(0);
    Object.assign(state.players[1], { age: 2, wood: 5000, gold: 5000 });
    const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    worker.position = { x: 40, y: 39 };
    const b = (civ === 'franks' ? rules.civilizations!.franks : rules).buildings['siege-workshop'];
    const workshop = { id: state.nextId++, kind: 'siege-workshop' as const, owner: 1 as const,
      position: { x: 30.5, y: 40.5 }, hp: b.hp, maxHp: b.hp, radius: b.radius,
      activity: 'idle' as const, order: { kind: 'idle' as const } };
    state.entities.push(workshop);
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: workshop.id, unit: 'battering-ram' }).ok).toBe(true);
    expect(applyCommand(state, { kind: 'build', player: 1, builderIds: [worker.id], building: 'palisade-gate',
      target: { x: 40, y: 40.5 }, orientation: 'x' }).ok).toBe(true);
    for (let i = 0; i < 900; i++) stepGame(state);
    expect(state.entities.some(e => e.kind === 'battering-ram' && e.owner === 1)).toBe(true);
    const gate = state.entities.find(e => e.kind === 'palisade-gate' && e.owner === 1)!;
    expect(gate).toBeDefined();
    expect(gate.buildProgress).toBeUndefined();
  });

  it('trains and completes an axeman, rejects foreign uniques without payment, and preserves selection', () => {
    const rules = rulesFromManifest(manifest!);
    if (rules.civilizations!.franks.civilization.enabled === false) {
      expect(() => createGame(122, rules, { 1: 'britons', 2: 'franks' })).toThrow('not loaded');
      rules.civilizations!.franks.civilization.enabled = true; // pre-enablement acceptance only
    }
    const state = createGame(122, rules, { 1: 'britons', 2: 'franks' });
    state.entities = state.entities.filter(entity => entity.owner !== 0);
    state.terrain.fill(0); state.elevation.fill(0);
    for (const owner of [1, 2] as const) {
      Object.assign(state.players[owner], { age: 3, wood: 5000, food: 5000, gold: 5000, stone: 5000 });
      const castle = { id: state.nextId++, kind: 'castle' as const, owner,
        position: { x: owner * 25, y: 40 }, hp: 4800, maxHp: 4800, radius: 2,
        activity: 'idle' as const, order: { kind: 'idle' as const } };
      state.entities.push(castle);
      const allowed = trainableUnitsAt(state, owner, 'castle');
      expect(allowed.includes('longbowman')).toBe(owner === 1);
      expect(allowed.includes('dat-unit-281')).toBe(owner === 2);
      const gold = state.players[owner].gold;
      expect(validateCommand({ kind: 'train', player: owner, buildingId: castle.id, unit: 'dat-unit-281' })).toBe(true);
      expect(applyCommand(state, { kind: 'train', player: owner, buildingId: castle.id, unit: 'dat-unit-999999' }).ok).toBe(false);
      expect(applyCommand(state, { kind: 'train', player: owner, buildingId: castle.id,
        unit: owner === 1 ? 'dat-unit-281' : 'longbowman' }).ok).toBe(false);
      expect(state.players[owner].gold).toBe(gold);
      if (owner === 2) expect(applyCommand(state, { kind: 'train', player: owner, buildingId: castle.id,
        unit: 'dat-unit-281' }).ok).toBe(true);
    }
    for (let i = 0; i < 300; i++) stepGame(state);
    const axeman = state.entities.find(entity => entity.owner === 2 && entity.kind === 'dat-unit-281')!;
    expect(axeman).toBeDefined();
    const target = state.entities.find(entity => entity.owner === 1 && entity.kind === 'villager')!;
    axeman.position = { x: 58, y: 60 }; target.position = { x: 60, y: 60 };
    updateVisibility(state);
    const hp = target.hp;
    expect(applyCommand(state, { kind: 'order', player: 2, entityIds: [axeman.id], targetId: target.id,
      target: target.position }).ok).toBe(true);
    for (let i = 0; i < 100; i++) stepGame(state);
    expect(target.hp).toBeLessThan(hp);
    expect(validateObservation(observe(state, 2))).toBe(true);
    const match = new SharedMatch(JSON.parse(JSON.stringify(state)));
    match.restart(123, 'arabia');
    expect(match.state.players[2].civilization).toBe('franks');
  });
});
