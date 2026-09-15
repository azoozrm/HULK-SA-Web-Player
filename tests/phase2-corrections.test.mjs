import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { deriveSecurityKeys } from '../dist/apps/server/src/crypto/credential-envelope.js';
import { executeBoundProviderRequest } from '../dist/apps/server/src/network/provider-authentication-transport.js';
import { providerAuthenticationLimits } from '../dist/apps/server/src/security/provider-network-policy.js';
import { LoginRateLimiter } from '../dist/apps/server/src/session/login-rate-limiter.js';
import { MemorySessionBackend } from '../dist/apps/server/src/session/session-backend.js';
import { requestLogout } from '../dist/apps/web/src/session-client.js';

const keys = deriveSecurityKeys(Buffer.alloc(32, 29).toString('base64url'));

async function exerciseRealBoundHttpSocket(connectAddress, family, logicalHostname) {
  let observedHost = null;
  const server = createServer((request, response) => {
    observedHost = request.headers.host ?? null;
    response.statusCode = 200;
    response.end('bound-ok');
  });
  server.listen(0, connectAddress);
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    const response = await executeBoundProviderRequest(
      {
        protocol: 'http:',
        hostname: logicalHostname,
        port: address.port,
        connectAddress,
        family,
        tlsServername: null,
        hostHeader: `${logicalHostname}:${address.port}`,
        pathWithQuery: '/connector-proof',
      },
      providerAuthenticationLimits,
    );
    assert.equal(response.status, 200);
    assert.equal(Buffer.from(response.body).toString('utf8'), 'bound-ok');
    assert.equal(observedHost, `${logicalHostname}:${address.port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('real Node HTTP socket path binds the validated IPv4 address without resolving the logical hostname', async () => {
  await exerciseRealBoundHttpSocket('127.0.0.1', 4, 'provider-v4.invalid');
});

test('real Node HTTP socket path binds the validated IPv6 address without resolving the logical hostname', async () => {
  await exerciseRealBoundHttpSocket('::1', 6, 'provider-v6.invalid');
});

test('account rate limiting canonicalizes equivalent Provider URLs and preserves username case', async () => {
  const equivalentBackend = new MemorySessionBackend();
  const equivalentLimiter = new LoginRateLimiter(
    equivalentBackend,
    keys.rateLimitFingerprintKey,
    3,
    60_000,
  );
  const equivalentHosts = [
    'https://provider.example',
    'https://provider.example/',
    'https://provider.example:443',
    'https://provider.example/player_api.php',
  ];
  const equivalentDecisions = [];
  for (const [index, host] of equivalentHosts.entries()) {
    equivalentDecisions.push(
      (await equivalentLimiter.consume(`client-${index}`, host, 'CaseSensitiveUser')).allowed,
    );
  }
  assert.deepEqual(equivalentDecisions, [true, true, true, false]);

  const distinctBackend = new MemorySessionBackend();
  const distinctLimiter = new LoginRateLimiter(
    distinctBackend,
    keys.rateLimitFingerprintKey,
    1,
    60_000,
  );
  assert.equal(
    (await distinctLimiter.consume('client-a', 'https://provider.example', 'CaseSensitiveUser'))
      .allowed,
    true,
  );
  assert.equal(
    (await distinctLimiter.consume('client-b', 'https://provider.example:8443', 'CaseSensitiveUser'))
      .allowed,
    true,
  );
  assert.equal(
    (await distinctLimiter.consume('client-c', 'https://provider.example', 'casesensitiveuser'))
      .allowed,
    true,
  );
  assert.equal(
    (await distinctLimiter.consume('client-d', 'https://provider.example/', 'CaseSensitiveUser'))
      .allowed,
    false,
  );
});

test('browser logout helper reports success only when server revocation is confirmed', async () => {
  let observedRequest = null;
  assert.equal(
    await requestLogout(async (input, init) => {
      observedRequest = { input, init };
      return { ok: true };
    }),
    true,
  );
  assert.deepEqual(observedRequest, {
    input: '/api/session',
    init: { method: 'DELETE', credentials: 'same-origin' },
  });

  assert.equal(await requestLogout(async () => ({ ok: false })), false);
  await assert.rejects(
    requestLogout(async () => {
      throw new Error('network unavailable');
    }),
    /network unavailable/u,
  );
});
