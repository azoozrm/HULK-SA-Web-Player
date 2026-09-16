import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProviderLoginRequest } from '../../../../packages/contracts/src/index.js';
import type { ProviderAuthenticator, ProviderSessionBoundary } from '../control-plane.js';
import type { LoginRateLimiter } from '../session/login-rate-limiter.js';
import { ProviderAuthenticationError } from '../provider/xtream-authenticator.js';

const MAXIMUM_LOGIN_BODY_BYTES = 8 * 1024;

export type SessionHttpConfig = Readonly<{
  publicOrigin: string;
  cookieName: string;
  secureCookie: boolean;
}>;

export type SessionApiDependencies = Readonly<{
  authenticator: ProviderAuthenticator;
  sessions: ProviderSessionBoundary;
  rateLimiter: LoginRateLimiter;
  config: SessionHttpConfig;
}>;

type ParsedLoginRequest = Readonly<{
  credentials: ProviderLoginRequest;
  rememberAccount: boolean;
}>;

class RequestValidationError extends Error {}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  setSecurityHeaders(response);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(value));
}

function writeNoContent(response: ServerResponse): void {
  setSecurityHeaders(response);
  response.statusCode = 204;
  response.end();
}

function errorBody(code: string): Readonly<{ error: Readonly<{ code: string }> }> {
  return Object.freeze({ error: Object.freeze({ code }) });
}

function parseCookie(header: string | undefined, cookieName: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== cookieName) continue;
    const value = part.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{20,256}$/u.test(value) ? value : null;
  }
  return null;
}

function sessionCookie(
  cookieName: string,
  token: string,
  expiresAt: string,
  secure: boolean,
  persistent: boolean,
): string {
  const parts = [
    `${cookieName}=${token}`,
    'Path=/',
    'HttpOnly',
    secure ? 'Secure' : null,
    'SameSite=Strict',
  ].filter((part): part is string => part !== null);

  if (persistent) {
    const expiresAtMs = Date.parse(expiresAt);
    const maxAge = Number.isFinite(expiresAtMs)
      ? Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000))
      : 0;
    parts.push(`Max-Age=${maxAge}`, `Expires=${new Date(expiresAtMs).toUTCString()}`);
  }

  return parts.join('; ');
}

function clearedSessionCookie(cookieName: string, secure: boolean): string {
  return [
    `${cookieName}=`,
    'Path=/',
    'HttpOnly',
    secure ? 'Secure' : null,
    'SameSite=Strict',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ]
    .filter((part): part is string => part !== null)
    .join('; ');
}

function validateMutationOrigin(request: IncomingMessage, expectedOrigin: string): boolean {
  const origin = request.headers.origin;
  if (origin !== expectedOrigin) return false;
  const fetchSite = request.headers['sec-fetch-site'];
  return fetchSite === undefined || fetchSite === 'same-origin';
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers['content-type']?.toLowerCase() ?? '';
  if (!/^application\/json(?:\s*;|$)/u.test(contentType)) {
    throw new RequestValidationError('Unsupported media type.');
  }
  const declaredLength = request.headers['content-length'];
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (!Number.isInteger(parsedLength) || parsedLength < 0 || parsedLength > MAXIMUM_LOGIN_BODY_BYTES) {
      throw new RequestValidationError('Request body is invalid.');
    }
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAXIMUM_LOGIN_BODY_BYTES) {
      throw new RequestValidationError('Request body is too large.');
    }
    chunks.push(buffer);
  }

  if (bytes === 0) throw new RequestValidationError('Request body is required.');
  try {
    return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')) as unknown;
  } catch {
    throw new RequestValidationError('Request body is malformed.');
  }
}

function parseLoginRequest(value: unknown): ParsedLoginRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RequestValidationError('Login request is invalid.');
  }
  const record = value as Readonly<Record<string, unknown>>;
  const rememberAccount = record.rememberAccount;
  const keys = Object.keys(record).sort();
  const shape = keys.join(',');
  if (
    shape !== 'host,password,username' &&
    shape !== 'host,password,rememberAccount,username'
  ) {
    throw new RequestValidationError('Login request has an invalid shape.');
  }
  if (
    typeof record.host !== 'string' ||
    typeof record.username !== 'string' ||
    typeof record.password !== 'string' ||
    (rememberAccount !== undefined && typeof rememberAccount !== 'boolean')
  ) {
    throw new RequestValidationError('Login fields are invalid.');
  }

  const host = record.host.trim();
  const username = record.username.trim();
  const password = record.password;
  if (
    !host ||
    !username ||
    !password ||
    host.length > 2048 ||
    username.length > 256 ||
    password.length > 512
  ) {
    throw new RequestValidationError('Login fields are invalid.');
  }

  return Object.freeze({
    credentials: Object.freeze({ host, username, password }),
    rememberAccount: rememberAccount === undefined ? true : rememberAccount,
  });
}

