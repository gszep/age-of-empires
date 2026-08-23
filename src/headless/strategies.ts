import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { exampleAiCommands } from '../sim/ai';
import type { Command } from '../sim/types';
import { parseStrategyLine, validateCommand, explain } from '../protocol/validate';
import type { StrategyInputMessage } from '../protocol/types';
import type { Strategy } from './runner';

/** The built-in example AI as an in-process strategy. */
export function builtinStrategy(): Strategy {
  return { decide: input => exampleAiCommands(input.observation) };
}

/**
 * An arbitrary subprocess strategy speaking JSONL: one observation message in,
 * one commands message out, per decision. Malformed output fails the match
 * with a clear diagnostic.
 */
export function subprocessStrategy(command: string, timeoutMs = 10_000): Strategy {
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

  const nextLine = (): Promise<string> =>
    new Promise((resolve, reject) => {
      if (queue.length) return resolve(queue.shift()!);
      if (exited) return reject(exited);
      const timer = setTimeout(
        () => reject(new Error(`strategy did not answer within ${timeoutMs}ms`)),
        timeoutMs,
      );
      waiter = line => { clearTimeout(timer); resolve(line); };
    });

  return {
    async decide(input: StrategyInputMessage): Promise<Command[]> {
      ensureStarted();
      if (exited) throw exited;
      child!.stdin!.write(`${JSON.stringify(input)}\n`);
      const message = parseStrategyLine(await nextLine());
      for (const command of message.commands) {
        if (!validateCommand(command)) {
          throw new Error(`strategy command ${explain(validateCommand)}: ${JSON.stringify(command).slice(0, 200)}`);
        }
      }
      return message.commands as Command[];
    },
    stop() {
      lines?.close();
      child?.kill();
    },
  };
}
