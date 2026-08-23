/**
 * Protocol-boundary validation with Ajv over the committed JSON Schemas.
 * Node-only: browser input comes from the trusted UI and never crosses this
 * boundary.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv, type ValidateFunction } from 'ajv';

const schemaDirectory = join(dirname(fileURLToPath(import.meta.url)), '../../schemas');

const ajv = new Ajv({ allErrors: false });
for (const name of ['command', 'observation', 'strategy-message', 'match-config', 'match-result', 'match-record']) {
  ajv.addSchema(JSON.parse(readFileSync(join(schemaDirectory, `${name}.schema.json`), 'utf8')));
}

function validator(id: string): ValidateFunction {
  const validate = ajv.getSchema(`https://open-empires-lab/${id}.schema.json`);
  if (!validate) throw new Error(`schema ${id} not registered`);
  return validate;
}

export function explain(validate: ValidateFunction): string {
  const error = validate.errors?.[0];
  return error ? `${error.instancePath || '/'} ${error.message ?? 'is invalid'}` : 'is invalid';
}

export const validateCommand = validator('command');
export const validateObservation = validator('observation');
export const validateStrategyMessage = validator('strategy-message');
export const validateMatchConfig = validator('match-config');
export const validateMatchResult = validator('match-result');
export const validateMatchRecord = validator('match-record');

/** Parse one strategy JSONL line, throwing a clear diagnostic on bad input. */
export function parseStrategyLine(line: string): { time: number; commands: unknown[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error(`strategy wrote invalid JSON: ${line.slice(0, 200)}`);
  }
  if (!validateStrategyMessage(parsed)) {
    throw new Error(`strategy message ${explain(validateStrategyMessage)}: ${line.slice(0, 200)}`);
  }
  return parsed as { time: number; commands: unknown[] };
}
