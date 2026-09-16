import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage } from 'node:http';
import type { RequestOptions as HttpsRequestOptions } from 'node:https';
import { isIP } from 'node:net';
import { Transform, type Readable } from 'node:stream';
import {
  ByteRangeError,
  ByteRangeResponseError,
  parseSingleByteRange,
  validateSatisfiedRangeResponse,
  validateUnsatisfiedRangeResponse,
} from '../media/range.js';
import {
  approveProviderRequestUrl,
  type ApprovedProviderRequestDestination,
  type ProviderDnsResolver,
} from '../security/provider-url.js';
import { providerMediaLimits } from '../security/provider-network-policy.js';

export type ProviderMediaMethod = 'GET' | 'HEAD';

export type ProviderMediaHeaders = Readonly<{
  contentType: string | null;
  contentLength: string | null;
  contentRange: string | null;
  acceptRanges: string | null;
}>;

export type ProviderMediaResponse = Readonly<{
  status: number;
  headers: ProviderMediaHeaders;
  body: Readable | null;
  abort: () => void;
}>;

export type ProviderMediaOpenRequest = Readonly<{
  url: URL;
  method: ProviderMediaMethod;
  range: string | null;
  accept: string | null;
  signal: AbortSignal;
}>;

export interface ProviderMediaTransport {
  open(request: ProviderMediaOpenRequest): Promise<ProviderMediaResponse>;
}

export class ProviderMediaTransportError extends Error {
  readonly code:
    | 'timeout'
    | 'response_too_large'
    | 'upstream_unavailable'
    | 'upstream_protocol_error'
    | 'redirect_rejected'
    | 'cancelled';

  constructor(code: ProviderMediaTransportError['code']) {
    super('Provider media transport failed.');
    this.name = 'ProviderMediaTransportError';
    this.code = code;
  }
}

function cleanHeader(value: string | string[] | undefined, maximumLength: number): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) return null;
  if (/[\r\n\u0000]/u.test(value)) return null;
  return value;
}

export function filterProviderMediaResponseHeaders(headers: IncomingHttpHeaders): ProviderMediaHeaders {
  const contentLengthText = cleanHeader(headers['content-length'], 32);
  const contentLengthValue = contentLengthText ? Number(contentLengthText) : Number.NaN;
  const contentLength =
    contentLengthText &&
    /^\d+$/u.test(contentLengthText) &&
    Number.isSafeInteger(contentLengthValue) &&
    contentLengthValue >= 0 &&
    contentLengthValue <= providerMediaLimits.maximumStreamBytes
      ? contentLengthText
      : null;
  return Object.freeze({
    contentType: cleanHeader(headers['content-type'], 256),
    contentLength,
    contentRange: cleanHeader(headers['content-range'], 128),
    acceptRanges: headers['accept-ranges'] === 'bytes' ? 'bytes' : null,
  });
}

export function validateProviderMediaRangeResponse(
  requestRange: string | null,
  status: number,
  headers: ProviderMediaHeaders,
): void {
  if (status !== 206 && status !== 416) return;
  try {
    const parsedRange = parseSingleByteRange(requestRange ?? undefined);
    if (status === 206) {
      validateSatisfiedRangeResponse(parsedRange, headers.contentRange, headers.contentLength);
    } else {
      validateUnsatisfiedRangeResponse(parsedRange, headers.contentRange);
    }
  } catch (error) {
    if (error instanceof ByteRangeError || error instanceof ByteRangeResponseError) {
      throw new ProviderMediaTransportError('upstream_protocol_error');
    }
    throw error;
  }
}

function requestOptions(
  approved: ApprovedProviderRequestDestination,
  request: ProviderMediaOpenRequest,
): HttpsRequestOptions {
  const headers: Record<string, string> = {
    Host: approved.requestUrl.host,
  };
  if (request.accept) headers.Accept = request.accept;
  if (request.range) headers.Range = request.range;

  const options: HttpsRequestOptions = {
    protocol: approved.requestUrl.protocol,
    hostname: approved.hostname,
    port: approved.port,
    method: request.method,
    path: `${approved.requestUrl.pathname}${approved.requestUrl.search}`,
    headers,
    agent: false,
    family: approved.family,
    lookup: (_hostname, lookupOptions, callback) => {
      if (lookupOptions.all) {
        callback(null, [{ address: approved.connectAddress, family: approved.family }]);
        return;
      }
      callback(null, approved.connectAddress, approved.family);
    },
  };
  if (approved.requestUrl.protocol === 'https:' && isIP(approved.hostname) === 0) {
    options.servername = approved.hostname;
  }
  return options;
}

function safeDestroy(request: ClientRequest, code: ProviderMediaTransportError['code']): void {
  if (!request.destroyed) request.destroy(new ProviderMediaTransportError(code));
}

class MediaByteLimitTransform extends Transform {
  private bytes = 0;

