import assert from 'node:assert/strict';
import { civilizationBrowser } from './civ_browser.mts';
import { activateAutomaticTechnologies, createGame } from '../src/sim/game.ts';
import { buildingRulesFor, unitRulesFor } from '../src/sim/rules.ts';
import type { BuildingKind, Entity } from '../src/sim/types.ts';

const b=await civilizationBrowser('teutons');
try {
  await b.menu('goths');
  const s=createGame(182,b.rules,{1:'teutons',2:'goths'});
  s.entities=s.entities.filter(e=>e.owner!==0);s.terrain.fill(0);s.elevation.fill(0);
  for(const owner of [1,2] as const)Object.assign(s.players[owner],{age:1,food:20000,wood:20000,gold:20000,stone:20000});
  const tc=s.entities.find(e=>e.kind==='town-center'&&e.owner===1)!;tc.position={x:20,y:20};
  const workers=s.entities.filter(e=>e.owner===1&&e.kind==='villager');
  workers.forEach((e,i)=>e.position={x:35,y:40+i*2});
  const homes:Record<string,Entity>={};
  for(const[kind,x,y]of[['castle',20,40],['university',28,30],['monastery',40,30],['stable',28,40],
    ['siege-workshop',40,40],['blacksmith',20,30],['market',40,20],['barracks',28,20]] as const){
    const r=buildingRulesFor(s,1,kind),e:Entity={id:s.nextId++,kind,owner:1,position:{x,y},hp:r.hp,maxHp:r.hp,radius:r.radius,activity:'idle',order:{kind:'idle'}};
    s.entities.push(e);homes[kind]=e;
  }
  const r=buildingRulesFor(s,2,'house'),house:Entity={id:s.nextId++,kind:'house',owner:2,position:{x:60,y:40},
    hp:r.hp-17,maxHp:r.hp,radius:r.radius,activity:'idle',order:{kind:'idle'}};s.entities.push(house);
  const monks:Entity[]=[];
  for(const[owner,x,y]of[[1,54,40],[1,64,64],[2,70,70]]as const){
    const r=unitRulesFor(s,owner,'monk'),e:Entity={id:s.nextId++,kind:'monk',owner,position:{x,y},hp:r.hp,maxHp:r.hp,radius:r.radius,activity:'idle',order:{kind:'idle'}};
    s.entities.push(e);monks.push(e);
  }
  activateAutomaticTechnologies(s);await b.stage(s);
  const beforeAge=await b.snapshot();await b.research(tc.id,'castle-age');
  const aged=await b.snapshot();
  assert.equal(aged.players[1].food,beforeAge.players[1].food-b.profile.technologies['castle-age'].cost.food);
  for(const key of ['murder-holes','herbal-medicine'])assert.equal(aged.players[1].researched.filter((k:string)=>k===key).length,1);
  const farm=await b.build(workers[0].id,'farm',{x:34.5,y:50.5});assert.equal(farm.before.players[1].wood-farm.after.players[1].wood,36);
  const knight=await b.train(homes.castle.id,'dat-unit-25');await b.art(knight.id,'dat-unit-25');
  await b.research(homes.castle.id,'ironclad');
  // The actual right-click produces the source permission message before research.
  const clickHouse=async()=>{
    await b.select(monks[0].id);await b.query({type:'look',entity:house.id});
    await b.page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
    const at=await b.page.evaluate(p=>(window as any).__civProbe.screen(p),house.position);
    await b.page.mouse.click(at.x,at.y,{button:'right'});
  };
  await clickHouse();await b.page.waitForFunction(()=>document.body.innerText.includes('research Redemption'));
  assert.equal((await b.snapshot()).entities.find((e:any)=>e.id===house.id).owner,2);
  await b.research(homes.monastery.id,'redemption');await clickHouse();
  await b.until((s,id)=>s.entities.some((e:any)=>e.id===id&&e.owner===1),house.id);
  const captured=(await b.snapshot()).entities.find((e:any)=>e.id===house.id);
  assert.equal(captured.hp,house.hp);assert.equal(captured.maxHp,house.maxHp);assert(captured.convertedBuildingRules);
  await b.research(homes.monastery.id,'atonement');
  assert((await b.query({type:'command',command:{kind:'order',player:1,entityIds:[monks[1].id],targetId:monks[2].id,target:monks[2].position}})).ok);
  await b.until((s,id)=>s.entities.some((e:any)=>e.id===id&&e.owner===1),monks[2].id);
  await b.research(tc.id,'imperial-age');
  await b.research(homes.castle.id,'crenellations');await b.research(homes.castle.id,'elite-teutonic-knight');
  await b.art(knight.id,'dat-unit-554');
  const engine=await b.train(homes['siege-workshop'].id,'mangonel');
  await b.research(homes['siege-workshop'].id,'onager');await b.research(homes['siege-workshop'].id,'siege-onager');
  await b.art(engine.id,'dat-unit-588');
  await b.research(homes.university.id,'chemistry');
  await b.select(workers[0].id);
  await b.page.waitForFunction(()=>!!document.querySelector('[data-command="page-back"],[data-command="page-economic"]'));
  if(await b.page.$('[data-command="page-back"]'))await b.click('page-back');
  await b.click('page-military');assert.equal(await b.page.$('[data-command="build-bombard-tower"]'),null);
  await b.research(homes.university.id,'bombard-tower');
  const tower=await b.build(workers[0].id,'bombard-tower',{x:42.5,y:52.5});await b.art(tower.site.id,'bombard-tower');
  assert((await b.query({type:'command',command:{kind:'order',player:1,entityIds:[workers[1].id],targetId:tc.id,target:tc.position}})).ok);
  await b.until((s,id)=>s.entities.find((e:any)=>e.id===id)?.garrison?.length===1,tc.id);
  await b.select(tc.id);await b.page.waitForFunction(()=>document.body.innerText.includes('1/25 garrisoned'));
  await b.reload();
  const end=await b.snapshot();assert.equal(end.players[1].civilization,'teutons');
  const kept=end.entities.find((e:any)=>e.id===house.id);assert.equal(kept.maxHp,house.maxHp);assert(kept.convertedBuildingRules);
  assert.deepEqual(b.errors,[]);
  console.log(`TEUTONS SMOKE GREEN (${b.pending?'pending':'published enabled'} profile; real buttons/build placement/conversion feedback, retained capture, own art, garrison HUD; passive opponent)`);
}finally{await b.close();}
