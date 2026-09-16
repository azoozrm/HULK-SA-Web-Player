import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';
import type {
  MediaLocatorDescriptor,
  MediaLocatorRequest,
} from '../../../../packages/contracts/src/index.js';
import { parseBrowserCatalogIdentifier } from '../catalog/catalog-normalizer.js';
import type {
  ProviderCredentialLease,
  ProviderSessionBoundary,
  ServerHeldProviderCredentials,
} from '../control-plane.js';
import { HlsManifestError, MAXIMUM_HLS_MANIFEST_BYTES, rewriteHlsManifest } from '../media/hls-rewriter.js';
import {
  MediaLocatorCodec,
  MediaLocatorError,
  type AuthorizedMediaTarget,
} from '../media/media-locator.js';
import {
  ByteRangeError,
  parseSingleByteRange,
  validContentRange,
} from '../media/range.js';
import {
  MediaProcessError,
  selectRemuxPath,
  type MediaAdaptationAdapter,
} from '../media/remux.js';
import {
  ProviderMediaTransportError,
  type ProviderMediaResponse,
  type ProviderMediaTransport,
} from '../network/provider-media-transport.js';
import { CatalogProviderError, type CatalogReader } from '../provider/xtream-catalog.js';
import { normalizeProviderUrl } from '../security/provider-url.js';

const MAXIMUM_MEDIA_LOCATOR_BODY_BYTES = 4 * 1024;
export const MEDIA_SESSION_REVALIDATION_MS = 15_000;

export type MediaApiRuntimeDependencies = Readonly<{
  transport: ProviderMediaTransport;
  locator: MediaLocatorCodec;
  adapter: MediaAdaptationAdapter;
}>;

export type MediaApiDependencies = MediaApiRuntimeDependencies & Readonly<{
  sessions: ProviderSessionBoundary;
  catalog: CatalogReader;
  cookieName: string;
  publicOrigin: string;
}>;

class MediaRequestValidationError extends Error {}
class MediaNotFoundError extends Error {}
class MediaUnsupportedError extends Error {}
class SessionUnavailableError extends Error {}

function setMediaHeaders(response: ServerResponse): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

function errorBody(code: string): Readonly<{ error: Readonly<{ code: string }> }> {
  return Object.freeze({ error: Object.freeze({ code }) });
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  setMediaHeaders(response);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(value));
}

function parseSessionCookie(header: string | undefined, cookieName: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() !== cookieName) continue;
    const value = part.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{20,256}$/u.test(value) ? value : null;
  }
  return null;
}

function validateMutationOrigin(request: IncomingMessage, expectedOrigin: string): boolean {
  const origin = request.headers.origin;
  if (origin !== expectedOrigin) return false;
  const fetchSite = request.headers['sec-fetch-site'];
  return fetchSite === undefined || fetchSite === 'same-origin';
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers['content-type']?.toLowerCase() ?? '';
  if (!/^application\/json(?:\s*;|$)/u.test(contentType)) throw new MediaRequestValidationError();
  const declaredLength = request.headers['content-length'];
  if (declaredLength) {
    const length = Number(declaredLength);
    if (!Number.isInteger(length) || length < 0 || length > MAXIMUM_MEDIA_LOCATOR_BODY_BYTES) {
      throw new MediaRequestValidationError();
    }
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    bytes += chunk.length;
    if (bytes > MAXIMUM_MEDIA_LOCATOR_BODY_BYTES) throw new MediaRequestValidationError();
    chunks.push(chunk);
  }
  if (bytes === 0) throw new MediaRequestValidationError();
  try {
    return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')) as unknown;
  } catch {
    throw new MediaRequestValidationError();
  }
}

function parseLocatorRequest(value: unknown): MediaLocatorRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MediaRequestValidationError();
  }
  const record = value as Readonly<Record<string, unknown>>;
  const kind = record.kind;
  if (kind === 'live' || kind === 'movie') {
    if (Object.keys(record).sort().join(',') !== 'id,kind' || typeof record.id !== 'string') {
      throw new MediaRequestValidationError();
    }
    const id = parseBrowserCatalogIdentifier(record.id);
    if (!id) throw new MediaRequestValidationError();
    return Object.freeze({ kind, id });
  }
  if (kind === 'episode') {
    if (
      Object.keys(record).sort().join(',') !== 'id,kind,seriesId' ||
      typeof record.id !== 'string' ||
      typeof record.seriesId !== 'string'
    ) {
      throw new MediaRequestValidationError();
    }
    const id = parseBrowserCatalogIdentifier(record.id);
    const seriesId = parseBrowserCatalogIdentifier(record.seriesId);
    if (!id || !seriesId) throw new MediaRequestValidationError();
    return Object.freeze({ kind: 'episode', id, seriesId });
  }
  throw new MediaRequestValidationError();
}

