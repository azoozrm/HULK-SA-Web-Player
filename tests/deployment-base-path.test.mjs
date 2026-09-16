import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadRuntimeConfig, RuntimeConfigurationError } from '../dist/apps/server/src/config.js';
import { deriveSecurityKeys } from '../dist/apps/server/src/crypto/credential-envelope.js';
import { createAppHandler } from '../dist/apps/server/src/http/app-handler.js';
import {
  appExternalPath,
  renderAppBasePathTemplate,
  stripAppBasePath,
} from '../dist/apps/server/src/http/app-path.js';
import { createMediaApiHandler } from '../dist/apps/server/src/http/media-api.js';
import { MediaLocatorCodec } from '../dist/apps/server/src/media/media-locator.js';
import { requestLogout } from '../dist/apps/web/src/session-client.js';

function baseEnvironment(overrides = {}) {
  return {
    NODE_ENV: 'development',
    HULK_PUBLIC_ORIGIN: 'https://hulksa.com',
    HULK_SESSION_STORE: 'memory',
    HULK_SESSION_ENCRYPTION_KEY: 'development-only-test-key',
    ...overrides,
  };
}

async function startHandlerServer(handler) {
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      server.close();
      await once(server, 'close');
    },
  };
}

test('sub-URI configuration is normalized and invalid application base paths fail closed', () => {
  const config = loadRuntimeConfig(baseEnvironment({ HULK_APP_BASE_PATH: '/player' }));
  assert.equal(config.appBasePath, '/player');
  assert.equal(loadRuntimeConfig(baseEnvironment()).appBasePath, '');
  assert.equal(loadRuntimeConfig(baseEnvironment({ HULK_APP_BASE_PATH: '/' })).appBasePath, '');

  for (const value of ['player', '/player/', '/player/../admin', '/player?x=1', '/player#x']) {
    assert.throws(
      () => loadRuntimeConfig(baseEnvironment({ HULK_APP_BASE_PATH: value })),
      RuntimeConfigurationError,
      value,
    );
  }
});

test('application path helpers preserve Passenger-stripped requests and prefix browser-owned URLs', () => {
  assert.equal(stripAppBasePath('/player/api/session', '/player'), '/api/session');
  assert.equal(stripAppBasePath('/player/api/session?check=1', '/player'), '/api/session?check=1');
  assert.equal(stripAppBasePath('/api/session', '/player'), '/api/session');
  assert.equal(stripAppBasePath('/player', '/player'), '/');
  assert.equal(appExternalPath('/player', '/api/media/r/token'), '/player/api/media/r/token');
  assert.equal(appExternalPath('', '/api/session'), '/api/session');
});

test('index template and browser logout stay under the configured application mount', async () => {
  const template = await readFile(new URL('../apps/web/index.html', import.meta.url), 'utf8');
  const rendered = renderAppBasePathTemplate(template, '/player');
  assert.match(rendered, /content="\/player"/u);
  assert.match(rendered, /href="\/player\/styles\.css"/u);
  assert.match(rendered, /src="\/player\/src\/main\.js"/u);
  assert.equal(rendered.includes('__HULK_APP_BASE_PATH__'), false);

  let requestedUrl = '';
  const revoked = await requestLogout(async (input) => {
    requestedUrl = input;
    return { ok: true };
  }, '/player/api/session');
  assert.equal(revoked, true);
  assert.equal(requestedUrl, '/player/api/session');
});

test('app handler accepts the externally mounted session path before Passenger stripping', async () => {
  const handler = createAppHandler({
    authenticator: {},
    sessions: {},
    rateLimiter: {},
    catalog: {},
    media: { transport: {}, locator: {}, adapter: {} },
    config: {
      publicOrigin: 'https://hulksa.com',
      appBasePath: '/player',
      cookieName: 'hulk_session_dev',
      secureCookie: false,
    },
  });
  const server = await startHandlerServer(handler);
  try {
    const response = await fetch(`${server.origin}/player/api/session`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { authenticated: false });
  } finally {
    await server.close();
  }
});

test('media locator issuance returns an application-mounted URL', async () => {
  const rootSecret = Buffer.alloc(32, 9).toString('base64url');
  const keys = deriveSecurityKeys(rootSecret);
  const locator = new MediaLocatorCodec(keys.mediaLocatorKey);
  const sessionToken = 'A'.repeat(32);
  const credentials = Object.freeze({
    host: 'https://provider.example/',
    username: 'user',
    password: 'pass',
  });
  const handler = createMediaApiHandler({
    sessions: {
      async acquireProviderCredentials() {
        return Object.freeze({
          credentials,
          expiresAtEpochMs: Date.now() + 60_000,
        });
      },
    },
    catalog: {
      async movieDetails() {
        return Object.freeze({ id: '42', name: 'Movie', containerExtension: 'mp4' });
      },
    },
    cookieName: 'hulk_session_dev',
    publicOrigin: 'https://hulksa.com',
    appBasePath: '/player',
    transport: {},
    locator,
    adapter: {},
  });
  const server = createServer((request, response) => {
    void handler(request, response).then((handled) => {
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
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/media/locators`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `hulk_session_dev=${sessionToken}`,
        Origin: 'https://hulksa.com',
        'Sec-Fetch-Site': 'same-origin',
      },
      body: JSON.stringify({ kind: 'movie', id: '42' }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.match(body.url, /^\/player\/api\/media\/r\//u);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('Passenger startup entry point remains synchronous-require compatible', async () => {
  const startupUrl = new URL('../app.js', import.meta.url);
  const startup = await readFile(startupUrl, 'utf8');
  assert.equal(startup.trim(), "void import('./dist/apps/server/src/start.js');");

  const appPath = fileURLToPath(startupUrl);
  const probe = spawnSync(
    process.execPath,
    [
      '--input-type=commonjs',
      '--eval',
      `require(${JSON.stringify(appPath)}); process.stdout.write('passenger-require-ok'); process.exit(0);`,
    ],
    { encoding: 'utf8' },
  );

  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout, 'passenger-require-ok');
  assert.equal(probe.stderr, '');
});
