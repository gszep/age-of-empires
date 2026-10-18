import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { applyCommand, createGame, stepGame } from './game';
import { FALLBACK_RULES, rulesFromManifest, type GameRules } from './data';
import { createReplayGame } from './replay';
import { canonicalSnapshot, checksumState } from './checksum';
import { synchronizationHash } from '../shared/checksum';
import { replayRecord, runMatch } from '../headless/runner';
import { MATCH_FORMAT_VERSION, type MatchConfig } from '../protocol/types';
import { validateMatchConfig, validateMatchRecord, validateMatchResult } from '../protocol/validate';
import { validRecordedMode } from '../match-setup';
import type { Entity, GameState } from './types';

// Transcribed pinned Gaia unit594 fields, not an imported asset. The deliberately
// different radius/LOS test below checks that the adapter really consumes them.
const sheepSource = { id: 594, category: 'animal', class: 58, hitPoints: 7,
  collision: [0.3, 0.3] as [number, number], lineOfSight: 3,
  speedTilesPerSecond: 0.7, storage: { food: 100 } };
const importedFixture = rulesFromManifest({ entities: { sheep: sheepSource } });
// A worker may read a coordinator's existing publication, never regenerate or
// copy it. A supplied missing path fails loudly; ordinary public runs skip owned.
const ownedPath = process.env.AOE2_HERD_TEST_MANIFEST ?? 'public/imported/aoe2/manifest.json';
const owned = process.env.AOE2_HERD_TEST_MANIFEST || existsSync(ownedPath)
  ? rulesFromManifest(JSON.parse(readFileSync(ownedPath, 'utf8'))) : undefined;
const openSides = { 1: 'open', 2: 'open' };

function fixture(rules = FALLBACK_RULES, legacy = false) {
  const state = legacy ? createReplayGame({ version: 10, seed: 330,
    civilizations: { 1: rules.civilization.key, 2: rules.civilization.key } }, rules) : createGame(330, rules);
  const v1 = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
  const v2 = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
  state.entities = state.entities.filter(e => e.kind === 'town-center' || e === v1 || e === v2);
  state.terrain.fill(0); state.elevation.fill(0);
  v1.position = { x: 40, y: 50 }; v2.position = { x: 60, y: 50 };
  const r = rules.units.sheep;
  const sheep: Entity = { id: state.nextId++, kind: 'sheep', owner: 0, hp: r.hp, maxHp: r.hp,
    radius: r.radius, position: { x: 50, y: 50 }, resourceKind: 'food', amount: r.foodAmount,
    order: { kind: 'idle' }, activity: 'idle' };
  state.entities.push(sheep);
  return { state, sheep, v1, v2 };
}
function run(state: GameState, ticks: number) {
  for (let i = 0; i < ticks; i++) stepGame(state);
}
function near(villager: Entity, sheep: Entity, distance: number) {
  villager.position = { x: sheep.position.x + (villager.owner === 1 ? -distance : distance), y: sheep.position.y };
}

