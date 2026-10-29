import { API_PATH, ArchiveError, type ApiRequest, type ApiResponse, type ArchiveApi } from './contracts.js';
import { safeError } from './service.js';
import type { HostContext } from './dsh-adapter.js';

interface Connection {
  fetch: { register(route: { path: string; methods: string[]; requestBody: 'buffered'; fetch(request: Request): Promise<Response> }): () => void };
}
const MAX_BODY_BYTES = 64 * 1024;
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function ids(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 100
    && value.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 512 && !id.includes('\0'))
    && new Set(value).size === value.length;
}
export function parseApiRequest(value: unknown): ApiRequest {
  if (record(value)) {
    if (value.action === 'list' && exactKeys(value, ['action'])) return { action: 'list' };
    if (value.action === 'storage') {
      if (exactKeys(value, ['action'])) return { action: 'storage' };
      if (exactKeys(value, ['action', 'workspaceId']) && typeof value.workspaceId === 'string' && value.workspaceId.length > 0
        && value.workspaceId.length <= 512 && !value.workspaceId.includes('\0')) return { action: 'storage', workspaceId: value.workspaceId };
    }
    if (value.action === 'preview' && exactKeys(value, ['action', 'operation', 'ids'])
      && ['trash', 'restore', 'purge'].includes(String(value.operation)) && ids(value.ids)) {
      return { action: 'preview', operation: value.operation as 'trash' | 'restore' | 'purge', ids: value.ids };
    }
    if (value.action === 'execute' && exactKeys(value, ['action', 'previewId', 'requestId'])
      && typeof value.previewId === 'string' && value.previewId.length <= 100
      && typeof value.requestId === 'string' && value.requestId.length <= 100) {
      return { action: 'execute', previewId: value.previewId, requestId: value.requestId };
    }
    if (value.action === 'cancelPending' && exactKeys(value, ['action', 'ids', 'requestId']) && ids(value.ids)
      && typeof value.requestId === 'string' && value.requestId.length <= 100) {
      return { action: 'cancelPending', ids: value.ids, requestId: value.requestId };
    }
  }
  throw new ArchiveError('invalid-request', 'The request is not a supported archive operation.');
}
async function readRequest(request: Request): Promise<unknown> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > MAX_BODY_BYTES) throw new ArchiveError('request-too-large', 'The request exceeds the size limit.');
  const reader = request.body?.getReader();
  if (!reader) throw new ArchiveError('invalid-request', 'A JSON request body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new ArchiveError('request-too-large', 'The request exceeds the size limit.'); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new ArchiveError('invalid-request', 'The request body is not valid JSON.'); }
}
function response(value: ApiResponse, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

/** This handler is mounted only behind Connection's authenticated, owner-only exact Fetch route. */
export function createRequestHandler(api: ArchiveApi): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405, headers: { allow: 'POST' } });
    const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (contentType !== 'application/json') return response({ ok: false, error: { code: 'invalid-request', message: 'Content-Type must be application/json.' } }, 415);
    try {
      const input = parseApiRequest(await readRequest(request));
      let value: Extract<ApiResponse, { ok: true }>['value'];
      switch (input.action) {
        case 'list': value = await api.list(); break;
        case 'preview': value = await api.preview(input.operation, input.ids); break;
        case 'execute': value = await api.execute(input.previewId, input.requestId); break;
        case 'cancelPending': value = await api.cancelPending(input.ids, input.requestId); break;
        case 'storage':
          if (!api.storage) throw new ArchiveError('unsupported-host', 'Storage inspection is unavailable in this host.');
          value = await api.storage(input.workspaceId, request.signal); break;
      }
      return response({ ok: true, value });
    } catch (error) {
      const detail = safeError(error);
      const status = detail.code === 'request-too-large' ? 413 : detail.code === 'invalid-request' ? 400
        : detail.code === 'operation-failed' ? 500 : 409;
      return response({ ok: false, error: detail }, status);
    }
  };
}

export function registerHostRoutes(ctx: HostContext, api: ArchiveApi): () => void {
  const connection = (ctx.get?.('connection') ?? ctx.connection) as Connection | undefined;
  if (!connection || typeof connection.fetch?.register !== 'function') throw new ArchiveError('unsupported-host', 'DSH authenticated Fetch routes are unavailable.');
  // DSH 0.2.1-rc.3 admits the request and rejects every non-owner Peer before this handler.
  return connection.fetch.register({ path: API_PATH, methods: ['POST'], requestBody: 'buffered', fetch: createRequestHandler(api) });
}
