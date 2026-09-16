import { createServer } from 'node:http';
import { deriveSecurityKeys } from './crypto/credential-envelope.js';
import { loadRuntimeConfig } from './config.js';
import { createAppHandler } from './http/app-handler.js';
import { MediaLocatorCodec } from './media/media-locator.js';
import { NodeFfmpegMediaAdapter } from './media/remux.js';
import { NodeProviderAuthenticationTransport } from './network/provider-authentication-transport.js';
import { NodeProviderCatalogTransport } from './network/provider-catalog-transport.js';
import { NodeProviderMediaTransport } from './network/provider-media-transport.js';
import { SystemProviderDnsResolver } from './network/system-dns-resolver.js';
import { XtreamProviderAuthenticator } from './provider/xtream-authenticator.js';
import { XtreamCatalogService } from './provider/xtream-catalog.js';
import { LoginRateLimiter } from './session/login-rate-limiter.js';
import { createRedisSessionBackend, MemorySessionBackend } from './session/session-backend.js';
import { SessionManager } from './session/session-manager.js';

const config = loadRuntimeConfig();
const securityKeys = deriveSecurityKeys(config.sessionRootKey);
const backend = config.sessionStore === 'redis'
  ? await createRedisSessionBackend(config.redisUrl ?? '')
  : new MemorySessionBackend();
const resolver = new SystemProviderDnsResolver();
const authenticationTransport = new NodeProviderAuthenticationTransport(resolver);
const catalogTransport = new NodeProviderCatalogTransport(resolver);
const mediaTransport = new NodeProviderMediaTransport(resolver);
const authenticator = new XtreamProviderAuthenticator(authenticationTransport);
const catalog = new XtreamCatalogService(catalogTransport);
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
const mediaLocator = new MediaLocatorCodec(securityKeys.mediaLocatorKey);
const mediaAdapter = new NodeFfmpegMediaAdapter();
const handler = createAppHandler({
  authenticator,
  catalog,
  sessions,
  rateLimiter,
  media: {
    transport: mediaTransport,
    locator: mediaLocator,
    adapter: mediaAdapter,
  },
  config: {
    publicOrigin: config.publicOrigin,
    appBasePath: config.appBasePath,
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
