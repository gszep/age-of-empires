import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rulesFromManifest, TICKS_PER_SECOND } from './data';
import { activateAutomaticTechnologies, addNode, applyCommand, createGame, stepGame } from './game';
import { buildingRulesFor, unitRulesFor } from './rules';
import { updateVisibility } from './visibility';
import { synchronizationHash } from '../shared/checksum';
import { replayRecord, runMatch, type Strategy } from '../headless/runner';
import type { BuildingKind, Entity, GameState, PlayerId, UnitKind } from './types';

const path = process.env.CIV_PROFILE_CONTENT ?? 'public/imported/aoe2/manifest.json';
const rules = existsSync(path) ? rulesFromManifest(JSON.parse(readFileSync(path, 'utf8'))) : undefined;
if (process.env.CIV_PROFILE_CONTENT && !rules?.civilizations?.vikings) throw new Error('fixture lacks Vikings');
function arena(age = 2, water = false) {
  const s = createGame(189, rules!, { 1: 'vikings', 2: 'britons' });
  s.entities = s.entities.filter(e => e.kind === 'town-center');
  s.entities.forEach((e, i) => e.position = { x: 10 + i * 80, y: 10 });
  s.terrain.fill(water ? 23 : 0); s.elevation.fill(0);
  for (const owner of [1, 2] as const) Object.assign(s.players[owner], { age, food: 30000, wood: 30000, gold: 30000, stone: 30000 });
  activateAutomaticTechnologies(s); return s;
}
function home(s: GameState, kind: BuildingKind, owner: PlayerId = 1, x = 20, y = 20) {
  const r = buildingRulesFor(s, owner, kind), e: Entity = { id: s.nextId++, kind, owner, position: { x, y },
    hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
  s.entities.push(e); activateAutomaticTechnologies(s); return e;
}
function unit(s: GameState, kind: UnitKind, owner: PlayerId = 1, x = 50, y = 50) {
  const r = unitRulesFor(s, owner, kind), e: Entity = { id: s.nextId++, kind, owner, position: { x, y },
    hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
  s.entities.push(e); return e;
}
function until(s: GameState, done: () => boolean, ticks = 8000) {
  for (let i = 0; i < ticks && !done(); i++) stepGame(s);
  expect(done()).toBe(true);
}
function order(s: GameState, actor: Entity, target: Entity) {
  updateVisibility(s);
  expect(applyCommand(s, { kind: 'order', player: actor.owner as PlayerId, entityIds: [actor.id], targetId: target.id, target: target.position }).ok).toBe(true);
}
function research(s: GameState, building: Entity, tech: string) {
  expect(applyCommand(s, { kind: 'research', player: building.owner as PlayerId, buildingId: building.id, tech }), tech).toEqual({ ok: true });
  until(s, () => s.players[building.owner as PlayerId].researched.includes(tech));
}
function train(s: GameState, building: Entity, kind: UnitKind) {
  const first = s.nextId;
  expect(applyCommand(s, { kind: 'train', player: building.owner as PlayerId, buildingId: building.id, unit: kind }), kind).toEqual({ ok: true });
  until(s, () => s.entities.some(e => e.id >= first && e.owner === building.owner && e.kind === kind));
  return s.entities.find(e => e.id >= first && e.owner === building.owner && e.kind === kind)!;
}

describe.skipIf(!rules?.civilizations?.vikings)('owned Vikings gameplay', () => {
  it('banks the larger age-gated villager load, without granting it to the opponent', () => {
    // DAT capacity multipliers1.2695/1.5 produce12.695/19.0425.
    // The shared integer-gather loop returns when it reaches that threshold.
    for (const [age, capacity] of [[0, 10], [1, 13], [2, 20]] as const) {
      const s = arena(age);
      for (const owner of [1, 2] as const) {
        const x = owner === 1 ? 30 : 70;
        home(s, 'mill', owner, x, 30);
        const worker = unit(s, 'villager', owner, x, 36), bush = addNode(s, 'berries', { x, y: 37 });
        const before = s.players[owner].food; order(s, worker, bush);
        until(s, () => s.players[owner].food > before, 2400);
        expect(s.players[owner].food - before).toBe(owner === 1 ? capacity : 10);
        applyCommand(s, { kind: 'stop', player: owner, entityIds: [worker.id] });
      }
    }
  });

  it('regenerates inside a garrison as well as outside, with no healing for dead or ordinary infantry', () => {
    const s = arena(), castle = home(s, 'castle');
    const a = train(s, castle, 'dat-unit-692'), b = unit(s, 'militia', 1, 20, 24);
    order(s, a, castle); order(s, b, castle); until(s, () => castle.garrison?.length === 2);
    a.hp = b.hp = 1; a.gatherProgress = b.gatherProgress = 0;
    const dead = unit(s, 'dat-unit-692', 1, 50, 50); dead.hp = 0;
    for (let i = 0; i < 3 * TICKS_PER_SECOND; i++) stepGame(s);
    expect(a.hp).toBeCloseTo(3); expect(b.hp).toBe(1); expect(dead.hp).toBe(0);
    expect(applyCommand(s, { kind: 'ungarrison', player: 1, buildingId: castle.id }).ok).toBe(true);
    for (let i = 0; i < 3 * TICKS_PER_SECOND; i++) stepGame(s);
    expect(a.hp).toBeCloseTo(5); expect(b.hp).toBe(1);
  });

  it('age research grants 20% infantry HP from Feudal, including garrison, without repeating or leaking', () => {
    const s = arena(0);
    const sides = ([1, 2] as const).map(owner => {
      const x = owner === 1 ? 20 : 80, tc = s.entities.find(e => e.owner === owner && e.kind === 'town-center')!;
      const barracks = home(s, 'barracks', owner, x, 20);
      home(s, 'mill', owner, x, 30); home(s, 'lumber-camp', owner, x, 40);
      const old = train(s, barracks, 'militia'), inside = unit(s, 'militia', owner, x, 23);
      old.hp -= 7; order(s, inside, tc); until(s, () => !!tc.garrison?.length);
      expect(old.maxHp).toBe(40);
      return { owner, x, tc, barracks, old, inside };
    });
    for (const [index, tech] of ['feudal-age', 'castle-age', 'imperial-age'].entries()) {
      for (const { owner, x, tc } of sides) {
        if (index === 1) { home(s, 'market', owner, x, 50); home(s, 'blacksmith', owner, x, 60); }
        if (index === 2) home(s, 'castle', owner, x, 70);
        research(s, tc, tech);
      }
      expect(s.players[1].age).toBe(index + 1); expect(s.players[2].age).toBe(index + 1);
      for (const { owner, tc, barracks, old, inside } of sides) {
        const hp = owner === 1 ? 48 : 40;
        expect(old.maxHp).toBe(hp); expect(old.hp).toBe(hp - 7);
        expect(tc.garrison!.find(e => e.id === inside.id)!.maxHp).toBe(hp);
        expect(train(s, barracks, 'militia').maxHp).toBe(hp);
      }
    }
  });

  it('free Wheelbarrow/Hand Cart activate at their ages and actually move villagers faster, without spending', () => {
    const s = arena(0);
    for (const owner of [1, 2] as const) {
      const x = owner === 1 ? 20 : 90;
      home(s, 'mill', owner, x, 20); home(s, 'lumber-camp', owner, x, 30);
      home(s, 'market', owner, x, 40); home(s, 'blacksmith', owner, x, 50);
    }
    for (const age of [0, 1, 2]) {
      if (age > 0) for (const owner of [1, 2] as const) {
        const tc = s.entities.find(e => e.owner === owner && e.kind === 'town-center')!;
        const tech = age === 1 ? 'feudal-age' : 'castle-age', free = age === 1 ? 'wheelbarrow' : 'hand-cart';
        const before = { food: s.players[owner].food, wood: s.players[owner].wood, gold: s.players[owner].gold };
        expect(s.players[owner].researched).not.toContain(free);
        expect(applyCommand(s, { kind: 'research', player: owner, buildingId: tc.id, tech })).toEqual({ ok: true });
        expect(s.players[owner].age).toBe(age - 1);
        expect(s.players[owner].researched).not.toContain(free);
        until(s, () => s.players[owner].researched.includes(tech));
        expect(s.players[owner].age).toBe(age);
        expect(before.food - s.players[owner].food).toBe(age === 1 ? 500 : 800);
        expect(before.gold - s.players[owner].gold).toBe(age === 1 ? 0 : 200);
        expect(s.players[owner].wood).toBe(before.wood);
        expect(s.players[owner].researched.includes(free)).toBe(owner === 1);
      }
      const a = unit(s, 'villager', 1, 40, 40), b = unit(s, 'villager', 2, 70, 70);
      expect(s.players[1].researched.includes('wheelbarrow')).toBe(age >= 1);
      expect(s.players[1].researched.includes('hand-cart')).toBe(age >= 2);
      expect(s.players[2].researched).not.toContain('wheelbarrow');
      expect(s.players[2].researched).not.toContain('hand-cart');
      for (const [e, x, y] of [[a, 55, 40], [b, 85, 70]] as const) {
        expect(applyCommand(s, { kind: 'order', player: e.owner as PlayerId, entityIds: [e.id], target: { x, y } }).ok).toBe(true);
      }
      for (let i = 0; i < 20; i++) stepGame(s);
      expect((a.position.x - 40) / (b.position.x - 70)).toBeCloseTo(1.1 ** age, 3);
      for (const e of [a, b]) expect(applyCommand(s, { kind: 'delete', player: e.owner as PlayerId, entityIds: [e.id] }).ok).toBe(true);
    }
  });

  it('charges age-gated DAT warship discounts and refunds them exactly, not discounted fishing boats', () => {
    for (const age of [1, 2, 3]) {
      const s = arena(age, true), dock = home(s, 'dock'), other = home(s, 'dock', 2, 80, 80);
      for (const [building, factor] of [[dock, .9 * .94117 ** (age - 1)], [other, 1]] as const) {
        const owner = building.owner as PlayerId;
        for (const [kind, wood, gold] of [['galley', 90, 30], ['dat-unit-250', 100, 50], ['fishing-ship', 75, 0]] as const) {
          const before = { wood: s.players[owner].wood, gold: s.players[owner].gold };
          const result = applyCommand(s, { kind: 'train', player: owner, buildingId: building.id, unit: kind });
          if (kind === 'dat-unit-250' && (age < 2 || owner === 2)) {
            expect(result.ok).toBe(false);
          } else {
            expect(result).toEqual({ ok: true });
            const discount = kind === 'fishing-ship' ? 1 : factor;
            expect(before.wood - s.players[owner].wood).toBe(Math.round(wood * discount));
            expect(before.gold - s.players[owner].gold).toBe(Math.round(gold * discount));
            expect(applyCommand(s, { kind: 'cancel-train', player: owner, buildingId: building.id }).ok).toBe(true);
          }
          expect(s.players[owner].wood).toBe(before.wood); expect(s.players[owner].gold).toBe(before.gold);
        }
      }
    }
  });

  it('pays the Dock team discount through build commands, not on enemy docks', () => {
    const s = arena(0);
    s.terrain.fill(2); // The DAT dock row admits beach, not grass.
    for (let y = 0; y < s.height; y++) for (let x = 45; x < s.width; x++) s.terrain[y * s.width + x] = 23;
    for (const [owner, y, cost] of [[1, 40, 128], [2, 80, 150]] as const) {
      const worker = unit(s, 'villager', owner, 43, y), before = s.players[owner].wood;
      expect(applyCommand(s, { kind: 'build', player: owner, builderIds: [worker.id], building: 'dock', target: { x: 45, y } }).ok).toBe(true);
      expect(before - s.players[owner].wood).toBe(cost);
    }
  });

  it('trains, regenerates, promotes and converts Berserks; healing survives JSON reload and clamps', () => {
    const s = arena(3), castle = home(s, 'castle'), a = train(s, castle, 'dat-unit-692');
    a.position = { x: 50, y: 50 }; a.hp = 1;
    for (let i = 0; i < 3 * TICKS_PER_SECOND; i++) stepGame(s);
    expect(a.hp).toBeCloseTo(3);
    research(s, castle, 'elite-berserk'); expect(a.kind).toBe('dat-unit-694');
    const foreign = home(s, 'castle', 2, 80, 80);
    expect(applyCommand(s, { kind: 'train', player: 2, buildingId: foreign.id, unit: 'dat-unit-692' }).ok).toBe(false);
    const monk = unit(s, 'monk', 2, 57, 50); monk.hp = monk.maxHp = 10000;
    order(s, monk, a); until(s, () => a.owner === 2, 500);
    expect(a.convertedRules?.regenerationPerMinute).toBe(40);
    a.hp = a.maxHp - 1;
    const saved = JSON.parse(JSON.stringify(s));
    for (let i = 0; i < 60; i++) { stepGame(s); stepGame(saved); }
    expect(a.hp).toBe(a.maxHp); expect(synchronizationHash(s)).toBe(synchronizationHash(saved));
  });

  it('Chieftains increases cavalry damage and awards the XS amounts only on infantry kills', () => {
    const s = arena(), castle = home(s, 'castle');
    const noLoot = (kind: UnitKind) => {
      const a = unit(s, kind, 1, 50, 50), b = unit(s, 'villager', 2, 50.5, 50); b.hp = 1; b.attackCooldown = 100000;
      const gold = s.players[1].gold; order(s, a, b); until(s, () => !!b.dead, 100);
      expect(s.players[1].gold).toBe(gold);
      expect(applyCommand(s, { kind: 'delete', player: 1, entityIds: [a.id] }).ok).toBe(true);
    };
    noLoot('militia'); // Eligible killer and victim, but Chieftains is not researched.
    const hit = () => {
      const a = unit(s, 'militia', 1, 50, 50), b = unit(s, 'knight', 2, 50.5, 50); b.attackCooldown = 100000;
      order(s, a, b); until(s, () => b.hp < b.maxHp, 100);
      const damage = b.maxHp - b.hp;
      applyCommand(s, { kind: 'delete', player: 1, entityIds: [a.id] });
      applyCommand(s, { kind: 'delete', player: 2, entityIds: [b.id] }); return damage;
    };
    const before = hit(); research(s, castle, 'chieftains'); expect(hit() - before).toBe(5);
    noLoot('knight'); // Same researched player and victim, but not an infantry killer.
    for (const [victim, reward] of [['villager', 5], ['monk', 20], ['trade-cart', 0], ['militia', 0]] as const) {
      const a = unit(s, 'militia', 1, 50, 50), b = unit(s, victim, 2, 50.5, 50); b.hp = 1; b.attackCooldown = 100000;
      const gold = s.players[1].gold; order(s, a, b);
      const saved: GameState = JSON.parse(JSON.stringify(s));
      for (let i = 0; i < 100 && !b.dead; i++) { stepGame(s); stepGame(saved); }
      expect(b.dead).toBe(true); expect(saved.entities.find(e => e.id === b.id)!.dead).toBe(true);
      expect(s.players[1].gold - gold, victim).toBe(reward);
      expect(saved.players[1].gold - gold, victim).toBe(reward);
      expect(synchronizationHash(s)).toBe(synchronizationHash(saved));
      applyCommand(s, { kind: 'delete', player: 1, entityIds: [a.id] });
    }
    const a = unit(s, 'militia', 2, 70, 70), b = unit(s, 'villager', 1, 70.5, 70); b.hp = 1;
    const gold = s.players[2].gold; order(s, a, b); until(s, () => !!b.dead, 100); expect(s.players[2].gold).toBe(gold);
  });

  it('Longboat fires four real shots, upgrades at the Dock, and Bogsveigar improves landed damage', () => {
    const s = arena(3, true), dock = home(s, 'dock'), castle = home(s, 'castle', 1, 25, 20);
    const a = train(s, dock, 'dat-unit-250'); a.position = { x: 50, y: 50 };
    const shoot = () => {
      const b = unit(s, 'transport-ship', 2, 54, 50); b.hp = b.maxHp = 10000;
      a.attackCooldown = 0; order(s, a, b);
      until(s, () => s.projectiles.some(p => p.shooterId === a.id), 100);
      expect(s.projectiles.filter(p => p.shooterId === a.id)).toHaveLength(4);
      expect(applyCommand(s, { kind: 'stop', player: 1, entityIds: [a.id] }).ok).toBe(true);
      const saved: GameState = JSON.parse(JSON.stringify(s));
      expect(saved.projectiles.filter(p => p.shooterId === a.id)).toHaveLength(4);
      for (let i = 0; i < 100 && s.projectiles.some(p => p.shooterId === a.id); i++) { stepGame(s); stepGame(saved); }
      expect(s.projectiles.some(p => p.shooterId === a.id)).toBe(false);
      const damage = b.maxHp - b.hp;
      expect(damage).toBeGreaterThan(0);
      expect(saved.entities.find(e => e.id === b.id)!.hp).toBe(b.hp);
      expect(synchronizationHash(s)).toBe(synchronizationHash(saved));
      applyCommand(s, { kind: 'delete', player: 2, entityIds: [b.id] }); return damage;
    };
    const before = shoot(); research(s, castle, 'bogsveigar'); expect(shoot() - before).toBe(4);
    research(s, dock, 'elite-longboat'); expect(a.kind).toBe('dat-unit-533');
    expect(train(s, dock, 'dat-unit-533').maxHp).toBe(130);
  });

  it('mixed opening replays deterministically without rejected commands', async () => {
    const player: Strategy = { decide({ observation: o }) {
      if (o.time !== 0) return [];
      const tc = o.entities.find(e => e.owner === o.player && e.kind === 'town-center')!;
      return [{ kind: 'train', player: o.player, buildingId: tc.id, unit: 'villager' }];
    } };
    const { record, result } = await runMatch({ version: 1, seed: 189, civilizations: { 1: 'vikings', 2: 'britons' },
      maxTimeSeconds: 10, decideIntervalSeconds: 1 }, { 1: player, 2: player }, rules!);
    expect(result.rejectedCommands).toEqual([]); expect(replayRecord(JSON.parse(JSON.stringify(record)), rules!).ok).toBe(true);
  });
});
