import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { exampleAiCommands } from '../sim/ai';
import type { Command } from '../sim/types';
import { parseStrategyLine, validateCommand, explain } from '../protocol/validate';
import type { StrategyInputMessage } from '../protocol/types';
import type { Strategy } from './runner';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/** The built-in example AI as an in-process strategy. */
export function builtinStrategy(): Strategy {
  return { decide: input => exampleAiCommands(input.observation) };
}

export interface SubprocessOptions {
  /**
   * 'sync' (default) waits up to timeoutMs and fails the match on silence.
   * 'deadline' waits only deadlineMs and proceeds without commands, discarding
   * stale replies later.
   */
  mode?: 'sync' | 'deadline';
  timeoutMs?: number;
  deadlineMs?: number;
}

/**
 * An arbitrary subprocess strategy speaking JSONL: one observation message in,
 * one commands message out, per decision. Malformed output fails the match
 * with a clear diagnostic.
 */
export function subprocessStrategy(command: string, options: SubprocessOptions | number = {}): Strategy {
  const { mode = 'sync', timeoutMs = 10_000, deadlineMs = 50 } =
    typeof options === 'number' ? { timeoutMs: options } : options;
  let child: ChildProcess | undefined;
  let lines: Interface | undefined;
  let queue: string[] = [];
  let waiter: ((line: string) => void) | undefined;
  let exited: Error | undefined;

  const ensureStarted = () => {
    if (child) return;
    const spawned = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'inherit'] });
    child = spawned;
    lines = createInterface({ input: spawned.stdout! });
    lines.on('line', line => {
      if (waiter) { const resolve = waiter; waiter = undefined; resolve(line); }
      else queue.push(line);
    });
    child.on('exit', code => {
      exited = new Error(`strategy subprocess exited with code ${code}`);
    });
  };

  const nextLine = (waitMs: number): Promise<string> =>
    new Promise((resolve, reject) => {
      if (queue.length) return resolve(queue.shift()!);
      if (exited) return reject(exited);
      const timer = setTimeout(
        () => { waiter = undefined; reject(new Error(`strategy did not answer within ${waitMs}ms`)); },
        waitMs,
      );
      waiter = line => { clearTimeout(timer); resolve(line); };
    });

  const validated = (line: string, expectedTime: number): Command[] | undefined => {
    const message = parseStrategyLine(line);
    if (message.time !== expectedTime) return undefined; // stale deadline response
    for (const command of message.commands) {
      if (!validateCommand(command)) {
        throw new Error(`strategy command ${explain(validateCommand)}: ${JSON.stringify(command).slice(0, 200)}`);
      }
    }
    return message.commands as Command[];
  };

  return {
    async decide(input: StrategyInputMessage): Promise<Command[]> {
      ensureStarted();
      if (exited) throw exited;
      child!.stdin!.write(`${JSON.stringify(input)}\n`);
      if (mode === 'deadline') {
        const expiresAt = Date.now() + deadlineMs;
        while (Date.now() < expiresAt) {
          try {
            const commands = validated(await nextLine(expiresAt - Date.now()), input.observation.time);
            if (commands) return commands;
          } catch (error) {
            if (error instanceof Error && error.message.includes('did not answer')) return [];
            throw error;
          }
        }
        return [];
      }
      const commands = validated(await nextLine(timeoutMs), input.observation.time);
      if (!commands) throw new Error('strategy returned a response for the wrong observation time');
      return commands;
    },
    stop() {
      lines?.close();
      child?.kill();
    },
  };
}

/**
 * A WebSocket strategy adapter: same messages as the JSONL protocol, one
 * observation out and one commands message back per decision.
 */
export interface McpStrategyOptions {
  command: string;
  args?: string[];
  tool?: string;
  timeoutMs?: number;
}

/** Invoke an MCP server tool once per decision using the maintained SDK. */
export function mcpStrategy(options: McpStrategyOptions): Strategy {
  const tool = options.tool ?? 'decide';
  const timeoutMs = options.timeoutMs ?? 10_000;
  const client = new Client({ name: 'open-empires-strategy-client', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: options.command,
    args: options.args,
    stderr: 'inherit',
  });
  let connected: Promise<void> | undefined;

  return {
    async decide(input: StrategyInputMessage): Promise<Command[]> {
      connected ??= client.connect(transport);
      await connected;
      const result = await client.callTool(
        { name: tool, arguments: input as unknown as Record<string, unknown> },
        undefined,
        { timeout: timeoutMs },
      );
      if (result.isError) throw new Error(`MCP strategy tool '${tool}' returned an error`);
      const content = (result as { content?: unknown }).content;
      const text = Array.isArray(content)
        ? content.find((part: unknown): part is { type: 'text'; text: string } =>
          typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text' &&
          typeof (part as { text?: unknown }).text === 'string')
        : undefined;
      if (!text) throw new Error(`MCP strategy tool '${tool}' returned no JSON text`);
      const message = parseStrategyLine(text.text);
      for (const command of message.commands) {
        if (!validateCommand(command)) {
          throw new Error(`strategy command ${explain(validateCommand)}: ${JSON.stringify(command).slice(0, 200)}`);
        }
      }
      return message.commands as Command[];
    },
    async stop() {
      if (connected) await client.close();
    },
  };
}

export function websocketStrategy(url: string, timeoutMs = 10_000): Strategy {
  let socket: WebSocket | undefined;
  let opened: Promise<void> | undefined;
  const queue: string[] = [];
  let waiter: ((line: string) => void) | undefined;

  const ensureOpen = (): Promise<void> => {
    if (opened) return opened;
    socket = new WebSocket(url);
    socket.addEventListener('message', event => {
      const line = String(event.data);
      if (waiter) { const resolve = waiter; waiter = undefined; resolve(line); }
      else queue.push(line);
    });
    opened = new Promise((resolve, reject) => {
      socket!.addEventListener('open', () => resolve());
      socket!.addEventListener('error', () => reject(new Error(`cannot connect to strategy at ${url}`)));
    });
    return opened;
  };

  return {
    async decide(input: StrategyInputMessage): Promise<Command[]> {
      await ensureOpen();
      socket!.send(JSON.stringify(input));
      const line = await new Promise<string>((resolve, reject) => {
        if (queue.length) return resolve(queue.shift()!);
        const timer = setTimeout(() => reject(new Error(`strategy did not answer within ${timeoutMs}ms`)), timeoutMs);
        waiter = received => { clearTimeout(timer); resolve(received); };
      });
      const message = parseStrategyLine(line);
      for (const command of message.commands) {
        if (!validateCommand(command)) {
          throw new Error(`strategy command ${explain(validateCommand)}: ${JSON.stringify(command).slice(0, 200)}`);
        }
      }
      return message.commands as Command[];
    },
    stop() {
      socket?.close();
    },
  };
}
