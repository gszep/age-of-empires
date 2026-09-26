import { describe, expect, it } from 'vitest';
import { createGame, stepGame } from './game';
import { checksumState } from './checksum';
import { buildNavGrid, findPath } from './nav';
import { isOpenWater } from './mapgen';
import { boxDistance, inNeutralArea } from './relic-placement';
import type { GameState, Point } from './types';

const tile = (s: GameState, p: Point) => Math.floor(p.y) * s.width + Math.floor(p.x);
const relics = (s: GameState) => s.entities.filter(e => e.kind === 'relic');

describe('source-backed tiny-map relic policies', () => {
  it('retains the zero-seed alias across the independent start-position stream', () => {
    expect(checksumState(createGame(0))).toBe(checksumState(createGame(1)));
  });
  // Separate tests keep the existing per-test clock; each checks outcomes,
  // not a duplicate of the policy's candidate filter.
  for (const map of ['arabia', 'black-forest', 'islands']) {
    for (let first = 1; first <= 50; first += 10) it(`${map}: constraints on seeds ${first}–${first + 9}`, () => {
      for (let seed = first; seed < first + 10; seed++) {
        const s = createGame(seed, undefined, undefined, map), rs = relics(s);
        expect(rs, `seed ${seed}`).toHaveLength(map === 'black-forest' ? 4 : 5);
        const homes = [1, 2].map(owner => s.entities.find(e => e.kind === 'town-center' && e.owner === owner)!);
        const trees = s.entities.filter(e => e.node === 'tree');
        const grid = buildNavGrid(s);
        for (let i = 0; i < rs.length; i++) {
          const p = rs[i].position;
          expect(grid.blocked[tile(s, p)]).toBe(0);
          expect(isOpenWater(s.terrain[tile(s, p)])).toBe(false);
          const central = map === 'arabia' && i === 0;
          const extra = map === 'islands' && i === 4;
          const owner = Math.floor((i - (map === 'arabia' ? 1 : 0)) / 2);
          if (extra) {
            expect(s.landIds![tile(s, p)]).toBe(20);
          } else {
            const forest = map === 'islands' ? 2 : 1;
            expect(trees.every(t => boxDistance(p, t.position) > forest)).toBe(true);
            const metric = central || map === 'islands' ? boxDistance : (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
            const min = map === 'arabia' ? 32 : map === 'black-forest' ? 24 : 18;
            expect(homes.every(h => metric(p, h.position) >= min)).toBe(true);
            if (map === 'islands') expect(boxDistance(p, homes[owner].position)).toBeLessThanOrEqual(26);
            if (map === 'black-forest') expect(inNeutralArea(p, s.width, s.height)).toBe(false);
            if (central) expect(inNeutralArea(p, s.width, s.height)).toBe(true);
            const edge = map === 'arabia' ? central ? 4 : 9.6 : map === 'black-forest' ? 2 : 0;
            expect(Math.min(p.x, p.y, s.width - p.x, s.height - p.y)).toBeGreaterThanOrEqual(edge);
            if (!central) {
              if (map !== 'arabia') expect(s.landIds![tile(s, p)]).toBe(owner + 1);
              const unit = s.entities.find(e => e.kind === 'villager' && e.owner === owner + 1)!;
              const path = findPath(grid, unit.position, p);
              expect(path?.length, `${map} seed ${seed} relic ${i} path`).toBeGreaterThan(0);
              expect(boxDistance(path![path!.length - 1], p)).toBeLessThanOrEqual(1);
            }
            if (map !== 'islands') {
              const radius = central ? 1 : 4, x = Math.floor(p.x), y = Math.floor(p.y);
              for (const dx of [-radius, 0, radius]) for (const dy of [-radius, 0, radius]) {
                expect(s.landIds![(y + dy) * s.width + x + dx]).toBe(s.landIds![tile(s, p)]);
              }
            }
          }
          if (!extra) for (let j = 0; j < i; j++) {
            expect(boxDistance(p, rs[j].position)).toBeGreaterThanOrEqual(map === 'islands' ? 8 : map === 'arabia' && j === 0 ? 28 : 24);
          }
        }
        if (map === 'islands') {
          for (const [id, resource, count] of [[20, 'gold', 6], [23, 'stone', 2]] as const) {
            const cells = s.landIds!.flatMap((idHere, i) => idHere === id ? [i] : []);
            expect(cells.length).toBeGreaterThanOrEqual(144);
            expect(s.entities.filter(e => e.node === resource && s.landIds![tile(s, e.position)] === id)).toHaveLength(count);
            const seen = new Set<number>([cells[0]]), queue = [cells[0]];
            for (let q = 0; q < queue.length; q++) for (const d of [-1, 1, -s.width, s.width]) {
              const n = queue[q] + d;
              if (s.landIds![n] === id && !seen.has(n)) { seen.add(n); queue.push(n); }
            }
            expect(seen.size, `connected islet ${id}, seed ${seed}`).toBe(cells.length);
            for (const i of cells) {
              expect(isOpenWater(s.terrain[i])).toBe(false);
              const x = i % s.width, y = Math.floor(i / s.width);
              for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
                const other = s.landIds![(y + dy) * s.width + x + dx];
                expect(other === 0 || other === id, `islet ${id} avoidance seed ${seed}`).toBe(true);
              }
            }
          }
        }
      }
    });
  }
  it.each(['arabia', 'black-forest', 'islands', 'painted-proof', 'senlac', 'windsor'])('%s is deterministic and JSON-continuable', map => {
    const a = createGame(130, undefined, undefined, map), b = createGame(130, undefined, undefined, map);
    expect(checksumState(a)).toBe(checksumState(b));
    expect(relics(a)).toHaveLength(map === 'black-forest' ? 4 : 5);
    const restored = JSON.parse(JSON.stringify(a)) as GameState;
    for (let i = 0; i < 4; i++) { stepGame(a); stepGame(restored); }
    expect(checksumState(a)).toBe(checksumState(restored));
  });
});
