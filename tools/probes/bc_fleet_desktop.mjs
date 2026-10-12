/** #163: run with npx tsx (the fixture imports authoritative TypeScript).
 * Private server, read-only public assets, two fresh Windows hardware browsers.
 * Exported checks are the SAME functions used by the runner and unit tests.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createServer as createSocketServer } from 'node:net';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { rulesFromManifest } from '../../src/sim/data.ts';
import { createGame } from '../../src/sim/game.ts';
import { SNAPSHOT_VERSION } from '../../src/dev-session.ts';

export function comparePixels(bc, png, width, height) {
  assert(Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0, 'invalid pixel dimensions');
  assert(bc && png && bc.length === width * height * 4 && png.length === bc.length, 'missing or mismatched pixel data');
  let changedPixels = 0, changedChannels = 0;
  const maxAbsPerChannel = [0, 0, 0, 0], sums = [0, 0, 0, 0];
  const histogram = Array.from({ length: 4 }, () => Array(256).fill(0));
  const examples = [];
  for (let i = 0; i < bc.length; i += 4) {
    let changed = false;
    for (let c = 0; c < 4; c++) {
      const error = Math.abs(bc[i + c] - png[i + c]);
      if (error) { changed = true; changedChannels++; }
      maxAbsPerChannel[c] = Math.max(maxAbsPerChannel[c], error);
      sums[c] += error;
      histogram[c][error]++;
    }
    if (changed) {
      changedPixels++;
      if (examples.length < 4) examples.push({ pixel: i / 4, bc: [...bc.slice(i, i + 4)], png: [...png.slice(i, i + 4)] });
    }
  }
  return { totalPixels: width * height, changedPixels, changedChannels,
    maxAbsDiff: Math.max(...maxAbsPerChannel), maxAbsPerChannel,
    meanAbsDiff: sums.reduce((a, b) => a + b, 0) / bc.length,
    meanAbsPerChannel: sums.map(sum => sum / (width * height)),
    histogram, histogramChannels: 'RGBA; index = absolute byte difference', examples };
}

export function validateTextureFormats(mode, textures) {
  if (!textures || !['compressed', 'png'].every(k => Number.isSafeInteger(textures[k]) && textures[k] >= 0)) {
    return { valid: false, reason: 'missing/invalid texture counts' };
  }
  if (mode === 'bc' && textures.compressed === 0) return { valid: false, reason: 'BC mode must load at least one compressed texture' };
  // Masks, synthesized player colour, and ineligible pages intentionally stay PNG.
  if (mode === 'png' && textures.compressed > 0) return { valid: false, reason: 'PNG mode must not load any compressed textures' };
  if (mode === 'png' && textures.png === 0) return { valid: false, reason: 'PNG mode must load at least one PNG texture' };
  if (!['bc', 'png'].includes(mode)) return { valid: false, reason: 'unknown mode' };
  return { valid: true };
}

export function checkAcceptance(bc, png) {
  const failures = [];
  for (const [mode, result] of [['bc', bc], ['png', png]]) {
    if (result?.error) failures.push(`${mode}: ${result.error}`);
    if (result?.adapter?.isFallbackAdapter !== false) failures.push(`${mode}: adapter is fallback or unspecified`);
    if (/swiftshader|llvmpipe|software/i.test(JSON.stringify(result?.adapter))) failures.push(`${mode}: adapter is software renderer`);
    if (result?.bc !== true || result?.webgpu !== true) failures.push(`${mode}: hardware WebGPU BC compression not supported`);
    const format = validateTextureFormats(mode, result?.textures);
    if (!format.valid) failures.push(`${mode}: ${format.reason}`);
    if (!result?.simulationHash || /^0+$/.test(result.simulationHash)) failures.push(`${mode}: missing simulation hash`);
    if (result?.errors?.length) failures.push(`${mode}: browser errors: ${result.errors.join('; ')}`);
    for (const phase of ['before', 'after']) {
      const sample = result?.memory?.[phase];
      if (!sample?.rows?.length || !['dedicated', 'committed'].every(k => Number.isFinite(sample[k]))) failures.push(`${mode}: missing ${phase} GPU counters`);
    }
  }
  if (JSON.stringify(bc?.adapter) !== JSON.stringify(png?.adapter)) failures.push('adapters differ between modes');
  if (bc?.simulationHash !== png?.simulationHash) failures.push('simulation hashes do not match');
  return { pass: failures.length === 0, failures };
}

export function createFleetFixture(manifest) {
  // Same five hulls, idle/attacking rows and seed as atlas_sharing_smoke.mts.
  // This is an offline rendering fixture, never mutation of a running match.
  const rules = rulesFromManifest(manifest);
  const state = createGame(11, rules);
  state.elevation.fill(0);
  const home = state.entities.find(e => e.kind === 'town-center' && e.owner === 1);
  assert(home, 'fixture needs a home town center');
  const at = home.position;
  state.entities = state.entities.filter(e => e.kind === 'town-center');
  const ships = [];
  for (const [index, kind] of ['cannon-galleon', 'fire-ship', 'galley', 'war-galley', 'galleon'].entries()) {
    const r = rules.units[kind];
    assert(r, `missing imported unit ${kind}`);
    for (const activity of ['idle', 'attacking']) {
      const ship = { id: state.nextId++, kind, owner: 1,
        position: { x: at.x + index * 2, y: at.y + (activity === 'idle' ? 5 : 9) },
        hp: r.hp, maxHp: r.hp, radius: r.radius, activity, order: { kind: 'idle' } };
      state.entities.push(ship); ships.push(ship);
    }
  }
  const { rules: ignored, ...saved } = state;
  return { snapshot: { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved },
    ships, look: [at.x + 3, at.y + 6], rect: [100, 80, 1080, 570] };
}

async function main() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const publicDir = resolve(process.env.BC_PROBE_PUBLIC ?? `${root}public`);
  const port = Number(process.env.BC_PROBE_PORT ?? 5281);
  assert(Number.isInteger(port) && port > 1024 && port < 65536 && ![5173, 5174].includes(port), 'use a private probe port');
  const out = `${root}.local/probes`;
  await mkdir(out, { recursive: true });
  const exec = promisify(execFile);
  const ps = async code => (await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code],
    { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
  const manifestBytes = await readFile(`${publicDir}/imported/aoe2/manifest.json`);
  const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
  const fixture = createFleetFixture(JSON.parse(manifestBytes));
  const manifestGzip = gzipSync(manifestBytes);
  const client = await readFile(new URL('./bc_fleet_client.js', import.meta.url));
  let browserPid, browserReady, resolveResult;
  const tree = () => `$all = @(Get-CimInstance Win32_Process); $ids = @(${browserPid});
    do { $next = @($all | Where-Object { $_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids } | ForEach-Object { $_.ProcessId }); $ids += $next } while ($next.Count);`;
  async function memory() {
    await browserReady;
    assert(browserPid);
    return JSON.parse(await ps(`${tree()}
      $rows = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory | Where-Object { $_.Name -match '^pid_(\\d+)_' -and [int]$Matches[1] -in $ids });
      @{ pids=$ids; rows=@($rows | Select-Object Name,DedicatedUsage,SharedUsage,TotalCommitted);
         dedicated=($rows | Measure-Object DedicatedUsage -Sum).Sum;
         shared=($rows | Measure-Object SharedUsage -Sum).Sum;
         committed=($rows | Measure-Object TotalCommitted -Sum).Sum } | ConvertTo-Json -Depth 5`));
  }
  const server = await createServer({ root, configFile: `${root}vite.config.ts`, publicDir,
    plugins: [{ name: 'bc-fleet-acceptance', enforce: 'pre',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          const url = new URL(req.url, 'http://localhost');
          const json = value => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)); };
          (async () => {
            if (url.pathname === '/imported/aoe2/manifest.json') {
              res.setHeader('content-type', 'application/json'); res.setHeader('content-encoding', 'gzip'); return res.end(manifestGzip);
            }
            if (url.pathname === '/fleet/client.js') { res.setHeader('content-type', 'text/javascript'); return res.end(client); }
            if (url.pathname === '/fleet/fixture') return json(fixture);
            if (url.pathname === '/fleet/memory') return json(await memory());
            if (url.pathname === '/fleet/result' && req.method === 'POST') {
              const chunks = []; for await (const chunk of req) chunks.push(chunk);
              const value = JSON.parse(Buffer.concat(chunks).toString());
              json({ ok: true }); resolveResult(value); return;
            }
            if (url.pathname === '/fleet/start') {
              res.setHeader('content-type', 'text/html');
              return res.end('<!doctype html><script type="module" src="/fleet/client.js"></script>');
            }
            next(); // Never swallow the actual app, Vite modules or asset requests.
          })().catch(error => { res.statusCode = 500; json({ error: String(error) }); resolveResult?.({ error: String(error) }); });
        });
      },
      transformIndexHtml() { return [{ tag: 'script', attrs: { type: 'module', src: '/fleet/client.js' }, injectTo: 'head-prepend' }]; },
      transform(code, id) {
        if (!id.endsWith('/src/main.ts')) return;
        const init = 'await renderer.init();', loop = 'renderer.setAnimationLoop(now => {';
        assert(code.includes(init) && code.includes(loop), 'probe anchors must match');
        return code.replace(init, `${init}\nObject.assign(globalThis, { __fleetRenderer: renderer,
          __fleetBefore: await fetch('/fleet/memory').then(r => r.json()) });`)
          .replace(loop, `${loop}\npaused = true; now = 0; previous = 0;
            Object.assign(globalThis, { __fleetViews: views, __fleetAssets: assets });`);
      },
    }], server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
  const results = [], processes = [];
  let summary;
  try {
    await server.listen();
    console.log(`private Vite pid=${process.pid} port=${port} publicDir=${publicDir}; manifest=${manifestSha256}`);
    for (const mode of ['bc', 'png']) {
      let timer, launch;
      const result = new Promise((resolve, reject) => {
        resolveResult = resolve;
        timer = setTimeout(() => reject(new Error(`${mode}: fleet probe exceeded 180s`)), 180_000);
      });
      // Attach immediately: launch errors must not leave a later unhandled timeout.
      result.catch(() => {});
      try {
        browserReady = ps(`$browser = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
          if (!(Test-Path $browser)) { throw 'Brave desktop browser unavailable' }
          $profile = Join-Path $env:TEMP ('open-empires-bc163-fleet-' + [Guid]::NewGuid());
          $p = Start-Process -PassThru -FilePath $browser -ArgumentList @('--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--window-size=1280,800','--force-device-scale-factor=1',
            ('--user-data-dir=' + $profile),'http://localhost:${port}/fleet/start?mode=${mode}');
          @{ pid=$p.Id; profile=$profile; browserVersion=(Get-Item $browser).VersionInfo.ProductVersion;
             gpus=@(Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion) } | ConvertTo-Json -Depth 4`).then(text => {
          launch = JSON.parse(text); browserPid = launch.pid; processes.push({ mode, ...launch });
          console.log(`${mode}: Windows browser pid=${browserPid} profile=${launch.profile}`);
          return writeFile(`${out}/bc163-fleet-processes.json`, JSON.stringify(processes, null, 2));
        });
        await browserReady;
        const measured = await result;
        measured.mode = mode;
        measured.platform = launch;
        measured.manifestSha256 = manifestSha256;
        results.push(measured);
        console.log(`${mode}: ${JSON.stringify({ error: measured.error, textures: measured.textures, hash: measured.simulationHash })}`);
      } catch (error) {
        results.push({ mode, error: String(error), platform: launch });
      } finally {
        clearTimeout(timer);
        // Preserve measurements even if cleanup itself fails.
        await writeFile(`${out}/bc163-fleet-${mode}.json`, JSON.stringify(results.at(-1), null, 2));
        if (browserPid) {
          const cleanup = JSON.parse(await ps(`${tree()}
            $ids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue };
            $ids | ForEach-Object { Wait-Process -Id $_ -Timeout 10 -ErrorAction SilentlyContinue };
            Remove-Item -LiteralPath '${launch.profile.replaceAll("'", "''")}' -Recurse -Force -ErrorAction SilentlyContinue;
            $remaining = @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -in $ids } | ForEach-Object { $_.ProcessId });
            @{ stopped=$ids; remaining=$remaining } | ConvertTo-Json`));
          processes.at(-1).cleanup = cleanup;
          await writeFile(`${out}/bc163-fleet-processes.json`, JSON.stringify(processes, null, 2));
          console.log(`${mode}: cleanup ${JSON.stringify(cleanup)}`);
          if (cleanup.remaining.length) {
            results.at(-1).error = `owned Windows processes did not terminate: ${cleanup.remaining}`;
            await writeFile(`${out}/bc163-fleet-${mode}.json`, JSON.stringify(results.at(-1), null, 2));
            throw new Error(results.at(-1).error);
          }
        }
        browserPid = undefined;
      }
    }
    const [bc, png] = results;
    summary = { ...checkAcceptance(bc, png), manifestSha256, publicDir, port,
      adapter: bc.adapter, platform: bc.platform, processes,
      memory: results.map(r => ({ mode: r.mode,
        dedicatedDelta: r.memory ? r.memory.after.dedicated - r.memory.before.dedicated : null,
        committedDelta: r.memory ? r.memory.after.committed - r.memory.before.committed : null })),
      textures: { bc: bc.textures, png: png.textures },
      textureScope: 'resident/bytes: SpriteResidency; compressed/png: ContentAssets.textures (also contains terrain/water pages)',
      hashes: { bc: bc.simulationHash, png: png.simulationHash },
      fixture: { seed: 11, ships: fixture.ships, look: fixture.look, rect: fixture.rect, tick: fixture.snapshot.state.tick } };
    try {
      assert.deepEqual(bc.view, png.view, 'camera/crop/viewport must be identical');
      assert.equal(bc.tick, png.tick, 'capture tick must match');
      assert.deepEqual(bc.images, png.images, 'fleet must request identical atlas pages');
      assert(bc.pixels?.colorSpace === 'srgb' && bc.pixels.colorSpace === png.pixels?.colorSpace, 'missing/mismatched pixel colour space');
      assert.equal(bc.pixels.width, png.pixels.width); assert.equal(bc.pixels.height, png.pixels.height);
      summary.pixelDifference = { colorSpace: bc.pixels.colorSpace,
        ...comparePixels(Buffer.from(bc.pixels.data, 'base64'), Buffer.from(png.pixels.data, 'base64'), bc.pixels.width, bc.pixels.height) };
    } catch (error) { summary.pass = false; summary.failures.push(String(error)); }
  } finally {
    await server.close();
    // Binding the same port after close proves it is free; do not kill by name.
    const socket = createSocketServer();
    await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(port, '127.0.0.1', resolve); });
    await new Promise(resolve => socket.close(resolve));
    console.log(`private port ${port} free; owned browser cleanup recorded`);
  }
  await writeFile(`${out}/bc163-fleet-summary.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  assert(summary.pass, summary.failures.join('\n'));
  console.log('FLEET BC ACCEPTANCE COMPLETE (pixel differences reported, not thresholded)');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
