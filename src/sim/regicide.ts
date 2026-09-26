import { isUnit, TICKS_PER_SECOND } from './data';
import { random01, seedFrom } from './random';
import { buildNavGrid } from './nav';
import reference from './refdata/regicide.json';
import type { Command, Entity, GameState, PlayerId, Point, ReadonlyGameState } from './types';

/** Owned localization28408/41112. Exact lifetime/blink cadence are inferred;
 * the inspected owned text only says “a few seconds” and “flashing X”. */
export const TREASON_GOLD = reference.treasonGold;
export const TREASON_TICKS = 10 * TICKS_PER_SECOND;
export const matchOver = (s: Pick<GameState, 'winner' | 'draw'>): boolean => !!s.winner || !!s.draw;

export function livingKings(state: ReadonlyGameState): { id: number; owner: PlayerId; position: Point }[] {
  const kings: { id: number; owner: PlayerId; position: Point }[] = [];
  const walk = (entities: ReadonlyGameState['entities'], carrier?: Point) => {
    for (const e of entities) {
      if (e.dead || e.hp <= 0) continue;
      const position = carrier ?? e.position;
      if (e.kind === 'king' && e.owner !== 0) kings.push({ id: e.id, owner: e.owner, position: { ...position } });
      if (e.garrison?.length) walk(e.garrison, position);
    }
  };
  walk(state.entities); return kings;
}

/** A separate information channel; it does not change fog or reveal passengers. */
export function treasonMarkers(state: ReadonlyGameState, player: PlayerId) {
  if (state.mode !== 'regicide' || (state.treasonUntil?.[player] ?? 0) <= state.tick) return [];
  return livingKings(state).filter(k => k.owner !== player);
}

export function applyTreason(state: GameState, command: Extract<Command, { kind: 'treason' }>) {
  const no = (reason: string) => ({ ok: false as const, reason });
  if (state.mode !== 'regicide') return no('Treason is only available in Regicide');
  const castle = state.entities.find(e => e.id === command.castleId && e.owner === command.player
    && e.kind === 'castle' && !e.dead && e.buildProgress === undefined);
  if (!castle) return no('Treason needs an owned completed castle');
  if (state.players[command.player].gold < TREASON_GOLD) return no('not enough gold');
  state.players[command.player].gold -= TREASON_GOLD;
  (state.treasonUntil ??= {})[command.player] = state.tick + TREASON_TICKS;
  return { ok: true as const };
}

/** Narrow RMS adapter: normal (non-Nomad/non-safe) modern maps and Islands'
 * older GNR_REGICIDECLASSIC branch. Runs before opening resource objects.
 * Custom survey maps explicitly use nearest legal authored placement. Source
 * cliff distances are retained in refdata; there are no cliff entities, and
 * elevation is not treated as a cliff. */
export function placeRegicideStart(state: GameState, map: string, hooks: {
  free(p: Point): boolean;
  castleLegal(p: Point, owner: PlayerId): boolean;
  add(kind: 'king' | 'villager' | 'castle', owner: PlayerId, p: Point): Entity;
}): void {
  const modern = map === 'arabia' || map === 'black-forest', islands = map === 'islands';
  const rng = { seed: seedFrom(state.matchSeed ^ 434) };
  const trees = state.entities.filter(e => e.node === 'tree');
  const grid = buildNavGrid({ ...state, terrain: state.terrain.slice() });
  const box = (a: Point, b: Point) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const centre = { x: state.width / 2, y: state.height / 2 };
  const edgeDistance = (p: Point) => Math.min(p.x, p.y, state.width - p.x, state.height - p.y);
  const sameZone = (p: Point, radius: number) => {
    const zone = state.landIds?.[p.y * state.width + p.x];
    for (const dx of [-radius, 0, radius]) for (const dy of [-radius, 0, radius]) {
      if (state.landIds?.[(p.y + dy) * state.width + p.x + dx] !== zone) return false;
    }
    return true;
  };
  for (const owner of [1, 2] as const) {
    const home = state.entities.find(e => e.kind === 'town-center' && e.owner === owner)!;
    const points: { point: Point; roll: number; d: number }[] = [];
    const margin = modern ? Math.min(reference.modern.king.edge, reference.modern.villager.edge) : 0;
    for (let y = margin; y < state.height - margin; y++) for (let x = margin; x < state.width - margin; x++) {
      const point = { x, y }, i = y * state.width + x;
      if (grid.blocked[i]) continue;
      if ((islands || map === 'black-forest') && state.landIds?.[i] !== owner) continue;
      points.push({ point, roll: random01(rng), d: box(point, home.position) });
    }
    points.sort((a, b) => islands ? a.roll - b.roll : a.d - b.d || a.roll - b.roll);
    const placeWalker = (kind: 'king' | 'villager') => {
      // Islands' base three villagers already exist; the seven extra are at6.
      const near = islands ? kind === 'king' ? reference.islands.kingMinimum : reference.islands.villagerDistance
        : modern ? reference.modern.villagerDistance : 0;
      const far = islands ? kind === 'king' ? reference.islands.kingMaximum : reference.islands.villagerDistance : Infinity;
      const occupied = state.entities.filter(e => isUnit(e.kind) && !e.dead);
      const constraint = reference.modern[kind];
      const p = points.find(c => c.d >= near && c.d <= far && hooks.free(c.point)
        && occupied.every(e => box(e.position, c.point) >= 1)
        && (!modern || (sameZone(c.point, constraint.zone) && edgeDistance(c.point) >= constraint.edge))
        && trees.every(t => box(t.position, c.point) > (modern ? constraint.forest : 0)));
      if (!p) throw new Error(`Regicide ${map}: no legal ${kind} start for player ${owner}`);
      hooks.add(kind, owner, p.point);
    };
    const existing = state.entities.filter(e => e.kind === 'villager' && e.owner === owner).length;
    const villagers = islands ? existing + reference.islands.extraVillagers : reference.modern.villagers;
    for (let i = existing; i < villagers; i++) placeWalker('villager');
    placeWalker('king');
    const castles = [...points];
    castles.sort((a, b) => map === 'black-forest' && reference.blackForestBackward ? edgeDistance(a.point) - edgeDistance(b.point) || a.roll - b.roll
      : modern ? Math.hypot(a.point.x - centre.x, a.point.y - centre.y) - Math.hypot(b.point.x - centre.x, b.point.y - centre.y) || a.roll - b.roll
      : islands ? a.roll - b.roll : a.d - b.d || a.roll - b.roll);
    const castle = castles.find(c => {
        const p = c.point;
        if (modern && Math.hypot(p.x - home.position.x, p.y - home.position.y) > reference.modern.castle.maximumDistance) return false;
        if (islands && box(p, home.position) !== reference.islands.castleDistance) return false;
        if (!hooks.castleLegal(p, owner)) return false;
        if (modern && (edgeDistance(p) < reference.modern.castle.edge || !sameZone(p, reference.modern.castle.zone))) return false;
        if (modern && trees.some(t => box(t.position, p) <= reference.modern.castle.forest)) return false;
        return true;
      });
    if (!castle) throw new Error(`Regicide ${map}: no legal castle start for player ${owner}`);
    hooks.add('castle', owner, castle.point);
  }
}
