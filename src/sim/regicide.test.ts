import { describe, expect, it } from 'vitest';
import { applyCommand, canGarrison, createGame, stepGame, trainableUnitsAt } from './game';
import { FALLBACK_RULES } from './data';
import { checksumState } from './checksum';
import { useLegacyScore } from './score';
import { useLegacyPacking } from './packing';
import { MATCH_FORMAT_VERSION } from '../protocol/types';
import { livingKings, matchOver, TREASON_TICKS, treasonMarkers } from './regicide';
import { observe } from './observe';
import { updateVisibility } from './visibility';
import { validateCommand, validateMatchConfig, validateMatchRecord, validateMatchResult, validateObservation } from '../protocol/validate';
import { runMatch, replayRecord } from '../headless/runner';
import { SharedMatch } from '../shared/match';
import { validMatchSetup } from '../match-setup';
import type { Entity, GameState, PlayerId, UnitKind } from './types';

const game = (map = 'arabia', seed = 130) => createGame(seed, structuredClone(FALLBACK_RULES), undefined, map, 'regicide');
const king = (s: GameState, p: PlayerId) => s.entities.find(e => e.kind === 'king' && e.owner === p)!;
const castle = (s: GameState, p: PlayerId) => s.entities.find(e => e.kind === 'castle' && e.owner === p)!;
function run(s: GameState, ticks: number) { for (let i = 0; i < ticks; i++) stepGame(s); }
function spawn(s: GameState, kind: UnitKind, owner: PlayerId, x: number, y: number): Entity {
  const r = s.rules.units[kind];
  const e: Entity = { id: s.nextId++, kind, owner, position: { x, y }, hp: r.hp, maxHp: r.hp, radius: r.radius,
    order: { kind: 'idle' }, activity: 'idle' }; s.entities.push(e); updateVisibility(s); return e;
}
function order(s: GameState, a: Entity, b: Entity) {
  updateVisibility(s);
  expect(applyCommand(s, { kind: 'order', player: a.owner as PlayerId, entityIds: [a.id], target: b.position, targetId: b.id }).ok).toBe(true);
}

describe('Regicide starts and mode isolation', () => {
  for (const map of ['arabia', 'black-forest', 'islands']) for (let first = 1; first <= 50; first += 10) {
    it(`${map} seeds ${first}–${first + 9}: ten villagers, King, legal separated Castle and source bands`, () => {
      for (let seed = first; seed < first + 10; seed++) {
        const s = game(map, seed);
        for (const owner of [1, 2] as const) {
          const units = s.entities.filter(e => e.owner === owner && (e.kind === 'villager' || e.kind === 'king'));
          expect(units.filter(e => e.kind === 'villager')).toHaveLength(10);
          expect(units.filter(e => e.kind === 'king')).toHaveLength(1);
          expect(new Set(units.map(e => `${e.position.x}/${e.position.y}`)).size).toBe(11);
          const home = s.entities.find(e => e.owner === owner && e.kind === 'town-center')!, k = king(s, owner), c = castle(s, owner);
          const box = (e: Entity) => Math.max(Math.abs(e.position.x - home.position.x), Math.abs(e.position.y - home.position.y));
          expect(box(k)).toBeGreaterThanOrEqual(map === 'islands' ? 6 : 5);
          if (map === 'islands') { expect(box(k)).toBeLessThanOrEqual(8); expect(box(c)).toBe(10); }
          else {
            expect(Math.hypot(c.position.x - home.position.x, c.position.y - home.position.y)).toBeLessThanOrEqual(13);
            expect(s.entities.filter(e => e.node === 'tree').every(e => Math.max(Math.abs(e.position.x - c.position.x), Math.abs(e.position.y - c.position.y)) > 3)).toBe(true);
            const i = c.position.y * s.width + c.position.x;
            for (const dx of [-4, 0, 4]) for (const dy of [-4, 0, 4]) expect(s.landIds![i + dy * s.width + dx]).toBe(s.landIds![i]);
            if (map === 'black-forest') expect((c.position.x - home.position.x) * (owner === 1 ? -1 : 1)).toBeGreaterThan(0);
            else expect((c.position.x - home.position.x) * (owner === 1 ? 1 : -1)).toBeGreaterThan(0);
          }
          expect(units.every(e => Math.abs(e.position.x - c.position.x) >= c.radius + e.radius || Math.abs(e.position.y - c.position.y) >= c.radius + e.radius)).toBe(true);
          expect(canGarrison(s, k, c)).toBe(true);
          expect(trainableUnitsAt(s, owner, 'castle')).not.toContain('king');
          expect(applyCommand(s, { kind: 'train', player: owner, buildingId: c.id, unit: 'king' }).ok).toBe(false);
        }
        stepGame(s); expect(matchOver(s)).toBe(false);
      }
    });
  }
  it.each(['arabia', 'black-forest', 'islands', 'painted-proof', 'senlac', 'windsor'])('%s preserves seeded starts and JSON continuation', map => {
    const a = game(map), b = game(map);
    expect(livingKings(a)).toHaveLength(2); expect(checksumState(a)).toBe(checksumState(b));
    const copy = JSON.parse(JSON.stringify(a)) as GameState; run(a, 4); run(copy, 4);
    expect(checksumState(copy)).toBe(checksumState(a));
  });
  it('defaults legacy setup to random map and rejects malformed modes instead of reinterpreting them', () => {
    expect(validMatchSetup({ map: 'arabia', seed: 1 })).toBe(true);
    expect(validMatchSetup({ map: 'arabia', seed: 1, mode: 'regicide' })).toBe(true);
    expect(validMatchSetup({ map: 'arabia', seed: 1, mode: 'Regicide' })).toBe(false);
    expect(validateMatchConfig({ version: 1, seed: 1, mode: 'regicide' })).toBe(false);
    expect(validateMatchConfig({ version: 2, seed: 1, mode: 'regicide' })).toBe(true);
    const s = createGame(130);
    expect(s.mode).toBeUndefined(); expect(livingKings(s)).toEqual([]);
    const before = checksumState(s);
    expect(applyCommand(s, { kind: 'treason', player: 1, castleId: 1 }).ok).toBe(false);
    expect(checksumState(s)).toBe(before); expect(observe(s, 1).treason).toBeUndefined();
    const royal = game();
    expect(applyCommand(royal, { kind: 'research', player: 1, buildingId: castle(royal, 1).id, tech: '__proto__' }).ok).toBe(false);
  });
});

