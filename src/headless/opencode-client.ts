/**
 * OpenCode V2 client boundary for live agent matches (#352).
 *
 * Only the two stateless V2 endpoints this backend needs are used, per the
 * verified V2 contract: GET /api/model replies `{location, data: Model.Info[]}`
 * and POST /api/experimental/generate/text takes `{prompt, model: Model.Ref}`
 * and replies `{data: {text}}`. Session, shell, file, credential and PTY
 * routes are deliberately not reachable through this module, so nothing built
 * on it can expose OpenCode session tools to a spectator route.
 *
 * Everything that leaves this module is sanitized: model summaries copy only
 * allowlisted fields, and every failure is a typed `OpenCodeError` whose
 * message never contains request headers, raw transport payloads, or service
 * credentials. Transport failures are classified from allowlisted shapes
 * only (declared error `_tag`s, the generated client's reason words, and bare
 * status numbers) instead of stringifying whatever was thrown.
 */
import { OpenCode } from '@opencode/client';
import { Service } from '@opencode/client/service';

/** Catalogue of typed, sanitized failures the backend can surface. */
export type OpenCodeErrorCode =
  /** No healthy registered OpenCode service was found (discovery never starts one). */
  | 'unavailable'
  /** The OpenCode service rejected our authentication. */
  | 'unauthorized'
  /** The OpenCode service rejected the request shape. */
  | 'invalid-request'
  /** The selected model is not in the service's catalogue. */
  | 'model-not-found'
  /** The selected model's provider is unknown to the service. */
  | 'provider-not-found'
  /** The service knows the model but cannot generate with it. */
  | 'unsupported-model'
  /** The upstream model provider rejected our credentials. */
  | 'provider-authentication'
  /** The upstream model provider rate-limited the request. */
  | 'provider-rate-limit'
  /** The upstream model provider failed for another reason. */
  | 'provider-error'
  /** The OpenCode service reported itself unavailable. */
  | 'service-unavailable'
  /** The call exceeded its per-call timeout. */
  | 'timeout'
  /** The call was cancelled through an abort signal. */
  | 'aborted'
  /** The request could not reach the OpenCode service. */
  | 'network'
  /** A reply arrived but did not match the documented shape. */
  | 'malformed-reply'
  /** An HTTP status this backend does not classify. */
  | 'http-error'
  /** The strategy is not authorized to call the model (no live match signal). */
  | 'no-live-match'
  /** The player exhausted its per-player request-count cap. */
  | 'request-cap'
  /** The model replied for another observation time than the one sent. */
  | 'stale-reply'
  /** The model replied with a command for another player. */
  | 'wrong-player'
  /** Unclassified failure; details intentionally not propagated. */
  | 'unknown';

export class OpenCodeError extends Error {
  constructor(readonly code: OpenCodeErrorCode, message: string) {
    super(`opencode ${code}: ${message}`);
    this.name = 'OpenCodeError';
  }
}

/** Selected model, mirroring the V2 `Model.Ref` request field. */
export interface OpenCodeModelRef {
  id: string;
  providerID: string;
  variant?: string;
}

/**
 * Sanitized catalogue entry. Copied field by field from `Model.Info`, so
 * provider `headers`, request `body` templates and provider settings can never
 * reach a spectator even if the service sends them.
 */
export interface OpenCodeModelSummary {
  id: string;
  providerID: string;
  name: string;
  type?: string;
  enabled?: boolean;
}

/**
 * The OpenCode connection boundary, injectable so tests run end to end with a
 * fake and no live service. Replies are the documented V2 wire shapes, kept
 * as `unknown` so this module validates instead of trusting.
 */
export interface OpenCodeTransport {
  /** GET /api/model -> `{location, data: Model.Info[]}`. */
  listModels(signal: AbortSignal): Promise<unknown>;
  /** POST /api/experimental/generate/text -> `{data: {text}}`. */
  generateText(request: { prompt: string; model: OpenCodeModelRef }, signal: AbortSignal): Promise<unknown>;
}