async function activeLease(
  dependencies: MediaApiDependencies,
  token: string,
): Promise<ProviderCredentialLease | null> {
  try {
    const lease = await dependencies.sessions.acquireProviderCredentials(token);
    if (!lease || lease.expiresAtEpochMs <= Date.now()) return null;
    return lease;
  } catch {
    throw new SessionUnavailableError();
  }
}

async function authorizeTarget(
  request: MediaLocatorRequest,
  catalog: CatalogReader,
  credentials: ServerHeldProviderCredentials,
): Promise<AuthorizedMediaTarget> {
  if (request.kind === 'live') {
    const channels = await catalog.liveChannels(credentials, null);
    if (!channels.some((channel) => channel.id === request.id)) throw new MediaNotFoundError();
    return Object.freeze({ kind: 'live', id: request.id });
  }
  if (request.kind === 'movie') {
    const details = await catalog.movieDetails(credentials, request.id);
    if (!details.containerExtension) throw new MediaUnsupportedError();
    return Object.freeze({
      kind: 'movie',
      id: request.id,
      extension: details.containerExtension,
    });
  }

  const details = await catalog.seriesDetails(credentials, request.seriesId);
  for (const season of details.seasons) {
    const episode = season.episodes.find((candidate) => candidate.id === request.id);
    if (!episode) continue;
    if (!episode.containerExtension) throw new MediaUnsupportedError();
    return Object.freeze({
      kind: 'episode',
      id: request.id,
      seriesId: request.seriesId,
      extension: episode.containerExtension,
    });
  }
  throw new MediaNotFoundError();
}

function encodedSegment(value: string): string {
  return encodeURIComponent(value);
}

export function buildXtreamMediaUrl(
  credentials: ServerHeldProviderCredentials,
  target: Exclude<AuthorizedMediaTarget, Readonly<{ kind: 'hls'; uri: string; resource: 'manifest' | 'binary' }>>,
): URL {
  const base = normalizeProviderUrl(credentials.host);
  const accountPath = `${encodedSegment(credentials.username)}/${encodedSegment(credentials.password)}`;
  if (target.kind === 'live') {
    return new URL(`live/${accountPath}/${encodedSegment(target.id)}.m3u8`, base);
  }
  if (target.kind === 'movie') {
    return new URL(
      `movie/${accountPath}/${encodedSegment(target.id)}.${encodedSegment(target.extension)}`,
      base,
    );
  }
  return new URL(
    `series/${accountPath}/${encodedSegment(target.id)}.${encodedSegment(target.extension)}`,
    base,
  );
}

async function readBoundedManifest(body: Readable | null, signal: AbortSignal): Promise<Buffer> {
  if (!body) throw new HlsManifestError();
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const value of body) {
    if (signal.aborted) throw new ProviderMediaTransportError('cancelled');
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    bytes += chunk.length;
    if (bytes > MAXIMUM_HLS_MANIFEST_BYTES) throw new HlsManifestError();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes);
}

function setPassThroughHeaders(response: ServerResponse, upstream: ProviderMediaResponse): void {
  setMediaHeaders(response);
  const contentType = upstream.headers.contentType;
  if (
    contentType &&
    /^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+(?:;\s*charset=[A-Za-z0-9._-]+)?$/u.test(contentType)
  ) {
    response.setHeader('Content-Type', contentType);
  }
  if (upstream.headers.contentLength) response.setHeader('Content-Length', upstream.headers.contentLength);
  if (upstream.headers.acceptRanges === 'bytes') response.setHeader('Accept-Ranges', 'bytes');
}

async function pipeBody(body: Readable, response: ServerResponse): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      body.removeListener('error', onBodyError);
      response.removeListener('finish', onFinish);
      response.removeListener('close', onClose);
      if (error) reject(error);
      else resolve();
    };
    const onBodyError = (error: Error): void => finish(error);
    const onFinish = (): void => finish();
    const onClose = (): void => finish();
    body.once('error', onBodyError);
    response.once('finish', onFinish);
    response.once('close', onClose);
    body.pipe(response);
  });
}

