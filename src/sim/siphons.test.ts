import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rulesFromManifest } from './data';
import { activateAutomaticTechnologies, applyCommand, createGame, stepGame } from './game';
import { checksumState } from './checksum';
import { observe } from './observe';
import { addRelic } from './relics';
import type { Entity, GameState, UnitKind } from './types';

const path = 'public/imported/aoe2/manifest.json';
const owned = existsSync(path) ? rulesFromManifest(JSON.parse(readFileSync(path, 'utf8'))) : undefined;
function fixture() {
  const s = createGame(909, structuredClone(owned!));
  s.entities = s.entities.filter(e => e.kind === 'town-center');
  s.terrain = s.terrain.map(() => 0); s.elevation.fill(0);
  for (let y = 30; y < 60; y++) for (let x = 30; x < 60; x++) s.terrain[y * s.width + x] = 1;
  Object.assign(s.players[1], { age: 3, food: 10000, wood: 10000, gold: 10000, stone: 10000 });
  const r = s.rules.buildings.university;
  const university: Entity = { id: s.nextId++, kind: 'university', owner: 1, position: { x: 25, y: 25 },
    hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
  s.entities.push(university); activateAutomaticTechnologies(s);
  const unit = (kind: UnitKind, owner: 1 | 2, x: number, y: number) => {
    const rule = s.rules.units[kind];
    const e: Entity = { id: s.nextId++, kind, owner, position: { x, y }, hp: 10000, maxHp: 10000,
      radius: rule.radius, order: { kind: 'idle' }, activity: 'idle' }; s.entities.push(e); return e;
  };
  return { s, university, unit };
}
const run = (s: GameState, n: number) => { for (let i = 0; i < n; i++) stepGame(s); };

describe.skipIf(!owned)('owned Siphons outcomes', () => {
  it('research enables one extra explosive shot, damages a bystander and replays flight/impact/recharge through JSON', () => {
    const { s, university, unit } = fixture();
    const entry = Object.entries(s.rules.technologies).find(([, t]) => t.techId === 909);
    expect(entry, 'Siphons must be offered by the published Briton profile').toBeDefined();
    const [key, tech] = entry!;
    const ship = unit('fire-ship', 1, 40, 40);
    const target = unit('galley', 2, 43, 40), nearby = unit('galley', 2, 43, 40.8);
    const relic = addRelic(s, { x: 43, y: 40.5 });
    expect(applyCommand(s, { kind: 'research', player: 1, buildingId: university.id, tech: key })).toEqual({ ok: true });
    run(s, tech.researchSeconds * 20 + 1);
    expect(s.players[1].researched).toContain(key);
    expect(applyCommand(s, { kind: 'order', player: 1, entityIds: [ship.id], target: target.position, targetId: target.id }).ok).toBe(true);
    for (let i = 0; i < 100 && !s.projectiles.some(p => p.art === 'fire-charge'); i++) stepGame(s);
    expect(s.projectiles.filter(p => p.art === 'fire-charge')).toHaveLength(1);
    expect(ship.charge).toBeLessThan(.01);
    expect(observe(s, 1).entities.find(e => e.id === ship.id)?.charge?.maximum).toBe(1);
    applyCommand(s, { kind: 'stop', player: 1, entityIds: [ship.id] });
    const copy = JSON.parse(JSON.stringify(s)) as GameState;
    run(s, 25); run(copy, 25);
    expect(nearby.hp).toBeLessThan(nearby.maxHp);
    expect(relic.hp).toBe(relic.maxHp); expect(relic.dead).not.toBe(true);
    expect(s.projectiles.some(p => p.impact?.effect === 'impact_grenade')).toBe(true);
    expect(checksumState(copy)).toBe(checksumState(s));
    run(s, 475); run(copy, 475);
    expect(ship.charge).toBe(1); expect(checksumState(copy)).toBe(checksumState(s));
    expect(s.projectiles.some(p => p.art === 'fire-charge')).toBe(false);
  });

  it('does not grant the unresearched opponent a charge attack', () => {
    const { s, university, unit } = fixture();
    const [key, tech] = Object.entries(s.rules.technologies).find(([, t]) => t.techId === 909)!;
    expect(applyCommand(s, { kind: 'research', player: 1, buildingId: university.id, tech: key })).toEqual({ ok: true });
    run(s, tech.researchSeconds * 20 + 1);
    const ship = unit('fire-ship', 2, 40, 40), target = unit('galley', 1, 42, 40);
    run(s, 1);
    expect(applyCommand(s, { kind: 'order', player: 2, entityIds: [ship.id], target: target.position, targetId: target.id }).ok).toBe(true);
    run(s, 150);
    expect(s.projectiles.some(p => p.art === 'fire-charge')).toBe(false);
    expect(ship.charge).toBeUndefined();
  });
});
