import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rulesFromManifest } from './data';
import { activateAutomaticTechnologies, applyCommand, canGarrison, createGame, stepGame, volleyArrows } from './game';
import { buildingRulesFor, buildingRulesForEntity, unitRulesFor } from './rules';
import { canConvert, conversionPermissionError } from './monastery';
import { rulesForPlayer } from './civilizations';
import { updateVisibility } from './visibility';
import { synchronizationHash } from '../shared/checksum';
import { replayRecord, runMatch, type Strategy } from '../headless/runner';
import type { BuildingKind, Entity, GameState, PlayerId, UnitKind } from './types';

const path = process.env.CIV_PROFILE_CONTENT ?? 'public/imported/aoe2/manifest.json';
const imported = existsSync(path) ? rulesFromManifest(JSON.parse(readFileSync(path, 'utf8'))) : undefined;
if (imported?.civilizations?.teutons) imported.civilizations.teutons.civilization.enabled = true;
function arena(age = 2) {
  const s = createGame(182, imported!, { 1: 'teutons', 2: 'goths' });
  s.entities = s.entities.filter(e => e.kind === 'town-center');
  s.terrain.fill(0); s.elevation.fill(0);
  for (const owner of [1,2] as const) Object.assign(s.players[owner], { age, food: 20000, wood: 20000, gold: 20000, stone: 20000 });
  activateAutomaticTechnologies(s); return s;
}
function building(s: GameState, kind: BuildingKind, owner: PlayerId, x = 20, y = 20): Entity {
  const r = buildingRulesFor(s, owner, kind), e: Entity = { id: s.nextId++, kind, owner,
    position: { x,y }, hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
  s.entities.push(e); activateAutomaticTechnologies(s); return e;
}
function unit(s: GameState, kind: UnitKind, owner: PlayerId, x = 50, y = 50): Entity {
  const r = unitRulesFor(s, owner, kind), e: Entity = { id: s.nextId++, kind, owner,
    position: { x,y }, hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
  s.entities.push(e); return e;
}
function until(s: GameState, done: () => boolean, ticks = 6000) {
  for (let i = 0; i < ticks && !done(); i++) stepGame(s);
  expect(done()).toBe(true);
}
function order(s: GameState, caster: Entity, target: Entity) {
  updateVisibility(s);
  return applyCommand(s, { kind: 'order', player: caster.owner as PlayerId, entityIds: [caster.id], targetId: target.id, target: target.position });
}
function research(s: GameState, home: Entity, tech: string) {
  const owner = home.owner as PlayerId, before = { ...s.players[owner] };
  expect(applyCommand(s, { kind: 'research', player: owner, buildingId: home.id, tech }).ok).toBe(true);
  const cost = rulesForPlayer(s, owner).technologies[tech].cost;
  for (const r of ['food','wood','gold','stone'] as const) expect(before[r] - s.players[owner][r]).toBe(cost[r]);
  until(s, () => s.players[owner].researched.includes(tech));
}

describe.skipIf(!imported?.civilizations?.teutons)('owned Teutonic gameplay', () => {
  it('pays36 wood for a farm and grants eligible free research once without charging its residual DAT price', () => {
    const s = arena(), worker = unit(s, 'villager', 1, 39, 40);
    const wood = s.players[1].wood;
    expect(applyCommand(s, { kind: 'build', player: 1, builderIds: [worker.id], building: 'farm', target: { x: 40.5, y: 40.5 } }).ok).toBe(true);
    expect(wood - s.players[1].wood).toBe(36);
    until(s, () => s.entities.some(e => e.kind === 'farm' && e.buildProgress === undefined));
    const before = { ...s.players[1] };
    building(s, 'university', 1); building(s, 'monastery', 1, 28, 20);
    for (const tech of ['murder-holes','herbal-medicine']) expect(s.players[1].researched.filter(k => k === tech)).toHaveLength(1);
    for (const r of ['food','wood','gold','stone'] as const) expect(s.players[1][r]).toBe(before[r]);
    const saved = JSON.parse(JSON.stringify(s)); activateAutomaticTechnologies(saved);
    expect(saved.players[1].researched).toEqual(s.players[1].researched);
    expect(s.players[2].researched).not.toContain('murder-holes');
  });

  it('heals at double normal range and admits25 TC /10 tower occupants through public orders', () => {
    const s = arena();
    const healer = unit(s, 'monk', 1, 40, 35), wounded = unit(s, 'militia', 1, 47.5, 35);
    const normal = unit(s, 'monk', 2, 75, 35), other = unit(s, 'militia', 2, 82.5, 35);
    wounded.hp = other.hp = 10;
    expect(order(s, healer, wounded).ok).toBe(true); expect(order(s, normal, other).ok).toBe(true);
    until(s, () => wounded.hp > 10);
    expect(healer.position).toEqual({ x:40, y:35 });
    expect(normal.position.x).toBeGreaterThan(75); expect(other.hp).toBe(10);
    const tc = s.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    for (const [home,capacity] of [[tc,25],[building(s,'watch-tower',1,50.5,65.5),10]] as const) {
      const arrivals = Array.from({length:capacity+1}, () => unit(s,'villager',1,home.position.x,home.position.y));
      for (const arrival of arrivals) expect(order(s,arrival,home).ok).toBe(true);
      until(s, () => home.garrison?.length === capacity);
      const extra = arrivals.find(e => !home.garrison?.some(g => g.id === e.id))!;
      expect(canGarrison(s,extra,home)).toBe(false);
      expect(buildingRulesForEntity(s,home).garrison?.capacity).toBe(capacity);
    }
  });

  it.each([2,3])('age%s armour changes actual infantry and cavalry damage without helping the opponent', age => {
    const s = arena(age);
    for (const [i,kind] of (['militia','scout-cavalry'] as const).entries()) {
      const target = unit(s,kind,1,50,45+i*10), attacker = unit(s,'militia',2,50.6,45+i*10);
      target.attackCooldown = 10000;
      const hp = target.hp;
      expect(order(s,attacker,target).ok).toBe(true); until(s, () => target.hp < hp);
      expect(hp - target.hp).toBe(4 - (age - 1));
      applyCommand(s,{kind:'stop',player:2,entityIds:[attacker.id]});
    }
  });

  it('applies paid age armour to existing, garrisoned and subsequently trained soldiers', () => {
    const s=arena(1), tc=s.entities.find(e=>e.owner===1&&e.kind==='town-center')!;
    const castle=building(s,'castle',1), barracks=building(s,'barracks',1,28,20);
    building(s,'blacksmith',1,36,20);building(s,'market',1,44,20);
    const infantry=unit(s,'militia',1,50,50), cavalry=unit(s,'scout-cavalry',1,50,60);
    const passenger=unit(s,'militia',1,castle.position.x,castle.position.y);
    expect(order(s,passenger,castle).ok).toBe(true);until(s,()=>castle.garrison?.some(e=>e.id===passenger.id)===true);
    const hit=(target:Entity,damage:number)=>{
      target.attackCooldown=10000;
      const attacker=unit(s,'militia',2,target.position.x+.6,target.position.y), hp=target.hp;
      expect(order(s,attacker,target).ok).toBe(true);until(s,()=>target.hp<hp);
      expect(hp-target.hp).toBe(damage);
      expect(applyCommand(s,{kind:'delete',player:2,entityIds:[attacker.id]}).ok).toBe(true);
      expect(applyCommand(s,{kind:'stop',player:1,entityIds:[target.id]}).ok).toBe(true);
    };
    research(s,tc,'castle-age');hit(infantry,3);hit(cavalry,3);
    research(s,tc,'imperial-age');
    expect(applyCommand(s,{kind:'ungarrison',player:1,buildingId:castle.id}).ok).toBe(true);
    passenger.position={x:50,y:70};hit(infantry,2);hit(cavalry,2);hit(passenger,2);
    const first=s.nextId;
    expect(applyCommand(s,{kind:'train',player:1,buildingId:barracks.id,unit:'militia'}).ok).toBe(true);
    until(s,()=>s.entities.some(e=>e.owner===1&&e.kind==='militia'&&e.id>=first));
    const trained=s.entities.find(e=>e.owner===1&&e.kind==='militia'&&e.id>=first)!;
    trained.position={x:50,y:80};hit(trained,2);
  });

  it('pays for Ironclad and reduces actual siege melee damage; elite Teutonic Knights replace existing troops', () => {
    const s = arena(3), castle = building(s,'castle',1), ram = unit(s,'battering-ram',1,54);
    const attacker = unit(s,'dat-unit-41',2,53);
    ram.attackCooldown = 10000;
    const hit = () => { const hp=ram.hp; attacker.attackCooldown=0;
      expect(order(s,attacker,ram).ok).toBe(true); until(s,()=>ram.hp<hp);
      applyCommand(s,{kind:'stop',player:2,entityIds:[attacker.id]}); return hp-ram.hp; };
    const before = hit();
    attacker.position = {x:90,y:90}; ram.order = {kind:'idle'};
    research(s,castle,'ironclad');
    attacker.position = {x:53,y:50};
    expect(hit()).toBe(before-4);
    attacker.position = {x:90,y:90};
    expect(applyCommand(s,{kind:'train',player:1,buildingId:castle.id,unit:'dat-unit-25'}).ok).toBe(true);
    until(s,()=>s.entities.some(e=>e.kind==='dat-unit-25'));
    const knight=s.entities.find(e=>e.kind==='dat-unit-25')!;
    research(s,castle,'elite-teutonic-knight');
    expect(knight.kind).toBe('dat-unit-554'); expect(knight.maxHp).toBe(110);
  });

  it('Crenellations reaches a formerly distant target and adds actual infantry-powered projectiles', () => {
    const s=arena(3), castle=building(s,'castle',1,40,40), victim=unit(s,'villager',2,52,40);
    victim.hp=victim.maxHp=10000;
    for(let i=0;i<40;i++)stepGame(s);
    expect(victim.hp).toBe(10000);
    research(s,castle,'crenellations');
    until(s,()=>s.projectiles.some(p=>p.owner===1));
    const baseline=s.projectiles.filter(p=>p.owner===1).length;
    until(s,()=>victim.hp<10000);
    for(let i=0;i<4;i++){const infantry=unit(s,'militia',1,40,40);expect(order(s,infantry,castle).ok).toBe(true);}
    until(s,()=>castle.garrison?.length===4);
    expect(volleyArrows(s,castle)).toBeGreaterThan(baseline);
    until(s,()=>s.projectiles.length===0);
    until(s,()=>s.projectiles.filter(p=>p.owner===1).length>baseline);
  });

  it('requires Redemption/Atonement using source permission messages and converts only eligible adjacent buildings', () => {
    const s=arena(3), home=building(s,'monastery',1), monk=unit(s,'monk',1,50), enemy=unit(s,'monk',2,58);
    const house=building(s,'house',2,54,58), siege=unit(s,'mangonel',2,56,44);
    expect(order(s,monk,enemy)).toMatchObject({ok:false,reason:expect.stringContaining('Atonement')});
    expect(order(s,monk,house)).toMatchObject({ok:false,reason:expect.stringContaining('Redemption')});
    expect(order(s,monk,siege)).toMatchObject({ok:false,reason:expect.stringContaining('Redemption')});
    siege.attackCooldown=100000; siege.order={kind:'move',target:{x:90,y:90}};
    research(s,home,'atonement');
    expect(order(s,monk,enemy).ok).toBe(true); until(s,()=>enemy.owner===1);
    research(s,home,'redemption');
    const fresh=unit(s,'monk',1,50,60);
    house.hp-=17; const maxHp=house.maxHp,hp=house.hp;
    expect(order(s,fresh,house).ok).toBe(true);
    for(let i=0;i<100;i++)stepGame(s);
    expect(house.owner).toBe(2); expect(fresh.position.x).toBeGreaterThan(50);
    until(s,()=>house.owner===1);
    expect(house).toMatchObject({hp,maxHp}); expect(house.convertedBuildingRules).toBeDefined();
    const saved=JSON.parse(JSON.stringify(s)); for(let i=0;i<20;i++){stepGame(s);stepGame(saved);}
    expect(synchronizationHash(saved)).toBe(synchronizationHash(s));
    const protectedTc=s.entities.find(e=>e.kind==='town-center'&&e.owner===2)!;
    fresh.faith=100; fresh.position={x:protectedTc.position.x+3,y:protectedTc.position.y};
    order(s,fresh,protectedTc);expect(fresh.order.kind).not.toBe('convert');
  });

  it('keeps a captured barracks work rate, clears former queues, and trains the recipient roster', () => {
    const s=arena(3), home=building(s,'monastery',1), barracks=building(s,'barracks',2,58,50);
    research(s,home,'redemption');
    expect(applyCommand(s,{kind:'train',player:2,buildingId:barracks.id,unit:'militia'}).ok).toBe(true);
    // Long paid queue ensures capture happens before the former work drains.
    for(let i=0;i<8;i++)expect(applyCommand(s,{kind:'train',player:2,buildingId:barracks.id,unit:'militia'}).ok).toBe(true);
    const monk=unit(s,'monk',1,55.5);monk.hp=monk.maxHp=10000;
    expect(order(s,monk,barracks).ok).toBe(true); until(s,()=>barracks.owner===1);
    expect(barracks.training).toBeUndefined();expect(barracks.trainingQueue).toBeUndefined();
    expect(buildingRulesForEntity(s,barracks).workRate).toBe(1.2);
    const ids=new Set(s.entities.map(e=>e.id)), start=s.tick;
    expect(applyCommand(s,{kind:'train',player:1,buildingId:barracks.id,unit:'militia'}).ok).toBe(true);
    until(s,()=>!barracks.training);
    const expected=Math.ceil(unitRulesFor(s,1,'militia').trainSeconds*20/1.2);
    expect(s.tick-start).toBeGreaterThanOrEqual(expected); expect(s.tick-start).toBeLessThanOrEqual(expected+1);
    expect(s.entities.some(e=>!ids.has(e.id)&&e.owner===1&&e.kind==='militia')).toBe(true);
    for(let i=0;i<4;i++)expect(applyCommand(s,{kind:'train',player:1,buildingId:barracks.id,unit:'militia'}).ok).toBe(true);
    const native=building(s,'barracks',1,40,20);
    research(s,native,'man-at-arms');
    expect(barracks.training?.kind).toBe('man-at-arms');
    expect(barracks.trainingQueue?.length).toBeGreaterThan(0);
    expect(barracks.trainingQueue?.every(kind=>kind==='man-at-arms')).toBe(true);
    expect(buildingRulesForEntity(s,barracks).workRate).toBe(1.2);
  });

  it('never lets Redemption capture protected structures, unfinished sites or an unknown building task', () => {
    const s=arena(3), home=building(s,'monastery',1), monk=unit(s,'monk',1);
    const protectedCastle=building(s,'castle',2,90,90);
    expect(conversionPermissionError(s,monk,protectedCastle)).toBeUndefined();
    expect(canConvert(s,monk,protectedCastle)).toBe(false);
    research(s,home,'redemption');
    for(const kind of ['town-center','castle','monastery','wonder','farm','fish-trap','stone-wall','stone-gate'] as BuildingKind[]) {
      expect(canConvert(s,monk,building(s,kind,2,70,70)),kind).toBe(false);
    }
    const site=building(s,'house',2,60,60);site.buildProgress=.5;
    expect(canConvert(s,monk,site)).toBe(false);
    site.buildProgress=undefined;
    site.convertedBuildingRules={...buildingRulesForEntity(s,site),datClass:undefined,datId:undefined};
    expect(canConvert(s,monk,site)).toBe(false);
  });

  it('gates and builds Bombard Towers, then fires the owned cannon projectile for actual cannon damage', () => {
    const s=arena(3), university=building(s,'university',1), worker=unit(s,'villager',1,40,40);
    const build={kind:'build' as const,player:1 as const,builderIds:[worker.id],building:'bombard-tower' as const,target:{x:42.5,y:40.5}};
    const gold=s.players[1].gold;
    expect(applyCommand(s,build).ok).toBe(false);expect(s.players[1].gold).toBe(gold);
    research(s,university,'chemistry'); research(s,university,'bombard-tower');
    expect(applyCommand(s,build).ok).toBe(true);
    const tower=s.entities.find(e=>e.kind==='bombard-tower')!;
    until(s,()=>tower.buildProgress===undefined);
    const victim=unit(s,'villager',2,48.5,40.5);victim.hp=victim.maxHp=1000;
    until(s,()=>s.projectiles.some(p=>p.owner===1));
    expect(s.projectiles.find(p=>p.owner===1)?.art).toBe('bombard-tower-shot');
    until(s,()=>victim.hp<1000);
    expect(1000-victim.hp).toBeGreaterThanOrEqual(120);
  });

  it('keeps captured tower stats through the recipient’s Guard Tower and Masonry research', () => {
    const s=arena(3), home=building(s,'monastery',1), university=building(s,'university',1,28,20);
    research(s,home,'redemption');
    const tower=building(s,'watch-tower',2,58.5,50.5), native=building(s,'watch-tower',1,40.5,30.5);
    tower.attackCooldown=100000; tower.hp-=17;
    const monk=unit(s,'monk',1,56,50.5), hp=tower.hp,maxHp=tower.maxHp;
    expect(order(s,monk,tower).ok).toBe(true);until(s,()=>tower.owner===1);
    expect(buildingRulesForEntity(s,tower).garrison?.capacity).toBe(5);
    research(s,university,'guard-tower');research(s,university,'masonry');
    expect(native.kind).toBe('guard-tower');
    expect(tower).toMatchObject({kind:'watch-tower',hp,maxHp});
    expect(buildingRulesForEntity(s,tower).garrison?.capacity).toBe(5);
    const victim=unit(s,'villager',2,63.5,50.5);victim.hp=victim.maxHp=1000;tower.attackCooldown=0;
    until(s,()=>victim.hp<1000);
    expect(1000-victim.hp).toBe(5);
  });

  it('uses the Teutonic team resistance in the actual conversion window', () => {
    const s=arena(), target=unit(s,'villager',1,54), monk=unit(s,'monk',2,50), start=s.tick;
    expect(order(s,monk,target).ok).toBe(true);
    for(let i=0;i<159;i++)stepGame(s);
    expect(target.owner).toBe(1);
    until(s,()=>target.owner===2);
    expect(s.tick-start).toBeLessThanOrEqual(200);
  });

  it('pays for both mangonel upgrades and uses Siege Onager damage on the live projectile', () => {
    const s=arena(3), workshop=building(s,'siege-workshop',1);
    expect(applyCommand(s,{kind:'train',player:1,buildingId:workshop.id,unit:'mangonel'}).ok).toBe(true);
    until(s,()=>s.entities.some(e=>e.kind==='mangonel'));
    const engine=s.entities.find(e=>e.kind==='mangonel')!;
    research(s,workshop,'onager');research(s,workshop,'siege-onager');
    expect(engine.kind).toBe('dat-unit-588');expect(engine.maxHp).toBe(70);
    engine.position={x:50,y:50};
    const target=unit(s,'villager',2,56,50);target.hp=target.maxHp=1000;
    expect(order(s,engine,target).ok).toBe(true);until(s,()=>target.hp<1000);
    expect(1000-target.hp).toBe(75);
  });

  it('retains a captured Teutonic Knight’s wounds and original tier after the donor researches Elite', () => {
    const s=arena(3), castle=building(s,'castle',1), knight=unit(s,'dat-unit-25',1,54), monk=unit(s,'monk',2,46);
    knight.hp-=7;expect(order(s,monk,knight).ok).toBe(true);until(s,()=>knight.owner===2);
    research(s,castle,'elite-teutonic-knight');
    expect(knight).toMatchObject({kind:'dat-unit-25',owner:2,hp:83,maxHp:90});
    const rival=building(s,'castle',2,80,80);
    expect(applyCommand(s,{kind:'train',player:2,buildingId:rival.id,unit:'dat-unit-25'}).ok).toBe(false);
  });

  it('replays real Teuton/Goth opening commands and automatic bonus activation', async () => {
    const player:Strategy={decide({observation:o}){
      if(o.time!==0)return[];
      const tc=o.entities.find(e=>e.owner===o.player&&e.kind==='town-center')!;
      return[{kind:'research',player:o.player,buildingId:tc.id,tech:'loom'},
        {kind:'train',player:o.player,buildingId:tc.id,unit:'villager'}];
    }};
    const{record,result}=await runMatch({version:1,seed:182,civilizations:{1:'teutons',2:'goths'},
      maxTimeSeconds:30,decideIntervalSeconds:1},{1:player,2:player},imported!);
    expect(result.rejectedCommands).toEqual([]);
    expect(replayRecord(JSON.parse(JSON.stringify(record)),imported!).ok).toBe(true);
  });
});