export function createMediaSessionGuard(
  sessions: ProviderSessionBoundary,
  sessionToken: string,
  sessionExpiresAtEpochMs: number,
  controller: AbortController,
  intervalMs = MEDIA_SESSION_REVALIDATION_MS,
  now: () => number = Date.now,
): Readonly<{ stop: () => void }> {
  let stopped = false;
  let checking = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    clearTimeout(expiryTimer);
  };
  const check = async (): Promise<void> => {
    if (stopped || checking || controller.signal.aborted) return;
    checking = true;
    try {
      const descriptor = await sessions.resolve(sessionToken);
      if (!descriptor || Date.parse(descriptor.expiresAt) <= now()) controller.abort();
    } catch {
      controller.abort();
    } finally {
      checking = false;
    }
  };

  const interval = setInterval(() => {
    void check();
  }, intervalMs);
  interval.unref();
  const expiryDelay = Math.max(1, sessionExpiresAtEpochMs - now());
  const expiryTimer = setTimeout(() => controller.abort(), expiryDelay);
  expiryTimer.unref();
  return Object.freeze({ stop });
}

async function serveHlsManifest(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: MediaApiDependencies,
  sessionToken: string,
  lease: ProviderCredentialLease,
  manifestUrl: URL,
  signal: AbortSignal,
): Promise<void> {
  const upstream = await dependencies.transport.open(Object.freeze({
    url: manifestUrl,
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    range: null,
    accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, */*',
    signal,
  }));
  if (upstream.status < 200 || upstream.status >= 300) {
    upstream.abort();
    throw new ProviderMediaTransportError('upstream_protocol_error');
  }

  if (request.method === 'HEAD') {
    setMediaHeaders(response);
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    response.end();
    upstream.abort();
    return;
  }

  let source: Buffer;
  try {
    source = await readBoundedManifest(upstream.body, signal);
  } finally {
    upstream.abort();
  }
  const rewritten = rewriteHlsManifest(
    source,
    manifestUrl,
    (nestedUrl, resource) => {
      const issued = dependencies.locator.issue(
        sessionToken,
        Object.freeze({ kind: 'hls', uri: nestedUrl.toString(), resource }),
        lease.expiresAtEpochMs,
      );
      return `/api/media/r/${issued.token}`;
    },
  );
  setMediaHeaders(response);
  response.statusCode = 200;
  response.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  response.setHeader('Content-Length', String(rewritten.byteLength));
  response.end(rewritten);
}

async function servePassThrough(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: MediaApiDependencies,
  url: URL,
  signal: AbortSignal,
): Promise<void> {
  let parsedRange;
  try {
    parsedRange = parseSingleByteRange(
      typeof request.headers.range === 'string' ? request.headers.range : undefined,
    );
  } catch (error) {
    if (error instanceof ByteRangeError) {
      setMediaHeaders(response);
      response.statusCode = 416;
      response.setHeader('Accept-Ranges', 'bytes');
      response.end();
      return;
    }
    throw error;
  }

  const upstream = await dependencies.transport.open(Object.freeze({
    url,
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    range: parsedRange?.header ?? null,
    accept: 'video/*, audio/*, application/octet-stream, */*',
    signal,
  }));

  if (upstream.status === 416) {
    setMediaHeaders(response);
    response.statusCode = 416;
    response.setHeader('Accept-Ranges', 'bytes');
    if (validContentRange(upstream.headers.contentRange, true)) {
      response.setHeader('Content-Range', upstream.headers.contentRange ?? '');
    }
    response.end();
    upstream.abort();
    return;
  }
  if (upstream.status !== 200 && upstream.status !== 206) {
    upstream.abort();
    throw new ProviderMediaTransportError('upstream_protocol_error');
  }
  if (upstream.status === 206 && !validContentRange(upstream.headers.contentRange)) {
    upstream.abort();
    throw new ProviderMediaTransportError('upstream_protocol_error');
  }

  setPassThroughHeaders(response, upstream);
  response.statusCode = upstream.status;
  if (upstream.status === 206) response.setHeader('Content-Range', upstream.headers.contentRange ?? '');
  if (request.method === 'HEAD') {
    response.end();
    upstream.abort();
    return;
  }
  if (!upstream.body) {
    upstream.abort();
    throw new ProviderMediaTransportError('upstream_protocol_error');
  }
  try {
    await pipeBody(upstream.body, response);
  } finally {
    upstream.abort();
  }
}

