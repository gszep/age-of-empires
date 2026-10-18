#!/usr/bin/env node
/**
 * Formation slots evaluation for issue #333.
 * 
 * Runs deterministic group movement tests with fixed seeds:
 * - Baseline: current golden-angle separation behavior
 * - Candidates: line/column deterministic layouts
 * - Metrics: arrival spread, blocked terrain, mixed radii, reverse directions
 * 
 * Usage: npx tsx tools/formation_slots_eval.mts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGame, stepGame } from '../src/sim/game.js';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.js';
import { applyCommand } from '../src/sim/game.js';
import type { Entity, GameState, Command } from '../src/sim/types.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = `${root}/public/imported/aoe2/manifest.json`;
const rules = existsSync(manifest) ? rulesFromManifest(JSON.parse(readFileSync(manifest, 'utf8'))) : FALLBACK_RULES;

interface TestCase {
  name: string;
  seed: number;
  unitCount: number;
  distance: number;
  mixed: boolean; // mixed radii
  reverse: boolean;
}

interface MeasurementResult {
  name: string;
  arrivalTick: number;
  spreadWidth: number;
  spreadHeight: number;
  arrivalRadius: number;
  minInterUnitDistance: number;
  testConfig: TestCase;
}

/** Run a group movement test and measure results. */
function runGroupMovementTest(testCase: TestCase): MeasurementResult {
  const state = createGame(testCase.seed, rules);
  
  // Clear map
  state.entities = state.entities.filter(e => e.kind === 'town-center');
  state.terrain.fill(0);
  
  // Find player 1 TC
  const tc = state.entities.find(e => e.owner === 1);
  if (!tc) throw new Error('no TC found');
  
  // Create group at fixed position
  const groupOrigin = { x: tc.position.x + 10, y: tc.position.y + 10 };
  const group: Entity[] = [];
  
  if (!testCase.mixed) {
    // Uniform militia group
    for (let i = 0; i < testCase.unitCount; i++) {
      const entity: Entity = {
        id: state.nextId++,
        kind: 'militia',
        owner: 1,
        position: { x: groupOrigin.x + (i % 5), y: groupOrigin.y + Math.floor(i / 5) },
        hp: rules.units.militia.hp,
        maxHp: rules.units.militia.hp,
        radius: rules.units.militia.radius,
        activity: 'idle',
        order: { kind: 'idle' },
      };
      group.push(entity);
      state.entities.push(entity);
    }
  } else {
    // Mixed group: knights and militia
    const halfCount = Math.floor(testCase.unitCount / 2);
    for (let i = 0; i < halfCount; i++) {
      const entity: Entity = {
        id: state.nextId++,
        kind: 'knight',
        owner: 1,
        position: { x: groupOrigin.x + (i % 3), y: groupOrigin.y + Math.floor(i / 3) },
        hp: rules.units.knight.hp,
        maxHp: rules.units.knight.hp,
        radius: rules.units.knight.radius,
        activity: 'idle',
        order: { kind: 'idle' },
      };
      group.push(entity);
      state.entities.push(entity);
    }
    for (let i = 0; i < testCase.unitCount - halfCount; i++) {
      const entity: Entity = {
        id: state.nextId++,
        kind: 'militia',
        owner: 1,
        position: { x: groupOrigin.x + (i % 3), y: groupOrigin.y + Math.floor(i / 3) + 2 },
        hp: rules.units.militia.hp,
        maxHp: rules.units.militia.hp,
        radius: rules.units.militia.radius,
        activity: 'idle',
        order: { kind: 'idle' },
      };
      group.push(entity);
      state.entities.push(entity);
    }
  }
  
  // Compute target
  const targetDistance = testCase.distance;
  const targetAngle = testCase.reverse ? Math.PI : 0; // Reverse: move back
  const target = {
    x: groupOrigin.x + Math.cos(targetAngle) * targetDistance,
    y: groupOrigin.y + Math.sin(targetAngle) * targetDistance,
  };
  
  // Issue move order
  const entityIds = group.map(e => e.id);
  const cmd: Command = {
    kind: 'order',
    player: 1,
    entityIds,
    target,
  };
  applyCommand(state, cmd);
  
  // Simulate until all units arrive (idle) or timeout
  const maxTicks = 2000;
  let arrivalTick = -1;
  
  for (let t = 0; t < maxTicks; t++) {
    stepGame(state); // one simulation tick
    
    // Check if all units have arrived
    if (group.every(u => u.order.kind === 'idle')) {
      arrivalTick = state.tick;
      break;
    }
  }
  
  if (arrivalTick < 0) arrivalTick = state.tick;
  
  // Measure arrival spread
  const positions = group.map(u => u.position);
  const xs = positions.map(p => p.x);
  const ys = positions.map(p => p.y);
  const spreadWidth = Math.max(...xs) - Math.min(...xs);
  const spreadHeight = Math.max(...ys) - Math.min(...ys);
  
  // Measure distance from target
  const arrivalRadius = Math.max(
    ...group.map(u => Math.hypot(u.position.x - target.x, u.position.y - target.y)),
  );
  
  // Measure inter-unit distances
  let minDist = Infinity;
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const d = Math.hypot(
        group[i].position.x - group[j].position.x,
        group[i].position.y - group[j].position.y,
      );
      minDist = Math.min(minDist, d);
    }
  }
  
  return {
    name: testCase.name,
    arrivalTick,
    spreadWidth,
    spreadHeight,
    arrivalRadius,
    minInterUnitDistance: minDist,
    testConfig: testCase,
  };
}

