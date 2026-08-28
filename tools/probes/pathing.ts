/**
 * What the pathing actually does, measured. No browser: this is all simulation.
 *
 * `docs/pathing-review.md` is the write-up of a run of this script, and issue
 * #5 is the reason it exists — the report said the pathing was poor and none
 * of these nine measurements could reproduce a defect, so the numbers are the
 * argument. Re-run it after anything that touches `nav.ts`, movement, or the
 * cost of a tick (overnight.md's Q6 wants the last section in particular).
 *
 *   npx tsx tools/probes/pathing.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { FALLBACK_RULES, rulesFromManifest, type ContentManifest } from '../../src/sim/data';
import { applyCommand, createGame, placementLegal, stepGame } from '../../src/sim/game';
import { exampleAiCommands } from '../../src/sim/ai';
import { observe } from '../../src/sim/observe';
import type { Entity, GameState, Point } from '../../src/sim/types';

const MANIFEST = 'public/imported/aoe2/manifest.json';
const rules = existsSync(MANIFEST)
  ? rulesFromManifest(JSON.parse(readFileSync(MANIFEST, 'utf8')) as ContentManifest)
  : FALLBACK_RULES;

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function putUnit(state: GameState, at: Point, kind: 'villager' | 'militia' = 'villager'): Entity {
  const r = state.rules.units[kind];
  const e: Entity = {
    id: state.nextId++, kind, owner: 1, position: { ...at },
    hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' },
  };
  state.entities.push(e);
  return e;
}

function wallAt(state: GameState, x: number, y: number): boolean {
  if (!placementLegal(state, 'palisade-wall', { x, y }).ok) return false;
  const r = state.rules.buildings['palisade-wall'];
  state.entities.push({
    id: state.nextId++, kind: 'palisade-wall', owner: 2, position: { x, y },
    hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' },
  });
  return true;
}

/** Walk one unit to a point; how far it went against the straight line. */
function walk(state: GameState, unit: Entity, to: Point, limit = 4000) {
  applyCommand(state, { kind: 'order', player: 1, entityIds: [unit.id], target: to });
  const straight = dist(unit.position, to);
  let travelled = 0;
  let last = { ...unit.position };
  let ticks = 0;
  let stuck = 0;
  for (; ticks < limit; ticks++) {
    stepGame(state);
    travelled += dist(last, unit.position);
    last = { ...unit.position };
    if ((unit.stuckTicks ?? 0) > 0) stuck++;
    if (dist(unit.position, to) < 0.6) break;
  }
  return { straight, travelled, ticks, stuck, arrived: dist(unit.position, to) < 0.6,
    ratio: travelled / Math.max(straight, 1e-9) };
}

// 1. Open ground. A ratio near 1 means no detour and no dithering.
{
  const state = createGame(200, rules);
  const r = walk(state, putUnit(state, { x: 20.5, y: 20.5 }), { x: 40.5, y: 20.5 });
  console.log(`open ground:        ratio ${r.ratio.toFixed(2)}  ticks ${r.ticks}  arrived ${r.arrived}`);
}

// 2. Ten to one point: do they all arrive, and do they ever stop?
{
  const state = createGame(210, rules);
  const group: Entity[] = [];
  for (let i = 0; i < 10; i++) group.push(putUnit(state, { x: 20.5 + (i % 5), y: 20.5 + Math.floor(i / 5) }));
  const to = { x: 40.5, y: 30.5 };
  applyCommand(state, { kind: 'order', player: 1, entityIds: group.map(g => g.id), target: to });
  let settledAt = -1;
  let driftAfterSettling = 0;
  for (let tick = 0; tick < 4000; tick++) {
    const before = group.map(g => ({ ...g.position }));
    stepGame(state);
    if (settledAt >= 0) {
      for (const [i, g] of group.entries()) driftAfterSettling += dist(before[i], g.position);
    } else if (group.every(g => g.activity !== 'moving')) settledAt = tick;
  }
  console.log(`ten to one point:   settled at ${settledAt < 0 ? 'never' : settledAt}`
    + `  drift after ${driftAfterSettling.toFixed(1)}`
    + `  widest ${Math.max(...group.map(g => dist(g.position, to))).toFixed(2)} tiles`);
}

// 3. Round a wall, against a geometric detour of about 2.0.
{
  const state = createGame(202, rules);
  let built = 0;
  for (let x = 28.5; x <= 38.5; x++) if (wallAt(state, x, 30.5)) built++;
  stepGame(state);
  const r = walk(state, putUnit(state, { x: 33.5, y: 27.5 }), { x: 33.5, y: 34.5 }, 8000);
  console.log(`round a ${built}-tile wall: ratio ${r.ratio.toFixed(2)}  ticks ${r.ticks}`
    + `  arrived ${r.arrived}  stuck-ticks ${r.stuck}`);
}

// 4. Round one building, where the tile staircase would show if there were one.
{
  const state = createGame(221, rules);
  const tc = state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!;
  const from = { x: tc.position.x - 7, y: tc.position.y - 7 };
  const r = walk(state, putUnit(state, from), { x: tc.position.x + 7, y: tc.position.y + 7 }, 6000);
  console.log(`round a town center: ratio ${r.ratio.toFixed(2)}  ticks ${r.ticks}  arrived ${r.arrived}`);
}