async function serveRemux(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: MediaApiDependencies,
  sourceUrl: URL,
  signal: AbortSignal,
): Promise<void> {
  if (request.method === 'HEAD') {
    setMediaHeaders(response);
    response.statusCode = 200;
    response.setHeader('Content-Type', 'video/mp4');
    response.setHeader('Accept-Ranges', 'none');
    response.end();
    return;
  }
  if (request.headers.range !== undefined) {
    setMediaHeaders(response);
    response.statusCode = 416;
    response.setHeader('Accept-Ranges', 'none');
    response.end();
    return;
  }

  const probeSource = await dependencies.transport.open(Object.freeze({
    url: sourceUrl,
    method: 'GET',
    range: null,
    accept: 'video/*, application/octet-stream, */*',
    signal,
  }));
  if ((probeSource.status !== 200 && probeSource.status !== 206) || !probeSource.body) {
    probeSource.abort();
    throw new ProviderMediaTransportError('upstream_protocol_error');
  }

  let evidence;
  try {
    evidence = await dependencies.adapter.probe(probeSource.body, signal);
  } finally {
    probeSource.abort();
  }
  if (selectRemuxPath(evidence).kind !== 'stream-copy-remux') throw new MediaUnsupportedError();

  const mediaSource = await dependencies.transport.open(Object.freeze({
    url: sourceUrl,
    method: 'GET',
    range: null,
    accept: 'video/*, application/octet-stream, */*',
    signal,
  }));
  if ((mediaSource.status !== 200 && mediaSource.status !== 206) || !mediaSource.body) {
    mediaSource.abort();
    throw new ProviderMediaTransportError('upstream_protocol_error');
  }

  const remux = await dependencies.adapter.remux(mediaSource.body, signal);
  try {
    setMediaHeaders(response);
    response.statusCode = 200;
    response.setHeader('Content-Type', 'video/mp4');
    response.setHeader('Accept-Ranges', 'none');
    await pipeBody(remux.output, response);
  } finally {
    remux.abort();
    mediaSource.abort();
  }
}

function mapFailure(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  if (error instanceof MediaRequestValidationError) {
    writeJson(response, 400, errorBody('INVALID_REQUEST'));
    return;
  }
  if (error instanceof SessionUnavailableError) {
    writeJson(response, 503, errorBody('SESSION_UNAVAILABLE'));
    return;
  }
  if (error instanceof MediaNotFoundError) {
    writeJson(response, 404, errorBody('MEDIA_NOT_FOUND'));
    return;
  }
  if (error instanceof MediaUnsupportedError) {
    writeJson(response, 415, errorBody('MEDIA_ADAPTATION_REQUIRED'));
    return;
  }
  if (error instanceof CatalogProviderError) {
    if (error.code === 'not_found') writeJson(response, 404, errorBody('MEDIA_NOT_FOUND'));
    else if (error.code === 'provider_timeout') writeJson(response, 504, errorBody('PROVIDER_TIMEOUT'));
    else writeJson(response, 502, errorBody('PROVIDER_UNAVAILABLE'));
    return;
  }
  if (error instanceof MediaLocatorError) {
    writeJson(response, 404, errorBody('MEDIA_LOCATOR_INVALID'));
    return;
  }
  if (error instanceof HlsManifestError) {
    writeJson(response, 502, errorBody('INVALID_HLS_MANIFEST'));
    return;
  }
  if (error instanceof MediaProcessError) {
    if (error.code === 'process_unavailable' || error.code === 'busy') {
      writeJson(response, 503, errorBody('MEDIA_ADAPTER_UNAVAILABLE'));
    } else if (error.code === 'cancelled') writeJson(response, 499, errorBody('MEDIA_CANCELLED'));
    else writeJson(response, 415, errorBody('MEDIA_ADAPTATION_REQUIRED'));
    return;
  }
  if (error instanceof ProviderMediaTransportError) {
    if (error.code === 'timeout') writeJson(response, 504, errorBody('PROVIDER_TIMEOUT'));
    else if (error.code === 'cancelled') writeJson(response, 499, errorBody('MEDIA_CANCELLED'));
    else writeJson(response, 502, errorBody('PROVIDER_UNAVAILABLE'));
    return;
  }
  writeJson(response, 500, errorBody('INTERNAL_ERROR'));
}

