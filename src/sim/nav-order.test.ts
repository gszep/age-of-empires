import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { findPath, type NavGrid } from './nav';

it('preserves the pre-optimization waypoint order across broad, tied and failed searches', () => {
  // Golden from 2fd67fa's swap-based heap, not just another run of this heap.
  // Include alternating workspace sizes, duplicate frontier entries, blocked
  // fractional endpoints, sealed goals and start=goal; hash every waypoint.
  let random = 175;
  const next = () => {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    return random / 2 ** 32;
  };
  const digest = createHash('sha256');
  let paths = 0, failures = 0;
  for (let scenario = 0; scenario < 160; scenario++) {
    const width = [12, 64, 9, 120][scenario % 4];
    const height = [10, 48, 17, 120][scenario % 4];
    const blocked = Uint8Array.from({ length: width * height }, () => +(next() < .23));
    if (scenario % 3 === 0) {
      for (let y = 0; y < height; y++) blocked[y * width + (width >> 1)] = 1;
    }
    const grid: NavGrid = { width, height, blocked };
    for (let query = 0; query < 8; query++) {
      const from = { x: next() * width, y: next() * height };
      const to = query === 0 ? from : { x: next() * width, y: next() * height };
      const path = findPath(grid, from, to);
      if (path) paths++; else failures++;
      digest.update(JSON.stringify(path ?? null));
      expect(findPath(grid, from, to)).toEqual(path);
    }
  }
  expect(paths).toBeGreaterThan(1000);
  expect(failures).toBeGreaterThan(100);
  expect(digest.digest('hex')).toBe('f8356f71969783ca31e6c888e6fc2f9e023ee7e2e3ce8a4515d782aab9818b22');
});

it('preserves a large exhausted frontier and then resets a nonempty frontier', () => {
  const grid: NavGrid = { width: 392, height: 392, blocked: new Uint8Array(392 * 392) };
  for (let y = 389; y < 392; y++) for (let x = 389; x < 392; x++) {
    if (x !== 390 || y !== 390) grid.blocked[y * 392 + x] = 1;
  }
  const from = { x: 1.5, y: 1.5 };
  const path = findPath(grid, from, { x: 390.5, y: 390.5 });
  expect(createHash('sha256').update(JSON.stringify(path)).digest('hex'))
    .toBe('dc360577e042aa3292af1caa8436f7390716f7a83a3989ce09000e628a9e0091');
  // Goal reached with other entries still open; a fresh grid avoids the path
  // cache, exercising reuse of the same heap after both exit conditions.
  const fresh = (): NavGrid => ({ width: 12, height: 10, blocked: new Uint8Array(120) });
  const to = { x: 8.5, y: 5.5 };
  const expected = findPath(fresh(), from, to);
  expect(findPath(fresh(), from, from)).toBeUndefined();
  expect(findPath(fresh(), from, to)).toEqual(expected);
});
