/** Allocation/CPU benchmark plus byte-identical full-match comparison.
 * record .local/before.json, then compare the same file after a change.
 * Run on an idle host; elapsed times are evidence, never flaky test limits. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createGame, applyCommand, stepGame } from '../../src/sim/game.ts';
import { rulesFromManifest } from '../../src/sim/data.ts';
import { exampleAiCommands } from '../../src/sim/ai.ts';
import { observe } from '../../src/sim/observe.ts';
import { findPath } from '../../src/sim/nav.ts';

const [mode, file] = process.argv.slice(2);
assert(['record', 'compare'].includes(mode) && file, 'record|compare <baseline.json>');
const rules = rulesFromManifest(JSON.parse(readFileSync('public/imported/aoe2/manifest.json', 'utf8')));
const results: { paths: any[]; matches: any[] } = { paths: [], matches: [] };
for (const size of [120, 392]) {
  for (const kind of ['short', 'unreachable']) {
    const blocked = new Uint8Array(size * size);
    const goal = { x: size - 10.5, y: size - 10.5 };
    if (kind === 'unreachable') {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx || dy) blocked[(Math.floor(goal.y) + dy) * size + Math.floor(goal.x) + dx] = 1;
      }
    }
    const count = kind === 'short' ? 2000 : 3;
    const digest = createHash('sha256');
    const start = performance.now();
    for (let i = 0; i < count; i++) {
      const from = { x: 5.5 + i % 80, y: 5.5 + i % 70 };
      const to = kind === 'short' ? { x: from.x + 8, y: from.y + 6 } : goal;
      // New grid identity avoids the distinct per-tick path-result cache.
      const path = findPath({ width: size, height: size, blocked }, from, to);
      digest.update(JSON.stringify(path));
    }
    const result = { size, kind, count, ms: Math.round(performance.now() - start), hash: digest.digest('hex') };
    results.paths.push(result); console.log(JSON.stringify(result));
  }
}
for (const seed of [3, 7, 19]) {
  const state = createGame(seed, rules);
  const hashes = [];
  let stepMs = 0, aiMs = 0;
  for (let i = 0; i < 12_000; i++) {
    if (state.tick % 20 === 0) {
      const start = performance.now();
      for (const player of [1, 2] as const) for (const command of exampleAiCommands(observe(state, player))) applyCommand(state, command);
      aiMs += performance.now() - start;
    }
    const start = performance.now();
    stepGame(state);
    stepMs += performance.now() - start;
    if ((i + 1) % 1000 === 0) hashes.push(createHash('sha256').update(JSON.stringify(state)).digest('hex'));
  }
  const result = { seed, tick: state.tick, entities: state.entities.length, stepMs: Math.round(stepMs), aiMs: Math.round(aiMs), hashes };
  results.matches.push(result); console.log(JSON.stringify(result));
}
if (mode === 'record') writeFileSync(file, JSON.stringify(results, null, 2) + '\n');
else {
  const before = JSON.parse(readFileSync(file, 'utf8'));
  const stable = (r: typeof results) => ({ paths: r.paths.map(({ ms, ...rest }) => rest),
    matches: r.matches.map(({ stepMs, aiMs, ...rest }) => rest) });
  assert.deepEqual(stable(results), stable(before), 'paths and raw-JSON full-state hashes must be byte-identical');
  console.log('SIM PERFORMANCE PARITY GREEN: all path hashes and three 12,000-tick match traces are identical');
}
