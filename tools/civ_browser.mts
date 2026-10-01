/** Private owned-profile acceptance. Explicit staging, passive opponent, UI/public commands. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { researchCostFor } from '../src/sim/technologies.ts';
import { pageOf } from '../src/view/build-menu.ts';
import { displayName } from '../src/view/names.ts';
import type { BuildingKind, GameState } from '../src/sim/types.ts';

export async function civilizationBrowser(civ: string, port = 5269) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const manifest = JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'));
  const profile = manifest.civilizations[civ]; assert(profile, `${civ} must be imported`);
  const pending = process.env.CIV_ACCEPT_PENDING === '1';
  if (pending) profile.civilization.enabled = true;
  assert.equal(profile.civilization.enabled, true);
  const rules = rulesFromManifest(manifest), body = pending ? gzipSync(JSON.stringify(manifest)) : undefined;
  const server = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error',
    server: { host: '127.0.0.1', port, strictPort: true }, plugins: [{
      name: 'owned-civ-acceptance', enforce: 'pre',
      configureServer(server) { if (body) server.middlewares.use((req,res,next) => {
        if (req.url?.split('?')[0] !== '/imported/aoe2/manifest.json') return next();
        res.writeHead(200, { 'Content-Type':'application/json', 'Content-Encoding':'gzip' }); res.end(body);
      }); },
      transform(code,id) { if (!id.endsWith('/src/main.ts')) return;
        return code.replace('let paused = false;', 'let paused = true;')
          .replace('exampleAiCommands(observe(game, 2))', '[]')
          .replace('renderer.setAnimationLoop(now => {', `renderer.setAnimationLoop(now => {
          Object.assign(globalThis,{__civProbe:{paused:()=>paused,speed:()=>gameSpeed(),
            screen:at=>{const iso=elevatedWorldToIso(game,at.x,at.y); const p=new THREE.Vector3(iso.x,iso.y,0).project(camera);
              return{x:(p.x+1)*innerWidth/2,y:(1-p.y)*innerHeight/2};},
            preview:()=>({kind:buildMode,target:placementTarget(),tint:ghostFootprint?.material.color.getHex()}),
            art:id=>{const e=game.entities.find(e=>e.id===id);if(!e)return;const v=views.get('e'+id);
              return{key:artKey(assets,e,chooseAnimation(game,e).key,game.matchSeed),name:nameOf(e),texture:v?.body.textureImage,
                pending:v?.body.pendingTexture,fallback:v?.fallback};}}});`);
      },
    }] });
  await server.listen();
  const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
  const browser = await puppeteer.launch({ headless:true,
    env: existsSync(libs) ? {...process.env,LD_LIBRARY_PATH:libs} : process.env,
    args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-features=WebGPU'] });
  const page = await browser.newPage(); await page.setViewport({width:1280,height:800});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
  const ready=()=>page.waitForFunction(()=>!!(window as any).__civProbe&&!!(window as any).__empiresDebug,{timeout:120000});
  const query=(q:object):Promise<any>=>page.evaluate(q=>(window as any).__empiresDebug(q),q);
  const snapshot=()=>query({type:'snapshot'});
  const select=async(id:number)=>{await query({type:'select',ids:[id]});};
  const click=(key:string)=>page.locator(`[data-command="${key}"]`).click();
  const pause=async(value:boolean)=>{if(await page.evaluate(()=>(window as any).__civProbe.paused())!==value)await page.keyboard.press('F3');};
  const until=async(fn:(s:any,a:any)=>boolean,arg:any=null)=>{
    await pause(false);
    try{await page.waitForFunction(async(code,arg)=>new Function('s','a',`return (${code})(s,a)`)(
      await(window as any).__empiresDebug({type:'snapshot'}),arg),{timeout:120000,polling:100},fn.toString(),arg);
    }catch(error){
      const state=await snapshot();
      console.error('CIV PROBE WAIT FAILURE',JSON.stringify({arg,tick:state.tick,
        paused:await page.evaluate(()=>(window as any).__civProbe.paused()),
        entities:state.entities.filter((e:any)=>e.owner===1).map((e:any)=>({id:e.id,kind:e.kind,
          position:e.position,order:e.order,buildProgress:e.buildProgress,pathGoal:e.pathGoal}))}));
      throw error;
    }finally{await pause(true);}
  };
  const reload=async()=>{await page.reload({waitUntil:'domcontentloaded'});await ready();};
  const menu=async(rival:string)=>{
    await page.goto(`http://127.0.0.1:${port}/?solo=1`,{waitUntil:'domcontentloaded'});await ready();
    await page.keyboard.press('F10');await page.select('#civilization-1',civ);await page.select('#civilization-2',rival);
    await page.locator('#map-setup button[type="submit"]').click();await pause(true);
    assert.equal((await snapshot()).players[1].civilization,civ);
    await reload();assert.equal((await snapshot()).players[1].civilization,civ);
    await page.keyboard.press('F10');await page.locator('#menu-dialog [data-menu="restart"]').click();await pause(true);
    assert.equal((await snapshot()).players[1].civilization,civ);
  };
  const stage=async(state:GameState)=>{
    const{rules:ignored,...saved}=state;
    const handle=await page.evaluateOnNewDocument(v=>sessionStorage.setItem('open-empires-lab:dev-session',JSON.stringify(v)),{
      version:SNAPSHOT_VERSION,rulesOrigin:rules.origin,state:saved,setup:{seed:state.matchSeed,map:'arabia',
        civilizations:{1:state.players[1].civilization,2:state.players[2].civilization}},
    });
    await reload();await page.removeScriptToEvaluateOnNewDocument(handle.identifier);
    assert.equal((await snapshot()).nextId,state.nextId,'scenario resumed');
    for(let i=0;i<6;i++)await page.keyboard.press('+');
  };
  const research=async(id:number,key:string)=>{
    await select(id);await page.waitForSelector(`[data-command="research-${key}"]`);
    const before=await snapshot();await click(`research-${key}`);const paid=await snapshot();
    const price=researchCostFor({...before,rules},1,key);
    for(const r of ['food','wood','gold','stone'] as const)assert.equal(before.players[1][r]-paid.players[1][r],price[r]);
    await until((s,key)=>s.players[1].researched.includes(key),key);console.log(civ,'paid research',key,'GREEN');
  };
  const train=async(id:number,kind:string)=>{
    await select(id);const before=await snapshot();await click(`train-${kind}`);
    await until((s,a)=>s.entities.some((e:any)=>e.owner===1&&e.kind===a.kind&&e.id>=a.next),{kind,next:before.nextId});
    return(await snapshot()).entities.find((e:any)=>e.owner===1&&e.kind===kind&&e.id>=before.nextId);
  };
  const art=async(id:number,kind:string)=>{
    await query({type:'look',entity:id});await select(id);
    await page.waitForFunction(({id,key})=>{const a=(window as any).__civProbe.art(id);return a?.key===key&&a.texture&&!a.pending&&!a.fallback;},
      {timeout:120000},{id,key:`civilizations/${civ}/${kind}`});
    const shown=await page.evaluate(id=>(window as any).__civProbe.art(id),id),entity=profile.entities[kind];
    assert.equal(shown.name,displayName(kind,entity.text.name));
    const images=Object.values(entity.atlases).flatMap((a:any)=>[a.image,...(a.pages??[]).map((p:any)=>p.image)]);
    assert(images.includes(shown.texture),JSON.stringify({id,kind,shown,images}));
  };
  const build=async(worker:number,kind:BuildingKind,target:{x:number;y:number})=>{
    await select(worker);await page.waitForFunction(()=>!!document.querySelector('[data-command="page-back"],[data-command="page-economic"]'));
    if(await page.$('[data-command="page-back"]'))await click('page-back');
    await click(`page-${pageOf(kind)}`);await click(`build-${kind}`);await query({type:'look',rect:[target.x,target.y]});
    await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
    const at=await page.evaluate(p=>(window as any).__civProbe.screen(p),target);await page.mouse.move(at.x,at.y);
    await page.waitForFunction(({kind,target})=>{const p=(window as any).__civProbe.preview();return p.kind===kind&&p.tint===0x7fff9e&&p.target.x===target.x&&p.target.y===target.y;},{},{kind,target});
    const before=await snapshot();await page.mouse.click(at.x,at.y);const after=await snapshot();
    const site=after.entities.find((e:any)=>e.owner===1&&e.kind===kind&&e.buildProgress!==undefined&&e.id>=before.nextId);assert(site);
    await until((s,id)=>s.entities.some((e:any)=>e.id===id&&e.buildProgress===undefined),site.id);
    return{site,before,after};
  };
  const close=async()=>{try{await browser.close();}finally{await server.close();}};
  return{civ,pending,manifest,profile,rules,page,errors,query,snapshot,select,click,pause,until,reload,menu,stage,research,train,art,build,close};
}
