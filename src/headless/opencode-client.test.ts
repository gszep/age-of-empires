import { describe, expect, it } from 'vitest';
import { OpenCode } from '@opencode/client';
import {
  catalogueWire,
  declaredError,
  hangingUntilAbort,
  textWire,
} from './opencode-fake';
import {
  OpenCodeClient,
  OpenCodeError,
  toOpenCodeError,
  officialClientTransport,
} from './opencode-client';

const model = { id: 'model-a', providerID: 'provider-a' };

describe('OpenCode client boundary', () => {
  it('uses the official client wire envelopes, paths, signal and declared errors', async () => {
    const requests: { path: string; init?: RequestInit }[] = [];
    let failure = false;
    const client = new OpenCodeClient(officialClientTransport(OpenCode.make({
      baseUrl: 'http://fixture.invalid',
      fetch: async (url, init) => {
        const path = new URL(String(url)).pathname;
        requests.push({ path, init });
        if (failure) return Response.json({ _tag: 'ProviderRequestError', reason: 'authentication', message: 'api_key=PRIVATE' }, { status: 502 });
        return Response.json(path === '/api/model' ? catalogueWire([{ ...model, name: 'A' }]) : textWire('reply'));
      },
    })));
    expect(await client.listModels()).toEqual([{ ...model, name: 'A' }]);
    expect(await client.generateText('hello', { model })).toBe('reply');
    expect(requests.map(r => r.path)).toEqual(['/api/model', '/api/experimental/generate/text']);
    expect(JSON.parse(String(requests[1].init?.body))).toEqual({ prompt: 'hello', model });
    expect(requests[1].init?.signal).toBeInstanceOf(AbortSignal);
    failure = true;
    await expect(client.generateText('hello', { model })).rejects.toMatchObject({ code: 'provider-authentication' });
    await client.generateText('hello', { model }).catch(e => expect(e.message).not.toContain('PRIVATE'));
  });

  it('bounds noncooperative transports and never dispatches pre-aborted calls', async () => {
    let calls = 0;
    const client = new OpenCodeClient({
      listModels: async () => catalogueWire([]),
      generateText: () => { calls++; return new Promise(() => {}); },
    });
    const controller = new AbortController();
    const pending = client.generateText('hi', { model, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    await expect(client.generateText('hi', { model, signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' });
    expect(calls).toBe(1);
    await expect(client.generateText('hi', { model, timeoutMs: 10 })).rejects.toMatchObject({ code: 'timeout' });
    await expect(client.generateText('hi', { model, timeoutMs: NaN })).rejects.toMatchObject({ code: 'invalid-request' });
  });

  it('sanitizes the model catalogue to allowlisted fields only', async () => {
    const transport = {
      async listModels() {
        return catalogueWire([{
          id: 'model-a',
          providerID: 'provider-a',
          name: 'Model A',
          type: 'chat',
          enabled: true,
          // Sensitive or irrelevant fields must never pass the boundary.
          headers: { authorization: 'Bearer secret-token' },
          body: { api_key: 'sk-live' },
          settings: { nested: { private: 'x' } },
        }]);
      },
      async generateText() { throw new Error('unused'); },
    };
    const models = await new OpenCodeClient(transport).listModels();
    expect(models).toEqual([{ id: 'model-a', providerID: 'provider-a', name: 'Model A', type: 'chat', enabled: true }]);
    const serialized = JSON.stringify(models);
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('api_key');
    expect(serialized).not.toContain('headers');
  });

  it('maps a declared unauthorized failure and redacts credentials in the message', async () => {
    const transport = {
      async listModels() { return catalogueWire([]); },
      async generateText() {
        throw declaredError('UnauthorizedError', 'rejected: Bearer abc123 for this request');
      },
    };
    const failure = new OpenCodeClient(transport).generateText('hi', { model });
    await expect(failure).rejects.toMatchObject({ code: 'unauthorized' });
    await failure.catch(error => {
      expect((error as OpenCodeError).message).toContain('redacted');
      expect((error as OpenCodeError).message).not.toContain('abc123');
    });
  });

  it('maps service-unavailable and provider failures onto the typed catalogue', async () => {
    expect(toOpenCodeError(declaredError('ServiceUnavailableError', 'starting')).code).toBe('service-unavailable');
    expect(toOpenCodeError(declaredError('ModelNotFoundError', 'no model')).code).toBe('model-not-found');
    expect(toOpenCodeError(declaredError('UnsupportedModelError', 'no')).code).toBe('unsupported-model');
    expect(toOpenCodeError(declaredError('ProviderRequestError', 'key rejected', { reason: 'authentication' })).code).toBe('provider-authentication');
    expect(toOpenCodeError(declaredError('ProviderRequestError', 'slow down', { reason: 'rate_limit' })).code).toBe('provider-rate-limit');
    expect(toOpenCodeError(declaredError('ProviderRequestError', 'boom', { reason: 'provider' })).code).toBe('provider-error');
    const network = new Error('Transport: fetch failed http://127.0.0.1:1');
    network.name = 'ClientError';
    Object.assign(network, { reason: 'Transport' });
    expect(toOpenCodeError(network)).toMatchObject({ code: 'network', message: 'opencode network: could not reach the OpenCode service' });
    const status = new Error('UnexpectedStatus: 404');
    status.name = 'ClientError';
    Object.assign(status, { reason: 'UnexpectedStatus' });
    expect(toOpenCodeError(status)).toMatchObject({ code: 'http-error', message: 'opencode http-error: HTTP 404' });
    expect(toOpenCodeError('not an error')).toMatchObject({ code: 'unknown' });
    expect(toOpenCodeError({ _tag: '__proto__' })).toMatchObject({ code: 'unknown' });
    expect(toOpenCodeError({ _tag: 'constructor' })).toMatchObject({ code: 'unknown' });
  });

  it('surfaces malformed replies instead of trusting them', async () => {
    const malformedCatalogue = {
      async listModels() { return { location: {}, data: {} }; },
      async generateText() { throw new Error('unused'); },
    };
    await expect(new OpenCodeClient(malformedCatalogue).listModels())
      .rejects.toMatchObject({ code: 'malformed-reply' });
    const malformedEntry = {
      async listModels() { return catalogueWire([{ providerID: 'provider-a' }]); },
      async generateText() { throw new Error('unused'); },
    };
    await expect(new OpenCodeClient(malformedEntry).listModels())
      .rejects.toMatchObject({ code: 'malformed-reply' });
    const noText = {
      async listModels() { return catalogueWire([]); },
      async generateText() { return { data: {} }; },
    };
    await expect(new OpenCodeClient(noText).generateText('hi', { model }))
      .rejects.toMatchObject({ code: 'malformed-reply' });
  });

  it('times out a call that never replies', async () => {
    const transport = {
      async listModels() { return catalogueWire([]); },
      async generateText(_request: unknown, signal: AbortSignal) { return hangingUntilAbort(signal); },
    };
    await expect(new OpenCodeClient(transport).generateText('hi', { model, timeoutMs: 25 }))
      .rejects.toMatchObject({ code: 'timeout' });
  });

  it('reports an externally aborted call as aborted', async () => {
    const transport = {
      async listModels() { return catalogueWire([]); },
      async generateText(_request: unknown, signal: AbortSignal) { return hangingUntilAbort(signal); },
    };
    const controller = new AbortController();
    const pending = new OpenCodeClient(transport).generateText('hi', { model, timeoutMs: 5_000, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });
});