function outcomes(rules: GameRules) {
  it('uses source LOS3 and radius0.3 for the inferred 3.3-tile threshold', () => {
    expect(rules.units.sheep.lineOfSight).toBe(3);
    expect(rules.units.sheep.radius).toBeCloseTo(0.3);
    expect(rules.units.sheep.lineOfSight + rules.units.sheep.radius).toBeCloseTo(3.3);
  });

  it.each([false, true])('same-tick tie goes to P1 regardless of entity order (reversed=%s)', reversed => {
    const { state, sheep, v1, v2 } = fixture(rules);
    near(v1, sheep, 3.25); near(v2, sheep, 3.25);
    if (reversed) state.entities.reverse();
    stepGame(state);
    expect(state.tick).toBe(1);
    expect(sheep.owner).toBe(1);
  });

  it('same-tick slot priority does not become nearest-unit priority', () => {
    const { state, sheep, v1, v2 } = fixture(rules);
    near(v1, sheep, 3.25); near(v2, sheep, 1);
    state.entities.reverse();
    stepGame(state);
    expect(sheep.owner).toBe(1);
  });

  it.each([1, 2] as const)('earlier P%s claim survives a later nearer rival and JSON restoration', first => {
    const { state, sheep, v1, v2 } = fixture(rules);
    // Inside both Gaia capture and legacy owned-herd defense range. The Gaia
    // boundary is tested separately; ownership must not extend defense range.
    near(first === 1 ? v1 : v2, sheep, 2);
    stepGame(state); // Do not widen to five ticks: consecutive arrivals must differ.
    expect(state.tick).toBe(1);
    expect(sheep.owner).toBe(first);
    const restored: GameState = JSON.parse(JSON.stringify(state));
    for (const s of [state, restored]) {
      const rival = s.entities.find(e => e.id === (first === 1 ? v2.id : v1.id))!;
      const herd = s.entities.find(e => e.id === sheep.id)!;
      near(rival, herd, 1);
      run(s, 5);
      expect(herd.owner).toBe(first);
      expect(applyCommand(s, { kind: 'order', player: first, entityIds: [herd.id],
        target: { x: 50, y: 51 } }).ok).toBe(true);
      stepGame(s);
      expect(herd.order.kind).toBe('move');
    }
    expect(checksumState(restored)).toBe(checksumState(state));
    expect(synchronizationHash(restored)).toBe(synchronizationHash(state));
  });

  it.each([[3.25, 1], [3.5, 0]] as const)('distance %s gives owner %s', (distance, owner) => {
    const { state, sheep, v1 } = fixture(rules);
    near(v1, sheep, distance);
    run(state, 10);
    expect(sheep.owner).toBe(owner);
    expect(v1.position.x).toBe(50 - distance);
    expect(sheep.position).toEqual({ x: 50, y: 50 });
  });

  it.each([2, 2.5, 3, 3.25, 3.5])('owned sheep at distance %s retains legacy stealing range/cadence', distance => {
    for (const defended of [false, true]) {
      const current = fixture(rules), legacy = fixture(rules, true);
      for (const { state, sheep, v1, v2 } of [current, legacy]) {
        sheep.owner = 2;
        near(v1, sheep, distance);
        if (defended) near(v2, sheep, 2);
        // P2's unit precedes P1's: owned contested rejection must not turn
        // into slot-priority arbitration, in either entity order.
        state.entities.reverse();
      }
      for (let tick = 1; tick <= 10; tick++) {
        stepGame(current.state); stepGame(legacy.state);
        const expected = !defended && distance <= rules.units.sheep.herdRange! && tick >= 5 ? 1 : 2;
        expect(current.sheep.owner, `tick ${tick}, defended=${defended}`).toBe(expected);
        expect(legacy.sheep.owner).toBe(expected);
        const { herdClaimVersion, settlementReseedVersion, ...dynamic } = JSON.parse(canonicalSnapshot(current.state));
        expect(herdClaimVersion).toBe(1);
        expect(settlementReseedVersion).toBe(1);
        expect(dynamic).toEqual(JSON.parse(canonicalSnapshot(legacy.state)));
      }
    }
  });

  it('legacy contested rejection has a positive control at the original cadence', () => {
    const { state, sheep, v1, v2 } = fixture(rules, true);
    expect(state).not.toHaveProperty('herdClaimVersion');
    near(v1, sheep, 2); near(v2, sheep, 2);
    run(state, 5);
    expect(sheep.owner).toBe(0);
    near(v2, sheep, 10);
    run(state, 4);
    expect(sheep.owner).toBe(0);
    stepGame(state);
    expect(sheep.owner).toBe(1);
    near(v1, sheep, 10); near(v2, sheep, 2);
    run(state, 5);
    expect(sheep.owner).toBe(2);
  });

  it('legacy range remains herdRange, with no radius addition', () => {
    const { state, sheep, v1 } = fixture(rules, true);
    near(v1, sheep, 3.25); run(state, 5);
    expect(sheep.owner).toBe(0);
    near(v1, sheep, rules.units.sheep.herdRange!); run(state, 5);
    expect(sheep.owner).toBe(1);
  });
}

