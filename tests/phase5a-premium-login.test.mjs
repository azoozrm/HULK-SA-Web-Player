import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';
import { createSessionApiHandler } from '../dist/apps/server/src/http/session-api.js';

const origin = 'https://player.example';

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

function createDependencies(expiresAt, capturedLogins) {
  return {
    authenticator: {
      async authenticate(login) {
        capturedLogins.push(login);
        return { providerExpiresAtEpochMs: null };
      },
    },
    sessions: {
      async establish() {
        return {
          bearerToken: 'opaque_session_bearer_1234567890',
          descriptor: { authenticated: true, expiresAt },
        };
      },
      async resolve() {
        return null;
      },
      async revoke() {},
      async acquireProviderCredentials() {
        return null;
      },
    },
    rateLimiter: {
      async consume() {
        return { allowed: true };
      },
    },
    config: {
      publicOrigin: origin,
      cookieName: '__Host-hulk_session',
      secureCookie: true,
    },
  };
}

async function postLogin(baseUrl, rememberAccount) {
  return fetch(`${baseUrl}/api/session`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      host: 'http://provider.example:8080',
      username: 'customer',
      password: 'top-secret',
      rememberAccount,
    }),
  });
}

test('Phase 5A remember-account only changes browser cookie persistence and never extends session expiry', async () => {
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const capturedLogins = [];
  const server = await startSessionServer(createDependencies(expiresAt, capturedLogins));
  try {
    const sessionOnly = await postLogin(server.baseUrl, false);
    assert.equal(sessionOnly.status, 201);
    const sessionCookie = sessionOnly.headers.get('set-cookie') ?? '';
    assert.match(sessionCookie, /HttpOnly/u);
    assert.match(sessionCookie, /Secure/u);
    assert.match(sessionCookie, /SameSite=Strict/u);
    assert.match(sessionCookie, /Path=\//u);
    assert.doesNotMatch(sessionCookie, /Max-Age=/iu);
    assert.doesNotMatch(sessionCookie, /Expires=/iu);
    assert.equal((await sessionOnly.json()).expiresAt, expiresAt);

    const remembered = await postLogin(server.baseUrl, true);
    assert.equal(remembered.status, 201);
    const persistentCookie = remembered.headers.get('set-cookie') ?? '';
    assert.match(persistentCookie, /Max-Age=\d+/u);
    assert.match(persistentCookie, /Expires=/u);
    assert.equal((await remembered.json()).expiresAt, expiresAt);

    assert.deepEqual(capturedLogins, [
      {
        host: 'http://provider.example:8080',
        username: 'customer',
        password: 'top-secret',
      },
      {
        host: 'http://provider.example:8080',
        username: 'customer',
        password: 'top-secret',
      },
    ]);
  } finally {
    await server.close();
  }
});

test('Phase 5A remember-account rejects non-boolean request values', async () => {
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const capturedLogins = [];
  const server = await startSessionServer(createDependencies(expiresAt, capturedLogins));
  try {
    const response = await fetch(`${server.baseUrl}/api/session`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        host: 'https://provider.example',
        username: 'customer',
        password: 'top-secret',
        rememberAccount: 'yes',
      }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(capturedLogins, []);
  } finally {
    await server.close();
  }
});

test('Phase 5A premium login owns password visibility once and never persists Provider credentials', async () => {
  const source = await readFile(new URL('../apps/web/src/main.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(
    source,
    /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bdocument\.cookie\b/iu,
  );
  assert.doesNotMatch(source, /\bconsole\.(?:log|info|warn|error|debug)\b/u);
  assert.match(source, /rememberAccount,/u);
  assert.match(source, /credentials:\s*'same-origin'/u);
  assert.equal(
    source.match(/password\.type = showPassword \? 'text' : 'password'/gu)?.length,
    1,
  );
  assert.doesNotMatch(source, /password-toggle/u);
  assert.match(source, /createLoginOption\(LOGIN_COPY\.showPassword\)/u);
  assert.match(source, /createLoginOption\(LOGIN_COPY\.rememberAccount\)/u);
});

test('Phase 5A touched Arabic login copy is plain and the CTA has no icon ownership', async () => {
  const source = await readFile(new URL('../apps/web/src/main.ts', import.meta.url), 'utf8');
  const copyBlock = /const LOGIN_COPY = Object\.freeze\(\{([\s\S]*?)\n\}\);/u.exec(source)?.[1];
  assert.ok(copyBlock);
  assert.doesNotMatch(copyBlock, /[أإآ\u064B-\u065F\u0670]/u);
  for (const expected of [
    'اهلا بك',
    'ادخل بيانات اشتراكك للمتابعة',
    'تذكر الحساب',
    'اظهار كلمة المرور',
    'دخول الى HULK',
  ]) {
    assert.match(copyBlock, new RegExp(expected, 'u'));
  }
  assert.match(source, /createButton\(LOGIN_COPY\.submit, 'primary-action', 'submit'\)/u);
  assert.doesNotMatch(source, /submit\.prepend/u);
});

test('Phase 5A login directionality keeps Provider host LTR while Arabic-capable fields use auto direction', async () => {
  const source = await readFile(new URL('../apps/web/src/main.ts', import.meta.url), 'utf8');
  assert.match(source, /host\.dir = 'ltr'/u);
  assert.match(source, /username\.dir = 'auto'/u);
  assert.match(source, /password\.dir = 'auto'/u);
});

test('Phase 5A mobile field focus is container-owned while keyboard and remote focus remains visible', async () => {
  const styles = await readFile(new URL('../apps/web/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /:focus-visible\s*\{/u);
  assert.match(styles, /\.input-frame:focus-within\s*\{/u);
  assert.match(styles, /\.input-frame input:focus-visible\s*\{[\s\S]*?outline:\s*none;[\s\S]*?box-shadow:\s*none;/u);
  assert.match(styles, /\.login-option-toggle:focus-visible\s*\{/u);
  assert.match(styles, /\.login-options\s*\{/u);
  assert.match(styles, /\.login-option-toggle\[aria-pressed="true"\]/u);
  assert.doesNotMatch(styles, /background-size:\s*3rem\s+3rem/u);
});
