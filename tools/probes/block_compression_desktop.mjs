/** #163: isolated Windows hardware-WebGPU evaluation from WSL. No game import
 * or live browser is modified. Artifacts remain in .local/probes/. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const port = Number(process.env.BC_PROBE_PORT ?? 5280);
const fixture = await readFile(`${root}.local/probes/bc163-fixture.json`);
const client = await readFile(new URL('./block_compression_client.js', import.meta.url));
const ps = async code => (await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code],
  { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
let browserPid, resolveResult, browserReady;
async function memory() {
  await browserReady;
  assert(browserPid);
  return JSON.parse(await ps(`$all = @(Get-CimInstance Win32_Process); $ids = @(${browserPid});
    do { $next = @($all | Where-Object { $_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids } | ForEach-Object { $_.ProcessId }); $ids += $next } while ($next.Count);
    $rows = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory | Where-Object { $_.Name -match '^pid_(\\d+)_' -and [int]$Matches[1] -in $ids });
    @{ pids=$ids; rows=@($rows | Select-Object Name,DedicatedUsage,SharedUsage,TotalCommitted);
       dedicated=($rows | Measure-Object DedicatedUsage -Sum).Sum;
       shared=($rows | Measure-Object SharedUsage -Sum).Sum;
       committed=($rows | Measure-Object TotalCommitted -Sum).Sum } | ConvertTo-Json -Depth 5`));
}
const handler = (req, res) => {
  (async () => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/fixture') { res.setHeader('content-type', 'application/json'); return res.end(fixture); }
    if (url.pathname === '/client.js') { res.setHeader('content-type', 'text/javascript'); return res.end(client); }
    if (url.pathname === '/memory') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(await memory())); }
    if (url.pathname === '/result' && req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const result = JSON.parse(Buffer.concat(chunks).toString());
      res.end('ok'); resolveResult(result); return;
    }
    res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Owned block compression evaluation</title><script type="module" src="/client.js"></script>');
  })().catch(error => { res.statusCode = 500; res.end(String(error)); resolveResult({ error: String(error) }); });
};
const server = await createServer({ root, configFile: `${root}vite.config.ts`,
  plugins: [{ name: 'block-compression-evaluation', enforce: 'pre',
    configureServer(s) { s.middlewares.use(handler); } }],
  server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
await server.listen();
const results = [];
const modes = process.env.BC_PROBE_MODE === 'decode' ? ['decode'] : ['rgba', 'bc'];
try {
  for (const mode of modes) {
    let timer, launch;
    const result = new Promise((resolve, reject) => { resolveResult = resolve; timer = setTimeout(() => reject(new Error('desktop probe exceeded 180s')), 180_000); });
    try {
      // A fresh profile prevents attaching to or disturbing the user's browser.
      browserReady = ps(`$browser = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
        if (!(Test-Path $browser)) { throw 'Brave desktop browser unavailable' }
        $profile = Join-Path $env:TEMP ('open-empires-bc163-' + [Guid]::NewGuid());
        $p = Start-Process -PassThru -FilePath $browser -ArgumentList @('--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking',
          ('--user-data-dir=' + $profile),'http://localhost:${port}/?allocation=${mode}${process.env.BC_PROBE_READBACK === '1' ? '&readback=1' : ''}');
        @{ pid=$p.Id; profile=$profile; browserVersion=(Get-Item $browser).VersionInfo.ProductVersion;
           gpus=@(Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion) } | ConvertTo-Json -Depth 4`).then(text => {
        launch = JSON.parse(text); browserPid = launch.pid;
      });
      await browserReady;
      const measured = await result;
      measured.platform = { browserVersion: launch.browserVersion, gpus: launch.gpus };
      results.push(measured);
      await writeFile(`${root}.local/probes/bc163-${mode}.json`, JSON.stringify(measured, null, 2));
      assert.equal(measured.error, undefined, JSON.stringify(measured));
      assert.equal(measured.supported, true, 'hardware WebGPU required for desktop acceptance');
      assert.equal(measured.bc, true, 'desktop must expose BC compression');
      assert.equal(measured.adapter.isFallbackAdapter, false, 'desktop acceptance requires a hardware adapter');
      assert(!/swiftshader|llvmpipe|software/i.test(JSON.stringify(measured.adapter)), 'software renderer cannot establish desktop GPU evidence');
      assert.deepEqual(measured.errors, []);
      for (const row of measured.comparisons) {
        assert.equal(row.fallback.pixels, 0);
        if (row.pngDecode) assert.equal(row.pngDecode.pixels, 0, 'PNG reference must preserve current decoder bytes');
      }
      if (measured.memory) assert(measured.memory.before.rows.length && measured.memory.allocated.rows.length, 'OS GPU memory counters must exist');
      console.log(`${mode}: captured source comparisons and OS memory counters`);
    } finally {
      clearTimeout(timer);
      if (browserPid) await ps(`$all = @(Get-CimInstance Win32_Process); $ids = @(${browserPid});
        do { $next = @($all | Where-Object { $_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids } | ForEach-Object { $_.ProcessId }); $ids += $next } while ($next.Count);
        $ids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue };
        Remove-Item -LiteralPath '${launch.profile.replaceAll("'", "''")}' -Recurse -Force -ErrorAction SilentlyContinue`);
      browserPid = undefined;
    }
  }
  if (results.length === 2) assert.deepEqual(results[0].comparisons, results[1].comparisons, 'fresh browser processes must agree on rendered pixels');
  const memory = results.filter(result => result.memory).map(result => ({ mode: result.memory.mode, payloadBytes: result.memory.payloadBytes,
    dedicatedDelta: result.memory.allocated.dedicated - result.memory.before.dedicated,
    committedDelta: result.memory.allocated.committed - result.memory.before.committed,
    dedicatedAfterDestroy: result.memory.released.dedicated - result.memory.before.dedicated }));
  assert(memory.every(row => row.dedicatedDelta > 0), 'allocations must appear in OS counters');
  if (memory.length) assert(memory[1].dedicatedDelta < memory[0].dedicatedDelta, 'compressed allocations must reduce measured GPU memory');
  const summary = { adapter: results[0].adapter, platform: results[0].platform, memory,
    comparisons: results[0].comparisons.map(({ key, layer, colourSpace, pixels, compressed }) =>
      ({ key, layer, colourSpace, sampledPixels: pixels, ...compressed })),
    adoptSourceBlocksWithoutPixelChanges: results[0].comparisons.every(row => row.compressed.pixels === 0) };
  await writeFile(`${root}.local/probes/bc163-${modes.length === 1 ? 'decode-summary' : 'summary'}.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log('DESKTOP BC EVALUATION COMPLETE; adoption requires zero changed pixels, not merely reduced allocation bytes.');
} finally { await server.close(); }