async function handleLocatorIssue(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: MediaApiDependencies,
): Promise<void> {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    writeJson(response, 405, errorBody('METHOD_NOT_ALLOWED'));
    return;
  }
  if (!validateMutationOrigin(request, dependencies.publicOrigin)) {
    writeJson(response, 403, errorBody('ORIGIN_REJECTED'));
    return;
  }
  const sessionToken = parseSessionCookie(request.headers.cookie, dependencies.cookieName);
  if (!sessionToken) {
    writeJson(response, 401, errorBody('UNAUTHENTICATED'));
    return;
  }
  const lease = await activeLease(dependencies, sessionToken);
  if (!lease) {
    writeJson(response, 401, errorBody('SESSION_EXPIRED'));
    return;
  }

  const locatorRequest = parseLocatorRequest(await readJsonBody(request));
  const target = await authorizeTarget(locatorRequest, dependencies.catalog, lease.credentials);
  const issued = dependencies.locator.issue(sessionToken, target, lease.expiresAtEpochMs);
  const descriptor: MediaLocatorDescriptor = Object.freeze({
    url: `/api/media/r/${issued.token}`,
    expiresAt: new Date(issued.expiresAtEpochMs).toISOString(),
  });
  writeJson(response, 201, descriptor);
}

async function handleMediaResource(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: MediaApiDependencies,
  locatorToken: string,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    writeJson(response, 405, errorBody('METHOD_NOT_ALLOWED'));
    return;
  }
  const sessionToken = parseSessionCookie(request.headers.cookie, dependencies.cookieName);
  if (!sessionToken) {
    writeJson(response, 401, errorBody('UNAUTHENTICATED'));
    return;
  }
  const lease = await activeLease(dependencies, sessionToken);
  if (!lease) {
    writeJson(response, 401, errorBody('SESSION_EXPIRED'));
    return;
  }
  const locator = dependencies.locator.open(locatorToken, sessionToken);
  const controller = new AbortController();
  const onDownstreamAbort = (): void => controller.abort();
  request.once('aborted', onDownstreamAbort);
  response.once('close', onDownstreamAbort);
  const guard = createMediaSessionGuard(
    dependencies.sessions,
    sessionToken,
    lease.expiresAtEpochMs,
    controller,
  );

  try {
    if (locator.target.kind === 'hls') {
      const targetUrl = new URL(locator.target.uri);
      if (locator.target.resource === 'manifest') {
        await serveHlsManifest(request, response, dependencies, sessionToken, lease, targetUrl, controller.signal);
      } else {
        await servePassThrough(request, response, dependencies, targetUrl, controller.signal);
      }
      return;
    }

    const targetUrl = buildXtreamMediaUrl(lease.credentials, locator.target);
    if (locator.target.kind === 'live') {
      await serveHlsManifest(request, response, dependencies, sessionToken, lease, targetUrl, controller.signal);
      return;
    }
    if (locator.target.extension === 'mp4') {
      await servePassThrough(request, response, dependencies, targetUrl, controller.signal);
      return;
    }
    await serveRemux(request, response, dependencies, targetUrl, controller.signal);
  } finally {
    guard.stop();
    request.removeListener('aborted', onDownstreamAbort);
    response.removeListener('close', onDownstreamAbort);
  }
}

export function createMediaApiHandler(dependencies: MediaApiDependencies) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const requestUrl = new URL(request.url ?? '/', 'http://hulk.invalid');
    if (!requestUrl.pathname.startsWith('/api/media')) return false;
    if (requestUrl.search || requestUrl.hash) {
      writeJson(response, 400, errorBody('INVALID_REQUEST'));
      return true;
    }

    try {
      if (requestUrl.pathname === '/api/media/locators') {
        await handleLocatorIssue(request, response, dependencies);
        return true;
      }
      if (requestUrl.pathname.startsWith('/api/media/r/')) {
        const token = requestUrl.pathname.slice('/api/media/r/'.length);
        if (!token || token.includes('/') || token.length > 16 * 1024) {
          throw new MediaRequestValidationError();
        }
        await handleMediaResource(request, response, dependencies, token);
        return true;
      }
      writeJson(response, 404, errorBody('MEDIA_NOT_FOUND'));
      return true;
    } catch (error) {
      mapFailure(response, error);
      return true;
    }
  };
}
