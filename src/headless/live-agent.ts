import { spawn } from 'node:child_process';
import { applyCommand, createGame } from '../sim/game';
import { describeObservation, observe } from '../sim/observe';
import { validateCommand, explain } from '../protocol/validate';
import type { Command } from '../sim/types';

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

const actionSchema = (villagerIds: number[]) => ({
  type: 'object',
  additionalProperties: false,
  required: ['commands'],
  properties: {
    commands: {
      type: 'array', minItems: 1, maxItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['kind', 'player', 'entityIds'],
        properties: {
          kind: { type: 'string', enum: ['stop'] },
          player: { type: 'integer', enum: [1] },
          entityIds: { type: 'array', minItems: 1, maxItems: 1, items: { type: 'integer', enum: villagerIds } },
        },
      },
    },
  },
});

async function requestGemini(prompt: string, schema: object): Promise<string> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GOOGLE_API_KEY is required for LIVE_AGENT_PROVIDER=gemini');
  const model = process.env.GOOGLE_MODEL ?? 'gemini-2.5-flash-lite';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 128,
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
        },
      }),
    },
  );
  if (!response.ok) {
    const providerError = await response.json().catch(() => undefined) as { error?: { message?: string } } | undefined;
    throw new Error(`model provider returned HTTP ${response.status}: ${providerError?.error?.message ?? 'unknown error'}`);
  }
  const payload = await response.json() as GeminiResponse;
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('model provider returned no structured action');
  return text;
}

async function requestPi(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('pi', [
      '--print', '--no-session', '--no-tools', '--no-extensions', '--no-skills',
      '--no-prompt-templates', '--no-context-files', '--thinking', 'off',
      '--provider', process.env.PI_PROVIDER ?? 'openai-codex',
      '--model', process.env.LIVE_AGENT_MODEL ?? 'gpt-5.4-mini',
      '--system-prompt', 'Return only the requested compact JSON object. Never use markdown.',
      prompt,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PI_SKIP_VERSION_CHECK: '1' },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), 120_000);
    child.stdout.on('data', chunk => {
      stdout += String(chunk);
      if (stdout.length > 64 * 1024) child.kill();
    });
    child.stderr.on('data', chunk => { stderr += String(chunk).slice(0, 4096); });
    child.on('error', () => { clearTimeout(timer); reject(new Error('cannot launch authenticated pi provider')); });
    child.on('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`authenticated pi provider invocation failed${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
    });
  });
}

/**
 * One deliberately small, opt-in provider boundary check. Only a canonical
 * player-filtered observation is sent. Authentication remains in the existing
 * provider environment; no key, response, observation, or session is stored.
 */
export async function runLiveAgentScenario(): Promise<{ provider: string; commands: number }> {
  const state = createGame(73);
  const observation = observe(state, 1);
  const ownVillagers = observation.entities.filter(entity => entity.owner === 1 && entity.kind === 'villager');
  const ownVillagerIds = ownVillagers.map(entity => entity.id);
  const compactObservation = {
    summary: describeObservation(observation),
    ownVillagers,
  };
  const prompt = [
    'You control player 1 in a deterministic RTS.',
    'Return exactly this JSON shape with one listed villager ID substituted: {"commands":[{"kind":"stop","player":1,"entityIds":[ID]}]}. Do not explain.',
    `Filtered observation: ${JSON.stringify(compactObservation)}`,
  ].join('\n');
  const schema = actionSchema(ownVillagerIds);
  const provider = process.env.LIVE_AGENT_PROVIDER ?? 'pi';
  const text = provider === 'pi'
    ? await requestPi(prompt)
    : await requestGemini(prompt, schema);

  const parsed = JSON.parse(text) as { commands?: unknown[] };
  if (!Array.isArray(parsed.commands) || parsed.commands.length !== 1) {
    throw new Error(`model returned no command (${Object.keys(parsed).join(',') || 'empty object'})`);
  }
  for (const raw of parsed.commands) {
    if (!validateCommand(raw)) throw new Error(`model command ${explain(validateCommand)}`);
    const result = applyCommand(state, raw as Command);
    if (!result.ok) throw new Error(`model command rejected: ${result.reason}`);
  }
  return { provider, commands: parsed.commands.length };
}

if (process.argv[1]?.endsWith('live-agent.ts')) {
  if (process.env.RUN_LIVE_AGENT !== '1') throw new Error('set RUN_LIVE_AGENT=1 to permit the bounded live provider call');
  const result = await runLiveAgentScenario();
  console.log(`live agent ok: provider=${result.provider} commands=${result.commands}`);
}
