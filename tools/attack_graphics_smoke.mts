import assert from 'node:assert/strict';
import { civilizationBrowser } from './civ_browser.mts';
import { createGame } from '../src/sim/game.ts';
import { unitRulesFor } from '../src/sim/rules.ts';
import { updateVisibility } from '../src/sim/visibility.ts';
import type { Entity, UnitKind } from '../src/sim/types.ts';

const b = await civilizationBrowser('byzantines', 5277);
try {
  await b.menu('britons');
  for (const kind of ['dat-unit-329', 'galley', 'cannon-galleon'] as UnitKind[]) {
    const water = kind !== 'dat-unit-329';
    const s = createGame(270, b.rules, { 1: 'byzantines', 2: 'britons' });
    s.entities = s.entities.filter(e => e.kind === 'town-center'); s.terrain.fill(water ? 23 : 0); s.elevation.fill(0);
    const stats = unitRulesFor(s, 1, kind);
    assert.notEqual(stats.secondAttackReleaseSeconds, undefined);
    const actor: Entity = { id: s.nextId++, kind, owner: 1, position: { x: 40.5, y: 40.5 },
      hp: stats.hp, maxHp: stats.hp, radius: stats.radius, activity: 'idle', order: { kind: 'idle' } };
    const target: Entity = { id: s.nextId++, kind: water ? 'transport-ship' : 'trade-cart', owner: 2,
      position: { x: water ? 44.5 : 41, y: 40.5 }, hp: 10000, maxHp: 10000, radius: .3,
      activity: 'idle', order: { kind: 'idle' } };
    s.entities.push(actor, target); updateVisibility(s); await b.stage(s);
    for (let i = 0; i < 6; i++) await b.page.keyboard.press('-');
    const command = kind === 'cannon-galleon'
      ? { kind: 'attack-ground', player: 1, entityIds: [actor.id], target: { x: 48.5, y: 40.5 } }
      : { kind: 'order', player: 1, entityIds: [actor.id], targetId: target.id, target: target.position };
    const result = await b.query({ type: 'command', command }); assert(result.ok, JSON.stringify({ command, result }));
    for (const variant of [0, 1, 0]) {
      await b.until((s, a) => { const e = s.entities.find((e: any) => e.id === a.id); return e.attackAnimation === a.variant && e.activity === 'attacking'; }, { id: actor.id, variant });
      const name = variant ? 'attack-2' : 'attack';
      await b.art(actor.id, kind);
      await b.page.waitForFunction(({ id, name }) => {
        const v = (window as any).__civProbe.art(id); return v?.animation === `${v.key}/${name.animation}` && !v.pending && !v.partsPending;
      }, {}, { id: actor.id, name: { kind, animation: name } });
      const art = await b.page.evaluate(id => (window as any).__civProbe.art(id), actor.id);
      const entity = b.profile.entities[kind];
      const layers = entity.animationLayers?.[name]?.map((l: any) => l.animation) ?? [name];
      const images = layers.flatMap((key: string) => {
        const a = entity.atlases[key]; return [a.image, ...(a.pages ?? []).map((p: any) => p.image)];
      });
      assert(images.includes(art.texture), JSON.stringify({ kind, name, art, images }));
      assert(art.pieces.length > 0); assert(art.pieces.every((image: string) => images.includes(image)), JSON.stringify({ kind, name, art, images }));
      if (variant === 1) {
        const phase = (await b.snapshot()).entities.find((e: any) => e.id === actor.id).attackAnimation;
        await b.reload(); assert.equal((await b.snapshot()).entities.find((e: any) => e.id === actor.id).attackAnimation, phase);
      }
    }
    if (kind !== 'cannon-galleon') {
      await b.until((s, id) => s.entities.find((e: any) => e.id === id).hp < 10000, target.id);
    } else {
      await b.until((s, id) => s.projectiles.some((p: any) => p.shooterId === id), actor.id);
    }
    console.log(kind, 'owned A/B/A body/composite textures, JSON reload and real damage/shots GREEN');
  }
  assert.deepEqual(b.errors, []);
  console.log('ALTERNATE ATTACK GRAPHICS GREEN (private published profiles, unchanged gameplay clocks)');
} finally { await b.close(); }
