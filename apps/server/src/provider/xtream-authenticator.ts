import type {
  AuthenticatedProviderAccount,
  ProviderAuthenticationTransport,
  ProviderAuthenticator,
  ServerHeldProviderCredentials,
} from '../control-plane.js';
import type { ProviderLoginRequest } from '../../../../packages/contracts/src/index.js';
import { ProviderNetworkPolicyError, normalizeProviderUrl } from '../security/provider-url.js';
import { ProviderTransportError } from '../network/provider-authentication-transport.js';

const INACTIVE_STATUSES = new Set([
  'inactive',
  'disabled',
  'banned',
  'expired',
  'blocked',
  'closed',
]);

export class ProviderAuthenticationError extends Error {
  readonly code: 'authentication_failed' | 'provider_unavailable' | 'invalid_provider_url';

  constructor(code: ProviderAuthenticationError['code']) {
    super('Provider authentication failed.');
    this.name = 'ProviderAuthenticationError';
    this.code = code;
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function parseAuthFlag(value: unknown): boolean {
  return value === 1 || value === '1' || value === true;
}

function parseProviderExpiry(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const seconds = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const millis = Math.trunc(seconds * 1000);
  return Number.isSafeInteger(millis) ? millis : null;
}

export function parseXtreamAuthenticationResponse(
  body: Uint8Array,
  nowEpochMs = Date.now(),
): AuthenticatedProviderAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body).toString('utf8'));
  } catch {
    throw new ProviderAuthenticationError('authentication_failed');
  }

  const root = asRecord(parsed);
  const userInfo = root ? asRecord(root.user_info) : null;
  if (!userInfo || !parseAuthFlag(userInfo.auth)) {
    throw new ProviderAuthenticationError('authentication_failed');
  }

  if (typeof userInfo.status === 'string') {
    const status = userInfo.status.trim().toLowerCase();
    if (INACTIVE_STATUSES.has(status)) {
      throw new ProviderAuthenticationError('authentication_failed');
    }
  }

  const providerExpiresAtEpochMs = parseProviderExpiry(userInfo.exp_date);
  if (providerExpiresAtEpochMs !== null && providerExpiresAtEpochMs <= nowEpochMs) {
    throw new ProviderAuthenticationError('authentication_failed');
  }

  return Object.freeze({ providerExpiresAtEpochMs });
}

function toServerCredentials(input: ProviderLoginRequest): ServerHeldProviderCredentials {
  const host = input.host.trim();
  const username = input.username.trim();
  const password = input.password;
  if (
    !host ||
    !username ||
    !password ||
    host.length > 2048 ||
    username.length > 256 ||
    password.length > 512
  ) {
    throw new ProviderAuthenticationError('authentication_failed');
  }

  let normalizedHost: string;
  try {
    normalizedHost = normalizeProviderUrl(host).toString();
  } catch (error) {
    if (error instanceof ProviderNetworkPolicyError) {
      throw new ProviderAuthenticationError('invalid_provider_url');
    }
    throw error;
  }

  return Object.freeze({ host: normalizedHost, username, password });
}

export class XtreamProviderAuthenticator implements ProviderAuthenticator {
  constructor(
    private readonly transport: ProviderAuthenticationTransport,
    private readonly now: () => number = Date.now,
  ) {}

  async authenticate(input: ProviderLoginRequest): Promise<AuthenticatedProviderAccount> {
    const credentials = toServerCredentials(input);
    try {
      const response = await this.transport.authenticate(credentials);
      if (response.status >= 500) {
        throw new ProviderAuthenticationError('provider_unavailable');
      }
      if (response.status < 200 || response.status >= 300) {
        throw new ProviderAuthenticationError('authentication_failed');
      }
      return parseXtreamAuthenticationResponse(response.body, this.now());
    } catch (error) {
      if (error instanceof ProviderAuthenticationError) throw error;
      if (error instanceof ProviderNetworkPolicyError) {
        throw new ProviderAuthenticationError(
          error.code === 'invalid_provider_url' || error.code === 'prohibited_provider_destination'
            ? 'invalid_provider_url'
            : 'provider_unavailable',
        );
      }
      if (error instanceof ProviderTransportError) {
        throw new ProviderAuthenticationError('provider_unavailable');
      }
      throw new ProviderAuthenticationError('provider_unavailable');
    }
  }
}
