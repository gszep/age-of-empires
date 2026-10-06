import { expect, it } from 'vitest';
import { createReplayGame } from './replay';
import { applyCommand, stepGame } from './game';
import { trebuchetReplayRules } from '../headless/trebuchet-replay.fixture';

it.each([1, 2, 3, 4, 5, 6, 7, 8] as const)('browser/headless v%s initialization selects every historical boundary and packed policy', version => {
  const rules = trebuchetReplayRules(), original = JSON.stringify(rules);
  const state = createReplayGame({ version, seed: 131, civilizations: { 1: 'open', 2: 'open' },
    mode: version === 1 ? undefined : 'random-map' }, rules);
  expect(state.researchQueueVersion).toBe(version >= 3 ? 1 : undefined);
  expect(state.scoreVersion).toBe(version >= 4 ? 1 : undefined);
  expect(state.mapgenVersion).toBe(version >= 5 ? 1 : undefined);
  expect(state.packingVersion).toBe(version >= 6 ? 1 : undefined);
  expect(state.siphonsVersion).toBe(version >= 7 ? 1 : undefined);
  expect(state.trebuchetTargetingVersion).toBe(version >= 8 ? 1 : undefined);
  expect(state.rules.units.trebuchet.unpacked!.seconds).toBeCloseTo(version >= 6 ? 50 / 4.5 : 4.5);
  const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
  expect(applyCommand(state, { kind: 'train', player: 1, buildingId: tc.id, unit: 'trebuchet' }).ok).toBe(true);
  for (let i = 0; i < 700; i++) stepGame(state);
  const treb = state.entities.find(e => e.kind === 'trebuchet')!;
  expect(treb.unpacked === true).toBe(version < 8);
  const target = state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!;
  expect(target.hp < target.maxHp).toBe(version < 8);
  expect(JSON.stringify(rules)).toBe(original);
});
