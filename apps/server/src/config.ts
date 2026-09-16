export type RuntimeMode = 'development' | 'test' | 'production';
export type SessionStoreKind = 'memory' | 'redis';

export type RuntimeConfig = Readonly<{
  mode: RuntimeMode;
  bindHost: string;
  port: number;
  publicOrigin: string;
  appBasePath: string;
  sessionStore: SessionStoreKind;
  redisUrl: string | null;
  sessionRootKey: string;
  sessionTtlMs: number;
  loginAttemptLimit: number;
  loginWindowMs: number;
  cookieName: string;
  secureCookie: boolean;
}>;

export class RuntimeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeConfigurationError';
  }
}

function integerEnv(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RuntimeConfigurationError(`${name} is outside its permitted range.`);
  }
  return parsed;
}

function parseOrigin(value: string | undefined, mode: RuntimeMode, port: number): URL {
  const candidate = value || (mode === 'development' ? `http://127.0.0.1:${port}` : '');
  if (!candidate) throw new RuntimeConfigurationError('HULK_PUBLIC_ORIGIN is required.');
  let origin: URL;
  try {
    origin = new URL(candidate);
  } catch {
    throw new RuntimeConfigurationError('HULK_PUBLIC_ORIGIN is invalid.');
  }
  if (origin.origin !== candidate.replace(/\/$/u, '') || origin.pathname !== '/') {
    throw new RuntimeConfigurationError('HULK_PUBLIC_ORIGIN must contain only scheme and authority.');
  }
  if (mode === 'production' && origin.protocol !== 'https:') {
    throw new RuntimeConfigurationError('Production HULK_PUBLIC_ORIGIN must use HTTPS.');
  }
  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') {
    throw new RuntimeConfigurationError('HULK_PUBLIC_ORIGIN must use HTTP or HTTPS.');
  }
  return origin;
}

function parseAppBasePath(value: string | undefined): string {
  const candidate = (value ?? '').trim();
  if (!candidate || candidate === '/') return '';
  if (!/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/u.test(candidate)) {
    throw new RuntimeConfigurationError(
      'HULK_APP_BASE_PATH must be empty or an absolute path without a trailing slash.',
    );
  }
  const segments = candidate.slice(1).split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new RuntimeConfigurationError('HULK_APP_BASE_PATH cannot contain dot segments.');
  }
  return candidate;
}

function isLoopbackOrigin(origin: URL): boolean {
  return (
    origin.hostname === 'localhost' ||
    origin.hostname === '127.0.0.1' ||
    origin.hostname === '[::1]' ||
    origin.hostname === '::1'
  );
}

function validateRedisUrl(value: string | undefined, required: boolean): string | null {
  if (!value) {
    if (required) throw new RuntimeConfigurationError('HULK_REDIS_URL is required.');
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RuntimeConfigurationError('HULK_REDIS_URL is invalid.');
  }
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new RuntimeConfigurationError('HULK_REDIS_URL must use redis or rediss.');
  }
  return value;
}

export function loadRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeConfig {
  const modeValue = environment.NODE_ENV ?? 'development';
  if (modeValue !== 'development' && modeValue !== 'test' && modeValue !== 'production') {
    throw new RuntimeConfigurationError('NODE_ENV is invalid.');
  }
  const mode: RuntimeMode = modeValue;
  const port = integerEnv(environment.HULK_PORT, 3000, 1, 65535, 'HULK_PORT');
  const publicOrigin = parseOrigin(environment.HULK_PUBLIC_ORIGIN, mode, port);
  const requestedStore = environment.HULK_SESSION_STORE ?? (mode === 'production' ? 'redis' : 'memory');
  if (requestedStore !== 'memory' && requestedStore !== 'redis') {
    throw new RuntimeConfigurationError('HULK_SESSION_STORE is invalid.');
  }
  if (mode === 'production' && requestedStore !== 'redis') {
    throw new RuntimeConfigurationError('Production session storage must use Redis/Valkey.');
  }

  const sessionRootKey = environment.HULK_SESSION_ENCRYPTION_KEY ?? '';
  if (!sessionRootKey) {
    throw new RuntimeConfigurationError('HULK_SESSION_ENCRYPTION_KEY is required.');
  }

  const allowInsecureLocalCookie = environment.HULK_ALLOW_INSECURE_LOCAL_COOKIE === 'true';
  if (mode === 'production' && allowInsecureLocalCookie) {
    throw new RuntimeConfigurationError('Insecure cookies cannot be enabled in production.');
  }
  if (allowInsecureLocalCookie && (!isLoopbackOrigin(publicOrigin) || publicOrigin.protocol !== 'http:')) {
    throw new RuntimeConfigurationError('Insecure cookies are allowed only for loopback HTTP development.');
  }
  const secureCookie = !allowInsecureLocalCookie;

  const sessionTtlSeconds = integerEnv(
    environment.HULK_SESSION_TTL_SECONDS,
    28_800,
    900,
    86_400,
    'HULK_SESSION_TTL_SECONDS',
  );
  const loginAttemptLimit = integerEnv(
    environment.HULK_LOGIN_ATTEMPT_LIMIT,
    8,
    2,
    100,
    'HULK_LOGIN_ATTEMPT_LIMIT',
  );
  const loginWindowSeconds = integerEnv(
    environment.HULK_LOGIN_WINDOW_SECONDS,
    300,
    30,
    3_600,
    'HULK_LOGIN_WINDOW_SECONDS',
  );

  return Object.freeze({
    mode,
    bindHost: environment.HULK_BIND_HOST || '127.0.0.1',
    port,
    publicOrigin: publicOrigin.origin,
    appBasePath: parseAppBasePath(environment.HULK_APP_BASE_PATH),
    sessionStore: requestedStore,
    redisUrl: validateRedisUrl(environment.HULK_REDIS_URL, requestedStore === 'redis'),
    sessionRootKey,
    sessionTtlMs: sessionTtlSeconds * 1000,
    loginAttemptLimit,
    loginWindowMs: loginWindowSeconds * 1000,
    cookieName: secureCookie ? '__Host-hulk_session' : 'hulk_session_dev',
    secureCookie,
  });
}
