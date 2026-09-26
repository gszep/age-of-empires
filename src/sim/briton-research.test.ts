import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rulesFromManifest, type GameRules } from './data';
import { applyCommand, createGame, stepGame } from './game';
import { unitRulesForEntity } from './rules';
import { checksumState } from './checksum';
import type { Entity, GameState, UnitKind } from './types';

const file = 'public/imported/aoe2/manifest.json';
const owned: GameRules | undefined = existsSync(file) ? rulesFromManifest(JSON.parse(readFileSync(file, 'utf8'))) : undefined;
const run = (s: GameState, ticks: number) => { for (let i = 0; i < ticks; i++) stepGame(s); };
function fixture() {
  const rules = structuredClone(owned!);
  rules.units.villager.speed = 0;
  const s = createGame(42, rules);
  s.terrain.fill(0); s.elevation.fill(0);
  s.entities = [];
  for (const owner of [1, 2] as const) {
    s.players[owner].age = 3;
    Object.assign(s.players[owner], { food: 10000, wood: 10000, gold: 10000, stone: 10000 });
    const r = rules.buildings['town-center'];
    s.entities.push({ id: s.nextId++, owner, kind: 'town-center', position: { x: owner === 1 ? 8 : 40, y: 8 },
      hp: r.hp, maxHp: r.hp, radius: r.radius, order: { kind: 'idle' }, activity: 'idle' });
  }
  return s;
}
function unit(s: GameState, kind: UnitKind, owner: 1 | 2, x: number, y: number): Entity {
  const r = s.rules.units[kind];
  const e: Entity = { id: s.nextId++, kind, owner, position: { x, y }, radius: r.radius,
    hp: r.hp, maxHp: r.hp, order: { kind: 'idle' }, activity: 'idle' };
  s.entities.push(e); return e;
}
function research(s: GameState, key: string) {
  const tech = s.rules.technologies[key];
  expect(tech, key).toBeDefined();
  const kind = tech.researchedAt;
  const r = s.rules.buildings[kind];
  const building: Entity = { id: s.nextId++, kind, owner: 1, position: { x: 8, y: 16 },
    hp: r.hp, maxHp: r.hp, radius: r.radius, order: { kind: 'idle' }, activity: 'idle' };
  s.entities.push(building);
  expect(applyCommand(s, { kind: 'research', player: 1, buildingId: building.id, tech: key })).toEqual({ ok: true });
  run(s, Math.ceil(tech.researchSeconds * 20) + 1);
  expect(s.players[1].researched).toContain(key);
}

describe.skipIf(!owned)('Briton research reaches gameplay', () => {
  it('Warwolf makes the existing deployed trebuchet damage a bystander and preserves the shot across JSON', () => {
    const s = fixture();
    const treb = unit(s, 'trebuchet', 1, 20, 20);
    expect(applyCommand(s, { kind: 'pack', player: 1, entityIds: [treb.id], unpacked: true }).ok).toBe(true);
    run(s, 300);
    expect(treb.unpacked).toBe(true);
    research(s, 'warwolf');
    const victim = unit(s, 'villager', 2, 30, 20);
    const bystander = unit(s, 'villager', 2, 30, 20.7);
    expect(applyCommand(s, { kind: 'order', player: 1, entityIds: [treb.id], target: victim.position, targetId: victim.id }).ok).toBe(true);
    for (let i = 0; i < 300 && !s.projectiles.length; i++) stepGame(s);
    expect(s.projectiles.length).toBeGreaterThan(0);
    const copy = JSON.parse(JSON.stringify(s)) as GameState;
    run(s, 100); run(copy, 100);
    expect(bystander.hp).toBeLessThan(bystander.maxHp);
    expect(checksumState(copy)).toBe(checksumState(s));
    expect(owned!.units.trebuchet.unpacked!.blastRadius).toBe(0);
    expect(owned!.units.trebuchet.unpacked!.accuracyPercent).toBe(15);
  });

  it('Siege Engineers reaches the deployed damage and range, without applying packed commands twice', () => {
    const s = fixture();
    research(s, 'siege-engineers');
    const treb = unit(s, 'trebuchet', 1, 20, 20); treb.unpacked = true;
    const target = unit(s, 'villager', 2, 37, 20);
    expect(applyCommand(s, { kind: 'order', player: 1, entityIds: [treb.id], target: target.position, targetId: target.id }).ok).toBe(true);
    for (let i = 0; i < 300 && !s.projectiles.length; i++) stepGame(s);
    expect(s.projectiles).toHaveLength(1);
    expect(s.projectiles[0].attacks.find(a => a.class === 11)?.amount).toBe(300);
    expect(unitRulesForEntity(s, treb).unpacked!.range).toBe(17);
  });

  it('Shipwright shortens real paid ship production and cancellation returns the original price after a discount', () => {
    const s = fixture();
    const r = s.rules.buildings.dock;
    const dock: Entity = { id: s.nextId++, kind: 'dock', owner: 1, position: { x: 20, y: 20 },
      hp: r.hp, maxHp: r.hp, radius: r.radius, order: { kind: 'idle' }, activity: 'idle' };
    s.entities.push(dock);
    for (let y = 16; y < 26; y++) for (let x = 16; x < 26; x++) s.terrain[y * s.width + x] = 1;
    const before = s.players[1].wood;
    for (let i = 0; i < 2; i++) expect(applyCommand(s, { kind: 'train', player: 1, buildingId: dock.id, unit: 'fishing-ship' }).ok).toBe(true);
    // Keep paid production waiting while the university completes its research.
    dock.training!.remainingTicks = 100000;
    research(s, 'shipwright');
    const copy = JSON.parse(JSON.stringify(s)) as GameState;
    for (let i = 0; i < 2; i++) expect(applyCommand(copy, { kind: 'cancel-train', player: 1, buildingId: dock.id }).ok).toBe(true);
    expect(copy.players[1].wood).toBe(before);
    const newDock = copy.entities.find(e => e.id === dock.id)!;
    expect(applyCommand(copy, { kind: 'train', player: 1, buildingId: dock.id, unit: 'fishing-ship' }).ok).toBe(true);
    const ticks = Math.round(s.rules.units['fishing-ship'].trainSeconds * 0.65 * 20);
    expect(newDock.training!.remainingTicks).toBe(ticks);
    run(copy, ticks - 1);
    expect(copy.entities.filter(e => e.kind === 'fishing-ship')).toHaveLength(0);
    run(copy, 1);
    expect(copy.entities.filter(e => e.kind === 'fishing-ship')).toHaveLength(1);
  });
});
