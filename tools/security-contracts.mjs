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
  failures.push('package.json: Phase 2 runtime dependency must be exactly @redis/client@6.2.1');
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
for (const term of ['aes-256-gcm', 'hkdfSync', 'randomBytes', 'setAAD']) {
  if (!credentialCrypto.includes(term)) failures.push(`Credential protection missing ${term}`);
}

const ssrfDocument = await readUtf8(resolve(root, 'docs/security/SSRF-NETWORK-BOUNDARY.md'));
if (!ssrfDocument.includes('Phase 2 runtime status')) {
  failures.push('SSRF contract must record the Phase 2 runtime enforcement status');
}

if (failures.length) {
  throw new Error(`Security contract violations:\n${failures.join('\n')}`);
}

process.stdout.write('Security contracts PASS\n');