const MAX_REPLY_TEXT = 64 * 1024;

const CODE_BY_ERROR_TAG: Record<string, OpenCodeErrorCode> = {
  UnauthorizedError: 'unauthorized',
  ForbiddenError: 'unauthorized',
  ServiceUnavailableError: 'service-unavailable',
  InvalidRequestError: 'invalid-request',
  ModelNotFoundError: 'model-not-found',
  ProviderNotFoundError: 'provider-not-found',
  UnsupportedModelError: 'unsupported-model',
  LocationNotFoundError: 'unavailable',
};

/** Map a thrown transport failure onto the typed catalogue, without leaking. */
export function toOpenCodeError(error: unknown): OpenCodeError {
  if (error instanceof OpenCodeError) return error;
  if (typeof error !== 'object' || error === null) {
    return new OpenCodeError('unknown', 'OpenCode request failed without a recognized error shape');
  }
  const shape = error as { _tag?: string; name?: string; message?: string; reason?: unknown };
  const tag = shape._tag ?? shape.name ?? '';
  const declared = Object.hasOwn(CODE_BY_ERROR_TAG, tag) ? CODE_BY_ERROR_TAG[tag] : undefined;
  if (declared) return new OpenCodeError(declared, 'service rejected the request (details redacted)');
  if (tag === 'ProviderRequestError') {
    const reason = (error as { reason?: unknown }).reason;
    const code: OpenCodeErrorCode = reason === 'authentication' ? 'provider-authentication'
      : reason === 'rate_limit' ? 'provider-rate-limit'
      : 'provider-error';
    return new OpenCodeError(code, 'provider rejected the request (details redacted)');
  }
  // The generated promise client throws ClientError with a reason word; its
  // message may embed a fetch cause, so only the reason and a bare status
  // number are ever propagated.
  const clientReason = (error as { reason?: unknown }).reason;
  if (clientReason === 'UnexpectedStatus') {
    const status = /^UnexpectedStatus: (\d+)$/.exec(shape.message ?? '')?.[1];
    const code: OpenCodeErrorCode = status === '401' || status === '403' ? 'unauthorized'
      : status === '503' ? 'service-unavailable'
      : 'http-error';
    return new OpenCodeError(code, status ? `HTTP ${status}` : 'unexpected HTTP status');
  }
  if (clientReason === 'Transport') return new OpenCodeError('network', 'could not reach the OpenCode service');
  if (clientReason === 'MalformedResponse' || clientReason === 'UnsupportedContentType') {
    return new OpenCodeError('malformed-reply', 'the OpenCode service replied with an unusable body');
  }
  return new OpenCodeError('unknown', 'OpenCode request failed without a recognized error shape');
}

function catalogueOf(raw: unknown): OpenCodeModelSummary[] {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { data?: unknown }).data)) {
    throw new OpenCodeError('malformed-reply', 'model catalogue reply had no data list');
  }
  // All-or-nothing: a shape change must surface, not silently drop entries.
  return ((raw as { data: unknown[] }).data).map(summaryOf);
}

function summaryOf(raw: unknown): OpenCodeModelSummary {
  if (typeof raw !== 'object' || raw === null) {
    throw new OpenCodeError('malformed-reply', 'model catalogue entry was not an object');
  }
  const { id, providerID, name, type, enabled } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || !id || typeof providerID !== 'string' || !providerID) {
    throw new OpenCodeError('malformed-reply', 'model catalogue entry lacked a model or provider id');
  }
  return {
    id,
    providerID,
    name: typeof name === 'string' && name ? name : id,
    ...(typeof type === 'string' && type ? { type } : {}),
    ...(typeof enabled === 'boolean' ? { enabled } : {}),
  };
}

