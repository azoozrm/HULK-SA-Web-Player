import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import {
  CredentialEnvelopeError,
  SecretConfigurationError,
  decryptProviderCredentials,
  deriveSecurityKeys,
  encryptProviderCredentials,
} from '../dist/apps/server/src/crypto/credential-envelope.js';
import { loadRuntimeConfig, RuntimeConfigurationError } from '../dist/apps/server/src/config.js';
import { createSessionApiHandler } from '../dist/apps/server/src/http/session-api.js';
import {
  NodeProviderAuthenticationTransport,
  ProviderTransportError,
  appendBoundedResponseChunk,
} from '../dist/apps/server/src/network/provider-authentication-transport.js';
import {
  ProviderAuthenticationError,
  XtreamProviderAuthenticator,
  parseXtreamAuthenticationResponse,
} from '../dist/apps/server/src/provider/xtream-authenticator.js';
import { isPublicProviderAddress } from '../dist/apps/server/src/security/ip-address.js';
import {
  ProviderNetworkPolicyError,
  approveProviderDestination,
  normalizeProviderUrl,
} from '../dist/apps/server/src/security/provider-url.js';
import { providerAuthenticationLimits } from '../dist/apps/server/src/security/provider-network-policy.js';
import { LoginRateLimiter } from '../dist/apps/server/src/session/login-rate-limiter.js';
import {
  MemorySessionBackend,
  createRedisSessionBackend,
} from '../dist/apps/server/src/session/session-backend.js';
import { SessionManager, sessionLookupKey } from '../dist/apps/server/src/session/session-manager.js';

const rootSecret = Buffer.alloc(32, 7).toString('base64url');
const keys = deriveSecurityKeys(rootSecret);
const origin = 'https://player.example';