describe('King survival and temporary Treason', () => {
  it('garrisons a King, survives a razed castle, and ends on actual unarmed King combat death', () => {
    const s = game(), k = king(s, 1), c = castle(s, 1);
    order(s, k, c);
    for (let i = 0; i < 1000 && !c.garrison?.length; i++) stepGame(s);
    expect(c.garrison?.[0].id).toBe(k.id); expect(s.winner).toBeUndefined();
    expect(livingKings(s).find(e => e.id === k.id)?.position).toEqual(c.position);
    expect(applyCommand(s, { kind: 'delete', player: 1, entityIds: [c.id] }).ok).toBe(true); stepGame(s);
    expect(livingKings(s).some(e => e.id === k.id)).toBe(true); expect(s.winner).toBeUndefined();
    const attacker = spawn(s, 'militia', 2, k.position.x + 0.8, k.position.y);
    attacker.hp = attacker.maxHp = 10000; // survive defensive fire while measuring the royal death
    order(s, k, attacker); expect(k.order.kind).toBe('move');
    applyCommand(s, { kind: 'stop', player: 1, entityIds: [k.id] }); order(s, attacker, k);
    for (let i = 0; i < 1500 && !s.winner; i++) stepGame(s);
    expect(k.dead).toBe(true); expect(s.winner).toBe(2); expect(attacker.hp).toBeGreaterThan(0);
    const before = checksumState(s); run(s, 2); expect(checksumState(s)).toBe(before);
  });
  it('retains nested passengers’ owners through carrier capture, tracks the King and loses it when the ship sinks', () => {
    const s = game(), k = king(s, 1);
    s.terrain = s.terrain.map(() => 0); s.elevation.fill(0);
    for (let y = 30; y < 50; y++) for (let x = 40; x < 60; x++) s.terrain[y * s.width + x] = 1;
    const ship = spawn(s, 'transport-ship', 1, 41.5, 40.5), tower = spawn(s, 'siege-tower', 1, 41.5, 40.5);
    tower.garrison = [k]; ship.garrison = [tower];
    s.entities = s.entities.filter(e => e.id !== k.id && e.id !== tower.id);
    const monk = spawn(s, 'monk', 2, 36.5, 40.5);
    order(s, monk, ship); for (let i = 0; i < 500 && ship.owner !== 2; i++) stepGame(s);
    expect(ship.owner).toBe(2); expect(tower.owner).toBe(1); expect(k.owner).toBe(1);
    expect(s.players[1].population).toBe(13); // ten villagers, scout, King and tower still aboard
    expect(s.players[2].population).toBe(14); // original twelve + monk + captured ship
    expect(livingKings(s).find(e => e.id === k.id)?.position).toEqual(ship.position);
    s.players[2].gold = 800;
    expect(applyCommand(s, { kind: 'treason', player: 2, castleId: castle(s, 2).id }).ok).toBe(true);
    expect(treasonMarkers(s, 2).find(e => e.id === k.id)?.position).toEqual(ship.position);
    expect(applyCommand(s, { kind: 'delete', player: 2, entityIds: [ship.id] }).ok).toBe(true); stepGame(s);
    expect(s.winner).toBe(2);
    expect(s.players[1].population).toBe(11); expect(s.players[2].population).toBe(13);
  });
  it('refuses direct conversion, pays per use without a research journal or fog reveal, expires and continues through JSON', () => {
    const s = game(), target = king(s, 2), monk = spawn(s, 'monk', 1, target.position.x - 2, target.position.y);
    order(s, monk, target); expect(monk.order.kind).toBe('move');
    // Remove the sight fixture before measuring what Treason alone reveals.
    s.entities = s.entities.filter(e => e.id !== monk.id); updateVisibility(s);
    const visible = [...s.visibility[1].visible]; s.players[1].gold = 900;
    const command = { kind: 'treason' as const, player: 1 as const, castleId: castle(s, 1).id };
    expect(validateCommand(command)).toBe(true);
    const copy = JSON.parse(JSON.stringify(s)) as GameState;
    for (const state of [s, copy]) {
      expect(applyCommand(state, command)).toEqual({ ok: true }); run(state, 40);
      expect(applyCommand(state, command)).toEqual({ ok: true });
      expect(state.players[1].gold).toBe(100);
      expect(state.players[1].researched).not.toContain('treason'); expect(state.players[1].researched).not.toContain('spies');
      expect(castle(state, 1).researching).toBeUndefined();
      expect(state.treasonUntil?.[1]).toBe(state.tick + TREASON_TICKS);
      expect([...state.visibility[1].visible]).toEqual(visible);
      expect(observe(state, 1).treason?.kings).toHaveLength(1);
      expect(observe(state, 2).treason?.kings).toHaveLength(0);
      expect(validateObservation(observe(state, 1))).toBe(true);
      const before = checksumState(state);
      expect(applyCommand(state, command).ok).toBe(false); expect(checksumState(state)).toBe(before);
      expect(applyCommand(state, { kind: 'research', player: 1, buildingId: command.castleId, tech: 'spies' }).ok).toBe(false);
      run(state, TREASON_TICKS); expect(treasonMarkers(state, 1)).toEqual([]);
    }
    expect(checksumState(copy)).toBe(checksumState(s));
  });
  it('records simultaneous royal loss as a draw through headless replay and preserves mode on shared restart', async () => {
    const suicide = { decide: ({ observation }: Parameters<import('../headless/runner').Strategy['decide']>[0]) =>
      [{ kind: 'delete' as const, player: observation.player, entityIds: observation.entities.filter(e => e.owner === observation.player && e.kind === 'king').map(e => e.id) }] };
    const { record, result } = await runMatch({ version: 2, seed: 130, mode: 'regicide', maxTimeSeconds: 1 }, { 1: suicide, 2: suicide });
    expect(result.draw).toBe(true); expect(result.winner).toBeUndefined(); expect(result.timeSeconds).toBe(0.05);
    expect(record.mode).toBe('regicide'); expect(record.version).toBe(MATCH_FORMAT_VERSION);
    expect(validateMatchRecord(record)).toBe(true); expect(validateMatchResult(result)).toBe(true);
    expect(replayRecord(JSON.parse(JSON.stringify(record))).ok).toBe(true);
    expect(validateMatchRecord({ ...record, version: 1 })).toBe(false);
    expect(replayRecord({ ...record, version: 1 }).ok).toBe(false);
    const host = new SharedMatch(game()); host.restart(131, 'islands');
    expect(host.state.mode).toBe('regicide'); expect(host.snapshot()).toMatchObject({ setup: { mode: 'regicide' } });
    const kings = livingKings(host.state); host.humanTwo = true;
    for (const k of kings) host.enqueue(k.owner, { kind: 'delete', player: k.owner, entityIds: [k.id] }, () => { throw new Error('unexpected rejection'); });
    host.advance(); expect(host.state.draw).toBe(true); expect(observe(host.state, 1).draw).toBe(true);
  });
  it('continues legacy v1 random-map recordings while v2 requires an explicit validated mode', async () => {
    const { record } = await runMatch({ version: 1, seed: 42, maxTimeSeconds: 5 }, { 1: { decide: () => [] }, 2: { decide: () => [] } });
    const { mode, ...legacy } = record;
    legacy.version = 1;
    const { mode: resultMode, ...legacyResult } = record.result;
    legacy.result = { ...legacyResult, version: 1 };
    // A v3 recording cannot be made legacy by relabelling its checksum: the
    // new research-rule marker is authoritative state. Rebuild the v1 fixture.
    const legacyState = createGame(42, undefined, undefined, 'arabia', undefined, undefined, undefined, 0);
    useLegacyScore(legacyState);
    useLegacyPacking(legacyState);
    delete legacyState.researchQueueVersion;
    legacy.checksums = record.checksums.map(({ tick }) => {
      while (legacyState.tick < tick) stepGame(legacyState);
      return { tick, hash: checksumState(legacyState) };
    });
    expect(validateMatchRecord(legacy)).toBe(true); expect(replayRecord(legacy).ok).toBe(true);
    expect(validateMatchRecord({ ...legacy, version: 2 })).toBe(false);
    expect(replayRecord({ ...legacy, version: 2 }).ok).toBe(false);
    expect(validateMatchRecord({ ...record, mode: 'not-a-mode' })).toBe(false);
  });
});
