import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { deriveSecurityKeys } from '../dist/apps/server/src/crypto/credential-envelope.js';
import { LoginRateLimiter } from '../dist/apps/server/src/session/login-rate-limiter.js';
import { createRedisSessionBackend } from '../dist/apps/server/src/session/session-backend.js';
import { SessionManager, sessionLookupKey } from '../dist/apps/server/src/session/session-manager.js';

const redisUrl = process.env.HULK_TEST_REDIS_URL;
const redisRequired = process.env.HULK_REQUIRE_REDIS_TEST === '1';

test('required Redis qualification exercises the production session and rate-limit adapters', {
  skip: !redisUrl && !redisRequired,
}, async () => {
  assert.ok(redisUrl, 'HULK_TEST_REDIS_URL is required when Redis qualification is mandatory.');
  const rootSecret = Buffer.alloc(32, 17).toString('base64url');
  const keys = deriveSecurityKeys(rootSecret);
  const prefix = `hulk:ci:${randomBytes(8).toString('hex')}:`;
  const backend = await createRedisSessionBackend(redisUrl, prefix);

  try {
    const sessions = new SessionManager(backend, keys.credentialEncryptionKey, 250);
    const credentials = {
      host: 'https://provider.example/',
      username: 'REDIS_TEST_USERNAME',
      password: 'REDIS_TEST_PASSWORD',
    };

    const active = await sessions.establish(credentials, null);
    assert.equal((await sessions.resolve(active.bearerToken))?.authenticated, true);
    assert.deepEqual(
      (await sessions.acquireProviderCredentials(active.bearerToken))?.credentials,
      credentials,
    );

    const stored = await backend.getSession(sessionLookupKey(active.bearerToken));
    assert.ok(stored);
    const serialized = JSON.stringify(stored);
    assert.equal(serialized.includes(credentials.username), false);
    assert.equal(serialized.includes(credentials.password), false);

    await sessions.revoke(active.bearerToken);
    assert.equal(await sessions.resolve(active.bearerToken), null);
    assert.equal(await sessions.acquireProviderCredentials(active.bearerToken), null);

    const expiring = await sessions.establish(credentials, null);
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(await sessions.resolve(expiring.bearerToken), null);
    assert.equal(await backend.getSession(sessionLookupKey(expiring.bearerToken)), null);

    const limiter = new LoginRateLimiter(backend, keys.rateLimitFingerprintKey, 8, 400);
    const decisions = await Promise.all(
      Array.from({ length: 12 }, () =>
        limiter.consume('203.0.113.10', 'https://provider.example', 'customer'),
      ),
    );
    assert.equal(decisions.filter((decision) => decision.allowed).length, 8);
    await new Promise((resolve) => setTimeout(resolve, 550));
    assert.equal(
      (await limiter.consume('203.0.113.10', 'https://provider.example', 'customer')).allowed,
      true,
    );
  } finally {
    await backend.close();
  }
});
