import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions as HttpsRequestOptions } from 'node:https';
import { isIP } from 'node:net';
import type {
  ProviderAuthenticationTransport,
  ProviderAuthenticationTransportResponse,
  ServerHeldProviderCredentials,
} from '../control-plane.js';
import {
  approveProviderDestination,
  type ApprovedProviderDestination,
  type ProviderDnsResolver,
} from '../security/provider-url.js';
import { providerAuthenticationLimits } from '../security/provider-network-policy.js';

export type BoundProviderRequest = Readonly<{
  protocol: 'http:' | 'https:';
  hostname: string;
  port: number;
  connectAddress: string;
  family: 4 | 6;
  tlsServername: string | null;
  hostHeader: string;
  pathWithQuery: string;
}>;

export type ProviderTransportLimits = Readonly<{
  connectTimeoutMs: number;
  readTimeoutMs: number;
  totalTimeoutMs: number;
  maximumResponseBytes: number;
}>;

export type BoundProviderRequestExecutor = (
  request: BoundProviderRequest,
  limits: ProviderTransportLimits,
) => Promise<ProviderAuthenticationTransportResponse>;

export class ProviderTransportError extends Error {
  readonly code:
    | 'timeout'
    | 'response_too_large'
    | 'upstream_unavailable'
    | 'upstream_protocol_error';

  constructor(code: ProviderTransportError['code']) {
    super('Provider authentication transport failed.');
    this.name = 'ProviderTransportError';
    this.code = code;
  }
}

export function appendBoundedResponseChunk(
  current: readonly Buffer[],
  currentBytes: number,
  chunk: Buffer,
  maximumResponseBytes: number,
): Readonly<{ chunks: readonly Buffer[]; bytes: number }> {
  const nextBytes = currentBytes + chunk.length;
  if (nextBytes > maximumResponseBytes) {
    throw new ProviderTransportError('response_too_large');
  }
  return Object.freeze({ chunks: [...current, chunk], bytes: nextBytes });
}

function buildRequestOptions(request: BoundProviderRequest): HttpsRequestOptions {
  const options: HttpsRequestOptions = {
    protocol: request.protocol,
    hostname: request.hostname,
    port: request.port,
    method: 'GET',
    path: request.pathWithQuery,
    headers: {
      Accept: 'application/json',
      Host: request.hostHeader,
    },
    agent: false,
    family: request.family,
    lookup: (_hostname, lookupOptions, callback) => {
      if (lookupOptions.all) {
        callback(null, [{ address: request.connectAddress, family: request.family }]);
        return;
      }
      callback(null, request.connectAddress, request.family);
    },
  };

  if (request.protocol === 'https:' && request.tlsServername) {
    options.servername = request.tlsServername;
  }
  return options;
}

function safeDestroy(request: ClientRequest, error: ProviderTransportError): void {
  if (!request.destroyed) request.destroy(error);
}

export async function executeBoundProviderRequest(
  request: BoundProviderRequest,
  limits: ProviderTransportLimits,
): Promise<ProviderAuthenticationTransportResponse> {
  return await new Promise<ProviderAuthenticationTransportResponse>((resolve, reject) => {
    let settled = false;
    let connectTimer: NodeJS.Timeout | null = null;
    let totalTimer: NodeJS.Timeout | null = null;

    const finish = (
      error: ProviderTransportError | null,
      response?: ProviderAuthenticationTransportResponse,
    ): void => {
      if (settled) return;
      settled = true;
      if (connectTimer) clearTimeout(connectTimer);
      if (totalTimer) clearTimeout(totalTimer);
      if (error) reject(error);
      else if (response) resolve(response);
      else reject(new ProviderTransportError('upstream_protocol_error'));
    };

    const requestFunction = request.protocol === 'https:' ? httpsRequest : httpRequest;
    const outgoing = requestFunction(buildRequestOptions(request), (incoming: IncomingMessage) => {
      let chunks: readonly Buffer[] = [];
      let bytes = 0;
      incoming.setTimeout(limits.readTimeoutMs, () => {
        safeDestroy(outgoing, new ProviderTransportError('timeout'));
      });
      incoming.on('data', (value: Buffer | string) => {
        try {
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
          const next = appendBoundedResponseChunk(
            chunks,
            bytes,
            chunk,
            limits.maximumResponseBytes,
          );
          chunks = next.chunks;
          bytes = next.bytes;
        } catch (error) {
          safeDestroy(
            outgoing,
            error instanceof ProviderTransportError
              ? error
              : new ProviderTransportError('upstream_protocol_error'),
          );
        }
      });
      incoming.on('end', () => {
        finish(null, {
          status: incoming.statusCode ?? 0,
          body: Buffer.concat(chunks, bytes),
        });
      });
      incoming.on('error', () => finish(new ProviderTransportError('upstream_unavailable')));
    });

    totalTimer = setTimeout(() => {
      safeDestroy(outgoing, new ProviderTransportError('timeout'));
    }, limits.totalTimeoutMs);
    totalTimer.unref();

    outgoing.on('socket', (socket) => {
      if (!socket.connecting) return;
      connectTimer = setTimeout(() => {
        safeDestroy(outgoing, new ProviderTransportError('timeout'));
      }, limits.connectTimeoutMs);
      connectTimer.unref();
      const eventName = request.protocol === 'https:' ? 'secureConnect' : 'connect';
      socket.once(eventName, () => {
        if (connectTimer) clearTimeout(connectTimer);
        connectTimer = null;
      });
    });
    outgoing.on('error', (error) => {
      finish(
        error instanceof ProviderTransportError
          ? error
          : new ProviderTransportError('upstream_unavailable'),
      );
    });
    outgoing.end();
  });
}

export class NodeProviderAuthenticationTransport implements ProviderAuthenticationTransport {
  constructor(
    private readonly resolver: ProviderDnsResolver,
    private readonly executor: BoundProviderRequestExecutor = executeBoundProviderRequest,
  ) {}

  async authenticate(
    credentials: ServerHeldProviderCredentials,
  ): Promise<ProviderAuthenticationTransportResponse> {
    const approved = await approveProviderDestination(credentials.host, this.resolver);
    const request = this.createBoundRequest(approved, credentials);
    return await this.executor(request, providerAuthenticationLimits);
  }

  private createBoundRequest(
    approved: ApprovedProviderDestination,
    credentials: ServerHeldProviderCredentials,
  ): BoundProviderRequest {
    const endpoint = new URL('player_api.php', approved.baseUrl);
    endpoint.searchParams.set('username', credentials.username);
    endpoint.searchParams.set('password', credentials.password);

    return Object.freeze({
      protocol: approved.baseUrl.protocol as 'http:' | 'https:',
      hostname: approved.hostname,
      port: approved.port,
      connectAddress: approved.connectAddress,
      family: approved.family,
      tlsServername:
        approved.baseUrl.protocol === 'https:' && isIP(approved.hostname) === 0
          ? approved.hostname
          : null,
      hostHeader: approved.baseUrl.host,
      pathWithQuery: `${endpoint.pathname}${endpoint.search}`,
    });
  }
}
