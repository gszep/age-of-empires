import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES } from './data';
import { applyCommand, createGame, stepGame } from './game';
import { marketQuote } from './market';
import { researchCostFor } from './technologies';
import { updateVisibility, isEntityVisible } from './visibility';
import { observe } from './observe';
import { checksumState } from './checksum';
import { validateCommand, validateObservation } from '../protocol/validate';
import type { BuildingKind, Command, Entity, GameState, PlayerId } from './types';

function fixture() {
  const s = createGame(128, structuredClone(FALLBACK_RULES));
  s.entities = s.entities.filter(e => e.kind === 'town-center');
  s.terrain = s.terrain.map(() => 0); s.elevation.fill(0);
  for (const p of [1, 2] as const) Object.assign(s.players[p], { age: 3, food: 10000, wood: 10000, gold: 10000, stone: 10000 });
  const market = building(s, 'market', 1, 20), castle = building(s, 'castle', 1, 25);
  building(s, 'market', 2, 90);
  return { s, market, castle };
}
function building(s: GameState, kind: BuildingKind, owner: PlayerId, x: number) {
  const r = s.rules.buildings[kind];
  const e: Entity = { id: s.nextId++, kind, owner, position: { x, y: 20 }, hp: r.hp, maxHp: r.hp, radius: r.radius,
    activity: 'idle', order: { kind: 'idle' } }; s.entities.push(e); return e;
}
function research(s: GameState, id: number, key: string) {
  expect(applyCommand(s, { kind: 'research', player: 1, buildingId: id, tech: key }).ok).toBe(true);
  for (let i = 0; i <= s.rules.technologies[key].researchSeconds * 20; i++) stepGame(s);
  expect(s.players[1].researched).toContain(key);
}
const exchange = (id: number, side: 'buy' | 'sell', amount: 100 | 500 = 100): Command =>
  ({ kind: 'exchange', player: 1, marketId: id, resource: 'wood', side, amount });