function textOf(raw: unknown): string {
  const data = typeof raw === 'object' && raw !== null ? (raw as { data?: unknown }).data : undefined;
  const text = typeof data === 'object' && data !== null ? (data as { text?: unknown }).text : undefined;
  if (typeof text !== 'string' || !text) {
    throw new OpenCodeError('malformed-reply', 'generation reply had no text');
  }
  if (text.length > MAX_REPLY_TEXT) {
    throw new OpenCodeError('malformed-reply', `generation reply exceeded ${MAX_REPLY_TEXT} characters`);
  }
  return text;
}

export interface OpenCodeCallOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function callTransport<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) {
    throw new OpenCodeError('invalid-request', 'timeout must be an integer from 1 to 3600000ms');
  }
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) controller.abort();
  const abortError = () => new OpenCodeError(timedOut ? 'timeout' : 'aborted', timedOut ? `no reply within ${timeoutMs}ms` : 'request cancelled');
  let rejectAbort: () => void = () => {};
  try {
    if (controller.signal.aborted) throw abortError();
    const cancelled = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(abortError());
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    // Do not rely on an injected transport (or discovery) honoring its signal.
    let pending: Promise<T>;
    try { pending = run(controller.signal); }
    catch (error) { pending = Promise.reject(error); }
    return await Promise.race([pending, cancelled]);
  } catch (error) {
    if (controller.signal.aborted) throw abortError();
    throw toOpenCodeError(error);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    controller.signal.removeEventListener('abort', rejectAbort);
  }
}

/** The sanitized, timeout-bounded client used by strategies and the host. */
export class OpenCodeClient {
  constructor(
    private readonly transport: OpenCodeTransport,
    private readonly defaults: { timeoutMs?: number; listTimeoutMs?: number } = {},
  ) {}

  static withTransport(transport: OpenCodeTransport, defaults?: { timeoutMs?: number; listTimeoutMs?: number }): OpenCodeClient {
    return new OpenCodeClient(transport, defaults);
  }

  async listModels(options: OpenCodeCallOptions = {}): Promise<OpenCodeModelSummary[]> {
    const timeoutMs = options.timeoutMs ?? this.defaults.listTimeoutMs ?? 10_000;
    const raw = await callTransport(signal => this.transport.listModels(signal), timeoutMs, options.signal);
    return catalogueOf(raw);
  }

  async generateText(
    prompt: string,
    options: { model: OpenCodeModelRef } & OpenCodeCallOptions,
  ): Promise<string> {
    const timeoutMs = options.timeoutMs ?? this.defaults.timeoutMs ?? 30_000;
    const raw = await callTransport(
      signal => this.transport.generateText({ prompt, model: options.model }, signal),
      timeoutMs,
      options.signal,
    );
    return textOf(raw);
  }
}

/** Adapt an official generated client to the transport boundary. */
export function officialClientTransport(client: ReturnType<typeof OpenCode.make>): OpenCodeTransport {
  return {
    async listModels(signal) {
      return client.model.list(undefined, { signal });
    },
    async generateText(request, signal) {
      // The generated client already unwraps the `{data: {text}}` envelope;
      // re-wrap so the transport keeps the documented V2 wire shape.
      return { data: await client.experimental.generate.text(
        { prompt: request.prompt, model: request.model },
        { signal },
      ) };
    },
  };
}

/**
 * Discover the shared local OpenCode service and wrap it in the sanitized
 * client. Discovery never starts a service (`Service.ensure` is deliberately
 * not used); when none is registered the explicit `unavailable` state is
 * thrown for the caller to surface. The endpoint's credentials stay inside
 * the generated client and are never exposed or logged.
 */
export async function discoverOpenCodeClient(): Promise<OpenCodeClient> {
  const endpoint = await callTransport(() => Service.discover(), 10_000, undefined);
  if (!endpoint) {
    throw new OpenCodeError('unavailable', 'no healthy registered OpenCode service found');
  }
  return new OpenCodeClient(officialClientTransport(OpenCode.make({
    baseUrl: endpoint.url,
    headers: Service.headers(endpoint),
  })));
}
