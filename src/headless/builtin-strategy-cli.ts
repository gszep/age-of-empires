/**
 * The example AI as a standalone JSONL subprocess strategy:
 * reads observation messages on stdin, writes command messages on stdout.
 */
import { createInterface } from 'node:readline';
import { exampleAiCommands } from '../sim/ai';
import type { StrategyInputMessage, StrategyOutputMessage } from '../protocol/types';

const lines = createInterface({ input: process.stdin });
lines.on('line', line => {
  const input = JSON.parse(line) as StrategyInputMessage;
  if (input.type !== 'observation') throw new Error(`unexpected message type: ${String(input.type)}`);
  const output: StrategyOutputMessage = {
    type: 'commands',
    time: input.observation.time,
    commands: exampleAiCommands(input.observation),
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
});
