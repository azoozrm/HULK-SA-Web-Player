import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUtf8, walkFiles } from './lib/files.mjs';
import {
  browserCredentialPersistenceViolations,
  browserSessionExposureViolations,
  nonEmptySecretExampleViolations,
} from './repository-policy.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const failures = [];

const envExample = await readUtf8(resolve(root, '.env.example'));
for (const name of nonEmptySecretExampleViolations(envExample)) {
  failures.push(`.env.example: secret-like key ${name} must be empty`);
}

for (const file of await walkFiles(resolve(root, 'apps/web'))) {
  if (!/\.(?:ts|js|mjs)$/u.test(file)) continue;
  const source = await readUtf8(resolve(root, 'apps/web', file));
  for (const violation of browserCredentialPersistenceViolations(source)) {
    failures.push(`apps/web/${file}: prohibited browser persistence ${violation}`);
  }
  for (const violation of browserSessionExposureViolations(source)) {
    failures.push(`apps/web/${file}: prohibited browser session exposure ${violation}`);
  }
}

const packageJson = JSON.parse(await readUtf8(resolve(root, 'package.json')));
const runtimeDependencies = Object.entries(packageJson.dependencies ?? {});
if (
  runtimeDependencies.length !== 1 ||
  runtimeDependencies[0]?.[0] !== '@redis/client' ||
  runtimeDependencies[0]?.[1] !== '6.2.1'
) {
  failures.push('package.json: runtime dependency must remain exactly @redis/client@6.2.1');
}

const serverFiles = await walkFiles(resolve(root, 'apps/server'));
for (const file of serverFiles) {
  if (!/\.(?:ts|js|mjs)$/u.test(file)) continue;
  const source = await readUtf8(resolve(root, 'apps/server', file));
  if (/rejectUnauthorized\s*:\s*false/u.test(source)) {
    failures.push(`apps/server/${file}: TLS certificate validation cannot be disabled`);
  }
  if (/\bx-forwarded-for\b/iu.test(source)) {
    failures.push(`apps/server/${file}: untrusted forwarded client identity is prohibited`);
  }
  if (/\bconsole\.(?:log|info|warn|error|debug)\b/u.test(source)) {
    failures.push(`apps/server/${file}: security-sensitive runtime logging must use a future allow-list logger`);
  }
}

const networkTransport = await readUtf8(
  resolve(root, 'apps/server/src/network/provider-authentication-transport.ts'),
);
for (const term of [
  'connectAddress',
  'lookup:',
  'family: request.family',
  'tlsServername',
  'connectTimeoutMs',
  'readTimeoutMs',
  'totalTimeoutMs',
  'maximumResponseBytes',
]) {
  if (!networkTransport.includes(term)) failures.push(`Provider transport missing ${term}`);
}

const catalogTransport = await readUtf8(
  resolve(root, 'apps/server/src/network/provider-catalog-transport.ts'),
);
for (const term of [
  'approveProviderDestination',
  'executeBoundProviderRequest',
  'connectAddress',
  'tlsServername',
  'get_live_categories',
  'get_live_streams',
  'get_vod_categories',
  'get_vod_streams',
  'get_vod_info',
  'get_series_categories',
  'get_series',
  'get_series_info',
]) {
  if (!catalogTransport.includes(term)) failures.push(`Catalog Provider transport missing ${term}`);
}
if (/operation\.(?:action|path|url|query)/u.test(catalogTransport)) {
  failures.push('Catalog Provider transport must not accept arbitrary upstream action/path/url/query values');
}

const catalogApi = await readUtf8(resolve(root, 'apps/server/src/http/catalog-api.ts'));
for (const term of ['acquireProviderCredentials', 'Cache-Control', 'no-store', 'INVALID_REQUEST']) {
  if (!catalogApi.includes(term)) failures.push(`Catalog API missing ${term}`);
}
if (/localStorage|sessionStorage|indexedDB/iu.test(catalogApi)) {
  failures.push('Catalog API must not persist browser credentials or sessions');
}

const catalogNormalizer = await readUtf8(
  resolve(root, 'apps/server/src/catalog/catalog-normalizer.ts'),
);
for (const term of ['SENSITIVE_QUERY_NAME', 'url.username', 'url.password', 'root.episodes']) {
  if (!catalogNormalizer.includes(term)) failures.push(`Catalog normalizer missing ${term}`);
}

const loginRateLimiter = await readUtf8(
  resolve(root, 'apps/server/src/session/login-rate-limiter.ts'),
);
if (!loginRateLimiter.includes('normalizeProviderUrl(providerHost).toString()')) {
  failures.push('Login rate limiter must canonicalize Provider URLs with the shared normalizer');
}
if (!loginRateLimiter.includes('username.trim()')) {
  failures.push('Login rate limiter must use the trimmed username in the account identity');
}
if (/username\.trim\(\)\.toLowerCase\(\)/u.test(loginRateLimiter)) {
  failures.push('Login rate limiter must preserve username case without an authoritative case-insensitive contract');
}