function clientIdentity(request: IncomingMessage): string {
  return request.socket.remoteAddress || 'unknown-client';
}

export function createSessionApiHandler(dependencies: SessionApiDependencies) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const requestUrl = new URL(request.url ?? '/', 'http://hulk.invalid');
    if (requestUrl.pathname !== '/api/session') return false;
    if (requestUrl.search || requestUrl.hash) {
      writeJson(response, 400, errorBody('INVALID_REQUEST'));
      return true;
    }

    if (request.method === 'GET') {
      const token = parseCookie(request.headers.cookie, dependencies.config.cookieName);
      if (!token) {
        writeJson(response, 401, { authenticated: false });
        return true;
      }
      const descriptor = await dependencies.sessions.resolve(token);
      if (!descriptor) {
        response.setHeader(
          'Set-Cookie',
          clearedSessionCookie(dependencies.config.cookieName, dependencies.config.secureCookie),
        );
        writeJson(response, 401, { authenticated: false });
        return true;
      }
      writeJson(response, 200, descriptor);
      return true;
    }

    if (request.method === 'POST') {
      if (!validateMutationOrigin(request, dependencies.config.publicOrigin)) {
        writeJson(response, 403, errorBody('ORIGIN_REJECTED'));
        return true;
      }

      let requestLogin: ParsedLoginRequest;
      try {
        requestLogin = parseLoginRequest(await readJsonBody(request));
      } catch (error) {
        writeJson(
          response,
          error instanceof RequestValidationError &&
            request.headers['content-type'] !== undefined &&
            !/^application\/json(?:\s*;|$)/u.test(request.headers['content-type'].toLowerCase())
            ? 415
            : 400,
          errorBody('INVALID_REQUEST'),
        );
        return true;
      }

      const { credentials: login, rememberAccount } = requestLogin;
      try {
        const rateLimit = await dependencies.rateLimiter.consume(
          clientIdentity(request),
          login.host,
          login.username,
        );
        if (!rateLimit.allowed) {
          response.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
          writeJson(response, 429, errorBody('TOO_MANY_ATTEMPTS'));
          return true;
        }

        const account = await dependencies.authenticator.authenticate(login);
        const previousToken = parseCookie(request.headers.cookie, dependencies.config.cookieName);
        if (previousToken) await dependencies.sessions.revoke(previousToken);
        const established = await dependencies.sessions.establish(
          login,
          account.providerExpiresAtEpochMs,
        );
        response.setHeader(
          'Set-Cookie',
          sessionCookie(
            dependencies.config.cookieName,
            established.bearerToken,
            established.descriptor.expiresAt,
            dependencies.config.secureCookie,
            rememberAccount,
          ),
        );
        writeJson(response, 201, established.descriptor);
      } catch (error) {
        if (error instanceof ProviderAuthenticationError) {
          const status = error.code === 'provider_unavailable' ? 502 : error.code === 'invalid_provider_url' ? 400 : 401;
          const code = error.code === 'provider_unavailable'
            ? 'PROVIDER_UNAVAILABLE'
            : error.code === 'invalid_provider_url'
              ? 'INVALID_PROVIDER'
              : 'AUTHENTICATION_FAILED';
          writeJson(response, status, errorBody(code));
          return true;
        }
        writeJson(response, 503, errorBody('SESSION_UNAVAILABLE'));
      }
      return true;
    }

    if (request.method === 'DELETE') {
      if (!validateMutationOrigin(request, dependencies.config.publicOrigin)) {
        writeJson(response, 403, errorBody('ORIGIN_REJECTED'));
        return true;
      }
      const token = parseCookie(request.headers.cookie, dependencies.config.cookieName);
      if (token) await dependencies.sessions.revoke(token);
      response.setHeader(
        'Set-Cookie',
        clearedSessionCookie(dependencies.config.cookieName, dependencies.config.secureCookie),
      );
      writeNoContent(response);
      return true;
    }

    response.setHeader('Allow', 'GET, POST, DELETE');
    writeJson(response, 405, errorBody('METHOD_NOT_ALLOWED'));
    return true;
  };
}
