import { afterEach, expect, it, vi } from 'vitest';
import { connectSharedMatch } from './client';
import { SHARED_VERSION } from './protocol';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

it('explicit solo never discovers or joins the shared host', async () => {
  vi.stubGlobal('location', { search: '?solo=1' });
  const fetch = vi.fn(), resume = vi.fn();
  vi.stubGlobal('fetch', fetch);
  expect(await connectSharedMatch(resume)).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled();
});

it.each(['missing', 'html', 'disabled'])('preserves intentional standalone discovery: %s', async mode => {
  vi.stubGlobal('location', { search: '' });
  const response = mode === 'missing' ? new Response('missing', { status: 404 })
    : mode === 'html' ? new Response('<html>standalone</html>', { headers: { 'content-type': 'text/html' } })
      : json({ enabled: false });
  const fetch = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetch);
  expect(await connectSharedMatch()).toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(['502', 'network', 'malformed', 'missing-fields', 'invalid-player', 'unexpected-type'])('keeps startup pending through %s failure and retries discovery', async failure => {
  vi.useFakeTimers(); vi.stubGlobal('location', { search: '' });
  const first = failure === '502' ? new Response('unavailable', { status: 502 })
    : failure === 'malformed' ? new Response('{broken', { headers: { 'content-type': 'application/json' } })
      : failure === 'missing-fields' ? json({ error: 'unavailable' })
        : failure === 'invalid-player' ? json({ enabled: true, version: SHARED_VERSION, player: 99 })
          : new Response('unexpected');
  const fetch = vi.fn();
  if (failure === 'network') fetch.mockRejectedValueOnce(new TypeError('network unavailable'));
  else fetch.mockResolvedValueOnce(first);
  fetch.mockResolvedValueOnce(json({ enabled: false }));
  vi.stubGlobal('fetch', fetch);
  const notice = vi.fn(), resume = vi.fn();
  let settled = false;
  const pending = connectSharedMatch(resume, notice).then(value => { settled = true; return value; });
  await vi.advanceTimersByTimeAsync(0);
  expect(settled).toBe(false);
  expect(resume).not.toHaveBeenCalled();
  expect(notice).toHaveBeenCalledWith(expect.stringContaining('Shared match unavailable'));
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1500);
  expect(await pending).toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each([4, 6, 7, SHARED_VERSION + 1])('rejects incompatible host version %s instead of joining or silently starting solo', async version => {
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ enabled: true, version, player: 1 })));
  const notice = vi.fn(), resume = vi.fn();
  await expect(connectSharedMatch(resume, notice)).rejects.toThrow('version mismatch');
  expect(notice).toHaveBeenCalledWith(expect.stringContaining('version mismatch'));
  expect(resume).not.toHaveBeenCalled();
});
