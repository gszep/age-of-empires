/** #281: real-browser/Node parity without renderer, owned assets or live game. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { gothicCeilingFixture, publicWonderFixture } from '../src/sim/agent-public.fixture';
import { createGame } from '../src/sim/game';
import { FALLBACK_RULES } from '../src/sim/data';
import { describeObservation, observe } from '../src/sim/observe';
import { exampleAiCommands } from '../src/sim/ai';

const root = fileURLToPath(new URL('../', import.meta.url));
const wonder = publicWonderFixture(); wonder.finish();
const gothic = gothicCeilingFixture(200); gothic.imperial();
const legacyRules = structuredClone(FALLBACK_RULES); delete legacyRules.populationLimit;
const states = [wonder.state, gothic.state, createGame(281, legacyRules)];
const samples = states.flatMap(state => ([1, 2] as const).map(player => ({ state, player })));
const expected = samples.map(({ state, player }) => {
  const observation = observe(state, player);
  return { type: 'observation', observation, text: describeObservation(observation),
    commands: exampleAiCommands(observation) };
});
assert.equal(expected[1].observation.wonderCountdowns?.length, 1);
assert.equal(expected[1].observation.entities.some(e => e.id === wonder.wonder.id), false);
assert.equal(expected[2].observation.populationLimit, 210);
assert.equal(expected[4].observation.populationLimit, undefined);

const server = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error',
  server: { host: '127.0.0.1', port: 5307, strictPort: true }, plugins: [{
    name: 'private-agent-public-fixture',
    configureServer(server) {
      server.middlewares.use('/__agent-public-fixture', (_req, res) => {
        res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Agent parity fixture</title>');
      });
    },
  }] });
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
try {
  await server.listen();
  const address = server.httpServer!.address();
  assert(address && typeof address !== 'string');
  const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
  browser = await puppeteer.launch({ headless: true,
    env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
    args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument('globalThis.__name = f => f');
  await page.goto(`http://127.0.0.1:${address.port}/__agent-public-fixture`);
  const actual = await page.evaluate(async samples => {
    const observerPath = '/src/sim/observe.ts', aiPath = '/src/sim/ai.ts';
    const { observe, describeObservation } = await import(observerPath);
    const { exampleAiCommands } = await import(aiPath);
    return samples.map(({ state, player }) => {
      const observation = observe(state, player);
      return JSON.stringify({ type: 'observation', observation, text: describeObservation(observation),
        commands: exampleAiCommands(observation) });
    });
  }, JSON.parse(JSON.stringify(samples)) as typeof samples);
  assert.deepEqual(actual, expected.map(input => JSON.stringify(input)));
  console.log('PASS: 6 browser/Node JSON observations, text and AI decisions identical; hidden Wonder, Gothic 210 and unbounded legacy covered.');
} finally {
  await browser?.close();
  await server.close();
}