// 5. A crowd through a one-tile gap: the case naive per-unit A* jams on.
{
  const state = createGame(220, rules);
  let walls = 0;
  for (let x = 24.5; x <= 42.5; x++) {
    if (Math.abs(x - 33.5) < 0.1) continue;    // the gap
    if (wallAt(state, x, 30.5)) walls++;
  }
  stepGame(state);
  const group: Entity[] = [];
  for (let i = 0; i < 12; i++) group.push(putUnit(state, { x: 30.5 + (i % 6), y: 26.5 + Math.floor(i / 6) }));
  applyCommand(state, { kind: 'order', player: 1, entityIds: group.map(g => g.id), target: { x: 33.5, y: 35.5 } });
  const through = new Map<number, number>();
  let tick = 0;
  for (; tick < 8000 && through.size < group.length; tick++) {
    stepGame(state);
    for (const g of group) if (!through.has(g.id) && g.position.y > 31.5) through.set(g.id, tick);
  }
  const times = [...through.values()].sort((a, b) => a - b);
  console.log(`twelve through a gap in a ${walls}-tile wall: ${through.size}/12`
    + `  first ${times[0]}  last ${times[times.length - 1] ?? 'n/a'}`
    + `  stuck ${group.filter(g => (g.stuckTicks ?? 0) > 0).length}`);
}

// 6. A goal nothing can reach: it has to give up rather than walk on the spot.
{
  const state = createGame(211, rules);
  const cx = 40, cy = 40;
  let walls = 0;
  for (let x = cx - 2; x <= cx + 2; x++) {
    for (let y = cy - 2; y <= cy + 2; y++) {
      if (x !== cx - 2 && x !== cx + 2 && y !== cy - 2 && y !== cy + 2) continue;
      if (wallAt(state, x + 0.5, y + 0.5)) walls++;
    }
  }
  stepGame(state);
  const unit = putUnit(state, { x: cx + 0.5, y: cy - 6.5 });
  applyCommand(state, { kind: 'order', player: 1, entityIds: [unit.id], target: { x: cx + 0.5, y: cy + 0.5 } });
  let gaveUpAt = -1;
  for (let tick = 0; tick < 3000; tick++) {
    stepGame(state);
    if (unit.activity !== 'moving' && gaveUpAt < 0) gaveUpAt = tick;
  }
  const inside = Math.abs(unit.position.x - (cx + 0.5)) < 1.5 && Math.abs(unit.position.y - (cy + 0.5)) < 1.5;
  console.log(`sealed courtyard (${walls} walls): gave up at ${gaveUpAt < 0 ? 'never' : gaveUpAt}`
    + `  got in: ${inside}`);
}

// 7. Told to walk onto a building: it should stop at the footprint edge.
{
  const state = createGame(212, rules);
  const tc = state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!;
  const unit = putUnit(state, { x: tc.position.x - 8, y: tc.position.y });
  applyCommand(state, { kind: 'order', player: 1, entityIds: [unit.id], target: { ...tc.position } });
  let movingTicks = 0;
  for (let tick = 0; tick < 2000; tick++) {
    stepGame(state);
    if (unit.activity === 'moving') movingTicks++;
  }
  console.log(`onto a town center: stops ${dist(unit.position, tc.position).toFixed(2)} tiles out`
    + `  moving for ${movingTicks}/2000 ticks`);
}

// 8. A real match: does anything get stuck when nobody is staging it?
{
  const state = createGame(203, rules);
  let stuckTicks = 0;
  let movingTicks = 0;
  const everStuck = new Set<number>();
  for (let tick = 0; tick < 12_000 && !state.winner; tick++) {
    if (tick % 100 === 0) {
      for (const player of [1, 2] as const) {
        for (const command of exampleAiCommands(observe(state, player), player)) applyCommand(state, command);
      }
    }
    stepGame(state);
    for (const e of state.entities) {
      if (e.dead || e.owner === 0) continue;
      if (e.activity === 'moving') movingTicks++;
      if ((e.stuckTicks ?? 0) > 0) { stuckTicks++; everStuck.add(e.id); }
    }
  }
  console.log(`ten minutes of a match: ${stuckTicks} stuck-ticks in ${movingTicks} moving-ticks,`
    + ` ${everStuck.size} units ever stuck`);
}

// 9. What one order to a group costs the tick it lands on. Q6's number.
for (const count of [1, 10, 25, 50]) {
  const state = createGame(230, rules);
  const group: Entity[] = [];
  for (let i = 0; i < count; i++) {
    group.push(putUnit(state, { x: 10.5 + (i % 10) * 0.6, y: 10.5 + Math.floor(i / 10) * 0.6 }, 'militia'));
  }
  for (let i = 0; i < 20; i++) stepGame(state);   // settle, so the measured tick is the one that paths
  applyCommand(state, {
    kind: 'order', player: 1, entityIds: group.map(g => g.id), target: { x: 110.5, y: 110.5 },
  });
  const durations: number[] = [];
  for (let i = 0; i < 60; i++) {
    const at = process.hrtime.bigint();
    stepGame(state);
    durations.push(Number(process.hrtime.bigint() - at) / 1e6);
  }
  const rest = durations.slice(1).sort((a, b) => a - b);
  console.log(`${String(count).padStart(2)} ordered across the map:`
    + ` order tick ${durations[0].toFixed(2)}ms,`
    + ` median after ${rest[Math.floor(rest.length / 2)].toFixed(2)}ms`);
}