  override _transform(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    this.bytes += buffer.length;
    if (this.bytes > providerMediaLimits.maximumStreamBytes) {
      callback(new ProviderMediaTransportError('response_too_large'));
      return;
    }
    callback(null, buffer);
  }
}

export class NodeProviderMediaTransport implements ProviderMediaTransport {
  constructor(private readonly resolver: ProviderDnsResolver) {}

  async open(request: ProviderMediaOpenRequest): Promise<ProviderMediaResponse> {
    if (request.signal.aborted) throw new ProviderMediaTransportError('cancelled');
    const approved = await approveProviderRequestUrl(request.url, this.resolver);
    if (request.signal.aborted) throw new ProviderMediaTransportError('cancelled');

    return await new Promise<ProviderMediaResponse>((resolve, reject) => {
      let settled = false;
      let connectTimer: NodeJS.Timeout | null = null;
      let responseTimer: NodeJS.Timeout | null = null;
      let totalTimer: NodeJS.Timeout | null = null;
      let incomingResponse: IncomingMessage | null = null;
      const requestFunction = approved.requestUrl.protocol === 'https:' ? httpsRequest : httpRequest;
      const outgoing = requestFunction(requestOptions(approved, request), (incoming) => {
        incomingResponse = incoming;
        if (connectTimer) clearTimeout(connectTimer);
        connectTimer = null;
        if (responseTimer) clearTimeout(responseTimer);
        responseTimer = null;

        if ((incoming.statusCode ?? 0) >= 300 && (incoming.statusCode ?? 0) < 400) {
          incoming.resume();
          settled = true;
          reject(new ProviderMediaTransportError('redirect_rejected'));
          safeDestroy(outgoing, 'redirect_rejected');
          return;
        }

        const responseHeaders = filterProviderMediaResponseHeaders(incoming.headers);
        try {
          validateProviderMediaRangeResponse(request.range, incoming.statusCode ?? 0, responseHeaders);
        } catch (error) {
          incoming.resume();
          settled = true;
          reject(error);
          safeDestroy(outgoing, 'upstream_protocol_error');
          return;
        }

        incoming.once('close', cleanup);
        incoming.setTimeout(providerMediaLimits.readTimeoutMs, () => {
          safeDestroy(outgoing, 'timeout');
        });

        const abort = (): void => {
          if (!incoming.destroyed) incoming.destroy(new ProviderMediaTransportError('cancelled'));
          safeDestroy(outgoing, 'cancelled');
        };

        if (request.method === 'HEAD') {
          incoming.resume();
          settled = true;
          resolve(Object.freeze({
            status: incoming.statusCode ?? 0,
            headers: responseHeaders,
            body: null,
            abort,
          }));
          return;
        }

        const limiter = new MediaByteLimitTransform();
        incoming.once('error', () => {
          limiter.destroy(new ProviderMediaTransportError('upstream_unavailable'));
        });
        incoming.pipe(limiter);
        limiter.once('error', (error) => {
          const code = error instanceof ProviderMediaTransportError
            ? error.code
            : 'upstream_protocol_error';
          safeDestroy(outgoing, code);
        });
        settled = true;
        resolve(Object.freeze({
          status: incoming.statusCode ?? 0,
          headers: responseHeaders,
          body: limiter,
          abort,
        }));
      });

      const onAbort = (): void => safeDestroy(outgoing, 'cancelled');
      request.signal.addEventListener('abort', onAbort, { once: true });

      const cleanup = (): void => {
        if (connectTimer) clearTimeout(connectTimer);
        if (responseTimer) clearTimeout(responseTimer);
        if (totalTimer) clearTimeout(totalTimer);
        request.signal.removeEventListener('abort', onAbort);
      };

      responseTimer = setTimeout(() => safeDestroy(outgoing, 'timeout'), providerMediaLimits.readTimeoutMs);
      responseTimer.unref();
      totalTimer = setTimeout(
        () => safeDestroy(outgoing, 'timeout'),
        providerMediaLimits.maximumStreamDurationMs,
      );
      totalTimer.unref();

      outgoing.on('socket', (socket) => {
        if (!socket.connecting) return;
        connectTimer = setTimeout(
          () => safeDestroy(outgoing, 'timeout'),
          providerMediaLimits.connectTimeoutMs,
        );
        connectTimer.unref();
        socket.once(approved.requestUrl.protocol === 'https:' ? 'secureConnect' : 'connect', () => {
          if (connectTimer) clearTimeout(connectTimer);
          connectTimer = null;
        });
      });

      outgoing.once('error', (error) => {
        cleanup();
        const mapped = error instanceof ProviderMediaTransportError
          ? error
          : new ProviderMediaTransportError('upstream_unavailable');
        if (!settled) reject(mapped);
        else if (incomingResponse && !incomingResponse.destroyed) incomingResponse.destroy(mapped);
      });
      outgoing.once('close', cleanup);
      outgoing.end();
    });
  }
}