describe('public market transactions', () => {
  it('buys/sells actual stock at shared moving prices, with owner-specific Guilds fees', () => {
    const { s, market } = fixture();
    expect(validateCommand(exchange(market.id, 'buy'))).toBe(true);
    expect(applyCommand(s, exchange(market.id, 'buy')).ok).toBe(true);
    expect(s.players[1].gold).toBe(9870); expect(s.players[1].wood).toBe(10100);
    expect(marketQuote(s, 2, 'wood', 'buy').gold).toBe(134);
    expect(applyCommand(s, exchange(market.id, 'sell')).ok).toBe(true);
    expect(s.players[1].gold).toBe(9942); expect(s.players[1].wood).toBe(10000);
    research(s, market.id, 'guilds');
    expect(marketQuote(s, 1, 'wood', 'buy').gold).toBe(115);
    const gold = s.players[1].gold;
    expect(applyCommand(s, exchange(market.id, 'sell')).ok).toBe(true);
    expect(s.players[1].gold - gold).toBe(85);
    expect(marketQuote(s, 2, 'wood', 'sell').gold).toBe(67);
    expect(validateObservation(observe(s, 1))).toBe(true);
  });

  it('refuses malformed, foreign, unfinished and unaffordable transactions without mutations', () => {
    const { s, market } = fixture();
    s.players[1].gold = 129;
    const invalid = [exchange(market.id, 'buy'), exchange(999, 'sell'),
      { ...exchange(market.id, 'buy'), amount: -100 }, { ...exchange(market.id, 'buy'), side: 'steal' },
      { ...exchange(market.id, 'sell'), resource: 'gold' }, { ...exchange(market.id, 'sell'), player: 2 }];
    for (const command of invalid) {
      const before = checksumState(s);
      expect(applyCommand(s, command as Command).ok).toBe(false); expect(checksumState(s)).toBe(before);
    }
    market.buildProgress = 0.5;
    expect(applyCommand(s, exchange(market.id, 'sell')).ok).toBe(false);
  });

  it('quotes bulk lots sequentially but rejects the whole batch atomically and replays JSON commands', () => {
    const { s, market } = fixture();
    expect(marketQuote(s, 1, 'wood', 'buy', 500).gold).toBe(690);
    s.players[1].gold = 689;
    const before = checksumState(s); expect(applyCommand(s, exchange(market.id, 'buy', 500)).ok).toBe(false);
    expect(checksumState(s)).toBe(before);
    s.players[1].gold = 1000;
    const copy = JSON.parse(JSON.stringify(s)) as GameState;
    for (const command of [exchange(market.id, 'buy', 500), exchange(market.id, 'sell')]) {
      expect(applyCommand(s, command).ok).toBe(true);
      expect(applyCommand(copy, JSON.parse(JSON.stringify(command))).ok).toBe(true);
    }
    expect(checksumState(copy)).toBe(checksumState(s));
  });

  it('Coinage and Banking reduce actual sender tribute deductions, never recipient credit', () => {
    const { s, market } = fixture();
    for (const [tech, fee] of [[undefined, 30], ['coinage', 20], ['banking', 0]] as const) {
      if (tech) research(s, market.id, tech);
      const sender = s.players[1].stone, recipient = s.players[2].stone;
      const command: Command = { kind: 'tribute', player: 1, recipient: 2, resource: 'stone', amount: 100 };
      expect(validateCommand(command)).toBe(true); expect(applyCommand(s, command).ok).toBe(true);
      expect(sender - s.players[1].stone).toBe(100 + fee); expect(s.players[2].stone - recipient).toBe(100);
    }
    for (const change of [{ recipient: 1 }, { amount: NaN }, { amount: 0 }, { amount: 1.5 }, { amount: 1e30 }, { resource: 'water' }]) {
      const before = checksumState(s);
      expect(applyCommand(s, { kind: 'tribute', player: 1, recipient: 2, resource: 'gold', amount: 100, ...change } as Command).ok).toBe(false);
      expect(checksumState(s)).toBe(before);
    }
  });
});

describe('random-map Spies', () => {
  it('quotes hidden and garrisoned villagers, pays once, reveals live enemy sight but not orders or Gaia globally', () => {
    const { s, castle } = fixture();
    const villager = (x: number): Entity => ({ id: s.nextId++, kind: 'villager', owner: 2, position: { x, y: 100 },
      hp: 40, maxHp: 40, radius: .2, activity: 'idle', order: { kind: 'idle' } });
    const outside = villager(100), inside = villager(100);
    const home = s.entities.find(e => e.kind === 'town-center' && e.owner === 2)!;
    home.garrison = [inside]; s.entities.push(outside); updateVisibility(s);
    expect(isEntityVisible(s, 1, outside)).toBe(false);
    expect(researchCostFor(s, 1, 'spies').gold).toBe(400);
    expect(observe(s, 1).researchCosts!.spies.gold).toBe(400);
    const gold = s.players[1].gold; research(s, castle.id, 'spies');
    expect(gold - s.players[1].gold).toBe(400);
    expect(observe(s, 1).researchCosts).not.toHaveProperty('spies');
    expect(isEntityVisible(s, 1, outside)).toBe(true);
    expect(observe(s, 1).entities.find(e => e.id === outside.id)?.order).toBeUndefined();
    expect(s.visibility[1].visible[110 * s.width + 10]).toBe(0);
    const before = checksumState(s);
    expect(applyCommand(s, { kind: 'research', player: 1, buildingId: castle.id, tech: 'spies' }).ok).toBe(false);
    expect(checksumState(s)).toBe(before);
  });

  it('recomputes price at acceptance and charges zero when the enemy has no villagers', () => {
    const { s, castle } = fixture();
    expect(researchCostFor(s, 1, 'spies').gold).toBe(0);
    s.players[1].gold = 0; research(s, castle.id, 'spies'); expect(s.players[1].gold).toBe(0);
  });
});
