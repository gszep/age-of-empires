import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { listAll, parseArgs, planStatus, run } from './project.mjs';

const url = 'https://github.com/gszep/age-of-empires/issues/290';
const flags = ['--owner', 'gszep', '--project', '7'];
const project = { id: 'project-fixture', number: 7, owner: { login: 'gszep' } };
const field = { id: 'field-fixture', name: 'Status', type: 'ProjectV2SingleSelectField', options: [
  { id: 'option-fixture', name: 'In progress' },
] };
const item = { id: 'item-fixture', content: { type: 'Issue', url } };
const issue = { html_url: url, number: 290 };
const envelope = (key: string, rows: unknown[]) => ({ [key]: rows, totalCount: rows.length });

describe('project CLI', () => {
  it('requires explicit inputs and rejects foreign issues, PRs, drafts and extra arguments before executing', async () => {
    for (const args of [[], ['inspect'], ['inspect', '--owner', '@me', '--project', '7'],
      ['inspect', '--owner', 'gszep', '--project', '0'], ['inspect', ...flags, '--project', '8'],
      ['add', ...flags, url.replace('/issues/', '/pull/')], ['add', ...flags, url.replace('gszep', 'other')],
      ['add', ...flags, 'draft'], ['add', ...flags, url + '?x=1'], ['inspect', ...flags, 'extra'],
      ['status', ...flags, url, ''], ['inspect', ...flags, '--unknown']]) {
      const execute = vi.fn();
      await expect(run(args, execute)).rejects.toThrow();
      expect(execute).not.toHaveBeenCalled();
    }
    expect(parseArgs(['status', ...flags, url, 'In progress']).status).toBe('In progress');
  });

  it('inspects all fields, including ones beyond the first limit', async () => {
    const fields = Array.from({ length: 101 }, (_, i) => ({ id: String(i), name: `Field ${i}` }));
    const execute = vi.fn().mockResolvedValueOnce(project)
      .mockResolvedValueOnce({ fields: fields.slice(0, 100), totalCount: 101 })
      .mockResolvedValueOnce(envelope('fields', fields));
    expect(await run(['inspect', ...flags], execute)).toEqual({ project, fields });
    expect(execute.mock.calls[2][0]).toContain('101');
    expect(execute.mock.calls.every(([args]) => !args.includes('item-edit'))).toBe(true);
  });

  it('verifies the issue before adding and never creates a draft', async () => {
    const execute = vi.fn().mockResolvedValueOnce(issue).mockResolvedValueOnce(item);
    expect(await run(['add', ...flags, url], execute)).toEqual(item);
    expect(execute.mock.calls).toEqual([
      [['api', '--hostname', 'github.com', 'repos/gszep/age-of-empires/issues/290']],
      [['project', 'item-add', '7', '--owner', 'gszep', '--format', 'json', '--url', url]],
    ]);
    for (const invalid of [null, { ...issue, pull_request: {} }, { ...issue, html_url: url.replace('gszep', 'other') }]) {
      const fail = vi.fn().mockResolvedValue(invalid);
      await expect(run(['add', ...flags, url], fail)).rejects.toThrow('existing issue');
      expect(fail).toHaveBeenCalledTimes(1);
    }
  });

  it('resolves an item beyond the first limit and edits exactly the discovered IDs', async () => {
    const other = Array.from({ length: 100 }, (_, i) => ({ id: String(i), content: { type: 'DraftIssue' } }));
    const execute = vi.fn().mockResolvedValueOnce(issue).mockResolvedValueOnce(project)
      .mockResolvedValueOnce(envelope('fields', [field]))
      .mockResolvedValueOnce({ items: other, totalCount: 101 })
      .mockResolvedValueOnce(envelope('items', [...other, item])).mockResolvedValueOnce(null);
    await run(['status', ...flags, url, 'In progress'], execute);
    expect(execute.mock.calls.at(-1)?.[0]).toEqual(['project', 'item-edit',
      '--project-id', 'project-fixture', '--id', 'item-fixture', '--field-id', 'field-fixture',
      '--single-select-option-id', 'option-fixture', '--format', 'json']);
    expect(execute).toHaveBeenCalledTimes(6);
  });

  it('refuses missing or ambiguous item, field, option, wrong types and missing IDs', () => {
    for (const items of [[], [item, item], [{ ...item, content: { type: 'DraftIssue', url } }]]) {
      expect(() => planStatus(project, [field], items, url, 'In progress')).toThrow();
    }
    for (const fields of [[], [field, field], [{ ...field, type: 'ProjectV2Field' }],
      [{ ...field, options: [] }], [{ ...field, options: [...field.options, ...field.options] }],
      [{ ...field, id: '' }], [{ ...field, options: [{ name: 'In progress' }] }]]) {
      expect(() => planStatus(project, fields, [item], url, 'In progress')).toThrow();
    }
    expect(() => planStatus(project, [field], [item], url, 'in progress')).toThrow('found 0');
    expect(() => planStatus({}, [field], [item], url, 'In progress')).toThrow('project ID');
  });

  it('fails closed on truncation, invalid counts and unstable retrieval', async () => {
    for (const response of [{ items: [], totalCount: 1 }, { items: [] }, { items: [], totalCount: -1 },
      { items: [], totalCount: 100001 }, { items: null, totalCount: 0 }]) {
      await expect(listAll(vi.fn().mockResolvedValue(response), [], 'items')).rejects.toThrow();
    }
    const changing = vi.fn().mockResolvedValueOnce({ items: [], totalCount: 101 })
      .mockResolvedValueOnce({ items: [], totalCount: 102 }).mockResolvedValueOnce({ items: [], totalCount: 103 });
    await expect(listAll(changing, [], 'items')).rejects.toThrow('changed');
  });

  it('stops before mutation on authentication, project identity and incomplete-list failures', async () => {
    const auth = vi.fn().mockRejectedValue(new Error('missing read:project scope'));
    await expect(run(['inspect', ...flags], auth)).rejects.toThrow('read:project');
    expect(auth).toHaveBeenCalledTimes(1);
    const wrong = vi.fn().mockResolvedValue({ ...project, number: 8 });
    await expect(run(['inspect', ...flags], wrong)).rejects.toThrow('does not match');
    const incomplete = vi.fn().mockResolvedValueOnce(issue).mockResolvedValueOnce(project)
      .mockResolvedValueOnce(envelope('fields', [field]))
      .mockResolvedValueOnce({ items: [item], totalCount: 2 });
    await expect(run(['status', ...flags, url, 'In progress'], incomplete)).rejects.toThrow('Incomplete');
    expect(incomplete).toHaveBeenCalledTimes(4);
  });

  it('offers offline help and concise CLI errors without a stack trace', () => {
    expect(execFileSync(process.execPath, ['tools/project.mjs', '--help'], { encoding: 'utf8' })).toContain('Issues remain');
    const result = spawnSync(process.execPath, ['tools/project.mjs', 'status'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('project: Supply --owner');
    expect(result.stderr).not.toContain(' at ');
  });
});
