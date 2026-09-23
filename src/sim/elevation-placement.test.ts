import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checksumState } from './checksum';
import { FALLBACK_RULES, rulesFromManifest, type ContentManifest, type GameRules } from './data';
import { applyCommand, buildingFootprint, createGame, placementLegal, stepGame } from './game';
import { MAPS } from './mapgen';
import type { Command, GameState } from './types';

const manifest: ContentManifest | undefined = existsSync('public/imported/aoe2/manifest.json')
  ? JSON.parse(readFileSync('public/imported/aoe2/manifest.json', 'utf8')) : undefined;
const imported = manifest && rulesFromManifest(manifest);

function arena(rules: GameRules) {
  const state = createGame(176, rules);
  state.entities = state.entities.filter(e => e.owner !== 0);
  state.terrain.fill(0);
  state.elevation.fill(4);
  state.players[1].age = 3;
  state.players[1].wood = state.players[1].stone = 5000;
  return state;
}
const at = { x: 40, y: 40 };
function paint(state: GameState, field: (x: number, y: number) => number) {
  for (let y = 35; y < 46; y++) for (let x = 35; x < 46; x++) {
    state.elevation[y * state.width + x] = field(x, y);
  }
}

for (const [label, rules] of [['fallback', FALLBACK_RULES], ['imported', imported]] as const) {
  describe.skipIf(!rules)(`${label} building elevation`, () => {
    it('rejects a sloped town-center footprint but accepts a raised plateau', () => {
      const state = arena(rules!);
      expect(placementLegal(state, 'town-center', at).ok).toBe(true);
      paint(state, x => x < 40 ? 4 : 5);
      expect(placementLegal(state, 'town-center', at)).toEqual({ ok: false, reason: 'placement is on unsuitable elevation' });
      // An interior hollow must not be hidden by four equal corners.
      paint(state, () => 4);
      state.elevation[39 * state.width + 39] = 3;
      expect(placementLegal(state, 'town-center', at).ok).toBe(false);
    });

    it.each(['barracks', 'mill', 'lumber-camp', 'mining-camp', 'castle'] as const)(
      '%s allows one-level ramps and corners but not two-level footprints', kind => {
        const state = arena(rules!);
        paint(state, x => x < 40 ? 4 : 5);
        expect(placementLegal(state, kind, at).ok).toBe(true);
        paint(state, (x, y) => x < 40 && y < 40 ? 5 : 4);
        expect(placementLegal(state, kind, at).ok).toBe(true);
        paint(state, x => x < 40 ? 4 : 6);
        expect(placementLegal(state, kind, at).ok).toBe(false);
      });

    it.each(['house', 'farm', 'watch-tower', 'palisade-wall', 'palisade-gate'] as const)(
      '%s retains its unrestricted hill mode', kind => {
        const state = arena(rules!);
        paint(state, (x, y) => (x + y) % 3 * 3);
        for (const orientation of ['x', 'y'] as const) {
          expect(placementLegal(state, kind, at, orientation).ok).toBe(true);
        }
      });

    it('rejects without spending or retasking, then actually completes a legal ramp building', () => {
      const state = arena(rules!);
      const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
      worker.position = { x: 42.5, y: 40.5 };
      const target = { x: 40.5, y: 40.5 };
      const command: Command = { kind: 'build', player: 1, builderIds: [worker.id], building: 'barracks', target };
      paint(state, x => x < 40 ? 4 : 6);
      const before = checksumState(state);
      expect(applyCommand(state, command).ok).toBe(false);
      expect(checksumState(state)).toBe(before);
      paint(state, x => x < 40 ? 4 : 5);
      const elevation = [...state.elevation];
      expect(applyCommand(state, command).ok).toBe(true);
      const site = state.entities.find(e => e.kind === 'barracks')!;
      expect(site.buildProgress).toBe(0);
      for (let i = 0; i < 2000 && site.buildProgress !== undefined; i++) stepGame(state);
      expect(site.buildProgress).toBeUndefined();
      expect(site.hp).toBe(site.maxHp);
      expect(state.elevation).toEqual(elevation); // construction never terraforms
    });
  });
}

it.skipIf(!manifest)('imports the mode itself, including an explicit unrestricted override', () => {
  expect(manifest!.entities['town-center'].hillMode).toBe(2);
  expect(imported!.buildings.barracks.hillMode).toBe(3);
  const alternate = structuredClone(manifest!);
  alternate.entities.barracks.hillMode = 0;
  const state = arena(rulesFromManifest(alternate));
  paint(state, x => x);
  expect(placementLegal(state, 'barracks', at).ok).toBe(true);
  delete alternate.entities.barracks.hillMode;
  state.rules = rulesFromManifest(alternate);
  expect(placementLegal(state, 'barracks', at).ok).toBe(false); // old manifest fallback
});

it('uses the rotated half-open footprint, retains fractional survey relief, and accepts old flat snapshots', () => {
  const state = arena(structuredClone(FALLBACK_RULES));
  state.rules.buildings['palisade-gate'].hillMode = 2;
  state.elevation[40 * state.width + 39] = 4.01;
  expect(placementLegal(state, 'palisade-gate', { x: 40, y: 40.5 }, 'x').ok).toBe(false);
  expect(placementLegal(state, 'palisade-gate', { x: 40.5, y: 40 }, 'y').ok).toBe(true);
  state.elevation = [];
  expect(placementLegal(state, 'town-center', at).ok).toBe(true);
});

it.each(Object.keys(MAPS))('%s starts both players on level town-center ground without rewriting the survey', map => {
  const source = MAPS[map].baked;
  const original = source?.elevation && [...source.elevation];
  const state = createGame(42, FALLBACK_RULES, undefined, map);
  const homes = state.entities.filter(e => e.kind === 'town-center' && e.owner !== 0);
  const footprint = buildingFootprint(state, 'town-center');
  const outside = state.elevation.every((level, tile) => {
    if (!original) return true;
    const x = tile % state.width, y = Math.floor(tile / state.width);
    const inHome = homes.some(e => Math.abs(x + 0.5 - e.position.x) < footprint.x
      && Math.abs(y + 0.5 - e.position.y) < footprint.y);
    return inHome || level === original[tile];
  });
  expect(outside).toBe(true);
  state.entities = state.entities.filter(e => !homes.includes(e));
  for (const home of homes) expect(placementLegal(state, 'town-center', home.position).ok).toBe(true);
  if (source) expect(source.elevation).toEqual(original);
  expect(createGame(42, FALLBACK_RULES, undefined, map).elevation).toEqual(state.elevation);
});
