import { describe, it, expect, vi } from 'vitest';
import { detectEffectTriggers, type ViewSnapshot } from './effect-triggers';
import { applyCommand, createGame, stepGame } from '../sim/game';
import { synchronizationHash } from '../shared/checksum';
import type { Entity, GameState } from '../sim/types';
import type { ImportedEntity } from './assets';

const art = { spawnEffect: 'spawn', researchingEffect: 'glow', researchCompleteEffect: 'complete', constructionEffect: 'dust' } as ImportedEntity;
const data = (visible = true) => (_e: Entity) => ({ imported: art, visible });
function fixture() {
  const game = createGame(49);
  const building = game.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
  const unit = game.entities.find(e => e.kind === 'villager' && e.owner === 1)!;
  expect(building).toBeDefined(); expect(unit).toBeDefined();
  // Keep an opponent alive: otherwise the first tick ends the match.
  const enemy = game.entities.find(e => e.kind === 'town-center' && e.owner === 2)!;
  expect(enemy).toBeDefined();
  game.entities = [building, unit, enemy];
  return { game, building, unit };
}
const poll = (game: GameState, previous?: ViewSnapshot, visible = true) => detectEffectTriggers(game, previous, data(visible));

describe('effect-triggers', () => {
  it('trained unit spawns exactly once even in a tiny population; initial and reset snapshots do not', () => {
    const { game, unit } = fixture();
    const initial = poll(game);
    expect(initial.effects).toEqual([]);
    const trained = { ...unit, id: game.nextId++ };
    game.entities.push(trained);
    const next = poll(game, initial.snapshot);
    expect(next.effects).toEqual([{ name: 'spawn', position: trained.position, type: 'spawn', entityId: trained.id }]);
    expect(poll(game, next.snapshot).effects).toEqual([]);
    expect(poll(game, undefined).effects).toEqual([]);
  });

  it('research completion uses the real public command and simulation research state', () => {
    const { game, building } = fixture();
    game.players[1].gold = 100;
    let prev = poll(game).snapshot;
    expect(prev.researchedByPlayer.get(1)).toEqual(new Set());
    expect(applyCommand(game, { kind: 'research', player: 1, buildingId: building.id, tech: 'loom' }).ok).toBe(true);
    expect(building.researching?.tech).toBe('loom');
    const start = poll(game, prev);
    expect(start.effects.map(e => [e.type, e.name])).toEqual([['start', 'glow']]);
    prev = start.snapshot;
    for (let i = 0; i < 2000 && building.researching; i++) stepGame(game);
    expect(building.researching).toBeUndefined();
    expect(game.players[1].researched).toContain('loom');
    const end = poll(game, prev);
    expect(end.effects.map(e => [e.type, e.name])).toEqual([['stop', 'glow'], ['spawn', 'complete']]);
    expect(poll(game, end.snapshot).effects).toEqual([]);
  });

  it('cancellation stops glow but unrelated research growth cannot manufacture completion', () => {
    const { game, building } = fixture();
    game.players[1].gold = 100;
    expect(applyCommand(game, { kind: 'research', player: 1, buildingId: building.id, tech: 'loom' }).ok).toBe(true);
    const prev = poll(game).snapshot;
    expect(prev.entities.get(building.id)?.researching).toBe('loom');
    expect(applyCommand(game, { kind: 'cancel-research', player: 1, buildingId: building.id }).ok).toBe(true);
    game.players[1].researched.push('feudal-age');
    expect(poll(game, prev).effects.map(e => [e.type, e.name])).toEqual([['stop', 'glow']]);
  });

  it('queued research completes the previous technology without interrupting its glow', () => {
    const { game, building } = fixture();
    building.researching = { tech: 'loom', remainingTicks: 1 };
    const prev = poll(game).snapshot;
    game.players[1].researched.push('loom');
    building.researching = { tech: 'feudal-age', remainingTicks: 100 };
    expect(poll(game, prev).effects.map(e => e.name)).toEqual(['complete']);
  });

  it('foundation dust happens once, not when an old foundation is discovered', () => {
    const { game, building } = fixture();
    let prev = poll(game).snapshot;
    game.entities.push({ ...building, id: game.nextId++, buildProgress: 0 });
    const dust = poll(game, prev);
    expect(dust.effects.map(e => e.name)).toEqual(['dust']);
    expect(poll(game, dust.snapshot).effects).toEqual([]);
    prev = poll(game, undefined, false).snapshot;
    expect(poll(game, prev, true).effects).toEqual([]);
  });

  it('unloading an existing unit is not training a new one; Gaia never trains', () => {
    const { game, unit } = fixture();
    game.entities = game.entities.filter(e => e.id !== unit.id);
    const prev = poll(game).snapshot;
    game.entities.push(unit, { ...unit, id: game.nextId++, owner: 0 });
    expect(poll(game, prev).effects).toEqual([]);
  });

  for (const trigger of ['training', 'research-start', 'research-complete', 'foundation'] as const) {
    it(`${trigger}: hidden enemy is silent; renderer-visible spectator sees the positive path`, () => {
      const { game, building, unit } = fixture();
      building.owner = unit.owner = 2;
      if (trigger === 'research-complete') building.researching = { tech: 'loom', remainingTicks: 1 };
      const hidden = poll(game, undefined, false).snapshot;
      const visible = poll(game).snapshot;
      if (trigger === 'training') game.entities.push({ ...unit, id: game.nextId++ });
      if (trigger === 'foundation') game.entities.push({ ...building, id: game.nextId++, buildProgress: 0 });
      if (trigger === 'research-start') building.researching = { tech: 'loom', remainingTicks: 100 };
      if (trigger === 'research-complete') { building.researching = undefined; game.players[2].researched.push('loom'); }
      const expected = { training: 'spawn', 'research-start': 'glow', 'research-complete': 'complete', foundation: 'dust' }[trigger];
      expect(poll(game, visible).effects.some(e => e.name === expected)).toBe(true);
      expect(poll(game, hidden, false).effects).toEqual([]);
      expect(poll(game, visible, false).snapshot.visibleIds.size).toBe(0);
    });
  }

  it('resumes current research after load/reveal, but not historic spawn/completion', () => {
    const { game, building } = fixture();
    building.researching = { tech: 'loom', remainingTicks: 100 };
    const hidden = poll(game, undefined, false).snapshot;
    expect(poll(game, hidden).effects.map(e => [e.type, e.name])).toEqual([['start', 'glow']]);
    expect(poll(game).effects.map(e => [e.type, e.name])).toEqual([['start', 'glow']]);
    building.dead = true;
    expect(poll(game).effects).toEqual([]);
  });

  it('never mutates the simulation; copies positions and visits each entity only once', () => {
    const { game, unit } = fixture();
    const before = synchronizationHash(game);
    const get = vi.fn(data());
    const { snapshot } = detectEffectTriggers(game, undefined, get);
    expect(get).toHaveBeenCalledTimes(game.entities.length);
    expect(synchronizationHash(game)).toBe(before);
    const position = { ...unit.position };
    unit.position.x++;
    expect(snapshot.entities.get(unit.id)?.position).toEqual(position);
  });
});