const sessionApi = await readUtf8(resolve(root, 'apps/server/src/http/session-api.ts'));
for (const term of ['HttpOnly', 'SameSite=Strict', 'Cache-Control', 'no-store', 'ORIGIN_REJECTED']) {
  if (!sessionApi.includes(term)) failures.push(`Session API missing ${term}`);
}

const credentialCrypto = await readUtf8(
  resolve(root, 'apps/server/src/crypto/credential-envelope.ts'),
);
for (const term of [
  'aes-256-gcm',
  'hkdfSync',
  'randomBytes',
  'setAAD',
  'MEDIA_LOCATOR_INFO',
  'mediaLocatorKey',
]) {
  if (!credentialCrypto.includes(term)) failures.push(`Credential protection missing ${term}`);
}

const mediaLocator = await readUtf8(resolve(root, 'apps/server/src/media/media-locator.ts'));
for (const term of ['createCipheriv', 'createDecipheriv', 'timingSafeEqual', 'expiresAtEpochMs', 'sessionOwner']) {
  if (!mediaLocator.includes(term)) failures.push(`Media locator boundary missing ${term}`);
}

const mediaTransport = await readUtf8(
  resolve(root, 'apps/server/src/network/provider-media-transport.ts'),
);
for (const term of [
  'approveProviderRequestUrl',
  'connectAddress',
  'lookup:',
  'family: approved.family',
  'servername',
  'redirect_rejected',
  'maximumStreamDurationMs',
  'maximumStreamBytes',
  'filterProviderMediaResponseHeaders',
]) {
  if (!mediaTransport.includes(term)) failures.push(`Media Provider transport missing ${term}`);
}
if (/['"](?:set-cookie|location)['"]\s*:/iu.test(mediaTransport)) {
  failures.push('Media Provider transport must not forward Provider Set-Cookie or Location headers');
}

const mediaApi = await readUtf8(resolve(root, 'apps/server/src/http/media-api.ts'));
for (const term of [
  'acquireProviderCredentials',
  'locator.open',
  'createMediaSessionGuard',
  'MEDIA_SESSION_REVALIDATION_MS',
  'parseSingleByteRange',
  'Content-Range',
  'Cache-Control',
  'no-store',
  'SESSION_UNAVAILABLE',
]) {
  if (!mediaApi.includes(term)) failures.push(`Media API missing ${term}`);
}
if (/localStorage|sessionStorage|indexedDB/iu.test(mediaApi)) {
  failures.push('Media API must not persist browser credentials or locators');
}

const hlsRewriter = await readUtf8(resolve(root, 'apps/server/src/media/hls-rewriter.ts'));
for (const term of [
  '#EXT-X-KEY',
  '#EXT-X-MAP',
  '#EXT-X-MEDIA',
  '#EXT-X-I-FRAME-STREAM-INF',
  '#EXT-X-SESSION-KEY',
  '#EXT-X-SESSION-DATA',
  '#EXT-X-PART',
  '#EXT-X-PRELOAD-HINT',
  '#EXT-X-RENDITION-REPORT',
  'MAXIMUM_HLS_MANIFEST_BYTES',
  'assertNoUpstreamUri',
]) {
  if (!hlsRewriter.includes(term)) failures.push(`HLS rewrite boundary missing ${term}`);
}
if (/forbiddenSubstrings|credentials\.(?:username|password)/u.test(hlsRewriter)) {
  failures.push('HLS rewriting must use URI-field ownership, not credential substring coincidence checks');
}

const remux = await readUtf8(resolve(root, 'apps/server/src/media/remux.ts'));
for (const term of [
  'spawn(',
  'shell: false',
  "'-protocol_whitelist'",
  "'pipe:0'",
  "'pipe:1'",
  'MAXIMUM_PROBE_INPUT_BYTES',
  'BoundedProcessPool',
  'selectRemuxPath',
  'guardStdin',
]) {
  if (!remux.includes(term)) failures.push(`Remux process boundary missing ${term}`);
}
if (/\bexec(?:File)?\s*\(/u.test(remux)) {
  failures.push('Remux process boundary must use spawn without shell execution');
}
if (/env:\s*process\.env/u.test(remux)) {
  failures.push('Remux child processes must not inherit the complete server environment');
}

const ssrfDocument = await readUtf8(resolve(root, 'docs/security/SSRF-NETWORK-BOUNDARY.md'));
for (const term of ['Phase 2 runtime status', 'Phase 3 catalog runtime status', 'Phase 4 media runtime status']) {
  if (!ssrfDocument.includes(term)) failures.push(`SSRF contract must record ${term}`);
}

if (failures.length) {
  throw new Error(`Security contract violations:\n${failures.join('\n')}`);
}

process.stdout.write('Security contracts PASS\n');
