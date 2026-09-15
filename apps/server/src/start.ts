import { createServer } from 'node:http';
import { deriveSecurityKeys } from './crypto/credential-envelope.js';
import { loadRuntimeConfig } from './config.js';
import { createAppHandler } from './http/app-handler.js';
import { NodeProviderAuthenticationTransport } from './network/provider-authentication-transport.js';
import { SystemProviderDnsResolver } from './network/system-dns-resolver.js';
import { XtreamProviderAuthenticator } from './provider/xtream-authenticator.js';
import { LoginRateLimiter } from './session/login-rate-limiter.js';
import { createRedisSessionBackend, MemorySessionBackend } from './session/session-backend.js';
import { SessionManager } from './session/session-manager.js';

const config = loadRuntimeConfig();
const securityKeys = deriveSecurityKeys(config.sessionRootKey);
const backend = config.sessionStore === 'redis'
  ? await createRedisSessionBackend(config.redisUrl ?? '')
  : new MemorySessionBackend();
const transport = new NodeProviderAuthenticationTransport(new SystemProviderDnsResolver());
const authenticator = new XtreamProviderAuthenticator(transport);
const sessions = new SessionManager(
  backend,
  securityKeys.credentialEncryptionKey,
  config.sessionTtlMs,
);
const rateLimiter = new LoginRateLimiter(
  backend,
  securityKeys.rateLimitFingerprintKey,
  config.loginAttemptLimit,
  config.loginWindowMs,
);
const handler = createAppHandler({
  authenticator,
  sessions,
  rateLimiter,
  config: {
    publicOrigin: config.publicOrigin,
    cookieName: config.cookieName,
    secureCookie: config.secureCookie,
  },
});
const server = createServer((request, response) => {
  void handler(request, response);
});

server.listen(config.port, config.bindHost);

async function shutdown(): Promise<void> {
  server.close();
  await backend.close();
}

process.once('SIGTERM', () => {
  void shutdown();
});
process.once('SIGINT', () => {
  void shutdown();
});