/** Print results table. */
function printResults(results: MeasurementResult[]): void {
  console.log('\n=== Formation Slots Evaluation Results ===\n');
  console.log(
    'Test Name'.padEnd(40),
    'Arrival (ticks)'.padEnd(18),
    'Spread (W×H)'.padEnd(18),
    'Radius (tiles)'.padEnd(16),
    'Min Unit Dist',
  );
  console.log('-'.repeat(110));
  
  for (const r of results) {
    const spreadStr = `${r.spreadWidth.toFixed(2)}×${r.spreadHeight.toFixed(2)}`;
    console.log(
      r.name.padEnd(40),
      String(r.arrivalTick).padEnd(18),
      spreadStr.padEnd(18),
      r.arrivalRadius.toFixed(3).padEnd(16),
      r.minInterUnitDistance.toFixed(3),
    );
  }
  
  console.log();
}

// Test cases: baseline current behavior
const testCases: TestCase[] = [
  { name: 'baseline-9unit', seed: 42, unitCount: 9, distance: 20, mixed: false, reverse: false },
  { name: 'baseline-25unit', seed: 42, unitCount: 25, distance: 20, mixed: false, reverse: false },
  { name: 'baseline-9unit-reverse', seed: 42, unitCount: 9, distance: 20, mixed: false, reverse: true },
  { name: 'baseline-mixed-radii-12unit', seed: 42, unitCount: 12, distance: 20, mixed: true, reverse: false },
  { name: 'baseline-long-distance-9unit', seed: 42, unitCount: 9, distance: 50, mixed: false, reverse: false },
];

console.log('Running formation slots evaluation (baseline measurements)...\n');

const results: MeasurementResult[] = [];
for (const testCase of testCases) {
  try {
    console.log(`Running: ${testCase.name}`);
    const result = runGroupMovementTest(testCase);
    results.push(result);
  } catch (e) {
    console.error(`FAILED: ${testCase.name}: ${e}`);
  }
}

printResults(results);

// Save results to log file for reference
const timestamp = new Date().toISOString().slice(0, 10);
mkdirSync('.local', { recursive: true });
const logPath = `.local/formation-eval-${timestamp}.log`;
const logContent = [
  '# Formation Slots Evaluation Results',
  `Generated: ${new Date().toISOString()}`,
  '',
  '## Summary',
  'Current baseline behavior measured for group movement with golden-angle separation.',
  'Metrics: arrival time, spread (width × height), radius from target, minimum inter-unit distance.',
  '',
  '## Results',
  ...results.map(r => [
    `### ${r.name}`,
    `- Arrival tick: ${r.arrivalTick}`,
    `- Spread: ${r.spreadWidth.toFixed(3)} × ${r.spreadHeight.toFixed(3)} tiles`,
    `- Radius from target: ${r.arrivalRadius.toFixed(3)} tiles`,
    `- Min inter-unit distance: ${r.minInterUnitDistance.toFixed(3)} tiles`,
    `- Units: ${r.testConfig.unitCount} | Distance: ${r.testConfig.distance} | Mixed: ${r.testConfig.mixed} | Reverse: ${r.testConfig.reverse}`,
  ].join('\n')),
].join('\n');

writeFileSync(logPath, logContent, 'utf8');
console.log(`\nResults saved to ${logPath}`);