function jsonBytes(value) {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function authBody(overrides = {}) {
  return jsonBytes({
    user_info: {
      auth: 1,
      status: 'Active',
      username: 'UPSTREAM_ECHO_USERNAME',
      password: 'UPSTREAM_ECHO_PASSWORD',
      ...overrides,
    },
  });
}

async function startSessionServer(dependencies) {
  const api = createSessionApiHandler(dependencies);
  const server = createServer((request, response) => {
    void api(request, response).then((handled) => {
      if (!handled && !response.writableEnded) {
        response.statusCode = 404;
        response.end();
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      server.close();
      await once(server, 'close');
    },
  };
}

function cookiePair(setCookie) {
  assert.ok(setCookie);
  return setCookie.split(';', 1)[0];
}

function cookieToken(setCookie) {
  const pair = cookiePair(setCookie);
  const separator = pair.indexOf('=');
  assert.ok(separator > 0);
  return pair.slice(separator + 1);
}

test('credential envelope uses authenticated encryption and rejects tampering', () => {
  const credentials = {
    host: 'https://provider.example:8443/',
    username: 'SENSITIVE_USERNAME_998877',
    password: 'SENSITIVE_PASSWORD_998877',
  };
  const envelope = encryptProviderCredentials(credentials, keys.credentialEncryptionKey);
  const serialized = JSON.stringify(envelope);
  assert.equal(serialized.includes(credentials.username), false);
  assert.equal(serialized.includes(credentials.password), false);
  assert.deepEqual(
    decryptProviderCredentials(envelope, keys.credentialEncryptionKey),
    credentials,
  );

  const replacement = envelope.ciphertext.endsWith('A') ? 'B' : 'A';
  const tampered = { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -1)}${replacement}` };
  assert.throws(
    () => decryptProviderCredentials(tampered, keys.credentialEncryptionKey),
    CredentialEnvelopeError,
  );
  assert.throws(() => deriveSecurityKeys(''), SecretConfigurationError);
  assert.notDeepEqual(keys.credentialEncryptionKey, keys.rateLimitFingerprintKey);
});

test('provider URL and IP policy reject local, private, special, metadata, and alternate forms', async () => {
  assert.equal(isPublicProviderAddress('8.8.8.8'), true);
  assert.equal(isPublicProviderAddress('2606:4700:4700::1111'), true);
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '192.0.2.1',
    '192.31.196.1',
    '192.52.193.1',
    '192.175.48.1',
    '224.0.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '100:0:0:1::1',
    '5f00::1',
    '::ffff:127.0.0.1',
  ]) {
    assert.equal(isPublicProviderAddress(address), false, address);
  }

  assert.equal(
    normalizeProviderUrl('https://provider.example:8443/portal/player_api.php').toString(),
    'https://provider.example:8443/portal/',
  );

  for (const value of [
    'ftp://provider.example',
    'http://user:pass@provider.example',
    'http://localhost',
    'http://panel.localhost',
    'http://provider.example/?username=x',
    'http://provider.example/#x',
  ]) {
    assert.throws(() => normalizeProviderUrl(value), ProviderNetworkPolicyError);
  }

  let resolverCalls = 0;
  const neverResolver = {
    async resolve() {
      resolverCalls += 1;
      throw new Error('should not resolve IP literals');
    },
  };
  await assert.rejects(
    approveProviderDestination('http://2130706433', neverResolver),
    ProviderNetworkPolicyError,
  );
  await assert.rejects(
    approveProviderDestination('http://0x7f000001', neverResolver),
    ProviderNetworkPolicyError,
  );
  await assert.rejects(
    approveProviderDestination('http://[::ffff:127.0.0.1]', neverResolver),
    ProviderNetworkPolicyError,
  );
  assert.equal(resolverCalls, 0);
});

test('DNS approval fails closed and connection executor receives exactly the validated address', async () => {
  const mixedResolver = {
    async resolve() {
      return [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ];
    },
  };
  await assert.rejects(
    approveProviderDestination('https://provider.example', mixedResolver),
    (error) => error instanceof ProviderNetworkPolicyError && error.code === 'prohibited_provider_destination',
  );

  await assert.rejects(
    approveProviderDestination('https://provider.example', { async resolve() { return []; } }),
    (error) => error instanceof ProviderNetworkPolicyError && error.code === 'provider_dns_failed',
  );
  await assert.rejects(
    approveProviderDestination('https://provider.example', { async resolve() { throw new Error('dns'); } }),
    (error) => error instanceof ProviderNetworkPolicyError && error.code === 'provider_dns_failed',
  );

  let resolveCalls = 0;
  let executorCalls = 0;
  let captured;
  const resolver = {
    async resolve(hostname) {
      resolveCalls += 1;
      assert.equal(hostname, 'provider.example');
      return [{ address: '93.184.216.34', family: 4 }];
    },
  };
  const transport = new NodeProviderAuthenticationTransport(resolver, async (request, limits) => {
    executorCalls += 1;
    captured = request;
    assert.deepEqual(limits, providerAuthenticationLimits);
    return { status: 200, body: authBody() };
  });
  await transport.authenticate({
    host: 'https://provider.example:8443/portal',
    username: 'customer',
    password: 'secret',
  });
  assert.equal(resolveCalls, 1);
  assert.equal(executorCalls, 1);
  assert.equal(captured.connectAddress, '93.184.216.34');
  assert.equal(captured.hostname, 'provider.example');
  assert.equal(captured.port, 8443);
  assert.equal(captured.tlsServername, 'provider.example');
  assert.equal(captured.hostHeader, 'provider.example:8443');
  assert.match(captured.pathWithQuery, /^\/portal\/player_api\.php\?/u);
  assert.match(captured.pathWithQuery, /username=customer/u);
  assert.match(captured.pathWithQuery, /password=secret/u);
});

test('provider transport bounds response size and exposes bounded time policy', () => {
  assert.ok(providerAuthenticationLimits.connectTimeoutMs > 0);
  assert.ok(providerAuthenticationLimits.readTimeoutMs > 0);
  assert.ok(providerAuthenticationLimits.totalTimeoutMs > 0);
  assert.ok(providerAuthenticationLimits.maximumResponseBytes > 0);
  const first = appendBoundedResponseChunk([], 0, Buffer.alloc(4), 5);
  assert.equal(first.bytes, 4);
  assert.throws(
    () => appendBoundedResponseChunk(first.chunks, first.bytes, Buffer.alloc(2), 5),
    (error) => error instanceof ProviderTransportError && error.code === 'response_too_large',
  );
});

test('Xtream authentication fails closed and returns only allow-listed account state', async () => {
  const success = parseXtreamAuthenticationResponse(
    authBody({ exp_date: String(Math.floor(Date.now() / 1000) + 3600) }),
  );
  assert.deepEqual(Object.keys(success), ['providerExpiresAtEpochMs']);
  assert.equal(JSON.stringify(success).includes('UPSTREAM_ECHO_USERNAME'), false);
  assert.equal(JSON.stringify(success).includes('UPSTREAM_ECHO_PASSWORD'), false);

  for (const body of [
    jsonBytes({ user_info: { auth: 0, status: 'Active' } }),
    jsonBytes({ user_info: { auth: 1, status: 'Disabled' } }),
    jsonBytes({ user_info: { auth: 1, status: 'Expired' } }),
    Buffer.from('{not-json'),
  ]) {
    assert.throws(() => parseXtreamAuthenticationResponse(body), ProviderAuthenticationError);
  }

  let calls = 0;
  const redirectingTransport = {
    async authenticate() {
      calls += 1;
      return { status: 302, body: Buffer.alloc(0) };
    },
  };
  const authenticator = new XtreamProviderAuthenticator(redirectingTransport);
  await assert.rejects(
    authenticator.authenticate({ host: 'https://provider.example', username: 'u', password: 'p' }),
    ProviderAuthenticationError,
  );
  assert.equal(calls, 1, 'redirects are not followed by the authentication operation');
});

test('bounded sessions use fresh opaque tokens, encrypted store records, provider expiry, revoke, and server expiry', async () => {
  let now = Date.now();
  const backend = new MemorySessionBackend(() => now);
  const sessions = new SessionManager(backend, keys.credentialEncryptionKey, 60_000, () => now);
  const providerExpiry = now + 30_000;
  const login = {
    host: 'https://provider.example/',
    username: 'SENSITIVE_USERNAME_998877',
    password: 'SENSITIVE_PASSWORD_998877',
  };
  const first = await sessions.establish(login, providerExpiry);
  const second = await sessions.establish(login, providerExpiry);
  assert.notEqual(first.bearerToken, second.bearerToken);
  assert.equal(Date.parse(first.descriptor.expiresAt), providerExpiry);

  const stored = await backend.getSession(sessionLookupKey(first.bearerToken));
  assert.ok(stored);
  const serialized = JSON.stringify(stored);
  assert.equal(serialized.includes(login.username), false);
  assert.equal(serialized.includes(login.password), false);

  const lease = await sessions.acquireProviderCredentials(first.bearerToken);
  assert.deepEqual(lease?.credentials, login);
  await sessions.revoke(first.bearerToken);
  assert.equal(await sessions.resolve(first.bearerToken), null);
  assert.equal(await sessions.acquireProviderCredentials(first.bearerToken), null);

  now = providerExpiry + 1;
  assert.equal(await sessions.resolve(second.bearerToken), null);
  assert.equal(await sessions.acquireProviderCredentials(second.bearerToken), null);
});

test('memory login limiter enforces threshold and resets after window without raw account keys', async () => {
  let now = 1_000;
  const backend = new MemorySessionBackend(() => now);
  const limiter = new LoginRateLimiter(backend, keys.rateLimitFingerprintKey, 3, 500);
  assert.equal((await limiter.consume('198.51.100.20', 'https://provider.example', 'customer')).allowed, true);
  assert.equal((await limiter.consume('198.51.100.20', 'https://provider.example', 'customer')).allowed, true);
  assert.equal((await limiter.consume('198.51.100.20', 'https://provider.example', 'customer')).allowed, true);
  assert.equal((await limiter.consume('198.51.100.20', 'https://provider.example', 'customer')).allowed, false);
  now += 501;
  assert.equal((await limiter.consume('198.51.100.20', 'https://provider.example', 'customer')).allowed, true);
});

test('session HTTP API enforces body/origin security, no-store, secure cookie, fixation resistance, status, and idempotent logout', async () => {
  const backend = new MemorySessionBackend();
  const sessions = new SessionManager(backend, keys.credentialEncryptionKey, 60_000);
  const rateLimiter = new LoginRateLimiter(backend, keys.rateLimitFingerprintKey, 20, 60_000);
  const authenticator = {
    async authenticate() {
      return { providerExpiresAtEpochMs: null };
    },
  };
  const dependencies = {
    authenticator,
    sessions,
    rateLimiter,
    config: { publicOrigin: origin, cookieName: '__Host-hulk_session', secureCookie: true },
  };
  const server = await startSessionServer(dependencies);
  try {
    const payload = {
      host: 'https://provider.example',
      username: 'customer',
      password: 'top-secret',
    };
    const loginResponse = await fetch(`${server.baseUrl}/api/session`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        Cookie: '__Host-hulk_session=attacker_supplied_session_identity_123456',
      },
      body: JSON.stringify(payload),
    });
    assert.equal(loginResponse.status, 201);
    assert.equal(loginResponse.headers.get('cache-control'), 'no-store');
    const setCookie = loginResponse.headers.get('set-cookie');
    assert.ok(setCookie);
    assert.match(setCookie, /HttpOnly/u);
    assert.match(setCookie, /Secure/u);
    assert.match(setCookie, /SameSite=Strict/u);
    assert.match(setCookie, /Path=\//u);
    assert.match(setCookie, /Max-Age=\d+/u);
    assert.equal(/Domain=/iu.test(setCookie), false);
    const token = cookieToken(setCookie);
    assert.notEqual(token, 'attacker_supplied_session_identity_123456');
    const loginJson = await loginResponse.json();
    const serializedLogin = JSON.stringify(loginJson);
    assert.equal(serializedLogin.includes(payload.username), false);
    assert.equal(serializedLogin.includes(payload.password), false);

    const statusResponse = await fetch(`${server.baseUrl}/api/session`, {
      headers: { Cookie: cookiePair(setCookie) },
    });
    assert.equal(statusResponse.status, 200);
    assert.equal(statusResponse.headers.get('cache-control'), 'no-store');
    const statusJson = await statusResponse.json();
    assert.equal(statusJson.authenticated, true);
    assert.equal('username' in statusJson, false);
    assert.equal('password' in statusJson, false);

    const rejectedLogout = await fetch(`${server.baseUrl}/api/session`, {
      method: 'DELETE',
      headers: { Cookie: cookiePair(setCookie) },
    });
    assert.equal(rejectedLogout.status, 403);

    const logout = await fetch(`${server.baseUrl}/api/session`, {
      method: 'DELETE',
      headers: { Origin: origin, Cookie: cookiePair(setCookie) },
    });
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get('set-cookie') ?? '', /Max-Age=0/u);

    const revoked = await fetch(`${server.baseUrl}/api/session`, {
      headers: { Cookie: cookiePair(setCookie) },
    });
    assert.equal(revoked.status, 401);
    assert.deepEqual(await revoked.json(), { authenticated: false });

    const logoutAgain = await fetch(`${server.baseUrl}/api/session`, {
      method: 'DELETE',
      headers: { Origin: origin, Cookie: cookiePair(setCookie) },
    });
    assert.equal(logoutAgain.status, 204);

    const missing = await fetch(`${server.baseUrl}/api/session`);
    assert.equal(missing.status, 401);
    assert.equal(missing.headers.get('cache-control'), 'no-store');

    const badOrigin = await fetch(`${server.baseUrl}/api/session`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(badOrigin.status, 403);

    const credentialsInQuery = await fetch(`${server.baseUrl}/api/session?username=x&password=y`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(credentialsInQuery.status, 400);

    const extraField = await fetch(`${server.baseUrl}/api/session`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, extra: true }),
    });
    assert.equal(extraField.status, 400);

    const wrongMediaType = await fetch(`${server.baseUrl}/api/session`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
    });
    assert.equal(wrongMediaType.status, 415);
  } finally {
    await server.close();
    await backend.close();
  }
});

test('failed Provider authentication never creates a browser session', async () => {
  const backend = new MemorySessionBackend();
  const sessions = new SessionManager(backend, keys.credentialEncryptionKey, 60_000);
  const rateLimiter = new LoginRateLimiter(backend, keys.rateLimitFingerprintKey, 20, 60_000);
  const authenticator = {
    async authenticate() {
      throw new ProviderAuthenticationError('authentication_failed');
    },
  };
  const server = await startSessionServer({
    authenticator,
    sessions,
    rateLimiter,
    config: { publicOrigin: origin, cookieName: '__Host-hulk_session', secureCookie: true },
  });
  try {
    const response = await fetch(`${server.baseUrl}/api/session`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'https://provider.example', username: 'bad', password: 'bad' }),
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await response.json(), { error: { code: 'AUTHENTICATION_FAILED' } });
  } finally {
    await server.close();
    await backend.close();
  }
});

test('production configuration fails closed without key, HTTPS origin, and Redis store', () => {
  const base = {
    NODE_ENV: 'production',
    HULK_PORT: '3000',
    HULK_PUBLIC_ORIGIN: 'https://player.example',
    HULK_SESSION_STORE: 'redis',
    HULK_REDIS_URL: 'redis://127.0.0.1:6379',
    HULK_SESSION_ENCRYPTION_KEY: rootSecret,
  };
  assert.equal(loadRuntimeConfig(base).cookieName, '__Host-hulk_session');
  assert.throws(
    () => loadRuntimeConfig({ ...base, HULK_SESSION_ENCRYPTION_KEY: '' }),
    RuntimeConfigurationError,
  );
  assert.throws(
    () => loadRuntimeConfig({ ...base, HULK_SESSION_STORE: 'memory' }),
    RuntimeConfigurationError,
  );
  assert.throws(
    () => loadRuntimeConfig({ ...base, HULK_PUBLIC_ORIGIN: 'http://player.example' }),
    RuntimeConfigurationError,
  );
  assert.throws(
    () => loadRuntimeConfig({ ...base, HULK_ALLOW_INSECURE_LOCAL_COOKIE: 'true' }),
    RuntimeConfigurationError,
  );
});

test('browser source does not persist credentials, expose cookies, or build credential-bearing application URLs', async () => {
  const source = await readFile(new URL('../apps/web/src/main.ts', import.meta.url), 'utf8');
  for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.equal(/[?&](?:username|password)=/iu.test(source), false);
  assert.equal(source.includes('sessionToken'), false);
});

test('Redis/Valkey production adapter qualifies TTL/revoke and atomic login limiting when CI service is available', {
  skip: !process.env.HULK_TEST_REDIS_URL,
}, async () => {
  const prefix = `hulk:test:${randomBytes(8).toString('hex')}:`;
  const backend = await createRedisSessionBackend(process.env.HULK_TEST_REDIS_URL, prefix);
  try {
    const record = {
      v: 1,
      expiresAtEpochMs: Date.now() + 5_000,
      credentialEnvelope: encryptProviderCredentials(
        { host: 'https://provider.example', username: 'u', password: 'p' },
        keys.credentialEncryptionKey,
      ),
    };
    await backend.putSession('session:test', record, 5_000);
    assert.deepEqual(await backend.getSession('session:test'), record);
    await backend.deleteSession('session:test');
    assert.equal(await backend.getSession('session:test'), null);

    const decisions = await Promise.all(
      Array.from({ length: 12 }, () => backend.consumeLoginAttempt(['login:a', 'login:b'], 8, 400)),
    );
    assert.equal(decisions.filter((decision) => decision.allowed).length, 8);
    await new Promise((resolve) => setTimeout(resolve, 550));
    assert.equal((await backend.consumeLoginAttempt(['login:a', 'login:b'], 8, 400)).allowed, true);
  } finally {
    await backend.close();
  }
});
