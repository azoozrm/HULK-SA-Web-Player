import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUtf8, walkFiles } from './lib/files.mjs';
import {
  browserCredentialPersistenceViolations,
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
}

const expectedServerSources = [
  'src/control-plane.ts',
  'src/security/provider-network-policy.ts',
];
const actualServerSources = (await walkFiles(resolve(root, 'apps/server'))).sort();
if (JSON.stringify(actualServerSources) !== JSON.stringify(expectedServerSources)) {
  failures.push('apps/server: Phase 1 permits only typed control-plane and network-policy sources');
}

const packageJson = JSON.parse(await readUtf8(resolve(root, 'package.json')));
if (Object.keys(packageJson.dependencies ?? {}).length !== 0) {
  failures.push('package.json: Phase 1 must keep zero production runtime package dependencies');
}

const requiredNetworkTerms = [
  'allowedSchemes',
  'rejectUrlUserInfo',
  'rejectLocalhost',
  'rejectLoopback',
  'rejectPrivateAddressSpace',
  'rejectLinkLocal',
  'rejectMulticastAndReserved',
  'rejectCloudMetadataDestinations',
  'validateIpv4AndIpv6',
  'defendAgainstDnsRebinding',
  'bindConnectionToValidatedDestination',
  'redirectPolicy',
  'boundedConnectTimeout',
  'boundedReadTimeout',
  'boundedTotalRequestTime',
  'boundedResponseSize',
  'restrictedMethods',
  'infrastructureEgressControlWhereAvailable',
  'redactSensitiveUrlsAndLogs',
];
const networkPolicy = await readUtf8(
  resolve(root, 'apps/server/src/security/provider-network-policy.ts'),
);
for (const term of requiredNetworkTerms) {
  if (!networkPolicy.includes(term)) failures.push(`Provider network policy missing ${term}`);
}

if (failures.length) {
  throw new Error(`Security contract violations:\n${failures.join('\n')}`);
}

process.stdout.write('Security contracts PASS\n');
