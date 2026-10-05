#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const usage = `Usage:
  node tools/project.mjs inspect --owner OWNER --project NUMBER
  node tools/project.mjs add --owner OWNER --project NUMBER ISSUE_URL
  node tools/project.mjs status --owner OWNER --project NUMBER ISSUE_URL "Exact status name"

Only existing gszep/age-of-empires issues are accepted. Issues remain the
authority; the project is a scheduling view. Setting a status never closes an
issue. inspect prints the project and all fields/options as JSON.
Requires gh authentication with read:project for inspection, project for writes.
Authentication is never refreshed automatically.`;

export function issueNumber(url) {
  const match = /^https:\/\/github\.com\/gszep\/age-of-empires\/issues\/([1-9]\d*)$/.exec(url);
  if (!match || !Number.isSafeInteger(Number(match[1]))) {
    throw new Error('Expected an issue URL: https://github.com/gszep/age-of-empires/issues/NUMBER');
  }
  return Number(match[1]);
}

export function parseArgs(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  const [command, ...rest] = args;
  if (!['inspect', 'add', 'status'].includes(command)) throw new Error(usage);
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (['--owner', '--project'].includes(arg)) {
      if (flags[arg] !== undefined || !rest[i + 1] || rest[i + 1].startsWith('--')) {
        throw new Error(`Missing or repeated ${arg}`);
      }
      flags[arg] = rest[++i];
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else positional.push(arg);
  }
  const owner = flags['--owner'];
  const number = flags['--project'];
  if (!owner || !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(owner)) {
    throw new Error('Supply --owner with an explicit GitHub login (no @me default).');
  }
  if (!number || !/^[1-9]\d*$/.test(number) || Number(number) > 2147483647) {
    throw new Error('Supply --project with a positive project number (at most 2147483647).');
  }
  const count = { inspect: 0, add: 1, status: 2 }[command];
  if (positional.length !== count) throw new Error(usage);
  const [url, status] = positional;
  if (url !== undefined) issueNumber(url);
  if (command === 'status' && !status.trim()) throw new Error('Supply an exact, nonempty status name.');
  return { command, owner, number, url, status };
}

function id(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${label} ID in gh response.`);
  return value;
}

function unique(matches, label) {
  if (matches.length !== 1) throw new Error(`Expected exactly one ${label}; found ${matches.length}.`);
  return matches[0];
}

// gh's JSON envelopes contain totalCount, even when --limit truncates results.
// Ask gh to paginate to that count, then verify it actually returned everything.
export async function listAll(execute, base, key) {
  let limit = 100;
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await execute([...base, '--limit', String(limit)]);
    const rows = result?.[key];
    const total = result?.totalCount;
    if (!Array.isArray(rows) || !Number.isSafeInteger(total) || total < rows.length) {
      throw new Error(`Invalid ${key} response: cannot establish completeness.`);
    }
    if (rows.length === total) return rows;
    if (total <= limit || total > 100000) {
      throw new Error(`Incomplete ${key}: received ${rows.length} of ${total}; refusing to continue.`);
    }
    limit = total;
  }
  throw new Error(`Incomplete ${key}: project changed during retrieval; retry.`);
}

export function planStatus(project, fields, items, url, status) {
  issueNumber(url);
  const item = unique(items.filter(item => item?.content?.url === url), 'project item for this issue');
  if (item.content.type !== 'Issue') throw new Error('Project item must be an existing issue, not a draft or pull request.');
  const field = unique(fields.filter(field => field?.name === 'Status'), 'Status field');
  if (field.type !== 'ProjectV2SingleSelectField' || !Array.isArray(field.options)) {
    throw new Error('Status must be a single-select field with options.');
  }
  const option = unique(field.options.filter(option => option?.name === status), `Status option ${JSON.stringify(status)}`);
  return ['project', 'item-edit', '--project-id', id(project?.id, 'project'),
    '--id', id(item.id, 'item'), '--field-id', id(field.id, 'Status field'),
    '--single-select-option-id', id(option.id, 'Status option'), '--format', 'json'];
}

export function executeGh(args) {
  let output;
  try {
    output = execFileSync('gh', args, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1' },
    });
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${detail}`);
  }
  // item-edit can succeed without producing output on some gh versions.
  if (!output.trim()) return null;
  try { return JSON.parse(output); }
  catch { throw new Error(`gh ${args.slice(0, 2).join(' ')} returned invalid JSON.`); }
}

export async function run(args, execute = executeGh) {
  const options = parseArgs(args);
  if (options.help) return usage;
  const { command, owner, number, url, status } = options;
  const scoped = action => ['project', action, number, '--owner', owner, '--format', 'json'];
  if (url) {
    const issue = await execute(['api', '--hostname', 'github.com', `repos/gszep/age-of-empires/issues/${issueNumber(url)}`]);
    if (!issue || issue.pull_request || issue.html_url !== url || issue.number !== issueNumber(url)) {
      throw new Error('URL must resolve to an existing issue in gszep/age-of-empires, not a pull request.');
    }
  }
  if (command === 'add') return execute([...scoped('item-add'), '--url', url]);
  const project = await execute(scoped('view'));
  id(project?.id, 'project');
  if (project.number !== Number(number) || project.owner?.login?.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Returned project does not match the explicit owner and number.');
  }
  const fields = await listAll(execute, scoped('field-list'), 'fields');
  if (command === 'inspect') return { project, fields };
  const items = await listAll(execute, scoped('item-list'), 'items');
  return execute(planStatus(project, fields, items, url, status));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then(result => {
    console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
  }).catch(error => {
    console.error(`project: ${error.message}`);
    process.exitCode = 1;
  });
}
