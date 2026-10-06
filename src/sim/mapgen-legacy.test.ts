import { expect, it } from 'vitest';
import { createGame, stepGame } from './game';
import { canonicalSnapshot, checksumState } from './checksum';
import { useLegacyPacking } from './packing';
import { useLegacySiphons } from './fire-charge';

// Frozen against git archive 037b7dd2892d376408f93e61c6dbd7a7d7a1533c,
// BEFORE this patch; initial and tick20 hash ALL dynamic state, not just terrain.
// Rules themselves are excluded, but later behavior markers are included.
// Select pre-v6 packing and pre-v7 Siphons for these historical hashes; never regenerate
// them for a new marker. Current matches retain calibrated packing, and their
// entire remaining dynamic state (including terrain/spawns) must still agree.
const hashes = {
  arabia: ['c17a48c4/728d799c', 'd077c78f/39c49ca7', 'a85419c2/cbabc97a', 'f0a1544d/7a062ecf', '3babb11c/a128c4be', '6702cde3/b72b7f0b', 'f0258043/b0aa099d', '58cdfa2e/ba908f6c'],
  islands: ['7067e2d6/7e4c58e3', 'ef31df9c/87294cea', 'e5d55887/3114e83b', 'd90b6835/d67ea9ed', '659d7667/e81560c7', '6ea2be36/fa023716', 'f4b085dc/eacebd22', '0d589397/968c7cb1'],
  'black-forest': ['3c2bf76a/72596a18', '370ac50d/4cb4ab3d', 'f4e69f34/109ae272', 'aa9f4087/fad9e96d', '806dd22b/86173c63', '2b6fde35/c400123f', '6da21978/e2214508', '0df8e78e/4404283e'],
};
for (const [map, expected] of Object.entries(hashes)) it(`${map}: legacy seeds and JSON continuation are unchanged`, () => {
  for (const [i, seed] of [1, 2, 3, 7, 29, 42, 118, 130].entries()) {
    const current = createGame(seed, undefined, undefined, map, undefined, undefined, undefined, 0);
    expect(current.packingVersion).toBe(1);
    expect(current.siphonsVersion).toBe(1);
    expect(current.rules.units.trebuchet.unpacked!.seconds).toBeCloseTo(50 / 4.5);
    const currentInitial = checksumState(current);
    const state = createGame(seed, undefined, undefined, map, undefined, undefined, undefined, 0);
    useLegacyPacking(state);
    useLegacySiphons(state);
    expect(state).not.toHaveProperty('mapgenVersion');
    expect(state).not.toHaveProperty('packingVersion');
    expect(state).not.toHaveProperty('siphonsVersion');
    const [initial, continued] = expected[i].split('/');
    expect(checksumState(state), `seed ${seed}`).toBe(initial);
    const restored = JSON.parse(JSON.stringify(state));
    const expectSameDynamicState = () => {
      const { packingVersion, siphonsVersion, ...dynamic } = JSON.parse(canonicalSnapshot(current));
      expect(packingVersion).toBe(1);
      expect(siphonsVersion).toBe(1);
      expect(dynamic).toEqual(JSON.parse(canonicalSnapshot(state)));
    };
    expectSameDynamicState();
    for (let tick = 0; tick < 20; tick++) { stepGame(state); stepGame(restored); stepGame(current); }
    expect(checksumState(state)).toBe(continued);
    expect(checksumState(restored)).toBe(continued);
    expect(restored).not.toHaveProperty('mapgenVersion');
    expectSameDynamicState();
    if (map !== 'arabia') expect(checksumState(createGame(seed, undefined, undefined, map))).toBe(currentInitial);
  }
});