describe('herd claims (#330), fallback', () => outcomes(FALLBACK_RULES));
describe('herd claims (#330), manifest adapter', () => outcomes(importedFixture));
describe.skipIf(!owned)('herd claims (#330), owned publication', () => outcomes(owned!));

describe('herd claim source and replay gates', () => {
  it('consumes manifest LOS and collision, not hard-coded fallback numbers', () => {
    const rules = rulesFromManifest({ entities: { sheep: { ...sheepSource,
      lineOfSight: 2, collision: [0.4, 0.4] } } });
    expect(rules.units.sheep.radius).toBe(0.4);
    for (const [distance, owner] of [[2.39, 1], [2.41, 0]] as const) {
      const { state, sheep, v1 } = fixture(rules);
      near(v1, sheep, distance); stepGame(state);
      expect(sheep.owner).toBe(owner);
    }
  });

  it('omits the marker for every historical format and retains it through current snapshots', () => {
    for (let version = 1; version < 11; version++) {
      expect(createReplayGame({ version: version as MatchConfig['version'], seed: 330, civilizations: openSides }))
        .not.toHaveProperty('herdClaimVersion');
    }
    const state = createReplayGame({ version: 11, seed: 330, civilizations: openSides });
    expect(state.herdClaimVersion).toBe(1);
    const restored: GameState = JSON.parse(JSON.stringify(state));
    expect(restored.herdClaimVersion).toBe(1);
    delete restored.herdClaimVersion;
    expect(checksumState(restored)).not.toBe(checksumState(state));
    expect(synchronizationHash(restored)).not.toBe(synchronizationHash(state));
  });

  // Measured from git archive a2e69f1, not regenerated from this implementation.
  it.each([
    ['arabia', '0e73b321', '896b035d'],
    ['islands', '2304950d', '84c77ea2'],
  ])('v10 %s preserves initial and continued base checksums', (map, initial, continued) => {
    const state = createReplayGame({ version: 10, seed: 330, map, mode: 'random-map', civilizations: openSides });
    expect(checksumState(state)).toBe(initial);
    const restored: GameState = JSON.parse(JSON.stringify(state));
    for (const s of [state, restored]) {
      run(s, 100);
      expect(checksumState(s)).toBe(continued);
    }
  });

  it('accepts launch formats 10/11, writes current, validates and replays across JSON', async () => {
    expect(MATCH_FORMAT_VERSION).toBeGreaterThanOrEqual(11);
    const idle = { decide: () => [] };
    for (const version of [10, 11] as const) {
      expect(validRecordedMode(version, 'random-map')).toBe(true);
      expect(validateMatchConfig({ version, seed: 330 })).toBe(true);
      const { record, result } = await runMatch({ version, seed: 330, maxTimeSeconds: 5 }, { 1: idle, 2: idle });
      expect(record.version).toBe(MATCH_FORMAT_VERSION); expect(result.version).toBe(MATCH_FORMAT_VERSION);
      const wire = JSON.parse(JSON.stringify(record));
      expect(validateMatchRecord(wire)).toBe(true);
      expect(validateMatchResult(result)).toBe(true);
      expect(replayRecord(wire)).toEqual({ ok: true, checked: record.checksums.length });
      expect(replayRecord({ ...wire, version: 10 }).ok).toBe(false);
    }
    expect(validateMatchConfig({ version: MATCH_FORMAT_VERSION + 1, seed: 330 })).toBe(false);
    expect(validRecordedMode(MATCH_FORMAT_VERSION + 1, 'random-map')).toBe(false);
  });
});
