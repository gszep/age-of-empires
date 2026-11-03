/** #349 stage 2 + review: the start screen and the pre-match setup flow, by
 * real clicks, tabs and wheel on a private host — start -> Single Player ->
 * match setup -> Start Game, separate from the pause menu. Covers the review
 * findings: a truly hidden/nonfocusable Return; replay loading from startup
 * (success hides the start screen, cancel/rejection preserve the setup
 * surface); background keyboard/wheel isolation while the setup surface
 * stays usable; no solo start screen for shared sessions even with ?menu=1;
 * fresh standalone launches starting here with the placeholder never saved as
 * a resumable match; Quit Current Game enabled for every solo launch
 * (pinned ?map=/?seed= included) with Return restoring the exact match; and
 * small-viewport setup exercising every control and submit, plus a synthetic
 * native StartScreen fixture. Fallback mode by default; a published import is
 * served automatically when public/ exists, where every material the screen
 * uses must resolve on the loaded page.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser } from 'puppeteer';
import { createServer } from 'vite';
import { FALLBACK_RULES, rulesFromManifest, TICK_SECONDS } from '../src/sim/data.ts';
import { CHECKSUM_INTERVAL_TICKS, runMatch } from '../src/headless/runner.ts';
import { sharedMatchPlugin } from '../src/shared/server.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicDir = existsSync(`${root}public/imported/aoe2/manifest.json`) ? 'public' : false;
const port = 5251;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, publicDir, logLevel: 'error',
  server: { host: '127.0.0.1', port, strictPort: true } });
const errors: string[] = [];
const fixtures = mkdtempSync(`${root}.local/start-files-`);
let browser: Browser | undefined;
let sharedServer: Awaited<ReturnType<typeof createServer>> | undefined;
try {
  await server.listen();
  const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
  browser = await puppeteer.launch({ headless: true,
    env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument('globalThis.__name = f => f');
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', error => { errors.push(String(error)); console.error(error); });
  await page.goto(`http://127.0.0.1:${port}/?solo=1&menu=1`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000 });
  const query = (request: object): Promise<any> => page.evaluate(value => (window as any).__empiresDebug(value), request);
  const until = (expression: string) => page.waitForFunction(async text => {
    const state = await (window as any).__empiresDebug({ type: 'sim' });
    return new Function('s', `return ${text}`)(state);
  }, { timeout: 30_000 }, expression);
  const startShown = () => page.$eval('#start-screen', e => !e.classList.contains('hidden'));
  const entries = async () => page.$$eval('#start-screen .start-stack button', bs => bs.map(b => ({
    start: b.dataset.start ?? '', label: (b.textContent ?? '').trim(), disabled: b.disabled,
    title: b.title, hidden: b.hidden })));
  const native = await page.$eval('#start-screen', e => !!e.querySelector('.native-button'));

  // The deterministic QA entry: a fresh solo launch opens on the start screen,
  // with no live match behind it and the pause menu never involved.
  await page.waitForSelector('#start-screen:not(.hidden)');
  assert(await startShown(), 'the start screen is shown');
  assert.equal(await page.$eval('#menu-dialog', e => e.classList.contains('hidden')), true,
    'the pause menu is not part of the startup flow');
  const list = await entries();
  assert.deepEqual(list.map(e => [e.start, e.label]), [
    ['single-player', 'Single Player'], ['learn-to-play', 'Learn to Play'],
    ['co-op', 'Co-Op Campaigns'], ['multiplayer', 'Multiplayer'], ['editors', 'Editors'],
    ['mods', 'Mods'], ['more-content', 'More Content'], ['exit', 'Exit'],
    ['agents', 'Agent vs Agent (Lab) — coming next'], ['return', 'Return to Match'],
  ], 'the native ribbon order, then the labelled lab entries');
  const disabled = list.filter(e => e.disabled);
  assert.deepEqual(disabled.map(e => e.start),
    ['learn-to-play', 'co-op', 'multiplayer', 'editors', 'mods', 'more-content', 'exit', 'agents'],
    'unsupported modes stay present and disabled, agent-vs-agent included');
  for (const entry of disabled) {
    assert(entry.title.includes('our product policy') && entry.title.includes('unverified'),
      `${entry.start}: the grey-out is stated as our policy, not native runtime behaviour`);
  }
  const agents = list.find(e => e.start === 'agents')!;
  assert(agents.label.includes('coming next') && agents.title.includes('#352'),
    'the agent entry is labelled coming next and cites its integration issue');
  // Review finding 1: with no live match behind the screen, Return is truly
  // invisible and cannot take focus — the button skins must not defeat hidden.
  assert.equal(await page.$eval('#start-screen [data-start="return"]', e => (e as HTMLElement).offsetParent), null,
    'the Return entry is truly invisible on a fresh start');
  assert.equal(await page.evaluate(() => {
    const button = document.querySelector('[data-start="return"]') as HTMLElement | null;
    button?.focus();
    return document.activeElement === button;
  }), false, 'the hidden Return entry cannot take focus');
  assert.equal((await query({ type: 'sim' })).connection.paused, true,
    'the hidden pre-dealt board is paused while the start screen is up');
  await page.evaluate(() => { (window as any).__marker = 0x349; });

  // Disabled modes are inert: a sweep of disabled clicks leaves the screen up
  // and touches nothing.
  for (const entry of disabled) {
    await page.click(`#start-screen [data-start="${entry.start}"]`);
    assert(await startShown(), `${entry.start}: a disabled click cannot leave the start screen`);
  }
  await page.keyboard.press('F10');
  assert(await startShown() && await page.$eval('#menu-dialog', e => e.classList.contains('hidden')),
    'F10 cannot open the pause menu over the start screen');

  // Review finding 3: an ordinary overlay div traps no focus — Tab must stay
  // inside the start screen, covered HUD controls must refuse focus, and the
  // wheel must belong to the start screen, not to the covered match's zoom or
  // camera.
  await page.focus('#start-screen [data-start="single-player"]');
  for (let tab = 0; tab < 4; tab++) await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.closest('#start-screen') !== null), true,
    'Tab cycles inside the start screen and cannot reach the covered HUD');
  await page.keyboard.down('Shift');
  for (let tab = 0; tab < 4; tab++) await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  assert.equal(await page.evaluate(() => document.activeElement?.closest('#start-screen') !== null), true,
    'Shift+Tab cannot reach the covered HUD or the hidden Return');
  assert.equal(await page.evaluate(() => {
    const covered = document.querySelector('#menu-panel [data-command="diplomacy"]') as HTMLElement | null;
    covered?.focus();
    return document.activeElement === covered;
  }), false, 'a covered HUD control cannot take focus behind the start screen');
  const anchor = (await query({ type: 'entities', owner: 1 })).entities.find((e: any) => e.kind === 'town-center');
  assert(anchor, 'a static player town center anchors the camera/zoom comparison');
  await page.mouse.move(640, 400);
  for (let roll = 0; roll < 5; roll++) await page.mouse.wheel(0, -100);
  for (let key = 0; key < 3; key++) await page.keyboard.press('ArrowDown');
  const moved = (await query({ type: 'entities', owner: 1 })).entities.find((e: any) => e.id === anchor.id);
  assert.equal(moved.screen.x, anchor.screen.x, 'the wheel over the start screen cannot zoom the covered match');
  assert.equal(moved.screen.y, anchor.screen.y, 'arrow keys behind the start screen cannot pan the covered match');
  assert.equal(await page.evaluate(() => (window as any).__marker), 0x349, 'no reload happened');

  // Review finding 7: on a small viewport every visible entry stays reachable,
  // and the setup surface's every control stays usable — the full flow works,
  // not just rectangles.
  await page.setViewport({ width: 480, height: 360 });
  for (const entry of (await entries()).filter(e => !e.hidden)) {
    const reachable = await page.$eval(`#start-screen [data-start="${entry.start}"]`, element => {
      element.scrollIntoView({ block: 'nearest' });
      const r = element.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { reachable: !!hit && element.contains(hit), width: r.width, height: r.height,
        fits: element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight };
    });
    assert(reachable.reachable && reachable.width > 0 && reachable.height > 0 && reachable.fits,
      `${entry.start}: label fits and its center is scroll-reachable on a small viewport`);
  }
  const civChoices = await page.$$eval('#civilization-1 option', os => os.map(o => o.value));
  assert(civChoices.length >= 1, 'the civilization picker kept its choices');
  const civ1 = civChoices[0];
  const civ2 = civChoices.find(value => value !== civ1) ?? civ1;
  await page.click('#start-screen [data-start="single-player"]');
  await page.waitForSelector('#lab-dialog[open]');
  await page.select('#civilization-1', civ1);
  await page.select('#civilization-2', civ2);
  await page.select('#map-choice', 'senlac');
  await page.click('#random-map-seed');
  assert.equal(await page.$eval('#map-seed', e => (e as HTMLInputElement).value), '',
    'the Random seed button clears the seed field');
  await page.locator('#map-seed').fill('77');
  await page.select('#population-limit', '25');
  await page.click('#regicide-mode');
  await page.click('#wonder-victory');
  const behindSetup = await query({ type: 'sim' });
  await page.keyboard.press('F3');
  await page.keyboard.press('Delete');
  await page.mouse.wheel(0, 100);
  assert.equal((await query({ type: 'sim' })).synchronizationHash, behindSetup.synchronizationHash,
    'setup input cannot unpause or issue covered game commands');
  await page.click('#map-setup button[type="submit"]');
  await page.waitForSelector('#start-screen.hidden');
  await page.waitForSelector('#menu-dialog.hidden');
  await page.waitForFunction(() => !document.querySelector<HTMLDialogElement>('#lab-dialog')!.open);
  await until("s.connection.setup.map === 'senlac' && s.connection.setup.seed === 77 && s.connection.setup.mode === 'regicide'");
  const smallStart = await query({ type: 'snapshot' });
  assert.equal(smallStart.populationLimit, 25, 'the small-viewport population choice is applied');
  assert.equal(smallStart.wonderVictory, true, 'the small-viewport wonder choice is applied');
  assert.equal(smallStart.players[1].civilization, civ1, 'the small-viewport civilization choices are applied');
  assert.equal(smallStart.players[2].civilization, civ2, 'the small-viewport civilization choices are applied');
  await until('s.tick >= 5');
  console.log('Small viewport: every setup control usable and submitted (senlac, seed 77, regicide, pop 25, wonder, civs): PASS');
  await page.setViewport({ width: 1280, height: 800 });

  // Quit Current Game is enabled on this solo launch and reaches a real
  // destination — no reload, the match paused behind the screen — and Return
  // brings it back with the paused-state hint.
  await page.keyboard.press('F10');
  await page.waitForSelector('#menu-dialog:not(.hidden)');
  assert.equal(await page.$eval('#menu-dialog [data-menu="quit"]', e => (e as HTMLButtonElement).disabled), false,
    'Quit Current Game is enabled with a working start destination');
  await page.keyboard.down('ArrowDown');
  await page.click('#menu-dialog [data-menu="quit"]');
  await page.waitForSelector('#start-screen:not(.hidden)');
  await page.waitForSelector('#menu-dialog.hidden');
  await until('s.connection.paused');
  const pausedAt = (await query({ type: 'sim' })).tick;
  const coveredAnchor = (await query({ type: 'entities', owner: 1 })).entities.find((e: any) => e.kind === 'town-center');
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 600)));
  await page.keyboard.up('ArrowDown');
  assert.deepEqual((await query({ type: 'entities', owner: 1 })).entities.find((e: any) => e.id === coveredAnchor.id).screen,
    coveredAnchor.screen, 'an arrow held before Quit cannot pan the covered game');
  assert.equal((await query({ type: 'sim' })).tick, pausedAt,
    'the paused match never advanced behind the start screen');
  assert.equal(await page.evaluate(() => (window as any).__marker), 0x349, 'quitting is not a reload');
  assert.equal(await page.$eval('#start-screen [data-start="return"]', e => (e as HTMLElement).hidden), false,
    'a live match behind the screen offers Return');
  await page.click('#start-screen [data-start="return"]');
  await page.waitForSelector('#start-screen.hidden');
  await until('s.connection.paused');
  assert.equal(await page.evaluate(() => (window as any).__marker), 0x349, 'returning is not a reload');
  assert(await page.$eval('#game-message', e => (e.textContent ?? '').includes('F3')),
    'a paused Return says how to resume');
  await page.keyboard.press('F3');
  await until('!s.connection.paused');
  console.log('Quit-to-start (no reload, paused behind, Return with hint): PASS');

  // Review finding 2: the startup replay route. A cancelled or rejected load
  // leaves the setup surface up; a successful load takes over the page — the
  // start screen must hide and real playback must be visible.
  const rules = publicDir ? rulesFromManifest(JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'))) : FALLBACK_RULES;
  // Playback ends at the last recorded checksum. A two-second fixture has
  // none and cannot establish visible playback; record one full interval.
  const replay = await runMatch({ version: 2, seed: 253, populationLimit: 25,
    maxTimeSeconds: CHECKSUM_INTERVAL_TICKS * TICK_SECONDS },
    { 1: { decide: () => [] }, 2: { decide: () => [] } }, rules);
  assert.equal(replay.record.checksums.length, 1, 'the playback fixture includes a real checksum');
  const replayPath = `${fixtures}/replay.json`;
  const junkPath = `${fixtures}/junk.json`;
  const malformedPath = `${fixtures}/malformed.json`;
  const incompatiblePath = `${fixtures}/incompatible.json`;
  const brokenPath = `${fixtures}/broken.json`;
  writeFileSync(replayPath, JSON.stringify(replay.record));
  writeFileSync(junkPath, JSON.stringify({ not: 'a replay' }));
  writeFileSync(malformedPath, '{');
  writeFileSync(incompatiblePath, JSON.stringify({ ...replay.record, rulesOrigin: 'incompatible fixture rules' }));
  writeFileSync(brokenPath, JSON.stringify({ ...replay.record, checksums: [null] }));
  // Pause the running match first: the cancelled-picker comparison below must
  // not be a tick race.
  if (!(await query({ type: 'sim' })).connection.paused) await page.keyboard.press('F3');
  await until('s.connection.paused');
  // Return above hid the start screen. Reach it through the public Quit
  // action again, rather than trying to click its correctly hidden button.
  await page.keyboard.press('F10');
  await page.click('#menu-dialog [data-menu="quit"]');
  await page.waitForSelector('#start-screen:not(.hidden)');
  await page.click('#start-screen [data-start="single-player"]');
  await page.waitForSelector('#lab-dialog[open]');
  const beforeChooser = await query({ type: 'sim' });
  const savedBeforeChooser = await page.evaluate(() => sessionStorage.getItem('open-empires-lab:dev-session'));
  const canceled = page.waitForFileChooser();
  await page.click('#lab-dialog [data-menu="load-replay"]');
  await (await canceled).cancel();
  assert.equal(await page.$eval('#lab-dialog', e => (e as HTMLDialogElement).open), true,
    'a cancelled picker leaves the setup surface up');
  assert(await startShown(), 'a cancelled picker leaves the start screen up');
  assert.equal((await query({ type: 'sim' })).synchronizationHash, beforeChooser.synchronizationHash,
    'a cancelled picker cannot touch the match');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector<HTMLDialogElement>('#lab-dialog')!.open);
  assert(await startShown(), 'Escape after picker cancellation returns to startup');
  await page.click('#start-screen [data-start="single-player"]');
  await page.waitForSelector('#lab-dialog[open]');
  for (const path of [junkPath, malformedPath, incompatiblePath, brokenPath, junkPath]) {
    const rejected = page.waitForFileChooser();
    await page.click('#lab-dialog [data-menu="load-replay"]');
    await (await rejected).accept([path]);
    await page.waitForSelector('#popup-dialog[open]');
    assert(await page.$eval('#popup-message', e => (e.textContent ?? '').toLowerCase().includes('replay')),
      'the rejected replay says why it was refused');
    assert(await startShown(), 'a rejected replay leaves the start screen up');
    assert.equal(await page.$eval('#lab-dialog', e => (e as HTMLDialogElement).open), true,
      'a rejected replay leaves the setup surface up');
    assert.equal((await query({ type: 'sim' })).synchronizationHash, beforeChooser.synchronizationHash,
      'a rejected replay cannot change the existing game');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('open-empires-lab:dev-session')), savedBeforeChooser,
      'a rejected replay cannot discard the resumable snapshot');
    await page.click('#popup-dialog [data-popup-ok]');
    await page.waitForFunction(() => !document.querySelector<HTMLDialogElement>('#popup-dialog')!.open);
  }
  const loaded = page.waitForFileChooser();
  await page.click('#lab-dialog [data-menu="load-replay"]');
  await (await loaded).accept([replayPath]);
  await page.waitForSelector('#start-screen.hidden');
  await page.waitForFunction(() => !document.querySelector<HTMLDialogElement>('#lab-dialog')!.open);
  await until('s.connection.setup.seed === 253');
  await until('s.tick >= 1');
  assert.equal(await page.$eval('canvas.battlefield', e => getComputedStyle(e).visibility), 'visible',
    'the replay battlefield is visible, not covered by startup');
  await page.waitForFunction(() => document.querySelector('#game-message')!.textContent!.includes('Replay verified: 1'));
  assert.equal((await query({ type: 'snapshot' })).populationLimit, 25, 'the replay restores its population ceiling');
  console.log('Startup replay route: cancel/reject preserve setup; success hides startup into playback: PASS');

  // Beware replay-mode Quit: quitting out of a replay reaches the same
  // destination, and Return resumes the paused replay without losing it.
  await page.keyboard.press('F10');
  await page.click('#menu-dialog [data-menu="quit"]');
  await page.waitForSelector('#start-screen:not(.hidden)');
  await until('s.connection.paused');
  await page.click('#start-screen [data-start="return"]');
  await page.waitForSelector('#start-screen.hidden');
  await until("s.connection.paused && s.connection.setup.seed === 253");
  await page.keyboard.press('F3');
  await until('!s.connection.paused');
  console.log('Replay-mode Quit and Return: PASS');

  // Back to the start screen for the full Start -> Single Player -> setup ->
  // Start Game flow.
  await page.keyboard.press('F10');
  await page.click('#menu-dialog [data-menu="quit"]');
  await page.waitForSelector('#start-screen:not(.hidden)');
  await page.click('#start-screen [data-start="single-player"]');
  await page.waitForSelector('#lab-dialog[open]');
  assert.equal(await page.$eval('#menu-dialog', e => e.classList.contains('hidden')), true,
    'match setup is reached without the pause menu');
  for (const control of ['#civilization-1', '#civilization-2']) {
    assert(await page.$eval(`#setup-slots ${control}`, () => true), `${control} sits in the Players panel`);
  }
  for (const control of ['#regicide-mode', '#population-limit', '#wonder-victory', '#map-choice', '#map-seed', '#random-map-seed', '#map-host-note']) {
    assert(await page.$eval(`#map-setup ${control}`, () => true), `${control} stays in the setup form`);
  }
  const bar = await page.$$eval('#map-setup .setup-actions button',
    bs => bs.map(b => ({ label: (b.textContent ?? '').trim(), disabled: b.disabled, type: b.type })));
  assert.deepEqual(bar, [
    { label: 'Technology Tree', disabled: true, type: 'button' },
    { label: 'Reset', disabled: true, type: 'button' },
    { label: 'Randomize', disabled: true, type: 'button' },
    { label: 'Start Game', disabled: false, type: 'submit' },
  ], 'the native bottom bar keeps its order with unsupported entries greyed');
  await page.select('#civilization-1', civ1);
  await page.select('#civilization-2', civ2);
  await page.select('#map-choice', 'islands');
  await page.select('#population-limit', '25');
  await page.locator('#map-seed').fill('21');
  await page.click('#map-setup button[type="submit"]');
  await page.waitForSelector('#start-screen.hidden');
  await page.waitForSelector('#menu-dialog.hidden');
  await page.waitForFunction(() => !document.querySelector<HTMLDialogElement>('#lab-dialog')!.open);
  await until("s.connection.setup.map === 'islands' && s.connection.setup.seed === 21");
  const started = await query({ type: 'snapshot' });
  assert.equal(started.populationLimit, 25, 'the chosen population ceiling is applied');
  assert.equal(started.players[1].civilization, civ1, 'player 1 plays the chosen civilization');
  assert.equal(started.players[2].civilization, civ2, 'player 2 plays the chosen civilization');
  assert.equal((await query({ type: 'sim' })).connection.setup.civilizations?.[2], civ2);
  const params = new URL(page.url()).searchParams;
  assert.equal(params.has('map') || params.has('seed') || params.has('menu'), false,
    'starting a game leaves no launch parameters behind');
  assert.equal(await page.evaluate(() => (window as any).__marker), 0x349, 'starting a game is not a reload');
  await until('s.tick >= 20');
  console.log('Start -> Single Player -> setup -> Start Game (islands, seed 21, civs, pop 25): PASS');

  // Restart semantics are preserved: the same active setup is re-dealt.
  await until('s.tick >= 200');
  const beforeRestart = (await query({ type: 'sim' })).tick;
  await page.keyboard.press('F10');
  await page.click('#menu-dialog [data-menu="restart"]');
  await page.waitForSelector('#menu-dialog.hidden');
  await until("s.connection.setup.map === 'islands' && s.connection.setup.seed === 21");
  const afterRestart = await query({ type: 'sim' });
  assert(afterRestart.tick < 60 && afterRestart.tick < beforeRestart,
    'Restart re-deals the same setup from the beginning');
  console.log('Restart semantics preserved: PASS');

  // Reopen: an ordinary reload resumes the started match without the start
  // screen; a ?menu=1 launch over the restored session shows it with Return.
  await page.goto(`http://127.0.0.1:${port}/?solo=1`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000 });
  await until("s.connection.setup.map === 'islands' && s.connection.setup.seed === 21");
  assert.equal(await page.$eval('#start-screen', e => e.classList.contains('hidden')), true,
    'an ordinary reopen resumes the actual match, not the start screen');
  await page.goto(`http://127.0.0.1:${port}/?solo=1&menu=1`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000 });
  await page.waitForSelector('#start-screen:not(.hidden)');
  await until("s.connection.setup.map === 'islands' && s.connection.setup.seed === 21");
  assert.equal(await page.$eval('#start-screen [data-start="return"]', e => (e as HTMLElement).hidden), false,
    'the restored session behind the start screen offers Return');
  await page.click('#start-screen [data-start="return"]');
  await page.waitForSelector('#start-screen.hidden');
  await until('s.connection.paused');
  await page.keyboard.press('F3');
  await until('!s.connection.paused && s.tick >= 1');
  console.log('Reopen resumes the actual match; ?menu=1 over a session offers Return: PASS');

  // Loaded materials resolve on the loaded page (owned mode only; the open
  // fallback correctly has none).
  const used = await page.evaluate(() => {
    const urls = new Set<string>();
    for (const element of Array.from(document.querySelectorAll('#start-screen .start-entry, #start-screen .start-divider'))) {
      for (const match of getComputedStyle(element).backgroundImage.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) urls.add(match[1]);
    }
    return [...urls];
  });
  if (native) {
    assert(used.length >= 2, `the start screen uses its button state materials (found ${used.length})`);
    const resolved = await page.evaluate(async paths => Promise.all(paths.map(async path => {
      try { return { path, ok: (await fetch(path)).ok }; } catch { return { path, ok: false }; }
    })), used);
    for (const { path, ok } of resolved) assert(ok, `${path} resolves on the loaded page`);
  } else {
    assert.deepEqual(used, [], 'the open fallback uses no owned materials');
  }

  // Review finding 7: a synthetic native StartScreen init — the previous
  // synthetic fixture exercised the Hud only. Long labels must fit their
  // buttons, disabled entries must carry the disable material, and the
  // hidden Return must stay invisible and unfocusable until a live match
  // exists. Public synthetic fixture, NOT owned art validation.
  await page.setViewport({ width: 480, height: 360 });
  const fixture = await page.evaluate(async () => {
    const modulePath = '/src/view/start-screen.ts';
    const { StartScreen } = await import(/* @vite-ignore */ modulePath);
    const parent = document.createElement('div'); document.body.append(parent);
    const image = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
    const ui = { base: '', nativeFeedback: {
      images: Object.fromEntries(['normal', 'hover', 'active', 'disable'].map(s => [`button_large_${s}`, `${image}#${s}`])),
      button: { height: 100, fontSize: 52, border: 4, borderColor: '#000000', gradient: [{ color: '#ffffff', offset: 0 }] } } };
    const screen = new StartScreen(parent, ui as any,
      { onSinglePlayer: () => {}, onReturnToMatch: () => {}, onSound: () => {} });
    try {
      screen.open({ liveMatch: false });
      // open() intentionally focuses Single Player; :focus-visible uses the
      // hover art. Measure the normal state only after releasing that focus.
      (document.activeElement as HTMLElement).blur();
      const buttons = Array.from(parent.querySelectorAll('button')) as HTMLButtonElement[];
      const facts = buttons.map(button => {
        button.scrollIntoView({ block: 'nearest' });
        return { start: button.dataset.start ?? '', disabled: button.disabled, hidden: button.hidden,
          fits: button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight,
          background: getComputedStyle(button).backgroundImage };
      });
      const ret = parent.querySelector<HTMLElement>('[data-start="return"]')!;
      ret.focus();
      const hiddenFacts = { offscreen: ret.offsetParent === null, focused: document.activeElement === ret };
      screen.open({ liveMatch: true });
      const returnVisible = !ret.hidden && ret.offsetParent !== null;
      return { count: buttons.length, dividers: parent.querySelectorAll('.start-divider').length,
        nativeButtons: parent.querySelectorAll('.native-button').length,
        disabledCount: facts.filter(f => f.disabled).length,
        allFit: facts.every(f => f.fits),
        disableArt: facts.filter(f => f.disabled).every(f => f.background.includes('#disable')),
         normalArt: (facts.find(f => f.start === 'single-player') ?? { background: '' }).background.includes('#normal'),
        hiddenFacts, returnVisible };
    } finally { screen.destroy(); parent.remove(); }
  });
  assert.deepEqual(fixture, {
    count: 10, dividers: 2, nativeButtons: 10, disabledCount: 8, allFit: true,
    disableArt: true, normalArt: true, hiddenFacts: { offscreen: true, focused: false }, returnVisible: true,
  });
  console.log('Synthetic native StartScreen init (long labels fit, states, hidden Return): PASS');

  // Review findings 4/5/6 in an isolated context: a shared-config-free
  // context where a normal fresh standalone launch starts on the start
  // screen, the never-started placeholder is never saved as a resumable
  // match, and a pinned launch still gets a working Quit.
  const context = await browser.createBrowserContext();
  const fresh = await context.newPage();
  await fresh.evaluateOnNewDocument('globalThis.__name = f => f');
  await fresh.setViewport({ width: 1280, height: 800 });
  fresh.on('pageerror', error => { errors.push(String(error)); console.error(error); });
  await fresh.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await fresh.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000 });
  await fresh.waitForSelector('#start-screen:not(.hidden)');
  assert.equal(await fresh.$eval('#start-screen', e => !e.classList.contains('hidden')), true,
    'a normal fresh standalone launch opens on the start screen');
  assert.equal((await fresh.evaluate(value => (window as any).__empiresDebug(value), { type: 'sim' })).connection.paused, true,
    'the fresh placeholder board is paused behind the start screen');
  // Persistence uses sessionStorage, not localStorage. Keep the same tab so
  // pagehide/reload would expose an incorrectly saved placeholder.
  await fresh.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide')));
  assert.equal(await fresh.evaluate(() => sessionStorage.getItem('open-empires-lab:dev-session')), null);
  const reopened = fresh;
  await reopened.goto(`http://127.0.0.1:${port}/?solo=1`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await reopened.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000 });
  await reopened.waitForSelector('#start-screen:not(.hidden)');
  assert.equal(await reopened.evaluate(() => sessionStorage.getItem('open-empires-lab:dev-session')), null,
    'a never-started placeholder board is never saved as a resumable session');
  assert.equal(await reopened.$eval('#start-screen', e => !e.classList.contains('hidden')), true,
    'the ordinary ?solo=1 launch still starts on the start screen');
  await reopened.click('#start-screen [data-start="single-player"]');
  await reopened.locator('#map-seed').fill('89');
  await reopened.click('#map-setup button[type="submit"]');
  await reopened.waitForSelector('#start-screen.hidden');
  await reopened.reload({ waitUntil: 'domcontentloaded' });
  await reopened.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000 });
  await reopened.waitForSelector('#start-screen.hidden');
  assert.equal((await reopened.evaluate(() => (window as any).__empiresDebug({ type: 'sim' }))).connection.setup.seed, 89,
    'the normal solo startup submits a real match which reload resumes');

  // A pinned launch goes straight to its match, and Quit is enabled there
  // too (review finding 6): quit, Return, and the exact pinned setup and
  // state come back.
  await reopened.goto(`http://127.0.0.1:${port}/?solo=1&map=arabia&seed=349`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await reopened.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000 });
  await reopened.waitForSelector('#start-screen.hidden');
  const directUntil = (expression: string) => reopened.waitForFunction(async text => {
    const state = await (window as any).__empiresDebug({ type: 'sim' });
    return new Function('s', `return ${text}`)(state);
  }, { timeout: 30_000 }, expression);
  await directUntil('s.connection.setup.seed === 349');
  assert.equal(await reopened.$eval('#start-screen', e => e.classList.contains('hidden')), true,
    'an explicit map/seed launch never shows the start screen');
  await reopened.keyboard.press('F10');
  await reopened.waitForSelector('#menu-dialog:not(.hidden)');
  const quit = await reopened.$eval('#menu-dialog [data-menu="quit"]', e => ({
    disabled: (e as HTMLButtonElement).disabled, title: e.title }));
  assert.equal(quit.disabled, false, 'a pinned solo launch can quit to the start screen');
  assert(quit.title.includes('start screen'), 'the enabled Quit names its destination');
  await reopened.click('#menu-dialog [data-menu="quit"]');
  await reopened.waitForSelector('#start-screen:not(.hidden)');
  await directUntil('s.connection.paused');
  await reopened.click('#start-screen [data-start="return"]');
  await reopened.waitForSelector('#start-screen.hidden');
  await directUntil("s.connection.paused && s.connection.setup.map === 'arabia' && s.connection.setup.seed === 349");
  await reopened.keyboard.press('F3');
  await directUntil('!s.connection.paused');
  console.log('Fresh standalone starts here (placeholder never saved); pinned launch: direct, Quit and Return exact: PASS');
  await reopened.close();
  const bypass = await context.newPage();
  await bypass.goto(`http://127.0.0.1:${port}/?solo=1&menu=0`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await bypass.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000 });
  await bypass.waitForSelector('#start-screen.hidden');
  await bypass.waitForFunction(async () => (await (window as any).__empiresDebug({ type: 'sim' })).tick > 0);
  await bypass.close();
  await context.close();

  // Real shared transport, not just the boot predicate: menu=1 must neither
  // obscure shared notices nor expose a solo Quit destination to either seat.
  sharedServer = await createServer({ root, configFile: `${root}vite.config.ts`, publicDir, logLevel: 'error',
    plugins: [sharedMatchPlugin(root, `${fixtures}/shared.json`)],
    server: { host: '127.0.0.1', port: 5252, strictPort: true } });
  await sharedServer.listen();
  for (const player of [1, 2]) {
    const sharedPage = await browser.newPage();
    await sharedPage.evaluateOnNewDocument('globalThis.__name = f => f');
    sharedPage.on('pageerror', error => errors.push(String(error)));
    await sharedPage.goto(`http://127.0.0.1:5252/?player=${player}&menu=1`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await sharedPage.waitForFunction(async () => typeof (window as any).__empiresDebug === 'function'
      && (await (window as any).__empiresDebug({ type: 'sim' })).connection.connected, { timeout: 120_000 });
    await sharedPage.waitForSelector('#start-screen.hidden');
    assert.equal(await sharedPage.$eval('#game-message', e => getComputedStyle(e).visibility), 'visible');
    await sharedPage.keyboard.press('F10');
    assert.equal(await sharedPage.$eval('[data-menu="quit"]', e => (e as HTMLButtonElement).disabled), true);
    await sharedPage.click('[data-menu="setup"]');
    assert.equal(await sharedPage.$eval('#map-choice', e => (e as HTMLSelectElement).disabled), player === 2);
    assert.equal(await sharedPage.$eval('#map-host-note', e => (e as HTMLElement).hidden), player === 1);
    await sharedPage.close();
  }
  console.log('Explicit menu=0 direct QA entry; shared menu=1 host/guest bypass and restrictions: PASS');

  assert.deepEqual(errors, []);
  console.log(`START MENU SMOKE GREEN (${native ? 'owned materials' : 'open fallback'})`);
} finally {
  try { await browser?.close(); }
  finally { await sharedServer?.close(); await server.close(); rmSync(fixtures, { recursive: true, force: true }); }
}
